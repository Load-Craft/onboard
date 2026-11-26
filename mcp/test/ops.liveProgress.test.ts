import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '../src/log.js';
import {
  ENDED_RECENT_MS,
  createLiveProgress,
  listEnded,
  listLive,
  parseMessage,
} from '../src/ops/liveProgress.js';
import { forgetOperation, recordOperation } from '../src/ops/operation.js';
import { createStateCache, type StateCache } from '../src/workspace/cache.js';
import { createTestClock, type TestClock } from './helpers/clock.js';
import { NEW_KEY } from '../src/workspace/processState.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { noopSecretScope } from './helpers/scope.js';

/** A heartbeat driven by the test clock: it ticks when the test moves time past it. */
function clockEvery(clock: TestClock) {
  return (ms: number, tick: () => void): (() => void) => {
    const stop = new AbortController();
    void (async () => {
      for (;;) {
        await clock.sleep(ms, stop.signal);
        tick();
      }
    })().catch(() => undefined);
    return () => {
      stop.abort();
    };
  };
}
/** A heartbeat that never ticks: the server process of the call is gone. */
const never = (): (() => void) => () => undefined;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(secret?: string): {
  state: StateCache;
  clock: ReturnType<typeof createTestClock>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'live-'));
  dirs.push(dir);
  const clock = createTestClock(1_000_000);
  const state = createStateCache(dir, {
    logger: createLogger({ level: 'error', sink: () => undefined }),
    secrets: {
      containsSecret: (value) => secret !== undefined && JSON.stringify(value).includes(secret),
      scrub: (text) => text,
      scrubDeep: (value) => value,
    },
    clock,
  });
  return { state, clock };
}

describe('parseMessage', () => {
  it('splits the trailing percent and the counter from the stage', () => {
    expect(parseMessage('scenario 2/3 · Cart: Generating feeder data... (50%)')).toEqual({
      stage: 'scenario 2/3 · Cart: Generating feeder data...',
      percent: 50,
      n: 2,
      m: 3,
    });
  });
  it('has no counter in a path-like text and none when n exceeds m', () => {
    expect(parseMessage('GET /a/1/2/b')).toEqual({ stage: 'GET /a/1/2/b' });
    expect(parseMessage('step 5/3')).toEqual({ stage: 'step 5/3' });
  });
  it('cuts the stage to one clean line', () => {
    const parsed = parseMessage(`a\n${String.fromCharCode(27)}[31m${'x'.repeat(400)}`);
    expect(parsed.stage).not.toContain('\n');
    expect(parsed.stage).not.toContain(String.fromCharCode(27));
    expect([...parsed.stage].length).toBeLessThanOrEqual(160);
  });
});

describe('createLiveProgress writes', () => {
  it('writes only the newest text when reports pile up behind a write', async () => {
    const { state, clock } = setup();
    let writes = 0;
    const counting: StateCache = {
      ...state,
      setProgress: (call, bar, options) => {
        writes += 1;
        return state.setProgress(call, bar, options);
      },
    };
    const live = createLiveProgress(counting, clock, 'process_wait');
    for (const fraction of [0.1, 0.2, 0.3, 0.4, 0.5])
      live.report(`step (${fraction * 100}%)`, fraction);
    await live.settled();
    expect(writes).toBe(1);
    expect(listLive(state, clock.now())[0]?.percent).toBe(50);
  });

  it('a write that failed does not stop the ones after it: the bar is still removed at the end', async () => {
    const { state, clock } = setup();
    let failNext = true;
    const flaky: StateCache = {
      ...state,
      setProgress: (call, bar, options) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('disk full'));
        }
        return state.setProgress(call, bar, options);
      },
    };
    const live = createLiveProgress(flaky, clock, 'process_wait');
    live.report('x', 0.5);
    await live.settled();
    live.report('y', 0.7);
    await live.settled();
    expect(listLive(state, clock.now())).toHaveLength(1);
    await live.end('done');
    expect(listLive(state, clock.now())).toEqual([]);
  });

  it('writes a bar with the short lock wait, so a held lock never stalls the call', async () => {
    const { state, clock } = setup();
    const quick: boolean[] = [];
    const spy: StateCache = {
      ...state,
      setProgress: (call, bar, options) => {
        quick.push(options?.quick === true);
        return state.setProgress(call, bar, options);
      },
    };
    const live = createLiveProgress(spy, clock, 'process_wait');
    live.report('x', 0.5);
    await live.settled();
    expect(quick).toEqual([true]);
  });
});

describe('createLiveProgress', () => {
  it('writes a bar with the tool, stage, percent, counter and start of the call', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'scenario_generate');
    live.report('scenario 2/3 · Cart: Generating (50%)', 0.5);
    await live.settled();
    expect(listLive(state, clock.now())).toEqual([
      {
        key: expect.stringMatching(/^scenario_generate:\d+:1000000$/u) as unknown,
        call: expect.stringMatching(/^scenario_generate:\d+:1000000$/u) as unknown,
        tool: 'scenario_generate',
        stage: 'scenario 2/3 · Cart: Generating',
        percent: 50,
        n: 2,
        m: 3,
        startedAt: new Date(1_000_000).toISOString(),
        updatedAt: new Date(1_000_000).toISOString(),
        open: true,
      },
    ]);
  });

  it('has no percent when the kind knows none', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'project_analyze_setup');
    live.report('Analysing the project');
    await live.settled();
    const [row] = listLive(state, clock.now());
    expect(row?.percent).toBeUndefined();
    expect(row?.stage).toBe('Analysing the project');
  });

  it('writes at most once a second unless the percent moves, and the last text when attached', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'process_wait');
    live.report('a', 0.1);
    await clock.advance(200);
    live.report('b', 0.1);
    await live.settled();
    expect(listLive(state, clock.now())[0]?.stage).toBe('a');
    live.report('c', 0.2);
    await live.settled();
    expect(listLive(state, clock.now())[0]?.percent).toBe(20);
    live.report('d', 0.2);
    live.attach('self_check:sc-1');
    await live.settled();
    expect(listLive(state, clock.now())[0]).toMatchObject({
      stage: 'd',
      handle: 'self_check:sc-1',
    });
  });

  it('keeps the bar of the call when it names its operation, and shows the operation on the row', async () => {
    const { state, clock } = setup();
    await recordOperation(state, { kind: 'analysis', id: 'a1', startedAt: 900_000, saved: {} });
    await clock.advance(2000);
    const live = createLiveProgress(state, clock, 'process_wait');
    live.report('x', 0.1);
    await live.settled();
    // before the call names it, the operation is drawn from its row as well, closed
    const listed = listLive(state, clock.now());
    expect(listed.map((row) => row.open)).toEqual([false, true]);
    const before = listed[1];
    live.attach('analysis:a1');
    await live.settled();
    const rows = listLive(state, clock.now());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      call: before?.call,
      tool: 'process_wait',
      handle: 'analysis:a1',
      kind: 'analysis',
      percent: 10,
      open: true,
    });
    const row = JSON.parse(
      readFileSync(join(dirs[0] ?? '', 'loadcraft/.cache/state.json'), 'utf8'),
    ) as {
      process: Record<string, { operations: { progress?: { percent?: number } }[] }>;
    };
    expect(Object.values(row.process)[0]?.operations[0]?.progress?.percent).toBe(10);
  });

  it('removes the bar when the call ends, whatever became of the operation', async () => {
    const { state, clock } = setup();
    for (const status of ['done', 'failed', 'running', 'needs_user'] as const) {
      const live = createLiveProgress(state, clock, 'process_wait');
      live.attach('test_run:r1');
      live.report('x', 0.5);
      await live.end(status);
      expect(listLive(state, clock.now())).toEqual([]);
    }
  });

  it('keeps the bar for as long as the call runs, however quiet it is: the call writes it again every 30 s', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'a', { every: clockEvery(clock) });
    live.report('x');
    await live.settled();
    for (let i = 0; i < 10; i += 1) {
      await clock.advance(30_000);
      await live.settled();
    }
    const [row] = listLive(state, clock.now());
    expect(row).toMatchObject({ open: true, stage: 'x' });
    expect(clock.now() - Date.parse(row?.updatedAt ?? '')).toBeLessThanOrEqual(30_000);
    await live.end('done');
  });

  it('stops writing the bar again once the call ended', async () => {
    const { state, clock } = setup();
    let writes = 0;
    const counting: StateCache = {
      ...state,
      setProgress: (call, bar, options) => {
        writes += 1;
        return state.setProgress(call, bar, options);
      },
    };
    const live = createLiveProgress(counting, clock, 'a', { every: clockEvery(clock) });
    live.report('x');
    await live.settled();
    await live.end('done');
    const after = writes;
    await clock.advance(5 * 60_000);
    await live.settled();
    expect(writes).toBe(after);
    expect(listLive(state, clock.now())).toEqual([]);
  });

  it('forgets the bar of a call that stopped writing it (its server is gone) after 150 s', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'a', { every: never });
    live.report('x');
    await live.settled();
    await clock.advance(149_000);
    expect(listLive(state, clock.now())).toHaveLength(1);
    await clock.advance(2000);
    expect(listLive(state, clock.now())).toEqual([]);
    // only reads (a client asks every 5 s): nothing writes the file, the bar stays gone
    for (let i = 0; i < 6; i += 1) {
      await clock.advance(5000);
      expect(listLive(state, clock.now())).toEqual([]);
    }
    expect(clock.now() - 1_000_000).toBeGreaterThanOrEqual(180_000);
  });

  it('keeps a closed row while the operation is listed as running, and only then', async () => {
    const { state, clock } = setup();
    await recordOperation(state, { kind: 'test_run', id: 'r1', startedAt: 900_000, saved: {} });
    const live = createLiveProgress(state, clock, 'run_start', { every: never });
    live.attach('test_run:r1');
    live.report('Running 2/3 (50%)', 0.5);
    await live.end('running');
    expect(listLive(state, clock.now())).toEqual([
      {
        key: 'test_run:r1',
        call: 'test_run:r1',
        // the tool that saved the operation (this cache names none, so its kind)
        tool: 'test_run',
        handle: 'test_run:r1',
        kind: 'test_run',
        stage: 'Running 2/3',
        percent: 50,
        n: 2,
        m: 3,
        startedAt: new Date(900_000).toISOString(),
        updatedAt: new Date(1_000_000).toISOString(),
        open: false,
      },
    ]);
    // a row that something keeps refreshing (a wait that saves the operation again) is listed on
    await clock.advance(20 * 60_000);
    await recordOperation(state, {
      kind: 'test_run',
      id: 'r1',
      startedAt: 900_000,
      saved: { at: 1 },
    });
    await clock.advance(20 * 60_000);
    expect(listLive(state, clock.now())).toMatchObject([{ handle: 'test_run:r1', open: false }]);
    // a row that waits for the user is still running; one that ended is not drawn
    const store = createProcessStore(dirs[0] ?? '', { secrets: noopSecretScope(), clock });
    const status = (value: 'waiting_user' | 'done') =>
      store.write(NEW_KEY, (p) => ({
        ...p,
        operations: p.operations.map((row) => ({ ...row, status: value })),
      }));
    await status('waiting_user');
    expect(listLive(state, clock.now())).toMatchObject([{ handle: 'test_run:r1', open: false }]);
    await status('done');
    expect(listLive(state, clock.now())).toEqual([]);
  });

  it('does not draw an operation nobody waits for: a row not updated for 30 min', async () => {
    const { state, clock } = setup();
    await recordOperation(state, { kind: 'test_run', id: 'q1', startedAt: 900_000, saved: {} });
    await clock.advance(30 * 60_000);
    expect(listLive(state, clock.now())).toMatchObject([{ handle: 'test_run:q1', open: false }]);
    await clock.advance(1000);
    expect(listLive(state, clock.now())).toEqual([]);
  });

  it('draws one bar for an operation a running call follows: the open one', async () => {
    const { state, clock } = setup();
    await recordOperation(state, { kind: 'test_run', id: 'r2', startedAt: 900_000, saved: {} });
    const live = createLiveProgress(state, clock, 'process_wait', { every: never });
    live.attach('test_run:r2');
    live.report('x', 0.5);
    await live.settled();
    expect(listLive(state, clock.now())).toMatchObject([{ handle: 'test_run:r2', open: true }]);
    await live.end('done');
    await forgetOperation(state, 'test_run:r2');
    expect(listLive(state, clock.now())).toEqual([]);
  });

  it('shows an operation with no progress yet by its kind', async () => {
    const { state, clock } = setup();
    await recordOperation(state, { kind: 'test_run', id: 'r3', startedAt: 900_000, saved: {} });
    expect(listLive(state, clock.now())).toMatchObject([
      { handle: 'test_run:r3', stage: 'test_run', open: false },
    ]);
  });

  it('never fails the call when the state refuses the write (a secret in the text)', async () => {
    const { state, clock } = setup('hunter2');
    const live = createLiveProgress(state, clock, 'process_wait');
    live.report('password hunter2', 0.5);
    live.attach('test_run:r1');
    await expect(live.end('done')).resolves.toBeUndefined();
    expect(listLive(state, clock.now())).toEqual([]);
  });
});

describe('operations a call ended while it goes on', () => {
  const ended = (handle: string, status: 'done' | 'failed') => ({
    handle,
    kind: 'scenario_generation' as const,
    module: 'scenario' as const,
    tool: 'scenario_generate',
    status,
    started_at: new Date(900_000).toISOString(),
  });

  it('draws one bar for a call on its third operation after two it ended: the ended rows are not drawn', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'scenario_generate', { every: never });
    for (const id of ['g1', 'g2', 'g3']) {
      await recordOperation(state, {
        kind: 'scenario_generation',
        id,
        startedAt: clock.now(),
        saved: {},
      });
      live.attach(`scenario_generation:${id}`);
      live.report(`scenario ${id}: Planning scenario structure (17%)`, 0.17);
      await live.settled();
      if (id !== 'g3') state.endOperation(ended(`scenario_generation:${id}`, 'failed'));
      await clock.advance(2000);
    }
    await live.settled();
    // the rows of g1 and g2 still say running: the registry writes them when the call ends
    expect(state.runningOperations().map((row) => row.handle)).toHaveLength(3);
    expect(listLive(state, clock.now())).toMatchObject([
      { handle: 'scenario_generation:g3', open: true },
    ]);
    await live.end('failed');
    const file = JSON.parse(
      readFileSync(join(dirs[0] ?? '', 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(file['callEnded']).toBeUndefined();
  });

  it('draws an operation again once the call records it anew (the end was taken back)', async () => {
    const { state, clock } = setup();
    const live = createLiveProgress(state, clock, 'scenario_generate', { every: never });
    await recordOperation(state, {
      kind: 'scenario_generation',
      id: 'a',
      startedAt: clock.now(),
      saved: {},
    });
    await recordOperation(state, {
      kind: 'scenario_generation',
      id: 'b',
      startedAt: clock.now(),
      saved: {},
    });
    live.attach('scenario_generation:a');
    live.report('a', 0.5);
    await live.settled();
    state.endOperation(ended('scenario_generation:a', 'done'));
    live.attach('scenario_generation:b');
    await live.settled();
    expect(listLive(state, clock.now())).toHaveLength(1);
    await recordOperation(state, {
      kind: 'scenario_generation',
      id: 'a',
      startedAt: clock.now(),
      saved: { again: 1 },
    });
    live.report('b', 0.6);
    await clock.advance(2000);
    live.report('b', 0.7);
    await live.settled();
    expect(
      listLive(state, clock.now())
        .map((row) => [row.handle, row.open])
        .sort(),
    ).toEqual([
      ['scenario_generation:a', false],
      ['scenario_generation:b', true],
    ]);
  });
});

describe('listEnded', () => {
  it('lists how the operations that ended in the last minute ended, newest first; lost is failed', async () => {
    const { state, clock } = setup();
    for (const id of ['d', 'f', 'c', 'l', 'r']) {
      await recordOperation(state, { kind: 'test_run', id, startedAt: clock.now(), saved: {} });
    }
    const store = createProcessStore(dirs[0] ?? '', { secrets: noopSecretScope(), clock });
    const end = (id: string, status: 'done' | 'failed' | 'cancelled' | 'lost') =>
      store.write(NEW_KEY, (p, now) => ({
        ...p,
        operations: p.operations.map((row) =>
          row.handle === `test_run:${id}` ? { ...row, status, updated_at: now } : row,
        ),
      }));
    await end('d', 'done');
    await clock.advance(1000);
    await end('f', 'failed');
    await clock.advance(1000);
    await end('c', 'cancelled');
    await clock.advance(1000);
    await end('l', 'lost');
    expect(listEnded(state, clock.now())).toEqual([
      { handle: 'test_run:l', status: 'failed' },
      { handle: 'test_run:c', status: 'cancelled' },
      { handle: 'test_run:f', status: 'failed' },
      { handle: 'test_run:d', status: 'done' },
    ]);
    // f ended a second before c: half a second past its minute it is not listed, c is
    await clock.advance(ENDED_RECENT_MS - 1500);
    expect(listEnded(state, clock.now()).map((row) => row.handle)).toEqual([
      'test_run:l',
      'test_run:c',
    ]);
  });
});
