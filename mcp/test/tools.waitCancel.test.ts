// `process_wait` and `process_cancel`: every operation that returned a handle can be waited for or stopped by one
// tool each, also in a new call (the workspace cache keeps the entry). The registry of kinds is
// checked against the source: a kind defined anywhere in `src` but missing from the registry (or
// from the cases below) fails here, so a new kind cannot be forgotten.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { OPERATION_KINDS, type OperationKindName } from '../src/ops/operation.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { renderCancel, type CancelData } from '../src/render/views/cancel.js';
import { processCancel } from '../src/tools/processCancel.js';
import { ALL_OPERATION_KINDS } from '../src/tools/operationKinds.js';
import { runStart } from '../src/tools/runStart.js';
import { flowsSuggestJourneys } from '../src/tools/flowsSuggestJourneys.js';
import { scenarioGenerate } from '../src/tools/scenarioGenerate.js';
import { processWait } from '../src/tools/processWait.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerCompositionRoutes } from './fake-backend/routes/compositions.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerScenarioBuilderRoutes } from './fake-backend/routes/scenarioBuilder.js';
import {
  registerScenarioRoutes,
  type ScenarioGenerationFake,
} from './fake-backend/routes/scenarios.js';
import { registerSelfCheckRoutes } from './fake-backend/routes/selfCheck.js';
import {
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
  type SuggestionHandles,
  type SuggestionWorld,
} from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { waitFor } from './helpers/async.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const IDS = SKLEP_WORLD_IDS;
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;
const PERF_ARGS = { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 };
const UNKNOWN_ID = '0b5c77aa-1d2e-4f30-8a41-5b6c7d8e9f00';

interface Structured {
  readonly status: string;
  readonly operation?: string;
  readonly data: unknown;
}
const structured = (result: RigCallResult): Structured => result.outcome as Structured;

const stateOperations = (r: ToolRig): string[] => {
  try {
    const text = readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
    return Object.keys(
      (JSON.parse(text) as { opPayloads?: Record<string, unknown> }).opPayloads ?? {},
    );
  } catch {
    return [];
  }
};

/** The status of the row of `handle` in any process of the state file. */
const rowStatus = (r: ToolRig, handle: string): string | undefined => {
  const text = readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
  const parsed = JSON.parse(text) as {
    process: Record<string, { operations: { handle: string; status: string }[] }>;
  };
  return Object.values(parsed.process)
    .flatMap((p) => p.operations)
    .find((row) => row.handle === handle)?.status;
};

const callsMatching = (r: ToolRig, pattern: RegExp) =>
  r.fake.calls.filter((call) => call.method === 'POST' && pattern.test(call.path));

// ---- the registry ----------------------------------------------------------------------------

/** Kinds that `process_cancel` can stop: each has a case below; adding a kind forces a decision here. */
const CANCELLABLE: Readonly<Record<OperationKindName, boolean>> = {
  setup_analysis: false,
  refine: true,
  batch_generation: false,
  flow_generation: false,
  // har_*: the cases are in tools.buildFlows.har.test.ts, next to the fake of the HAR channel.
  har_generation: true,
  har_split: true,
  scenario_generation: true,
  self_check: false,
  // record_run: the cases (a gentle stop on the channel, REST without it) are in tools.recordFlows.test.ts.
  record_run: true,
  test_run: true,
  analysis: false,
  // account_provision: the cases are in tools.provisionAccounts.test.ts (the series runs in the process).
  account_provision: true,
};
/** Kinds in `OPERATION_KINDS` that no tool defines yet: `process_wait` answers them "unsupported". */
const NOT_DEFINED_YET: readonly OperationKindName[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('registry of operation kinds', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url));

  it('holds every kind that the source defines, once', () => {
    const defined = sourceFiles(srcDir)
      .filter((file) => !file.endsWith(join('ops', 'operation.ts')))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return [...text.matchAll(/defineOperationKind[<(]/gu)].map(() => file);
      });
    expect(ALL_OPERATION_KINDS).toHaveLength(defined.length);
    const names = ALL_OPERATION_KINDS.map((kind) => kind.kind);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every kind a handle can name, except those that are not defined yet', () => {
    const names = ALL_OPERATION_KINDS.map((kind) => kind.kind);
    const missing = OPERATION_KINDS.filter(
      (kind) => !names.includes(kind) && !NOT_DEFINED_YET.includes(kind),
    );
    expect(missing).toEqual([]);
    for (const kind of NOT_DEFINED_YET) expect(names).not.toContain(kind);
  });

  it('has a test of wait for every kind: a file that waits with a handle of that kind', () => {
    const WAIT_TESTS: Record<string, string> = {
      account_provision: 'tools.provisionAccounts.test.ts',
      analysis: 'tools.getDiagnosis.test.ts',
      batch_generation: 'tools.flowsGenerateFromSuggestions.test.ts',
      flow_generation: 'tools.flowsGenerateFromEndpoints.test.ts',
      har_generation: 'tools.flowsGenerateFromHar.test.ts',
      har_split: 'tools.flowsGenerateFromHar.test.ts',
      record_run: 'tools.describeFlows.test.ts',
      refine: 'tools.waitCancel.test.ts',
      scenario_generation: 'tools.scenarioGenerate.test.ts',
      self_check: 'tools.selfCheck.test.ts',
      setup_analysis: 'tools.projectAnalyzeSetup.test.ts',
      test_run: 'tools.waitCancel.test.ts',
    };
    for (const kind of ALL_OPERATION_KINDS) {
      const file = WAIT_TESTS[kind.kind];
      expect(file, `no wait test named for ${kind.kind}`).toBeDefined();
      const text = readFileSync(fileURLToPath(new URL(`./${file ?? ''}`, import.meta.url)), 'utf8');
      expect(text, `${file ?? ''} does not call process_wait`).toMatch(/call\('process_wait'/u);
      expect(text, `${file ?? ''} does not name ${kind.kind}`).toContain(kind.kind);
    }
  });

  it('can cancel exactly the kinds with a case here', () => {
    for (const kind of ALL_OPERATION_KINDS) {
      expect(kind.cancel !== undefined, kind.kind).toBe(CANCELLABLE[kind.kind]);
    }
  });
});

// ---- test_run --------------------------------------------------------------------------------

const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: (elapsed) => ({ rps: elapsed * 1.7, p95: 500, errorRate: 0.006 }),
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: Array<number>(60).fill(500),
};

async function runRig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [runStart, processWait, processCancel],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, PERF);
      planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

const CANCEL_RUN = new RegExp(`/gatling/executions/${SKLEP_IDS.executionPerf}/cancel$`, 'u');

async function startRun(r: ToolRig): Promise<string> {
  const first = await settleClock(r, r.call('run_start', { ...PERF_ARGS, max_wait_s: 5 }));
  expect(first.isError, first.text).toBe(false);
  const handle = structured(first).operation ?? '';
  expect(handle).toBe(`test_run:${SKLEP_IDS.executionPerf}`);
  return handle;
}

describe('cancel: test_run', () => {
  it('stops the test with POST …/cancel, says so, and drops the operation from the state', async () => {
    const r = await runRig();
    const handle = await startRun(r);
    expect(stateOperations(r)).toEqual([handle]);

    const result = await r.call('process_cancel', { operation: handle });
    expect(result.isError, result.text).toBe(false);
    expect(callsMatching(r, CANCEL_RUN)).toHaveLength(1);
    expect(structured(result).data).toMatchObject({ cancelled: true, note: 'stopped' });
    expect(result.text).toContain(handle);
    expect(result.text).toContain('Stopped');
    expect(stateOperations(r)).toEqual([]);

    // The entry is gone: waiting for the handle says the workspace does not know it.
    const again = await r.call('process_wait', { operation: handle });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('process_get_status');
    r.assertClean();
  });

  it('says the same in Polish', async () => {
    const r = await runRig('pl');
    const handle = await startRun(r);
    const result = await r.call('process_cancel', { operation: handle });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Zatrzymano');
  });

  it('a test that already ended is not cancelled and is no error; wait still shows how it ended', async () => {
    const r = await runRig();
    const handle = await startRun(r);
    await r.clock.advance(700_000);
    const result = await r.call('process_cancel', { operation: handle });
    expect(result.isError, result.text).toBe(false);
    expect(callsMatching(r, CANCEL_RUN)).toHaveLength(1);
    expect(structured(result).data).toMatchObject({ cancelled: false, note: 'not_running' });
    expect(result.text).toContain('not running');
    expect(result.text).toContain(`process_wait`);
    // Nothing was stopped, so the entry stays and `process_wait` finishes the operation.
    expect(stateOperations(r)).toEqual([handle]);
    const done = await settleClock(r, r.call('process_wait', { operation: handle }));
    expect(done.isError, done.text).toBe(false);
    expect(structured(done).status).toBe('done');
    expect(stateOperations(r)).toEqual([]);
  });

  it('never cancels when a wait is aborted (Esc ends the wait only)', async () => {
    const r = await runRig();
    const handle = await startRun(r);
    const abort = new AbortController();
    const call = r.call('process_wait', { operation: handle }, { signal: abort.signal });
    await new Promise<void>((done) => setTimeout(done, 50));
    abort.abort();
    await call.catch(() => undefined);
    expect(callsMatching(r, CANCEL_RUN)).toHaveLength(0);
    expect(stateOperations(r)).toEqual([handle]);
  });
});

describe('wait: test_run in a new call', () => {
  it('finishes a handle from an earlier call with the view of run_start', async () => {
    const r = await runRig();
    const handle = await startRun(r);
    const done = await settleClock(r, r.call('process_wait', { operation: handle }));
    let result = done;
    for (let again = 0; again < 12 && structured(result).status === 'running'; again += 1) {
      result = await settleClock(r, r.call('process_wait', { operation: handle }));
    }
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).status).toBe('done');
    expect(result.text).toContain('test finished');
    expect(stateOperations(r)).toEqual([]);
  });

  it('one call waits at most 100 s, then answers running with the handle in the text', async () => {
    const r = await runRig();
    const handle = await startRun(r);
    const result = await settleClock(
      r,
      r.call('process_wait', { operation: handle, max_wait_s: 900 }),
    );
    expect(structured(result).status).toBe('running');
    expect(structured(result).operation).toBe(handle);
    expect(result.text).toContain(handle);
  });
});

// ---- the handle itself -----------------------------------------------------------------------

describe('wait and process_cancel: bad handles', () => {
  it.each([
    ['not a handle', 'nonsense', ['process_wait']],
    ['an unknown kind', `nothing:${UNKNOWN_ID}`, ['process_wait', 'process_cancel']],
  ])('%s is an invalid handle', async (_label, handle, tools) => {
    const r = await runRig();
    for (const tool of tools) {
      const result = await r.call(tool, { operation: handle });
      expect(result.isError, tool).toBe(true);
      expect(result.text, tool).toContain('not a valid operation handle');
    }
  });

  it('a handle with no entry in this workspace points to process_get_status for process_wait', async () => {
    const r = await runRig();
    const result = await r.call('process_wait', { operation: `test_run:${UNKNOWN_ID}` });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no record');
    expect(result.text).toContain('process_get_status');
  });

  it('cancel of a handle with no entry asks LoadCraft; a test it does not know is a named error', async () => {
    // tests.cancel.remote covers the cases in full; here only that nothing is sent.
    const r = await runRig();
    const result = await r.call('process_cancel', { operation: `test_run:${UNKNOWN_ID}` });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[cancel_target_unknown]');
    expect(callsMatching(r, /cancel$/u)).toHaveLength(0);
  });

  it('record_run, defined by flows_describe_journeys, is awaited like the others: no entry, no wait', async () => {
    const r = await runRig();
    const result = await r.call('process_wait', { operation: `record_run:${UNKNOWN_ID}` });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no record');
    expect(result.text).not.toContain('cannot be awaited');
  });

  it('cancel of a kind that cannot be stopped names the kinds that can', async () => {
    const r = await runRig();
    const result = await r.call('process_cancel', { operation: `flow_generation:${UNKNOWN_ID}` });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('cannot be stopped');
    expect(result.text).toContain('refine, scenario_generation, test_run');
    expect(callsMatching(r, /cancel$/u)).toHaveLength(0);
  });

  it('exposes process_wait as read-only and process_cancel as destructive', () => {
    expect(processWait.annotations.readOnlyHint).toBe(true);
    expect(processCancel.annotations.destructiveHint).toBe(true);
  });
});

// ---- refine ----------------------------------------------------------------------------------

interface RefineRig {
  readonly r: ToolRig;
  readonly handles: SuggestionHandles;
}

async function refineRig(world: SuggestionWorld = SKLEP_SUGGESTIONS): Promise<RefineRig> {
  let handles: SuggestionHandles | undefined;
  const r = await toolRig({
    tools: [flowsSuggestJourneys, processWait, processCancel],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      handles = registerSuggestionRoutes(fake, world);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
  if (handles === undefined) throw new Error('no suggestion routes');
  return { r, handles };
}

/** Starts the refinement, lets the wait end first, and returns its handle. */
async function startRefine(rg: RefineRig): Promise<string> {
  const call = rg.r.call('flows_suggest_journeys', { max_wait_s: 10 });
  await waitFor(() => rg.handles.jobs.length === 1, 'the refine job to start');
  const stub = rg.r.fake.channel('refine', { job_id: rg.handles.jobs[0] ?? '' });
  await waitFor(() => stub.connections === 1, 'the channel to open');
  await rg.r.clock.advance(11_000);
  const first = await call;
  const handle = structured(first).operation ?? '';
  expect(handle).toBe(`refine:${rg.handles.jobs[0] ?? ''}`);
  return handle;
}

const refinePosts = (r: ToolRig) =>
  r.fake.calls.filter(
    (call) => call.method === 'POST' && call.path.endsWith('/flow-suggestions/refine'),
  );

describe('refine through process_wait and process_cancel', () => {
  it('wait finishes the refinement with the text flows_suggest_journeys draws', async () => {
    const rg = await refineRig();
    const handle = await startRefine(rg);
    const result = await settleClock(rg.r, rg.r.call('process_wait', { operation: handle }));
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).status).toBe('done');
    expect(result.text).toContain('zakupy');

    const direct = await refineRig();
    const call = direct.r.call('flows_suggest_journeys', {});
    const same = await settleClock(direct.r, call);
    expect(result.text).toBe(same.text);
    expect(stateOperations(rg.r)).toEqual([]);
  });

  it('cancel stops the job with POST …/refine/{job}/cancel and drops the entry', async () => {
    const rg = await refineRig();
    const handle = await startRefine(rg);
    const result = await rg.r.call('process_cancel', { operation: handle });
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data).toMatchObject({ cancelled: true });
    const cancels = callsMatching(rg.r, /\/refine\/[^/]+\/cancel$/u);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.path).toContain(`/refine/${rg.handles.jobs[0] ?? ''}/cancel`);
    expect(cancels[0]?.query).toMatchObject({ reason: 'user' });
    expect(stateOperations(rg.r)).toEqual([]);
  });

  it('a job that LoadCraft forgot expires with a clear message; the job a repeated POST started is stopped', async () => {
    const rg = await refineRig({ ...SKLEP_SUGGESTIONS, forgetsJobs: true });
    const handle = await startRefine(rg);
    rg.r.fake.faults.restart();
    const result = await settleClock(rg.r, rg.r.call('process_wait', { operation: handle }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('expired');
    expect(result.text).toContain('flows_suggest_journeys again');
    expect(stateOperations(rg.r)).toEqual([]);
    // the job is gone: its row says lost, written with the error entry of the call
    expect(rowStatus(rg.r, handle)).toBe('lost');
    // Reading the cache needs one POST; the job it started by mistake is cancelled at once.
    expect(refinePosts(rg.r)).toHaveLength(2);
    const cancels = callsMatching(rg.r, /\/refine\/[^/]+\/cancel$/u);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.path).toContain(`/refine/${rg.handles.jobs[1] ?? '?'}/cancel`);
  });
});

describe('refine expiry: whose job is stopped', () => {
  it('a job of another session that the cache read joined is left alone: expired, entry gone, no cancel', async () => {
    const rg = await refineRig({ ...SKLEP_SUGGESTIONS, foreignJobId: 'foreign-job-1' });
    const handle = await startRefine(rg);
    rg.r.fake.faults.restart();
    const result = await settleClock(rg.r, rg.r.call('process_wait', { operation: handle }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('expired');
    expect(stateOperations(rg.r)).toEqual([]);
    expect(rowStatus(rg.r, handle)).toBe('lost');
    expect(refinePosts(rg.r)).toHaveLength(2);
    expect(callsMatching(rg.r, /\/cancel$/u)).toHaveLength(0);
  });

  it('an abort (Esc) while the stray job is being stopped does not abort the stop', async () => {
    const abort = new AbortController();
    const rg = await refineRig({
      ...SKLEP_SUGGESTIONS,
      forgetsJobs: true,
      onRefineCancel: async () => {
        abort.abort();
        await new Promise<void>((done) => setTimeout(done, 20));
      },
    });
    const handle = await startRefine(rg);
    rg.r.fake.faults.restart();
    const call = rg.r.call('process_wait', { operation: handle }, { signal: abort.signal });
    await settleClock(
      rg.r,
      call.then(
        () => undefined,
        () => undefined,
      ),
    );
    // The stop request finished although the call was aborted: the server logged its success.
    await waitFor(
      () =>
        rg.r
          .logRecords()
          .some((record) => record.msg === 'stopped a refinement started by mistake'),
      'the stop of the stray job to finish',
    );
    expect(stateOperations(rg.r)).toEqual([]);
  });
});

// ---- scenario generation ---------------------------------------------------------------------

describe('cancel: scenario_generation', () => {
  it('stops the generation with POST …/generate-async/{run}/cancel', async () => {
    let generation: ScenarioGenerationFake | undefined;
    const r = await toolRig({
      tools: [scenarioGenerate, processWait, processCancel],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerScenarioBuilderRoutes(fake);
        registerSelfCheckRoutes(fake);
        generation = registerScenarioRoutes(fake);
        registerCompositionRoutes(fake);
        seedSklep(fake.store, { stage: 'flows' });
      },
      clock: createTestClock(NOW),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: BOUND,
    });
    if (generation === undefined) throw new Error('no scenario routes');
    generation.script(IDS.flowPrzegladanie, { endAfterMs: 30_000 });
    const first = await settleClock(
      r,
      r.call('scenario_generate', {
        name: 'checkout',
        flows: ['przeglądanie', 'zakupy', 'konto'],
        proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
        data_mix: 'realistic',
        max_wait_s: 5,
      }),
    );
    const handle = structured(first).operation ?? '';
    expect(handle).toMatch(/^scenario_generation:/u);
    const result = await r.call('process_cancel', { operation: handle });
    expect(result.isError, result.text).toBe(false);
    expect(structured(result).data).toMatchObject({ cancelled: true });
    const runId = handle.split(':')[1] ?? '';
    const cancels = callsMatching(r, /\/generate-async\/[^/]+\/cancel$/u);
    expect(cancels.map((call) => call.path)).toHaveLength(1);
    expect(cancels[0]?.path).toContain(`/generate-async/${runId}/cancel`);
    expect(stateOperations(r)).toEqual([]);
  });
});

// ---- the view --------------------------------------------------------------------------------

describe('cancel view', () => {
  const tEn = createTranslator('en');
  const tPl = createTranslator('pl');
  const stopped: CancelData = { operation: 'test_run:abc', cancelled: true, note: 'stopped' };
  const idle: CancelData = { operation: 'test_run:abc', cancelled: false, note: 'not_running' };

  it('names the handle in both outcomes and both languages', () => {
    for (const data of [stopped, idle]) {
      for (const t of [tEn, tPl]) expect(renderCancel(data, t)).toContain('test_run:abc');
    }
    expect(renderCancel(idle, tEn)).toContain('process_wait');
  });
});
