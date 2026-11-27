// The only write path of the state file (loadcraft/.cache/state.json): process[project_id | '_new'] and the
// cache sections. A tool returns a ProcessUpdate; `reduce` applies it to the process; the store validates the
// update (strict: an unknown key is an error), prunes, masks registered secrets, validates the result, raises
// `rev` of every process it changed and writes the file atomically under a file lock.
//
// Concurrency: the conversation and a subagent run separate server processes on one file. A write reads the
// file without the lock, computes, then takes the lock and checks that the file is still the one it read. If
// another writer got there first, the change is computed once more on the fresh state while the lock is held;
// a second mismatch (a writer that does not take the lock) ends with `state_conflict`, never with a lost
// write.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as z from 'zod';
import { ToolError } from '../errors.js';
import { systemClock, type Clock } from '../ops/clock.js';
import type { SecretScope } from '../secret.js';
import { WRITER_BUILD } from './build.js';
import { ensureStateDir, writeFileAtomic } from './stateFile.js';
import { INVALIDATED_CODE, invalidateChecks, invalidatedBy, triggersOf } from './invalidate.js';
import { withFileLock, type FileLockOptions } from './lock.js';
import { resolveInside } from './paths.js';
import {
  LIMITS,
  MODULES,
  NEW_KEY,
  Process,
  ProcessUpdate,
  State,
  pruneCache,
  pruneProcess,
} from './processState.js';
import { STEP_REOPENED_CODE, currentStep, settleProcess, settleSteps } from './steps.js';

/** Version of the state file this reducer reads and writes. */
export const PROCESS_STATE_SCHEMA = 3;
const STATE_FILE = join('loadcraft', '.cache', 'state.json');

/** What a tool may hand to `applyUpdate`; validated there. */
export type ProcessUpdateInput = z.input<typeof ProcessUpdate>;
/** A validated update, as `reduce` takes it. */
export type ProcessUpdateValue = z.output<typeof ProcessUpdate>;

export interface ReduceContext {
  /** The catalog entry of the call whose result this is: stamped as `by` of the checks it sets. */
  tool: string;
  /**
   * The call failed or was cancelled: its tool is no trigger (a call that changed nothing invalidates
   * nothing). What the update still carries (the row of an operation that ended failed) is applied.
   */
  failed?: boolean;
  /**
   * The call succeeded but changed nothing in LoadCraft (a preview, a request for consent): its tool is
   * no trigger either. Its update is applied.
   */
  inert?: boolean;
  /** ISO time stamped on labels, checks, problems and operations. */
  now: string;
  /** Id source for new problems; random by default. */
  newId?: () => string;
}

type Ids = Process['ids'];
const STATE_FIELDS = [
  'ids',
  'unset',
  'add',
  'remove',
  'labels',
  'choices',
  'checks',
  'operations',
  'problems',
] as const satisfies readonly (keyof ProcessUpdateValue)[];
type LooseStep = { status: string; checks: Record<string, unknown> };
type Operation = Process['operations'][number];

/**
 * Applies one update to a process. Pure apart from the ids of new problems. The result is not validated
 * here: the store prunes it, masks secrets and parses it with `Process` before anything is written.
 * `question` and `log` of the update are not state: the registration layer turns them into a card and a
 * log entry.
 */
export function reduce(p: Process, u: ProcessUpdateValue, ctx: ReduceContext): Process {
  // Invalidation: a trigger (the tool of a call that succeeded, or a changed `choices.*` key) sets the
  // verdicts that depend on it to null. It runs before the update's own checks, so a tool that invalidates a
  // check and sets it in the same call leaves its own verdict (the last write counts).
  const triggers = triggersOf(ctx.tool, p.choices, u.choices).filter(
    (trigger) => (ctx.failed !== true && ctx.inert !== true) || trigger !== ctx.tool,
  );
  const invalidation = invalidatedBy(triggers);
  // An update without state fields (only `question` or `log`, or nothing) and without a trigger leaves the
  // process as it is: the store then writes nothing and rev stays.
  if (STATE_FIELDS.every((field) => u[field] === undefined) && invalidation.length === 0) return p;
  const newId = ctx.newId ?? ((): string => randomBytes(4).toString('hex'));

  // ids: unset, then replace (scenario_ids merged), then add and remove on the two lists
  const ids: Ids = { ...p.ids };
  for (const key of u.unset ?? []) {
    if (key === 'flow_ids' || key === 'dataset_ids') ids[key] = [];
    else if (key === 'scenario_ids') ids.scenario_ids = {};
    else delete ids[key];
  }
  if (u.ids !== undefined) {
    const { scenario_ids: scenarios, ...replaced } = u.ids;
    Object.assign(ids, replaced);
    if (scenarios !== undefined) ids.scenario_ids = { ...ids.scenario_ids, ...scenarios };
  }
  for (const key of ['flow_ids', 'dataset_ids'] as const) {
    const removed = new Set(u.remove?.[key] ?? []);
    ids[key] = [...new Set([...ids[key], ...(u.add?.[key] ?? [])])].filter(
      (id) => !removed.has(id),
    );
  }

  // labels: merged per object, so a later name keeps the env flags it does not repeat
  const labels = { ...p.labels };
  for (const [id, label] of Object.entries(u.labels ?? {})) {
    labels[id] = { ...labels[id], ...label, at: ctx.now };
  }

  // choices: merged per module, a named field replaces the earlier value
  const c = u.choices;
  const choices = {
    flows: { ...p.choices.flows, ...c?.flows },
    scenario: { ...p.choices.scenario, ...c?.scenario },
    run: { ...p.choices.run, ...c?.run },
    data: { ...p.choices.data, ...c?.data },
    functional: { ...p.choices.functional, ...c?.functional },
  };

  // checks: the reducer stamps the time and the tool; an unknown check name fails validation later
  const invalidated = invalidateChecks(p.steps, invalidation, ctx.now);
  const steps = { ...invalidated.steps } as Record<string, LooseStep>;
  for (const [module, checks] of Object.entries(u.checks ?? {})) {
    const step = steps[module];
    if (step === undefined || checks === undefined) continue;
    const merged = { ...step.checks };
    for (const [name, check] of Object.entries(checks)) {
      merged[name] = { ...check, at: ctx.now, by: ctx.tool };
    }
    steps[module] = { ...step, checks: merged };
  }

  // A trigger that found nothing to invalidate and moved no step changes nothing: no new object, so no rev.
  if (STATE_FIELDS.every((field) => u[field] === undefined) && invalidated.changed.length === 0) {
    return p;
  }

  // operations: upsert by handle; a new one must carry every field (validation says which is missing)
  const operations = [...p.operations];
  for (const op of u.operations ?? []) {
    const at = operations.findIndex((o) => o.handle === op.handle);
    const prev = at >= 0 ? operations[at] : undefined;
    const merged = {
      ...prev,
      ...op,
      started_at: prev?.started_at ?? op.started_at ?? ctx.now,
      updated_at: ctx.now,
    } as Operation;
    if (at >= 0) operations[at] = merged;
    else operations.push(merged);
  }

  // problems: close first (by code, and by object when ref_id is given), then open
  const close = u.problems?.close ?? [];
  const problems = p.problems.filter(
    (pr) =>
      !close.some((x) => x.code === pr.code && (x.ref_id === undefined || x.ref_id === pr.ref?.id)),
  );
  for (const open of u.problems?.open ?? []) {
    problems.push({ ...open, id: `pr-${newId()}`, at: ctx.now });
  }

  // the steps follow their checks and blockers: done needs every required check ok (catalog), else it goes
  // back to active; an open blocker of the module makes it blocked until the blocker is closed
  const settledSteps = settleSteps(steps as unknown as Process['steps'], {
    ...p,
    choices,
    problems,
  });
  // warnings of the steps: one per invalidated check (replaced when it is invalidated again, closed when the
  // check gets a verdict), one per step that went back from done (closed when it is done again)
  const verdictSet = new Set(
    Object.entries(u.checks ?? {}).flatMap(([module, checks]) =>
      Object.entries(checks ?? {})
        .filter(([, check]) => check.ok !== null)
        .map(([name]) => `${module}.${name}`),
    ),
  );
  const refs = new Set<string>();
  for (const hit of invalidated.changed) {
    const ref = `${hit.module}.${hit.check}`;
    if (!verdictSet.has(ref)) refs.add(ref);
  }
  // a blocked step has its blocker as the reason: going from done to blocked is no reopening
  const reopened = new Set(
    settledSteps.settled
      .filter((x) => x.from === 'done' && x.to !== 'done' && x.to !== 'blocked')
      .map((x) => x.module),
  );
  const closed = new Set(settledSteps.settled.filter((x) => x.to === 'done').map((x) => x.module));
  const kept = problems.filter(
    (pr) =>
      !(
        (pr.code === INVALIDATED_CODE &&
          pr.ref !== undefined &&
          (verdictSet.has(pr.ref.id) || refs.has(pr.ref.id))) ||
        (pr.code === STEP_REOPENED_CODE &&
          pr.ref !== undefined &&
          (closed.has(pr.ref.id) || reopened.has(pr.ref.id)))
      ),
  );
  for (const hit of invalidated.changed) {
    const ref = `${hit.module}.${hit.check}`;
    if (!refs.has(ref)) continue;
    kept.push({
      id: `pr-${newId()}`,
      at: ctx.now,
      module: hit.module as Process['problems'][number]['module'],
      tool: ctx.tool,
      code: INVALIDATED_CODE,
      severity: 'warning',
      message: `Check ${ref} is no longer current after ${hit.trigger}; run it again.`,
      ref: { kind: 'check', id: ref },
    });
  }
  for (const x of settledSteps.settled) {
    if (!reopened.has(x.module)) continue;
    kept.push({
      id: `pr-${newId()}`,
      at: ctx.now,
      module: x.module as Process['problems'][number]['module'],
      tool: ctx.tool,
      code: STEP_REOPENED_CODE,
      severity: 'warning',
      message: `Step ${x.module} is active again: required check(s) ${x.missing.join(', ')} not ok.`,
      ref: { kind: 'step', id: x.module },
    });
  }

  return {
    ...p,
    // the step of the process is the reducer's alone: ProcessUpdate has no key for it
    step: currentStep(settledSteps.steps),
    ids,
    labels,
    choices,
    steps: settledSteps.steps,
    operations,
    problems: kept,
  };
}

export interface ProcessStoreOptions {
  /** Secrets of the current call: masked in everything written to the file. */
  secrets: Pick<SecretScope, 'scrub' | 'scrubDeep'>;
  /** Stamps `updated_at` and the update times; tests inject a fixed clock. */
  clock?: Pick<Clock, 'now'>;
  lock?: FileLockOptions;
  /**
   * Turns a file of another schema into schema 3 (undefined: the schema is refused). The write then
   * saves the migrated state; conflicts are still judged on the bytes of the file as it was.
   */
  migrate?: (parsed: Record<string, unknown>) => Record<string, unknown> | undefined;
}

export interface WriteResult {
  /** The process after the write (or as read, when nothing was written). */
  process: Process;
  /** False when the change returned the process unchanged (a read of the panel, format=data). */
  written: boolean;
  /** 1, or 2 when another writer committed first and the change ran again on the fresh state. */
  attempts: number;
  /** Another version of the plugin writes the file too (`ForeignWriter`); absent when none was seen. */
  foreign?: ForeignWriter;
}

/**
 * A writer of another build seen in the file (DOKTOR-07): `other_build`, its stamp names another
 * build; `unstamped`, the file changed since this process wrote it while the stamp still names this
 * process, so a writer that does not stamp (a build from before the stamp) wrote it.
 */
export type ForeignWriter = 'other_build' | 'unstamped';

export interface StateWriteResult {
  /** The whole state after the write (or as read, when nothing was written). */
  state: State;
  written: boolean;
  attempts: number;
  foreign?: ForeignWriter;
}

/**
 * A change of one process. Returning `current` itself means "nothing to write": no file write, no new rev.
 * It runs a second time, on the fresh state, when another writer committed first, so it must only compute.
 */
export type ProcessChange = (current: Process, now: string, foreign?: ForeignWriter) => Process;

/**
 * A change of the whole state: several process keys, `bound_project_id`, the cache sections. Returning `state`
 * itself means "nothing to write". A process object left as it was (same reference) keeps its rev; every other
 * process gets the next rev. Like `ProcessChange`, it may run twice.
 */
export type StateChange = (state: State, now: string, foreign?: ForeignWriter) => State;

/** A detail of a log entry (`logDetails`), saved in the same write as the entry. */
export type LogDetailEntry = State['logDetails'][string];

export interface ProcessStore {
  /** The process under a key, or undefined; reads without the lock (the file is replaced atomically). */
  read(projectKey: string): Process | undefined;
  /** The whole state as the file holds it now. */
  readState(): State;
  /**
   * Validates the update (unknown keys rejected) and applies it through `reduce`; `then` runs on the result
   * in the same write (the registration layer adds the log entry there, so effect and entry land together).
   */
  applyUpdate(
    projectKey: string,
    update: ProcessUpdateInput,
    meta: {
      /** The catalog entry of the call (`ReduceContext.tool`). */
      tool: string;
      /** The call failed or was cancelled (`ReduceContext.failed`). */
      failed?: boolean;
      /** The call changed nothing in LoadCraft (`ReduceContext.inert`). */
      inert?: boolean;
      then?: ProcessChange;
      detail?: { id: string; entry: LogDetailEntry };
      /** Project the directory is bound to: set as `bound_project_id` in the same write, when the change writes. */
      bound?: string;
    },
  ): Promise<WriteResult>;
  /** A change of one process; built on `writeState`. */
  write(projectKey: string, change: ProcessChange): Promise<WriteResult>;
  /** The single write path of the file. */
  writeState(change: StateChange): Promise<StateWriteResult>;
}

type RawState = Record<string, unknown>;
const KNOWN_FIELDS: ReadonlySet<string> = new Set(Object.keys(State.shape));
/** The stamp of the last writer: `{build, pid, seq}`; a field older builds keep as one they do not know. */
const WRITER_FIELD = 'writer';

/** What this process last wrote to each state file, and the number of its stamp. */
const ownWrites = new Map<string, { text: string; seq: number }>();
let writeSeq = 0;

interface WriterStamp {
  build?: unknown;
  pid?: unknown;
  seq?: unknown;
}

/** The other writer the file shows, if any (see `ForeignWriter`). */
function foreignOf(
  path: string,
  read: { raw: RawState; text: string | undefined },
): ForeignWriter | undefined {
  const stamp = read.raw[WRITER_FIELD];
  const writer: WriterStamp = typeof stamp === 'object' && stamp !== null ? stamp : {};
  if (typeof writer.build === 'string' && writer.build !== WRITER_BUILD) return 'other_build';
  const mine = ownWrites.get(path);
  if (mine === undefined || read.text === undefined || read.text === mine.text) return undefined;
  const stampIsMine =
    writer.build === WRITER_BUILD && writer.pid === process.pid && writer.seq === mine.seq;
  return stampIsMine ? 'unstamped' : undefined;
}

/** Freezes a parsed state (plain objects and arrays) all the way down; returns the same object. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
interface FileRead {
  raw: RawState;
  /** The bytes as read; undefined when the file does not exist yet. */
  text: string | undefined;
  state: State;
}

export function createProcessStore(root: string, options: ProcessStoreOptions): ProcessStore {
  const clock = options.clock ?? systemClock;
  const statePath = join(root, STATE_FILE);

  const invalid = (error: z.ZodError): ToolError => {
    const fields = error.issues
      .slice(0, 5)
      .map((issue) => {
        const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
        const path = [...issue.path.map(String), ...keys].join('.');
        return options.secrets.scrub(path === '' ? '(root)' : path);
      })
      .join(', ');
    // No `cause`: zod's own message quotes the offending keys and values, which may hold a secret.
    return new ToolError('state_update_invalid', {
      message: `The state change does not match the state schema: ${fields}.`,
      params: { fields },
    });
  };

  const unreadable = (): ToolError =>
    new ToolError('state_unreadable', {
      message: 'The state file is unreadable.',
      hint: 'Remove loadcraft/.cache/state.json by hand.',
    });

  // The file as it is (unknown keys kept, so a write never drops what another writer added).
  const readFile = (): FileRead => {
    if (!existsSync(statePath)) {
      const raw = { schema: PROCESS_STATE_SCHEMA };
      return { raw, text: undefined, state: typed(raw) };
    }
    resolveInside(root, STATE_FILE);
    const text = readFileSync(statePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw unreadable();
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unreadable();
    let raw = parsed as RawState;
    // a file of schema 1 is migrated; one of schema 3 written by an earlier version is fitted to the schema
    raw = options.migrate?.(raw) ?? raw;
    if (raw.schema !== PROCESS_STATE_SCHEMA) {
      throw new ToolError('state_schema_unsupported', {
        message: `The state file uses schema ${String(raw.schema)}, which this plugin version does not know.`,
        hint: 'Update the LoadCraft plugin.',
        params: { schema: String(raw.schema) },
      });
    }
    return { raw, text, state: typed(raw) };
  };

  function typed(raw: RawState): State {
    const checked = State.safeParse(raw);
    if (!checked.success) throw unreadable();
    return checked.data;
  }

  const emptyProcess = (key: string, now: string): Process => {
    const checked = Process.safeParse({
      rev: 0,
      updated_at: now,
      step: 'project',
      ids: key === NEW_KEY ? {} : { project_id: key },
      steps: Object.fromEntries(MODULES.map((m) => [m, {}])),
    });
    if (!checked.success) throw invalid(checked.error);
    return checked.data;
  };

  // One changed process: next rev, prune BEFORE validation, live cards over the limit, mask secrets, validate.
  const finishProcess = (
    changed: Process,
    previous: Process | undefined,
    nowMs: number,
    now: string,
  ): Process => {
    // a process new under its key (created, or moved from '_new') continues from its own rev
    const rev = (previous ?? changed).rev + 1;
    const trimmed = pruneProcess({ ...changed, rev, updated_at: now }, nowMs);
    // Statuses and step once more, on what is written: the merge of '_new', a migration and the pruning of
    // problems (an old blocker dropped) change them without passing through `reduce`. No step_reopened
    // warning is opened here; those belong to `reduce`, which knows the update that reopened a step.
    const pruned = { ...trimmed, ...settleProcess(trimmed) };
    if (pruned.pending.length > LIMITS.pending) {
      throw new ToolError('pending_full', {
        message: `More than ${String(LIMITS.pending)} cards wait for a decision; no new card fits.`,
        params: { limit: LIMITS.pending },
      });
    }
    const checked = Process.safeParse(options.secrets.scrubDeep(pruned));
    if (!checked.success) throw invalid(checked.error);
    return checked.data;
  };

  // Computes the next state, or undefined when the change wrote nothing.
  const prepare = (
    seen: State,
    change: StateChange,
    foreign?: ForeignWriter,
  ): State | undefined => {
    const nowMs = clock.now();
    const now = new Date(nowMs).toISOString();
    // Frozen: a change that edits the state in place (instead of returning new objects) fails with a
    // TypeError, so nothing escapes the rev and the secret filter below, which look at what changed.
    const changed = change(deepFreeze(seen), now, foreign);
    if (changed === seen) return undefined;
    const process: Record<string, Process> = {};
    for (const [key, p] of Object.entries(changed.process)) {
      const previous = seen.process[key];
      process[key] = p === previous ? p : finishProcess(p, previous, nowMs, now);
    }
    // second layer: the whole state goes through the secret filter, not only what changed
    const next = options.secrets.scrubDeep(pruneCache({ ...changed, process }, nowMs));
    // the rules across keys: a project key needs ids.project_id equal to it, '_new' may have none
    const checked = State.safeParse(next);
    if (!checked.success) throw invalid(checked.error);
    return checked.data;
  };

  const commit = (raw: RawState, next: State): void => {
    // Known fields come from `next` only (a field the change left out is removed); fields this version does
    // not know stay as the file has them.
    const unknown = Object.fromEntries(
      Object.entries(raw).filter(([field]) => !KNOWN_FIELDS.has(field) && field !== WRITER_FIELD),
    );
    writeSeq += 1;
    const writer = { build: WRITER_BUILD, pid: process.pid, seq: writeSeq };
    const out = { ...unknown, ...next, schema: PROCESS_STATE_SCHEMA, [WRITER_FIELD]: writer };
    const text = `${JSON.stringify(out, null, 2)}\n`;
    writeFileAtomic(statePath, text);
    ownWrites.set(statePath, { text, seq: writeSeq });
  };

  // Invalidation of checks and the closing of steps run only in `applyUpdate` (through `reduce`). This write
  // path (migration, bindProject, the cache sections) does not call them, so it must not change a field that
  // is a trigger in the catalog table.
  // Two different things, on purpose:
  // - `rev` is a counter per process for readers (the mod asks for changes since_rev); it moves by one on every
  //   write that changes that process, and only then;
  // - a write conflict is detected by comparing the bytes of the file with those read before computing, so a
  //   write of any other part (another process, a cache section) also sends this write to its second attempt.
  // At most two attempts: the second one reads, computes and writes while holding the lock, so only a writer
  // that ignores the lock can change the file under it (then `state_conflict`).
  const writeState = async (change: StateChange): Promise<StateWriteResult> => {
    // Attempt 1, optimistic: read and compute without the lock.
    const seen = readFile();
    const seenForeign = foreignOf(statePath, seen);
    const first = prepare(seen.state, change, seenForeign);
    const flagged = (foreign: ForeignWriter | undefined) =>
      foreign === undefined ? {} : { foreign };
    if (first === undefined) {
      return { state: seen.state, written: false, attempts: 1, ...flagged(seenForeign) };
    }

    const dir = ensureStateDir(root, '.cache');
    const ignore = join(dir, '.gitignore');
    if (!existsSync(ignore)) writeFileAtomic(ignore, '*\n');

    return withFileLock(
      statePath,
      () => {
        const fresh = readFile();
        if (fresh.text === seen.text) {
          commit(fresh.raw, first);
          return { state: first, written: true, attempts: 1, ...flagged(seenForeign) };
        }
        // Attempt 2: another writer committed after our read. The lock is held, so the fresh state stays
        // fresh for every writer that takes it; a second mismatch means one that does not.
        const foreign = foreignOf(statePath, fresh) ?? seenForeign;
        const retry = prepare(fresh.state, change, foreign);
        if (retry === undefined) {
          return { state: fresh.state, written: false, attempts: 2, ...flagged(foreign) };
        }
        const latest = readFile();
        if (latest.text !== fresh.text) {
          throw new ToolError('state_conflict', {
            message: 'The state file kept changing during the write; nothing was saved.',
            hint: 'Call again.',
          });
        }
        commit(latest.raw, retry);
        return { state: retry, written: true, attempts: 2, ...flagged(foreign) };
      },
      options.lock,
    );
  };

  const write = async (
    key: string,
    change: ProcessChange,
    detail?: { id: string; entry: LogDetailEntry },
    bound?: string,
  ): Promise<WriteResult> => {
    let last: Process | undefined;
    const result = await writeState((state, now, foreign) => {
      const base = state.process[key] ?? emptyProcess(key, now);
      const next = change(base, now, foreign);
      last = base;
      if (next === base) return state;
      const logDetails =
        detail === undefined
          ? state.logDetails
          : { ...state.logDetails, [detail.id]: detail.entry };
      return {
        ...state,
        process: { ...state.process, [key]: next },
        logDetails,
        ...(bound === undefined ? {} : { bound_project_id: bound }),
      };
    });
    const process = result.written ? result.state.process[key] : last;
    if (process === undefined) throw new Error('the change of a process ran no time');
    return {
      process,
      written: result.written,
      attempts: result.attempts,
      ...(result.foreign === undefined ? {} : { foreign: result.foreign }),
    };
  };

  return {
    read: (key) => readFile().state.process[key],
    readState: () => readFile().state,
    applyUpdate: async (key, update, meta) => {
      const parsed = ProcessUpdate.safeParse(update);
      if (!parsed.success) throw invalid(parsed.error);
      const then = meta.then;
      return write(
        key,
        (p, now, foreign) => {
          const reduced = reduce(p, parsed.data, {
            tool: meta.tool,
            now,
            ...(meta.failed === undefined ? {} : { failed: meta.failed }),
            ...(meta.inert === undefined ? {} : { inert: meta.inert }),
          });
          return then === undefined ? reduced : then(reduced, now, foreign);
        },
        meta.detail,
        meta.bound,
      );
    },
    write,
    writeState,
  };
}
