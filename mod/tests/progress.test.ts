// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest. The drawing of
// the line is covered by mod/test/progress.spec.ts and the series by mod/test/series.spec.ts; here
// the hooks are checked on the test clock (no real time passes): the call of `run_start` holds, the
// poll finds the test and reads its numbers, and the progress row of that call is drawn from them.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const RUN_TEST = `${PREFIX}run_start`;
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const CALL = 'toolu_run_01';
const POLL_MS = 5_000;
const HINT = '(ctrl+b to run in background)';

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

const RATES = [120, 340, 500, 640, 690];
const snapshot = (poll: number, extra: Record<string, unknown> = {}) => ({
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 5 + poll * 5,
  load_elapsed_s: poll * 5,
  planned_s: 600,
  live: { rps: RATES[Math.min(poll, RATES.length) - 1] ?? 690, p95_ms: 910, error_pct: 0.6 },
  ...extra,
});

const answer = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

type Kit = Parameters<Parameters<typeof test>[2]>[1];
type Dollar = Parameters<Parameters<typeof test>[2]>[0];

const TEXT_RESULT = `Test still running: ${HANDLE}`;

/**
 * A server that answers the status read with STATUS and each poll with the next snapshot, and a
 * `run_start` that holds for `holdMs` of test time, as the real tool does while it waits.
 */
function setup(
  on: Kit,
  clock: ReturnType<typeof mock.clock>,
  holdMs: number,
  listed: readonly object[] = STATUS.operations,
) {
  const seen = {
    asked: [] as string[],
    polls: 0,
    statusReads: 0,
    others: [] as string[],
    texts: [] as string[],
  };
  on('session.start', () => ({ cwd: '/work' }));
  on('ui.status', ($, e, next) => next(e));
  on('tool.call', async () => {
    await clock.sleep(holdMs);
    return { ref: 1, result: TEXT_RESULT, text: TEXT_RESULT };
  });
  on('mcp.call', ($, e) => {
    if (e.tool !== 'process_get_status') seen.others.push(e.tool);
    // The bars of the operations in progress (bars.ts) read the plugin's own state file: not a status read.
    if (e.args['progress'] === true) return answer({ progress: [] });
    if (e.args['operation'] === undefined) {
      seen.statusReads += 1;
      return answer({ ...STATUS, operations: listed });
    }
    seen.polls += 1;
    seen.asked.push(String(e.args['operation']));
    return answer(snapshot(seen.polls));
  });
  return seen;
}

function progressProps(call = CALL, extra: Record<string, unknown> = {}) {
  return { tool_use_id: call, kind: 'background_hint', hint: HINT, ...extra };
}

async function mount($: Dollar, surface: string, call = CALL) {
  return $.ui.mount({
    plugin: 'loadcraft',
    surface,
    component: 'ToolProgress',
    props: progressProps(call),
  });
}

test(
  'while run_start holds, the progress row shows the numbers and a chart',
  POLISH,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const seen = setup(on, clock, 60_000);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });

    // Before the test is known, the row is Claude Code's own.
    const before = await mount($, 'terminal');
    expect(await before.keepsBeneath()).toBe(true);
    await before.unmount();

    // First tick: the status read finds the test. Second tick: the poll reads its numbers.
    await clock.advance(POLL_MS * 2);
    const ui = await mount($, 'terminal');
    const line = await ui.find({ type: 'Text', text: /żądań/ });
    expect(line?.text).toMatch(/^test 0:05 \/ 10:00 · 120 żądań\/s · p95≈ 910 ms · błędy 0,6% █$/u);
    expect(await ui.keepsBeneath()).toBe(false);
    // The hint of Claude Code's own row stays beneath the line.
    expect(await ui.find({ type: 'Text', text: HINT })).toBeDefined();

    // Every read of the poll adds to the chart, and the row is drawn again by itself.
    await clock.advance(POLL_MS * 3);
    await clock.settle();
    const later = await ui.find({ type: 'Text', text: /żądań\/s/ });
    expect(later?.text).toMatch(
      /^test 0:20 \/ 10:00 · 640 żądań\/s · p95≈ 910 ms · błędy 0,6% [▁▂▃▄▅▆▇█]{4}$/u,
    );
    expect(later?.text.endsWith('▂▅▆█')).toBe(true);
    await ui.unmount();

    // Only process_get_status is read, one read at a time, and nothing the user did not ask for is sent.
    expect(seen.others).toEqual([]);
    expect(seen.statusReads).toBe(1);
    await clock.advance(60_000);
    await called;
  },
);

test('the same line in English', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
  await clock.advance(POLL_MS * 2);
  const ui = await mount($, 'terminal');
  expect((await ui.find({ type: 'Text', text: /requests\/s/ }))?.text).toContain(
    'test 0:05 / 10:00 · 120 requests/s · p95≈ 910 ms · errors 0.6%',
  );
  await ui.unmount();
  await clock.advance(60_000);
  await called;
});

test('the desktop and VS Code keep Claude Code’s own row', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
  await clock.advance(POLL_MS * 2);
  for (const surface of ['desktop', 'vscode']) {
    const ui = await mount($, surface);
    expect(await ui.keepsBeneath()).toBe(true);
    await ui.unmount();
  }
  await clock.advance(60_000);
  await called;
});

test(
  'the row of another call keeps its own drawing, whatever tool it is',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    setup(on, clock, 60_000);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
    await clock.advance(POLL_MS * 2);
    const other = await mount($, 'terminal', 'toolu_other');
    expect(await other.keepsBeneath()).toBe(true);
    await other.unmount();
    await clock.advance(60_000);
    await called;
  },
);

test(
  'a row of another kind than the background pill keeps its own drawing',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    setup(on, clock, 60_000);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
    await clock.advance(POLL_MS * 2);
    const ui = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolProgress',
      props: progressProps(CALL, { kind: 'something_else' }),
    });
    expect(await ui.keepsBeneath()).toBe(true);
    await ui.unmount();
    await clock.advance(60_000);
    await called;
  },
);

test('a call of another tool records no progress, so its row stays', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const seen = setup(on, clock, 30_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: `${PREFIX}scenario_generate`, tool_use_id: 'toolu_scn' });
  await clock.advance(POLL_MS * 3);
  const ui = await mount($, 'terminal', 'toolu_scn');
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
  // No test, no poll of an operation.
  expect(seen.polls).toBe(0);
  await clock.advance(30_000);
  await called;
});

test(
  'when the call returns the line is gone and the poll goes on without it',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    setup(on, clock, 12_000);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
    await clock.advance(POLL_MS * 2);
    const live = await mount($, 'terminal');
    expect(await live.keepsBeneath()).toBe(false);
    await live.unmount();

    await clock.advance(POLL_MS);
    const result = await called;
    await clock.settle();
    // What the model reads is what the server sent, untouched.
    expect(result).toEqual({ ref: 1, result: TEXT_RESULT, text: TEXT_RESULT });
    const done = await mount($, 'terminal');
    expect(await done.keepsBeneath()).toBe(true);
    await done.unmount();
  },
);

test(
  'a test that has ended leaves no line, even while the call still holds',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    on('session.start', () => ({ cwd: '/work' }));
    on('ui.status', ($, e, next) => next(e));
    on('tool.call', async () => {
      await clock.sleep(60_000);
      return { ref: 1, result: TEXT_RESULT, text: TEXT_RESULT };
    });
    let polls = 0;
    on('mcp.call', ($, e) => {
      if (e.args['progress'] === true) return answer({ progress: [] });
      if (e.args['operation'] === undefined) return answer(STATUS);
      polls += 1;
      return answer(polls < 2 ? snapshot(polls) : snapshot(polls, { phase: 'completed' }));
    });
    on('ui.notify', () => ({ value: { isSent: true, channel: 'kitty' } }));
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
    await clock.advance(POLL_MS * 2);
    const live = await mount($, 'terminal');
    expect(await live.keepsBeneath()).toBe(false);
    await live.unmount();
    await clock.advance(POLL_MS);
    const ended = await mount($, 'terminal');
    expect(await ended.keepsBeneath()).toBe(true);
    await ended.unmount();
    await clock.advance(60_000);
    await called;
  },
);

test('a server that does not answer leaves the row alone', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('session.start', () => ({ cwd: '/work' }));
  on('tool.call', async () => {
    await clock.sleep(30_000);
    return { ref: 1, result: TEXT_RESULT, text: TEXT_RESULT };
  });
  on('mcp.call', () => ({ deny: 'server not connected' }));
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
  await clock.advance(POLL_MS * 4);
  const ui = await mount($, 'terminal');
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
  await clock.advance(30_000);
  await called;
});

test('nothing secret reaches the drawing or the state', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  setup(on, clock, 60_000);
  const states: string[] = [];
  on('state.set', ($, e, next) => {
    states.push(JSON.stringify(e.value));
    return next(e);
  });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
  await clock.advance(POLL_MS * 3);
  const ui = await mount($, 'terminal');
  expect(JSON.stringify(await ui.find({ type: 'Text', text: /żądań|requests/ }))).not.toContain(
    'CANARY-SECRET',
  );
  await ui.unmount();
  expect(states.join('')).not.toContain('CANARY-SECRET');
  await clock.advance(60_000);
  await called;
});

test('an old operation that never ended does not hide the running test', POLISH, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const stale = {
    handle: 'record_run:old-1',
    kind: 'record_run',
    startedAt: '2026-11-20T10:00:00.000Z',
  };
  const seen = setup(on, clock, 60_000, [stale, ...STATUS.operations]);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: RUN_TEST, tool_use_id: CALL });
  await clock.advance(POLL_MS * 2);
  const ui = await mount($, 'terminal');
  expect((await ui.find({ type: 'Text', text: /żądań/ }))?.text).toContain('test 0:05 / 10:00');
  expect(seen.asked[0]).toBe(HANDLE);
  await ui.unmount();
  await clock.advance(60_000);
  await called;
});
