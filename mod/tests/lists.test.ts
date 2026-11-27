// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The lists of the panel as Claude Code runs them: the flows of the project and the steps of a flow
// (Project tab), the test runs (Results tab). What each read asks the server (read-only sections of the
// status), what a press of an action puts into the conversation (one fixed prompt, marked keys only),
// and what the panel says when a read fails.
import { expect, mock, test } from 'claude-code/testing';

const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';

const RUNS = [
  { handle: 'e-3f9a12c4', target: 'checkout', verdict: 'sla_failed', when: '2026-11-22T10:00:00Z' },
  { handle: 'e-11111111', target: 'browse', verdict: 'sla_passed', when: '2026-11-21T09:30:00Z' },
  { handle: 'e-22222222', target: 'search', when: '2026-11-20T09:30:00Z' },
];

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: PROJECT, name: 'shop' },
  setup: { complete: true, missing: [] },
  environments: [{ name: 'qa', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 3, scenarios: 0, compositions: 0 },
  recentRuns: RUNS,
  moreRuns: 0,
  operations: [],
  oldDocs: { flows: ['Checkout'], more: 0 },
  next: { step: 'scenario_suggest_split', hint: 'no_compositions' },
};

const FLOWS = {
  ...STATUS,
  section: {
    kind: 'flows',
    items: [
      { name: 'Checkout', steps: 6 },
      { name: 'Browse', steps: 1 },
      { name: 'Say "hi"', steps: 2 },
    ],
    more: 0,
  },
};

const STEP = {
  num: '1',
  kind: 'request',
  blockType: 'request',
  depth: 0,
  name: 'List orders',
  method: 'GET',
  path: '/orders?page=#{page}',
  uses: ['page'],
  produces: ['orderId'],
  feederVars: [],
  expectedStatuses: [200],
  validators: [],
};
const OUTLINE = {
  project: { id: PROJECT, name: 'shop' },
  outline: {
    name: 'Checkout',
    stepCount: 2,
    steps: [
      STEP,
      { ...STEP, num: '2', name: 'Pay', method: 'POST', path: '/pay', uses: [], produces: [] },
    ],
    truncated: false,
  },
  questions: [],
};

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

type Kit = Parameters<Parameters<typeof test>[2]>[1];
type Dollar = Parameters<Parameters<typeof test>[2]>[0];

interface WorldOptions {
  /** The first read of the flows is refused (the server is not connected); the next ones work. */
  readonly flowsFailOnce?: boolean;
  /** The read of the runs answers with an error of the server. */
  readonly runsError?: boolean;
}

/** The world beneath the mod: the status in its sections, the prompts the mod submits, the reads it makes. */
function world(on: Kit, options: WorldOptions = {}) {
  const seen = {
    prompts: [] as string[],
    reads: [] as Record<string, unknown>[],
  };
  let failed = false;
  on('command.register', () => ({ value: undefined }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('store.get', () => ({ value: undefined }));
  on('store.set', () => ({ value: undefined }));
  on('session.start', () => ({ cwd: '/work' }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text);
    return { text: e.text };
  });
  on('tool.call', { tool: `${PREFIX}scenario_suggest_split` }, () => ({
    ref: 1,
    result: 'ok',
    text: 'ok',
  }));
  on('mcp.call', ($, e) => {
    const args = { ...e.args };
    if (args['detail'] !== undefined || args['result'] !== undefined) seen.reads.push(args);
    if (args['detail'] === 'flows' && options.flowsFailOnce === true && !failed) {
      failed = true;
      return { deny: 'server not connected' };
    }
    if (args['detail'] === 'runs' && options.runsError === true) {
      const text = '[backend_unavailable] CANARY-SECRET-7f3a the backend said something long';
      return { value: { content: [{ type: 'text', text }], isError: true } };
    }
    const data =
      args['detail'] === 'flows' ? FLOWS : args['result'] !== undefined ? OUTLINE : STATUS;
    return {
      value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
    };
  });
  return seen;
}

/** The mod has read the status: a LoadCraft tool was called and the read after it finished. */
async function ready($: Dollar, clock: ReturnType<typeof mock.clock>) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: `${PREFIX}scenario_suggest_split` });
  await clock.settle();
}

async function open($: Dollar, clock: ReturnType<typeof mock.clock>, tab: string) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
  await ui.press({ key: `tab-${tab}` });
  await clock.settle();
  await ui.redraw();
  return ui;
}

test('the Project tab reads the flows once and draws them', CONFIGURED, async ($, on) => {
  const seen = world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  const ui = await open($, clock, 'project');

  expect(await ui.find({ key: 'flow-open-0' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /6 steps/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /on older docs/ })).toBeDefined();
  // A name the conversation cannot carry is drawn and has no mark.
  expect(await ui.find({ key: 'flow-open-2' })).toBeDefined();
  expect(await ui.find({ key: 'flow-2' })).toBeUndefined();
  await ui.redraw();
  expect(seen.reads.filter((read) => read['detail'] === 'flows')).toEqual([
    { format: 'data', from_panel: true, detail: 'flows' },
  ]);
  await ui.unmount();
});

test(
  'marked flows go to the agent as one fixed message, by name, and the marks clear',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await open($, clock, 'project');

    expect(await ui.find({ key: 'flows-scenario' })).toBeUndefined();
    await ui.press({ key: 'flow-1' });
    await ui.press({ key: 'flow-0' });
    // Marking sends nothing.
    expect(seen.prompts).toEqual([]);

    await ui.press({ key: 'flows-scenario' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain(`${JSON.stringify(['Browse', 'Checkout'])}`);
    expect(seen.prompts[0]).toContain('scenario_suggest_split');
    expect(seen.prompts[0]).toContain('not consent');
    expect(await ui.find({ key: 'flows-scenario' })).toBeUndefined();

    await ui.press({ key: 'flow-0' });
    await ui.press({ key: 'flows-migrate' });
    await clock.settle();
    expect(seen.prompts).toHaveLength(2);
    expect(seen.prompts[1]).toContain('flows_migrate_docs');
    expect(seen.prompts[1]).toContain('preview: true');
    expect(seen.prompts[1]).toContain('["Checkout"]');
    await ui.unmount();
  },
);

test(
  'Enter on a flow reads its steps; Enter on a step shows the request; back returns',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await open($, clock, 'project');

    await ui.press({ key: 'flow-open-0' });
    await clock.settle();
    await ui.redraw();

    expect(seen.reads.filter((read) => read['result'] !== undefined)).toEqual([
      { format: 'data', from_panel: true, result: { kind: 'flow', id: 'Checkout' } },
    ]);
    expect(await ui.find({ type: 'Button', text: /1 GET \/orders\?page=#\{page\}/ })).toBeDefined();

    await ui.press({ key: 'step-open-1' });
    expect(await ui.find({ type: 'Text', text: /Creates: orderId/ })).toBeUndefined();
    await ui.press({ key: 'step-back' });
    await ui.press({ key: 'step-open-0' });
    expect(await ui.find({ type: 'Text', text: /Creates: orderId/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /Expected status: 200/ })).toBeDefined();

    await ui.press({ key: 'step-back' });
    await ui.press({ key: 'flow-back' });
    expect(await ui.find({ key: 'flow-open-1' })).toBeDefined();
    // The steps are read again when the flow is opened again.
    await ui.press({ key: 'flow-open-0' });
    await clock.settle();
    expect(seen.reads.filter((read) => read['result'] !== undefined)).toHaveLength(2);
    await ui.unmount();
  },
);

test('a read that failed says so, and "Try again" reads it again', CONFIGURED, async ($, on) => {
  const seen = world(on, { flowsFailOnce: true });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  const ui = await open($, clock, 'project');

  expect(await ui.find({ type: 'Text', text: /The flows could not be read/ })).toBeDefined();
  expect(await ui.find({ key: 'flow-open-0' })).toBeUndefined();
  // Not read again by itself, however often the panel is drawn.
  await ui.redraw();
  await clock.settle();
  expect(seen.reads.filter((read) => read['detail'] === 'flows')).toHaveLength(1);

  await ui.press({ key: 'flows-retry' });
  await clock.settle();
  await ui.redraw();
  expect(await ui.find({ key: 'flow-open-0' })).toBeDefined();
  expect(seen.reads.filter((read) => read['detail'] === 'flows')).toHaveLength(2);
  await ui.unmount();
});

test(
  'the Results tab lists the runs; exactly two marked are compared by a fixed message',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await open($, clock, 'results');

    expect(seen.reads.filter((read) => read['detail'] === 'runs')).toEqual([
      { format: 'data', from_panel: true, detail: 'runs' },
    ]);
    expect(await ui.find({ type: 'Text', text: /Mark two runs to compare them/ })).toBeDefined();

    await ui.press({ key: 'run-1' });
    expect(await ui.find({ key: 'runs-compare' })).toBeUndefined();
    await ui.press({ key: 'run-2' });
    await ui.press({ key: 'run-0' });
    // A third does not fit: the two first stay.
    expect(await ui.find({ type: 'Text', text: /marked: 2 of 2/ })).toBeDefined();

    await ui.press({ key: 'runs-compare' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain('execution "e-11111111"');
    expect(seen.prompts[0]).toContain('compare_to "e-22222222"');
    expect(seen.prompts[0]).toContain('not consent');
    expect(await ui.find({ key: 'runs-compare' })).toBeUndefined();
    await ui.unmount();
  },
);

test(
  'a read of the runs that failed names the code of the answer, never its text',
  CONFIGURED,
  async ($, on) => {
    world(on, { runsError: true });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await open($, clock, 'results');

    expect(
      await ui.find({
        type: 'Text',
        text: /The runs could not be read \(reason: \[backend_unavailable\]\)/,
      }),
    ).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /CANARY/ })).toBeUndefined();
    await ui.unmount();
  },
);
