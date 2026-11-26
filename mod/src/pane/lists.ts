/**
 * The three lists the panel reads from the status channel (`process_get_status` with `format: "data"`,
 * read-only): the flows of the project and the steps of a flow (Project tab), the test runs (Results
 * tab). Pure functions of the data and of the stored panel, with no `$`, no clock and no exception.
 *
 * - What is read: the first 20 flows (`detail: flows`), the first 20 runs (`detail: runs`), the outline
 *   of one flow (`result: { kind: flow }`, whose id is the flow's name). Every text is bounded and passes
 *   `inline`; nothing is unmasked here, the server masks secrets before the data leaves it.
 * - When it is read (`wantedReads`): a list is read for a state of the project (its `stamp`) and again
 *   when the state moves; a read that failed is not repeated for the same state.
 * - A mark is bound to the key of the entry (the name of a flow, the handle of a run), never to its
 *   place, and a new reading drops the marks of what is gone.
 */

import { inline } from '../../../mcp/src/render/primitives.js';
import { MAX_SCENARIO_FLOWS } from '../../../mcp/src/tools/scenario/limits.js';
import { addedMarks, toggledMarks } from '../view/list.js';
import { finite, isDict, list, str } from '../view/tree.js';
import {
  listView,
  type FlowFact,
  type Loaded,
  type OutlineFacts,
  type PaneTab,
  type PanelData,
  type ProjectFacts,
  type RunRow,
  type StepFact,
} from './tabs.js';

/** The ids of the lists: the prefix of their element keys (`flow-0`, `run-open-1`, `step-back`). */
export const FLOW_LIST = 'flow';
export const RUN_LIST = 'run';
export const STEP_LIST = 'step';

/** Flows marked at most: what one `scenario_suggest_split` call takes. */
export const MAX_MARKED_FLOWS = MAX_SCENARIO_FLOWS;
/** A comparison is of two runs. */
export const MAX_MARKED_RUNS = 2;

/** Steps the panel keeps of a flow (the status gives at most as many). */
const MAX_STEPS = 150;
const MAX_ITEMS = 20;
const NAME_LIMIT = 200;
const TARGET_LIMIT = 80;
const STEP_NAME_LIMIT = 120;
const PATH_LIMIT = 200;
const VARIABLES = 20;
const VARIABLE_LIMIT = 80;

/**
 * A flow name the conversation can carry: one short line of letters, numbers and a few marks of a name.
 * No quote, backtick, brace, angle bracket or control character, so the name stays a name inside the
 * list the message sends. Another name is shown, and is not marked.
 */
const SAFE_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} _.:/()+,#&'-]{0,79}$/u;
/** The handle of a run, as `results_get_report` takes it. */
const RUN_HANDLE = /^e-[0-9a-f]{8}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/u;

const count = (value: unknown): number => {
  const n = finite(value);
  return n === undefined ? 0 : Math.max(0, Math.round(n));
};

/** Whether a handle is one of a run (the only shape the message of a comparison carries). */
export const isRunHandle = (value: string): boolean => RUN_HANDLE.test(value);

/** Whether a flow name can go into a message to the agent exactly as it is. */
export const isSafeFlowName = (value: string): boolean => SAFE_NAME.test(value);

// ---- the stamps: which state of the project a reading was made for -------------------------------

/**
 * The state of the project the list of flows depends on: how many flows, which are on older docs, and
 * the time of the status reading, so that a renamed flow or a changed number of steps (which the
 * counts do not show) is read again with the next status.
 */
export function flowsStamp(project: ProjectFacts | undefined): string {
  return JSON.stringify([project?.counts.flows ?? 0, project?.oldDocs ?? [], project?.asOf ?? '']);
}

/** The state of the project the list of runs depends on: the newest runs and their verdicts. */
export function runsStamp(project: ProjectFacts | undefined): string {
  return JSON.stringify((project?.runs ?? []).map((run) => [run.handle, run.verdict ?? '']));
}

// ---- what is read of the data --------------------------------------------------------------------

/** The flows of `process_get_status` with `detail: flows`; `undefined` for any other data. */
export function flowsLoaded(
  data: unknown,
  project: ProjectFacts | undefined,
): Loaded<FlowFact> | undefined {
  if (!isDict(data) || !isDict(data['section']) || data['section']['kind'] !== 'flows') {
    return undefined;
  }
  const section = data['section'];
  const old = new Set(project?.oldDocs ?? []);
  const seen = new Set<string>();
  const items = list(section['items']).flatMap((item): FlowFact[] => {
    if (!isDict(item)) return [];
    const raw = str(item['name']);
    if (raw === undefined || raw === '') return [];
    const name = inline(raw, NAME_LIMIT);
    if (name === '' || seen.has(name)) return [];
    seen.add(name);
    return [
      {
        name,
        steps: count(item['steps']),
        oldDocs: old.has(name),
        // A name that had to be cut or flattened to be drawn is not the name the server knows.
        ...(name === raw ? {} : { odd: true as const }),
      },
    ];
  });
  return {
    stamp: flowsStamp(project),
    items: items.slice(0, MAX_ITEMS),
    more: count(section['more']),
  };
}

/** The runs of `process_get_status` with `detail: runs`; `undefined` for data without runs. */
export function runsLoaded(
  data: unknown,
  project: ProjectFacts | undefined,
): Loaded<RunRow> | undefined {
  if (!isDict(data) || !Array.isArray(data['recentRuns'])) return undefined;
  const seen = new Set<string>();
  const items = list(data['recentRuns']).flatMap((item): RunRow[] => {
    if (!isDict(item)) return [];
    const handle = str(item['handle']);
    if (handle === undefined || !RUN_HANDLE.test(handle) || seen.has(handle)) return [];
    seen.add(handle);
    const verdict = isDict(item['verdict']) ? str(item['verdict']['state']) : str(item['verdict']);
    const when = str(item['when']);
    return [
      {
        handle,
        target: inline(str(item['target']) ?? '', TARGET_LIMIT),
        ...(verdict === undefined || inline(verdict) === ''
          ? {}
          : { verdict: inline(verdict, 40) }),
        ...(when !== undefined && ISO_TIME.test(when) ? { when } : {}),
      },
    ];
  });
  return {
    stamp: runsStamp(project),
    items: items.slice(0, MAX_ITEMS),
    more: count(data['moreRuns']),
  };
}

const names = (value: unknown): string[] =>
  list(value)
    .flatMap((item) =>
      typeof item === 'string' && inline(item) !== '' ? [inline(item, VARIABLE_LIMIT)] : [],
    )
    .slice(0, VARIABLES);

function stepOf(item: unknown): StepFact | undefined {
  if (!isDict(item)) return undefined;
  const num = str(item['num']);
  if (num === undefined || inline(num, 16) === '') return undefined;
  const kind = item['kind'] === 'request' || item['kind'] === 'pause' ? item['kind'] : 'other';
  const method = str(item['method']);
  const path = str(item['path']);
  const description = str(item['description']);
  return {
    num: inline(num, 16),
    kind,
    name: inline(str(item['name']) ?? '', STEP_NAME_LIMIT),
    ...(method === undefined || inline(method) === '' ? {} : { method: inline(method, 16) }),
    ...(path === undefined || inline(path) === '' ? {} : { path: inline(path, PATH_LIMIT) }),
    ...(description === undefined || inline(description) === ''
      ? {}
      : { description: inline(description, PATH_LIMIT) }),
    uses: names(item['uses']),
    produces: names(item['produces']),
    feeder: names(item['feederVars']),
    statuses: list(item['expectedStatuses'])
      .flatMap((code) => {
        const n = finite(code);
        return n === undefined ? [] : [Math.round(n)];
      })
      .slice(0, VARIABLES),
    validators: names(item['validators']),
  };
}

/** The steps of the data of `process_get_status` with `result: { kind: flow }`, for the flow `flow`. */
export function outlineLoaded(data: unknown, flow: string): OutlineFacts | undefined {
  if (!isDict(data) || !isDict(data['outline']) || !Array.isArray(data['outline']['steps'])) {
    return undefined;
  }
  const outline = data['outline'];
  const steps = list(outline['steps'])
    .flatMap((item) => {
      const step = stepOf(item);
      return step === undefined ? [] : [step];
    })
    .slice(0, MAX_STEPS);
  const total = Math.max(count(outline['stepCount']), steps.length);
  return { flow, steps, total, truncated: outline['truncated'] === true || total > steps.length };
}

/** The panel without the field `key`. */
function without(panel: PanelData, key: keyof PanelData): PanelData {
  return Object.fromEntries(Object.entries(panel).filter(([name]) => name !== key));
}

// ---- keeping what was read -----------------------------------------------------------------------

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** A flow whose name goes to the agent exactly as the server knows it: marking it is possible. */
export const isMarkableFlow = (flow: FlowFact): boolean =>
  flow.odd !== true && SAFE_NAME.test(flow.name);

/** Whether `key` of the list `id` can be marked (the list holds it and the action can name it). */
function markable(panel: PanelData, id: string, key: string): boolean {
  if (id === FLOW_LIST) {
    const flow = panel.flows?.items.find((item) => item.name === key);
    return flow !== undefined && isMarkableFlow(flow);
  }
  if (id === RUN_LIST) return panel.runs?.items.some((item) => item.handle === key) === true;
  return false;
}

const limitOf = (id: string): number => (id === FLOW_LIST ? MAX_MARKED_FLOWS : MAX_MARKED_RUNS);

/** The keys of the entries of the list `id`, in its order. */
export function listKeysOf(panel: PanelData, id: string): readonly string[] {
  if (id === FLOW_LIST) return (panel.flows?.items ?? []).map((item) => item.name);
  if (id === RUN_LIST) return (panel.runs?.items ?? []).map((item) => item.handle);
  return [];
}

/** The keys marked in `id` that the list still holds and can name, in the order they were marked. */
export function markedKeys(panel: PanelData, id: string): readonly string[] {
  return (panel.marks?.[id] ?? []).filter((key) => markable(panel, id, key));
}

function withMarks(panel: PanelData, id: string, keys: readonly string[]): PanelData {
  const rest = Object.fromEntries(Object.entries(panel.marks ?? {}).filter(([key]) => key !== id));
  const marks = keys.length === 0 ? rest : { ...rest, [id]: [...keys] };
  const others = without(panel, 'marks');
  return Object.keys(marks).length === 0 ? others : { ...others, marks };
}

/** The marks after a press on `keys`: one toggles; several are all marked, or all unmarked when all were. */
export function withMarksToggled(panel: PanelData, id: string, keys: readonly string[]): PanelData {
  const known = keys.filter((key) => markable(panel, id, key));
  if (known.length === 0) return panel;
  return withMarks(panel, id, toggledMarks(markedKeys(panel, id), known, limitOf(id)));
}

/** `keys` marked on top of the marks, up to the limit of the list; nothing is unmarked. */
export function withMarksAdded(panel: PanelData, id: string, keys: readonly string[]): PanelData {
  const known = keys.filter((key) => markable(panel, id, key));
  if (known.length === 0) return panel;
  return withMarks(panel, id, addedMarks(markedKeys(panel, id), known, limitOf(id)));
}

/** No key of `id` marked; the other lists keep theirs. */
export function withMarksCleared(panel: PanelData, id: string): PanelData {
  return panel.marks?.[id] === undefined ? panel : withMarks(panel, id, []);
}

/** The marks of `id` cut to what the list holds now. */
function pruned(panel: PanelData, id: string): PanelData {
  const before = panel.marks?.[id];
  if (before === undefined) return panel;
  const kept = markedKeys(panel, id);
  return kept.length === before.length ? panel : withMarks(panel, id, kept);
}

/** The panel with the flows just read (the marks of flows that are gone drop out). */
export function withFlows(panel: PanelData, loaded: Loaded<FlowFact> | undefined): PanelData {
  if (loaded === undefined || sameJson(panel.flows, loaded)) return panel;
  return pruned({ ...panel, flows: loaded }, FLOW_LIST);
}

/** The panel with the runs just read (the marks of runs that are gone drop out). */
export function withRuns(panel: PanelData, loaded: Loaded<RunRow> | undefined): PanelData {
  if (loaded === undefined || sameJson(panel.runs, loaded)) return panel;
  return pruned({ ...panel, runs: loaded }, RUN_LIST);
}

/** The panel with the steps just read. */
export function withOutline(panel: PanelData, outline: OutlineFacts | undefined): PanelData {
  if (outline === undefined || sameJson(panel.outline, outline)) return panel;
  return { ...panel, outline };
}

/** The panel after a read that did not work: marked failed, for this state of the project / this flow. */
export function withFailed(
  panel: PanelData,
  what: 'flows' | 'runs' | 'outline',
  flow?: string,
): PanelData {
  if (what === 'flows') {
    return {
      ...panel,
      flows: {
        stamp: flowsStamp(panel.project),
        failed: true,
        items: panel.flows?.items ?? [],
        more: panel.flows?.more ?? 0,
      },
    };
  }
  if (what === 'runs') {
    return {
      ...panel,
      runs: {
        stamp: runsStamp(panel.project),
        failed: true,
        items: panel.runs?.items ?? [],
        more: panel.runs?.more ?? 0,
      },
    };
  }
  return {
    ...panel,
    outline: { flow: flow ?? '', failed: true, steps: [], total: 0, truncated: false },
  };
}

/** The panel without what was read of `what`: the next draw asks for it again ("Try again"). */
export function withoutLoaded(panel: PanelData, what: 'flows' | 'runs' | 'outline'): PanelData {
  return without(panel, what);
}

// ---- when a read is wanted -----------------------------------------------------------------------

/** One read of the status channel the panel wants made. */
export type WantedRead =
  | { readonly kind: 'flows' }
  | { readonly kind: 'runs' }
  | { readonly kind: 'outline'; readonly flow: string };

/**
 * The reads the tab being drawn waits for. Nothing without a project. The flows on the Project tab
 * (when they were not read for the state the project is in), and the steps of the flow open in their
 * preview; the runs on the Results tab. A list read for an older state is drawn while it is read again.
 */
export function wantedReads(panel: PanelData, tab: PaneTab): WantedRead[] {
  const project = panel.project;
  if (project === undefined) return [];
  if (tab === 'results') {
    return panel.runs?.stamp === runsStamp(project) ? [] : [{ kind: 'runs' }];
  }
  if (tab !== 'project') return [];
  const reads: WantedRead[] = [];
  if (panel.flows?.stamp !== flowsStamp(project)) reads.push({ kind: 'flows' });
  const open = listView(panel, FLOW_LIST).open;
  if (
    open !== undefined &&
    panel.flows?.items.some((item) => item.name === open) === true &&
    panel.outline?.flow !== open
  ) {
    reads.push({ kind: 'outline', flow: open });
  }
  return reads;
}

/** The keys of every list as the last drawing held them: `x` on a row resolves against these, not against a newer reading. */
export function drawnKeys(panel: PanelData): Record<string, readonly string[]> {
  return {
    journey: (panel.project?.path?.journeys ?? []).map((item) => item.name),
    [FLOW_LIST]: listKeysOf(panel, FLOW_LIST),
    [RUN_LIST]: listKeysOf(panel, RUN_LIST),
    [STEP_LIST]: (panel.outline?.steps ?? []).map((step) => step.num),
  };
}

/** The marked flows that are on an older docs version: what the preview of the migration is about. */
export function markedOldDocs(panel: PanelData): readonly string[] {
  const old = new Set(
    (panel.flows?.items ?? []).filter((item) => item.oldDocs).map((item) => item.name),
  );
  return markedKeys(panel, FLOW_LIST).filter((key) => old.has(key));
}

// ---- the actions ---------------------------------------------------------------------------------

/** The flows marked, by name, that the conversation can carry (what the messages of the actions list). */
export function markedFlows(panel: PanelData): readonly string[] {
  return markedKeys(panel, FLOW_LIST);
}

/** The two runs marked, the older first (the list is newest first); none unless exactly two are marked. */
export function comparePair(
  panel: PanelData,
): { readonly older: string; readonly newer: string } | undefined {
  const marked = markedKeys(panel, RUN_LIST);
  if (marked.length !== MAX_MARKED_RUNS) return undefined;
  const keys = listKeysOf(panel, RUN_LIST);
  const [first, second] = [...marked].sort(
    (left, right) => keys.indexOf(left) - keys.indexOf(right),
  );
  return first === undefined || second === undefined ? undefined : { older: second, newer: first };
}
