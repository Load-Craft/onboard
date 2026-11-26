// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The card above the prompt as Claude Code runs it: made from what the mod reads anyway (the status
// and the poll of the operation), one at a time, its digits do harmless things only, a card that was
// closed or acted on does not come back, and where the band is not drawn (VS Code, a collapsed band)
// the title goes to a toast and the panel lists it.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const RUN_TEST = `${PREFIX}run_start`;
const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const POLL_MS = 5_000;

const BASE = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: PROJECT, name: 'shop' },
  setup: { complete: true, missing: [] },
  environments: [{ name: 'qa', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 2, scenarios: 0, compositions: 0 },
  recentRuns: [],
  moreRuns: 0,
  operations: [],
  next: { step: 'scenario_suggest_split', hint: 'no_compositions' },
};
const OLD_DOCS = { oldDocs: { flows: ['Cart', 'Checkout'], more: 1 } };
const FIELDS = { uncertainFields: ['auth.scheme', 'tenant'] };

const BAND = {
  plugin: 'loadcraft',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const;

const PANE = {
  plugin: 'loadcraft',
  component: 'Pane',
  requestId: 'loadcraft',
  props: {
    title: 'LoadCraft',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
  },
} as const;

type Kit = Parameters<Parameters<typeof test>[2]>[1];
type Dollar = Parameters<Parameters<typeof test>[2]>[0];

interface WorldOptions {
  /** What the server adds to the status now; a function, so that a test changes it between reads. */
  readonly facts?: () => Record<string, unknown>;
  /** The snapshot the poll reads for the operation, when a test is followed. */
  readonly snapshot?: () => Record<string, unknown>;
  /** What the store holds, by key. */
  readonly stored?: Readonly<Record<string, unknown>>;
  /** `ui.open` says the panel cannot be drawn (a narrow terminal). */
  readonly unplaced?: boolean;
}

function world(on: Kit, options: WorldOptions = {}) {
  const seen = {
    prompts: [] as string[],
    toasts: [] as string[],
    opens: [] as { id: string; focus?: unknown }[],
    stored: [] as { key: string; value: unknown }[],
  };
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
  on('ui.status', () => ({ value: undefined }));
  on('store.get', ($, e) => ({ value: options.stored?.[e.key] }));
  on('store.set', ($, e) => {
    seen.stored.push({ key: e.key, value: e.value });
    return { value: undefined };
  });
  on('session.start', () => ({ cwd: '/work' }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text);
    return { text: e.text };
  });
  on('tool.call', { tool: RUN_TEST }, () => {
    const text = `Test started: ${HANDLE}`;
    return { ref: 1, result: text, text };
  });
  on('tool.call', { tool: `${PREFIX}project_get` }, () => ({ ref: 1, result: 'ok', text: 'ok' }));
  on('mcp.call', ($, e) => {
    const body =
      e.args['operation'] !== undefined && options.snapshot !== undefined
        ? options.snapshot()
        : {
            ...BASE,
            ...(options.snapshot === undefined
              ? {}
              : { operations: [{ handle: HANDLE, kind: 'test_run', startedAt: BASE.asOf }] }),
            ...(options.facts?.() ?? {}),
          };
    return { value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } };
  });
  return seen;
}

/** The mod has read the status: a LoadCraft tool was called and the read after it finished. */
async function ready($: Dollar, clock: ReturnType<typeof mock.clock>, surface = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: `${PREFIX}project_get` });
  await clock.settle();
}

const band = ($: Dollar, props: Partial<typeof BAND.props> = {}, surface = 'terminal') =>
  $.ui.mount({ ...BAND, props: { ...BAND.props, ...props }, surface });

test('flows on an older documentation make one card with its digits', CONFIGURED, async ($, on) => {
  world(on, { facts: () => OLD_DOCS });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);

  const ui = await band($);

  expect(
    await ui.find({
      type: 'Text',
      text: /3 flows are on an older version of the API documentation/,
    }),
  ).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Cart, Checkout and 1 more/ })).toBeDefined();
  expect((await ui.find({ key: 'card-1' }))?.props).toMatchObject({ hotkey: '1' });
  expect((await ui.find({ key: 'card-0' }))?.props).toMatchObject({ hotkey: '0' });
  // The step row is still there beneath it.
  expect(await ui.find({ type: 'Text', text: /LoadCraft · shop/ })).toBeDefined();
  await ui.unmount();
});

test(
  'the preview of the migration goes to the chat as a question, saves nothing, and the card is gone for good',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => OLD_DOCS });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await band($);

    await ui.press({ key: 'card-1' });
    await clock.settle();

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain('flows_migrate_docs');
    expect(seen.prompts[0]).toContain('preview: true');
    expect(seen.prompts[0]).toContain('not consent');
    expect(await ui.find({ key: 'card-1' })).toBeUndefined();
    // The same facts read again do not bring it back, and the key is kept for the next session.
    await $.tool.call({ tool: `${PREFIX}project_get` });
    await clock.settle();
    expect(await ui.find({ key: 'card-1' })).toBeUndefined();
    expect(JSON.stringify(seen.stored)).toMatch(/cardsClosed.*docs:/);
    await ui.unmount();
  },
);

test('a card the user closed in an earlier session does not show', CONFIGURED, async ($, on) => {
  // The key the store holds is the one of this very list of flows (pinned in mod/test/card.spec.ts).
  world(on, { facts: () => OLD_DOCS, stored: { cardsClosed: ['docs:a2d86ae6'] } });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);

  const ui = await band($);

  expect(await ui.find({ key: 'card-1' })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: /LoadCraft · shop/ })).toBeDefined();
  await ui.unmount();
});

test('the card goes when the fact is gone', CONFIGURED, async ($, on) => {
  let facts: Record<string, unknown> = OLD_DOCS;
  world(on, { facts: () => facts });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  const ui = await band($);
  expect(await ui.find({ key: 'card-1' })).toBeDefined();

  facts = {};
  await $.tool.call({ tool: `${PREFIX}project_get` });
  await clock.settle();

  expect(await ui.find({ key: 'card-1' })).toBeUndefined();
  await ui.unmount();
});

test(
  'one card at a time: the more urgent first, the other counted, and it follows when the first is closed',
  POLISH,
  async ($, on) => {
    world(on, { facts: () => ({ ...OLD_DOCS, ...FIELDS }) });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await band($);

    expect(await ui.find({ type: 'Text', text: /3 flowy są na starszej wersji/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /pola profilu do potwierdzenia/ })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /\+1 więcej/ })).toBeDefined();

    await ui.press({ key: 'card-0' });
    await clock.settle();

    expect(await ui.find({ type: 'Text', text: /2 pola profilu do potwierdzenia/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /auth\.scheme, tenant/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /\+1 więcej/ })).toBeUndefined();
    await ui.unmount();
  },
);

test(
  'the profile card opens the panel on the fields it names, and stays until it is closed',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => FIELDS });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await band($);

    await ui.press({ key: 'card-1' });
    await clock.settle();

    expect(seen.opens).toEqual([{ id: 'loadcraft' }]);
    expect(seen.prompts).toEqual([]);
    // Showing is not closing: the card is still there and nothing was kept as closed.
    expect(await ui.find({ key: 'card-1' })).toBeDefined();
    expect(seen.stored).toEqual([]);
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' });
    expect(
      await pane.find({ type: 'Text', text: /Profile fields to confirm: auth\.scheme, tenant/ }),
    ).toBeDefined();
    await pane.unmount();

    await ui.press({ key: 'card-0' });
    await clock.settle();
    expect(await ui.find({ key: 'card-1' })).toBeUndefined();
    expect(JSON.stringify(seen.stored)).toMatch(/cardsClosed.*profile:/);
    await ui.unmount();
  },
);

test(
  'where the panel cannot be drawn the card is not lost: a toast says how, the card stays',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => FIELDS, unplaced: true });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await band($);

    await ui.press({ key: 'card-1' });
    await clock.settle();

    expect(seen.toasts.some((text) => text.includes('/loadcraft-panel'))).toBe(true);
    expect(await ui.find({ key: 'card-1' })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'closing merges with what another session kept, and loses nothing',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => OLD_DOCS, stored: { cardsClosed: ['older'] } });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);
    const ui = await band($);

    await ui.press({ key: 'card-0' });
    await clock.settle();

    const written = seen.stored.filter((item) => item.key === 'cardsClosed').at(-1)?.value;
    expect(written).toEqual(['older', 'docs:a2d86ae6']);
    await ui.unmount();
  },
);

test('a failed test is a card with the reason, until it is closed', CONFIGURED, async ($, on) => {
  let phase = 'running';
  const seen = world(on, {
    snapshot: () => ({
      operation: HANDLE,
      kind: 'test_run',
      phase,
      elapsed_s: 60,
      ...(phase === 'failed' ? { reason: 'Gradle build failed: boom' } : {}),
    }),
  });
  const clock = mock.clock(on, { now: 1_000 });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: RUN_TEST });
  await clock.settle();
  await clock.advance(POLL_MS);
  const ui = await band($);
  expect(await ui.find({ key: 'card-1' })).toBeUndefined();

  phase = 'failed';
  await clock.advance(POLL_MS * 2);

  expect(await ui.find({ type: 'Text', text: /Failed: test/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Gradle build failed: boom/ })).toBeDefined();
  expect(['card-1', 'card-2', 'card-0'].length).toBe(3);
  for (const key of ['card-1', 'card-2', 'card-0']) expect(await ui.find({ key })).toBeDefined();

  // Show: the panel says why, and the card stays.
  await ui.press({ key: 'card-1' });
  await clock.settle();
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' });
  expect(await pane.find({ type: 'Text', text: /The last test failed/ })).toBeDefined();
  expect(await pane.find({ type: 'Text', text: /Gradle build failed: boom/ })).toBeDefined();
  await pane.unmount();
  expect(await ui.find({ key: 'card-1' })).toBeDefined();

  await ui.press({ key: 'card-2' });
  await clock.settle();
  expect(seen.prompts).toHaveLength(1);
  expect(seen.prompts[0]).toContain(JSON.stringify(HANDLE));
  expect(seen.prompts[0]).toContain('process_get_status');
  expect(await ui.find({ key: 'card-2' })).toBeUndefined();
  await ui.unmount();
});

test(
  'a test that finished well is a card that opens the Results tab',
  CONFIGURED,
  async ($, on) => {
    let phase = 'running';
    const seen = world(on, {
      snapshot: () => ({
        operation: HANDLE,
        kind: 'test_run',
        phase,
        elapsed_s: 640,
        load_elapsed_s: 600,
        planned_s: 600,
        live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
      }),
    });
    const clock = mock.clock(on, { now: 1_000 });
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.tool.call({ tool: RUN_TEST });
    await clock.settle();
    await clock.advance(POLL_MS);
    phase = 'completed';
    await clock.advance(POLL_MS * 2);
    const ui = await band($);

    expect(await ui.find({ type: 'Text', text: /Test finished/ })).toBeDefined();
    expect(await ui.find({ key: 'card-2' })).toBeUndefined();

    // The panel opened when the test started; the digit opens it again, on Results.
    const before = seen.opens.length;
    await ui.press({ key: 'card-1' });
    await clock.settle();
    expect(seen.opens.slice(before)).toEqual([{ id: 'loadcraft' }]);
    // Showing is not closing.
    expect(await ui.find({ key: 'card-1' })).toBeDefined();
    await ui.unmount();
  },
);

test('a card of news goes by itself after a while', CONFIGURED, async ($, on) => {
  let phase = 'running';
  world(on, {
    snapshot: () => ({ operation: HANDLE, kind: 'test_run', phase, elapsed_s: 640 }),
  });
  const clock = mock.clock(on, { now: 1_000 });
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
  await $.tool.call({ tool: RUN_TEST });
  await clock.settle();
  await clock.advance(POLL_MS);
  phase = 'completed';
  await clock.advance(POLL_MS * 2);
  const ui = await band($);
  expect(await ui.find({ type: 'Text', text: /Test finished/ })).toBeDefined();

  await clock.advance(11 * 60_000);

  expect(await ui.find({ type: 'Text', text: /Test finished/ })).toBeUndefined();
  await ui.unmount();
});

test(
  'on VS Code there is no band: a toast says it, once, and the panel lists it',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => OLD_DOCS });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock, 'vscode');
    await $.tool.call({ tool: `${PREFIX}project_get` });
    await clock.settle();

    const told = seen.toasts.filter((text) =>
      text.includes('older version of the API documentation'),
    );
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('/loadcraft-panel');

    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' });
    expect(await ui.find({ type: 'Text', text: /Notices/ })).toBeDefined();
    expect(
      await ui.find({ type: 'Text', text: /• 3 flows are on an older version/ }),
    ).toBeDefined();

    // The card is closed from the panel; the key is kept for the next session.
    await ui.press({ key: 'notice-close-0' });
    await clock.settle();
    expect(
      await ui.find({ type: 'Text', text: /• 3 flows are on an older version/ }),
    ).toBeUndefined();
    expect(JSON.stringify(seen.stored)).toMatch(/cardsClosed.*docs:/);
    await ui.unmount();
  },
);

test('a title already told in an earlier session is not told again', CONFIGURED, async ($, on) => {
  const seen = world(on, { facts: () => OLD_DOCS, stored: { cardsTold: ['docs:a2d86ae6'] } });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock, 'vscode');

  expect(seen.toasts.filter((text) => text.includes('older version'))).toEqual([]);
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' });
  expect(await ui.find({ type: 'Text', text: /• 3 flows are on an older version/ })).toBeDefined();
  await ui.unmount();
});

test(
  'a collapsed band hides the card: a toast says it, once, and the panel lists it',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { facts: () => OLD_DOCS });
    const clock = mock.clock(on, { now: 1_000 });
    await ready($, clock);

    const ui = await band($, { isCollapsed: true });
    expect(await ui.find({ key: 'card-1' })).toBeUndefined();
    const again = await band($, { isCollapsed: true });
    await again.unmount();

    const told = seen.toasts.filter((text) =>
      text.includes('older version of the API documentation'),
    );
    expect(told).toHaveLength(1);
    await ui.unmount();
    const pane = await $.ui.mount({ ...PANE, surface: 'terminal' });
    expect(
      await pane.find({ type: 'Text', text: /• 3 flows are on an older version/ }),
    ).toBeDefined();
    await pane.unmount();
  },
);

test('a survey that holds the band keeps it: no card', CONFIGURED, async ($, on) => {
  world(on, { facts: () => OLD_DOCS });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);

  const ui = await band($, { hasSurvey: true });

  expect(await ui.find({ key: 'card-1' })).toBeUndefined();
  await ui.unmount();
});

test('no secret reaches the card, and no digit is a decision', CONFIGURED, async ($, on) => {
  const seen = world(on, {
    facts: () => ({ ...OLD_DOCS, token: 'CANARY-SECRET-7f3a', secret: 'CANARY-SECRET-7f3a' }),
  });
  const clock = mock.clock(on, { now: 1_000 });
  await ready($, clock);
  const ui = await band($);
  await ui.press({ key: 'card-1' });
  await clock.settle();

  expect(JSON.stringify(seen)).not.toContain('CANARY');
  expect(JSON.stringify(await ui.find({ type: 'Box' }))).not.toContain('CANARY');
  // Nothing under a digit calls a tool that writes: only a prompt that asks for a preview.
  expect(seen.prompts.every((text) => !/confirm/u.test(text.replace('not consent', '')))).toBe(
    true,
  );
  await ui.unmount();
});
