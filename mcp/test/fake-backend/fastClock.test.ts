import { describe, expect, it } from 'vitest';

import { createFastClock } from './fastClock.js';

/** Blocks the thread: what a busy machine does to the event loop. */
function stall(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy
  }
}

describe('createFastClock', () => {
  it('runs faster than the real one by the given factor', async () => {
    const clock = createFastClock(100);
    try {
      const before = clock.now();
      await clock.sleep(5000, new AbortController().signal);
      expect(clock.now() - before).toBeGreaterThanOrEqual(5000);
    } finally {
      clock.stop();
    }
  });

  it('does not jump when the process stalls: a stall counts for a few ticks, not for its length', async () => {
    const clock = createFastClock(600);
    try {
      await new Promise<void>((done) => setTimeout(done, 20));
      const before = clock.now();
      stall(300);
      await new Promise<void>((done) => setTimeout(done, 20));
      // 300 ms stalled at speed 600 would be 180 s; the clock counted a handful of ticks of it (the 20 ms wait counts too: 12 s).
      expect(clock.now() - before).toBeLessThan(60_000);
    } finally {
      clock.stop();
    }
  });

  it('wakes what is due together in the order of its time, not of its creation', async () => {
    const clock = createFastClock(600);
    try {
      const order: string[] = [];
      const signal = new AbortController().signal;
      const late = clock.sleep(900, signal).then(() => order.push('late'));
      const early = clock.sleep(300, signal).then(() => order.push('early'));
      stall(50);
      await Promise.all([late, early]);
      expect(order).toEqual(['early', 'late']);
    } finally {
      clock.stop();
    }
  });

  it('rejects a sleep as soon as its signal aborts', async () => {
    const clock = createFastClock(1);
    try {
      const controller = new AbortController();
      const sleeping = clock.sleep(60_000, controller.signal);
      controller.abort();
      await expect(sleeping).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clock.stop();
    }
  });
});
