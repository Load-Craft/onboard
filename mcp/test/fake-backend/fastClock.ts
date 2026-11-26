// A clock that runs `speed` times faster than the real one, for the sample backend of the
// demonstration mode and for the fake of the live gate: those run on real sockets and real
// processes, so the clock has to move by itself.
//
// A plain `started + (Date.now() - started) * speed` jumps with every stall of the process: on a
// busy machine the event loop sleeps for a hundred milliseconds, and at `speed` 600 that is a
// minute of the fake's time, enough for a deadline of the fake (the unwatched refinement, a run
// that must still be running) to pass before the client connected or polled. Here time is counted
// by a tick, and a tick counts at most `MAX_TICK_MS` of real time, so a stall slows the fake's time
// down instead of making it jump; whatever is due at a tick wakes in the order of its time.

import { abortError, type Clock } from '../../src/ops/clock.js';

const TICK_MS = 2;
/** The most real time one tick counts: a few ticks' worth, so that ordinary jitter does not slow time down. */
const MAX_TICK_MS = 10;

export interface FastClock extends Clock {
  /** Stops the tick; sleeps still waiting never wake. */
  stop(): void;
}

interface Sleeper {
  readonly at: number;
  readonly seq: number;
  readonly wake: () => void;
}

export function createFastClock(speed: number): FastClock {
  let virtual = Date.now();
  let lastReal = Date.now();
  let seq = 0;
  let sleepers: Sleeper[] = [];

  const now = (): number => virtual + Math.min(Date.now() - lastReal, MAX_TICK_MS) * speed;

  const tick = (): void => {
    const real = Date.now();
    virtual += Math.min(real - lastReal, MAX_TICK_MS) * speed;
    lastReal = real;
    const due = sleepers
      .filter((sleeper) => sleeper.at <= virtual)
      .sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (due.length === 0) return;
    sleepers = sleepers.filter((sleeper) => sleeper.at > virtual);
    for (const sleeper of due) sleeper.wake();
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref();

  return {
    now,
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(abortError(signal));
          return;
        }
        seq += 1;
        const sleeper: Sleeper = {
          at: now() + ms,
          seq,
          wake: () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          },
        };
        const onAbort = (): void => {
          sleepers = sleepers.filter((other) => other !== sleeper);
          reject(abortError(signal));
        };
        sleepers.push(sleeper);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    stop: () => {
      clearInterval(timer);
      sleepers = [];
    },
  };
}
