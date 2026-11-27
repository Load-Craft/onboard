// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The tabs as data are covered by mod/test/pane.spec.ts; here the module is checked as Claude Code
// runs it: the command that opens the pane, the pane drawn on every surface, the tabs, and the one
// button with an effect: "Stop test" asks the user, and only a yes reaches the server.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const RUN_TEST = `${PREFIX}run_start`;
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';
const LIVE = `https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42/live`;
const POLL_MS = 5_000;

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: PROJECT, name: 'sklep' },
  setup: { complete: true, missing: [] },
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: true, caps: {} },
    { name: 'qa', isDefault: false, protected: true, active: false, caps: { maxVu: 100 } },
  ],
  counts: { flows: 3, scenarios: 2, compositions: 1 },
  recentRuns: [],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

const SNAPSHOT = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};

const REPORT = {
  verdict: { state: 'sla_failed', reasons: ['sla_failed'] },
  thresholds: [
    { kind: 'percentile', percentile: 95, unit: 'ms', value: 1120, limit: 400, pass: false },
  ],
  run: { durationS: 597.5 },
  requests: { total: 412300, perSecond: 690 },
  latency: { p50: 180, p95: 1120, p99: 2900 },
  errors: [],
  endpoints: [],
};
const RESULT_LINK = `https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42?tab=Overview`;

const PANE = {
  plugin: 'loadcraft',
  component: 'Pane',
  requestId: 'loadcraft',
  props: {
    title: 'LoadCraft',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
  },
} as const;

const block = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

type Kit = Parameters<Parameters<typeof test>[2]>[1];
type Dollar = Parameters<Parameters<typeof test>[2]>[0];

/**
 * The world beneath the mod: the server (status, reading of the operation, `process_cancel`), who answers
 * the question and what the user sees. Every call of the mod is recorded.
 */
function world(
  on: Kit,
  options: {
    readonly answer?: string | ((labels: readonly string[]) => string) | undefined;
    readonly stored?: unknown;
    readonly placed?: boolean;
    readonly cancelFails?: boolean;
    readonly nameTaken?: boolean;
    /** The handles the successive `run_start` calls name; the server always knows the newest. */
    readonly handles?: readonly string[];
  } = {},
) {
  const seen = {
    opened: [] as Record<string, unknown>[],
    registered: [] as Record<string, unknown>[],
    toasts: [] as string[],
    questions: [] as { question: string; labels: string[] }[],
    cancels: [] as Record<string, unknown>[],
    stored: [] as unknown[],
    /** Calls of the server counted from the moment `counting` is set. */
    counting: false,
    counted: 0,
    /** The arguments of those calls. */
    args: [] as Record<string, unknown>[],
  };
  on('command.register', ($, e) => {
    seen.registered.push({ ...e });
    return options.nameTaken === true ? { deny: 'the name is taken' } : { value: undefined };
  });
  on('ui.open', ($, e) => {
    seen.opened.push({ ...e });
    return { value: { isPlaced: options.placed !== false, reason: 'too narrow' } };
  });
  on('ui.toast', ($, e, next) => {
    seen.toasts.push(e.text);
    return next(e);
  });
  on('store.get', () => ({ value: options.stored }));
  on('store.set', ($, e) => {
    seen.stored.push(e.value);
    return { value: undefined };
  });
  on('session.start', () => ({ cwd: '/work' }));
  let started = 0;
  let current = HANDLE;
  on('tool.call', { tool: RUN_TEST }, () => {
    current = options.handles?.[started] ?? HANDLE;
    started += 1;
    const text = `Test started: ${current}\n↗ ${LIVE}`;
    return { ref: 1, result: text, text };
  });
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const [first] = e.questions;
    const labels = first.options.map((option: { label: string }) => option.label);
    seen.questions.push({ question: first.question, labels });
    if (options.answer === undefined) return { deny: 'The user dismissed the question.' };
    const answer = typeof options.answer === 'function' ? options.answer(labels) : options.answer;
    return { result: { answers: { [first.question]: answer } } };
  });
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('mcp.call', ($, e) => {
    if (seen.counting) {
      seen.counted += 1;
      seen.args.push({ ...e.args });
    }
    if (e.tool === 'process_cancel') {
      seen.cancels.push({ ...e.args });
      return options.cancelFails === true ? { deny: 'server not connected' } : block({});
    }
    if (e.args['operation'] !== undefined) return block({ ...SNAPSHOT, operation: current });
    if (e.args['result'] !== undefined) return block(REPORT);
    return block({
      ...STATUS,
      operations: [{ ...STATUS.operations[0], handle: current }],
    });
  });
  return seen;
}

/** A test is running: the call named its handle, the status confirmed it, the poll read it once. */
async function running($: Dollar, clock: ReturnType<typeof mock.clock>, surface = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: RUN_TEST });
  await clock.settle();
  await clock.advance(POLL_MS);
}

const YES = (labels: readonly string[]) => labels[0] ?? '';
const NO = (labels: readonly string[]) => labels[1] ?? '';

test(
  'the command is registered at the start and opens the pane with the keys',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    mock.clock(on, { now: 1_000 });
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });

    expect(seen.registered).toHaveLength(1);
    expect(seen.registered[0]).toMatchObject({ name: 'loadcraft-panel', immediate: true });

    const answer = await $.command.run({ command: 'loadcraft-panel' });

    expect(answer).toMatchObject({});
    expect(seen.opened).toEqual([
      { id: 'loadcraft', title: 'LoadCraft', focus: true, closeOnEscape: true },
    ]);
  },
);

test('a taken command name does not spoil the rest of the start', CONFIGURED, async ($, on) => {
  const seen = world(on, { nameTaken: true });
  const clock = mock.clock(on, { now: 1_000 });

  await running($, clock);

  // The state hook still ran after the failed registration: the test is in the panel.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await ui.find({ type: 'Text', text: /test 6:45|test 6:40/ })).toBeDefined();
  expect(seen.cancels).toEqual([]);
  await ui.unmount();
});

test('the Run tab shows the numbers of the test in progress', CONFIGURED, async ($, on) => {
  world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  expect(await ui.find({ type: 'Text', text: /test 6:40 \/ 10:00/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /690 requests\/s/ })).toBeDefined();
  expect(await ui.find({ key: 'cancel' })).toBeDefined();
  expect(await ui.find({ type: 'Link' })).toBeDefined();
  await ui.unmount();
});

test('the tabs switch: Project, Results, and back to Run', POLISH, async ($, on) => {
  world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  await ui.press({ key: 'tab-project' });
  expect(await ui.find({ type: 'Text', text: /Projekt „sklep”/ })).toBeDefined();
  expect(
    await ui.find({ type: 'Text', text: /Flow 3 · Scenariusze 2 · Kompozycje 1/ }),
  ).toBeDefined();
  expect(await ui.find({ key: 'cancel' })).toBeUndefined();

  await ui.press({ key: 'tab-results' });
  expect(await ui.find({ type: 'Text', text: /Nie ma jeszcze raportu/ })).toBeDefined();

  await ui.press({ key: 'tab-run' });
  expect(await ui.find({ type: 'Text', text: /test 6:40 \/ 10:00/ })).toBeDefined();
  await ui.unmount();
});

test('with no test the Run tab says so and has no stop button', CONFIGURED, async ($, on) => {
  world(on);
  mock.clock(on, { now: 1_000 });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  expect(await ui.find({ type: 'Text', text: /No test in progress/ })).toBeDefined();
  expect(await ui.find({ key: 'cancel' })).toBeUndefined();
  await ui.unmount();
});

test('every surface draws the pane', CONFIGURED, async ($, on) => {
  world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    expect(await ui.find({ key: 'tab-project' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /test 6:40 \/ 10:00/ })).toBeDefined();
    await ui.unmount();
  }
});

test("another mod's pane is left alone", CONFIGURED, async ($, on) => {
  world(on);
  mock.clock(on, { now: 1_000 });
  const ui = await $.ui.mount({ ...PANE, requestId: 'other', surface: 'terminal' });

  expect(await ui.find({ key: 'tab-run' })).toBeUndefined();
  await ui.unmount();
});

test(
  'Stop test asks first; a yes sends exactly one process_cancel with the handle',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { answer: YES });
    const clock = mock.clock(on, { now: 1_000 });
    await running($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'cancel' });
    await clock.settle();

    // One question, with the numbers of the reading. The mod's own `$.mcp.call` does not run the
    // mod's own consent hook (mods-facts.md), so the question of the panel is the only one.
    expect(seen.questions).toHaveLength(1);
    expect(seen.questions[0]?.question).toContain('6:40');
    expect(seen.cancels).toEqual([{ operation: HANDLE, from_panel: true }]);
    await ui.unmount();
  },
);

test('Stop test: a no sends no cancel', CONFIGURED, async ($, on) => {
  const seen = world(on, { answer: NO });
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  await ui.press({ key: 'cancel' });
  await clock.settle();

  expect(seen.questions).toHaveLength(1);
  expect(seen.cancels).toEqual([]);
  await ui.unmount();
});

test('Stop test: a closed dialog sends no cancel', CONFIGURED, async ($, on) => {
  const seen = world(on, { answer: undefined });
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  await ui.press({ key: 'cancel' });
  await clock.settle();

  expect(seen.questions).toHaveLength(1);
  expect(seen.cancels).toEqual([]);
  await ui.unmount();
});

test(
  'Stop test: an answer that is not the yes label sends no cancel',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { answer: 'sure, go ahead' });
    const clock = mock.clock(on, { now: 1_000 });
    await running($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'cancel' });
    await clock.settle();

    expect(seen.cancels).toEqual([]);
    await ui.unmount();
  },
);

test(
  'Stop test: an error from the server changes nothing and breaks nothing',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { answer: YES, cancelFails: true });
    const clock = mock.clock(on, { now: 1_000 });
    await running($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'cancel' });
    await clock.settle();

    expect(seen.cancels).toHaveLength(1);
    // The panel still draws, and the button is still there.
    expect(await ui.find({ key: 'cancel' })).toBeDefined();
    await ui.unmount();
  },
);

test('a test that starts opens the pane without the keyboard', CONFIGURED, async ($, on) => {
  const seen = world(on);
  const clock = mock.clock(on, { now: 1_000 });

  await running($, clock);

  expect(seen.opened).toEqual([{ id: 'loadcraft', title: 'LoadCraft' }]);
  expect(seen.toasts).toEqual([]);
});

test(
  'a terminal too narrow for the pane gets one toast with the command, once',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, {
      placed: false,
      handles: [HANDLE, 'test_run:8c2d4f17-5e9a-4b3c-9d06-7a1e3f5b2c88'],
    });
    const clock = mock.clock(on, { now: 1_000 });

    await running($, clock);
    // A second test in the same session: the pane waited undrawn, the hint is not repeated.
    await $.tool.call({ tool: RUN_TEST });
    await clock.settle();

    expect(seen.opened).toHaveLength(2);
    expect(seen.toasts).toEqual(['LoadCraft panel is ready. Type /loadcraft-panel to open it.']);
  },
);

test('the preference "do not open automatically" is kept and obeyed', CONFIGURED, async ($, on) => {
  const seen = world(on, { stored: false });
  const clock = mock.clock(on, { now: 1_000 });

  await running($, clock);

  expect(seen.opened).toEqual([]);
  expect(seen.toasts).toEqual([]);
});

test('the toggle on the Run tab stores the preference', CONFIGURED, async ($, on) => {
  const seen = world(on);
  mock.clock(on, { now: 1_000 });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

  expect(await ui.find({ type: 'Button', text: /panel when a test starts: on/ })).toBeDefined();
  await ui.press({ key: 'auto-open' });

  expect(seen.stored).toEqual([false]);
  expect(await ui.find({ type: 'Button', text: /panel when a test starts: off/ })).toBeDefined();
  await ui.unmount();
});

test('the secret never reaches the panel', CONFIGURED, async ($, on) => {
  world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await running($, clock);
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  for (const key of ['tab-project', 'tab-results', 'tab-run']) {
    await ui.press({ key });
    expect(await ui.find({ type: 'Text', text: /CANARY-SECRET/ })).toBeUndefined();
  }
  await ui.unmount();
});

test(
  'a test that starts opens the pane once, not at every state change',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });

    await running($, clock);
    await clock.advance(POLL_MS * 3);
    await $.tool.call({ tool: RUN_TEST });
    await clock.settle();

    expect(seen.opened).toHaveLength(1);
  },
);

test(
  'the Results tab shows the report the model read, with its link',
  CONFIGURED,
  async ($, on) => {
    world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const block = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: {
        tool_use_id: 'toolu_01',
        tool: `${PREFIX}results_get_report`,
        output: `werdykt SLA FAILED\n↗ ${RESULT_LINK}`,
        isErrored: false,
      },
    });
    await clock.settle();
    await block.unmount();

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.press({ key: 'tab-results' });

    expect(await ui.find({ type: 'Text', text: /SLA FAILED/ })).toBeDefined();
    expect(await ui.find({ type: 'Link' })).toBeDefined();
    expect((await ui.find({ type: 'Link' }))?.props['href']).toBe(RESULT_LINK);
    await ui.unmount();
  },
);

test(
  'opening, switching and redrawing the panel reads only the lists of the tab drawn, once each',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await running($, clock);
    seen.counting = true;

    await $.command.run({ command: 'loadcraft-panel' });
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    for (const key of ['tab-project', 'tab-results', 'tab-run']) await ui.press({ key });
    await ui.redraw();
    await clock.settle();
    await ui.unmount();

    // The Run tab asks for nothing; the Project tab reads the flows, the Results tab the runs, each once
    // (the lists of the status: read-only, `from_panel`), however often the panel is drawn again.
    expect(seen.args).toEqual([
      { format: 'data', from_panel: true, detail: 'flows' },
      { format: 'data', from_panel: true, detail: 'runs' },
    ]);
    expect(seen.cancels).toEqual([]);
  },
);
