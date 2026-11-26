// One polling loop shared by every long operation: bounded by a deadline, abortable at any
// moment (also mid-sleep), tolerant of a few transient read failures.

import { abortError, type Clock } from './clock.js';

export interface PollOptions<T> {
  isTerminal(state: T): boolean;
  /** Fixed delay, or a function of the 1-based attempt number. Default: 2000 ms growing to 5000 ms. */
  intervalMs?: number | ((attempt: number) => number);
  deadlineMs: number;
  signal: AbortSignal;
  clock: Clock;
  onState?(state: T, elapsedMs: number): void | Promise<void>;
}

export interface PollResult<T> {
  state: T;
  timedOut: boolean;
}

/** Consecutive transient failures tolerated before the error is passed on. */
const MAX_RETRYABLE_RETRIES = 3;

const DEFAULT_START_MS = 2000;
const DEFAULT_STEP_MS = 1000;
const DEFAULT_MAX_MS = 5000;

function defaultInterval(attempt: number): number {
  return Math.min(DEFAULT_MAX_MS, DEFAULT_START_MS + (attempt - 1) * DEFAULT_STEP_MS);
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'retryable' in error && error.retryable === true
  );
}

/** Settles with `work`, or rejects with an AbortError the moment `signal` aborts, whatever `work` does. */
async function raceAbort<R>(work: () => Promise<R>, signal: AbortSignal): Promise<R> {
  if (signal.aborted) throw abortError(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

export async function pollUntil<T>(
  read: () => Promise<T>,
  opts: PollOptions<T>,
): Promise<PollResult<T>> {
  const { deadlineMs, signal, clock } = opts;
  const interval = opts.intervalMs ?? defaultInterval;
  const delayFor = (attempt: number): number =>
    typeof interval === 'function' ? interval(attempt) : interval;

  const start = clock.now();
  let attempt = 0;
  let failures = 0;
  let last: { state: T } | undefined;
  let lastError: unknown;

  for (;;) {
    if (signal.aborted) throw abortError(signal);
    attempt += 1;
    let fresh: { state: T } | undefined;
    try {
      fresh = { state: await raceAbort(read, signal) };
      failures = 0;
      last = fresh;
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      failures += 1;
      if (!isRetryable(error) || failures > MAX_RETRYABLE_RETRIES) throw error;
      lastError = error;
    }

    if (fresh !== undefined) {
      await opts.onState?.(fresh.state, clock.now() - start);
      if (opts.isTerminal(fresh.state)) return { state: fresh.state, timedOut: false };
    }

    const remaining = deadlineMs - (clock.now() - start);
    if (remaining <= 0) {
      if (last === undefined) throw lastError;
      return { state: last.state, timedOut: true };
    }
    await raceAbort(() => clock.sleep(Math.min(delayFor(attempt), remaining), signal), signal);
  }
}
