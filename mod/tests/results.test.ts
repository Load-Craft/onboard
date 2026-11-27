// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The drawings themselves are covered by mod/test/views.spec.ts; here the hook is checked on each
// surface: a LoadCraft tool row is drawn by the mod, every other row and the full view stay with
// Claude Code, and the result the model reads is the same with and without the drawing.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const SURFACES = ['terminal', 'desktop', 'vscode'] as const;

function row(tool: string, extra: Record<string, unknown> = {}) {
  return {
    tool_use_id: 'toolu_01',
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    ...extra,
  };
}

for (const surface of SURFACES) {
  test(
    `${surface}: a LoadCraft tool row is drawn as "LoadCraft · <tool>"`,
    CONFIGURED,
    async ($) => {
      const ui = await $.ui.mount({
        plugin: 'loadcraft',
        surface,
        component: 'ToolUse',
        props: row(`${PREFIX}flows_generate_from_suggestions`),
      });
      expect(
        (await ui.find({ type: 'Text', text: 'LoadCraft · flows_generate_from_suggestions' }))
          ?.text,
      ).toBe('LoadCraft · flows_generate_from_suggestions');
      expect(await ui.find({ text: /mcp__plugin/ })).toBeUndefined();
      await ui.unmount();
    },
  );

  test(`${surface}: the row shows that the call runs and that it failed`, CONFIGURED, async ($) => {
    const running = await $.ui.mount({
      plugin: 'loadcraft',
      surface,
      component: 'ToolUse',
      props: row(`${PREFIX}run_start`, { isRunning: true }),
    });
    expect(await running.find({ type: 'Text', text: '…' })).toBeDefined();
    await running.unmount();
    const failed = await $.ui.mount({
      plugin: 'loadcraft',
      surface,
      component: 'ToolUse',
      props: row(`${PREFIX}run_start`, { isErrored: true }),
    });
    expect(await failed.find({ type: 'Text', text: '✕' })).toBeDefined();
    await failed.unmount();
  });

  test(
    `${surface}: the full view and another tool keep Claude Code's row`,
    CONFIGURED,
    async ($) => {
      const expanded = await $.ui.mount({
        plugin: 'loadcraft',
        surface,
        component: 'ToolUse',
        props: row(`${PREFIX}flows_generate_from_suggestions`, { isExpanded: true }),
      });
      expect(await expanded.keepsBeneath()).toBe(true);
      await expanded.unmount();
      for (const tool of ['Bash', 'mcp__plugin_other_other__flows_generate_from_suggestions']) {
        const other = await $.ui.mount({
          plugin: 'loadcraft',
          surface,
          component: 'ToolUse',
          props: row(tool),
        });
        expect(await other.keepsBeneath()).toBe(true);
        await other.unmount();
      }
    },
  );
}

test('a row with a tool of an unexpected type is left to Claude Code', CONFIGURED, async ($) => {
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolUse',
    props: row(42 as unknown as string),
  });
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test('the surfaces that draw no tool row get none', CONFIGURED, async ($) => {
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'mobile',
    component: 'ToolUse',
    props: row(`${PREFIX}flows_generate_from_suggestions`),
  });
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test('the result the model reads is the same with the drawing', CONFIGURED, async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const returned = {
    ref: 1,
    result: 'zakupy · 7 kroków\n  1  POST   /auth/login',
    text: 'zakupy · 7 kroków\n  1  POST   /auth/login',
  };
  on('tool.call', () => returned);
  on('mcp.call', () => ({ deny: 'server not connected' }));
  expect(await $.tool.call({ tool: `${PREFIX}flows_generate_from_suggestions` })).toEqual(returned);
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolUse',
    props: row(`${PREFIX}flows_generate_from_suggestions`),
  });
  expect(await ui.find({ text: 'LoadCraft · flows_generate_from_suggestions' })).toBeDefined();
  await ui.unmount();
});

// ---- the result block: drawn from the data channel of process_get_status -------------------------------

const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';
const RUN = '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const OTHER_RUN = '8c2d4f17-5e9a-4b3c-9d06-7a1e3f5b2c88';
const LINK = (id: string): string =>
  `↗ https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/${id}?tab=Overview`;

const REPORT = {
  verdict: { state: 'sla_failed', reasons: ['sla_failed'] },
  thresholds: [
    { kind: 'percentile', percentile: 95, unit: 'ms', value: 1120, limit: 400, pass: false },
  ],
  run: { durationS: 597.5 },
  requests: { total: 412300, perSecond: 690 },
  errors: [],
  endpoints: [],
};
const dataBlock = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

function result(tool: string, extra: Record<string, unknown> = {}) {
  return {
    tool_use_id: 'toolu_01',
    tool,
    output: `werdykt SLA FAILED\n${LINK(RUN)}`,
    isErrored: false,
    ...extra,
  };
}

for (const surface of SURFACES) {
  test(
    `${surface}: a report is drawn from the data of process_get_status, read once in the background`,
    CONFIGURED,
    async ($, on) => {
      const clock = mock.clock(on, { now: 1_000 });
      const asked: string[] = [];
      on('mcp.call', (_$, e) => {
        asked.push(JSON.stringify(e));
        return dataBlock(REPORT);
      });
      const ui = await $.ui.mount({
        plugin: 'loadcraft',
        surface,
        component: 'ToolResult',
        props: result(`${PREFIX}results_get_report`),
      });
      // The first drawing does not wait for the read: it is Claude Code's own.
      expect(await ui.keepsBeneath()).toBe(true);
      await clock.settle();
      expect((await ui.find({ type: 'Text', text: /SLA FAILED/ }))?.props['color']).toBe('error');
      expect(await ui.find({ type: 'Text', text: /1.120 ms/ })).toBeDefined();
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('process_get_status');
      expect(asked[0]).toContain('"format":"data"');
      expect(asked[0]).toContain(`"result":{"kind":"report","id":"${RUN}"}`);
      // Drawing again reads nothing more.
      await ui.redraw();
      await clock.settle();
      expect(asked).toHaveLength(1);
      await ui.unmount();
    },
  );
}

test("a result whose data cannot be read stays Claude Code's own", CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('mcp.call', () => ({ deny: 'server not connected' }));
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolResult',
    props: result(`${PREFIX}results_get_report`),
  });
  await clock.settle();
  await ui.redraw();
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test(
  'an answer that is an error or no JSON leaves the result as it is',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    let answer: unknown = {
      value: { content: [{ type: 'text', text: '[result_not_available] none' }], isError: true },
    };
    on('mcp.call', () => answer as { value: unknown });
    const ui = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_analyze_run`),
    });
    await clock.settle();
    await ui.redraw();
    expect(await ui.keepsBeneath()).toBe(true);
    answer = { value: { content: [{ type: 'text', text: 'not json' }], isError: false } };
    const again = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_analyze_run`, { tool_use_id: 'toolu_02' }),
    });
    await clock.settle();
    await again.redraw();
    expect(await again.keepsBeneath()).toBe(true);
    await ui.unmount();
    await again.unmount();
  },
);

test('data of a shape no drawing takes leave the result as it is', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('mcp.call', () => dataBlock({ verdict: { state: 'exploded' } }));
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolResult',
    props: result(`${PREFIX}results_get_report`),
  });
  await clock.settle();
  await ui.redraw();
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});

test(
  'nothing is read for an error, another tool, a tool without data or no link',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    let reads = 0;
    on('mcp.call', () => {
      reads += 1;
      return dataBlock(REPORT);
    });
    const cases = [
      result(`${PREFIX}results_get_report`, { isErrored: true }),
      result('Bash'),
      result(`${PREFIX}flows_generate_from_suggestions`),
      result(`${PREFIX}results_get_report`, { output: 'werdykt SLA FAILED' }),
      result(`${PREFIX}results_get_report`, { output: 42 }),
      result(`${PREFIX}results_get_report`, { output: `${LINK(RUN)}\n${LINK(OTHER_RUN)}` }),
    ];
    for (const [index, props] of cases.entries()) {
      const ui = await $.ui.mount({
        plugin: 'loadcraft',
        surface: 'terminal',
        component: 'ToolResult',
        props: { ...props, tool_use_id: `toolu_${index}` },
      });
      await clock.settle();
      await ui.redraw();
      expect(await ui.keepsBeneath(), String(index)).toBe(true);
      await ui.unmount();
    }
    expect(reads).toBe(0);
  },
);

test('the full view keeps the default block', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('mcp.call', () => dataBlock(REPORT));
  const props = result(`${PREFIX}results_get_report`);
  const first = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolResult',
    props,
  });
  await clock.settle();
  await first.redraw();
  expect(await first.find({ type: 'Text', text: /SLA FAILED/ })).toBeDefined();
  const expanded = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolResult',
    props: { ...props, isExpanded: true },
  });
  expect(await expanded.keepsBeneath()).toBe(true);
  await first.unmount();
  await expanded.unmount();
});

test('one read at a time: the next starts when the one before ends', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  let reads = 0;
  on('mcp.call', async () => {
    reads += 1;
    await clock.sleep(500);
    return dataBlock(REPORT);
  });
  const mounts = [];
  for (const id of ['toolu_a', 'toolu_b', 'toolu_c']) {
    mounts.push(
      await $.ui.mount({
        plugin: 'loadcraft',
        surface: 'terminal',
        component: 'ToolResult',
        props: result(`${PREFIX}results_get_report`, { tool_use_id: id }),
      }),
    );
  }
  await clock.settle();
  expect(reads).toBe(1);
  await clock.advance(500);
  expect(reads).toBe(2);
  await clock.advance(500);
  expect(reads).toBe(3);
  await clock.advance(5_000);
  expect(reads).toBe(3);
  for (const ui of mounts) {
    expect(await ui.find({ type: 'Text', text: /SLA FAILED/ })).toBeDefined();
    await ui.unmount();
  }
});

test('the model gets the same result whatever the block does', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('mcp.call', () => dataBlock(REPORT));
  const returned = { ref: 1, result: `werdykt\n${LINK(RUN)}`, text: `werdykt\n${LINK(RUN)}` };
  on('tool.call', () => returned);
  expect(await $.tool.call({ tool: `${PREFIX}results_get_report` })).toEqual(returned);
  await clock.settle();
  expect(await $.tool.call({ tool: `${PREFIX}results_get_report` })).toEqual(returned);
});

test(
  'a busy gate delays the read of a result, and it gives up after a while',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
    let resultReads = 0;
    // The status read never returns; a read of a result is refused while it holds the gate.
    on('mcp.call', async (_$, e) => {
      if (JSON.stringify(e).includes('"result"')) {
        resultReads += 1;
        return dataBlock(REPORT);
      }
      await clock.sleep(1_000_000_000);
      return dataBlock({});
    });
    await $.tool.call({ tool: `${PREFIX}run_start` });
    await clock.settle();
    const ui = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_get_report`),
    });
    await clock.advance(5_000);
    expect(resultReads).toBe(0);
    // Twenty tries, half a second apart, then it stops trying (the gate frees itself only after 30 s).
    await clock.advance(10_000);
    await clock.advance(60_000);
    expect(resultReads).toBe(0);
    expect(await ui.keepsBeneath()).toBe(true);
    await ui.unmount();
  },
);

test(
  'a gate that is busy for a moment only delays the read of a result',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
    let resultReads = 0;
    on('mcp.call', async (_$, e) => {
      if (JSON.stringify(e).includes('"result"')) {
        resultReads += 1;
        return dataBlock(REPORT);
      }
      await clock.sleep(2_000);
      return dataBlock({});
    });
    await $.tool.call({ tool: `${PREFIX}run_start` });
    await clock.settle();
    const ui = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_get_report`),
    });
    await clock.advance(1_000);
    expect(resultReads).toBe(0);
    await clock.advance(3_000);
    expect(resultReads).toBe(1);
    expect(await ui.find({ type: 'Text', text: /SLA FAILED/ })).toBeDefined();
    await ui.unmount();
  },
);

test(
  'a status read that was refused while a result is read goes first, then the next result',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
    const order: string[] = [];
    on('mcp.call', async (_$, e) => {
      const isResult = JSON.stringify(e).includes('"result"');
      order.push(isResult ? 'result' : 'status');
      await clock.sleep(isResult ? 500 : 300);
      return dataBlock(isResult ? REPORT : {});
    });
    const first = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_get_report`, { tool_use_id: 'toolu_a' }),
    });
    const second = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'ToolResult',
      props: result(`${PREFIX}results_get_report`, { tool_use_id: 'toolu_b' }),
    });
    await clock.settle();
    expect(order).toEqual(['result']);
    // A call of a tool arrives while the result is read: its status read is refused and queued.
    await $.tool.call({ tool: `${PREFIX}run_start` });
    await clock.settle();
    expect(order).toEqual(['result']);
    // The result read ends: the status read goes first, the second result after it.
    await clock.advance(500);
    expect(order).toEqual(['result', 'status']);
    await clock.advance(300);
    await clock.advance(500);
    expect(order).toEqual(['result', 'status', 'result']);
    await first.unmount();
    await second.unmount();
  },
);

test('a report with a comparison stays with the default drawing', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  on('mcp.call', () => dataBlock({ ...REPORT, comparison: { rows: [] } }));
  const ui = await $.ui.mount({
    plugin: 'loadcraft',
    surface: 'terminal',
    component: 'ToolResult',
    props: result(`${PREFIX}results_get_report`),
  });
  await clock.settle();
  await ui.redraw();
  expect(await ui.keepsBeneath()).toBe(true);
  await ui.unmount();
});
