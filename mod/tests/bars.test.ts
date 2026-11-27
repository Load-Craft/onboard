// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest. The drawing of a
// bar is covered by mod/test/bars.spec.ts; here the hooks are checked on the test clock: a call
// that waits makes the mod read the bars once every other second (the plugin's state file, never
// the backend), the band, the row of the call and the panel draw them, and a bar that ends is told
// as finished and then goes.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const BUILD = `${PREFIX}scenario_generate`;
const CALL = 'toolu_build_01';
const HINT = '(ctrl+b to run in background)';
const START = '2026-11-24T10:00:00.000Z';

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
};

const row = (over: Record<string, unknown> = {}) => ({
  key: 'scenario_generation:g1',
  call: 'scenario_generate:1:1',
  tool: 'scenario_generate',
  handle: 'scenario_generation:g1',
  kind: 'scenario_generation',
  stage: 'scenario 2/2 · Cart: Generating feeder data...',
  percent: 50,
  n: 2,
  m: 2,
  startedAt: START,
  updatedAt: START,
  open: true,
  ...over,
});

const answer = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

type Kit = Parameters<Parameters<typeof test>[2]>[1];
type Dollar = Parameters<Parameters<typeof test>[2]>[0];

/** A server whose bars are whatever `listed.rows` holds; every other read is counted apart. */
function setup(on: Kit, clock: ReturnType<typeof mock.clock>, holdMs: number) {
  const listed = { rows: [] as object[], failing: false };
  const seen = { barReads: 0, others: 0, args: [] as Record<string, unknown>[] };
  on('session.start', () => ({ cwd: '/work' }));
  on('ui.status', ($, e, next) => next(e));
  on('tool.call', async () => {
    await clock.sleep(holdMs);
    return { ref: 1, result: 'done', text: 'done' };
  });
  on('mcp.call', ($, e) => {
    if (e.args['progress'] === true) {
      if (listed.failing) return { deny: 'server not connected' };
      seen.barReads += 1;
      seen.args.push({ ...e.args });
      return answer({ progress: listed.rows, asOf: START });
    }
    seen.others += 1;
    return { deny: 'not part of this test' };
  });
  return { listed, seen };
}

async function band($: Dollar, locale = 'terminal') {
  return $.ui.mount({
    plugin: 'loadcraft',
    surface: locale,
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });
}

test('with no call and nothing on screen the mod reads no bars', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(START) });
  const { seen } = setup(on, clock, 0);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await clock.advance(30_000);
  expect(seen.barReads).toBe(0);
  const ui = await band($);
  expect(await ui.find({ type: 'Text', text: /scenario generation/ })).toBeUndefined();
  await ui.unmount();
});

test('a waiting call: the band and the row of the call draw its bar', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(START) + 72_000 });
  const { listed, seen } = setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: BUILD, tool_use_id: CALL });
  listed.rows = [row()];
  await clock.advance(2_000);
  await clock.settle();

  // Only the state file is asked, with exactly these arguments.
  expect(seen.args[0]).toEqual({ format: 'data', progress: true, from_panel: true });
  expect(seen.others).toBe(0);

  const above = await band($);
  const line = await above.find({ type: 'Text', text: /50%/ });
  expect(line?.text).toMatch(/^ 50% 2\/2 1:\d\d$/u);
  expect(await above.find({ type: 'Text', text: /scenario generation/ })).toBeDefined();
  expect(await above.find({ type: 'Text', text: /Cart: Generating feeder data/ })).toBeDefined();
  await above.unmount();

  const progress = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolProgress',
    props: { tool_use_id: CALL, kind: 'background_hint', hint: HINT },
  });
  expect(await progress.find({ type: 'Text', text: /50%/ })).toBeDefined();
  expect(await progress.find({ type: 'Text', text: HINT })).toBeDefined();
  expect(await progress.keepsBeneath()).toBe(false);
  await progress.unmount();

  // Another call's row is Claude Code's own.
  const other = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolProgress',
    props: { tool_use_id: 'toolu_other', kind: 'background_hint', hint: HINT },
  });
  expect(await other.keepsBeneath()).toBe(true);
  await other.unmount();

  await clock.advance(60_000);
  await called;
});

test('a bar without a percent is an indeterminate wait', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(START) + 5_000 });
  const { listed } = setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: BUILD, tool_use_id: CALL });
  listed.rows = [row({ percent: undefined, n: undefined, m: undefined })];
  await clock.advance(2_000);
  await clock.settle();
  const ui = await band($);
  const shown = await ui.find({ type: 'Text', text: /scenario generation/ });
  expect(shown).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined();
  await ui.unmount();
  await clock.advance(60_000);
  await called;
});

test('a bar that ends is finished for a few seconds, then gone', POLISH, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(START) + 20_000 });
  const { listed } = setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: BUILD, tool_use_id: CALL });
  listed.rows = [row()];
  await clock.advance(2_000);
  await clock.settle();
  listed.rows = [];
  await clock.advance(2_000);
  await clock.settle();

  const ui = await band($);
  expect(await ui.find({ type: 'Text', text: /zakończone/ })).toBeDefined();
  await ui.unmount();

  await clock.advance(10_000);
  await clock.settle();
  const after = await band($);
  expect(await after.find({ type: 'Text', text: /generowanie scenariuszy/ })).toBeUndefined();
  await after.unmount();
  await clock.advance(60_000);
  await called;
});

test('a read that fails leaves the bar as it was', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse(START) + 20_000 });
  const { listed } = setup(on, clock, 60_000);
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const called = $.tool.call({ tool: BUILD, tool_use_id: CALL });
  listed.rows = [row()];
  await clock.advance(2_000);
  await clock.settle();
  listed.failing = true;
  await clock.advance(6_000);
  await clock.settle();
  const ui = await band($);
  expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined();
  await ui.unmount();
  await clock.advance(60_000);
  await called;
});
