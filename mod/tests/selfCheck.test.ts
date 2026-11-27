// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest. The drawing of the
// self-check is covered by mod/test/selfCheck.spec.ts; here the hooks: the view comes with the read of
// the bars while a check call waits (no read of its own), the Run tab draws it, a step that failed is a
// card above the prompt, and the question about a step is one fixed prompt with the run and the number.
import { expect, mock, test } from 'claude-code/testing';

const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const PREFIX = 'mcp__plugin_loadcraft_lc__';
const CHECK = `${PREFIX}scenario_check_self`;
const CALL = 'toolu_check_01';
const START = '2026-11-24T10:00:00.000Z';
const RUN = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';

/** The view the server writes while the check repairs a step that failed (`selfCheckViews`). */
const VIEW = {
  key: 'sc-0123456789ab',
  savedAt: START,
  environment: 'qa',
  scenarios: [
    {
      id: 's-1',
      name: 'checkout',
      status: 'repairing',
      phase: 'repairing',
      version: 1,
      run: 1,
      steps: [
        { name: 'login', method: 'POST', path: '/login', result: 'ok', http: [200] },
        { name: 'pay', method: 'POST', path: '/pay', result: 'failed', http: [403] },
        { name: 'confirm', method: 'GET', path: '/order', result: 'skipped' },
      ],
      moreSteps: 0,
      failure: { step: 'pay', http: 403, message: 'HTTP 403 Forbidden' },
      runs: [
        {
          run: 1,
          version: 1,
          executionId: RUN,
          verdict: 'failed',
          results: [
            { step: 0, result: 'ok', http: [200] },
            { step: 1, result: 'failed', http: [403], reason: 'HTTP 403 Forbidden' },
            { step: 2, result: 'skipped' },
          ],
        },
      ],
      repairs: [],
      repairLimit: 2,
    },
  ],
};

const BAR = {
  key: 'self_check:sc-0123456789ab',
  call: 'scenario_check_self:1:1',
  tool: 'scenario_check_self',
  handle: 'self_check:sc-0123456789ab',
  kind: 'self_check',
  stage: 'self-check · checkout: AI repair',
  startedAt: START,
  updatedAt: START,
  open: true,
};

const PANE = {
  plugin: 'loadcraft',
  component: 'Pane',
  requestId: 'loadcraft',
  props: {
    title: 'LoadCraft',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
  },
} as const;

const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
};

const answer = (data: unknown) => ({
  value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false },
});

type Kit = Parameters<Parameters<typeof test>[2]>[1];

function setup(on: Kit, clock: ReturnType<typeof mock.clock>) {
  const seen = { prompts: [] as string[], others: 0 };
  on('session.start', () => ({ cwd: '/work' }));
  on('session.surfaces', () => ({ value: ['terminal'] }));
  on('command.register', () => ({ value: undefined }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('store.get', () => ({ value: undefined }));
  on('store.set', () => ({ value: undefined }));
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text);
    return { text: e.text };
  });
  on('tool.call', async () => {
    await clock.sleep(60_000);
    return { ref: 1, result: 'done', text: 'done' };
  });
  on('mcp.call', ($, e) => {
    if (e.args['progress'] === true) {
      return answer({ progress: [BAR], ended: [], asOf: START, selfCheck: VIEW });
    }
    seen.others += 1;
    return { deny: 'not part of this test' };
  });
  return seen;
}

test(
  'while a check call waits, the Run tab draws the step that failed and the repair under way',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse(START) });
    const seen = setup(on, clock);
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' });
    const called = $.tool.call({ tool: CHECK, tool_use_id: CALL });
    await clock.advance(2_000);
    await clock.settle();

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' });
    expect(
      await ui.find({ type: 'Text', text: /Step 2 failed \(403\) — AI repair, round 1 of 2/ }),
    ).toBeDefined();
    expect(await ui.find({ type: 'Text', text: /next attempt from step 1/ })).toBeDefined();
    expect(await ui.find({ type: 'Button', text: /✕ 2 pay/ })).toBeDefined();

    // The preview of the step has the question; it sends one fixed prompt, without the step's texts.
    await ui.press({ key: 'check-0-open-1' });
    await ui.press({ key: 'check-ask' });
    await clock.settle();
    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain('step 2');
    expect(seen.prompts[0]).toContain('"e-5d0c2a7e"');
    expect(seen.prompts[0]).not.toContain('pay');
    expect(seen.prompts[0]).not.toContain('Forbidden');
    expect(seen.prompts[0]).toContain('not consent');
    // Nothing but the state file was read for it.
    expect(seen.others).toBe(0);
    await ui.unmount();

    const above = await $.ui.mount({
      plugin: 'loadcraft',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    });
    expect(
      await above.find({ type: 'Text', text: /Self-check “checkout”: step 2 failed/ }),
    ).toBeDefined();
    await above.unmount();

    await clock.advance(60_000);
    await called;
  },
);
