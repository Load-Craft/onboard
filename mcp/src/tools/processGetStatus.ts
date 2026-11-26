// `process_get_status`: where the session stands. Without a bound project it still answers, with identity,
// compatibility and the first step; with one it reads the project and names the next step.

import * as z from 'zod/v4';

import type { ToolContext } from '../context.js';
import {
  flowsOnOldDocs,
  listFlowsWithTotal,
  needsOfSummary,
  type FlowSummary,
} from '../api/flows.js';
import { ToolError } from '../errors.js';
import { settleAll } from '../http/operation.js';
import { getProject, listCompositions, type Named } from '../api/lookup.js';
import {
  getCompat,
  getIdentity,
  getSetupFacts,
  hasAnalysis,
  listEnvironmentFacts,
  listRecentRuns,
  listScenarioStates,
  type RunState,
  type ScenarioState,
  type SetupState,
  type SetupStep,
} from '../api/status.js';
import { profileSchema } from './run/start.js';
import { dryRunStart } from './run/dryRun.js';
import { listEnded, listLive, type EndedBar, type LiveRow } from '../ops/liveProgress.js';
import { listOperations, snapshotOperation, type OperationSnapshot } from '../ops/operation.js';
import { formatInput, renderDataBlock } from '../render/dataBlock.js';
import { needsInputUpdate } from '../flow/needsInput.js';
import { oldDocsUpdate } from '../flow/oldDocs.js';
import { mergeUpdates } from '../outcome.js';
import { defineTool } from '../registry.js';
import { renderRunDryRun, type DryRunData } from '../render/views/run.js';
import {
  renderGetStatus,
  renderOperationSnapshot,
  type NextStep,
  type StatusData,
  type StatusSection,
} from '../render/views/getStatus.js';
import { createResolver, type Resolver } from '../resolve/handles.js';
import { VERSION } from '../version.js';
import { readProjectBinding } from '../workspace/binding.js';
import { ALL_OPERATION_KINDS } from './operationKinds.js';
import { storedDiagnosis } from './resultsAnalyzeRun.js';
import { capOutline, flowData, type GetFlowData } from './flowsGet.js';
import { openUncertain } from './project/profile.js';
import { reportOf } from './resultsGetReport.js';
import type { DiagnosisData } from '../render/views/getDiagnosis.js';
import type { ReportData } from '../render/views/getReport.js';

const RESULT_KINDS = ['report', 'diagnosis', 'flow'] as const;
/** Names of flows on an older docs version the data of the status carries; the rest is a count. */
const OLD_DOCS_NAMES = 20;

const DETAILS = ['summary', 'flows', 'scenarios', 'data', 'runs'] as const;
type Detail = (typeof DETAILS)[number];

/** Runs the summary shows; a detail list shows up to `DETAIL_ITEMS`. */
const SUMMARY_RUNS = 3;
const DETAIL_ITEMS = 20;

const input = z.object({
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  detail: z
    .enum(DETAILS)
    .default('summary')
    .describe('One section to list in full (up to 20 items); default: the compact summary.'),
  operation: z
    .string()
    .optional()
    .describe(
      'An operation handle exactly as a tool returned it (<kind>:<id>): answers with one ' +
        'snapshot of that operation (phase, time, numbers) instead of the status, and does not wait.',
    ),
  progress: z
    .literal(true)
    .optional()
    .describe(
      'For a client that draws progress bars, with format "data": the long operations in progress ' +
        "(stage, percent when known, counter, start), read from the plugin's own state file. " +
        'Asks the backend nothing, changes nothing.',
    ),
  preflight: z
    .object({
      scenario: z
        .string()
        .min(1)
        .describe('Name of the composition or scenario (as run_plan was given it).'),
      environment: z.string().min(1).describe('Name of the environment, as the user chose it.'),
      profile: profileSchema.describe('The load profile, as run_start takes it.'),
    })
    .optional()
    .describe(
      'Facts before a test, for the same arguments run_start takes: limits of the environment, ' +
        'the profile after them, whether consent is needed, whether the data is enough, whether ' +
        'the environment is free. Starts nothing, records nothing, holds nothing.',
    ),
  result: z
    .object({
      kind: z
        .enum(RESULT_KINDS)
        .describe('Which result: the report of a run, its diagnosis or a flow.'),
      id: z
        .string()
        .min(1)
        .max(200)
        .describe('The run (handle or UUID) for a report or a diagnosis; the flow (name or UUID).'),
    })
    .optional()
    .describe(
      'For a client that draws results, with format "data": the data the view of that result is ' +
        'made from, as one JSON block. Read-only: it starts no analysis and changes nothing.',
    ),
  format: formatInput,
  from_panel: z.boolean().optional().describe('Set only by the LoadCraft panel.'),
});

/** The data of a result the data channel can give: what the view of that tool is made from. */
export type ResultData = ReportData | DiagnosisData | GetFlowData;

/**
 * The bars of the operations in progress (`progress`) and how the operations that ended in the last
 * minute ended (`ended`): the state file only.
 */
export interface ProgressData {
  readonly progress: LiveRow[];
  readonly ended: EndedBar[];
  readonly asOf: string;
  /** The newest self-check view of the state file, when one was written lately (`selfCheckViews`). */
  readonly selfCheck?: SelfCheckEntry;
}

/** A self-check view as the state file holds it, with the key it is kept under and when it was written. */
export interface SelfCheckEntry {
  readonly key: string;
  readonly savedAt: string;
  readonly [field: string]: unknown;
}

/**
 * A view written longer ago than this belongs to a check that is long over: a client that did not see
 * it while it ran is not shown it as news. A check under way writes its view at every change.
 */
const SELF_CHECK_RECENT_MS = 15 * 60_000;

/** The newest self-check view written in the last `SELF_CHECK_RECENT_MS`; the state file only. */
function latestSelfCheck(ctx: ToolContext): SelfCheckEntry | undefined {
  const now = ctx.clock.now();
  let newest: [string, { savedAt: number; value: unknown }] | undefined;
  for (const [key, entry] of ctx.state.entries('selfCheckViews')) {
    if (now - entry.savedAt > SELF_CHECK_RECENT_MS) continue;
    if (newest === undefined || entry.savedAt >= newest[1].savedAt) newest = [key, entry];
  }
  if (newest === undefined) return undefined;
  const [key, entry] = newest;
  const value =
    typeof entry.value === 'object' && entry.value !== null && !Array.isArray(entry.value)
      ? (entry.value as Record<string, unknown>)
      : {};
  return { ...value, key, savedAt: new Date(entry.savedAt).toISOString() };
}

/** Data of a result: it has none of the marks of a status, an operation snapshot or a preflight. */
function isResultData(data: object): data is ResultData {
  return !('asOf' in data || 'operation' in data || 'dry_run' in data);
}

async function resultData(
  ctx: ToolContext,
  selector: { readonly kind: (typeof RESULT_KINDS)[number]; readonly id: string },
  project: string | undefined,
): Promise<ResultData> {
  const resolver = createResolver(ctx);
  const found = await resolver.project(project?.trim() ?? '');
  switch (selector.kind) {
    case 'report': {
      const { id } = await resolver.execution(found.id, selector.id);
      return (await reportOf(ctx, resolver, found.id, id, undefined)).data;
    }
    case 'diagnosis': {
      const { id } = await resolver.execution(found.id, selector.id);
      const data = await storedDiagnosis(ctx, found.id, id);
      if (data === undefined) {
        throw new ToolError('result_not_available', {
          params: { kind: selector.kind, id: selector.id },
        });
      }
      return data;
    }
    case 'flow': {
      const flow = await resolver.flow(found.id, selector.id);
      const data = await flowData(ctx, found, flow.id);
      return { ...data, outline: capOutline(data.outline) };
    }
  }
}

interface ProjectFacts {
  readonly setup: SetupState;
  readonly flows: readonly FlowSummary[];
  readonly scenarios: readonly ScenarioState[];
  readonly compositions: readonly Named[];
  readonly runs: readonly RunState[];
}

/** Journeys the data of the status lists: the Path tab of the panel lists them with a filter. */
const MAX_PATH_JOURNEYS = 200;

type PathJourney = NonNullable<StatusData['path']>['journeys'][number];

const savedBaskets = z.object({
  baskets: z.array(z.unknown()),
});
const savedBasket = z.object({
  name: z.string().min(1),
  pattern_type: z.string(),
  step_labels: z.array(z.string()).catch([]),
});

/**
 * The journeys `flows_suggest_journeys` saved for the project (`workspace state → suggestions`), by name
 * and pattern, for a client that lets the user pick which to build. The workspace state is read, not
 * the backend; anything unreadable is no journeys.
 */
function savedJourneys(
  ctx: ToolContext,
  projectId: string,
  built: ReadonlySet<string>,
): PathJourney[] {
  const saved = savedBaskets.safeParse(ctx.state.get('suggestions', projectId)?.value);
  if (!saved.success) return [];
  return saved.data.baskets
    .flatMap((basket) => {
      const parsed = savedBasket.safeParse(basket);
      if (!parsed.success) return [];
      const { name, pattern_type: pattern, step_labels: steps } = parsed.data;
      return [
        {
          name,
          pattern,
          ...(steps.length === 0 ? {} : { steps }),
          ...(built.has(name) ? { built: true as const } : {}),
        },
      ];
    })
    .slice(0, MAX_PATH_JOURNEYS);
}

/**
 * The handle of the analysis this workspace finished last, when the setup waits only for its profile
 * to be applied: `project_apply_setup` takes it, and analysing again would be a second paid run.
 */
function finishedAnalysis(ctx: ToolContext, missing: readonly SetupStep[]): string | undefined {
  if (missing.includes('analysis') || !missing.includes('profile')) return undefined;
  const done = (ctx.state.process()?.operations ?? []).filter(
    (row) => row.kind === 'setup_analysis' && row.status === 'done',
  );
  const last = done.reduce<(typeof done)[number] | undefined>(
    (latest, row) => (latest === undefined || row.updated_at > latest.updated_at ? row : latest),
    undefined,
  );
  return last?.handle;
}

/** The first unmet step of the session, in the order the steps are taken. */
async function nextStep(
  ctx: ToolContext,
  projectId: string,
  facts: ProjectFacts,
  resolver: Resolver,
): Promise<NextStep> {
  if (!facts.setup.complete) {
    const analysed = finishedAnalysis(ctx, facts.setup.missing);
    return analysed === undefined
      ? { step: 'project_analyze_setup', hint: 'setup_incomplete' }
      : { step: 'project_apply_setup', hint: 'analysis_done', subject: analysed };
  }
  if (facts.flows.length === 0) return { step: 'flows_suggest_journeys', hint: 'no_flows' };
  if (facts.compositions.length === 0)
    return { step: 'scenario_suggest_split', hint: 'no_compositions' };
  const waiting = new Map(
    facts.scenarios.flatMap((scenario) =>
      scenario.slots
        .filter((slot) => slot.state === 'missing')
        .map((slot) => [slot.slot, { slot: slot.slot, label: slot.label }] as const),
    ),
  );
  if (waiting.size > 0) {
    return { step: 'data_check_readiness', hint: 'needs_data', slots: [...waiting.values()] };
  }
  const [last] = facts.runs;
  if (last === undefined) return { step: 'run_start', hint: 'no_runs' };
  if (!(await hasAnalysis(ctx, projectId, last.id))) {
    const subject = resolver.shortExecution(last.id);
    // A test whose thresholds held has nothing to diagnose: the analysis is a paid call that
    // the user asks for, not a step the session owes.
    return last.verdict === 'sla_passed'
      ? {
          step: 'results_get_report',
          hint: 'passed_no_diagnosis',
          subject,
          skipped: ['results_analyze_run'],
        }
      : { step: 'results_get_report', hint: 'no_analysis', subject };
  }
  return { step: 'run_start', hint: 'all_done' };
}

function section(detail: Detail, facts: ProjectFacts): StatusSection | undefined {
  const flowName = new Map(facts.flows.map((flow) => [flow.id, flow.name]));
  switch (detail) {
    case 'flows':
      return {
        kind: 'flows',
        items: facts.flows
          .slice(0, DETAIL_ITEMS)
          .map((flow) => ({ name: flow.name, steps: flow.step_count })),
        more: Math.max(0, facts.flows.length - DETAIL_ITEMS),
      };
    case 'scenarios':
      return {
        kind: 'scenarios',
        items: facts.scenarios.slice(0, DETAIL_ITEMS).map((scenario) => ({
          name: scenario.name,
          flow:
            scenario.sourceFlowId === null ? null : (flowName.get(scenario.sourceFlowId) ?? null),
          version: scenario.version,
          selfCheck: scenario.selfCheck,
        })),
        more: Math.max(0, facts.scenarios.length - DETAIL_ITEMS),
        compositions: facts.compositions.slice(0, DETAIL_ITEMS).map((item) => item.name),
        moreCompositions: Math.max(0, facts.compositions.length - DETAIL_ITEMS),
      };
    case 'data': {
      const withSlots = facts.scenarios.filter((scenario) => scenario.slots.length > 0);
      return {
        kind: 'data',
        items: withSlots
          .slice(0, DETAIL_ITEMS)
          .map((scenario) => ({ scenario: scenario.name, slots: scenario.slots })),
        more: Math.max(0, withSlots.length - DETAIL_ITEMS),
      };
    }
    case 'summary':
    case 'runs':
      return undefined;
  }
}

export const processGetStatus = defineTool({
  name: 'process_get_status',
  title: 'LoadCraft status',
  description:
    'Status, session start, resume, diagnostics: who is signed in, whether the LoadCraft server ' +
    'is compatible, the project setup, environments, counts of flows, scenarios and ' +
    'compositions, recent runs with verdicts, operations in progress and the next step. ' +
    'With operation (a handle from a tool): one snapshot of that operation, read once. With ' +
    'preflight: the facts a run_start call with the same arguments would act on. ' +
    'Read-only: it does not start, change or wait for anything, and it shows no scenario code.',
  input,
  annotations: { readOnlyHint: true },
  async run(ctx, args) {
    if (args.progress === true) {
      const selfCheck = latestSelfCheck(ctx);
      const data: ProgressData = {
        progress: listLive(ctx.state, ctx.clock.now()),
        ended: listEnded(ctx.state, ctx.clock.now()),
        asOf: new Date(ctx.clock.now()).toISOString(),
        ...(selfCheck === undefined ? {} : { selfCheck }),
      };
      return { status: 'done', data };
    }
    if (args.preflight !== undefined) {
      const data = await dryRunStart(ctx, { ...args.preflight, project: args.project });
      return { status: 'done', data };
    }
    if (args.result !== undefined) {
      // A view of a result is the result tool's own; here only its data, as a JSON block.
      if (args.format !== 'data') throw new ToolError('result_needs_data');
      await getCompat(ctx);
      const data = await resultData(ctx, args.result, args.project);
      return { status: 'done', data };
    }
    if (args.operation !== undefined) {
      await getCompat(ctx);
      const data = await snapshotOperation(ctx, ALL_OPERATION_KINDS, args.operation);
      return { status: 'done', data };
    }
    const compat = await getCompat(ctx);
    const identity = await getIdentity(ctx);
    const base = {
      asOf: new Date(ctx.clock.now()).toISOString(),
      identity,
      compat: { ...compat, plugin: VERSION },
      operations: listOperations(ctx.state).map((operation) => ({
        handle: operation.handle,
        kind: operation.kind,
        startedAt: new Date(operation.startedAt).toISOString(),
      })),
    };
    const named = args.project?.trim() ?? '';
    if (named === '' && readProjectBinding(ctx) === null) {
      const data: StatusData = {
        ...base,
        environments: [],
        counts: { flows: 0, scenarios: 0, compositions: 0 },
        recentRuns: [],
        moreRuns: 0,
        next: { step: 'project_create', hint: 'unbound' },
      };
      return { status: 'done', data };
    }

    const resolver = createResolver(ctx);
    const { id } = await resolver.project(named);
    const [project, setupFacts, environmentFacts, listed, scenarios, compositions, runs] =
      await settleAll([
        getProject(ctx, id),
        getSetupFacts(ctx, id),
        listEnvironmentFacts(ctx, id),
        listFlowsWithTotal(ctx, id),
        listScenarioStates(ctx, id),
        listCompositions(ctx, id),
        listRecentRuns(ctx, id),
      ]);
    const { setup } = setupFacts;
    const environments = environmentFacts.states;
    const { flows } = listed;
    const old = await flowsOnOldDocs(ctx, id, listed);
    const needs = flows.map(needsOfSummary);
    const needing = flows
      .filter((flow) => (flow.needs_input_count ?? 0) > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
    const definite = needs.reduce((sum, item) => sum + item.definite, 0);
    const facts: ProjectFacts = { setup, flows, scenarios, compositions, runs };
    const targets = new Map<string, string>([
      ...scenarios.map((scenario): [string, string] => [scenario.id, scenario.name]),
      ...compositions.map((composition): [string, string] => [composition.id, composition.name]),
    ]);
    const shownRuns = args.detail === 'runs' ? DETAIL_ITEMS : SUMMARY_RUNS;
    const detailSection = section(args.detail, facts);
    // the warning of the analysis lives in the process of the bound project
    const bound = readProjectBinding(ctx)?.project.id === id;
    const uncertain = bound ? openUncertain(ctx.state.process()) : [];
    const data: StatusData = {
      ...base,
      project: { id, name: project.name },
      setup,
      environments,
      path: {
        docs: setupFacts.evidence.docs,
        recording: setupFacts.evidence.recording,
        frontend: environmentFacts.frontend,
        journeys: savedJourneys(ctx, id, new Set(flows.map((flow) => flow.name))),
      },
      counts: {
        flows: flows.length,
        scenarios: scenarios.length,
        compositions: compositions.length,
      },
      recentRuns: runs.slice(0, shownRuns).map((run) => ({
        handle: resolver.shortExecution(run.id),
        id: run.id,
        target: targets.get(run.compositeId ?? run.scenarioId ?? '') ?? '—',
        status: run.status,
        ...(run.verdict === undefined ? {} : { verdict: run.verdict }),
        when: run.when,
      })),
      moreRuns: Math.max(0, runs.length - shownRuns),
      ...(detailSection === undefined ? {} : { section: detailSection }),
      ...(old.flows.length === 0
        ? {}
        : {
            oldDocs: {
              flows: old.flows.slice(0, OLD_DOCS_NAMES).map((flow) => flow.name),
              more: Math.max(0, old.flows.length - OLD_DOCS_NAMES),
            },
          }),
      ...(needing.length === 0
        ? {}
        : {
            needsInput: {
              flows: needing.slice(0, OLD_DOCS_NAMES).map((flow) => flow.name),
              more: Math.max(0, needing.length - OLD_DOCS_NAMES),
              definite,
            },
          }),
      ...(uncertain.length === 0 ? {} : { uncertainFields: uncertain }),
      next: await nextStep(ctx, id, facts, resolver),
    };
    // a reading for the panel stays a pure read: it writes nothing to the state
    const update =
      args.format === 'data' || args.from_panel === true
        ? undefined
        : mergeUpdates(
            oldDocsUpdate(ctx.state.process(), old.flows, 'process_get_status', old.partial),
            needsInputUpdate(
              ctx.state.process(),
              needs,
              'process_get_status',
              old.partial ? 'some' : 'all',
            ),
          );
    return { status: 'done', data, ...(update === undefined ? {} : { update }) };
  },
  render(data: StatusData | OperationSnapshot | DryRunData | ResultData | ProgressData, t, args) {
    // The data of a result is only ever asked for as data (`run` refuses the text format).
    if (args.format === 'data' || 'progress' in data || isResultData(data)) {
      return renderDataBlock(data);
    }
    if ('dry_run' in data) return renderRunDryRun(data, t);
    return 'identity' in data ? renderGetStatus(data, t) : renderOperationSnapshot(data, t);
  },
});
