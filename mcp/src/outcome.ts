// What a tool returns: finished view data, or the state of an operation still under way, with the
// change the call made to the process of the workspace (`update`). A leaf module, so the registry and
// the long operations share these types without importing each other.

import type { ProcessUpdateInput } from './workspace/reducer.js';

export const LINK_KEYS = [
  'link.projectProfile',
  'link.flow',
  'link.describeRun',
  'link.harImport',
  'link.composition',
  'link.scenario',
  'link.feeders',
  'link.executionLive',
  'link.executionResults',
  'link.compare',
  'link.projects',
  'link.flows',
] as const;

/** Dictionary key of the user-visible link label (resolved by the i18n layer). */
export type LinkKey = (typeof LINK_KEYS)[number];

export interface Link {
  readonly labelKey: LinkKey;
  readonly url: string;
  /** Print the label in the text line (`↗ label: url`); without it the line is just `↗ url`. */
  readonly showLabel?: boolean;
}

/** Where a long operation stands, as its kind describes it in the language of the call. */
export interface OperationProgress {
  readonly message: string;
  /** 0..1 when known. */
  readonly fraction?: number;
}

/** Data of an unfinished outcome: the progress, plus a note on how it is followed (REST fallback). */
export interface PendingData extends OperationProgress {
  readonly note?: string;
  /** The next step, when it is not `process_wait` (which would only say the same again). */
  readonly next?: string;
}

/** Finished: `data` is drawn by the view of the tool (for an operation, the view of its kind). */
export interface DoneOutcome<D> {
  status: 'done';
  data: D;
  links?: readonly Link[];
  /**
   * What the call changed in the process (ids, checks, the row of an operation): the registry writes
   * it with the log entry of the call, in one write. The tool never writes the process itself.
   */
  update?: ProcessUpdateInput;
  /**
   * The call wrote nothing to LoadCraft (a preview, a request for consent): the log keeps its entry, but
   * the tool does not invalidate what depends on its writes.
   */
  inert?: true;
}

/** Not finished: drawn by the registry with one shared view; `wait(operation)` continues. */
export interface PendingOutcome {
  status: 'running' | 'needs_user';
  data: PendingData;
  operation: string;
  links?: readonly Link[];
  /** What the call changed in the process before the wait ended (see `DoneOutcome.update`). */
  update?: ProcessUpdateInput;
}

export type ToolOutcome<D> = DoneOutcome<D> | PendingOutcome;

type Update = ProcessUpdateInput;

const lists = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] | undefined =>
  a === undefined && b === undefined ? undefined : [...(a ?? []), ...(b ?? [])];

/** Two records merged one level down (checks and choices per module, the later field winning). */
function perModule<R extends object>(a: R, b: R): R {
  const out = new Map<string, unknown>(Object.entries(a));
  for (const [key, value] of Object.entries(b)) {
    out.set(key, { ...(out.get(key) as object | undefined), ...(value as object | undefined) });
  }
  return Object.fromEntries(out) as R;
}

type Lists = { flow_ids?: string[] | undefined; dataset_ids?: string[] | undefined };
const twoLists = (a: Lists, b: Lists): Lists => ({
  ...a,
  ...b,
  ...(a.flow_ids === undefined && b.flow_ids === undefined
    ? {}
    : { flow_ids: lists(a.flow_ids, b.flow_ids) }),
  ...(a.dataset_ids === undefined && b.dataset_ids === undefined
    ? {}
    : { dataset_ids: lists(a.dataset_ids, b.dataset_ids) }),
});

/** Two updates of one call as one: lists joined, records merged, the later value winning. */
export function mergeUpdates(a: Update | undefined, b: Update | undefined): Update | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  const out: Update = { ...a, ...b };
  if (a.ids !== undefined && b.ids !== undefined) out.ids = { ...a.ids, ...b.ids };
  if (a.unset !== undefined && b.unset !== undefined) out.unset = [...a.unset, ...b.unset];
  if (a.add !== undefined && b.add !== undefined) out.add = twoLists(a.add, b.add);
  if (a.remove !== undefined && b.remove !== undefined) out.remove = twoLists(a.remove, b.remove);
  if (a.labels !== undefined && b.labels !== undefined) out.labels = { ...a.labels, ...b.labels };
  if (a.choices !== undefined && b.choices !== undefined)
    out.choices = perModule(a.choices, b.choices);
  if (a.checks !== undefined && b.checks !== undefined) out.checks = perModule(a.checks, b.checks);
  if (a.operations !== undefined && b.operations !== undefined) {
    out.operations = [...a.operations, ...b.operations];
  }
  if (a.problems !== undefined && b.problems !== undefined) {
    const open = lists(a.problems.open, b.problems.open);
    const close = lists(a.problems.close, b.problems.close);
    out.problems = {
      ...(open === undefined ? {} : { open }),
      ...(close === undefined ? {} : { close }),
    };
  }
  if (a.log !== undefined && b.log !== undefined) out.log = { ...a.log, ...b.log };
  return out;
}

/** The outcome with `update` added to what it already changes. */
export function withUpdate<O extends ToolOutcome<unknown>>(
  outcome: O,
  update: Update | undefined,
): O {
  const merged = mergeUpdates(outcome.update, update);
  return merged === undefined ? outcome : { ...outcome, update: merged };
}
