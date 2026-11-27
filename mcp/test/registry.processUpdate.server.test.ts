// The channel of a tool's effect on the process, on the real server with the real tools against the
// fake backend: after the project setup the checks of the project are set, after a build the flow
// ids and the check of the flows (also when `process_wait` finishes the build), a change of a flow invalidates
// what depends on it, and the end of an operation (done, failed, cancelled, lost) is written to its
// row by the tool that ends it, with its log entry.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as z from 'zod';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '../src/http/generated/api.js';
import { createLogger } from '../src/log.js';
import { defineTool, type Tool } from '../src/registry.js';
import { flowsGenerateFromEndpoints } from '../src/tools/flowsGenerateFromEndpoints.js';
import { processCancel } from '../src/tools/processCancel.js';
import { runStart } from '../src/tools/runStart.js';
import { processWait } from '../src/tools/processWait.js';
import type { StateCache } from '../src/workspace/cache.js';
import { createProcessStore } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  planExecutionIds,
  registerExecutionRoutes,
  scriptRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowGenerationRoutes } from './fake-backend/routes/flowGeneration.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { planSetup, registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { SETUP_TOOLS, setUpProject } from './helpers/projectSetup.js';
import { BOUND, NOW, PERF, PERF_ARGS, untilEnd } from './helpers/runStartWait.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

type FlowDetail = components['schemas']['FlowDetail'];

const PROJECT: string = SKLEP_IDS.project;
const RUN_HANDLE = `test_run:${SKLEP_IDS.executionPerf}`;

interface Check {
  ok: boolean | null;
  by: string;
  note?: string;
}
interface Row {
  handle: string;
  kind: string;
  module: string;
  tool: string;
  status: string;
}
interface ProcessFile {
  rev: number;
  ids: { project_id?: string; docs_id?: string; flow_ids: string[] };
  steps: Record<string, { checks: Record<string, Check | undefined> }>;
  operations: Row[];
  problems: { code: string; ref?: { id: string } }[];
  log: { tool: string; status: string }[];
  reads: { tool: string; status: string }[];
}
interface StateFile {
  process: Record<string, ProcessFile>;
  opPayloads: Record<string, unknown>;
}

const stateOf = (r: ToolRig): StateFile =>
  JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as StateFile;

function processOf(r: ToolRig, key = PROJECT): ProcessFile {
  const found = stateOf(r).process[key];
  if (found === undefined) throw new Error(`no process under ${key}`);
  return found;
}

const checkOf = (p: ProcessFile, module: string, name: string): Check | undefined =>
  p.steps[module]?.checks[name];

interface Structured {
  readonly status: string;
  readonly operation?: string;
}
const structured = (result: RigCallResult): Structured => result.outcome as Structured;

/** The world of the project setup: an empty LoadCraft with the routes of the six tools. */
function setupWorld(fake: Fake): void {
  registerLookupRoutes(fake);
  registerProjectRoutes(fake);
  registerSetupRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  seedSklep(fake.store, { stage: 'empty' });
}

const OPENAPI = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Sklep API', version: '2.14.0' },
  paths: { '/items': { get: { operationId: 'listItems' } } },
});

const SETUP_ARGS = {
  name: 'sklep',
  openapi: 'loadcraft/openapi.json',
  environments: [{ name: 'perf', api: 'api.perf.example.com', default: true }],
};

const boundId = (r: ToolRig): string =>
  (
    JSON.parse(readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8')) as {
      project: { id: string };
    }
  ).project.id;

/** A tool under its catalog name that only stands for its call: the registry makes it a trigger. */
const stubTool = (name: string): Tool =>
  defineTool({
    name,
    title: name,
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: () => Promise.resolve({ status: 'done' as const, data: {} }),
    render: () => 'ok',
  });

describe('the project setup writes the project into the process', () => {
  it('each of the five tools sets its own checks of the project, stamped with its name', async () => {
    const r = await toolRig({
      tools: SETUP_TOOLS,
      world: setupWorld,
      files: { 'loadcraft/openapi.json': OPENAPI },
    });
    const calls = await setUpProject(r, SETUP_ARGS);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);

    const id = boundId(r);
    const p = processOf(r, id);
    expect(p.ids.project_id).toBe(id);
    const expected: readonly [string, string][] = [
      ['created', 'project_create'],
      ['env_saved', 'project_save_env'],
      // the connection test set it, the analysis (a change of the documentation) kept it, and the
      // apply set it last from the conformance probe of the documentation the analysis imported
      ['env_checked', 'project_apply_setup'],
      ['setup_analyzed', 'project_analyze_setup'],
      ['docs_imported', 'project_analyze_setup'],
      ['setup_applied', 'project_apply_setup'],
    ];
    for (const [name, by] of expected) {
      expect(checkOf(p, 'project', name), name).toMatchObject({ ok: true, by });
    }
    expect(checkOf(p, 'project', 'env_checked')?.note).toMatch(
      /^conformance of perf: \d+ documented GET operations answer, 0 missing$/u,
    );
    // the analysis saved the document as the project's documentation
    expect(p.ids.docs_id).toMatch(/^[0-9a-f-]{36}$/u);
    // one entry per call, each written with its effect
    expect(p.log.map((e) => e.tool)).toEqual([
      'project_create',
      'project_save_env',
      'project_check_env',
      'project_analyze_setup',
      'project_apply_setup',
    ]);
  });

  it('the analysis invalidates neither the connection test nor its own verdict', async () => {
    const r = await toolRig({ tools: SETUP_TOOLS, world: setupWorld });
    const calls = await setUpProject(r, {
      name: 'sklep',
      description: 'Sklep API',
      environments: SETUP_ARGS.environments,
    });
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    const p = processOf(r, boundId(r));
    // without documentation nothing probes conformance: the verdict is the connection test's
    expect(checkOf(p, 'project', 'env_checked')).toMatchObject({
      ok: true,
      by: 'project_check_env',
    });
    expect(checkOf(p, 'project', 'docs_imported')).toBeUndefined();
    expect(p.ids.docs_id).toBeUndefined();

    // a repeated analysis of the set-up project keeps both verdicts
    const again = await settleClock(
      r,
      r.call('project_analyze_setup', { description: 'Sklep API' }),
    );
    expect(again.isError, again.text).toBe(false);
    const after = processOf(r, boundId(r));
    expect(checkOf(after, 'project', 'env_checked')).toMatchObject({
      ok: true,
      by: 'project_check_env',
    });
    expect(checkOf(after, 'project', 'setup_analyzed')?.ok).toBe(true);
  });

  it('an analysis that ends in process_wait is stamped by process_wait, and apply takes its handle', async () => {
    const r = await toolRig({
      tools: SETUP_TOOLS,
      world: setupWorld,
      files: { 'loadcraft/openapi.json': OPENAPI },
    });
    const settle = (call: Promise<RigCallResult>): Promise<RigCallResult> =>
      settleClock(r, call, { limitMs: 120_000 });
    // longer than one call waits: the call returns the handle, process_wait finishes it
    planSetup(r.fake, { durationMs: 60_000 });
    const calls = await setUpProject(r, { ...SETUP_ARGS, max_wait_s: 3 });
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    const p = processOf(r, boundId(r));
    // the wait reads: its entry is in the ring of reads, its effect in the checks
    expect([...p.log, ...p.reads].map((e) => e.tool)).toContain('process_wait');
    expect(checkOf(p, 'project', 'setup_analyzed')).toMatchObject({ ok: true, by: 'process_wait' });
    expect(checkOf(p, 'project', 'setup_applied')).toMatchObject({
      ok: true,
      by: 'project_apply_setup',
    });
    const row = p.operations.find((item) => item.kind === 'setup_analysis');
    expect(row).toMatchObject({ tool: 'project_analyze_setup', status: 'done' });
    // a second apply with the same handle applies the same proposals again
    const again = await settle(r.call('project_apply_setup', { analysis: row?.handle ?? '' }));
    expect(again.isError, again.text).toBe(false);
  });

  it('applying the setup and importing the docs invalidate what depends on them', async () => {
    const r = await toolRig({
      tools: [...SETUP_TOOLS, stubTool('project_import_docs')],
      world: setupWorld,
      files: { 'loadcraft/openapi.json': OPENAPI },
    });
    const calls = await setUpProject(r, SETUP_ARGS);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    const id = boundId(r);
    const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
    const store = createProcessStore(r.workspace, { secrets, clock: { now: () => r.clock.now() } });
    await store.applyUpdate(
      id,
      { checks: { scenario: { self_check: { ok: true } }, run: { planned: { ok: true } } } },
      { tool: 'process_wait' },
    );

    await settleClock(r, r.call('project_apply_setup', {}), { limitMs: 120_000 });
    let p = processOf(r, id);
    for (const [module, name] of [
      ['scenario', 'self_check'],
      ['run', 'planned'],
    ] as const) {
      expect(checkOf(p, module, name), name).toMatchObject({
        ok: null,
        by: 'invalidated:project_apply_setup',
      });
    }
    // the apply sets its own check again after invalidating the others
    expect(checkOf(p, 'project', 'setup_applied')).toMatchObject({ by: 'project_apply_setup' });

    await r.call('project_import_docs', {});
    p = processOf(r, id);
    for (const name of ['env_checked', 'setup_analyzed']) {
      expect(checkOf(p, 'project', name), name).toMatchObject({
        ok: null,
        by: 'invalidated:project_import_docs',
      });
    }
    expect(checkOf(p, 'project', 'created')).toMatchObject({ ok: true, by: 'project_create' });
  });
});

// ---- flows ----------------------------------------------------------------------------------

/** A change of a flow under its catalog name: no tool of today changes a flow. */
const FLOWS_SAVE = defineTool({
  name: 'flows_save',
  title: 'Save a flow',
  description: 'stub',
  input: z.strictObject({}),
  annotations: {},
  run: () => Promise.resolve({ status: 'done' as const, data: {} }),
  render: () => 'ok',
});

function flowsRig(world: { failure?: string; cancelled?: boolean } = {}): Promise<ToolRig> {
  const clock = createTestClock(Date.parse('2026-11-22T09:00:00Z'));
  return toolRig({
    tools: [flowsGenerateFromEndpoints, processWait, FLOWS_SAVE],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerOpenapiReadRoute(fake);
      const url = new URL('./fixtures/flows/zakupy-run2-reczne.json', import.meta.url);
      const flow = {
        ...(JSON.parse(readFileSync(url, 'utf8')) as FlowDetail),
        id: SKLEP_IDS.flowZakupy,
      };
      registerFlowGenerationRoutes(fake, { flow, ...world }, clock);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock,
    files: BOUND,
  });
}

const MANUAL = {
  name: 'zakupy',
  description: 'Log in, search the shop, put an item in the cart and pay for it',
  endpoints: [
    'POST /auth/login',
    'GET /products',
    'POST /cart/items',
    'GET /cart',
    'POST /checkout',
  ],
};

async function seedScenario(r: ToolRig): Promise<void> {
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const store = createProcessStore(r.workspace, { secrets, clock: { now: () => r.clock.now() } });
  await store.applyUpdate(
    PROJECT,
    { checks: { scenario: { generated: { ok: true } }, data: { bindings_set: { ok: true } } } },
    { tool: 'process_wait' },
  );
}

describe('a build of flows writes the flows into the process', () => {
  it('the flow id and flows_built are set; a change of the flow invalidates what depends on it', async () => {
    const r = await flowsRig();
    const built = await settleClock(r, r.call(flowsGenerateFromEndpoints.name, MANUAL), {
      limitMs: 60_000,
    });
    expect(built.isError, built.text).toBe(false);
    const after = processOf(r);
    expect(after.ids.flow_ids).toEqual([SKLEP_IDS.flowZakupy]);
    expect(checkOf(after, 'flows', 'flows_built')).toMatchObject({
      ok: true,
      by: 'flows_generate_from_endpoints',
    });
    // the operation of the build ended with the call: its row says so
    expect(after.operations.map((o) => o.status)).toEqual(['done']);

    await seedScenario(r);
    await r.call('flows_save', {});
    const changed = processOf(r);
    expect(checkOf(changed, 'scenario', 'generated')).toMatchObject({
      ok: null,
      by: 'invalidated:flows_save',
    });
    expect(checkOf(changed, 'data', 'bindings_set')).toMatchObject({ ok: null });
    expect(checkOf(changed, 'flows', 'flows_built')).toMatchObject({ ok: true });
    expect(
      changed.problems.filter((x) => x.code === 'check_invalidated').map((x) => x.ref?.id),
    ).toEqual(expect.arrayContaining(['scenario.generated', 'data.bindings_set']));
  });

  it('a build that wait finishes writes the same: the flow id, flows_built and the end of its row', async () => {
    const r = await flowsRig();
    const call = r.call(flowsGenerateFromEndpoints.name, { ...MANUAL, max_wait_s: 2 });
    await r.clock.advance(3000);
    const first = await settleClock(r, call, { limitMs: 60_000 });
    expect(structured(first).status).toBe('running');
    const handle = structured(first).operation ?? '';
    expect(processOf(r).operations).toEqual([
      expect.objectContaining({ handle, status: 'running', tool: flowsGenerateFromEndpoints.name }),
    ]);

    let result = first;
    for (let again = 0; again < 10 && structured(result).status === 'running'; again += 1) {
      result = await settleClock(r, r.call('process_wait', { operation: handle }), {
        limitMs: 60_000,
      });
    }
    expect(structured(result).status).toBe('done');
    const p = processOf(r);
    expect(p.ids.flow_ids).toEqual([SKLEP_IDS.flowZakupy]);
    expect(checkOf(p, 'flows', 'flows_built')).toMatchObject({ ok: true, by: 'process_wait' });
    // the row keeps the tool that started the operation
    expect(p.operations).toEqual([
      expect.objectContaining({
        handle,
        status: 'done',
        tool: flowsGenerateFromEndpoints.name,
        module: 'flows',
      }),
    ]);
  });
});

describe('the end of an operation of another kind than a test run', () => {
  it('a build the model failed: the call is an error and the row of flow_generation says failed', async () => {
    const r = await flowsRig({ failure: 'The model could not chain the calls' });
    const result = await settleClock(r, r.call(flowsGenerateFromEndpoints.name, MANUAL), {
      limitMs: 60_000,
    });
    expect(result.isError).toBe(true);
    const p = processOf(r);
    expect(p.operations).toEqual([
      expect.objectContaining({
        kind: 'flow_generation',
        status: 'failed',
        tool: flowsGenerateFromEndpoints.name,
      }),
    ]);
    expect(Object.keys(stateOf(r).opPayloads)).toEqual([]);
    expect(checkOf(p, 'flows', 'flows_built')).toBeUndefined();
  });

  it('a build stopped in the app: the row says cancelled', async () => {
    const r = await flowsRig({ cancelled: true });
    const result = await settleClock(r, r.call(flowsGenerateFromEndpoints.name, MANUAL), {
      limitMs: 60_000,
    });
    expect(result.isError).toBe(true);
    expect(processOf(r).operations).toEqual([
      expect.objectContaining({ kind: 'flow_generation', status: 'cancelled' }),
    ]);
  });
});

// ---- the end of an operation ----------------------------------------------------------------

/** What a call did to the row of `handle` with each write of its own: removed it, or left it out. */
interface Watch {
  readonly handle: string;
  /** Deletes of the cache entry of the handle (each one removes the row). */
  deletes: number;
  /** Writes after which the process had no row for the handle, once it had one. */
  missing: number;
  /** The row was in the file after a write of a watched call. */
  seen?: boolean;
}

/** The tool with every write of its state checked for the row of `watch.handle`. */
function watched(tool: Tool, watch: Watch): Tool {
  return {
    ...tool,
    invoke(ctx, args) {
      const check = (): void => {
        const rows = ctx.state.process()?.operations ?? [];
        const there = rows.some((row) => row.handle === watch.handle);
        if (there) watch.seen = true;
        else if (watch.seen === true) watch.missing += 1;
      };
      const state: StateCache = {
        ...ctx.state,
        set: async (section, key, value, how) => {
          await ctx.state.set(section, key, value, how);
          check();
        },
        delete: async (section, key, how) => {
          if (key === watch.handle) watch.deletes += 1;
          await ctx.state.delete(section, key, how);
          check();
        },
      };
      return tool.invoke({ ...ctx, state }, args);
    },
  };
}

function runRig(script: RunScript, watch?: Watch): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  const all = [runStart, processWait, processCancel];
  return toolRig({
    tools: watch === undefined ? all : all.map((tool) => watched(tool, watch)),
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      scriptRuns(fake, clock, script);
      planExecutionIds(fake, [SKLEP_IDS.executionPerf]);
    },
    clock,
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
}

const rowOf = (r: ToolRig): Row | undefined =>
  processOf(r).operations.find((o) => o.handle === RUN_HANDLE);

describe('the end of an operation is written by the tool that ends it', () => {
  it('a finished test: its row is done, written with the entry of the call that saw the end', async () => {
    const watch: Watch = { handle: RUN_HANDLE, deletes: 0, missing: 0 };
    const r = await runRig(PERF, watch);
    const { last, calls } = await untilEnd(r, PERF_ARGS);
    expect(last.isError, last.text).toBe(false);
    expect(calls.length).toBeGreaterThan(1);
    expect(rowOf(r)).toMatchObject({
      status: 'done',
      kind: 'test_run',
      module: 'run',
      tool: runStart.name,
    });
    // the payload went with the end of the operation
    expect(Object.keys(stateOf(r).opPayloads)).toEqual([]);
    // a wait that succeeded is a read: its entry goes to the ring of reads, in the same write as the row
    expect(processOf(r).reads.at(-1)).toMatchObject({ tool: 'process_wait', status: 'ok' });
    // the row never left the file: nothing removed it before the write of its end
    expect(watch).toMatchObject({ deletes: 0, missing: 0 });
  });

  it('a failed test: its row is failed, written with the error entry, and it invalidates nothing', async () => {
    const r = await runRig({ ...PERF, end: 'failed', endsAfterS: 30 });
    const { last } = await untilEnd(r, PERF_ARGS);
    expect(last.isError).toBe(true);
    expect(rowOf(r)).toMatchObject({ status: 'failed', tool: runStart.name });
    expect(processOf(r).log.at(-1)).toMatchObject({ status: 'error' });
  });

  it('a stopped test: cancel writes the row as cancelled, in one write with its entry', async () => {
    const watch: Watch = { handle: RUN_HANDLE, deletes: 0, missing: 0 };
    const r = await runRig(PERF, watch);
    const first = await settleClock(r, r.call(runStart.name, { ...PERF_ARGS, max_wait_s: 5 }));
    expect(structured(first).operation).toBe(RUN_HANDLE);
    expect(rowOf(r)).toMatchObject({ status: 'running' });
    const before = processOf(r).rev;

    const stopped = await r.call('process_cancel', { operation: RUN_HANDLE });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(rowOf(r)).toMatchObject({ status: 'cancelled', tool: runStart.name });
    expect(processOf(r).rev).toBe(before + 1);
    expect(watch).toMatchObject({ deletes: 0, missing: 0 });
    expect(Object.keys(stateOf(r).opPayloads)).toEqual([]);
  });

  it('a test the backend forgot: its row is lost, never removed on the way', async () => {
    const watch: Watch = { handle: RUN_HANDLE, deletes: 0, missing: 0 };
    const r = await runRig({ ...PERF, forgottenAfterS: 30 }, watch);
    const { last } = await untilEnd(r, PERF_ARGS);
    expect(last.isError).toBe(true);
    expect(rowOf(r)).toMatchObject({ status: 'lost' });
    expect(Object.keys(stateOf(r).opPayloads)).toEqual([]);
    expect(watch).toMatchObject({ deletes: 0, missing: 0 });
  });
});
