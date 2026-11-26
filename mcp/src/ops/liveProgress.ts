// What every long call reports while it waits, kept in the workspace state so that a client beside the chat
// can draw a bar for each operation in progress: kind of work, stage, percent when the kind knows it, a
// counter (`2/2`), and when it started. It is the same text and fraction the call already sends as MCP
// progress; nothing here asks the backend.
//
// The bar of a running call lives under the id of the call (`callProgress`), with the handle of the operation
// once the call names one; the row of that operation (`process[...].operations[i].progress`) gets the same
// progress. The call writes its bar again every 30 s, however quiet it is, and removes it when it ends. A bar
// nobody wrote for 150 s belongs to a call whose server is gone, and is not drawn.
//
// An operation that runs with no call following it (the call handed its handle back) is drawn from its row,
// as a closed bar, while the row says it runs and has moved in the last 30 min (a wait that saves the
// operation again moves it); older, it is an operation nobody waits for.

import { inline } from '../render/primitives.js';
import type { StateCache } from '../workspace/cache.js';
import type { Clock } from './clock.js';
import { createWriteChain } from './writeChain.js';

/** A bar is a nicety: a write waits only briefly for the file lock and is skipped when it is held. */
const QUICK = { quick: true } as const;
/** Rows are written at most this often; the last text is written when the call ends. */
export const MIN_WRITE_MS = 1000;
/** A running call writes its bar again this often, so a quiet call is not taken for a call that is gone. */
export const HEARTBEAT_MS = 30_000;
/** A bar nobody wrote for this long (five heartbeats) belongs to a call that no longer runs. */
export const OPEN_STALE_MS = 150_000;
/** An operation whose row has not moved for this long is one nobody waits for, and is not drawn. */
export const CLOSED_STALE_MS = 30 * 60_000;
const MAX_STAGE = 160;
const MAX_ROWS = 20;

/** One bar, as `process_get_status` with `progress` returns it. */
export interface LiveRow {
  /** Where the bar is kept: the handle, or the id of the call before the call names one. */
  readonly key: string;
  /** The id of the call that wrote it, or the handle for an operation no call follows. */
  readonly call: string;
  readonly tool: string;
  readonly handle?: string;
  readonly kind?: string;
  /** The stage in words, without the trailing `(50%)` of the message. */
  readonly stage: string;
  /** 0..100 when the operation knows how far it is; absent for an indeterminate wait. */
  readonly percent?: number;
  /** `n` of `m` when the stage says so (`scenario 2/2`). */
  readonly n?: number;
  readonly m?: number;
  /** ISO times. */
  readonly startedAt: string;
  readonly updatedAt: string;
  /** True while a call follows it; false for an operation that runs with no call following it. */
  readonly open: boolean;
}

export interface LiveProgress {
  /** The call told its progress (already scrubbed of secrets). Never throws. */
  report(message: string, fraction?: number): void;
  /** The call follows operation `handle`. */
  attach(handle: string): void;
  /** Resolves when the rows asked for so far are in the file; never rejects. */
  settled(): Promise<void>;
  /**
   * The call ended: its bar goes and its heartbeat stops. An operation still running stays drawn from its
   * row. Resolves when the writes of the call are in the file; never rejects.
   */
  end(status?: 'done' | 'failed' | 'running' | 'needs_user'): Promise<void>;
}

/** Calls `tick` every `ms` until the returned function is called. */
export type Every = (ms: number, tick: () => void) => () => void;

const realEvery: Every = (ms, tick) => {
  // unref: a heartbeat must not keep the process alive.
  const timer = setInterval(tick, ms).unref();
  return () => {
    clearInterval(timer);
  };
};

export interface LiveProgressOptions {
  /** The heartbeat's timer; tests drive it with their clock. */
  every?: Every;
}

const TRAILING_PERCENT = /\s*\((\d{1,3})%\)\s*$/u;
const COUNTER = /(?<![\w/])(\d{1,4})\/(\d{1,4})(?![\w/])/u;

/** The stage, the percent written at its end and the counter of one progress message. */
export function parseMessage(message: string): {
  stage: string;
  percent?: number;
  n?: number;
  m?: number;
} {
  const tail = TRAILING_PERCENT.exec(message);
  const percent = tail?.[1] === undefined ? undefined : Math.min(100, Number(tail[1]));
  const stage = inline(message.replace(TRAILING_PERCENT, ''), MAX_STAGE);
  const found = COUNTER.exec(stage);
  const n = found?.[1] === undefined ? undefined : Number(found[1]);
  const m = found?.[2] === undefined ? undefined : Number(found[2]);
  return {
    stage,
    ...(percent === undefined ? {} : { percent }),
    ...(n !== undefined && m !== undefined && m >= 1 && n <= m ? { n, m } : {}),
  };
}

function percentOf(fraction: number | undefined): number | undefined {
  return fraction === undefined || !Number.isFinite(fraction)
    ? undefined
    : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

let sequence = 0;

export function createLiveProgress(
  state: Pick<StateCache, 'setProgress' | 'deleteProgress'>,
  clock: Pick<Clock, 'now'>,
  tool: string,
  options: LiveProgressOptions = {},
): LiveProgress {
  sequence += 1;
  // The id of the call ends with its start, which is how a bar of a call that names no operation shows it.
  const call = `${tool}:${String(sequence)}:${String(clock.now())}`;
  let handle: string | undefined;
  const startedCall = clock.now();
  let last: { message: string; fraction: number | undefined } | undefined;
  let lastWrite: number | undefined;
  let lastPercent: number | undefined;

  // Rows are written in the order they were asked for, by a chain: a report cannot wait for the file.
  const writes = createWriteChain();
  let reportQueued = false;
  const guard = (run: () => Promise<void>): Promise<void> =>
    writes.run(run).catch(() => {
      // A bar is a nicety: a state file that cannot be written must not fail the call.
    });

  const write = async (): Promise<void> => {
    if (last === undefined) return;
    const parsed = parseMessage(last.message);
    const percent = percentOf(last.fraction) ?? parsed.percent;
    lastWrite = clock.now();
    lastPercent = percentOf(last.fraction);
    await state.setProgress(
      call,
      {
        tool,
        ...(handle === undefined ? {} : { handle }),
        stage: parsed.stage,
        ...(percent === undefined ? {} : { percent }),
        ...(parsed.n === undefined || parsed.m === undefined
          ? {}
          : { counter: `${String(parsed.n)}/${String(parsed.m)}` }),
        startedAt: startedCall,
      },
      QUICK,
    );
  };

  let ended = false;
  // One write is queued at a time and takes the newest text when it runs: reports that pile up behind a
  // write cost nothing.
  const queue = (): void => {
    if (reportQueued || ended) return;
    reportQueued = true;
    void guard(async () => {
      reportQueued = false;
      await write();
    });
  };

  let stopHeartbeat: (() => void) | undefined;
  const heartbeat = (): void => {
    if (stopHeartbeat !== undefined || ended) return;
    stopHeartbeat = (options.every ?? realEvery)(HEARTBEAT_MS, queue);
  };

  return {
    report(message, fraction) {
      last = { message, fraction };
      heartbeat();
      const now = clock.now();
      const quiet =
        lastWrite !== undefined &&
        now - lastWrite < MIN_WRITE_MS &&
        percentOf(fraction) === lastPercent;
      if (quiet) return;
      queue();
    },
    attach(named) {
      if (handle === named) return;
      handle = named;
      if (last === undefined) return;
      void guard(write);
    },
    settled: () => writes.flush().catch(() => undefined),
    async end() {
      ended = true;
      stopHeartbeat?.();
      // A call that told nothing leaves the state file alone; otherwise its bar goes with the call.
      if (last === undefined) return;
      await guard(() => state.deleteProgress(call, QUICK));
    },
  };
}

/** How an operation that ended lately ended, as `process_get_status` with `progress` lists it. */
export interface EndedBar {
  readonly handle: string;
  /** `lost` is listed as `failed`: for a bar both mean the operation did not end well. */
  readonly status: 'done' | 'failed' | 'cancelled';
}

/** An operation that ended longer ago than this is not listed with the bars. */
export const ENDED_RECENT_MS = 60_000;

/**
 * The operations that ended in the last minute, newest first, with how they ended: a client that drew
 * a bar for one of them draws its end as it was (a failure is not drawn as an operation that ended well).
 * Reads the state file only.
 */
export function listEnded(state: Pick<StateCache, 'finishedOperations'>, now: number): EndedBar[] {
  return state
    .finishedOperations()
    .filter((row) => now - Date.parse(row.updated_at) <= ENDED_RECENT_MS)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
    .slice(0, MAX_ROWS)
    .map((row) => ({
      handle: row.handle,
      status: row.status === 'done' ? 'done' : row.status === 'cancelled' ? 'cancelled' : 'failed',
    }));
}

/** `n` and `m` of a counter like `2/3`. */
function counterOf(counter: string | undefined): { n: number; m: number } | undefined {
  const found = counter === undefined ? undefined : /^(\d+)\/(\d+)$/u.exec(counter);
  return found?.[1] === undefined || found[2] === undefined
    ? undefined
    : { n: Number(found[1]), m: Number(found[2]) };
}

/**
 * The bars to draw at `now`, oldest first: the bars of calls that run (written in the last 150 s), and a
 * closed bar for each running operation no such call follows whose row moved in the last 30 min, with the
 * progress its row last got. Reads the state file only.
 */
export function listLive(
  state: Pick<StateCache, 'progressRows' | 'runningOperations'>,
  now: number,
): LiveRow[] {
  const rows: LiveRow[] = [];
  const followed = new Set<string>();
  for (const row of state.progressRows()) {
    // A call that goes on to its next operation has ended the ones before; their rows say `running` until the
    // call ends (the end is written with its log entry), and they are not drawn as operations nobody follows.
    for (const handle of row.ended ?? []) followed.add(handle);
    if (now - row.updatedAt > OPEN_STALE_MS) continue;
    if (row.handle !== undefined) followed.add(row.handle);
    const counter = counterOf(row.counter);
    rows.push({
      key: row.key,
      call: row.key,
      tool: row.tool,
      ...(row.handle === undefined ? {} : { handle: row.handle, kind: row.handle.split(':')[0] }),
      stage: row.stage,
      ...(row.percent === undefined ? {} : { percent: row.percent }),
      ...(counter ?? {}),
      startedAt: new Date(row.startedAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      open: true,
    });
  }
  for (const operation of state.runningOperations()) {
    if (followed.has(operation.handle)) continue;
    if (now - Date.parse(operation.updated_at) > CLOSED_STALE_MS) continue;
    followed.add(operation.handle);
    const { progress } = operation;
    const counter = counterOf(progress?.counter);
    rows.push({
      key: operation.handle,
      call: operation.handle,
      tool: operation.tool,
      handle: operation.handle,
      kind: operation.kind,
      stage: progress?.stage ?? operation.label ?? operation.kind,
      ...(progress?.percent === undefined ? {} : { percent: progress.percent }),
      ...(counter ?? {}),
      startedAt: operation.started_at,
      updatedAt: operation.updated_at,
      open: false,
    });
  }
  return rows
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
    .slice(0, MAX_ROWS);
}
