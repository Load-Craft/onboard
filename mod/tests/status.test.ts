// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest. The poll of the
// operation in progress, on the test clock: no real time passes. What the poller decides is in
// mod/test/poll.spec.ts; here the hook is checked: what it reads and when, what it draws, what it
// says to the user.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const TOOL = 'mcp__plugin_loadcraft_lc__run_start';
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const POLL_MS = 5_000;

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61', name: 'sklep' },
  environments: [{ name: 'perf', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 1, scenarios: 1, compositions: 1 },
  recentRuns: [],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

const snapshot = (elapsed: number, extra: Record<string, unknown> = {}) => ({
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: elapsed + 5,
  load_elapsed_s: elapsed,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
  ...extra,
});

const answer = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

// What the user sees and what the mod asked of the server, recorded; every call goes on to the kit.
const SENT = { isSent: true, channel: 'kitty' } as const;

function watch(on: Parameters<Parameters<typeof test>[2]>[1], sent: object = SENT) {
  const seen = {
    lines: [] as (string | undefined)[],
    toasts: [] as string[],
    notices: [] as string[],
    polls: 0,
    statusReads: 0,
    states: [] as Record<string, unknown>[],
    inflight: 0,
    maxInflight: 0,
    otherCalls: [] as string[],
  };
  on('ui.status', ($, e, next) => {
    seen.lines.push(e.text);
    return next(e);
  });
  on('ui.toast', ($, e, next) => {
    seen.toasts.push(e.text);
    return next(e);
  });
  on('state.set', ($, e, next) => {
    // The session state only; the live line of a running test keeps its own value.
    if (e.key === 'session') seen.states.push(e.value as Record<string, unknown>);
    return next(e);
  });
  on('ui.notify', ($, e) => {
    seen.notices.push(e.text);
    return { value: sent };
  });
  return seen;
}

// Answers the status read after a tool call with STATUS, and each poll read from `reads`. Every
// call of the server counts as in flight while it waits, so `maxInflight` is for both kinds.
function server(
  on: Parameters<Parameters<typeof test>[2]>[1],
  seen: ReturnType<typeof watch>,
  clock: ReturnType<typeof mock.clock>,
  reads: (poll: number) => unknown,
  delayMs = 0,
  statusDelayMs = 0,
  statusNow: () => unknown = () => STATUS,
) {
  on('mcp.call', async ($, e) => {
    if (e.tool !== 'process_get_status') seen.otherCalls.push(e.tool);
    // The bars of the operations in progress (bars.ts) read the plugin's own state file: not a status read.
    if (e.args['progress'] === true) return answer({ progress: [] });
    const isPoll = e.args['operation'] !== undefined;
    if (isPoll) seen.polls += 1;
    else seen.statusReads += 1;
    seen.inflight += 1;
    seen.maxInflight = Math.max(seen.maxInflight, seen.inflight);
    const poll = seen.polls;
    const wait = isPoll ? delayMs : statusDelayMs;
    if (wait > 0) await clock.sleep(wait);
    seen.inflight -= 1;
    if (!isPoll) return answer(statusNow());
    const data = reads(poll);
    return data === undefined ? { deny: 'server not connected' } : answer(data);
  });
}

async function begin(
  $: Parameters<Parameters<typeof test>[2]>[0],
  clock: ReturnType<typeof mock.clock>,
) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  // A test that runs: the result of run_start names the handle, the status confirms it.
  await $.tool.call({ tool: TOOL });
  await clock.settle();
}

function startedSession(on: Parameters<Parameters<typeof test>[2]>[1]) {
  on('session.start', () => ({ cwd: '/work' }));
  on('tool.call', () => ({
    ref: 1,
    result: `Still running: ${HANDLE}`,
    text: `Still running: ${HANDLE}`,
  }));
}

test('with no operation in progress nothing is read in 30 s', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, () => snapshot(10));
  on('session.start', () => ({ cwd: '/work' }));
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });

  await clock.advance(30_000);

  expect(seen.polls).toBe(0);
  expect(seen.lines).toEqual([]);
  expect(seen.notices).toEqual([]);
});

test('with an operation it reads once every 5 s and draws the line', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  let elapsed = 400;
  server(on, seen, clock, () => snapshot((elapsed += 5)));
  startedSession(on);
  await begin($, clock);
  expect(seen.polls).toBe(0);

  await clock.advance(POLL_MS);
  expect(seen.polls).toBe(1);
  await clock.advance(POLL_MS);
  expect(seen.polls).toBe(2);

  expect(seen.lines).toEqual([
    'LoadCraft · test 6:45 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
    'LoadCraft · test 6:50 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
  ]);
  // Only process_get_status is ever called, and the line carries nothing secret.
  expect(seen.otherCalls).toEqual([]);
  expect(JSON.stringify(seen)).not.toContain('CANARY-SECRET');
});

test('the line is drawn only when its text changes', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, () => snapshot(400));
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 4);

  expect(seen.polls).toBe(4);
  expect(seen.lines.length).toBe(1);
});

test('one read at a time, even when the server is slow', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, () => snapshot(400), 17_000);
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 6);

  expect(seen.maxInflight).toBe(1);
  // 30 s of ticks, a read of 17 s: the first read ends at 22 s (5 + 17), one more begins at 25 s.
  expect(seen.polls).toBe(2);
});

test(
  'a finished test is told once, the line goes and the poll stops',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    server(on, seen, clock, (poll) =>
      poll < 3 ? snapshot(590 + poll * 5) : snapshot(600, { phase: 'completed' }),
    );
    startedSession(on);
    await begin($, clock);

    await clock.advance(POLL_MS * 3);
    expect(seen.notices).toEqual(['Test zakończony · 690 żądań/s · p95≈ 910 ms · błędy 0,6%']);
    expect(seen.lines[seen.lines.length - 1]).toBeUndefined();

    const polls = seen.polls;
    await clock.advance(60_000);
    expect(seen.polls).toBe(polls);
    expect(seen.notices.length).toBe(1);
    expect(seen.toasts).toEqual([]);
  },
);

test(
  'an operation that came back after its end is neither read nor told again',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    server(on, seen, clock, (poll) =>
      poll < 2 ? snapshot(100) : snapshot(120, { phase: 'completed' }),
    );
    startedSession(on);
    await begin($, clock);
    await clock.advance(POLL_MS * 3);
    expect(seen.notices.length).toBe(1);
    const polls = seen.polls;

    // A later call of the model names the same handle again, and the status still lists it.
    await $.tool.call({ tool: TOOL });
    await clock.settle();
    await clock.advance(POLL_MS * 6);

    expect(seen.polls).toBe(polls);
    expect(seen.notices.length).toBe(1);
    expect(seen.toasts).toEqual([]);
    // The state, not only the reads: after the end no write puts the operation back in progress.
    const ended = seen.states.findIndex((state) => (state['ended'] as string[]).includes(HANDLE));
    expect(ended).toBeGreaterThan(-1);
    for (const state of seen.states.slice(ended)) expect(state['operation']).toBeUndefined();
  },
);

test('a failed test is told as a failure', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, (poll) =>
    poll < 2 ? snapshot(100) : snapshot(120, { phase: 'failed' }),
  );
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 3);

  expect(seen.notices.length).toBe(1);
  expect(seen.notices[0]).toMatch(/^Test nieudany/u);
});

test('a request of the user is told once, not at every read', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, (poll) =>
    poll < 2 ? snapshot(100) : snapshot(100 + poll, { needs_user: 'Log in to the shop' }),
  );
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 8);

  expect(seen.polls).toBe(8);
  expect(seen.notices).toEqual(['LoadCraft · czeka na użytkownika: Log in to the shop']);
});

test('a notification no channel sent comes as a toast', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on, { isSent: false, reason: 'no-channel' });
  server(on, seen, clock, (poll) =>
    poll < 2 ? snapshot(100) : snapshot(120, { phase: 'completed' }),
  );
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 3);

  expect(seen.notices.length).toBe(1);
  expect(seen.toasts).toEqual(seen.notices);
});

test('a bell that shows no text comes as a toast too', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on, { isSent: true, channel: 'terminal_bell' });
  server(on, seen, clock, (poll) =>
    poll < 2 ? snapshot(100) : snapshot(120, { phase: 'completed' }),
  );
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 3);

  expect(seen.toasts).toEqual(seen.notices);
  expect(seen.toasts.length).toBe(1);
});

test('a read that fails changes nothing and is tried less often', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, () => undefined);
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 20);

  expect(seen.polls).toBeGreaterThan(1);
  expect(seen.polls).toBeLessThan(10);
  expect(seen.lines).toEqual([]);
  expect(seen.notices).toEqual([]);
  expect(seen.toasts).toEqual([]);
});

test(
  'the result of the tool goes back as it came while the poll runs',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    server(on, seen, clock, () => snapshot(400));
    const returned = {
      ref: 1,
      result: `Still running: ${HANDLE}`,
      text: `Still running: ${HANDLE}`,
    };
    on('session.start', () => ({ cwd: '/work' }));
    on('tool.call', () => returned);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });

    const first = await $.tool.call({ tool: TOOL });
    await clock.advance(POLL_MS);
    const second = await $.tool.call({ tool: TOOL });

    expect(first).toEqual(returned);
    expect(second).toEqual(returned);
  },
);

test(
  'the poll and the status read of a tool call never run together',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    // Every call of the server takes 12 s, more than two ticks.
    server(on, seen, clock, () => snapshot(400), 12_000, 12_000);
    startedSession(on);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });

    // The status read after the call is running when the first ticks come.
    await $.tool.call({ tool: TOOL });
    await clock.advance(POLL_MS * 2);
    expect(seen.polls).toBe(0);
    // The status read ends at 13 s, the tick at 16 s starts a poll that runs until 28 s. A call that
    // arrives meanwhile queues a status read, it does not start one.
    await clock.advance(POLL_MS);
    expect(seen.polls).toBe(1);
    const reads = seen.statusReads;
    await $.tool.call({ tool: TOOL });
    await clock.advance(POLL_MS);
    expect(seen.statusReads).toBe(reads);
    await clock.advance(POLL_MS * 8);

    expect(seen.maxInflight).toBe(1);
    expect(seen.statusReads).toBeGreaterThanOrEqual(2);
  },
);

test(
  'a lost operation is told once as unknown, and the state drops it',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    server(on, seen, clock, (poll) => (poll < 2 ? snapshot(100) : undefined));
    startedSession(on);
    await begin($, clock);

    await clock.advance(POLL_MS * 150);

    expect(seen.notices.length).toBe(1);
    expect(seen.notices[0]).toContain('/loadcraft:status');
    expect(seen.notices[0]).toContain('process_get_status');
    expect(seen.lines[seen.lines.length - 1]).toBeUndefined();
    const last = seen.states[seen.states.length - 1];
    expect(last?.['operation']).toBeUndefined();
    expect(last?.['ended']).toContain(HANDLE);
    // And nothing reads it any more.
    const polls = seen.polls;
    await clock.advance(POLL_MS * 20);
    expect(seen.polls).toBe(polls);
  },
);

test('a request of the user that comes and goes is told once', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, (poll) =>
    poll % 2 === 0 ? snapshot(100 + poll, { needs_user: 'Log in' }) : snapshot(100 + poll),
  );
  startedSession(on);
  await begin($, clock);

  await clock.advance(POLL_MS * 20);

  expect(seen.polls).toBe(20);
  expect(seen.notices).toEqual(['LoadCraft · czeka na użytkownika: Log in']);
});

test(
  'a call that arrives during a poll read is not undone by its snapshot',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    // The poll read of 12 s still says "running" for the old operation when it comes back.
    // After the report the status says that the diagnosis is next and lists no operation.
    let reported = false;
    server(
      on,
      seen,
      clock,
      () => snapshot(400),
      12_000,
      0,
      () =>
        reported
          ? { ...STATUS, operations: [], next: { step: 'results_analyze_run', hint: 'all_done' } }
          : STATUS,
    );
    let text = `Still running: ${HANDLE}`;
    on('session.start', () => ({ cwd: '/work' }));
    on('tool.call', () => ({ ref: 1, result: text, text }));
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.tool.call({ tool: TOOL });
    await clock.settle();

    // The poll read starts at the first tick (6 s) and answers at 18 s.
    await clock.advance(POLL_MS);
    expect(seen.polls).toBe(1);
    text = 'The report of the run.';
    reported = true;
    await $.tool.call({ tool: 'mcp__plugin_loadcraft_lc__results_get_report' });
    await clock.advance(12_000);
    await clock.advance(POLL_MS);

    // The report moved the user to step 7 and ended the operation: the snapshot takes neither back.
    const after = seen.states.slice(seen.states.findIndex((state) => state['step'] === 7));
    expect(after.length).toBeGreaterThan(0);
    for (const state of after) {
      expect(state['step']).toBeGreaterThanOrEqual(7);
      expect(state['operation']).toBeUndefined();
    }
  },
);

test(
  'a snapshot of an older operation does not replace the newer one',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = watch(on);
    const NEWER = 'test_run:77777777-6b7d-4e21-a8f3-0c5d9e7b1a42';
    let switched = false;
    server(
      on,
      seen,
      clock,
      () => snapshot(400),
      12_000,
      0,
      () =>
        switched
          ? {
              ...STATUS,
              operations: [
                { handle: NEWER, kind: 'test_run', startedAt: '2026-11-22T10:59:00.000Z' },
              ],
            }
          : STATUS,
    );
    let text = `Still running: ${HANDLE}`;
    on('session.start', () => ({ cwd: '/work' }));
    on('tool.call', () => ({ ref: 1, result: text, text }));
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.tool.call({ tool: TOOL });
    await clock.settle();

    // The poll of the first operation runs from 6 s to 18 s; a second test starts meanwhile.
    await clock.advance(POLL_MS);
    expect(seen.polls).toBe(1);
    text = `Still running: ${NEWER}`;
    switched = true;
    await $.tool.call({ tool: TOOL });
    await clock.advance(12_000);
    await clock.advance(POLL_MS);

    const since = seen.states.findIndex(
      (state) => (state['operation'] as { handle?: string } | undefined)?.handle === NEWER,
    );
    expect(since).toBeGreaterThan(-1);
    for (const state of seen.states.slice(since)) {
      expect((state['operation'] as { handle?: string } | undefined)?.handle).toBe(NEWER);
    }
  },
);

test('a call that changes nothing writes no state', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = watch(on);
  server(on, seen, clock, () => snapshot(400));
  startedSession(on);
  await begin($, clock);
  const written = seen.states.length;

  // The same call again: the status says what it said, the call names the same operation.
  await $.tool.call({ tool: TOOL });
  await clock.settle();

  expect(seen.states.length).toBe(written);
});
