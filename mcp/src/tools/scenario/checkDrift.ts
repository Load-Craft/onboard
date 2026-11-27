// `scenario_check_drift` (module scenario): Check whether a scenario still matches its reference
// (HAR or API docs); returns a staleness score and a drift report.
// The first tool written on the block of a long operation (docs/long-operation.md). A tool of level 2: the
// first call reads what the check would compare and makes the card, nothing starts; after the person's yes
// `run` joins the channel `healthCheck` under a session id derived from the operation id, starts the check with it (the backend
// does not replay frames, so the connection comes first) and follows it for the time of one call; what is
// unfinished is `drift_check:<session>` for `process_wait`. The report comes only in the `complete` frame;
// when the channel is lost or the operation is resumed later the score of the check is read from the cache of
// the backend (`GET …/staleness`) and the result says the report was not received.
// The names, the cause of a failure and the texts of the report are third-party text (`content`); nothing of
// them is saved in the operation entry: it keeps the ids, the source and the start time.
// Log: args "Check drift of scenario {name}", result "staleness {score}": the log values carry both.
// State: the check `steps.scenario.drift` (ok when nothing changed or is gone); a drifted scenario opens the
// warning `scenario_drifted`, a clean check closes it; the row of the operation is the mechanism's.

import * as z from 'zod';

import { createHash } from 'node:crypto';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import {
  cardViewCheckDrift,
  isDriftNode,
  renderCheckDrift,
  renderDriftProgress,
  type DriftData,
  type DriftFacts,
  type DriftNode,
  type DriftReport,
} from '../../render/scenario/checkDrift.js';
import { listScenarios } from './list.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import {
  defineOperationKind,
  operationId,
  renderOperation,
  startOperation,
} from '../kit/operation.js';
import { getStaleness } from './get.js';
import { SCENARIO_CHECK_DRIFT } from './meta.generated.js';
import { resolveScenarioId } from './scenarioId.js';

/** POST /api/scenarios/{scenario_id}/health-check (REST API v1) */
export function triggerHealthCheck(
  ctx: CallContext,
  path: { readonly scenario_id: string },
  body: BodyOf<'trigger_health_check_api_scenarios__scenario_id__health_check_post'>,
): Promise<OpOutput<'trigger_health_check_api_scenarios__scenario_id__health_check_post'>> {
  return callBackend(ctx, 'trigger_health_check_api_scenarios__scenario_id__health_check_post', {
    path,
    body,
  });
}

const NAME_LIMIT = 120;

/**
 * The session id of the check of operation `id`, as the channel and the request that starts it name it. It
 * is derived, not saved or shown: a field called `session_id` is a secret to the plugin (its value is
 * registered when the answer comes back), so the id of the operation, which is saved and shown, is another
 * value, and the session never reaches the state file or the model.
 */
export function driftSessionOf(id: string): string {
  const hex = createHash('sha256').update(`drift-check:${id}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
const ENDPOINTS_SHOWN = 20;
const DRIFTS_SHOWN = 20;
const RECOMMENDATIONS_SHOWN = 10;
const UNCOVERED_SHOWN = 20;
/** The score of a check that was not seen to end is given up on after this long: the backend lost it. */
const GIVE_UP_MS = 10 * 60_000;
/** A scenario whose reference changed anything: a drifted endpoint or parameter. */
export const DRIFT_PROBLEM = 'scenario_drifted';

// ---- the operation ----------------------------------------------------------------------

const saved = z.object({
  scenarioId: z.string().min(1).max(64),
  /** The name the call showed on its card, already masked. */
  name: z.string().max(NAME_LIMIT),
  referenceSource: z.enum(['har', 'openapi']),
  referenceId: z.string().min(1).max(128),
  startedAt: z.number(),
});
type Saved = z.infer<typeof saved>;

interface DriftState {
  readonly phase: 'running' | 'done' | 'failed' | 'cancelled';
  readonly percent: number;
  readonly node: DriftNode | null;
  /** The `result` of the `complete` frame, as it came; masked in `finish`. */
  readonly frame?: Readonly<Record<string, unknown>>;
  /** The score and the time of the check, when only the cache of the backend gave them. */
  readonly cached?: { readonly score: number; readonly checkedAt: string };
  readonly cause?: string;
}

const RUNNING: DriftState = { phase: 'running', percent: 0, node: null };

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function reportOf(ctx: CallContext, result: Readonly<Record<string, unknown>>): DriftReport {
  const covered = list(result['covered_endpoints']).map(record);
  const drifted = covered.filter(
    (endpoint) => endpoint['status'] === 'modified' || endpoint['status'] === 'removed',
  );
  const parameters = list(result['parameter_drifts']).map(record);
  const uncovered = list(result['uncovered_endpoints'])
    .map(text)
    .filter((path) => path !== '');
  return {
    current: covered.filter((endpoint) => endpoint['status'] === 'current').length,
    drifted_total: drifted.length,
    drifted: drifted.slice(0, ENDPOINTS_SHOWN).map((endpoint) => ({
      method: content(ctx, text(endpoint['method']), 10).toUpperCase(),
      path: content(ctx, text(endpoint['path_template']), 200),
      status: endpoint['status'] === 'removed' ? 'removed' : 'modified',
      details: list(endpoint['drift_details'])
        .map(text)
        .slice(0, 3)
        .map((detail) => content(ctx, detail, 160)),
    })),
    parameter_drifts_total: parameters.length,
    parameter_drifts: parameters.slice(0, DRIFTS_SHOWN).map((drift) => ({
      endpoint: content(ctx, text(drift['endpoint']), 200),
      param: content(ctx, text(drift['param_name']), 80),
      location:
        drift['param_location'] === 'header' || drift['param_location'] === 'body'
          ? drift['param_location']
          : 'query',
      change: content(ctx, text(drift['change_description']), 200),
    })),
    recommendations: list(result['recommendations'])
      .map(text)
      .filter((recommendation) => recommendation !== '')
      .slice(0, RECOMMENDATIONS_SHOWN)
      .map((recommendation) => content(ctx, recommendation, 300)),
    uncovered_total: uncovered.length,
    uncovered: uncovered.slice(0, UNCOVERED_SHOWN).map((path) => content(ctx, path, 200)),
  };
}

/** Whether the reference changed anything the scenario uses. */
function drifted(report: DriftReport | null, score: number): boolean {
  return report === null
    ? score > 0
    : report.drifted_total > 0 || report.parameter_drifts_total > 0;
}

/** What a finished check says; a failed or cancelled one is thrown as the code of the module. */
function finished(ctx: CallContext, state: DriftState, run: Saved): DoneOutcome<DriftData> {
  if (state.phase === 'cancelled') throw new ToolError('scenario_drift_cancelled');
  if (state.phase === 'failed') {
    throw new ToolError('scenario_drift_failed', {
      params: { cause: content(ctx, state.cause ?? 'unknown', 200) },
    });
  }
  const result = state.frame;
  const report = result === undefined ? null : reportOf(ctx, result);
  const frameScore = result?.['staleness_score'];
  const score = typeof frameScore === 'number' ? frameScore : (state.cached?.score ?? 0);
  const frameAt = result?.['checked_at'];
  const data: DriftData = {
    scenario_id: run.scenarioId,
    name: run.name,
    reference_source: run.referenceSource,
    reference_id: content(ctx, run.referenceId, 128),
    score,
    checked_at: typeof frameAt === 'string' ? frameAt : (state.cached?.checkedAt ?? null),
    report,
  };
  const changed = drifted(report, score);
  return {
    status: 'done',
    data,
    update: {
      log: { values: { name: run.name, score: Number(score.toFixed(2)) } },
      checks: { scenario: { drift: { ok: !changed } } },
      problems: {
        open: changed
          ? [
              {
                module: 'scenario',
                tool: 'scenario_check_drift',
                code: DRIFT_PROBLEM,
                severity: 'warning',
                message: 'The scenario no longer matches its reference; read the drift report.',
                ref: { kind: 'scenario', id: run.scenarioId },
              } as const,
            ]
          : [],
        close: changed ? [] : [{ code: DRIFT_PROBLEM, ref_id: run.scenarioId }],
      },
    },
  };
}

export const driftCheckOperation = defineOperationKind<DriftState, DriftData, Saved, 'healthCheck'>(
  {
    kind: 'drift_check',
    saved,
    initial: (): DriftState => RUNNING,
    channel: {
      name: 'healthCheck',
      params: (id) => ({ session_id: driftSessionOf(id) }),
      // The backend sends nothing on connect and replays nothing: connect before the check starts.
      connectFirst: (id) => ({ session_id: driftSessionOf(id) }),
      cancelMessage: { type: 'cancel' },
      reduce(state: DriftState, frame): DriftState {
        switch (frame.type) {
          case 'progress':
            return {
              ...state,
              percent: Math.max(state.percent, frame.data.progress),
              node: isDriftNode(frame.data.node) ? frame.data.node : state.node,
            };
          case 'complete':
            return { ...state, phase: 'done', percent: 100, frame: frame.data.result };
          case 'error':
            return { ...state, phase: 'failed', cause: frame.data.error };
          case 'cancelled':
            return { ...state, phase: 'cancelled' };
        }
      },
    },
    recoverIsRead: true,
    // Frames are not replayed and the report is only in the `complete` frame: the cache of the backend gives the score
    // of a check that ended after this one started.
    async recover(ctx, _id, run): Promise<DriftState> {
      try {
        const stale = await getStaleness(ctx, { scenario_id: run.scenarioId });
        if (Date.parse(stale.checked_at) >= run.startedAt) {
          return {
            phase: 'done',
            percent: 100,
            node: null,
            cached: { score: stale.staleness_score, checkedAt: stale.checked_at },
          };
        }
      } catch (error) {
        if (!(error instanceof LoadcraftApiError && error.status === 404)) throw error;
      }
      if (ctx.clock.now() - run.startedAt >= GIVE_UP_MS) {
        return { phase: 'failed', percent: 0, node: null, cause: 'the backend lost the check' };
      }
      return RUNNING;
    },
    isTerminal: (state) => state.phase !== 'running',
    ended: (state) =>
      state.phase === 'cancelled' ? 'cancelled' : state.phase === 'failed' ? 'failed' : undefined,
    describe: (state, t) => ({
      message: renderDriftProgress({ node: state.node, percent: state.percent }, t),
      fraction: Math.min(1, Math.max(0, state.percent / 100)),
    }),
    finish: (ctx, _id, state, run) => Promise.resolve().then(() => finished(ctx, state, run)),
    view: renderCheckDrift,
  },
);

// ---- the tool -----------------------------------------------------------------------------

export const scenarioCheckDrift = moduleTool(SCENARIO_CHECK_DRIFT, {
  title: 'Check whether a scenario still matches its reference',
  input: {
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The scenario to check (id or name); default: the only one in this workspace.'),
    reference_source: z
      .enum(['har', 'openapi'])
      .describe(
        'What to compare the scenario with: a recorded HAR session or a documentation version.',
      ),
    reference_id: z
      .string()
      .min(1)
      .max(128)
      .describe('The HAR session id or the documentation version id to compare with.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = await resolveScenarioId(ctx, projectId, args.scenario_id);
    // reads the name the card shows; a scenario the project does not have is not_found before any question
    const { scenarios } = await listScenarios(ctx, { project_id: projectId }, { limit: 200 });
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (scenario === undefined) throw new ToolError('not_found', { params: { available: '' } });
    const facts: DriftFacts = {
      scenario_id: scenario.id,
      name: content(ctx, scenario.name, NAME_LIMIT),
      reference_source: args.reference_source,
      reference_id: content(ctx, args.reference_id.trim(), 128),
    };
    return { facts };
  },
  cardView: cardViewCheckDrift,
  run: (ctx, _args, facts) =>
    startOperation(ctx, driftCheckOperation, {
      matches: (run) =>
        run.scenarioId === facts.scenario_id &&
        run.referenceSource === facts.reference_source &&
        run.referenceId === facts.reference_id,
      newId: () =>
        operationId(ctx, 'dc', facts.scenario_id, facts.reference_source, facts.reference_id),
      async start(chosen) {
        const id =
          chosen ??
          operationId(ctx, 'dc', facts.scenario_id, facts.reference_source, facts.reference_id);
        await triggerHealthCheck(
          ctx,
          { scenario_id: facts.scenario_id },
          {
            reference_id: facts.reference_id,
            reference_source: facts.reference_source,
            session_id: driftSessionOf(id),
          },
        );
        return {
          id,
          saved: {
            scenarioId: facts.scenario_id,
            name: facts.name,
            referenceSource: facts.reference_source,
            referenceId: facts.reference_id,
            startedAt: ctx.clock.now(),
          },
        };
      },
    }),
  render: renderOperation(driftCheckOperation),
});
