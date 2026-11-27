/**
 * The one function that changes the session state. Pure: no `$`, no clock (the time comes in as
 * an argument), no exception. An input of a shape it does not know returns the same state object.
 */

import { ENDED_PHASES } from '../view/status.js';
import { MAX_ENDED, type ModOperation, type ModState, type Signal, type Step } from './types.js';

/** The step each tool belongs to; a tool outside the table leaves the step alone. */
const TOOL_STEP: Readonly<Record<string, Step>> = {
  project_import_docs: 1,
  project_create: 2,
  project_save_env: 2,
  project_check_env: 2,
  project_analyze_setup: 2,
  project_apply_setup: 2,
  project_connect_telemetry: 2,
  flows_suggest_journeys: 3,
  flows_generate_from_suggestions: 3,
  flows_generate_from_endpoints: 3,
  flows_generate_from_har: 3,
  flows_get: 3,
  flows_import_har: 3,
  scenario_suggest_split: 4,
  scenario_generate: 4,
  data_suggest_actions: 5,
  data_check_readiness: 5,
  data_set_bindings: 5,
  data_create_dataset: 5,
  data_create_accounts: 5,
  scenario_check_self: 5,
  run_start: 6,
  results_get_report: 7,
  results_analyze_run: 8,
};

/** The step of the report: the only one whose tick the mod keeps against a status. */
const REPORT_STEP: Step = 7;

/** The step `next.hint` of `process_get_status` points at. */
const HINT_STEP: Readonly<Record<string, Step>> = {
  unbound: 2,
  setup_incomplete: 2,
  analysis_done: 2,
  no_flows: 3,
  no_compositions: 4,
  needs_data: 5,
  no_runs: 6,
  no_analysis: 7,
  passed_no_diagnosis: 7,
  all_done: 8,
};

/** Tools that end the operation they are called about, when their result names no new one. */
const ENDS_OPERATION: ReadonlySet<string> = new Set(['results_get_report', 'process_cancel']);

type Dict = Readonly<Record<string, unknown>>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function before(step: number): number[] {
  return Array.from({ length: Math.max(0, step - 1) }, (_, index) => index + 1);
}

function union(left: readonly number[], right: readonly number[]): number[] {
  return [...new Set([...left, ...right])].sort((a, b) => a - b);
}

/** The steps of the tools a status names as not owed (`next.skipped`), ascending. */
function skippedSteps(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const steps = value.flatMap((tool) => {
    const step = typeof tool === 'string' ? TOOL_STEP[tool] : undefined;
    return step === undefined ? [] : [step];
  });
  return union([], steps);
}

function touch(state: ModState, change: Partial<ModState>, now: number): ModState {
  return { ...state, ...change, updatedAt: now, isStale: false };
}

function withoutOperation(state: ModState): ModState {
  const { operation: _operation, ...rest } = state;
  return rest;
}

function withOperation(state: ModState, operation: ModOperation | undefined): ModState {
  return operation === undefined ? withoutOperation(state) : { ...state, operation };
}

/** The handle is over: it is remembered (the newest `MAX_ENDED`) and, if it is the operation, dropped. */
function withEnded(state: ModState, handle: string): ModState {
  const ended = state.ended.includes(handle)
    ? state.ended
    : [...state.ended, handle].slice(-MAX_ENDED);
  const base = state.operation?.handle === handle ? withoutOperation(state) : state;
  return ended === state.ended ? base : { ...base, ended };
}

function kindOf(handle: string): string {
  return handle.slice(0, handle.indexOf(':'));
}

function reduceTool(
  state: ModState,
  signal: Extract<Signal, { kind: 'tool' }>,
  now: number,
): ModState {
  // A failed call says nothing about where the user is.
  if (signal.errorCode !== undefined) return state;
  const step = TOOL_STEP[signal.tool];
  let next = state;
  if (step !== undefined) {
    // The report read is the end of step 7: the tick is its own, not the later step's.
    const reached = signal.tool === 'results_get_report' ? [...before(step), step] : before(step);
    next = { ...next, step, done: union(next.done, reached) };
    // A new test takes back what followed the last one (the report, the diagnosis); a diagnosis
    // the user asked for is no longer skipped.
    if (signal.tool === 'run_start') {
      next = { ...next, done: next.done.filter((done) => done < step), skipped: [] };
    } else if (signal.tool === 'results_analyze_run') {
      next = { ...next, skipped: [] };
    }
  } else if (signal.tool === 'process_get_status' && state.step === 0) {
    next = { ...next, step: 2, done: union(next.done, before(2)) };
  }
  // A handle in the text of a tool that ends an operation (a report names the run it describes)
  // is not an operation in progress.
  if (ENDS_OPERATION.has(signal.tool)) {
    next = withoutOperation(next);
  } else if (
    signal.handle !== undefined &&
    signal.handle.includes(':') &&
    !state.ended.includes(signal.handle)
  ) {
    const current = next.operation;
    next = withOperation(
      next,
      current?.handle === signal.handle
        ? current
        : {
            handle: signal.handle,
            kind: kindOf(signal.handle),
            tool: signal.tool,
            startedAt: now,
          },
    );
  }
  return next === state ? state : touch(next, {}, now);
}

function reduceStatus(
  state: ModState,
  data: unknown,
  now: number,
  prefer: string | undefined,
): ModState {
  if (!isDict(data) || !isDict(data['identity']) || !isDict(data['next'])) return state;
  const step = HINT_STEP[text(data['next']['hint']) ?? ''];
  if (step === undefined || !Array.isArray(data['environments'])) return state;

  const project = isDict(data['project']) ? data['project'] : undefined;
  const projectName = text(project?.['name']);
  const projectId = text(project?.['id']);
  const active = data['environments'].find(
    (item): item is Dict => isDict(item) && item['active'] === true,
  );
  const environmentName = text(active?.['name']);
  const operations = Array.isArray(data['operations']) ? data['operations'] : [];
  // An operation the mod knows is over stays out, whatever the list still says.
  const open = operations.filter(
    (item): item is Dict =>
      isDict(item) &&
      text(item['handle']) !== undefined &&
      !state.ended.includes(text(item['handle']) ?? ''),
  );
  // Several can be listed (an old one that never ended, next to the test that runs): the one
  // already followed stays, else one of the kind a waiting call is about, else the oldest.
  const first =
    open.find((item) => text(item['handle']) === state.operation?.handle) ??
    (prefer === undefined ? undefined : open.find((item) => text(item['kind']) === prefer)) ??
    open[0];
  const handle = text(first?.['handle']);
  const runs = Array.isArray(data['recentRuns']) ? data['recentRuns'] : [];
  const newest = runs.find(
    (item): item is Dict => isDict(item) && text(item['handle']) !== undefined,
  );
  const lastExecution = text(newest?.['handle']);

  const skipped = skippedSteps(data['next']['skipped']);
  const { project: _project, environment: _environment, lastExecution: _last, ...rest } = state;
  let operation: ModOperation | undefined;
  if (handle !== undefined) {
    const started = Date.parse(text(first?.['startedAt']) ?? '');
    operation =
      state.operation?.handle === handle
        ? state.operation
        : {
            handle,
            kind: text(first?.['kind']) ?? kindOf(handle),
            tool: '',
            startedAt: Number.isFinite(started) ? started : now,
          };
  }
  return withOperation(
    touch(
      {
        ...rest,
        ...(projectName !== undefined && projectId !== undefined
          ? { project: { name: projectName, id: projectId } }
          : {}),
        ...(environmentName !== undefined
          ? { environment: { name: environmentName, protected: active?.['protected'] === true } }
          : {}),
        ...(lastExecution === undefined ? {} : { lastExecution }),
      },
      // The server's word is the step the session is at; what the mod already ticked before it
      // stays, and what lies at or above it is not done. Step 7 is the exception: the server cannot
      // tell whether the report was read, so a tick the mod put there stays (a status read must
      // not undo the report).
      {
        step,
        done: union(
          state.done.filter((done) => done < step || (step === REPORT_STEP && done === step)),
          before(step),
        ),
        skipped,
      },
      now,
    ),
    operation,
  );
}

function reduceOperation(state: ModState, data: unknown, now: number): ModState {
  if (!isDict(data)) return state;
  const handle = text(data['operation']);
  const elapsed = data['elapsed_s'];
  if (handle === undefined || !handle.includes(':') || typeof elapsed !== 'number') return state;
  const current = state.operation;
  // An operation that is over is no longer in progress, and never is again.
  if (ENDED_PHASES.has(text(data['phase']) ?? '')) {
    const over = withEnded(state, handle);
    return over === state ? state : touch(over, {}, now);
  }
  if (state.ended.includes(handle)) return state;
  return touch(
    {
      ...state,
      operation: {
        handle,
        kind: text(data['kind']) ?? kindOf(handle),
        tool: current?.handle === handle ? current.tool : '',
        startedAt: Math.round(now - Math.max(0, elapsed) * 1000),
      },
    },
    {},
    now,
  );
}

/** The same facts, whatever the time: a reading that learned nothing new changes nothing. */
function unchanged(before: ModState, after: ModState): boolean {
  const { updatedAt: _before, ...left } = before;
  const { updatedAt: _after, ...right } = after;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A state written by an older version of the mod has no `ended` or `skipped` (or a value that is
 * not a list of handles or of steps): it counts as empty. The same state object comes back when
 * it is fine.
 */
function normalize(state: ModState): ModState {
  const { ended, skipped } = state as { ended?: unknown; skipped?: unknown };
  const endedOk = Array.isArray(ended) && ended.every((item) => typeof item === 'string');
  const skippedOk = Array.isArray(skipped) && skipped.every((item) => typeof item === 'number');
  return endedOk && skippedOk
    ? state
    : { ...state, ...(endedOk ? {} : { ended: [] }), ...(skippedOk ? {} : { skipped: [] }) };
}

export function reduce(state: ModState, signal: Signal, now: number): ModState {
  const base = normalize(state);
  const next = apply(base, signal, now);
  return next === base || unchanged(base, next) ? state : next;
}

function apply(state: ModState, signal: Signal, now: number): ModState {
  if (!isDict(signal)) return state;
  switch (signal.kind) {
    case 'tool':
      return typeof signal.tool === 'string' ? reduceTool(state, signal, now) : state;
    case 'status':
      return reduceStatus(state, signal.data, now, signal.prefer);
    case 'operation':
      return reduceOperation(state, signal.data, now);
    case 'lost': {
      if (typeof signal.handle !== 'string' || !signal.handle.includes(':')) return state;
      const over = withEnded(state, signal.handle);
      return over === state ? state : touch(over, {}, now);
    }
    default:
      return state;
  }
}
