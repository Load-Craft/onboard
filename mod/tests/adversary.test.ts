// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The adversary review of the hooks: what the mod does when the session behaves in ways its authors
// did not plan for (a second session.start, a dialog whose fallback fails, every mods API call
// failing, a flood of result blocks). The pure side of the review is mod/test/adversary.spec.ts.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const RUN_TEST = `${PREFIX}run_start`;
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const PROJECT = '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61';
const RUN = '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';

const block = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

const STATUS = {
  identity: { userId: 'u-1' },
  project: { id: PROJECT, name: 'sklep' },
  environments: [{ name: 'perf', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 1, scenarios: 1, compositions: 1 },
  recentRuns: [],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

const SNAPSHOT = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 100,
  load_elapsed_s: 95,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};

const QA_CLAMPED = {
  dry_run: true,
  target: { kind: 'composition', name: 'checkout' },
  environment: { name: 'qa', protected: true, limit: { max_vu: 100, max_rps: 20 } },
  profile_label: 'Ramp load (closed)',
  profile_requested: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
  profile_effective: { type: 'ramp_concurrency', vusers: 100, ramp: 600 },
  capped: true,
  consent_required: true,
  data: { needed: 1200, available: 2000, ready: true, slots: [], refusal: null },
  planned_s: 600,
  busy: null,
};

const RUN_ARGS = {
  scenario: 'checkout',
  environment: 'qa',
  profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
};

test(
  'a second session.start starts no second poll and registers the command once',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    let polls = 0;
    let registered = 0;
    on('session.start', () => ({ cwd: '/work' }));
    on('command.register', () => {
      registered += 1;
      return { value: undefined };
    });
    on('ui.open', () => ({ value: { isPlaced: true } }));
    on('mcp.call', ($, e) => {
      if (e.args['operation'] === undefined) return block(STATUS);
      polls += 1;
      return block(SNAPSHOT);
    });
    on('tool.call', () => ({
      ref: 1,
      result: `Still running: ${HANDLE}`,
      text: `Still running: ${HANDLE}`,
    }));

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.tool.call({ tool: RUN_TEST });
    await clock.settle();
    polls = 0;

    await clock.advance(30_000);

    // One poll every 5 s, as with one start.
    expect(polls).toBe(6);
    expect(registered).toBe(1);
  },
);

test(
  'a closed dialog refuses the call even when the surfaces cannot be read',
  CONFIGURED,
  async ($, on) => {
    mock.clock(on, { now: 1_000_000 });
    const calls: unknown[] = [];
    on('tool.call', { tool: RUN_TEST }, ($, e) => {
      calls.push(e);
      return { result: 'the tool ran' };
    });
    on('tool.call', { tool: 'AskUserQuestion' }, () => ({
      deny: 'The user dismissed the question.',
    }));
    on('mcp.call', () => block(QA_CLAMPED));
    on('session.surfaces', () => {
      throw new Error('surfaces unavailable');
    });

    const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

    // The user saw the question and closed it: the test does not start behind their back.
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(result)).toContain('[user_declined]');
  },
);

test(
  'every mods API call failing leaves the result of the tool and each drawing as they come',
  CONFIGURED,
  async ($, on) => {
    mock.clock(on, { now: 1_000 });
    const failing = () => {
      throw new Error('broken');
    };
    for (const event of [
      'mcp.call',
      'state.get',
      'state.set',
      'store.get',
      'store.set',
      'ui.status',
      'ui.toast',
      'ui.notify',
      'ui.open',
      'ui.invalidate',
      'command.register',
      'session.surfaces',
    ] as const) {
      on(event, failing);
    }
    const returned = { ref: 1, result: `Started ${HANDLE}`, text: `Started ${HANDLE}` };
    on('tool.call', { tool: `${PREFIX}flows_get` }, () => returned);
    on('tool.call', { tool: RUN_TEST }, () => returned);
    on('session.start', () => ({ cwd: '/work' }));

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    expect(await $.tool.call({ tool: `${PREFIX}flows_get` })).toEqual(returned);
    // Without the facts the consent hook steps aside: the server's own guard holds.
    expect(await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS })).toEqual(returned);

    for (const [component, props] of [
      ['AbovePrompt', { bodyColumns: 120, hasSurvey: false }],
      [
        'ToolUse',
        {
          tool_use_id: 'toolu_x',
          tool: `${PREFIX}flows_get`,
          input: {},
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      [
        'ToolResult',
        {
          tool_use_id: 'toolu_x',
          tool: `${PREFIX}results_get_report`,
          output: `ok\n↗ https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/${RUN}?tab=Overview`,
          isErrored: false,
        },
      ],
      [
        'ToolProgress',
        { tool_use_id: 'toolu_x', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
      ],
    ] as const) {
      const ui = await $.ui.mount({ plugin: 'loadcraft', surface: 'terminal', component, props });
      // The row of a tool is drawn without any API call; everything else is Claude Code's own.
      if (component !== 'ToolUse') expect(await ui.keepsBeneath(), component).toBe(true);
      await ui.unmount();
    }
  },
);

test(
  'a flood of result blocks reads only a few, and none for a block off screen',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    let reads = 0;
    on('mcp.call', () => {
      reads += 1;
      return block({ verdict: { state: 'passed', reasons: [] } });
    });
    const link = `↗ https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/${RUN}?tab=Overview`;
    const mount = (id: string, onScreen: unknown) =>
      $.ui.mount({
        plugin: 'loadcraft',
        surface: 'terminal',
        component: 'ToolResult',
        props: {
          tool_use_id: id,
          tool: `${PREFIX}results_get_report`,
          output: `werdykt\n${link}`,
          isErrored: false,
          onScreen,
        },
      });

    // A resumed session draws its old results outside the viewport first.
    for (let index = 0; index < 50; index += 1) {
      const ui = await mount(`toolu_off_${index}`, null);
      await ui.unmount();
    }
    await clock.settle();
    expect(reads).toBe(0);

    // Blocks that come faster than the reads keep only a few waiting.
    const mounts = [];
    for (let index = 0; index < 50; index += 1) {
      mounts.push(await mount(`toolu_on_${index}`, { first: 0, last: 3, of: 4 }));
    }
    await clock.settle();
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(10);
    for (const ui of mounts) await ui.unmount();
  },
);

test(
  'the API token reaches no atom of $.state and no key of $.store, whatever the session does',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 });
    const written: string[] = [];
    on('state.set', ($, e, next) => {
      written.push(JSON.stringify(e));
      return next(e);
    });
    on('store.set', ($, e) => {
      written.push(JSON.stringify(e));
      return { value: undefined };
    });
    on('store.get', () => ({ value: undefined }));
    on('session.start', () => ({ cwd: '/work' }));
    on('command.register', () => ({ value: undefined }));
    on('ui.open', () => ({ value: { isPlaced: true } }));
    on('ui.status', () => ({ value: undefined }));
    on('ui.toast', () => ({ value: undefined }));
    on('ui.notify', () => ({ value: { isSent: true, channel: 'kitty' } }));
    on('session.surfaces', () => ({ value: ['terminal'] }));
    const live = `https://app.loadcraft.io/projects/${PROJECT}/gatling/executions/${RUN}/live`;
    on('tool.call', { tool: RUN_TEST }, () => {
      const text = `Test started: ${HANDLE}\n↗ ${live}`;
      return { ref: 1, result: text, text };
    });
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
      const [first] = e.questions;
      return { result: { answers: { [first.question]: first.options[0].label } } };
    });
    on('mcp.call', ($, e) => {
      if (e.tool === 'process_cancel') return block({});
      if (e.args['preflight'] !== undefined) return block(QA_CLAMPED);
      if (e.args['operation'] !== undefined) return block(SNAPSHOT);
      if (e.args['result'] !== undefined) {
        return block({
          verdict: { state: 'passed', reasons: [] },
          thresholds: [],
          errors: [],
          endpoints: [],
        });
      }
      return block(STATUS);
    });

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
    await clock.settle();
    await clock.advance(15_000);
    const pane = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'loadcraft',
      props: {
        title: 'LoadCraft',
        isFocused: false,
        bodyColumns: 80,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
      },
    });
    await pane.press({ key: 'auto-open' });
    await pane.press({ key: 'cancel' });
    await clock.settle();
    await pane.unmount();

    // Every atom and the store were written, and none of it holds the token.
    expect(written.some((item) => item.includes('"consent"'))).toBe(true);
    expect(written.some((item) => item.includes('"session"'))).toBe(true);
    expect(written.some((item) => item.includes('"panel"'))).toBe(true);
    expect(written.some((item) => item.includes('"progress"'))).toBe(true);
    expect(written.some((item) => item.includes('paneAutoOpen'))).toBe(true);
    expect(written.join('\n')).not.toContain('CANARY-SECRET-7f3a');
  },
);
