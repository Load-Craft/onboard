// Vitest file. Named *.spec.ts on purpose: `claude plugin test` collects every *.test.ts in the
// plugin and would try to run this file in the mods environment (see mod/docs/mods-facts.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { StatusData } from '../../mcp/src/render/views/getStatus.js';
import { processGetStatus } from '../../mcp/src/tools/processGetStatus.js';
import { runStart } from '../../mcp/src/tools/runStart.js';
import { processWait } from '../../mcp/src/tools/processWait.js';
import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { registerAnalysisReadRoute } from '../../mcp/test/fake-backend/routes/analysis.js';
import { registerDataRoutes } from '../../mcp/test/fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from '../../mcp/test/fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../../mcp/test/fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../../mcp/test/fake-backend/routes/lookup.js';
import { registerStatusRoutes } from '../../mcp/test/fake-backend/routes/status.js';
import { seedSklep } from '../../mcp/test/fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from '../../mcp/test/helpers/clock.js';
import { CANARY, toolRig } from '../../mcp/test/helpers/rig.js';
import type { PluginState } from 'claude-code';

import { reduce } from '../src/state/reduce.js';
import { parseDataBlock, resultText, toolSignal } from '../src/state/signal.js';
import { INITIAL_STATE, type ModState, type Signal } from '../src/state/types.js';

// The declaration the manifest points at and `ModState` must describe the same value, both ways.
type Declared = PluginState['loadcraft']['session'];
const declaredFromState: Declared = INITIAL_STATE;
const stateFromDeclared: ModState = declaredFromState;

const PREFIX = 'mcp__plugin_loadcraft_lc__';
const HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;
const NOW = 1_700_000_000_000;

const golden = (path: string): string =>
  readFileSync(join(import.meta.dirname, '..', '..', 'mcp', 'test', 'golden', path), 'utf8');

/** What `next(e)` resolves to for a tool that sent text: `{ ref, result, text }`. */
const answer = (text: string): unknown => ({ ref: 1, result: text, text });

function call(state: ModState, tool: string, text: string, now = NOW): ModState {
  const signal = toolSignal(`${PREFIX}${tool}`, answer(text));
  if (signal === undefined) throw new Error(`no signal for ${tool}`);
  return reduce(state, signal, now);
}

const STATUS: StatusData = {
  asOf: '2026-11-22T11:00:00.000Z',
  identity: { userId: 'u-1' },
  compat: { backendVersion: '2.4.0', apiRevision: 7, plugin: '1.0.0' },
  project: { id: SKLEP_IDS.project, name: 'sklep' },
  setup: { complete: true, missing: [] },
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: false, caps: {} },
    { name: 'qa', isDefault: false, protected: true, active: true, caps: { maxVu: 100 } },
  ],
  counts: { flows: 2, scenarios: 1, compositions: 1 },
  recentRuns: [
    {
      handle: 'e-3f9a12c4',
      id: SKLEP_IDS.executionPerf,
      target: 'checkout',
      status: 'completed',
      when: '2026-11-22T10:00:00.000Z',
    },
  ],
  moreRuns: 0,
  operations: [],
  next: { step: 'results_get_report', hint: 'no_analysis', subject: 'e-3f9a12c4' },
};

const statusSignal = (data: unknown): Signal => ({ kind: 'status', data });

it('the declaration of the state in types/index.d.ts is ModState', () => {
  expect(stateFromDeclared).toBe(INITIAL_STATE);
});

describe('reduce: the tools of run 1', () => {
  it('walks the steps 02 to 08 in the order of the run', () => {
    const run = (file: string): string => golden(`run1/${file}`);
    const steps: number[] = [];
    let state = INITIAL_STATE;
    const sequence: [string, string][] = [
      ['project_create', run('01a-project_create.pl.txt')],
      ['project_save_env', run('01b-project_save_env.pl.txt')],
      ['project_check_env', run('01c-project_check_env.pl.txt')],
      ['project_analyze_setup', run('01d-project_analyze_setup.pl.txt')],
      ['project_apply_setup', run('01e-project_apply_setup.pl.txt')],
      ['flows_generate_from_suggestions', run('04-flows_generate_from_suggestions.pl.txt')],
      ['scenario_generate', run('06-scenario_generate-generowanie.pl.txt')],
      ['data_check_readiness', run('07-data_check_readiness-plan.pl.txt')],
      ['data_create_accounts', run('08-data_create_accounts.pl.txt')],
      ['scenario_check_self', run('09-scenario_check_self.pl.txt')],
      ['run_start', run('10-run_start.pl.txt')],
      ['results_get_report', run('11-results_get_report.pl.txt')],
      ['results_analyze_run', run('12-results_analyze_run.pl.txt')],
    ];
    for (const [tool, text] of sequence) {
      state = call(state, tool, text);
      steps.push(state.step);
    }
    expect(steps).toEqual([2, 2, 2, 2, 2, 3, 4, 5, 5, 5, 6, 7, 8]);
    // The analysis names its handle for the next call; that is no operation still running.
    expect(state.operation).toBeUndefined();
    expect(state.done).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(state.isStale).toBe(false);
    expect(state.updatedAt).toBe(NOW);
  });

  it('a provisioning that goes on after the call is an operation of step 5', () => {
    const handle = 'account_provision:6a1f0c2e-9b3d-4e7a-8c5f-1d2e3f4a5b6c';
    const running = `20 / 2 000 accounts\nThe operation is still running in LoadCraft: ${handle}.`;
    const started = call(INITIAL_STATE, 'data_create_accounts', running, NOW);
    expect(started.step).toBe(5);
    expect(started.operation?.handle).toBe(handle);
  });

  it('a result that names a running operation sets it, and results_get_report clears it', () => {
    const running = `The operation is still running in LoadCraft: ${HANDLE}.\nCall wait with operation "${HANDLE}" to keep waiting.`;
    const started = call(INITIAL_STATE, 'run_start', running, NOW);
    expect(started.step).toBe(6);
    expect(started.operation).toEqual({
      handle: HANDLE,
      kind: 'test_run',
      tool: 'run_start',
      startedAt: NOW,
    });
    // The same operation named again keeps the time it was first seen.
    expect(call(started, 'process_wait', running, NOW + 5000).operation?.startedAt).toBe(NOW);
    const read = call(
      started,
      'results_get_report',
      golden('run1/11-results_get_report.pl.txt'),
      NOW + 9000,
    );
    expect(read.operation).toBeUndefined();
    expect(read.step).toBe(7);
  });

  it('a result that waits for the user leaves the operation in place', () => {
    const waiting = `The operation is waiting for the user: ${HANDLE}.\nShow the user the message above.`;
    const started = call(INITIAL_STATE, 'run_start', waiting);
    expect(call(started, 'process_wait', waiting, NOW + 1).operation?.handle).toBe(HANDLE);
  });

  it('a report that names the finished run does not put it in progress', () => {
    const started = call(INITIAL_STATE, 'run_start', `running: ${HANDLE}`);
    const read = call(started, 'results_get_report', `report of ${HANDLE}`, NOW + 1);
    expect(read.operation).toBeUndefined();
    expect(
      call(INITIAL_STATE, 'results_get_report', `report of ${HANDLE}`).operation,
    ).toBeUndefined();
  });

  it('a tool error changes nothing', () => {
    const before = call(
      INITIAL_STATE,
      'project_apply_setup',
      golden('run1/01e-project_apply_setup.pl.txt'),
    );
    const failed = call(before, 'run_start', '[run_environment_busy] The environment is busy.');
    expect(failed).toBe(before);
  });

  it('process_get_status alone does not move a session that is further on', () => {
    const before = call(INITIAL_STATE, 'run_start', 'test finished');
    expect(call(before, 'process_get_status', 'status text').step).toBe(6);
    expect(call(INITIAL_STATE, 'process_get_status', 'status text').step).toBe(2);
  });
});

describe('reduce: the data block of process_get_status', () => {
  it('takes project, environment, step and last run from an empty state', () => {
    const state = reduce(INITIAL_STATE, statusSignal(STATUS), NOW);
    expect(state).toEqual({
      project: { name: 'sklep', id: SKLEP_IDS.project },
      environment: { name: 'qa', protected: true },
      step: 7,
      done: [1, 2, 3, 4, 5, 6],
      lastExecution: 'e-3f9a12c4',
      ended: [],
      skipped: [],
      updatedAt: NOW,
      isStale: false,
    });
  });

  it('a reading that learned nothing new returns the same state, whatever the time', () => {
    const first = reduce(INITIAL_STATE, statusSignal(STATUS), NOW);
    expect(reduce(first, statusSignal(STATUS), NOW + 60_000)).toBe(first);
  });

  it('maps every hint to its step', () => {
    const hints = {
      unbound: 2,
      setup_incomplete: 2,
      no_flows: 3,
      no_compositions: 4,
      needs_data: 5,
      no_runs: 6,
      no_analysis: 7,
      passed_no_diagnosis: 7,
      all_done: 8,
    } as const;
    for (const [hint, step] of Object.entries(hints)) {
      const data = { ...STATUS, next: { step: 'x', hint } };
      expect(reduce(INITIAL_STATE, statusSignal(data), NOW).step).toBe(step);
    }
  });

  it('forgets the project and the operation the status no longer has', () => {
    const busy = call(INITIAL_STATE, 'run_start', `running: ${HANDLE}`);
    const unbound = {
      ...STATUS,
      project: undefined,
      environments: [],
      recentRuns: [],
      next: { step: 'project_create', hint: 'unbound' },
    };
    const state = reduce(busy, statusSignal(unbound), NOW + 1);
    expect(state.project).toBeUndefined();
    expect(state.environment).toBeUndefined();
    expect(state.operation).toBeUndefined();
    expect(state.lastExecution).toBeUndefined();
    expect(state.step).toBe(2);
  });

  it('takes the operation the status lists, keeping the start time the status gives', () => {
    const data = {
      ...STATUS,
      operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
    };
    const state = reduce(INITIAL_STATE, statusSignal(data), NOW);
    expect(state.operation).toEqual({
      handle: HANDLE,
      kind: 'test_run',
      tool: '',
      startedAt: Date.parse('2026-11-22T10:55:00.000Z'),
    });
  });
});

describe('reduce: an operation snapshot', () => {
  it('sets the operation with a start counted back from now', () => {
    const snapshot = { operation: HANDLE, kind: 'test_run', phase: 'running', elapsed_s: 405 };
    const state = reduce(INITIAL_STATE, { kind: 'operation', data: snapshot }, NOW);
    expect(state.operation?.startedAt).toBe(NOW - 405_000);
    expect(state.operation?.kind).toBe('test_run');
  });

  it('keeps the operation when it waits for the user', () => {
    const snapshot = { operation: HANDLE, kind: 'test_run', elapsed_s: 3, needs_user: 'Log in' };
    const state = reduce(INITIAL_STATE, { kind: 'operation', data: snapshot }, NOW);
    expect(state.operation?.handle).toBe(HANDLE);
  });

  it.each(['completed', 'failed', 'cancelled', 'abandoned'])(
    'takes the operation out when the snapshot says it is %s',
    (phase) => {
      const running = { operation: HANDLE, kind: 'test_run', phase: 'running', elapsed_s: 405 };
      const started = reduce(INITIAL_STATE, { kind: 'operation', data: running }, NOW);
      const over = { ...running, phase, elapsed_s: 610 };
      const ended = reduce(started, { kind: 'operation', data: over }, NOW + 205_000);
      expect(ended.operation).toBeUndefined();
      expect(ended.isStale).toBe(false);
    },
  );

  it('does not bring back, or take out, an operation the snapshot is not about', () => {
    const other = 'test_run:00000000-0000-4000-8000-000000000000';
    const started = reduce(
      INITIAL_STATE,
      { kind: 'operation', data: { operation: HANDLE, kind: 'test_run', elapsed_s: 5 } },
      NOW,
    );
    const over = { operation: other, kind: 'test_run', phase: 'completed', elapsed_s: 610 };
    const after = reduce(started, { kind: 'operation', data: over }, NOW + 1);
    expect(after.operation).toEqual(started.operation);
    expect(after.ended).toEqual([other]);
    expect(reduce(INITIAL_STATE, { kind: 'operation', data: over }, NOW).operation).toBeUndefined();
  });
});

describe('reduce: an operation that is over stays over', () => {
  const ended = (): ModState => {
    const running = { operation: HANDLE, kind: 'test_run', phase: 'running', elapsed_s: 405 };
    const started = reduce(INITIAL_STATE, { kind: 'operation', data: running }, NOW);
    const over = { ...running, phase: 'completed', elapsed_s: 610 };
    return reduce(started, { kind: 'operation', data: over }, NOW + 205_000);
  };
  const listing = {
    ...STATUS,
    operations: [{ handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' }],
  };

  it('remembers the handle', () => {
    expect(ended().ended).toEqual([HANDLE]);
    expect(ended().operation).toBeUndefined();
  });

  it('a later call that names the handle does not put it back in progress', () => {
    const state = call(
      ended(),
      'run_start',
      `The operation is still running: ${HANDLE}.`,
      NOW + 300_000,
    );
    expect(state.operation).toBeUndefined();
    expect(state.step).toBe(6);
  });

  it('a status that still lists the handle does not put it back either', () => {
    const state = reduce(ended(), statusSignal(listing), NOW + 300_000);
    expect(state.operation).toBeUndefined();
    expect(state.ended).toEqual([HANDLE]);
  });

  it('a snapshot of an operation that is over is never taken as in progress', () => {
    const again = { operation: HANDLE, kind: 'test_run', phase: 'running', elapsed_s: 700 };
    expect(
      reduce(ended(), { kind: 'operation', data: again }, NOW + 400_000).operation,
    ).toBeUndefined();
  });

  it('a snapshot that says it is over never starts it, even when the state knew nothing', () => {
    const over = { operation: HANDLE, kind: 'test_run', phase: 'failed', elapsed_s: 700 };
    const state = reduce(INITIAL_STATE, { kind: 'operation', data: over }, NOW);
    expect(state.operation).toBeUndefined();
    expect(state.ended).toEqual([HANDLE]);
  });

  it('keeps the newest 20 handles', () => {
    let state = INITIAL_STATE;
    for (let i = 0; i < 25; i += 1) {
      const handle = `test_run:id-${String(i)}`;
      state = reduce(state, { kind: 'lost', handle }, NOW + i);
    }
    expect(state.ended).toHaveLength(20);
    expect(state.ended[19]).toBe('test_run:id-24');
    expect(state.ended).not.toContain('test_run:id-0');
  });

  it('an operation lost track of leaves the state as unknown, not in progress', () => {
    const running = call(INITIAL_STATE, 'run_start', `running ${HANDLE}`);
    expect(running.operation?.handle).toBe(HANDLE);
    const lost = reduce(running, { kind: 'lost', handle: HANDLE }, NOW + 1);
    expect(lost.operation).toBeUndefined();
    expect(lost.ended).toEqual([HANDLE]);
    expect(reduce(lost, statusSignal(listing), NOW + 2).operation).toBeUndefined();
  });

  it('a lost signal without a handle changes nothing', () => {
    expect(reduce(INITIAL_STATE, { kind: 'lost', handle: 'nonsense' }, NOW)).toBe(INITIAL_STATE);
  });
});

describe('reduce: input it does not know', () => {
  const unknown: unknown[] = [
    undefined,
    null,
    {},
    [],
    'text',
    42,
    { kind: 'status' },
    { kind: 'status', data: {} },
    { kind: 'status', data: { identity: {}, next: { hint: 'nope' }, environments: [] } },
    { kind: 'status', data: { identity: {}, next: { hint: 'no_flows' } } },
    { kind: 'operation', data: { operation: 5 } },
    { kind: 'operation', data: {} },
    { kind: 'tool' },
    { kind: 'tool', tool: 'not_a_tool' },
    { kind: 'other', tool: 'run_start' },
  ];

  for (const [index, signal] of unknown.entries()) {
    it(`input ${String(index)} returns the same state`, () => {
      const state = call(INITIAL_STATE, 'flows_generate_from_suggestions', 'flows');
      expect(reduce(state, signal as Signal, NOW + 1)).toBe(state);
    });
  }
});

describe('the state holds no secret', () => {
  it('carries no token even when a result and the data contain one', () => {
    const leaky = { ...STATUS, identity: { userId: CANARY } };
    let state = reduce(INITIAL_STATE, statusSignal(leaky), NOW);
    state = call(state, 'project_create', `token ${CANARY} ${HANDLE}`);
    expect(JSON.stringify(state)).not.toContain(CANARY);
  });

  it('has no field for an address or a credential', () => {
    const state = reduce(INITIAL_STATE, statusSignal(STATUS), NOW);
    expect(Object.keys(state).sort()).toEqual(
      [
        'done',
        'ended',
        'environment',
        'isStale',
        'lastExecution',
        'project',
        'skipped',
        'step',
        'updatedAt',
      ].sort(),
    );
  });
});

describe('signal', () => {
  it('ignores a tool of another server', () => {
    expect(toolSignal('mcp__plugin_other_server__run_start', answer('x'))).toBeUndefined();
    expect(toolSignal('Bash', answer('x'))).toBeUndefined();
    expect(toolSignal(undefined, answer('x'))).toBeUndefined();
  });

  it('reads the code of an error and the handle of an operation, nothing else', () => {
    expect(toolSignal(`${PREFIX}run_start`, answer('[run_environment_busy] busy'))).toEqual({
      kind: 'tool',
      tool: 'run_start',
      errorCode: 'run_environment_busy',
    });
    expect(toolSignal(`${PREFIX}process_wait`, answer(`left: ${HANDLE}.`))).toEqual({
      kind: 'tool',
      tool: 'process_wait',
      handle: HANDLE,
    });
  });

  it('reads the text of content blocks and survives a result of no known shape', () => {
    const blocks = { ref: 1, result: [{ type: 'text', text: 'one' }, { type: 'image' }] };
    expect(resultText(blocks)).toBe('one\n');
    expect(resultText(undefined)).toBe('');
    expect(resultText({ result: 5 })).toBe('');
  });

  it('parses the one text block of a data answer, and nothing from an error', () => {
    const ok = { content: [{ type: 'text', text: JSON.stringify(STATUS) }], isError: false };
    expect(parseDataBlock(ok)).toEqual(STATUS);
    expect(parseDataBlock({ ...ok, isError: true })).toBeUndefined();
    expect(parseDataBlock({ content: [{ type: 'text', text: 'not json' }] })).toBeUndefined();
    expect(parseDataBlock({ content: [] })).toBeUndefined();
    expect(parseDataBlock(undefined)).toBeUndefined();
  });
});

// The data the real tool sends, not a hand-made copy of it: the test fails when the tool's data
// and the reducer drift apart.
describe('the data the server sends', () => {
  const PERF: RunScript = {
    createdBeforeS: 2,
    startsAtS: 5,
    loadS: 600,
    end: 'completed',
    live: () => ({ rps: 690, p95: 910, errorRate: 0.006 }),
    final: { rps: 690, p95: 1120, errorRate: 0.006 },
    series: [10, 20, 30],
  };

  it('process_get_status with format data and with operation both reduce into the running test', async () => {
    const clock = createTestClock(Date.parse('2026-11-22T11:00:00Z'));
    const r = await toolRig({
      tools: [processGetStatus, runStart, processWait],
      world: (fake) => {
        scriptRuns(fake, clock, PERF);
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerDataRoutes(fake);
        registerExecutionRoutes(fake);
        registerStatusRoutes(fake);
        registerAnalysisReadRoute(fake);
        seedSklep(fake.store, { stage: 'data' });
        planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
      },
      clock,
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const started = await settleClock(
      r,
      r.call('run_start', {
        scenario: 'checkout',
        environment: 'perf',
        profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
        max_wait_s: 1,
      }),
    );
    expect(started.isError).toBe(false);
    const fromTool = toolSignal(`${PREFIX}run_start`, answer(started.text));
    const afterRun = reduce(INITIAL_STATE, fromTool ?? { kind: 'tool', tool: '' }, NOW);
    expect(afterRun.operation?.handle).toBe(HANDLE);

    const status = await r.call('process_get_status', { format: 'data' });
    const data = parseDataBlock({ content: [{ type: 'text', text: status.text }] });
    const fromStatus = reduce(INITIAL_STATE, statusSignal(data), NOW);
    expect(fromStatus.project).toEqual({ name: 'sklep', id: SKLEP_IDS.project });
    expect(fromStatus.operation?.handle).toBe(HANDLE);
    expect(fromStatus.step).toBeGreaterThan(0);

    const snapshot = await r.call('process_get_status', { operation: HANDLE, format: 'data' });
    const parsed = parseDataBlock({ content: [{ type: 'text', text: snapshot.text }] });
    const fromSnapshot = reduce(INITIAL_STATE, { kind: 'operation', data: parsed }, NOW);
    expect(fromSnapshot.operation?.handle).toBe(HANDLE);
    expect(fromSnapshot.operation?.kind).toBe('test_run');
  });
});

describe('reduce: a state written by an older version of the mod', () => {
  const { ended: _ended, ...older } = INITIAL_STATE;
  const withoutEnded = older as unknown as ModState;
  const broken = [null, 'x', 5, {}, [1, 2], ['a', null]];

  it('a state without ended does not spoil the read: every kind of signal works', () => {
    const signals: Signal[] = [
      { kind: 'tool', tool: 'run_start', handle: HANDLE },
      statusSignal({ ...STATUS, operations: [{ handle: HANDLE, kind: 'test_run' }] }),
      { kind: 'operation', data: { operation: HANDLE, kind: 'test_run', elapsed_s: 5 } },
      {
        kind: 'operation',
        data: { operation: HANDLE, kind: 'test_run', phase: 'completed', elapsed_s: 5 },
      },
      { kind: 'lost', handle: HANDLE },
    ];
    for (const signal of signals) {
      expect(() => reduce(withoutEnded, signal, NOW)).not.toThrow();
    }
    const state = reduce(withoutEnded, { kind: 'lost', handle: HANDLE }, NOW);
    expect(state.ended).toEqual([HANDLE]);
  });

  it('a value of ended that is not a list of handles counts as empty', () => {
    for (const value of broken) {
      const odd = { ...INITIAL_STATE, ended: value } as unknown as ModState;
      const state = reduce(odd, { kind: 'lost', handle: HANDLE }, NOW);
      expect(state.ended).toEqual([HANDLE]);
    }
  });

  it('a call still puts the operation in progress, as for a new state', () => {
    const state = call(withoutEnded, 'run_start', `running ${HANDLE}`);
    expect(state.operation?.handle).toBe(HANDLE);
  });
});

describe('reduce: which operation of the status list is followed', () => {
  const stale = {
    handle: 'record_run:old-1',
    kind: 'record_run',
    startedAt: '2026-11-20T10:00:00.000Z',
  };
  const test = { handle: HANDLE, kind: 'test_run', startedAt: '2026-11-22T10:55:00.000Z' };
  const listed = (...operations: object[]): Signal => ({
    kind: 'status',
    data: { ...STATUS, operations },
  });
  const followed = (state: ModState, signal: Signal): string | undefined =>
    reduce(state, signal, NOW).operation?.handle;

  it('takes the first operation of the list when nothing says which one matters', () => {
    expect(followed(INITIAL_STATE, listed(stale, test))).toBe('record_run:old-1');
  });

  it('prefers a test run while a run_start call waits, over an older operation of another kind', () => {
    const signal = { ...listed(stale, test), prefer: 'test_run' } as Signal;
    expect(followed(INITIAL_STATE, signal)).toBe(HANDLE);
  });

  it('falls back to the first operation when there is none of the preferred kind', () => {
    const signal = { ...listed(stale), prefer: 'test_run' } as Signal;
    expect(followed(INITIAL_STATE, signal)).toBe('record_run:old-1');
  });

  it('keeps the operation it already follows while the list still has it', () => {
    const known = reduce(INITIAL_STATE, listed(test), NOW);
    expect(followed(known, listed(stale, test))).toBe(HANDLE);
  });

  it('never prefers an operation known to be over', () => {
    const over = { ...INITIAL_STATE, ended: [HANDLE] };
    const signal = { ...listed(stale, test), prefer: 'test_run' } as Signal;
    expect(followed(over, signal)).toBe('record_run:old-1');
  });
});

describe('reduce: the report of a test that passed (FIX-25)', () => {
  const PASSED = {
    ...STATUS,
    next: {
      step: 'results_get_report',
      hint: 'passed_no_diagnosis',
      subject: 'e-3f9a12c4',
      skipped: ['results_analyze_run'],
    },
  };
  const FAILED = {
    ...STATUS,
    next: { step: 'results_get_report', hint: 'no_analysis', subject: 'e-3f9a12c4' },
  };
  const REPORT = `report of ${HANDLE}`;

  it('the report read ticks step 7, and the diagnosis is skipped, not owed', () => {
    const asked = reduce(INITIAL_STATE, statusSignal(PASSED), NOW);
    expect(asked).toMatchObject({
      step: 7,
      done: [1, 2, 3, 4, 5, 6],
      skipped: [8],
    });
    const read = call(asked, 'results_get_report', REPORT, NOW + 1);
    expect(read).toMatchObject({
      step: 7,
      done: [1, 2, 3, 4, 5, 6, 7],
      skipped: [8],
    });
  });

  it('the status read after the report does not take the tick back', () => {
    const read = call(
      reduce(INITIAL_STATE, statusSignal(PASSED), NOW),
      'results_get_report',
      REPORT,
      NOW + 1,
    );
    const again = reduce(read, statusSignal(PASSED), NOW + 2);
    expect(again.done).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(again.skipped).toEqual([8]);
    const failed = reduce(
      call(INITIAL_STATE, 'results_get_report', REPORT),
      statusSignal(FAILED),
      NOW + 2,
    );
    expect(failed.done).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a test that failed leaves the diagnosis open', () => {
    const state = reduce(INITIAL_STATE, statusSignal(FAILED), NOW);
    expect(state.skipped).toEqual([]);
    expect(call(state, 'results_get_report', REPORT, NOW + 1)).toMatchObject({
      step: 7,
      done: [1, 2, 3, 4, 5, 6, 7],
      skipped: [],
    });
  });

  it('the diagnosis the user asked for is not skipped any more', () => {
    const read = call(
      reduce(INITIAL_STATE, statusSignal(PASSED), NOW),
      'results_get_report',
      REPORT,
      NOW + 1,
    );
    const asked = call(read, 'results_analyze_run', 'diagnosis', NOW + 2);
    expect(asked).toMatchObject({ step: 8, skipped: [] });
  });

  it('a new test takes steps 7 and 8 back, and a status from before it cannot restore them', () => {
    const read = call(
      reduce(INITIAL_STATE, statusSignal(PASSED), NOW),
      'results_get_report',
      REPORT,
      NOW + 1,
    );
    const rerun = call(read, 'run_start', 'test finished', NOW + 2);
    expect(rerun).toMatchObject({
      step: 6,
      done: [1, 2, 3, 4, 5],
      skipped: [],
    });
    const waiting = reduce(
      read,
      statusSignal({ ...STATUS, next: { step: 'run_start', hint: 'no_runs' } }),
      NOW + 3,
    );
    expect(waiting).toMatchObject({
      step: 6,
      done: [1, 2, 3, 4, 5],
      skipped: [],
    });
  });

  it('a state written before the field existed counts as nothing skipped', () => {
    const { skipped: _skipped, ...old } = reduce(INITIAL_STATE, statusSignal(FAILED), NOW);
    const next = reduce(old as ModState, statusSignal(PASSED), NOW + 1);
    expect(next.skipped).toEqual([8]);
    expect(call(old as ModState, 'results_get_report', REPORT, NOW + 1).skipped).toEqual([]);
  });
});
