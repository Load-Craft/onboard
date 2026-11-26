// Moves the process kept under '_new' (the card, the log and the operations written before a project
// existed) under the key of the project that was just created, and binds the workspace to it. One write:
// removing '_new', creating (or merging into) process[projectId] and setting `bound_project_id` happen under
// one lock, so a reader sees either the state before or the state after, never a half.
//
// This is the only move of '_new' in the plugin; the state schema has no move of its own.
import { LIMITS, NEW_KEY, type Process, type State } from './processState.js';
import type { ProcessStore, StateWriteResult } from './reducer.js';

type Card = Process['pending'][number];
type Check = NonNullable<Process['steps']['project']['checks'][string]>;

const LIVE = new Set(['open', 'granted', 'running']);
const union = <T>(first: readonly T[], second: readonly T[]): T[] => [
  ...new Set([...first, ...second]),
];

/** Items of both lists, the first occurrence of an `id` wins, ordered by time (ties keep list order). */
function mergeEntries<T extends { id: string; at: string }>(
  first: readonly T[],
  second: readonly T[],
): T[] {
  const seen = new Set<string>();
  return [...first, ...second]
    .filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at) || a.index - b.index)
    .map(({ item }) => item);
}

/** What a live card asks for: the calls it holds. Two live cards with the same signature ask for one thing. */
const signature = (card: Card): string | undefined =>
  LIVE.has(card.status) && card.calls.length > 0
    ? card.calls.map((c) => `${c.tool}|${c.args_hash}`).join(';')
    : undefined;

function mergeCovers(kept: Card['covers'], other: Card['covers']): Card['covers'] {
  if (kept === undefined) return other;
  if (other === undefined) return kept;
  const expires = [kept.expires_at, other.expires_at].filter((x): x is string => x !== undefined);
  return {
    ...kept,
    tools: union(kept.tools, other.tools).slice(0, 12),
    calls_left: Math.max(kept.calls_left, other.calls_left),
    ttl_min: Math.max(kept.ttl_min, other.ttl_min),
    ...(expires.length > 0
      ? { expires_at: expires.sort((a, b) => Date.parse(b) - Date.parse(a))[0] }
      : {}),
  };
}

interface MergedCards {
  pending: Card[];
  /** `_new` card id -> id of the project card that replaced it. */
  replaced: Map<string, string>;
  dropped: number;
}

function mergeCards(existing: readonly Card[], fresh: readonly Card[]): MergedCards {
  const pending = [...existing];
  const replaced = new Map<string, string>();
  const incoming: Card[] = [];
  for (const card of fresh) {
    const sig = signature(card);
    const twin = sig === undefined ? -1 : pending.findIndex((kept) => signature(kept) === sig);
    const kept = pending[twin];
    if (kept === undefined) {
      incoming.push(card);
      continue;
    }
    const covers = mergeCovers(kept.covers, card.covers);
    pending[twin] = covers === undefined ? kept : { ...kept, covers };
    replaced.set(card.id, kept.id);
  }
  // Over the limit: cards of the project stay; of `_new`, finished ones go first, then the oldest.
  const excess = pending.length + incoming.length - LIMITS.pending;
  const rank = (card: Card): number => (LIVE.has(card.status) ? 1 : 0);
  const doomed = new Set(
    excess <= 0
      ? []
      : [...incoming]
          .sort((a, b) => rank(a) - rank(b) || Date.parse(a.created_at) - Date.parse(b.created_at))
          .slice(0, excess),
  );
  return {
    pending: [...pending, ...incoming.filter((card) => !doomed.has(card))],
    replaced,
    dropped: doomed.size,
  };
}

/** A check is the newer verdict: the later `at` wins, the project's on a tie. */
const newer = (kept: Check, other: Check): Check =>
  Date.parse(other.at) > Date.parse(kept.at) ? other : kept;

function mergeSteps(existing: Process['steps'], fresh: Process['steps']): Process['steps'] {
  const out: Record<string, unknown> = {};
  for (const module of Object.keys(existing) as (keyof Process['steps'])[]) {
    const kept = existing[module];
    const other = fresh[module];
    const checks: Record<string, Check | undefined> = { ...other.checks };
    for (const [name, check] of Object.entries(kept.checks)) {
      const rival = checks[name];
      if (check !== undefined) checks[name] = rival === undefined ? check : newer(check, rival);
    }
    out[module] = { ...kept, status: kept.status === 'todo' ? other.status : kept.status, checks };
  }
  return out as Process['steps'];
}

/**
 * The project already has a process (an earlier adoption, or calls made after the project was created): what
 * `_new` carries joins it. The project's own values win where it has one: ids (lists are united, scenario_ids
 * merged), choices (per field), checks (the later one wins), labels. Log and reads of both sides are joined
 * without duplicates and ordered by time; operations are matched by handle (the more recently updated one
 * wins); two live cards asking for the same call become one (their `covers` joined); cards over the limit
 * are dropped from `_new` and noted in `problems`.
 */
function merge(existing: Process, fresh: Process, now: string): Process {
  const operations = new Map(existing.operations.map((o) => [o.handle, o]));
  const cards = mergeCards(existing.pending, fresh.pending);
  for (const o of fresh.operations) {
    const held = operations.get(o.handle);
    if (held === undefined || Date.parse(o.updated_at) > Date.parse(held.updated_at)) {
      const target = o.pending_id === undefined ? undefined : cards.replaced.get(o.pending_id);
      operations.set(o.handle, target === undefined ? o : { ...o, pending_id: target });
    }
  }
  const log = mergeEntries(existing.log, fresh.log).map((e) => {
    const target =
      e.consent?.pending_id === undefined ? undefined : cards.replaced.get(e.consent.pending_id);
    return target === undefined || e.consent === undefined
      ? e
      : { ...e, consent: { ...e.consent, pending_id: target } };
  });
  const note =
    cards.dropped === 0
      ? []
      : [
          {
            id: 'pr-rebind',
            module: 'process' as const,
            tool: 'project_create',
            code: 'rebind_cards_dropped',
            severity: 'warning' as const,
            message: `${String(cards.dropped)} cards from before the project was created were dropped: the project holds too many cards.`,
            at: now,
          },
        ];
  return {
    ...existing,
    ids: {
      ...fresh.ids,
      ...existing.ids,
      flow_ids: union(existing.ids.flow_ids, fresh.ids.flow_ids),
      dataset_ids: union(existing.ids.dataset_ids, fresh.ids.dataset_ids),
      scenario_ids: { ...fresh.ids.scenario_ids, ...existing.ids.scenario_ids },
    },
    labels: { ...fresh.labels, ...existing.labels },
    choices: {
      flows: { ...fresh.choices.flows, ...existing.choices.flows },
      scenario: { ...fresh.choices.scenario, ...existing.choices.scenario },
      run: { ...fresh.choices.run, ...existing.choices.run },
      data: { ...fresh.choices.data, ...existing.choices.data },
      functional: { ...fresh.choices.functional, ...existing.choices.functional },
    },
    steps: mergeSteps(existing.steps, fresh.steps),
    pending: cards.pending,
    operations: [...operations.values()],
    problems: [...existing.problems, ...fresh.problems, ...note],
    log,
    reads: mergeEntries(existing.reads, fresh.reads),
    reads_total: existing.reads_total + fresh.reads_total,
  };
}

/** The state after the move; the same object when there is nothing under '_new' (so nothing is written). */
export function rebindState(state: State, projectId: string, now: string): State {
  const fresh = state.process[NEW_KEY];
  if (fresh === undefined) return state;
  const rest = Object.fromEntries(Object.entries(state.process).filter(([key]) => key !== NEW_KEY));
  const existing = rest[projectId];
  const moved: Process =
    existing === undefined
      ? { ...fresh, ids: { ...fresh.ids, project_id: projectId } }
      : merge(existing, fresh, now);
  return { ...state, bound_project_id: projectId, process: { ...rest, [projectId]: moved } };
}

/** One write of the state file; idempotent (a second call finds no '_new' and writes nothing). */
export function bindProject(store: ProcessStore, newId: string): Promise<StateWriteResult> {
  return store.writeState((state, now) => rebindState(state, newId, now));
}

/**
 * The state after the projects `projectIds` were deleted in LoadCraft: their processes are gone, and
 * `bound_project_id` too when it named one of them. The same object when the file holds none of them
 * (so nothing is written).
 */
export function forgetProjectsState(state: State, projectIds: readonly string[]): State {
  const gone = new Set(projectIds);
  const kept = Object.entries(state.process).filter(([key]) => !gone.has(key));
  const unbind = state.bound_project_id !== undefined && gone.has(state.bound_project_id);
  if (kept.length === Object.keys(state.process).length && !unbind) return state;
  const { bound_project_id: bound, ...rest } = state;
  return {
    ...(unbind ? rest : { ...rest, ...(bound === undefined ? {} : { bound_project_id: bound }) }),
    process: Object.fromEntries(kept),
  };
}

/** One write of the state file that forgets deleted projects; idempotent. */
export function forgetProjects(
  store: ProcessStore,
  projectIds: readonly string[],
): Promise<StateWriteResult> {
  return store.writeState((state) => forgetProjectsState(state, projectIds));
}
