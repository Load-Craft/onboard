// `project_save_env`: the environment `project_create` created together with the project gets its
// protection and limits, a field the input does not know is an error, and what cannot be applied is
// a named error.
import { describe, expect, it } from 'vitest';

import { projectCreate } from '../src/tools/projectCreate.js';
import { projectSaveEnv } from '../src/tools/projectSaveEnv.js';
import { runStart } from '../src/tools/runStart.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import {
  registerExecutionRoutes,
  scriptRuns,
  startedRuns,
  type RunScript,
} from './fake-backend/routes/executions.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { SETUP_TOOLS, setUpProject } from './helpers/projectSetup.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';
import { SKLEP_IDS } from './golden/index.js';

interface StoredEnvironment {
  id: string;
  project_id: string;
  name: string;
  is_default: boolean;
  protected: boolean;
  workload_caps: Record<string, unknown> | null;
}

interface EnvironmentView {
  readonly name: string;
  readonly protected: boolean;
  readonly created: boolean;
  readonly caps?: { readonly maxVu?: number; readonly maxRps?: number };
  readonly differs?: readonly unknown[];
}

const world = (fake: Fake): void => {
  registerLookupRoutes(fake);
  registerProjectRoutes(fake);
  registerSetupRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  seedSklep(fake.store, { stage: 'empty' });
};

const rig = (): Promise<ToolRig> =>
  toolRig({ tools: [projectCreate, projectSaveEnv], world, env: { LOADCRAFT_LOCALE: 'en' } });

const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call, { limitMs: 120_000 });

interface Environment {
  readonly name: string;
  readonly api: string;
  readonly default?: boolean;
  readonly [field: string]: unknown;
}

/**
 * `project_create` with the default environment, then `project_save_env` with every environment;
 * the result of `project_save_env` (or the failed `project_create`).
 */
async function setUp(
  r: ToolRig,
  args: { name: string; description?: string; environments: readonly Environment[] },
): Promise<RigCallResult> {
  const first = args.environments.find((item) => item.default === true) ?? args.environments[0];
  if (first === undefined) throw new Error('no environment');
  const created = await settle(
    r,
    r.call('project_create', {
      name: args.name,
      ...(args.description === undefined ? {} : { description: args.description }),
      environment: { name: first.name, api: first.api },
    }),
  );
  if (created.isError) return created;
  return settle(r, r.call('project_save_env', { environments: args.environments }));
}

/** The call of the review: the default environment carries the limit. */
const QA_DEFAULT = {
  name: 'sklep',
  description: 'Sklep API',
  environments: [
    { name: 'qa', api: 'api.qa.example.com', default: true, limit: [100, 20] },
    { name: 'perf', api: 'api.perf.example.com' },
  ],
};

const stored = (r: ToolRig): StoredEnvironment[] =>
  r.fake.store.collection<StoredEnvironment>(SKLEP_COLLECTIONS.environments).list();

const viewOf = (result: RigCallResult, name: string): EnvironmentView => {
  const data = (result.outcome as { data: { environments: EnvironmentView[] } }).data;
  const found = data.environments.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no environment ${name}`);
  return found;
};

describe('project_save_env: environment created together with the project', () => {
  it('is protected with its limits on the backend, not only in the result', async () => {
    const r = await rig();
    const result = await setUp(r, QA_DEFAULT);
    expect(result.isError).toBe(false);

    const qa = stored(r).find((item) => item.name === 'qa');
    expect(qa?.protected).toBe(true);
    expect(qa?.workload_caps).toEqual({ max_vu: 100, max_rps: 20 });
    const view = viewOf(result, 'qa');
    expect(view.protected).toBe(true);
    expect(view.caps).toEqual({ maxVu: 100, maxRps: 20 });
    // created by project_create together with the project, protected by this call
    expect(view.created).toBe(false);
    expect(result.text).toContain('qa: protection set (100 users / 20 requests/s)');
    // A difference nobody could act on is not reported: the state was brought to the request.
    expect(view.differs).toBeUndefined();
    expect(result.text).not.toContain('unchanged');
    // The other environment was created in one request, with its limits (none here).
    expect(viewOf(result, 'perf').protected).toBe(false);
    r.assertClean();
  });

  it('sets only the protection and the limits, and only for the environment it just created', async () => {
    const r = await rig();
    await setUp(r, QA_DEFAULT);
    const puts = r.fake.calls.filter((call) => call.method === 'PUT');
    expect(puts.map((call) => call.body)).toEqual([
      { protected: true, workload_caps: { max_vu: 100, max_rps: 20 } },
    ]);
  });

  it('does not touch the environment of a repeated call', async () => {
    const r = await rig();
    await setUp(r, QA_DEFAULT);
    const before = r.fake.calls.length;
    const again = await setUp(r, QA_DEFAULT);
    expect(again.isError).toBe(false);
    expect(r.fake.calls.slice(before).filter((call) => call.method === 'PUT')).toEqual([]);
    expect(viewOf(again, 'qa').differs).toBeUndefined();
  });

  it('does not probe conformance of a protected default environment, the whole setup through', async () => {
    const r = await toolRig({ tools: SETUP_TOOLS, world, env: { LOADCRAFT_LOCALE: 'en' } });
    const calls = await setUpProject(r, QA_DEFAULT);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    expect(r.fake.calls.filter((call) => call.path.endsWith('/conformance'))).toEqual([]);
  });

  it('ends with a named error when the backend does not keep the protection', async () => {
    const r = await rig();
    const unprotected = {
      id: SKLEP_WORLD_IDS.environments.qa,
      project_id: SKLEP_IDS.project,
      name: 'qa',
      description: null,
      base_url: 'https://api.qa.example.com',
      frontend_url: null,
      proxy_url: null,
      default_headers: {},
      auth_type: 'none',
      auth_config: {},
      variables: {},
      is_active: true,
      is_default: true,
      protected: false,
      workload_caps: null,
      parent_environment_id: null,
      last_probe: null,
      last_conformance: null,
    };
    r.fake.faults.next('PUT', '/api/v1/projects/{project_id}/environments/{environment_id}', {
      status: 200,
      body: unprotected,
    });
    const result = await setUp(r, QA_DEFAULT);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_environment_not_protected');
    expect(result.text).toContain('qa');
  });
});

describe('project_save_env: strict input', () => {
  it('refuses protected: true with a hint to use limit, and creates nothing', async () => {
    const r = await rig();
    const result = await settle(
      r,
      r.call('project_save_env', {
        environments: [
          { name: 'perf', api: 'api.perf.example.com', default: true },
          { name: 'prod', api: 'api.example.com', protected: true, limits: [20, 5] },
        ],
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('protected');
    expect(result.text).toContain('limits');
    expect(result.text).toContain('use limit');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(stored(r)).toEqual([]);
  });

  it('refuses an unknown field of the call itself', async () => {
    const r = await rig();
    const result = await settle(
      r,
      r.call('project_save_env', {
        environment: [{ name: 'perf', api: 'api.perf.example.com' }],
        environments: [{ name: 'perf', api: 'api.perf.example.com' }],
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('"environment"');
    expect(result.text).toContain('send only environments and env_file');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });
});

const PUT = '/api/v1/projects/{project_id}/environments/{environment_id}';
const NOW = Date.parse('2026-11-22T11:00:00Z');
const INSTANT: RunScript = {
  startsAtS: 0,
  loadS: 0,
  end: 'completed',
  live: () => ({ rps: 0, p95: 0, errorRate: 0 }),
  final: { rps: 690, p95: 1120, errorRate: 0.006 },
  series: [10, 20, 30],
};
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

/** The project tools and run_start over the sklep world; `recreate`: the project does not exist yet. */
async function fullRig(
  recreate: boolean,
  setup: (fake: Fake) => void = () => undefined,
): Promise<ToolRig> {
  const clock = createTestClock(NOW);
  return toolRig({
    tools: [projectCreate, projectSaveEnv, runStart],
    clock,
    env: { LOADCRAFT_LOCALE: 'en' },
    world: (fake) => {
      scriptRuns(fake, clock, INSTANT);
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerSetupRoutes(fake);
      registerOpenapiReadRoute(fake);
      registerApiMapRoute(fake);
      registerConformanceRoute(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      seedSklep(fake.store, { stage: 'data' });
      if (recreate) {
        // The project is gone, so project_create creates it together with its first environment.
        const environments = fake.store.collection<StoredEnvironment>(
          SKLEP_COLLECTIONS.environments,
        );
        for (const item of environments.list()) environments.delete(item.id);
        fake.store.collection(SKLEP_COLLECTIONS.projects).delete(SKLEP_IDS.project);
      }
      setup(fake);
    },
  });
}

const QA = SKLEP_WORLD_IDS.environments.qa;
const unprotectQa = (fake: Fake): void => {
  fake.store
    .collection(SKLEP_COLLECTIONS.environments)
    .update(QA, { protected: false, workload_caps: null });
};
const setQa =
  (caps: Record<string, unknown>) =>
  (fake: Fake): void => {
    fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .update(QA, { protected: true, workload_caps: caps });
  };

const initQa = (r: ToolRig, qa: Record<string, unknown>): Promise<RigCallResult> =>
  setUp(r, {
    name: 'sklep',
    description: 'Sklep API',
    environments: [
      { name: 'perf', api: 'api.perf.example.com', default: qa['default'] !== true },
      { name: 'qa', api: 'api.qa.example.com', ...qa },
    ],
  });

const qaStored = (r: ToolRig): StoredEnvironment | undefined =>
  stored(r).find((item) => item.name === 'qa');

/** run_start on qa without confirm_capped: asks for consent, starts nothing. */
async function expectConsentOnQa(r: ToolRig): Promise<void> {
  const result = await r.call('run_start', {
    scenario: 'checkout',
    environment: 'qa',
    profile: RAMP_2000,
  });
  expect(result.isError).toBe(false);
  expect((result.outcome as { data: { needsConfirmation?: boolean } }).data.needsConfirmation).toBe(
    true,
  );
  expect(result.text).toContain('confirm_capped: true');
  expect(startedRuns(r.fake)).toHaveLength(0);
  r.assertClean();
}

/** The scenarios of the world belong to the project created by project_create. */
function moveWorldToProject(r: ToolRig, projectId: string): void {
  for (const name of [
    SKLEP_COLLECTIONS.flows,
    SKLEP_COLLECTIONS.scenarios,
    SKLEP_COLLECTIONS.compositions,
  ]) {
    const collection = r.fake.store.collection<{ id: string; project_id?: string }>(name);
    for (const item of collection.list((entry) => entry.project_id === SKLEP_IDS.project)) {
      collection.update(item.id, { project_id: projectId });
    }
  }
}

describe('project_save_env: protection after a failed write and on existing environments', () => {
  it('a failed PUT is the named error; the repeated call sets the protection; run_start asks for consent', async () => {
    const r = await fullRig(true);
    r.fake.faults.next('PUT', PUT, { status: 500, body: { detail: 'boom' } });
    const failed = await initQa(r, { default: true, limit: [100, 20] });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('init_project_environment_not_protected');
    expect(failed.text).toContain('qa');
    expect(failed.text).not.toContain('server_error');
    expect(qaStored(r)?.protected).toBe(false);

    const again = await initQa(r, { default: true, limit: [100, 20] });
    expect(again.isError).toBe(false);
    expect(r.fake.calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
    expect(qaStored(r)).toMatchObject({
      protected: true,
      workload_caps: { max_vu: 100, max_rps: 20 },
    });
    expect(again.text).toContain('qa: protection set (100 users / 20 requests/s)');
    expect(viewOf(again, 'qa').protected).toBe(true);

    const projectId = r.fake.store
      .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
      .list()
      .find((item) => item.name === 'sklep')?.id;
    if (projectId === undefined) throw new Error('no project sklep');
    moveWorldToProject(r, projectId);
    await expectConsentOnQa(r);
  });

  it('tightens an existing unprotected environment to the requested limit', async () => {
    const r = await fullRig(false, unprotectQa);
    const result = await initQa(r, { limit: [100, 20] });
    expect(result.isError).toBe(false);
    expect(r.fake.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
      { protected: true, workload_caps: { max_vu: 100, max_rps: 20 } },
    ]);
    expect(result.text).toContain('qa: protection set (100 users / 20 requests/s)');
    expect(viewOf(result, 'qa').created).toBe(false);
    await expectConsentOnQa(r);
  });

  it('tightens an existing looser limit, each limit to the lower of the two', async () => {
    const r = await fullRig(false, setQa({ max_vu: 100, max_rps: 20 }));
    const result = await initQa(r, { limit: [200, 10] });
    expect(result.isError).toBe(false);
    expect(qaStored(r)?.workload_caps).toEqual({ max_vu: 100, max_rps: 10 });
    expect(result.text).toContain('qa: protection set (100 users / 10 requests/s)');
    // Only the part of the request that was looser is named as not applied.
    expect(result.text.replace(/\s+/g, ' ')).toContain(
      'The looser part of the request (max_vu 200) was not applied',
    );
    expect(result.text).not.toContain('max_rps 10');
    await expectConsentOnQa(r);
  });

  it('does not read the stored limits of an unprotected environment', async () => {
    const r = await fullRig(false, (fake) =>
      fake.store
        .collection(SKLEP_COLLECTIONS.environments)
        .update(QA, { protected: false, workload_caps: { max_vu: 10, max_rps: 5 } }),
    );
    const result = await initQa(r, { limit: [50, 20] });
    expect(result.isError).toBe(false);
    expect(qaStored(r)).toMatchObject({
      protected: true,
      workload_caps: { max_vu: 50, max_rps: 20 },
    });
    expect(result.text).toContain('qa: protection set (50 users / 20 requests/s)');
  });

  it('a failed PUT on an existing environment is the named error too', async () => {
    const r = await fullRig(false, unprotectQa);
    r.fake.faults.next('PUT', PUT, { status: 500, body: { detail: 'boom' } });
    const result = await initQa(r, { limit: [100, 20] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_environment_not_protected');
    expect(qaStored(r)?.protected).toBe(false);
  });

  it('never loosens: a protected environment and a request without a limit stay as they are', async () => {
    const r = await fullRig(false);
    const result = await initQa(r, {});
    expect(result.isError).toBe(false);
    expect(r.fake.calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(qaStored(r)).toMatchObject({
      protected: true,
      workload_caps: { max_vu: 100, max_rps: 20 },
    });
    expect(result.text).toContain('warning: environment qa stays protected');
    expect(result.text.replace(/\s+/g, ' ')).toContain('nothing was loosened');
    expect(result.text).toContain('only in the LoadCraft interface');
    await expectConsentOnQa(r);
  });

  it('never loosens: a higher requested limit changes nothing and warns', async () => {
    const r = await fullRig(false);
    const result = await initQa(r, { limit: [500, 100] });
    expect(result.isError).toBe(false);
    expect(r.fake.calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(qaStored(r)?.workload_caps).toEqual({ max_vu: 100, max_rps: 20 });
    expect(result.text).toContain('warning: environment qa stays protected');
    await expectConsentOnQa(r);
  });
});
