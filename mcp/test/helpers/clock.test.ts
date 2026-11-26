import { createServer, connect, type Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import { beginWork, createTestClock, realTurn, settleClock, type SteppedClock } from './clock.js';

/** A loopback echo server and a client that sends `rounds` messages, each after the echo of the last. */
async function echoChain(rounds: number): Promise<{ done: Promise<number>; close(): void }> {
  const server = createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  const client: Socket = connect(address.port, '127.0.0.1');
  const done = new Promise<number>((resolve, reject) => {
    let echoed = 0;
    client.on('error', reject);
    client.on('connect', () => client.write('x'));
    client.on('data', () => {
      echoed += 1;
      if (echoed === rounds) resolve(echoed);
      else client.write('x');
    });
  });
  return {
    done,
    close: () => {
      client.destroy();
      server.close();
    },
  };
}

/** The clock with every `advance` recorded in `steps`. */
function watch(clock: SteppedClock, steps: number[]): { clock: SteppedClock } {
  return {
    clock: {
      ...clock,
      advance: async (ms: number) => {
        steps.push(ms);
        await clock.advance(ms);
      },
    },
  };
}

/** Settles once the test clock has reached `ms`: a call that only ends because time passed. */
function reachesMs(clock: SteppedClock, ms: number): Promise<number> {
  return new Promise<number>((resolve) => {
    const timer = setInterval(() => {
      if (clock.now() >= ms) {
        clearInterval(timer);
        resolve(clock.now());
      }
    }, 2);
  });
}

describe('settleClock', () => {
  it('does not move the clock while real I/O is still on its way', async () => {
    const clock = createTestClock();
    // Somebody waits on the clock (as a handshake deadline or a poll does): the wake-up is due at once.
    void clock.sleep(500);
    const chain = await echoChain(6);
    try {
      // The chain is still in flight: a step of test time now would land before its end.
      const echoed = await settleClock({ clock }, chain.done);
      expect(echoed).toBe(6);
      expect(clock.now()).toBe(0);
    } finally {
      chain.close();
    }
  });

  it('moves the clock when nothing is in flight and somebody sleeps', async () => {
    const clock = createTestClock();
    const woke = clock.sleep(2500).then(() => clock.now());
    expect(await settleClock({ clock }, woke)).toBe(2500);
  });

  it('jumps to the earliest wake-up in one step: exactly there, never past it', async () => {
    const clock = createTestClock();
    const steps: number[] = [];
    const watched = {
      clock: {
        ...clock,
        advance: async (ms: number) => {
          steps.push(ms);
          await clock.advance(ms);
        },
      },
    };
    // Two sleepers: the call ends with the first, the second is far off and must stay asleep.
    const woke = clock.sleep(2500).then(() => clock.now());
    const late = clock.sleep(90_000).then(() => clock.now());
    expect(await settleClock(watched, woke)).toBe(2500);
    expect(steps).toEqual([2500]);
    expect(clock.nextWakeAt()).toBe(90_000);
    clock.advance(90_000).catch(() => undefined);
    expect(await late).toBe(90_000);
  });

  it('never moves the clock past limitMs in one jump', async () => {
    const clock = createTestClock();
    const steps: number[] = [];
    const watched = watch(clock, steps);
    void clock.sleep(10_000);
    const call = reachesMs(clock, 2000);
    expect(await settleClock(watched, call, { limitMs: 2000 })).toBe(2000);
    expect(steps).toEqual([2000]);
    expect(clock.now()).toBe(2000);
  });

  it('keeps a step cap when the caller asks for one', async () => {
    const clock = createTestClock();
    const steps: number[] = [];
    const watched = watch(clock, steps);
    void clock.sleep(10_000);
    const call = reachesMs(clock, 2000);
    expect(await settleClock(watched, call, { stepMs: 1000, limitMs: 2000 })).toBe(2000);
    expect(steps).toEqual([1000, 1000]);
  });
});

describe('realTurn', () => {
  /** Reports `names` as active resources until `release()` is called, then none. */
  function holdResources(names: string[]): { release(): void; restore(): void } {
    let held = true;
    const spy = vi
      .spyOn(process, 'getActiveResourcesInfo')
      .mockImplementation(() => (held ? names : []));
    return { release: () => (held = false), restore: () => spy.mockRestore() };
  }

  it('waits for the close of a file handle (CloseReq) that has not come back', async () => {
    const hold = holdResources(['CloseReq']);
    let returned = false;
    const turn = realTurn(1).then(() => (returned = true));
    try {
      await new Promise<void>((done) => setTimeout(done, 100));
      expect(returned).toBe(false);
      hold.release();
      await turn;
      expect(returned).toBe(true);
    } finally {
      hold.release();
      hold.restore();
    }
  });

  it('gives what a late answer continues passes of the loop before it returns', async () => {
    const hold = holdResources(['FSReqPromise']);
    let hops = 0;
    const turn = realTurn(1);
    try {
      await new Promise<void>((done) => setTimeout(done, 50));
      // The request comes back late and its continuation needs a chain of loop passes (the next request of the call).
      hold.release();
      const chain = async (): Promise<void> => {
        for (let i = 0; i < 10; i += 1) {
          await new Promise<void>((done) => setImmediate(done));
          hops += 1;
        }
      };
      void chain();
      await turn;
      expect(hops).toBe(10);
    } finally {
      hold.release();
      hold.restore();
    }
  });
});

describe('settleClock: the guard of the clock', () => {
  /** Reports `names` as the active resources while the returned spy is in place. */
  function activeResources(names: string[]): { mockRestore(): void } {
    return vi.spyOn(process, 'getActiveResourcesInfo').mockImplementation(() => names);
  }

  it('fails the call with the name of a pending resource it does not know, instead of moving', async () => {
    const clock = createTestClock();
    const steps: number[] = [];
    void clock.sleep(1000);
    const spy = activeResources(['TCPSocketWrap', 'Timeout', 'MessagePort']);
    try {
      await expect(
        settleClock(watch(clock, steps), reachesMs(clock, 1000), { turnMs: 1 }),
      ).rejects.toThrow(/MessagePort/u);
      expect(steps).toEqual([]);
      expect(clock.now()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('moves past the handles that only wait for outside events', async () => {
    const clock = createTestClock();
    void clock.sleep(1000);
    const spy = activeResources([
      'TCPServerWrap',
      'TCPSocketWrap',
      'PipeWrap',
      'Timeout',
      'Immediate',
      'TTYWrap',
      'ProcessWrap',
      'SignalWrap',
      'FSEventWrap',
    ]);
    try {
      expect(await settleClock({ clock }, reachesMs(clock, 1000), { turnMs: 1 })).toBe(1000);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not move while a test double has work in progress, and moves once it is done', async () => {
    const clock = createTestClock();
    void clock.sleep(1000);
    const work = beginWork('GET /api/v1/x');
    let moved = false;
    const call = settleClock({ clock }, reachesMs(clock, 1000), { turnMs: 1 }).then((at) => {
      moved = true;
      return at;
    });
    await new Promise<void>((done) => setTimeout(done, 60));
    expect(moved).toBe(false);
    expect(clock.now()).toBe(0);
    work.done();
    expect(await call).toBe(1000);
  });

  it('counts work that sleeps on the test clock as waiting, not as work in progress', async () => {
    const clock = createTestClock();
    const work = beginWork('GET /api/v1/slow');
    const answered = work
      .run(() => clock.sleep(30_000))
      .then(() => {
        work.done();
        return clock.now();
      });
    // A turn that waited for the work would only move on at its real-time limit, with a warning.
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      expect(await settleClock({ clock }, answered, { turnMs: 1 })).toBe(30_000);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
