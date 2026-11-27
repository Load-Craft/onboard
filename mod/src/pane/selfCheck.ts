/**
 * The self-check of the Run tab: the view the server writes to its state file while a check runs, as
 * `process_get_status` with `progress` hands it out (the read of the bars, which asks the backend nothing),
 * the state each scenario is in, and the card of a failure. Pure: no `$`, no clock (the time comes in), no
 * exception. The card of a failure is made from it in card/make.ts.
 *
 * Every text of the view is the backend's, masked by the server, and comes from the tested system: a
 * name of a step, a path, a reason. It is kept as text only, cut to one clean line (`inline`), and never
 * goes into a message to Claude (the question about a step names a run handle and a number).
 */

import { inline } from '../../../mcp/src/render/primitives.js';
import { finite, isDict, list, str, type Dict } from '../view/tree.js';

/** Limits of the state section the view comes from (the schema of the tool catalog). */
const MAX_SCENARIOS = 20;
const MAX_STEPS = 60;
const MAX_RUNS = 4;
const MAX_REPAIRS = 4;
const NAME = 120;
const PATH = 200;
const REASON = 300;
const SHORT = 40;

export type StepResult = 'ok' | 'failed' | 'skipped';

export interface CheckStepFact {
  readonly name: string;
  readonly method?: string;
  readonly path?: string;
  /** Of the run under way or last; absent: not reached, or a new run has not reported it yet. */
  readonly result?: StepResult;
  readonly http?: number;
}

export interface CheckResultFact {
  /** The index of the step in the plan of the version run (from 0). */
  readonly step: number;
  readonly result: StepResult;
  readonly http?: number;
  readonly reason?: string;
}

export interface CheckRunFact {
  readonly run: number;
  readonly version?: number;
  /** `e-` and 8 characters, what the result tools take; absent when the view names no run. */
  readonly handle?: string;
  readonly verdict?: string;
  readonly results: readonly CheckResultFact[];
}

export interface CheckRepairFact {
  readonly round: number;
  readonly outcome: 'repaired' | 'refused';
  readonly text: string;
  readonly version?: number;
}

export interface ScenarioCheckFact {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly version?: number;
  /** The number of the run under way or last (0: none started). */
  readonly run: number;
  readonly steps: readonly CheckStepFact[];
  readonly moreSteps: number;
  readonly failure?: { readonly step?: string; readonly http?: number; readonly message: string };
  readonly runs: readonly CheckRunFact[];
  readonly repairs: readonly CheckRepairFact[];
  readonly repairLimit: number;
}

/** The newest view the server wrote: its key (the operation or the call) and when it was written. */
export interface SelfCheckFacts {
  readonly key: string;
  readonly savedAt: string;
  readonly environment?: string;
  readonly scenarios: readonly ScenarioCheckFact[];
}

const IN_FLIGHT: readonly string[] = ['pending', 'running', 'repairing'];
const RESULTS: readonly string[] = ['ok', 'failed', 'skipped'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const isInFlight = (status: string): boolean => IN_FLIGHT.includes(status);

const line = (value: unknown, limit: number): string | undefined => {
  const text = str(value);
  if (text === undefined) return undefined;
  const clean = inline(text, limit);
  return clean === '' ? undefined : clean;
};

const whole = (value: unknown, min: number, max: number): number | undefined => {
  const n = finite(value);
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

const resultOf = (value: unknown): StepResult | undefined =>
  typeof value === 'string' && RESULTS.includes(value) ? (value as StepResult) : undefined;

/** The first HTTP status of a list of them, as the view keeps them. */
const httpOf = (value: unknown): number | undefined => whole(list(value)[0], 100, 599);

function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function stepOf(item: Dict): CheckStepFact | undefined {
  const name = line(item['name'], NAME);
  if (name === undefined) return undefined;
  return {
    name,
    ...opt('method', line(item['method'], 10)),
    ...opt('path', line(item['path'], PATH)),
    ...opt('result', resultOf(item['result'])),
    ...opt('http', httpOf(item['http'])),
  };
}

function runOf(item: Dict): CheckRunFact | undefined {
  const number = whole(item['run'], 1, 99);
  if (number === undefined) return undefined;
  const id = str(item['executionId']);
  const results = list(item['results'])
    .flatMap((entry): CheckResultFact[] => {
      if (!isDict(entry)) return [];
      const step = whole(entry['step'], 0, 9999);
      const result = resultOf(entry['result']);
      if (step === undefined || result === undefined) return [];
      return [
        {
          step,
          result,
          ...opt('http', httpOf(entry['http'])),
          ...opt('reason', line(entry['reason'], REASON)),
        },
      ];
    })
    .slice(0, MAX_STEPS);
  return {
    run: number,
    ...opt('version', whole(item['version'], 1, 1_000_000)),
    ...opt(
      'handle',
      id !== undefined && UUID.test(id) ? `e-${id.slice(0, 8).toLowerCase()}` : undefined,
    ),
    ...opt('verdict', line(item['verdict'], SHORT)),
    results,
  };
}

function repairOf(item: Dict): CheckRepairFact | undefined {
  const round = whole(item['round'], 1, 99);
  const outcome = item['outcome'];
  if (round === undefined || (outcome !== 'repaired' && outcome !== 'refused')) return undefined;
  return {
    round,
    outcome,
    text: line(item['text'], REASON) ?? '',
    ...opt('version', whole(item['version'], 1, 1_000_000)),
  };
}

function failureOf(value: unknown): ScenarioCheckFact['failure'] {
  if (!isDict(value)) return undefined;
  return {
    message: line(value['message'], REASON) ?? '',
    ...opt('step', line(value['step'], NAME)),
    ...opt('http', whole(value['http'], 100, 599)),
  };
}

const each = <T>(value: unknown, read: (item: Dict) => T | undefined, max: number): T[] =>
  list(value)
    .flatMap((item) => {
      const read_ = isDict(item) ? read(item) : undefined;
      return read_ === undefined ? [] : [read_];
    })
    .slice(0, max);

function scenarioOf(item: Dict): ScenarioCheckFact | undefined {
  const id = line(item['id'], 64);
  const name = line(item['name'], NAME);
  const status = line(item['status'], SHORT);
  if (id === undefined || name === undefined || status === undefined) return undefined;
  const failure = failureOf(item['failure']);
  return {
    id,
    name,
    status,
    ...opt('version', whole(item['version'], 1, 1_000_000)),
    run: whole(item['run'], 0, 99) ?? 0,
    steps: each(item['steps'], stepOf, MAX_STEPS),
    moreSteps: whole(item['moreSteps'], 0, 1_000_000) ?? 0,
    ...(failure === undefined ? {} : { failure }),
    runs: each(item['runs'], runOf, MAX_RUNS),
    repairs: each(item['repairs'], repairOf, MAX_REPAIRS),
    repairLimit: whole(item['repairLimit'], 1, 10) ?? 2,
  };
}

/**
 * The self-check view of a `process_get_status` answer with `progress`, or `undefined` when it has none
 * (no check wrote one lately) or one of a shape the mod does not know.
 */
export function parseSelfCheck(data: unknown): SelfCheckFacts | undefined {
  if (!isDict(data) || !isDict(data['selfCheck'])) return undefined;
  const view = data['selfCheck'];
  const key = line(view['key'], 160);
  const savedAt = line(view['savedAt'], SHORT);
  if (key === undefined || savedAt === undefined || !Array.isArray(view['scenarios'])) {
    return undefined;
  }
  return {
    key,
    savedAt,
    ...opt('environment', line(view['environment'], NAME)),
    scenarios: each(view['scenarios'], scenarioOf, MAX_SCENARIOS),
  };
}

/**
 * The panel after a read of the bars or of the operation: a newer view replaces the one it has (an older
 * or the same view of the same check leaves the panel as it was), `'failed'` keeps the last view and says the read failed, `undefined` (an answer with no
 * view) leaves everything as it was.
 */
/** `panel` without its field `key`. */
const without = <P extends object>(panel: P, key: string): P =>
  Object.fromEntries(Object.entries(panel).filter(([name]) => name !== key)) as P;

export function withSelfCheck<
  P extends { readonly selfCheck?: SelfCheckFacts; readonly selfCheckFailed?: true },
>(panel: P, read: SelfCheckFacts | 'failed' | undefined): P {
  if (read === undefined) {
    return panel.selfCheckFailed === undefined ? panel : without(panel, 'selfCheckFailed');
  }
  if (read === 'failed') {
    return panel.selfCheckFailed === true ? panel : { ...panel, selfCheckFailed: true };
  }
  const known = panel.selfCheck;
  // The state file and a snapshot of the operation both bring the view: an older one of the same check
  // never replaces a newer one, and the same view read again changes nothing.
  const stale =
    known !== undefined &&
    known.key === read.key &&
    (read.savedAt < known.savedAt ||
      JSON.stringify({ ...known, savedAt: '' }) === JSON.stringify({ ...read, savedAt: '' }));
  if (stale) return panel.selfCheckFailed === undefined ? panel : without(panel, 'selfCheckFailed');
  return without({ ...panel, selfCheck: read }, 'selfCheckFailed');
}

// ---- where a scenario stands ------------------------------------------------------------------------

/** The run the steps of the view belong to; undefined while a new run from step 1 has not reported. */
export function currentRun(scenario: ScenarioCheckFact): CheckRunFact | undefined {
  const last = scenario.runs.at(-1);
  if (last === undefined) return undefined;
  if (scenario.steps.some((item) => item.result !== undefined)) return last;
  if (!isInFlight(scenario.status) || scenario.status === 'repairing') return last;
  return last.verdict === undefined ? last : undefined;
}

/** The runs before the one under way, oldest first: each one line of the history. */
export function earlierRuns(scenario: ScenarioCheckFact): CheckRunFact[] {
  const current = currentRun(scenario);
  return scenario.runs.filter((item) => item !== current);
}

/** The number (from 1) of the step that failed, and its status, as far as the view tells them. */
export function failedStep(scenario: ScenarioCheckFact): { step?: number; http?: number } {
  const at = scenario.steps.findIndex((item) => item.result === 'failed');
  const named =
    at >= 0 ? at : scenario.steps.findIndex((item) => item.name === scenario.failure?.step);
  const http = (at >= 0 ? scenario.steps[at]?.http : undefined) ?? scenario.failure?.http;
  return { ...opt('step', named >= 0 ? named + 1 : undefined), ...opt('http', http) };
}

/** Which sentence the head of a scenario says, with its values; the tone gives its color. */
export interface CheckState {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly tone?: 'success' | 'error' | 'warning';
}

const ENDS: readonly string[] = [
  'waiting_for_data',
  'target_unreachable',
  'not_admitted',
  'goal_step_missing',
  'skipped_protected_environment',
  'disabled',
];

const httpText = (http: number | undefined): string =>
  http === undefined ? '' : ` (${String(http)})`;

export function checkState(scenario: ScenarioCheckFact): CheckState {
  const { status, repairs } = scenario;
  const last = repairs.at(-1);
  const failed = failedStep(scenario);
  const step = failed.step ?? '?';
  const version = scenario.version ?? 1;
  switch (status) {
    case 'pending':
      return last?.outcome === 'repaired' && scenario.run > 0
        ? { key: 'pane.check.state.retryQueued', params: { version: last.version ?? version } }
        : { key: 'pane.check.state.queued', params: {} };
    case 'running':
      return scenario.run > 1
        ? { key: 'pane.check.state.retry', params: { run: scenario.run, version } }
        : { key: 'pane.check.state.running', params: {} };
    case 'repairing':
      return {
        key: 'pane.check.state.repairing',
        params: {
          step,
          http: httpText(failed.http),
          round: repairs.length + 1,
          limit: scenario.repairLimit,
        },
        tone: 'warning',
      };
    case 'passed':
      return { key: 'pane.check.state.passed', params: {}, tone: 'success' };
    case 'passed_after_repair':
      return { key: 'pane.check.state.passedAfterRepair', params: {}, tone: 'success' };
    case 'failed':
      if (last?.outcome === 'refused') {
        return { key: 'pane.check.state.refused', params: { reason: last.text }, tone: 'error' };
      }
      return repairs.length > 0
        ? {
            key: 'pane.check.state.failedAfterRepair',
            params: { rounds: repairs.length },
            tone: 'error',
          }
        : {
            key: 'pane.check.state.failedStep',
            params: { step, http: httpText(failed.http) },
            tone: 'error',
          };
    case 'interrupted':
      return { key: 'pane.check.state.interrupted', params: {}, tone: 'error' };
    default:
      return ENDS.includes(status)
        ? {
            key: `pane.check.state.${status}`,
            params: {},
            tone: status === 'waiting_for_data' ? 'warning' : 'error',
          }
        : { key: 'pane.check.state.ended', params: { status } };
  }
}

// ---- the lists of the Run tab ----------------------------------------------------------------------

/** The id of the list of the scenario at `index` (one list per scenario, the same component). */
export const checkListId = (index: number): string => `check-${String(index)}`;
/** Whether a list id is one of the self-check (`check-0` … `check-19`). */
export const isCheckList = (id: string): boolean => /^check-(?:\d|1\d)$/u.test(id);

/** The key of a step of the run under way (`c<n>`) or of an earlier run (`r<run>-<n>`); `n` from 0. */
export const currentKey = (at: number): string => `c${String(at)}`;
export const earlierKey = (run: number, at: number): string => `r${String(run)}-${String(at)}`;
export const groupKey = (run: number): string => `r${String(run)}`;

/** The results of a run in plan order, matched to the steps of the view by place when both have as many. */
export function runResults(
  scenario: ScenarioCheckFact,
  item: CheckRunFact,
): readonly (CheckResultFact | undefined)[] {
  const sorted = [...item.results].sort((a, b) => a.step - b.step);
  return sorted.length === scenario.steps.length
    ? sorted
    : scenario.steps.map((_, at) => sorted.find((result) => result.step === at));
}

/** The keys of the entries of the list of the scenario at `index`, in the order the list draws them. */
export function checkEntryKeys(facts: SelfCheckFacts | undefined, index: number): string[] {
  const scenario = facts?.scenarios[index];
  if (scenario === undefined) return [];
  return [
    ...scenario.steps.map((_, at) => currentKey(at)),
    ...earlierRuns(scenario).flatMap((item) =>
      scenario.steps.map((_, at) => earlierKey(item.run, at)),
    ),
  ];
}
