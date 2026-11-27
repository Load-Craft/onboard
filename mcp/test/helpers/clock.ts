// Controlled clock injected into production code (OPS-01): nothing sleeps for real, a test moves time.

import { AsyncLocalStorage } from 'node:async_hooks';
import { Socket } from 'node:net';

import { abortError } from '../../src/ops/clock.js';

export interface TestClock {
  now(): number;
  /** Rejects with an AbortError (and drops the sleeper) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** Moves time forward and wakes due sleepers in time order, letting each continuation run first. */
  advance(ms: number): Promise<void>;
}

/** The clock of `createTestClock`: it also tells when the earliest sleeper wants to wake. */
export interface SteppedClock extends TestClock {
  /** The moment of the earliest pending sleeper, `undefined` when nobody sleeps. */
  nextWakeAt(): number | undefined;
}

interface Sleeper {
  readonly at: number;
  readonly seq: number;
  readonly wake: () => void;
}

/**
 * Lets promise continuations queued by a woken sleeper run to quiescence before the next sleeper
 * wakes: a macrotask turn only starts once the whole microtask queue is empty.
 */
function drainMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

export function createTestClock(start = 0): SteppedClock {
  let current = start;
  let seq = 0;
  let sleepers: Sleeper[] = [];

  return {
    now: () => current,
    nextWakeAt: () =>
      sleepers.reduce<number | undefined>(
        (min, sleeper) => (min === undefined || sleeper.at < min ? sleeper.at : min),
        undefined,
      ),
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(abortError(signal));
          return;
        }
        if (ms <= 0) {
          resolve();
          return;
        }
        seq += 1;
        const work = workContext.getStore();
        if (work !== undefined) work.sleeping += 1;
        const leave = (): void => {
          if (work !== undefined) work.sleeping -= 1;
        };
        const sleeper: Sleeper = {
          at: current + ms,
          seq,
          wake: () => {
            leave();
            resolve();
          },
        };
        sleepers.push(sleeper);
        signal?.addEventListener(
          'abort',
          () => {
            if (!sleepers.includes(sleeper)) return;
            sleepers = sleepers.filter((other) => other !== sleeper);
            leave();
            reject(abortError(signal));
          },
          { once: true },
        );
      });
    },
    async advance(ms) {
      const target = current + ms;
      for (;;) {
        const due = sleepers
          .filter((sleeper) => sleeper.at <= target)
          .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (due === undefined) break;
        sleepers = sleepers.filter((sleeper) => sleeper !== due);
        current = due.at;
        due.wake();
        await drainMicrotasks();
      }
      current = target;
      await drainMicrotasks();
    },
  };
}

export interface SettleOptions {
  /** The most the clock moves in one step; default: all the way to the earliest wake-up. */
  readonly stepMs?: number;
  /** Test time after which the helper stops moving the clock; default 120 s. */
  readonly limitMs?: number;
  /**
   * Real time given to I/O before each step; default 1 ms. The turn also waits for requests in flight
   * and for work of the fake backend, so the timer is only a margin.
   */
  readonly turnMs?: number;
}

/** Real time after which a call that never settles is handed back (the test then times out). */
const REAL_LIMIT_MS = 100_000;

/**
 * Moves the test clock until `call` settles, one jump at a time straight to the next pending
 * wake-up (never past it, never farther than `stepMs` or the rest of `limitMs`), and only while
 * somebody is waiting on the clock. Time between two wake-ups holds nothing that could run, so
 * walking through it in small steps only costs real turns. A call that is still busy with real I/O (an
 * upload, a POST, a refused connect) gets real turns, not test time: a fixed step of the clock per
 * fixed slice of real time ran ahead of slow I/O, which stretched the measured waits and used up
 * step budgets before the call had begun to wait, depending on how busy the machine was.
 */
export async function settleClock<T>(
  r: { readonly clock: SteppedClock },
  call: Promise<T>,
  options: SettleOptions = {},
): Promise<T> {
  const { stepMs = Number.POSITIVE_INFINITY, limitMs = 120_000, turnMs = 1 } = options;
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  call.then(mark, mark);
  const realEnd = Date.now() + REAL_LIMIT_MS;
  let moved = 0;
  while (!settled && moved < limitMs && Date.now() < realEnd) {
    // I/O first: a call that has just been made has its request, its handshake or its stop
    // message still to send, and the clock does not move before that has gone through.
    await realTurn(turnMs);
    if (settled) break;
    const next = r.clock.nextWakeAt();
    if (next !== undefined) {
      assertKnownResources();
      const step = Math.max(0, Math.min(stepMs, next - r.clock.now(), limitMs - moved));
      await r.clock.advance(step);
      moved += step;
    }
  }
  return call;
}

/** Event-loop passes after a real turn: far more than the hops of a handshake or of a frame in flight. */
const IO_PASSES = 24;

/**
 * Gives real I/O its turn between two steps of the clock. A timer alone is not enough: on a busy
 * machine a loop that was descheduled runs its expired timer first and reaches the sockets that
 * became readable meanwhile only afterwards, so a step of test time could land before a frame, a
 * handshake or a stop message that was already on its way. The immediates that follow each run in
 * a loop iteration of their own, after the poll phase, which takes whatever the sockets hold; a
 * chain of hops (connect, upgrade, answer) then runs to its end before the clock moves again.
 */
export async function realTurn(turnMs: number): Promise<void> {
  await new Promise<void>((done) => setTimeout(done, turnMs));
  // Requests that the loop has handed to the system and that have not come back (a file read, write
  // or close, a connect, a lookup, a socket write) are not reached by passes of the loop: on a busy
  // machine the thread pool answers late. They are waited for, event by event, and what a late answer
  // continues (the next request of the call) gets passes of its own before the clock may move.
  const until = Date.now() + IO_WAIT_LIMIT_MS;
  for (;;) {
    for (let pass = 0; pass < IO_PASSES; pass += 1) {
      await new Promise<void>((done) => setImmediate(done));
    }
    if (!pending()) return;
    while (pending() && Date.now() < until) {
      await new Promise<void>((done) => setImmediate(done));
    }
    if (Date.now() >= until) {
      // The clock moves on (a request that never returns must not hang the test), but not silently:
      // a test that then fails on a state it did not expect has its reason next to the failure.
      process.emitWarning(
        `realTurn: still pending after ${String(IO_WAIT_LIMIT_MS)} ms of real time, the test clock moves on: ${pendingNames().join(', ')}`,
        { code: 'TEST_CLOCK_PENDING' },
      );
      return;
    }
  }
}

/** The most real time a turn waits for requests in flight: a guard against a request that never returns. */
const IO_WAIT_LIMIT_MS = 5000;

// `CloseReq`: the close of a `fs/promises` FileHandle (the env file read by `readAccountFromEnv`).
const REQUEST = /(ReqPromise|ReqCallback|ReqWrap|CloseReq|ConnectWrap|WriteWrap|ShutdownWrap)$/u;

/**
 * Handles that only wait for something from outside (a connection, data on a socket or a pipe, a
 * timer, a signal, a child process): while nothing else is pending, the code under test can only
 * go on once the clock moves.
 */
const IDLE = new Set([
  'TCPServerWrap',
  'TCPSocketWrap',
  'PipeServerWrap',
  'PipeWrap',
  'TTYWrap',
  'Timeout',
  'Immediate',
  'ProcessWrap',
  'SignalWrap',
  'FSEventWrap',
  'StatWatcher',
]);

function requestsInFlight(): string[] {
  return process.getActiveResourcesInfo().filter((name) => REQUEST.test(name));
}

/**
 * Bytes one end of an in-process connection (the client and the fake backend share this process)
 * has written and the other end has not read yet. On a busy machine the kernel delivers a loopback
 * packet later (its receive work is deferred to a kernel thread that waits for a CPU), and Node sees
 * nothing in the meantime: no request is pending and the socket only waits. A step of the clock then
 * lands before an answer that is already on its way: the fake's next wake-up (a plan due in 60 s) ran
 * ahead of the call's own wait of a few seconds, which it had not armed yet.
 */
function bytesInFlight(): string[] {
  const handles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();
  const sockets = handles.filter(
    (handle): handle is Socket =>
      handle instanceof Socket && handle.localPort !== undefined && handle.remotePort !== undefined,
  );
  const byEnds = new Map(
    sockets.map((socket) => [`${String(socket.localPort)}>${String(socket.remotePort)}`, socket]),
  );
  const found: string[] = [];
  for (const socket of sockets) {
    const peer = byEnds.get(`${String(socket.remotePort)}>${String(socket.localPort)}`);
    if (peer === undefined || peer.destroyed) continue;
    const unread = socket.bytesWritten - peer.bytesRead;
    if (unread > 0) {
      found.push(
        `${String(unread)} bytes in flight ${String(socket.localPort)} -> ${String(socket.remotePort)}`,
      );
    }
  }
  return found;
}

/** Requests in flight and work of test doubles (the fake backend) the clock must not run ahead of. */
function pendingNames(): string[] {
  return [...requestsInFlight(), ...busyWork(), ...bytesInFlight()];
}

function pending(): boolean {
  return pendingNames().length > 0;
}

/**
 * Throws when a resource of a kind neither list knows is pending as the clock is about to move. Such
 * work (a message port of a worker thread, a UDP socket, a handle type new to Node) may still be on
 * its way to the code under test, and a step of test time taken before it arrives changes what the
 * test sees depending on how busy the machine is. Moving anyway would hide that until it fails
 * elsewhere. Work Node does not list at all (a compression or crypto job in the thread pool) stays
 * out of reach of this check.
 */
function assertKnownResources(): void {
  const unknown = process
    .getActiveResourcesInfo()
    .filter((name) => !IDLE.has(name) && !REQUEST.test(name));
  if (unknown.length === 0) return;
  throw new Error(
    `settleClock: the test clock would move while ${[...new Set(unknown)].join(', ')} is pending, a kind of work it does not know. ` +
      'Add the type to IDLE (a handle that only waits for outside events) or REQUEST (work that ends by itself, waited for) in test/helpers/clock.ts.',
  );
}

// ---- work of test doubles ---------------------------------------------------------------------

interface Work {
  readonly what: string;
  /** Sleeps on a test clock started inside the work: it waits for the clock then, it does not work. */
  sleeping: number;
}

const openWork = new Set<Work>();
const workContext = new AsyncLocalStorage<Work>();

function busyWork(): string[] {
  return [...openWork].filter((work) => work.sleeping === 0).map((work) => work.what);
}

/**
 * Lets the work of a test double that runs this code wait for `promise` as it waits on a test clock:
 * for a hook of the test itself (a gate the test opens after it moved the clock), not for work of
 * the double. Outside such work it only returns `promise`.
 */
export function idleWhile<T>(promise: Promise<T>): Promise<T> {
  const work = workContext.getStore();
  if (work === undefined) return promise;
  work.sleeping += 1;
  const leave = (): void => {
    work.sleeping -= 1;
  };
  promise.then(leave, leave);
  return promise;
}

/** Work of a test double, from `beginWork` until `done`. */
export interface WorkHandle {
  /** Runs `fn` as part of the work: its sleeps on a test clock count as waiting, not as work. */
  run<T>(fn: () => T): T;
  done(): void;
}

/**
 * Tells `settleClock` that a test double (the fake backend answering a request) is busy: the clock
 * does not move until `done`, except while the work itself sleeps on a test clock. A request the
 * fake has taken and not answered yet is not a resource of Node's own (the client's socket only
 * waits), so without this the clock could jump while the answer is still being worked out.
 */
export function beginWork(what: string): WorkHandle {
  const work: Work = { what, sleeping: 0 };
  openWork.add(work);
  return {
    run: (fn) => workContext.run(work, fn),
    done: () => {
      openWork.delete(work);
    },
  };
}
