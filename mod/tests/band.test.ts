// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The drawing itself is covered by mod/test/band.spec.ts; here the hooks are checked: the band is
// drawn above the prompt on the terminal and the desktop, never on VS Code (where the step goes to
// the status line), and what lies beneath the band is kept.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const TOOL = 'mcp__plugin_loadcraft_lc__run_start';
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61', name: 'sklep' },
  environments: [{ name: 'qa', isDefault: true, protected: true, active: true, caps: {} }],
  counts: { flows: 1, scenarios: 1, compositions: 1 },
  recentRuns: [],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
};

type Kit = Parameters<Parameters<typeof test>[2]>[1];

/** Starts a session on `surface` and fills its state: a LoadCraft tool call, then the status read. */
async function fillState(
  $: Parameters<Parameters<typeof test>[2]>[0],
  on: Kit,
  surface = 'terminal',
) {
  const clock = mock.clock(on, { now: 1_000 });
  on('session.start', () => ({ cwd: '/work' }));
  on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
  on('mcp.call', () => ({
    value: { content: [{ type: 'text', text: JSON.stringify(STATUS) }], isError: false },
  }));
  // The mod learns where it draws from `session.start`.
  await $.session.start({ surface, isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: TOOL });
  await clock.settle();
  return clock;
}

test('the terminal draws the step row above the prompt', CONFIGURED, async ($, on) => {
  await fillState($, on);

  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });

  const row = await ui.find({ type: 'Text', text: /LoadCraft · sklep · qa ⚠/ });
  expect(row).toBeDefined();
  expect((await ui.find({ type: 'Text', text: /06 Run/ }))?.text).toContain('06 Run');
  await ui.unmount();
});

test('the desktop draws it too, in the language of the plugin option', POLISH, async ($, on) => {
  await fillState($, on);

  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });

  expect(await ui.find({ type: 'Text', text: /06 Uruchomienie/ })).toBeDefined();
  await ui.unmount();
});

test('what lies beneath the band is drawn inside our Box', CONFIGURED, async ($, on) => {
  await fillState($, on);
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });

  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test('a narrow band keeps the numbers and the current step', CONFIGURED, async ($, on) => {
  await fillState($, on);
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, bodyColumns: 60 },
  });

  const row = await ui.find({ type: 'Text', text: /06 Run/ });
  expect(row?.text).toContain('✓05');
  expect(row?.text).not.toContain('Report');
  await ui.unmount();
});

test('an empty state draws nothing and passes the band on', CONFIGURED, async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });

  expect(await ui.find({ type: 'Text', text: /LoadCraft/ })).toBeUndefined();
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test('a survey holds the band: the mod yields', CONFIGURED, async ($, on) => {
  await fillState($, on);
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND_PROPS, hasSurvey: true },
  });

  expect(await ui.find({ type: 'Text', text: /LoadCraft/ })).toBeUndefined();
  await ui.unmount();
});

test(
  'VS Code has no band: the default drawing and the step in the status line',
  CONFIGURED,
  async ($, on) => {
    const statuses: (string | undefined)[] = [];
    on('ui.status', ($$, e, next) => {
      statuses.push(e.text);
      return next(e);
    });
    await fillState($, on, 'vscode');

    const ui = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'vscode',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    });
    expect(await ui.keepsBeneath()).toBe(true);
    expect(await ui.find({ type: 'Text', text: /LoadCraft/ })).toBeUndefined();
    await ui.unmount();

    const last = statuses[statuses.length - 1];
    expect(last).toBe('LoadCraft · sklep · qa ⚠ · 06 Run (5/8)');
  },
);

test('the status line is set only when it changed', CONFIGURED, async ($, on) => {
  const statuses: (string | undefined)[] = [];
  on('ui.status', ($$, e, next) => {
    statuses.push(e.text);
    return next(e);
  });
  const clock = await fillState($, on, 'vscode');
  const before = statuses.length;

  // The same call again learns nothing new: the status read answers the same.
  await $.tool.call({ tool: TOOL });
  await clock.settle();

  expect(before).toBeGreaterThan(0);
  expect(statuses.length).toBe(before);
});

test('the terminal gets no status line (it has the band)', CONFIGURED, async ($, on) => {
  const statuses: (string | undefined)[] = [];
  on('ui.status', ($$, e, next) => {
    statuses.push(e.text);
    return next(e);
  });
  await fillState($, on);

  expect(statuses).toEqual([]);
});

test('the secret never reaches the drawing', CONFIGURED, async ($, on) => {
  await fillState($, on);
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  });

  expect(JSON.stringify(await ui.drawn())).not.toContain('CANARY-SECRET');
  await ui.unmount();
});
