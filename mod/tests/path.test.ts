// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The Path tab as Claude Code runs it: drawn from the status the mod read, a pick reaches the agent
// as one prompt (`$.prompt.submit`), marks stay in the tab until they are sent, and the mod asks the
// server for nothing more than the status it reads anyway.
import { expect, mock, test } from 'claude-code/testing';

const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';

const JOURNEYS = [
  { name: 'Checkout', pattern: 'semantic', steps: ['Log in', 'Pay'] },
  { name: 'Rejected token', pattern: 'auth_rejection' },
  { name: 'Browse "all" products', pattern: 'happy_path' },
];

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: PROJECT, name: 'shop' },
  setup: { complete: true, missing: [] },
  environments: [{ name: 'qa', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 0, scenarios: 0, compositions: 0 },
  recentRuns: [],
  moreRuns: 0,
  operations: [],
  next: { step: 'flows_suggest_journeys', hint: 'no_flows' },
  path: { docs: true, recording: false, frontend: false, journeys: JOURNEYS },
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

/** The world beneath the mod: the server's status and the prompts the mod submits. */
interface WorldOptions {
  readonly rejectPrompt?: boolean;
  /** `ui.open` answers that the pane is not drawn (a narrow terminal). */
  readonly unplaced?: boolean;
  /** The text `flows_suggest_journeys` returns (default: proposals). */
  readonly suggestText?: string;
  /** The status the server answers; a function, so that a test can change it between reads. */
  readonly status?: () => unknown;
}

function world(on: Kit, options: WorldOptions = {}) {
  const seen = {
    prompts: [] as string[],
    toasts: [] as string[],
    serverCalls: [] as string[],
    opens: [] as { id: string; focus?: unknown }[],
  };
  // The engine beneath: a move of the focus ring the mod asks for lands where it says.
  on('command.register', () => ({ value: undefined }));
  on('ui.open', ($, e) => {
    seen.opens.push({ id: e.id, ...(e.focus === undefined ? {} : { focus: e.focus }) });
    return {
      value: options.unplaced === true ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true },
    };
  });
  on('ui.toast', ($, e, next) => {
    seen.toasts.push(e.text);
    return next(e);
  });
  on('store.get', () => ({ value: undefined }));
  on('store.set', () => ({ value: undefined }));
  on('session.start', () => ({ cwd: '/work' }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text);
    return options.rejectPrompt === true ? { drop: 'busy' } : { text: e.text };
  });
  on('tool.call', { tool: `${PREFIX}flows_suggest_journeys` }, () => {
    const text = options.suggestText ?? 'Proposed journeys';
    return { ref: 1, result: text, text };
  });
  on('tool.call', { tool: `${PREFIX}process_wait` }, () => {
    const text = 'Refined proposals are ready.';
    return { ref: 1, result: text, text };
  });
  on('mcp.call', ($, e) => {
    seen.serverCalls.push(e.tool);
    return {
      value: {
        content: [{ type: 'text', text: JSON.stringify(options.status?.() ?? STATUS) }],
        isError: false,
      },
    };
  });
  return seen;
}

/** The mod has read the status: a LoadCraft tool was called and the read after it finished. */
async function ready($: Dollar, clock: ReturnType<typeof mock.clock>) {
  await $.session.start({
    surface: 'terminal',
    isInteractive: true,
    cwd: '/work',
  });
  await $.tool.call({ tool: `${PREFIX}flows_suggest_journeys` });
  await clock.settle();
}

test(
  'the Path tab shows the methods the project allows and the proposed journeys',
  CONFIGURED,
  async ($, on) => {
    world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'tab-path' });

    expect(await ui.find({ key: 'method-docs' })).toBeDefined();
    expect(await ui.find({ key: 'method-har' })).toBeDefined();
    expect(await ui.find({ key: 'method-describe' })).toBeUndefined();
    expect(
      await ui.find({
        type: 'Text',
        text: /no environment has a frontend address/,
      }),
    ).toBeDefined();
    expect(await ui.find({ key: 'journey-0' })).toBeDefined();
    expect(await ui.find({ key: 'journey-2' })).toBeDefined();
    expect(await ui.find({ key: 'build' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /2 steps: Log in · Pay/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /Security check — expects 401/ })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'a method pick reaches the agent as one prompt that answers flow-method',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.press({ key: 'tab-path' });

    await ui.press({ key: 'method-docs' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain(
      'The user chose the flow method "docs" in the LoadCraft Path tab',
    );
    expect(seen.prompts[0]).toContain('do not ask it again');
    expect(seen.toasts).toContain('Sent to the agent.');
    expect(await ui.find({ type: 'Button', text: /✓ From the API documentation/ })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'marked journeys are sent together on Build, as a JSON list, and the marks clear',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.press({ key: 'tab-path' });

    await ui.press({ key: 'journey-2' });
    await ui.press({ key: 'journey-0' });
    // Marking sends nothing: only Build does.
    expect(seen.prompts).toEqual([]);
    expect(
      await ui.find({
        type: 'Button',
        label: /Build the marked journeys \(2\)/,
      }),
    ).toBeDefined();

    await ui.press({ key: 'build' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain(
      `exactly as flows_suggest_journeys returned them: ${JSON.stringify(['Checkout', 'Browse "all" products'])}.`,
    );
    expect(seen.prompts[0]).toContain('panel path-selection');
    expect(await ui.find({ key: 'build' })).toBeUndefined();
    expect(await ui.find({ type: 'Button', text: /\[x\]/ })).toBeUndefined();
    await ui.unmount();
  },
);

test(
  'a pick that cannot be sent is told to the user, who can say it in the chat',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { rejectPrompt: true });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.press({ key: 'tab-path' });

    await ui.press({ key: 'method-har' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    await ui.unmount();
  },
);

test(
  'the tab draws nothing about the project before the status was read, and sends nothing',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    mock.clock(on, { now: 1_000 });
    await $.session.start({
      surface: 'terminal',
      isInteractive: true,
      cwd: '/work',
    });
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'tab-path' });

    expect(
      await ui.find({
        type: 'Text',
        text: /Nothing known about the project yet/,
      }),
    ).toBeDefined();
    expect(await ui.find({ key: 'method-docs' })).toBeUndefined();
    expect(seen.prompts).toEqual([]);
    await ui.unmount();
  },
);

test(
  'the Path tab asks the server for nothing of its own: only the status reads',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const before = seen.serverCalls.length;
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });

    await ui.press({ key: 'tab-path' });
    await ui.press({ key: 'journey-0' });
    await ui.press({ key: 'build' });
    await clock.settle();

    expect(seen.serverCalls.length).toBe(before);
    await ui.unmount();
  },
);

test('every surface draws the tab', CONFIGURED, async ($, on) => {
  world(on);
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface });
    await ui.press({ key: 'tab-path' });
    expect(await ui.find({ key: 'method-docs' })).toBeDefined();
    await ui.unmount();
  }
});

test(
  'proposals that came back open the panel on the Path tab, without taking the keys',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    expect(seen.opens).toEqual([{ id: 'loadcraft' }]);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    expect(await ui.find({ key: 'journey-filter' })).toBeDefined();
    expect(await ui.find({ key: 'method-docs' })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'the filter narrows the list as the user types, and the marks it hides still count',
  CONFIGURED,
  async ($, on) => {
    world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.press({ key: 'journey-0' });
    await ui.input({ key: 'journey-filter', text: 'token', kind: 'change' });

    expect(await ui.find({ key: 'journey-open-1' })).toBeDefined();
    expect(await ui.find({ key: 'journey-open-0' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /marked: 1 of 50, shown: 1/ })).toBeDefined();
    expect(
      await ui.find({ type: 'Button', label: /Build the marked journeys \(1\)/ }),
    ).toBeDefined();
    await ui.unmount();
  },
);

test(
  'Enter on a name shows every step; back returns to the list with the filter and the marks',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.input({ key: 'journey-filter', text: 'pay', kind: 'change' });
    await ui.press({ key: 'journey-open-0' });

    expect(await ui.find({ type: 'Text', text: /· Log in/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /· Pay/ })).toBeDefined();
    expect(await ui.find({ key: 'journey-filter' })).toBeUndefined();
    await ui.press({ key: 'journey-preview-mark' });
    await ui.press({ key: 'journey-back' });
    await clock.settle();

    expect(await ui.find({ key: 'journey-filter' })).toBeDefined();
    expect(await ui.find({ key: 'journey-open-1' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /marked: 1 of 50, shown: 1/ })).toBeDefined();
    // Looking and marking send nothing to the agent: only Build does.
    expect(seen.prompts).toEqual([]);
    await ui.unmount();
  },
);

test('a refusal of flows_suggest_journeys never opens the panel', CONFIGURED, async ($, on) => {
  const seen = world(on, { suggestText: '[docs_missing] The project has no API documentation.' });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  expect(seen.opens).toEqual([]);
});

test(
  'proposals that come through process_wait (a long refinement) open the panel too',
  CONFIGURED,
  async ($, on) => {
    let journeys: unknown[] = [];
    const seen = world(on, { status: () => ({ ...STATUS, path: { ...STATUS.path, journeys } }) });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    // the first call only started the refinement: no proposals yet, nothing opens
    expect(seen.opens).toEqual([]);
    journeys = JOURNEYS;
    await $.tool.call({ tool: `${PREFIX}process_wait` });
    await clock.settle();
    expect(seen.opens).toEqual([{ id: 'loadcraft' }]);
    // the same proposals read again do not open it a second time
    await $.tool.call({ tool: `${PREFIX}process_wait` });
    await clock.settle();
    expect(seen.opens).toHaveLength(1);
  },
);

test(
  'a pane that could not be drawn leaves the tab as it was and tells how to open it',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { unplaced: true });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    expect(seen.opens).toHaveLength(1);
    expect(seen.toasts.some((text) => text.includes('/loadcraft-panel'))).toBe(true);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    expect(await ui.find({ key: 'journey-filter' })).toBeUndefined();
    await ui.unmount();
  },
);

test(
  'new proposals start the list anew: the old filter and preview go',
  CONFIGURED,
  async ($, on) => {
    let journeys: unknown[] = JOURNEYS;
    world(on, { status: () => ({ ...STATUS, path: { ...STATUS.path, journeys } }) });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    await ui.input({ key: 'journey-filter', text: 'zzz', kind: 'change' });
    expect(await ui.find({ type: 'Text', text: /Nothing matches the filter/ })).toBeDefined();
    journeys = [...JOURNEYS, { name: 'Refund', pattern: 'semantic', steps: ['Ask'] }];
    await $.tool.call({ tool: `${PREFIX}flows_suggest_journeys` });
    await clock.settle();
    expect(await ui.find({ type: 'Text', text: /Nothing matches the filter/ })).toBeUndefined();
    expect(await ui.find({ key: 'journey-open-3' })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'quick typing: every change of the field reaches the filter, the last one wins',
  CONFIGURED,
  async ($, on) => {
    world(on);
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    for (const text of ['t', 'to', 'tok', 'toke', 'token']) {
      await ui.input({ key: 'journey-filter', text, kind: 'change' });
    }
    expect((await ui.find({ key: 'journey-filter' }))?.props['value']).toBe('token');
    expect(await ui.find({ key: 'journey-open-1' })).toBeDefined();
    expect(await ui.find({ key: 'journey-open-0' })).toBeUndefined();
    await ui.unmount();
  },
);
