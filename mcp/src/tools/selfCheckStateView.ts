// The self-check view a client beside the chat reads from the workspace state (the `selfCheckViews` section):
// one entry per check, the plan steps, the result of every step in every run, the repair rounds and the
// failure, in the shape the state schema of the tool catalog defines. A key the schema does not have is never
// written; a part the schema cannot hold (a run beyond the limit, a step past the cap) is counted in
// `moreSteps` or left out, never cut in the middle.

import type { ToolContext } from '../context.js';
import { inline } from '../render/primitives.js';
import type { CheckRunStepView, ScenarioCheck } from '../render/views/selfCheckChain.js';
import { isoOf } from '../workspace/migrate.js';

/** The limits of the section, as the state schema states them. */
export const VIEW_LIMITS = {
  scenarios: 20,
  steps: 60,
  stepsTotal: 400,
  runs: 4,
  repairs: 4,
  viewBytes: 96 * 1024,
} as const;

/** What leaves a margin under the byte limit of one view, so a later pass of the state writer still fits. */
const BYTE_BUDGET = Math.floor(VIEW_LIMITS.viewBytes * 0.9);

type StepResult = 'ok' | 'failed' | 'skipped';

interface PlanStep {
  name: string;
  method?: string;
  path?: string;
  result?: StepResult;
  http?: number[];
}

interface RunResult {
  step: number;
  result: StepResult;
  http?: number[];
  reason?: string;
}

interface ViewRun {
  run: number;
  version?: number;
  executionId?: string;
  verdict?: string;
  results: RunResult[];
}

interface ViewRepair {
  round: number;
  outcome: 'repaired' | 'refused';
  text: string;
  version?: number;
  verdict?: string;
  reasonCode?: string;
}

interface ViewScenario {
  id: string;
  name: string;
  status: string;
  phase: string;
  version?: number;
  run: number;
  steps: PlanStep[];
  moreSteps: number;
  failure?: { step?: string; http?: number; message: string };
  runs: ViewRun[];
  repairs: ViewRepair[];
  repairLimit?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface SelfCheckStateView {
  environment?: string;
  scenarios: ViewScenario[];
}

/** One scenario of the check: its id and what the check found. */
export interface CheckedView {
  readonly id: string;
  readonly check: ScenarioCheck;
  readonly version: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /** Runs the backend started for the check (its execution ids), listed with their steps or not yet. */
  readonly started?: number;
}

/** A text fitted to `max` UTF-16 units, on one line, the last character `…` when it was cut. */
function fit(text: string, max: number): string {
  const line = inline(text);
  if (line.length <= max) return line;
  let cut = Array.from(line);
  while (cut.join('').length > max - 1) cut = cut.slice(0, -1);
  return `${cut.join('').trimEnd()}…`;
}

const resultOf = (step: CheckRunStepView): StepResult =>
  step.result === 'not_run' ? 'skipped' : step.result;

const httpOf = (step: CheckRunStepView): { http?: number[] } =>
  step.httpStatus === null ? {} : { http: [step.httpStatus] };

const IN_FLIGHT: readonly string[] = ['pending', 'running', 'repairing'];

/**
 * The steps of the newest run that lists any, one entry per plan step, in plan order (the order a journey
 * runs them; a preflight is left to the step it precedes), the name with its group (`Group / name`, as the
 * failure names it). Each step has the result of that run, unless the check is under way again on a run that has
 * not reported its steps yet (a new run from the first step after a repair): then no step has a result.
 */
function planOf(
  runs: ScenarioCheck['runs'],
  status: string,
): { steps: PlanStep[]; omitted: number } {
  const all = runs ?? [];
  const source = [...all].reverse().find((run) => run.steps.length > 0);
  if (source === undefined) return { steps: [], omitted: 0 };
  const last = all.at(-1);
  const awaiting = IN_FLIGHT.includes(status) && status !== 'repairing';
  // The run whose steps are shown is the one under way, or the check waits on it (repair) or is over.
  const current = source === last && !(awaiting && last.status !== null);
  const worst = worstByStep(source.steps);
  const byIndex = new Map<number, PlanStep>();
  for (const step of source.steps) {
    if (step.isPreflight || step.planIndex === undefined || step.planIndex === null) continue;
    if (byIndex.has(step.planIndex)) continue;
    const name = step.group ? `${step.group} / ${step.name}` : step.name;
    const outcome = worst.get(step.planIndex) ?? step;
    byIndex.set(step.planIndex, {
      name: fit(name, 120),
      ...(step.method == null ? {} : { method: fit(step.method, 10) }),
      ...(step.path == null ? {} : { path: fit(step.path, 200) }),
      ...(current ? { result: resultOf(outcome), ...httpOf(outcome) } : {}),
    });
  }
  const steps = [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, step]) => step);
  return { steps, omitted: source.stepsOmitted };
}

/** How bad a result is: a step made more than once (a loop) shows its worst pass. */
const SEVERITY: Readonly<Record<StepResult, number>> = { ok: 0, skipped: 1, failed: 2 };

/**
 * The run-time entries of each plan step, in the order the run first reached it: a preflight that passed
 * says nothing, one that failed marks the step it precedes, and of several passes of one step (a loop)
 * the worst one stands, with its status and reason.
 */
function worstByStep(steps: readonly CheckRunStepView[]): Map<number, CheckRunStepView> {
  const worst = new Map<number, CheckRunStepView>();
  for (const step of steps) {
    if (step.planIndex === undefined || step.planIndex === null) continue;
    if (step.isPreflight && step.result === 'ok') continue;
    const known = worst.get(step.planIndex);
    if (known === undefined || SEVERITY[resultOf(step)] > SEVERITY[resultOf(known)]) {
      worst.set(step.planIndex, step);
    }
  }
  return worst;
}

function resultsOf(steps: readonly CheckRunStepView[]): RunResult[] {
  return [...worstByStep(steps).entries()].slice(0, VIEW_LIMITS.steps).map(([index, step]) => ({
    step: index,
    result: resultOf(step),
    ...httpOf(step),
    ...(step.reason == null || step.reason === '' ? {} : { reason: fit(step.reason, 120) }),
  }));
}

/** The first run, then the newest ones, when the check ran more than the section holds. */
function keptRuns<T>(runs: readonly T[]): { run: number; item: T }[] {
  const numbered = runs.map((item, index) => ({ run: index + 1, item }));
  if (numbered.length <= VIEW_LIMITS.runs) return numbered;
  return [numbered[0], ...numbered.slice(numbered.length - (VIEW_LIMITS.runs - 1))].flatMap(
    (entry) => (entry === undefined ? [] : [entry]),
  );
}

function runsOf(check: ScenarioCheck): ViewRun[] {
  return keptRuns(check.runs ?? []).map(({ run, item }) => ({
    run,
    ...(item.version === null ? {} : { version: item.version }),
    ...(item.executionId === undefined ? {} : { executionId: fit(item.executionId, 64) }),
    ...(item.status === null ? {} : { verdict: fit(item.status, 40) }),
    results: resultsOf(item.steps),
  }));
}

function repairsOf(check: ScenarioCheck): ViewRepair[] {
  return check.repairs.slice(-VIEW_LIMITS.repairs).map((repair, index, all) => {
    const refusal = repair.refusedMessage ?? repair.refused ?? repair.refusedCode ?? null;
    const round = repair.round ?? check.repairs.length - all.length + index + 1;
    return {
      round: Math.max(1, round),
      outcome: refusal === null ? 'repaired' : 'refused',
      text: fit(refusal ?? repair.changes ?? '', 300),
      ...(repair.version === null ? {} : { version: repair.version }),
      ...(repair.verdict == null ? {} : { verdict: fit(repair.verdict, 40) }),
      ...(repair.refusedCode == null ? {} : { reasonCode: fit(repair.refusedCode, 40) }),
    };
  });
}

function phaseOf(status: string): 'queued' | 'running' | 'repairing' | 'finished' {
  if (status === 'pending') return 'queued';
  return status === 'running' || status === 'repairing' ? status : 'finished';
}

function scenarioOf(item: CheckedView, stepCap: number): ViewScenario {
  const { check } = item;
  const plan = planOf(check.runs, check.status);
  const failure = check.failure;
  // The failing step as the plan names it, with its group: the console name the check gives is the same text.
  const failedStep = (check.runs ?? [])
    .at(-1)
    ?.steps.find((step) => step.result === 'failed' && step.reason != null);
  const failedName =
    failedStep === undefined
      ? failure?.request
      : failedStep.group
        ? `${failedStep.group} / ${failedStep.name}`
        : failedStep.name;
  const phase = phaseOf(check.status);
  const started = item.startedAt === null ? undefined : isoOf(Date.parse(item.startedAt));
  const finished = item.finishedAt === null ? undefined : isoOf(Date.parse(item.finishedAt));
  return {
    id: fit(item.id, 64),
    name: fit(check.name, 120),
    status: fit(check.status, 40),
    phase,
    ...(item.version === null ? {} : { version: item.version }),
    run: Math.max((check.runs ?? []).length, item.started ?? 0),
    steps: plan.steps.slice(0, stepCap),
    moreSteps: plan.omitted + Math.max(0, plan.steps.length - stepCap),
    ...(failure === null
      ? {}
      : {
          failure: {
            ...(failedName == null ? {} : { step: fit(failedName, 120) }),
            ...(failure.httpStatus == null ? {} : { http: failure.httpStatus }),
            message: fit(failure.message ?? '', 300),
          },
        }),
    runs: runsOf(check),
    repairs: repairsOf(check),
    ...(check.maxRepairRounds == null
      ? {}
      : { repairLimit: Math.min(10, Math.max(1, check.maxRepairRounds)) }),
    ...(started === undefined ? {} : { startedAt: started }),
    ...(finished === undefined ? {} : { finishedAt: finished }),
  };
}

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The view of a finished or running check as the state section holds it. The plan steps of all scenarios
 * share the section's total (400), the runs of a scenario that passed are the first to go when the view is
 * larger than the section's byte limit, then the results of every run but the last, then all the runs.
 */
export function buildSelfCheckView(
  environment: string | null,
  scenarios: readonly CheckedView[],
): SelfCheckStateView {
  const shown = scenarios.slice(0, VIEW_LIMITS.scenarios);
  const cap = Math.max(
    1,
    Math.min(VIEW_LIMITS.steps, Math.floor(VIEW_LIMITS.stepsTotal / Math.max(1, shown.length))),
  );
  let view: SelfCheckStateView = {
    ...(environment === null ? {} : { environment: fit(environment, 120) }),
    scenarios: shown.map((item) => scenarioOf(item, cap)),
  };
  const passed = (scenario: ViewScenario): boolean =>
    scenario.status === 'passed' || scenario.status === 'passed_after_repair';
  const squeeze: ((scenario: ViewScenario) => ViewScenario)[] = [
    (scenario) => (passed(scenario) ? { ...scenario, runs: [] } : scenario),
    (scenario) => ({
      ...scenario,
      runs: scenario.runs.map((run, index, all) =>
        index === all.length - 1 ? run : { ...run, results: [] },
      ),
    }),
    (scenario) => ({ ...scenario, runs: [] }),
  ];
  for (const step of squeeze) {
    if (bytes(view) <= BYTE_BUDGET) break;
    view = { ...view, scenarios: view.scenarios.map(step) };
  }
  return view;
}

/** How a view is written: while the check runs, only when it changed and without waiting on the file. */
export interface ViewWrite {
  /** Leaves the file alone when it holds this view already under `key`. */
  readonly onlyChanged?: boolean;
  /** Waits briefly for the file lock and gives up (a later change writes again). */
  readonly quick?: boolean;
}

/**
 * Writes the view under `key` (the id of the operation, or of the call). A failed write is not a failed
 * check: the view is a convenience of a client beside the chat, and the result of the tool says the
 * same; it is logged as a warning. A secret the backend repeated is masked first, so the state never
 * holds one.
 */
export async function writeSelfCheckView(
  ctx: Pick<ToolContext, 'state' | 'secrets' | 'log'>,
  key: string,
  view: SelfCheckStateView,
  how: ViewWrite = {},
): Promise<void> {
  try {
    const masked = ctx.secrets.scrubDeep(view);
    if (how.onlyChanged === true) {
      const stored = ctx.state.get('selfCheckViews', key)?.value;
      if (stored !== undefined && JSON.stringify(stored) === JSON.stringify(masked)) return;
    }
    await ctx.state.set('selfCheckViews', key, masked, how.quick === true ? { quick: true } : {});
  } catch (error) {
    // The state file may be locked or full; the check result is already in the answer.
    ctx.log.warn('self-check view not written', { key, error });
  }
}
