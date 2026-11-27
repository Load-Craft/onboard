// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The pure decision is covered by mod/test/consent.spec.ts; here the hook is checked as Claude Code
// runs it: what reaches the tool after a yes, what the model reads after a no, and that a mod that
// fails, or has nobody to ask, never stands between the user and the tool.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };
const POLISH = { options: { api_token: 'CANARY-SECRET-7f3a', locale: 'pl' } };

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const RUN_TEST = `${PREFIX}run_start`;
const PROVISION_ACCOUNTS = `${PREFIX}data_create_accounts`;
const DESCRIBE_FLOWS = `${PREFIX}flows_describe_journeys`;
const CANCEL = `${PREFIX}process_cancel`;
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';

const RUN_ARGS = {
  scenario: 'checkout',
  environment: 'qa',
  profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
};

const QA_CLAMPED = {
  dry_run: true,
  target: { kind: 'composition', name: 'checkout' },
  environment: {
    name: 'qa',
    protected: true,
    limit: { max_vu: 100, max_rps: 20 },
  },
  profile_label: 'Ramp load (closed)',
  profile_requested: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
  profile_effective: { type: 'ramp_concurrency', vusers: 100, ramp: 600 },
  capped: true,
  consent_required: true,
  data: {
    needed: 1200,
    available: 2000,
    ready: true,
    slots: [],
    refusal: null,
  },
  planned_s: 600,
  busy: null,
};

const PERF_FREE = {
  ...QA_CLAMPED,
  environment: { name: 'perf', protected: false },
  profile_effective: QA_CLAMPED.profile_requested,
  capped: false,
  consent_required: false,
};

const SNAPSHOT = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
};

const STATUS = {
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: true, caps: {} },
    {
      name: 'qa',
      isDefault: false,
      protected: true,
      active: false,
      caps: { maxVu: 100 },
    },
  ],
};

const block = (data: unknown) => ({
  value: {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError: false,
  },
});

/**
 * The world beneath the mod: the tool itself (counts its calls and keeps what reached it), the
 * server's facts, who is there to ask, and the user's answer (`undefined`: the dialog is closed).
 */
function world(
  on: Parameters<Parameters<typeof test>[1]>[1],
  options: {
    readonly tool: string;
    readonly facts?: unknown;
    readonly answer?: string | ((labels: readonly string[]) => string) | undefined;
    readonly surfaces?: readonly string[];
    readonly factsFail?: boolean;
    readonly clock?: boolean;
  },
) {
  const seen = {
    calls: [] as Record<string, unknown>[],
    questions: [] as { question: string; labels: string[] }[],
    reads: [] as Record<string, unknown>[],
  };
  if (options.clock !== false) mock.clock(on, { now: 1_000_000 });
  on('tool.call', { tool: options.tool }, ($, e) => {
    seen.calls.push({ ...e });
    return { result: 'the tool ran' };
  });
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const [first] = e.questions;
    const labels = first.options.map((option: { label: string }) => option.label);
    seen.questions.push({ question: first.question, labels });
    if (options.answer === undefined) return { deny: 'The user dismissed the question.' };
    const answer = typeof options.answer === 'function' ? options.answer(labels) : options.answer;
    return { result: { answers: { [first.question]: answer } } };
  });
  on('mcp.call', ($, e) => {
    seen.reads.push({ server: e.server, tool: e.tool, args: e.args });
    if (options.factsFail === true) return { deny: 'server not connected' };
    return block(options.facts);
  });
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }));
  return seen;
}

const YES = (labels: readonly string[]) => labels[0] ?? '';
const NO = (labels: readonly string[]) => labels[1] ?? '';

test(
  'a yes lets the very call through to the tool, arguments untouched',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: RUN_TEST, facts: QA_CLAMPED, answer: YES });

    const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

    expect(seen.questions).toHaveLength(1);
    expect(seen.questions[0].question).toContain('clamped from 2,000 to 100 users');
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toMatchObject({ tool: RUN_TEST, ...RUN_ARGS });
    expect(Object.keys(seen.calls[0]).filter((key) => key.startsWith('confirm'))).toEqual([]);
    expect(result).toMatchObject({ result: 'the tool ran' });
    // The facts came from process_get_status, read-only, with the arguments of the call.
    expect(seen.reads).toEqual([
      {
        server: 'plugin:loadcraft:lc',
        tool: 'process_get_status',
        args: { preflight: RUN_ARGS, format: 'data', from_panel: true },
      },
    ]);
  },
);

test(
  'a no refuses the call: the tool never runs and the model reads why',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: RUN_TEST, facts: QA_CLAMPED, answer: NO });

    const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

    expect(seen.calls).toHaveLength(0);
    expect(JSON.stringify(result)).toContain(
      '[user_declined] The user declined to start this test (checkout on environment qa, protected, profile capped 2,000 → 100 users). Nothing was started. Do not retry; ask the user what to change.',
    );
  },
);

test('a typed answer that is not the yes label refuses the call', CONFIGURED, async ($, on) => {
  const seen = world(on, {
    tool: RUN_TEST,
    facts: QA_CLAMPED,
    answer: 'ok, go ahead',
  });

  const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

  expect(seen.calls).toHaveLength(0);
  expect(JSON.stringify(result)).toContain('[user_declined]');
});

test(
  'the consent hook runs before the state hook: a no writes no state, a yes writes the consent, then the session',
  CONFIGURED,
  async ($, on) => {
    const writes: string[] = [];
    on('state.set', ($, e, next) => {
      // The live line of a running test keeps its own value (`progress`); it is not under test here.
      if (e.key !== 'progress') writes.push(String(e.key));
      return next(e);
    });
    let pick = NO;
    world(on, {
      tool: RUN_TEST,
      facts: QA_CLAMPED,
      answer: (labels) => pick(labels),
      clock: false,
    });
    const clock = mock.clock(on, { now: 1_000_000 });

    // A refused call never reaches the hook that records the session, not even in the background.
    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
    await clock.settle();
    expect(writes).toEqual([]);

    pick = YES;
    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
    await clock.settle();
    expect(writes).toEqual(['consent', 'session']);
  },
);

test('a closed dialog refuses the call while someone could answer', CONFIGURED, async ($, on) => {
  const seen = world(on, {
    tool: RUN_TEST,
    facts: QA_CLAMPED,
    answer: undefined,
  });

  const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

  expect(seen.questions).toHaveLength(1);
  expect(seen.calls).toHaveLength(0);
  expect(JSON.stringify(result)).toContain('[user_declined]');
});

test(
  'with nobody to ask (claude -p) the call goes on to the server guard',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, {
      tool: RUN_TEST,
      facts: QA_CLAMPED,
      answer: undefined,
      surfaces: [],
    });

    const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toMatchObject({ tool: RUN_TEST, ...RUN_ARGS });
    expect(result).toMatchObject({ result: 'the tool ran' });
  },
);

test(
  'without the facts (an older server, an error) the call goes on unasked',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: RUN_TEST, factsFail: true, answer: NO });

    const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

    expect(seen.questions).toHaveLength(0);
    expect(seen.calls).toHaveLength(1);
    expect(result).toMatchObject({ result: 'the tool ran' });
  },
);

test(
  'a test within the limits of an unprotected environment is not asked about',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: RUN_TEST, facts: PERF_FREE, answer: NO });

    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS, environment: 'perf' });

    expect(seen.questions).toHaveLength(0);
    expect(seen.calls).toHaveLength(1);
  },
);

test('a hook that fails before next lets the call through (.catch)', CONFIGURED, async ($, on) => {
  // No clock: the hook's `$.clock.now()` rejects with "no implementation", after the facts and
  // before any question.
  const seen = world(on, {
    tool: RUN_TEST,
    facts: QA_CLAMPED,
    answer: NO,
    clock: false,
  });

  const result = await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });

  expect(seen.questions).toHaveLength(0);
  expect(seen.calls).toHaveLength(1);
  expect(result).toMatchObject({ result: 'the tool ran' });
});

test(
  'the repeat with confirm_capped after a yes is not asked again, once',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: RUN_TEST, facts: QA_CLAMPED, answer: YES });

    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS, confirm_capped: true });
    expect(seen.questions).toHaveLength(1);
    expect(seen.calls).toHaveLength(2);
    expect(seen.calls[1]).toMatchObject({ confirm_capped: true });

    // The consent was used: the next call with the same facts asks again.
    await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS, confirm_capped: true });
    expect(seen.questions).toHaveLength(2);
  },
);

test('a consent older than ten minutes is asked again', CONFIGURED, async ($, on) => {
  const seen = world(on, {
    tool: RUN_TEST,
    facts: QA_CLAMPED,
    answer: YES,
    clock: false,
  });
  const clock = mock.clock(on, { now: 1_000_000 });

  await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
  await clock.advance(10 * 60 * 1000);
  await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS, confirm_capped: true });

  expect(seen.questions).toHaveLength(2);
});

test('a no leaves no consent behind', CONFIGURED, async ($, on) => {
  let answer = 'No';
  const seen = world(on, {
    tool: RUN_TEST,
    facts: QA_CLAMPED,
    answer: (labels) => (answer === 'No' ? labels[1] : labels[0]),
  });

  await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS });
  answer = 'Yes';
  await $.tool.call({ tool: RUN_TEST, ...RUN_ARGS, confirm_capped: true });

  expect(seen.questions).toHaveLength(2);
  expect(seen.calls).toHaveLength(1);
});

test(
  'cancel asks with the snapshot of the operation, stopping first',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: CANCEL, facts: SNAPSHOT, answer: YES });

    await $.tool.call({ tool: CANCEL, operation: HANDLE });

    expect(seen.reads[0]).toMatchObject({
      tool: 'process_get_status',
      args: { operation: HANDLE, format: 'data' },
    });
    expect(seen.questions[0]).toEqual({
      question: 'Stop test e-3f9a12c4 after 6:40 of 10:00?',
      labels: ['Stop the test', 'Keep it running'],
    });
    expect(seen.calls).toEqual(
      [{ tool: CANCEL, operation: HANDLE }].map((call) => expect.objectContaining(call)),
    );
  },
);

test('cancel goes on unasked when the snapshot cannot be read', CONFIGURED, async ($, on) => {
  const seen = world(on, { tool: CANCEL, factsFail: true, answer: NO });

  await $.tool.call({ tool: CANCEL, operation: HANDLE });

  expect(seen.questions).toHaveLength(0);
  expect(seen.calls).toHaveLength(1);
});

test(
  'data_create_accounts asks before it creates accounts, in the language of the plugin',
  POLISH,
  async ($, on) => {
    const seen = world(on, {
      tool: PROVISION_ACCOUNTS,
      facts: STATUS,
      answer: NO,
    });

    const result = await $.tool.call({
      tool: PROVISION_ACCOUNTS,
      scenario: 'checkout',
      environment: 'qa',
      slot: 'konta',
      count: 2000,
    });

    expect(seen.questions[0].question).toBe(
      'Założyć 2 000 kont dla slotu konta na qa (chronione) w testowanym systemie?',
    );
    expect(seen.calls).toHaveLength(0);
    expect(JSON.stringify(result)).toContain(
      '[user_declined] The user declined to create these accounts',
    );
  },
);

test(
  'the repeat of data_create_accounts with confirm_protected after a yes is not asked again',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, {
      tool: PROVISION_ACCOUNTS,
      facts: STATUS,
      answer: YES,
    });
    const call = {
      tool: PROVISION_ACCOUNTS,
      scenario: 'checkout',
      environment: 'qa',
      slot: 'konta',
      count: 2000,
    };

    await $.tool.call(call);
    await $.tool.call({ ...call, confirm_protected: true });

    expect(seen.questions).toHaveLength(1);
    expect(seen.calls).toHaveLength(2);
    expect(seen.calls[0]).not.toHaveProperty('confirm_protected');
  },
);

test(
  'flows_describe_journeys asks only when the browser signs in with an account',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: DESCRIBE_FLOWS, answer: YES });

    await $.tool.call({
      tool: DESCRIBE_FLOWS,
      description: 'buy',
      environment: 'qa',
    });
    expect(seen.questions).toHaveLength(0);

    await $.tool.call({
      tool: DESCRIBE_FLOWS,
      description: 'buy',
      environment: 'qa',
      account: { from_env: '.env.perf', email_key: 'E2E_EMAIL' },
    });
    expect(seen.questions).toHaveLength(1);
    expect(seen.questions[0].question).toContain('.env.perf (E2E_EMAIL)');
    expect(seen.calls).toHaveLength(2);
    // No server read is needed: the numbers are the call's own.
    expect(seen.reads).toEqual([]);
  },
);

test('another tool of the plugin is never asked about', CONFIGURED, async ($, on) => {
  const seen = world(on, { tool: `${PREFIX}results_get_report`, answer: NO });

  await $.tool.call({ tool: `${PREFIX}results_get_report`, run: 'e-3f9a12c4' });

  expect(seen.questions).toHaveLength(0);
  expect(seen.calls).toHaveLength(1);
});

test(
  'a model that sets from_panel on cancel is refused and nothing is asked',
  CONFIGURED,
  async ($, on) => {
    const seen = world(on, { tool: CANCEL, facts: SNAPSHOT, answer: YES });

    const result = await $.tool.call({
      tool: CANCEL,
      operation: HANDLE,
      from_panel: true,
    });

    expect(result).toMatchObject({
      deny: expect.stringContaining('from_panel'),
    });
    expect(seen.calls).toHaveLength(0);
    expect(seen.questions).toHaveLength(0);
  },
);

test('a model that sets from_panel on process_get_status is refused', CONFIGURED, async ($, on) => {
  const seen = world(on, { tool: `${PREFIX}process_get_status` });

  const result = await $.tool.call({
    tool: `${PREFIX}process_get_status`,
    from_panel: true,
  });

  expect(result).toMatchObject({
    deny: expect.stringContaining('from_panel'),
  });
  expect(seen.calls).toHaveLength(0);
});

test('process_get_status without from_panel reaches the tool', CONFIGURED, async ($, on) => {
  const seen = world(on, { tool: `${PREFIX}process_get_status` });

  const result = await $.tool.call({ tool: `${PREFIX}process_get_status` });

  expect(result).toMatchObject({ result: 'the tool ran' });
  expect(seen.calls).toHaveLength(1);
});
