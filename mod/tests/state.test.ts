// Runs under `claude plugin test` (npm run test:mod from mcp/), not under vitest.
// The reducer itself is covered by mod/test/reduce.spec.ts; here the hook is checked: a call of a
// LoadCraft tool changes the session state, and the caller gets the result back untouched.
import { expect, mock, test } from 'claude-code/testing';

// The manifest's userConfig has a required token without a default; a load without it fails.
// The value is a test sentinel, never a real token.
const CONFIGURED = { options: { api_token: 'CANARY-SECRET-7f3a' } };

const TOOL = 'mcp__plugin_loadcraft_lc__run_start';
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';

const STATUS = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: '5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61', name: 'sklep' },
  environments: [{ name: 'perf', isDefault: true, protected: false, active: true, caps: {} }],
  counts: { flows: 1, scenarios: 1, compositions: 1 },
  recentRuns: [],
  moreRuns: 0,
  operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  next: { step: 'run_start', hint: 'no_runs' },
};

// Records every write of the session state; the kit answers `$.state` itself and lets the write on.
function watchState(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const writes: unknown[] = [];
  on('state.set', ($, e, next) => {
    // The live line of a running test keeps its own value (`progress`, see progress.test.ts).
    if (e.key === 'session') writes.push(e.value);
    return next(e);
  });
  return writes;
}

test(
  'a LoadCraft tool call changes the state and returns its result as it came',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const writes = watchState(on);
    const text = `The operation is still running in LoadCraft: ${HANDLE}.`;
    const returned = { ref: 1, result: text, text };
    on('tool.call', () => returned);
    on('mcp.call', () => ({
      value: { content: [{ type: 'text', text: JSON.stringify(STATUS) }], isError: false },
    }));

    const result = await $.tool.call({ tool: TOOL });
    // The status is read in the background, after the result went back.
    await clock.settle();

    expect(result).toEqual(returned);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last).toMatchObject({
      step: 6,
      project: { name: 'sklep' },
      environment: { name: 'perf', protected: false },
      operation: { handle: HANDLE, kind: 'test_run' },
      isStale: false,
    });
    expect(JSON.stringify(writes)).not.toContain('CANARY-SECRET');
  },
);

test('the result is the same when the status cannot be read', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 });
  const writes = watchState(on);
  const returned = { ref: 1, result: 'done', text: 'done' };
  on('tool.call', () => returned);
  on('mcp.call', () => ({ deny: 'server not connected' }));

  const result = await $.tool.call({ tool: TOOL });
  await clock.settle();

  expect(result).toEqual(returned);
  // The tool name alone still moved the state.
  expect(writes[writes.length - 1]).toMatchObject({ step: 6 });
});

test('a tool of another server leaves the state alone', CONFIGURED, async ($, on) => {
  mock.clock(on, { now: 1_000 });
  const writes = watchState(on);
  const returned = { ref: 1, result: 'x', text: 'x' };
  on('tool.call', () => returned);

  const result = await $.tool.call({ tool: 'mcp__plugin_other_server__run_start' });

  expect(result).toEqual(returned);
  expect(writes).toEqual([]);
});

test(
  'a failed call (an error code in the text) does not move the step',
  CONFIGURED,
  async ($, on) => {
    mock.clock(on, { now: 1_000 });
    const writes = watchState(on);
    const text = '[run_environment_busy] The environment is busy.';
    const returned = { ref: 1, result: text, text, isError: true };
    on('tool.call', () => returned);
    on('mcp.call', () => ({ deny: 'server not connected' }));

    const result = await $.tool.call({ tool: TOOL });

    expect(result).toEqual(returned);
    expect(writes).toEqual([]);
  },
);

const IDLE_STATUS = { value: { content: [{ type: 'text', text: JSON.stringify(STATUS) }] } };

test(
  'a status read that never returns does not hold the result back',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    watchState(on);
    const returned = { ref: 1, result: 'done', text: 'done' };
    on('tool.call', () => returned);
    // Answers only after a billion milliseconds of the test clock, which never pass.
    on('mcp.call', async () => {
      await clock.sleep(1_000_000_000);
      return IDLE_STATUS;
    });

    const result = await $.tool.call({ tool: TOOL });

    expect(result).toEqual(returned);
  },
);

test('the counters of one load do not reach the next', CONFIGURED, async ($, on) => {
  // The test before this one left a read that never returns; a fresh load starts from no read in flight.
  const clock = mock.clock(on, { now: 1_000 });
  watchState(on);
  on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
  let reads = 0;
  on('mcp.call', () => {
    reads += 1;
    return IDLE_STATUS;
  });

  await $.tool.call({ tool: TOOL });
  await clock.settle();

  expect(reads).toBe(1);
});

test(
  'two quick calls start one read, and one more follows the second',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    watchState(on);
    const returned = { ref: 1, result: 'done', text: 'done' };
    on('tool.call', () => returned);
    let reads = 0;
    on('mcp.call', async () => {
      reads += 1;
      await clock.sleep(500);
      return IDLE_STATUS;
    });

    await $.tool.call({ tool: TOOL });
    await clock.settle();
    await $.tool.call({ tool: TOOL });
    await clock.settle();
    expect(reads).toBe(1);

    // The first read ends; the second call gets exactly one read of its own.
    await clock.advance(500);
    expect(reads).toBe(2);
    await clock.advance(5_000);
    expect(reads).toBe(2);

    // Nothing waits any more: the next call reads again.
    await $.tool.call({ tool: TOOL });
    await clock.settle();
    expect(reads).toBe(3);
  },
);

test(
  'a process_get_status call of the model starts no read while the state is fresh',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    watchState(on);
    const returned = { ref: 1, result: 'status', text: 'status' };
    on('tool.call', () => returned);
    let reads = 0;
    on('mcp.call', () => {
      reads += 1;
      return IDLE_STATUS;
    });
    const STATUS_TOOL = 'mcp__plugin_loadcraft_lc__process_get_status';

    // A state nothing filled yet (after /clear or /resume) is refilled by the read.
    await $.tool.call({ tool: STATUS_TOOL });
    await clock.settle();
    expect(reads).toBe(1);

    const result = await $.tool.call({ tool: STATUS_TOOL });
    await clock.settle();
    expect(result).toEqual(returned);
    expect(reads).toBe(1);
  },
);

function statusOf(name: string, hint: string) {
  return {
    ...STATUS,
    project: { id: 'p-' + name, name },
    operations: [],
    next: { step: 'x', hint },
  };
}

test(
  'a late answer does not undo a newer call, and the call gets its own read',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const writes = watchState(on);
    let text = `running ${HANDLE}`;
    on('tool.call', () => ({ ref: 1, result: text, text }));
    // First read: a slow snapshot taken before the second call (it still says "no flows").
    // Second read: what the server says after the second call (a report is waiting).
    const answers = [
      { after: 1_000, status: statusOf('old', 'no_flows') },
      { after: 0, status: statusOf('new', 'no_analysis') },
    ];
    let reads = 0;
    on('mcp.call', async () => {
      const answer = answers[reads] ?? answers[1];
      reads += 1;
      await clock.sleep(answer?.after ?? 0);
      return { value: { content: [{ type: 'text', text: JSON.stringify(answer?.status) }] } };
    });

    await $.tool.call({ tool: TOOL });
    await clock.settle();
    text = 'report';
    await $.tool.call({ tool: 'mcp__plugin_loadcraft_lc__results_get_report' });
    await clock.advance(1_000);
    await clock.settle();

    expect(reads).toBe(2);
    // The old picture is applied, but the report call is put on top of it: the step never goes back.
    const first = writes.findIndex((value) => (value as { step: number }).step === 7);
    expect(first).toBeGreaterThan(-1);
    for (const value of writes.slice(first)) expect(value).toMatchObject({ step: 7 });
    const projects = writes.map((value) => (value as { project?: { name: string } }).project?.name);
    expect(projects).toContain('old');
    expect(writes[writes.length - 1]).toMatchObject({ step: 7, project: { name: 'new' } });
  },
);

test(
  'an answer that comes back after its read stopped counting neither writes nor frees the newer read',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 0 });
    const writes = watchState(on);
    on('tool.call', () => ({ ref: 1, result: 'done', text: 'done' }));
    // Read A (from 0 s) takes 40 s, read B (from 31 s) 20 s, the trailing read C answers at once.
    const plan = [
      { after: 40_000, name: 'A' },
      { after: 20_000, name: 'B' },
      { after: 0, name: 'C' },
    ];
    let reads = 0;
    on('mcp.call', async () => {
      const step = plan[reads] ?? plan[2];
      reads += 1;
      await clock.sleep(step?.after ?? 0);
      const status = statusOf(step?.name ?? '?', 'no_runs');
      return { value: { content: [{ type: 'text', text: JSON.stringify(status) }] } };
    });

    await $.tool.call({ tool: TOOL });
    await clock.settle();
    expect(reads).toBe(1);

    // 31 s: A has been running longer than the limit, so this call starts B.
    await clock.advance(31_000);
    await $.tool.call({ tool: TOOL });
    await clock.settle();
    expect(reads).toBe(2);

    // 40 s: A answers late. B is still running and must stay the read that counts.
    await clock.advance(9_000);
    // 41 s: this call finds B running, so it waits for it instead of starting a third read.
    await clock.advance(1_000);
    await $.tool.call({ tool: TOOL });
    await clock.settle();
    expect(reads).toBe(2);

    // 51 s: B answers (applied); one read follows and is written.
    await clock.advance(10_000);
    await clock.settle();
    expect(reads).toBe(3);
    const names = writes.map((value) => (value as { project?: { name: string } }).project?.name);
    expect(names).not.toContain('A');
    // B is applied with the call that came after it started.
    expect(names).toContain('B');
    expect(names).toContain('C');
  },
);

test(
  'a busy session still gets fresh facts: the read is slower than the calls',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 0 });
    const writes = watchState(on);
    on('tool.call', () => ({ ref: 1, result: `running ${HANDLE}`, text: `running ${HANDLE}` }));
    // Every read takes 5 s and says "no flows"; the calls (run_start) come every 3 s.
    let finished = 0;
    on('mcp.call', async () => {
      await clock.sleep(5_000);
      finished += 1;
      const status = { ...statusOf('S', 'no_flows'), operations: [] };
      return { value: { content: [{ type: 'text', text: JSON.stringify(status) }] } };
    });

    let seen = 0;
    let applied = 0;
    for (let call = 0; call < 12; call += 1) {
      await $.tool.call({ tool: TOOL });
      await clock.advance(3_000);
      await clock.settle();
      if (finished > seen) {
        seen = finished;
        // Right after a read ended: its facts are in, and what the calls said is still there.
        expect(writes[writes.length - 1]).toMatchObject({
          project: { name: 'S' },
          environment: { name: 'perf' },
          step: 6,
          operation: { handle: HANDLE },
        });
        applied += 1;
      }
    }
    expect(applied).toBeGreaterThanOrEqual(5);
  },
);

test('the calls that came during a read are put back in their order', CONFIGURED, async ($, on) => {
  const clock = mock.clock(on, { now: 0 });
  const writes = watchState(on);
  const H1 = 'test_run:11111111-aaaa-4bbb-8ccc-111111111111';
  const H2 = 'test_run:22222222-aaaa-4bbb-8ccc-222222222222';
  let text = 'flow';
  on('tool.call', () => ({ ref: 1, result: text, text }));
  on('mcp.call', async () => {
    await clock.sleep(10_000);
    const status = { ...statusOf('S', 'no_flows'), operations: [] };
    return { value: { content: [{ type: 'text', text: JSON.stringify(status) }] } };
  });
  const call = async (tool: string, body: string, at: number): Promise<void> => {
    await clock.set(at);
    text = body;
    await $.tool.call({ tool: `mcp__plugin_loadcraft_lc__${tool}` });
  };

  // The first call starts the read; the next three arrive while it runs.
  await call('flows_get', 'flow', 0);
  await call('run_start', `running ${H1}`, 1_000);
  await call('results_get_report', 'report', 2_000);
  await call('run_start', `running ${H2}`, 3_000);
  await clock.set(10_000);
  await clock.settle();

  const withFacts = writes.filter(
    (value) => (value as { project?: unknown }).project !== undefined,
  );
  expect(withFacts.length).toBeGreaterThan(0);
  expect(withFacts[0]).toMatchObject({
    step: 6,
    project: { name: 'S' },
    operation: { handle: H2, startedAt: 3_000 },
  });
});

test(
  'the report of a test that passed ticks step 7 and skips step 8, and a later status keeps both',
  CONFIGURED,
  async ($, on) => {
    const clock = mock.clock(on, { now: 1_000 });
    const writes = watchState(on);
    on('tool.call', () => ({ ref: 1, result: 'report', text: 'report' }));
    const passed = {
      ...STATUS,
      operations: [],
      next: {
        step: 'results_get_report',
        hint: 'passed_no_diagnosis',
        subject: 'e-3f9a12c4',
        skipped: ['results_analyze_run'],
      },
    };
    on('mcp.call', () => ({
      value: { content: [{ type: 'text', text: JSON.stringify(passed) }], isError: false },
    }));

    await $.tool.call({ tool: 'mcp__plugin_loadcraft_lc__results_get_report' });
    await clock.settle();
    expect(writes[writes.length - 1]).toMatchObject({
      step: 7,
      done: [1, 2, 3, 4, 5, 6, 7],
      skipped: [8],
    });

    // The status the model asks for next says the same hint again: nothing goes back.
    await $.tool.call({ tool: 'mcp__plugin_loadcraft_lc__process_get_status' });
    await clock.advance(60_000);
    await clock.settle();
    expect(writes[writes.length - 1]).toMatchObject({
      step: 7,
      done: [1, 2, 3, 4, 5, 6, 7],
      skipped: [8],
    });
  },
);
