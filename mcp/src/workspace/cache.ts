import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { ToolError } from '../errors.js';
import type { Logger } from '../log.js';
import type { SecretScope } from '../secret.js';
import { systemClock, type Clock } from '../ops/clock.js';
import {
  decodeKey,
  encodeKey,
  isHandleKey,
  isoOf,
  migrateState,
  newProcess,
  operationRow,
} from './migrate.js';
import { resolveInside } from './paths.js';
import { processKey } from './processKey.js';
import { LIMITS, OP_ENDED, State } from './processState.js';
import { createProcessStore, type ProcessUpdateInput, type StateChange } from './reducer.js';
import * as z from 'zod';

export { ensureStateDir, writeFileAtomic } from './stateFile.js';

/** Version of the state file the cache reads and writes (the process state of the tool catalog). */
export const STATE_SCHEMA_VERSION = 3;

/**
 * The sections of the cache as tools name them. `suggestions`, `harSessions`, `drafts`, `accountSeries`, `runLoads` and
 * `selfCheckViews` are sections of the state file; `operations` is `opPayloads` (the data `process_wait` resumes from; the
 * operation also has a row in its process) and takes handles only. `accountSeries` holds the series of account
 * provisioning between calls, keyed by the dataset.
 */
export const SECTIONS = [
  'suggestions',
  'harSessions',
  'drafts',
  'accountSeries',
  'operations',
  'runLoads',
  'selfCheckViews',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface CacheEntry {
  savedAt: number;
  value: unknown;
}

export interface WriteOptions {
  /** For a write that may be skipped (a progress bar): waits briefly for the file lock, then fails with state_locked. */
  quick?: boolean;
}

/** The row of an operation gets the progress of its bar at most this often (each change raises its rev). */
export const MIN_ROW_PROGRESS_MS = 1000;

/** What a progress bar of a running call shows. */
export interface BarProgress {
  /** The tool of the call. */
  tool: string;
  /** The operation the call follows, once it names one. */
  handle?: string;
  stage: string;
  percent?: number;
  /** A counter like `2/3`. */
  counter?: string;
  /** When the call started, in milliseconds. */
  startedAt: number;
}

/** A bar as the state file holds it: one per running call. */
export interface ProgressRow extends BarProgress {
  /** The id of the call. */
  key: string;
  updatedAt: number;
  /** The operations the call already ended; their rows say `running` until the call ends. */
  ended?: string[];
}

export interface StateCache {
  get(section: Section, key: string): CacheEntry | undefined;
  /** Writes through the state reducer, under the file lock; resolves when the file is saved. */
  set(section: Section, key: string, value: unknown, options?: WriteOptions): Promise<void>;
  delete(section: Section, key: string, options?: WriteOptions): Promise<void>;
  /** Entries of one section as `[key, entry]` pairs, in the order of the state file. */
  entries(section: Section): [string, CacheEntry][];
  /** Removes entries saved more than `maxAgeMs` ago; returns how many were removed. */
  prune(maxAgeMs: number): Promise<number>;
  /**
   * Sets the bar of a running call (`callProgress`). When the call follows an operation that has a row, the
   * row's `progress` is updated in the same write, at most once a second. The operations this call ended
   * (`endOperation`) are written with the bar (`callEnded`): their rows still say `running`, because the
   * end of an operation is written with the log entry of the call, and a reader must not take them for
   * operations nobody follows.
   */
  setProgress(call: string, bar: BarProgress, options?: WriteOptions): Promise<void>;
  /** Removes the bar of a call that ended. */
  deleteProgress(call: string, options?: WriteOptions): Promise<void>;
  /** The bar of every running call the file holds. */
  progressRows(): ProgressRow[];
  /** The rows of the operations that run (`running` or `waiting_user`), in every process of the file. */
  runningOperations(): OperationRow[];
  /** The rows of the operations that ended (`done`, `failed`, `cancelled`, `lost`), in every process. */
  finishedOperations(): OperationRow[];
  /**
   * The process of this workspace (the one the log of a call writes to) as the file holds it; a read
   * only: a tool changes the process through the `update` of its outcome.
   */
  process(): State['process'][string] | undefined;
  /**
   * Notes the end of an operation: its row as it ends (`done`, `failed`, `cancelled`, `lost`). From then on
   * this call no longer sees the operation in the `operations` section, and the registry writes the row
   * with the log entry of the call, in one write that also drops the payload. Until that write nothing
   * is removed from the file, so a write that fails leaves the operation for the next `process_wait`. Recording
   * the operation again (`set`) or dropping it (`delete`) takes the note back.
   */
  endOperation(row: EndedRow): void;
  /** The end this call noted for operation `handle`, or undefined. */
  endOf(handle: string): EndedRow | undefined;
  /** Every end this call noted, as one update of the process; undefined when there is none. */
  endedOperations(): ProcessUpdateInput | undefined;
}

/** The row of an ended operation, as an update of its process carries it. */
export type EndedRow = NonNullable<ProcessUpdateInput['operations']>[number];

/** A row of an operation in its process, as the state file holds it. */
export type OperationRow = State['process'][string]['operations'][number];

export interface StateCacheOptions {
  logger: Logger;
  /** Secrets of the current call; a value that contains one of them is never written. */
  secrets: Pick<SecretScope, 'containsSecret' | 'scrub' | 'scrubDeep'>;
  /** Stamps `savedAt` and measures `prune` ages; tests inject a controlled clock. */
  clock?: Pick<Clock, 'now'>;
  /** The tool of the call; named on the rows of the operations it saves. */
  tool?: string;
  /** The address of this LoadCraft instance: a binding made for another one does not name the process. */
  appUrl?: string;
}

/** Structural check for a `Secret` (WS-03): an object exposing `reveal()`, at any depth. */
function containsSecret(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if ('reveal' in value && typeof value.reveal === 'function') return true;
  const items: unknown[] = Array.isArray(value) ? value : Object.values(value);
  return items.some((item) => containsSecret(item, seen));
}

type Stored = Record<string, unknown>;
type Json = Record<string, unknown>;
type Row = OperationRow;

type EntryField =
  | 'suggestions'
  | 'harSessions'
  | 'drafts'
  | 'accountSeries'
  | 'opPayloads'
  | 'runLoads'
  | 'selfCheckViews';

/** The sections whose entries live for a while after they were saved (`pruneCache` drops them on a write). */
const TTL_MS: Partial<Record<EntryField, number>> = {
  suggestions: LIMITS.suggestions.hours * 3_600_000,
  harSessions: LIMITS.harSessions.hours * 3_600_000,
  drafts: LIMITS.drafts.hours * 3_600_000,
  accountSeries: LIMITS.account_series.days * 86_400_000,
  selfCheckViews: LIMITS.self_check.hours * 3_600_000,
};

/**
 * Where a tool's (section, key) lives in the file; undefined for a key of `operations` that is not a handle
 * (the section holds the payloads of operations, nothing else).
 */
function place(section: Section, key: string): { field: EntryField; key: string } | undefined {
  if (section === 'operations') return isHandleKey(key) ? { field: 'opPayloads', key } : undefined;
  if (section === 'runLoads') return { field: 'runLoads', key };
  return { field: section, key: encodeKey(key) };
}

const fieldOf = (section: Section): EntryField =>
  section === 'operations' ? 'opPayloads' : section;

const nameOf = (field: EntryField, stored: string): string =>
  field === 'opPayloads' || field === 'runLoads' ? stored : decodeKey(stored);

const runLoadValue = z.object({
  run_id: z.string(),
  requested_vu: z.number(),
  effective_vu: z.number(),
});

const isoEntry = z.object({ savedAt: z.string(), value: z.unknown() });

/**
 * An entry of the file as a tool sees it: the file stamps ISO times, a tool reads milliseconds. An entry past
 * the time to live of its section is not read (the next write drops it); `nowMs` undefined reads every entry.
 */
const readEntry = (field: EntryField, value: unknown, nowMs?: number): CacheEntry | undefined => {
  const checked = isoEntry.safeParse(value);
  if (!checked.success) return undefined;
  const savedAt = Date.parse(checked.data.savedAt);
  const ttl = TTL_MS[field];
  if (nowMs !== undefined && ttl !== undefined && savedAt < nowMs - ttl) return undefined;
  if (field !== 'runLoads') return { savedAt, value: checked.data.value };
  const load = runLoadValue.safeParse(checked.data.value);
  if (!load.success) return undefined;
  const { run_id: id, requested_vu: requested, effective_vu: effective } = load.data;
  return {
    savedAt,
    value: { execution_id: id, requested_vu: requested, effective_vu: effective },
  };
};

const loadOf = z.object({
  execution_id: z.string(),
  requested_vu: z.number(),
  effective_vu: z.number(),
});

/** The entry as the file holds it: `{savedAt: ISO, value}` in every section. */
function storedEntry(field: EntryField, savedAt: number, value: unknown): unknown {
  const at = isoOf(savedAt) ?? new Date(0).toISOString();
  if (field !== 'runLoads') return { savedAt: at, value };
  const load = loadOf.safeParse(value);
  return {
    savedAt: at,
    value: load.success
      ? {
          run_id: load.data.execution_id,
          requested_vu: load.data.requested_vu,
          effective_vu: load.data.effective_vu,
        }
      : value,
  };
}

/** The state with the row of `handle` set (or, for `undefined`, removed) wherever it is. */
function withRow(
  state: State,
  owner: string,
  handle: string,
  row: ReturnType<typeof operationRow>,
  now: string,
): State {
  const process = { ...state.process };
  let found = false;
  for (const [key, p] of Object.entries(process)) {
    const at = p.operations.findIndex((o) => o.handle === handle);
    if (at < 0) continue;
    found = true;
    const operations = [...p.operations];
    if (row === undefined) operations.splice(at, 1);
    // A row that exists keeps what the reducer put on it (status, card, progress); only its time moves.
    else operations[at] = { ...p.operations[at], updated_at: row.updated_at } as Row;
    process[key] = { ...p, operations };
  }
  if (found || row === undefined) return { ...state, process };
  const p = process[owner] ?? newProcess(owner, now);
  const operations = withRoom(p.operations, Date.parse(now));
  // No room (as many fresh operations running as the list holds): the payload is saved without a row and
  // the reducer keeps it for a day, so the handle of an operation already started in the backend still
  // reaches the model and `process_wait` resumes it. A write that failed here would leave a started test without
  // a handle, and the model might start it again.
  if (operations === undefined) return { ...state, process };
  process[owner] = { ...p, operations: [...operations, row] };
  return { ...state, process };
}

/**
 * The rows with room for one more, or undefined when there is none. A row that says `running` or
 * `waiting_user` but has not moved for longer than finished operations are kept is marked `lost` (nobody
 * follows it any more), with its time left as it was, so the reducer prunes it with the other old finished
 * rows; the reducer also drops the oldest finished rows when the list is over its limit.
 */
function withRoom(rows: readonly Row[], nowMs: number): Row[] | undefined {
  if (rows.length < LIMITS.operations) return [...rows];
  const cutoff = nowMs - LIMITS.finished_operation_hours * 3_600_000;
  const marked = rows.map((o) =>
    !OP_ENDED.has(o.status) && Date.parse(o.updated_at) < cutoff
      ? { ...o, status: 'lost' as const }
      : o,
  );
  const running = marked.filter((o) => !OP_ENDED.has(o.status)).length;
  return running < LIMITS.operations ? marked : undefined;
}

/**
 * The state with the ended operations of `call` in `callEnded` set to `handles`; an empty list removes the
 * entry, and the section goes when no entry is left.
 */
function withEnded(state: State, call: string, handles: readonly string[]): State {
  const entries = Object.entries(state.callEnded ?? {}).filter(([key]) => key !== call);
  if (handles.length > 0) entries.push([call, [...handles]]);
  const next = { ...state };
  if (entries.length === 0) delete next.callEnded;
  else next.callEnded = Object.fromEntries(entries);
  return next;
}

export function createStateCache(root: string, options: StateCacheOptions): StateCache {
  const clock = options.clock ?? systemClock;
  const statePath = (): string => join(root, 'loadcraft', '.cache', 'state.json');
  const migrate = (input: unknown) =>
    migrateState(input, { scrubDeep: <T>(value: T): T => options.secrets.scrubDeep(value) });
  const empty = (): State => State.parse({ schema: STATE_SCHEMA_VERSION });

  const quarantine = (reason: string): void => {
    const path = statePath();
    // An earlier bak is never overwritten.
    const target = existsSync(`${path}.bak`) ? `${path}.${String(clock.now())}.bak` : `${path}.bak`;
    try {
      renameSync(path, target);
    } catch (cause) {
      throw new ToolError('state_unreadable', {
        message: 'The state file is unreadable; moving it aside failed.',
        hint: 'Remove loadcraft/.cache/state.json by hand.',
        cause,
      });
    }
    options.logger.warn('state file was unreadable and was moved to state.json.bak', { reason });
  };

  // The state as the file holds it; a schema 1 file is migrated in memory (the file stays as it is until the
  // next write). A file that is not a state goes to `state.json.bak` and the state is empty.
  const load = (): State => {
    const path = statePath();
    if (!existsSync(path)) return empty();
    resolveInside(root, join('loadcraft', '.cache', 'state.json'));
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      quarantine('invalid JSON');
      return empty();
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'schema' in parsed &&
      typeof parsed.schema === 'number' &&
      parsed.schema !== 1 &&
      parsed.schema !== STATE_SCHEMA_VERSION
    ) {
      throw new ToolError('state_schema_unsupported', {
        message: `The state file uses schema ${String(parsed.schema)}, which this plugin version does not know.`,
        hint: 'Update the LoadCraft plugin.',
        params: { schema: String(parsed.schema) },
      });
    }
    const migrated = migrate(parsed);
    const checked = State.safeParse(migrated);
    if (!checked.success) {
      // A file of this schema that does not parse (even after it was fitted) is the reducer's
      // `state_unreadable`: its processes stay where they are. Only a schema 1 file nobody can read is moved aside.
      if (migrated !== undefined && migrated['schema'] === STATE_SCHEMA_VERSION) {
        throw new ToolError('state_unreadable', {
          message: 'The state file is unreadable.',
          hint: 'Remove loadcraft/.cache/state.json by hand.',
        });
      }
      quarantine('unexpected structure');
      return empty();
    }
    return checked.data;
  };

  // The operations this call ended: hidden from the `operations` section until the registry writes them.
  const ends = new Map<string, EndedRow>();

  // When the row of each operation last got its progress: the row moves whenever its entry is saved again, so
  // its `updated_at` cannot tell. Per cache, which is per call: one call writes the bars of its operation.
  const progressAt = new Map<string, number>();

  // The process a new operation row goes to: the one the log writes to (the bound project, else `_new`).
  const owner = (): string => processKey(root, options.appUrl);

  const storeOptions = { secrets: options.secrets, clock, migrate: (raw: Json) => migrate(raw) };
  const store = createProcessStore(root, storeOptions);
  const quickStore = createProcessStore(root, { ...storeOptions, lock: { timeoutMs: 250 } });
  // The only way to change the file: through the reducer, which keeps `process` and the keys it does not know.
  const write = async (change: StateChange, how?: WriteOptions): Promise<void> => {
    load(); // moves a file that is not a state aside first, so the reducer sees a clean slate
    await (how?.quick === true ? quickStore : store).writeState(change);
  };

  const stored = (section: Section): [string, CacheEntry][] => {
    const state = load();
    const field = fieldOf(section);
    const nowMs = clock.now();
    const out: [string, CacheEntry][] = [];
    for (const [key, raw] of Object.entries(state[field])) {
      const entry = readEntry(field, raw, nowMs);
      if (entry !== undefined) out.push([nameOf(field, key), entry]);
    }
    return out;
  };

  return {
    get: (section, key) => {
      if (section === 'operations' && ends.has(key)) return undefined;
      const placed = place(section, key);
      if (placed === undefined) return undefined;
      return readEntry(placed.field, load()[placed.field][placed.key], clock.now());
    },
    entries: (section) =>
      section === 'operations'
        ? stored(section).filter(([key]) => !ends.has(key))
        : stored(section),
    set: async (section, key, value, how) => {
      if (containsSecret(value)) {
        throw new ToolError('secret_not_storable', {
          message: 'A secret value cannot be written to the state file.',
        });
      }
      if (options.secrets.containsSecret(value)) {
        throw new ToolError('internal_secret_in_state', {
          message: 'A registered secret value cannot be written to the state file.',
        });
      }
      const placed = place(section, key);
      if (placed === undefined) {
        throw new ToolError('internal_error', {
          message: `The operations section takes handles of operations only, not "${key}".`,
        });
      }
      if (section === 'operations') ends.delete(key);
      const savedAt = clock.now();
      const { field, key: at } = placed;
      const entry = storedEntry(field, savedAt, value);
      await write((state, now) => {
        const next = { ...state, [field]: { ...state[field], [at]: entry } };
        return section === 'operations'
          ? withRow(next, owner(), key, operationRow(key, { savedAt, value }, options.tool), now)
          : next;
      }, how);
    },
    delete: async (section, key, how) => {
      const placed = place(section, key);
      if (placed === undefined) return;
      if (section === 'operations') ends.delete(key);
      const { field, key: at } = placed;
      await write((state, now) => {
        if (!(at in state[field])) return state;
        const rest = Object.fromEntries(Object.entries(state[field]).filter(([k]) => k !== at));
        const next = { ...state, [field]: rest };
        return section === 'operations' ? withRow(next, owner(), key, undefined, now) : next;
      }, how);
    },
    prune: async (maxAgeMs) => {
      const limit = clock.now() - maxAgeMs;
      let removed = 0;
      await write((state, now) => {
        removed = 0;
        let next: State = state;
        for (const field of [
          'suggestions',
          'harSessions',
          'drafts',
          'accountSeries',
          'opPayloads',
          'runLoads',
          'selfCheckViews',
        ] as const) {
          const kept: Stored = {};
          for (const [key, raw] of Object.entries(next[field])) {
            const entry = readEntry(field, raw);
            if (entry !== undefined && entry.savedAt < limit) {
              removed += 1;
              if (field === 'opPayloads') next = withRow(next, owner(), key, undefined, now);
            } else kept[key] = raw;
          }
          next = { ...next, [field]: kept };
        }
        return removed === 0 ? state : next;
      });
      return removed;
    },
    setProgress: async (call, bar, how) => {
      const at = clock.now();
      const handle = bar.handle;
      const last = handle === undefined ? undefined : progressAt.get(handle);
      // Decided before the write: the change may run twice (a second writer), and must decide the same.
      // At most as many as the section holds, the last ones noted: a longer list would make the write fail.
      const endedHandles = [...ends.keys()].slice(-LIMITS.operations);
      const toRow =
        handle !== undefined && (last === undefined || at - last >= MIN_ROW_PROGRESS_MS);
      await write((state, now) => {
        const shown: Record<string, unknown> = { stage: bar.stage.slice(0, 80) };
        if (bar.percent !== undefined) shown['percent'] = Math.min(100, Math.max(0, bar.percent));
        if (bar.counter !== undefined) shown['counter'] = bar.counter.slice(0, 40);
        const entry = {
          ...shown,
          tool: bar.tool.slice(0, 64),
          ...(bar.handle === undefined ? {} : { handle: bar.handle }),
          startedAt: isoOf(bar.startedAt) ?? now,
          updatedAt: now,
        } as State['callProgress'][string];
        const next = withEnded(
          { ...state, callProgress: { ...state.callProgress, [call]: entry } },
          call,
          endedHandles,
        );
        if (!toRow) return next;
        const process = { ...next.process };
        for (const [key, p] of Object.entries(process)) {
          const index = p.operations.findIndex((o) => o.handle === handle);
          const row = p.operations[index];
          // the same progress again (a heartbeat) changes nothing: no new rev for the readers of the process
          if (row === undefined || JSON.stringify(row.progress) === JSON.stringify(shown)) continue;
          const operations = [...p.operations];
          operations[index] = { ...row, progress: shown, updated_at: now };
          process[key] = { ...p, operations };
        }
        return { ...next, process };
      }, how);
      if (toRow) progressAt.set(handle, at);
    },
    deleteProgress: async (call, how) => {
      await write((state) => {
        if (!(call in state.callProgress) && state.callEnded?.[call] === undefined) return state;
        const rest = Object.fromEntries(
          Object.entries(state.callProgress).filter(([k]) => k !== call),
        );
        return withEnded({ ...state, callProgress: rest }, call, []);
      }, how);
    },
    process: () => load().process[owner()],
    endOperation: (row) => {
      ends.set(row.handle, row);
    },
    endOf: (handle) => ends.get(handle),
    endedOperations: () => (ends.size === 0 ? undefined : { operations: [...ends.values()] }),
    runningOperations: () =>
      Object.values(load().process).flatMap((p) =>
        p.operations.filter((o) => !OP_ENDED.has(o.status)),
      ),
    finishedOperations: () =>
      Object.values(load().process).flatMap((p) =>
        p.operations.filter((o) => OP_ENDED.has(o.status)),
      ),
    progressRows: () => {
      const state = load();
      return Object.entries(state.callProgress).map(([call, bar]) => ({
        key: call,
        tool: bar.tool,
        ...(bar.handle === undefined ? {} : { handle: bar.handle }),
        stage: bar.stage,
        ...(bar.percent === undefined ? {} : { percent: bar.percent }),
        ...(bar.counter === undefined ? {} : { counter: bar.counter }),
        startedAt: Date.parse(bar.startedAt),
        updatedAt: Date.parse(bar.updatedAt),
        ...(state.callEnded?.[call] === undefined ? {} : { ended: [...state.callEnded[call]] }),
      }));
    },
  };
}
