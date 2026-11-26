import { afterEach, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../src/ops/clock.js';
import { pollUntil } from '../src/ops/poll.js';
import { createTestClock, type TestClock } from './helpers/clock.js';

interface State {
  readonly n: number;
  readonly done: boolean;
}

class RetryableError extends Error {
  readonly retryable = true;
}

function clockOf(test = createTestClock()) {
  return { test, clock: test };
}

/** Lets the first read settle (registering the first sleeper) before time moves. */
async function flushThen(test: TestClock, ms: number): Promise<void> {
  await test.advance(0);
  await test.advance(ms);
}

describe('pollUntil', () => {
  it('returns the terminal state after three reads', async () => {
    const { test, clock } = clockOf();
    let n = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (n += 1), done: n === 3 }), {
      isTerminal: (s) => s.done,
      intervalMs: 1000,
      deadlineMs: 60_000,
      signal: new AbortController().signal,
      clock,
    });
    await flushThen(test, 10_000);
    await expect(result).resolves.toEqual({ state: { n: 3, done: true }, timedOut: false });
    expect(n).toBe(3);
  });

  it('returns the last state with timedOut once the deadline passes', async () => {
    const { test, clock } = clockOf();
    let n = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (n += 1), done: false }), {
      isTerminal: (s) => s.done,
      intervalMs: 1000,
      deadlineMs: 2500,
      signal: new AbortController().signal,
      clock,
    });
    await flushThen(test, 10_000);
    const out = await result;
    expect(out.timedOut).toBe(true);
    expect(out.state.n).toBe(n);
    expect(test.now()).toBeLessThanOrEqual(10_000);
  });

  it('rejects with AbortError immediately when aborted during sleep', async () => {
    const { test, clock } = clockOf();
    const controller = new AbortController();
    const result = pollUntil<State>(() => Promise.resolve({ n: 1, done: false }), {
      isTerminal: (s) => s.done,
      intervalMs: 5000,
      deadlineMs: 60_000,
      signal: controller.signal,
      clock,
    });
    await flushThen(test, 1000);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects at once when the signal is already aborted', async () => {
    const { clock } = clockOf();
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollUntil<State>(() => Promise.resolve({ n: 1, done: true }), {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 1000,
        signal: controller.signal,
        clock,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('survives two retryable errors and then succeeds', async () => {
    const { test, clock } = clockOf();
    let calls = 0;
    const result = pollUntil<State>(
      () => {
        calls += 1;
        if (calls <= 2) return Promise.reject(new RetryableError('flaky'));
        return Promise.resolve({ n: calls, done: true });
      },
      {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 60_000,
        signal: new AbortController().signal,
        clock,
      },
    );
    await flushThen(test, 10_000);
    await expect(result).resolves.toEqual({ state: { n: 3, done: true }, timedOut: false });
  });

  it('rethrows after four consecutive retryable errors', async () => {
    const { test, clock } = clockOf();
    let calls = 0;
    const result = pollUntil<State>(
      () => {
        calls += 1;
        return Promise.reject(new RetryableError(`flaky ${String(calls)}`));
      },
      {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 60_000,
        signal: new AbortController().signal,
        clock,
      },
    );
    const assertion = expect(result).rejects.toThrow('flaky 4');
    await flushThen(test, 10_000);
    await assertion;
    expect(calls).toBe(4);
  });

  it('rethrows a non-retryable error at once', async () => {
    const { clock } = clockOf();
    let calls = 0;
    await expect(
      pollUntil<State>(
        () => {
          calls += 1;
          return Promise.reject(new Error('fatal'));
        },
        {
          isTerminal: (s) => s.done,
          intervalMs: 1000,
          deadlineMs: 60_000,
          signal: new AbortController().signal,
          clock,
        },
      ),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });

  it('calls onState for every read with elapsed time', async () => {
    const { test, clock } = clockOf();
    const seen: Array<[number, number]> = [];
    let n = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (n += 1), done: n === 3 }), {
      isTerminal: (s) => s.done,
      intervalMs: 1000,
      deadlineMs: 60_000,
      signal: new AbortController().signal,
      clock,
      onState: (s, elapsed) => {
        seen.push([s.n, elapsed]);
      },
    });
    await flushThen(test, 10_000);
    await result;
    expect(seen).toEqual([
      [1, 0],
      [2, 1000],
      [3, 2000],
    ]);
  });

  it('defaults to 2000 ms growing to 5000 ms and accepts an interval function', async () => {
    const { test, clock } = clockOf();
    const times: number[] = [];
    let n = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (n += 1), done: n === 6 }), {
      isTerminal: (s) => s.done,
      deadlineMs: 600_000,
      signal: new AbortController().signal,
      clock,
      onState: (_s, elapsed) => {
        times.push(elapsed);
      },
    });
    await flushThen(test, 60_000);
    await result;
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps[0]).toBe(2000);
    expect(Math.max(...gaps)).toBe(5000);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));

    const { test: t2, clock: c2 } = clockOf();
    const seenAttempts: number[] = [];
    let m = 0;
    const r2 = pollUntil<State>(() => Promise.resolve({ n: (m += 1), done: m === 3 }), {
      isTerminal: (s) => s.done,
      intervalMs: (attempt) => {
        seenAttempts.push(attempt);
        return 100;
      },
      deadlineMs: 60_000,
      signal: new AbortController().signal,
      clock: c2,
    });
    await flushThen(t2, 1000);
    await r2;
    expect(seenAttempts).toEqual([1, 2]);
  });

  it('rejects at once when aborted while a read is hanging', async () => {
    const { clock } = clockOf();
    const controller = new AbortController();
    const result = pollUntil<State>(() => new Promise<State>(() => undefined), {
      isTerminal: (s) => s.done,
      intervalMs: 1000,
      deadlineMs: 60_000,
      signal: controller.signal,
      clock,
    });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });

  it('stops reading after an abort during sleep', async () => {
    const { test, clock } = clockOf();
    const controller = new AbortController();
    let reads = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (reads += 1), done: false }), {
      isTerminal: (s) => s.done,
      intervalMs: 1000,
      deadlineMs: 60_000,
      signal: controller.signal,
      clock,
    });
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await flushThen(test, 1500);
    controller.abort();
    await assertion;
    await test.advance(10_000);
    expect(reads).toBe(2);
  });

  it('resets the retry budget after a successful read', async () => {
    const { test, clock } = clockOf();
    // 3 errors, ok (not terminal), 3 errors, ok (terminal)
    const script = ['e', 'e', 'e', 'ok', 'e', 'e', 'e', 'done'] as const;
    let i = 0;
    const result = pollUntil<State>(
      () => {
        const step = script[i];
        i += 1;
        if (step === 'e') return Promise.reject(new RetryableError('flaky'));
        return Promise.resolve({ n: i, done: step === 'done' });
      },
      {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 600_000,
        signal: new AbortController().signal,
        clock,
      },
    );
    await flushThen(test, 60_000);
    await expect(result).resolves.toEqual({ state: { n: 8, done: true }, timedOut: false });
  });

  it('clips the last sleep to the remaining time when the deadline is shorter than the interval', async () => {
    const { test, clock } = clockOf();
    let reads = 0;
    const result = pollUntil<State>(() => Promise.resolve({ n: (reads += 1), done: false }), {
      isTerminal: (s) => s.done,
      intervalMs: 2000,
      deadlineMs: 500,
      signal: new AbortController().signal,
      clock,
    });
    await flushThen(test, 10_000);
    await expect(result).resolves.toEqual({ state: { n: 2, done: false }, timedOut: true });
    expect(reads).toBe(2);
  });

  it('throws the transient error when the deadline passes before any state was read', async () => {
    const { clock } = clockOf();
    await expect(
      pollUntil<State>(() => Promise.reject(new RetryableError('flaky')), {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 0,
        signal: new AbortController().signal,
        clock,
      }),
    ).rejects.toThrow('flaky');
  });

  it('does not re-read when onState throws a retryable error', async () => {
    const { clock } = clockOf();
    let reads = 0;
    await expect(
      pollUntil<State>(() => Promise.resolve({ n: (reads += 1), done: false }), {
        isTerminal: (s) => s.done,
        intervalMs: 1000,
        deadlineMs: 60_000,
        signal: new AbortController().signal,
        clock,
        onState: () => {
          throw new RetryableError('from onState');
        },
      }),
    ).rejects.toThrow('from onState');
    expect(reads).toBe(1);
  });
});

describe('systemClock.sleep', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves no timer behind after an abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = systemClock.sleep(5000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wakes after the delay and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const sleeping = systemClock.sleep(5000, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    await sleeping;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(systemClock.sleep(5000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
