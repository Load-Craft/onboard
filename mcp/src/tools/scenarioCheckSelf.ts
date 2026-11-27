// `scenario_check_self`: runs the self-check of the named scenarios again (one user, one pass, on the
// default environment) and returns the request chain of each. The backend has no channel for it:
// the state is the `self_check` field of the scenario, read until no check is in progress.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import {
  IN_FLIGHT_STATUSES,
  readSelfCheck,
  readSelfCheckRequests,
  startSelfCheck,
  type CheckFailure,
  type CheckRequest,
  type SelfCheckState,
} from '../api/selfCheck.js';
import { getCompat, listEnvironmentStates } from '../api/status.js';
import type { OperationContext } from '../ops/operation.js';
import { listLive } from '../ops/liveProgress.js';
import {
  defineOperationKind,
  encodeHandle,
  MAX_CALL_WAIT_S,
  startOrJoin,
} from '../ops/operation.js';
import type { DoneOutcome, Link } from '../outcome.js';
import { defineTool } from '../registry.js';
import {
  renderSelfCheck,
  renderSelfCheckProgress,
  type CheckPhase,
  type SelfCheckData,
} from '../render/views/selfCheck.js';
import type { CheckAttemptView, CheckStep, ScenarioCheck } from '../render/views/selfCheckChain.js';
import { inline } from '../render/primitives.js';
import { createResolver } from '../resolve/handles.js';
import { readFailedRequest, type RecordedRequest } from './results/failures.js';
import {
  buildSelfCheckView,
  writeSelfCheckView,
  type SelfCheckStateView,
} from './selfCheckStateView.js';
import { settleAll } from '../http/operation.js';

const MAX_SCENARIOS = 20;
/** The state of a check is read this often; a check takes seconds to minutes. */
const POLL_MS = 3000;

const input = z.object({
  scenarios: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_SCENARIOS)
    .describe('Names (or ids) of the scenarios to check again, 1 to 20.'),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

// ---- the operation ----------------------------------------------------------------------

const saved = z.object({
  project: z.object({ id: z.string(), name: z.string() }),
  /** Name of the default environment when the checks started; `null` when there was none. */
  environment: z.string().nullable(),
  scenarios: z.array(z.object({ id: z.string(), name: z.string() })),
});
type Saved = z.infer<typeof saved>;

interface CheckedScenario {
  readonly id: string;
  readonly name: string;
  /** `null` until the backend reports a check of the scenario. */
  readonly state: SelfCheckState | null;
}

interface ChecksState {
  readonly project: Saved['project'];
  readonly environment: string | null;
  readonly scenarios: readonly CheckedScenario[];
}

const isFinal = (scenario: CheckedScenario): boolean =>
  scenario.state !== null && !IN_FLIGHT_STATUSES.includes(scenario.state.status);

function phaseOf(scenario: CheckedScenario): CheckPhase {
  const status = scenario.state?.status;
  return status === 'running' || status === 'repairing' ? status : 'pending';
}

/** Statuses whose view draws the request chain of a run. */
const CHAIN_STATUSES: readonly string[] = [
  'passed',
  'passed_after_repair',
  'goal_step_missing',
  'failed',
];
/** Statuses of a check that ran to its end, whose last run's totals are shown. */
const TOTALS_STATUSES: readonly string[] = ['passed', 'passed_after_repair', 'goal_step_missing'];

type RunReader = (executionId: string) => Promise<readonly CheckRequest[]>;
/** The failed request of a run, read from its trace, masked; `null` when none was recorded. */
type FailedReader = (executionId: string, named: string | null) => Promise<RecordedRequest | null>;

/**
 * Every run of a failed check with what it got back. Run `i` is the pass of the version before
 * repair round `i`: its failure is the one that round read, and the last run's is the check's own.
 * The first run checked the version the check started from, any later one the version the round
 * before it wrote.
 */
async function attemptsOf(
  state: SelfCheckState,
  readFailed: FailedReader,
  short: (id: string) => string,
): Promise<CheckAttemptView[]> {
  // The runs the backend lists carry their steps and so their own failing step, which names the trace to
  // read; a check stored before runs has only the failure of the check and of each round.
  const runs =
    state.runs.length > 0 ? state.runs.map((run) => run.executionId) : state.executionIds;
  return settleAll(
    runs.map(async (run, index): Promise<CheckAttemptView> => {
      const failure =
        index < state.repairs.length ? (state.repairs[index]?.failure ?? null) : state.failure;
      const version =
        index === 0
          ? state.repairs.length === 0
            ? state.version
            : null
          : (state.repairs[index - 1]?.version ?? null);
      const failedStep = state.runs[index]?.steps.find(
        (step) => step.result === 'failed' && step.reason !== null,
      );
      const named = failedStep === undefined ? (failure?.request ?? null) : failedStep.name;
      const recorded = await readFailed(run, named);
      return {
        run: short(run),
        version,
        request: failure?.request ?? recorded?.step ?? null,
        message: failure?.message ?? recorded?.error ?? null,
        recorded: recorded !== null,
        status: recorded?.status ?? null,
        response: recorded?.responseBody ?? null,
      };
    }),
  );
}

/**
 * The chain of the request rows of a run. The failing request the check names marks the first
 * failed row; when the run left no failed row for it, the request is added as the last step.
 */
function stepsOf(rows: readonly CheckRequest[], failure: CheckFailure | null): CheckStep[] {
  const named = failure?.request ?? '';
  // The order the run first answered each request; a row the console lacks has none and goes last.
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        (a.row.runOrder ?? Number.MAX_SAFE_INTEGER) - (b.row.runOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
  const steps: CheckStep[] = ordered.map((row) => ({
    name: row.name,
    ok: row.ko === 0,
    failedRequest: null,
  }));
  if (named === '' || rows.length === 0) return steps;
  const failed = steps.findIndex((step) => !step.ok);
  const at = failed >= 0 ? failed : steps.findIndex((step) => step.name === named);
  if (at < 0) return [...steps, { name: named, ok: false, failedRequest: named }];
  return steps.map((step, index) =>
    index === at ? { name: step.name, ok: false, failedRequest: named } : step,
  );
}

const EMPTY_CHECK = {
  steps: [],
  requests: 0,
  responseMs: 0,
  failure: null,
  notes: [],
  missingSlots: [],
  repairs: [],
} satisfies Omit<ScenarioCheck, 'name' | 'status'>;

/** What the state of a check says by itself, with no read of its runs: what the state file view is made of. */
function checkOf(scenario: CheckedScenario): ScenarioCheck {
  const state = scenario.state;
  if (state === null) return { name: scenario.name, status: 'pending', ...EMPTY_CHECK };
  return {
    name: scenario.name,
    status: state.status,
    steps: [],
    runs: state.runs.map((run) => ({
      executionId: run.executionId,
      version: run.version,
      status: run.status,
      steps: run.steps,
      stepsOmitted: run.stepsOmitted,
    })),
    maxRepairRounds: state.maxRepairRounds,
    requests: 0,
    responseMs: 0,
    failure: state.failure,
    notes: state.notes,
    missingSlots: state.missingSlots,
    repairs: state.repairs.map((repair) => ({
      round: repair.round,
      changes: repair.changes,
      // The model's own words may quote the target's answer: one line, cut, and masked with the rest of the result.
      refused: repair.refused === null ? null : inline(repair.refused, 300),
      refusedMessage: repair.refusedMessage,
      refusedCode: repair.refusedCode,
      version: repair.version,
      verdict: repair.verdict,
    })),
  };
}

async function viewOf(
  scenario: CheckedScenario,
  readRun: RunReader,
  readFailed: FailedReader,
  short: (id: string) => string,
): Promise<ScenarioCheck> {
  const state = scenario.state;
  const base = checkOf(scenario);
  if (state === null) return base;

  const repaired = state.repairs.length > 0;
  const lastRun = state.executionIds.at(-1);
  const draws = CHAIN_STATUSES.includes(state.status);
  // The backend lists the steps of every run in the order they ran; only a check stored before that
  // has its chain read from the metrics of one run (after a repair the failing first pass).
  const listed = state.runs.length > 0;
  const chainRun = repaired ? state.executionIds[0] : lastRun;
  const chainRows = !listed && draws && chainRun !== undefined ? await readRun(chainRun) : [];
  const totalRows =
    TOTALS_STATUSES.includes(state.status) && lastRun !== undefined ? await readRun(lastRun) : [];
  const chainFailure = repaired ? (state.repairs[0]?.failure ?? null) : state.failure;
  const attempts = state.status === 'failed' ? await attemptsOf(state, readFailed, short) : [];
  return {
    ...base,
    steps: stepsOf(chainRows, chainFailure),
    requests: totalRows.reduce((sum, row) => sum + row.ok + row.ko, 0),
    responseMs: totalRows.reduce((sum, row) => sum + (row.ok + row.ko) * row.meanMs, 0),
    ...(attempts.length === 0 ? {} : { attempts }),
  };
}

/** The checks of `state` as the state file view holds them, from `checks` drawn for each scenario. */
function stateViewOf(state: ChecksState, checks: readonly ScenarioCheck[]): SelfCheckStateView {
  return buildSelfCheckView(
    state.environment,
    state.scenarios.map((scenario, index) => ({
      id: scenario.id,
      check: checks[index] ?? checkOf(scenario),
      version: scenario.state?.version ?? null,
      startedAt: scenario.state?.startedAt ?? null,
      finishedAt: scenario.state?.finishedAt ?? null,
      started: scenario.state?.executionIds.length ?? 0,
    })),
  );
}

/**
 * Writes the view of the checks while they run, from the state just read (no read of its own), when
 * it changed: the client beside the chat sees a step that failed, a repair and the next run as they come.
 */
function observeChecks(ctx: OperationContext, key: string, state: ChecksState): Promise<void> {
  return writeSelfCheckView(ctx, key, stateViewOf(state, state.scenarios.map(checkOf)), {
    onlyChanged: true,
    quick: true,
  });
}

/** The state of every check of the operation, one read of each scenario. */
async function readChecks(ctx: OperationContext, start: Saved): Promise<ChecksState> {
  const read = await settleAll(
    start.scenarios.map((scenario) => readSelfCheck(ctx, start.project.id, scenario.id)),
  );
  return {
    project: start.project,
    environment: start.environment,
    scenarios: start.scenarios.map((scenario, index) => ({
      id: scenario.id,
      name: read[index]?.name ?? scenario.name,
      state: read[index]?.state ?? null,
    })),
  };
}

/** The run that ended last, for the link to its requests; the later scenario wins a tie. */
function lastRunOf(scenarios: readonly CheckedScenario[]): string | undefined {
  let best: { at: string; run: string } | undefined;
  for (const scenario of scenarios) {
    const run = scenario.state?.executionIds.at(-1);
    if (run === undefined) continue;
    const at = scenario.state?.finishedAt ?? scenario.state?.startedAt ?? '';
    if (best === undefined || at >= best.at) best = { at, run };
  }
  return best?.run;
}

export const selfCheckOperation = defineOperationKind<ChecksState, SelfCheckData, Saved>({
  kind: 'self_check',
  pollIntervalMs: POLL_MS,
  saved,
  initial: (_ctx, _id, start) => ({
    project: start.project,
    environment: start.environment,
    scenarios: start.scenarios.map((scenario) => ({ ...scenario, state: null })),
  }),
  recoverIsRead: true,
  recover: (ctx, _id, start) => readChecks(ctx, start),
  // A check no call follows (its handle went back to the model) is read here, for the client beside the
  // chat that polls the operation: one read of each scenario, nothing written. While a call follows it,
  // that call writes the view at every change, and nothing is read here.
  async snapshot(ctx, id, start) {
    const handle = encodeHandle(selfCheckOperation.kind, id);
    const now = ctx.clock.now();
    if (listLive(ctx.state, now).some((row) => row.open && row.handle === handle)) return {};
    let state: ChecksState;
    try {
      state = await readChecks(ctx, start);
    } catch {
      // A view is a convenience: a read that failed shows nothing new.
      return {};
    }
    const view = ctx.secrets.scrubDeep(stateViewOf(state, state.scenarios.map(checkOf)));
    return {
      ...(state.scenarios.every(isFinal) ? { phase: 'completed' } : {}),
      selfCheck: { ...view, key: id, savedAt: new Date(now).toISOString() },
    };
  },
  isTerminal: (state) => state.scenarios.every(isFinal),
  observe: (ctx, id, state) => observeChecks(ctx, id, state),
  describe(state, t) {
    const done = state.scenarios.filter(isFinal).length;
    const total = state.scenarios.length;
    return {
      message: renderSelfCheckProgress(
        {
          environment: state.environment,
          done,
          total,
          active: state.scenarios
            .filter((scenario) => !isFinal(scenario))
            .map((scenario) => ({ name: scenario.name, phase: phaseOf(scenario) })),
        },
        t,
      ),
      fraction: total === 0 ? 1 : done / total,
    };
  },
  async finish(ctx, id, state) {
    // One read per run, however many scenarios or rounds ask for it.
    const reads = new Map<string, Promise<readonly CheckRequest[]>>();
    const readRun: RunReader = (executionId) => {
      const known = reads.get(executionId);
      if (known !== undefined) return known;
      const pending = readSelfCheckRequests(ctx, state.project.id, executionId);
      reads.set(executionId, pending);
      return pending;
    };
    const failedReads = new Map<string, Promise<RecordedRequest | null>>();
    const readFailed: FailedReader = (executionId, named) => {
      const known = failedReads.get(executionId);
      if (known !== undefined) return known;
      const pending = readFailedRequest(ctx, state.project.id, executionId, named);
      failedReads.set(executionId, pending);
      return pending;
    };
    const resolver = createResolver(ctx);
    const short = (id: string): string => resolver.shortExecution(id);
    const scenarios = await settleAll(
      state.scenarios.map((scenario) => viewOf(scenario, readRun, readFailed, short)),
    );
    // The client beside the chat draws the same check from the state file; one view per call.
    await writeSelfCheckView(ctx, id, stateViewOf(state, scenarios));
    const run = lastRunOf(state.scenarios);
    const links: Link[] =
      run === undefined
        ? []
        : [ctx.services.links.executionResults(state.project.id, run, 'Requests')];
    const done: DoneOutcome<SelfCheckData> = {
      status: 'done',
      data: { environment: state.environment, scenarios },
      ...(links.length === 0 ? {} : { links }),
    };
    return done;
  },
  view: renderSelfCheck,
});

/** Identifies one call: the same scenarios checked again later are another operation. */
function operationId(
  ctx: OperationContext,
  projectId: string,
  scenarioIds: readonly string[],
): string {
  const key = [projectId, ...scenarioIds, String(ctx.clock.now())].join('|');
  return `sc-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export const scenarioCheckSelf = defineTool({
  name: 'scenario_check_self',
  title: 'Check scenarios again',
  description:
    'Runs the self-check of the named scenarios again, after test data was prepared or a scenario ' +
    "changed: one virtual user, one pass, sending real requests to the project's default " +
    'environment (never another one). Returns the request chain of each scenario with the result: ' +
    'passed, passed after an AI repair, waiting for data, target unreachable, not admitted, ' +
    'interrupted, failed. A check that waits for data is a result, not an error. Checks of one ' +
    'project run one after another, so the call may take a while; an unfinished call returns a ' +
    'handle for process_wait.',
  input,
  annotations: { openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project);
    // Every name is resolved before anything is sent: a wrong name starts no check.
    const scenarios: { id: string; name: string }[] = [];
    for (const requested of args.scenarios) {
      const found = await resolver.scenario(project.id, requested);
      if (!scenarios.some((scenario) => scenario.id === found.id)) scenarios.push(found);
    }
    const environments = await listEnvironmentStates(ctx, project.id);
    const environment = environments.find((candidate) => candidate.isDefault)?.name ?? null;
    const ids = scenarios.map((scenario) => scenario.id).sort();
    // The same scenarios checked again while their check runs go on with that operation; a check
    // already running in LoadCraft (409) is joined too, not an error.
    return startOrJoin(ctx, selfCheckOperation, {
      maxWaitS: MAX_CALL_WAIT_S,
      matches: (run) => {
        const running = run.scenarios.map((scenario) => scenario.id).sort();
        return (
          run.project.id === project.id &&
          running.length === ids.length &&
          running.every((id, index) => id === ids[index])
        );
      },
      async start() {
        for (const scenario of scenarios) await startSelfCheck(ctx, project.id, scenario.id);
        return {
          id: operationId(ctx, project.id, ids),
          saved: { project, environment, scenarios },
        };
      },
    });
  },
  render: renderSelfCheck,
});
