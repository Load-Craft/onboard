// `project_save_env`: the environments of the bound project, created in the order of the request,
// with their limits and the default; an existing environment is compared and never loosened or
// moved to another address. The project comes from `project_create` first, as the skill calls them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectCheckEnv } from '../src/tools/projectCheckEnv.js';
import { projectCreate } from '../src/tools/projectCreate.js';
import { projectSaveEnv } from '../src/tools/projectSaveEnv.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS, SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

interface EnvironmentView {
  readonly name: string;
  readonly default: boolean;
  readonly protected: boolean;
  readonly created: boolean;
  readonly caps?: { readonly maxVu?: number; readonly maxRps?: number };
  readonly differs?: readonly { field: string; current: unknown; requested: unknown }[];
}

interface SaveView {
  readonly environments: readonly EnvironmentView[];
}

interface StoredEnvironment {
  id: string;
  project_id: string;
  name: string;
  base_url: string;
  frontend_url: string | null;
  is_default: boolean;
  protected: boolean;
  workload_caps: Record<string, unknown> | null;
}

interface Environment {
  readonly name: string;
  readonly api: string;
  readonly frontend?: string;
  readonly default?: boolean;
  readonly limit?: readonly number[];
}

interface Args {
  readonly name: string;
  readonly description?: string;
  readonly environments: readonly Environment[];
}

/** The call of the mock-up session (step 02), with the frontend addresses written out. */
const SKLEP_ARGS: Args = {
  name: 'sklep',
  description: 'Sklep API',
  environments: [
    { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
    { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
    { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
    { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
  ],
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function world(stage: 'empty' | 'project') {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    seedSklep(fake.store, { stage });
  };
}

async function rig(stage: 'empty' | 'project', locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  return toolRig({
    tools: [projectCreate, projectSaveEnv, projectCheckEnv],
    world: world(stage),
    env: { LOADCRAFT_LOCALE: locale },
  });
}

const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call, { limitMs: 120_000 });

/** `project_create` with the default environment (the marked one, else the first). */
async function createProject(r: ToolRig, args: Args): Promise<RigCallResult> {
  const first = args.environments.find((item) => item.default === true) ?? args.environments[0];
  if (first === undefined) throw new Error('no environment');
  const result = await settle(
    r,
    r.call('project_create', {
      name: args.name,
      ...(args.description === undefined ? {} : { description: args.description }),
      environment: {
        name: first.name,
        api: first.api,
        ...(first.frontend === undefined ? {} : { frontend: first.frontend }),
      },
    }),
  );
  if (result.isError) throw new Error(`project_create failed: ${result.text}`);
  return result;
}

/** `project_create`, then `project_save_env` with every environment. */
async function save(
  r: ToolRig,
  args: Args = SKLEP_ARGS,
): Promise<{ text: string; data: SaveView; project: { id: string; reused: boolean } }> {
  const created = await createProject(r, args);
  const result = await settle(r, r.call('project_save_env', { environments: args.environments }));
  if (result.isError) throw new Error(`project_save_env failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: SaveView };
  expect(structured.status).toBe('done');
  const { project } = (created.outcome as { data: { project: { id: string; reused: boolean } } })
    .data;
  return { text: result.text, data: structured.data, project };
}

/** Changes made to the project and its environments; connection tests left out (they only probe). */
const writes = (calls: readonly FakeCall[]): FakeCall[] =>
  calls.filter((call) => WRITES.has(call.method) && !call.path.endsWith('/test-connection'));

const environmentPosts = (calls: readonly FakeCall[]): FakeCall[] =>
  calls.filter((call) => call.method === 'POST' && call.path.endsWith('/environments'));

const stored = (r: ToolRig): StoredEnvironment[] =>
  r.fake.store.collection<StoredEnvironment>(SKLEP_COLLECTIONS.environments).list();

const env = (data: SaveView, name: string): EnvironmentView => {
  const found = data.environments.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no environment ${name} in the result`);
  return found;
};

interface ProcessFile {
  readonly ids: { readonly env_id?: string };
  readonly labels: Record<string, { readonly name: string }>;
  readonly steps: Record<string, { readonly checks: Record<string, unknown> }>;
}

function processOf(r: ToolRig, key: string): ProcessFile {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, ProcessFile> };
  const found = state.process[key];
  if (found === undefined) throw new Error(`no process under ${key}`);
  return found;
}

describe('project_save_env', () => {
  it('in an empty world adds the environments after the one the project was created with', async () => {
    const r = await rig('empty');
    const { data } = await save(r);

    expect(
      writes(r.fake.calls).map(
        (call) => `${call.method} ${call.path.replace(/[0-9a-f-]{36}/g, ':id')}`,
      ),
    ).toEqual([
      'POST /api/v1/projects',
      'POST /api/v1/projects/:id/environments',
      'POST /api/v1/projects/:id/environments',
      'POST /api/v1/projects/:id/environments',
    ]);
    // perf came with the project (project_create), so this call did not create it.
    expect(data.environments.map((item) => [item.name, item.default, item.created])).toEqual([
      ['perf', true, false],
      ['qa', false, true],
      ['dev', false, true],
      ['prod', false, true],
    ]);
    expect(stored(r)).toHaveLength(4);
  });

  it('turns a limit into a protected environment with workload caps', async () => {
    const r = await rig('empty');
    const { data } = await save(r);
    const bodies = environmentPosts(r.fake.calls).map((call) => call.body);
    expect(bodies).toContainEqual({
      name: 'qa',
      base_url: 'https://api.qa.example.com',
      frontend_url: 'https://qa.example.com',
      auth_type: 'none',
      is_default: false,
      protected: true,
      workload_caps: { max_vu: 100, max_rps: 20 },
    });
    expect(bodies).toContainEqual({
      name: 'dev',
      base_url: 'https://api.dev.example.com',
      frontend_url: 'https://dev.example.com',
      auth_type: 'none',
      is_default: false,
      protected: false,
    });
    expect(env(data, 'qa')).toMatchObject({ protected: true, caps: { maxVu: 100, maxRps: 20 } });
    expect(env(data, 'dev').caps).toBeUndefined();
  });

  it('called again with the same arguments writes nothing and finds the project by the binding', async () => {
    const r = await rig('empty');
    const first = await save(r);
    const before = r.fake.calls.length;
    const second = await save(r);
    const again = r.fake.calls.slice(before);

    expect(writes(again)).toEqual([]);
    expect(again.some((call) => call.path === '/api/v1/search')).toBe(false);
    expect(second.project).toMatchObject({ id: first.project.id, reused: true });
    expect(
      second.data.environments.every((item) => !item.created && item.differs === undefined),
    ).toBe(true);
    expect(stored(r)).toHaveLength(4);
  });

  it('reuses a project found by its exact name and creates only the missing environment', async () => {
    const r = await rig('project');
    r.fake.store
      .collection(SKLEP_COLLECTIONS.environments)
      .delete(SKLEP_WORLD_IDS.environments.dev);
    const { data, project } = await save(r);

    expect(writes(r.fake.calls).map((call) => [call.method, call.path])).toEqual([
      ['POST', `/api/v1/projects/${SKLEP_IDS.project}/environments`],
    ]);
    expect(environmentPosts(r.fake.calls)[0]?.body).toMatchObject({ name: 'dev' });
    expect(project).toMatchObject({ id: SKLEP_IDS.project, reused: true });
    expect(env(data, 'dev').created).toBe(true);
    expect(env(data, 'perf').created).toBe(false);
  });

  it('never overwrites an address or loosens a limit; reports the difference', async () => {
    const r = await rig('project');
    const args: Args = {
      ...SKLEP_ARGS,
      environments: SKLEP_ARGS.environments.map((item) =>
        item.name === 'perf'
          ? { ...item, api: 'https://api-v2.perf.example.com/' }
          : item.name === 'qa'
            ? { ...item, limit: [200, 40] }
            : item,
      ),
    };
    const { data } = await save(r, args);

    // A looser limit is only reported: the protection is never loosened by this call.
    expect(writes(r.fake.calls)).toEqual([]);
    expect(env(data, 'perf').differs).toEqual([
      {
        field: 'api',
        current: 'https://api.perf.example.com',
        requested: 'https://api-v2.perf.example.com',
      },
    ]);
    expect(env(data, 'qa').differs).toEqual([
      {
        field: 'limit',
        current: { maxVu: 100, maxRps: 20 },
        requested: { maxVu: 200, maxRps: 40 },
      },
    ]);
    // What LoadCraft has stays as it was, and the result shows that, not the request.
    expect(env(data, 'qa').caps).toEqual({ maxVu: 100, maxRps: 20 });
    const perf = stored(r).find((item) => item.name === 'perf');
    expect(perf?.base_url).toBe('https://api.perf.example.com');
    expect(env(data, 'dev').differs).toBeUndefined();
  });

  it('moves the default to the requested environment', async () => {
    const r = await rig('project');
    const args: Args = {
      ...SKLEP_ARGS,
      environments: SKLEP_ARGS.environments.map((item) =>
        item.name === 'perf'
          ? { ...item, default: false }
          : item.name === 'dev'
            ? { ...item, default: true }
            : item,
      ),
    };
    const { data } = await save(r, args);

    expect(writes(r.fake.calls).map((call) => call.path)).toEqual([
      `/api/v1/projects/${SKLEP_IDS.project}/environments/${SKLEP_WORLD_IDS.environments.dev}/set-default`,
    ]);
    expect(env(data, 'dev').default).toBe(true);
    expect(env(data, 'perf').default).toBe(false);
  });

  it('a new project keeps the environment it was created with as the default when none is marked', async () => {
    const r = await rig('empty');
    const { data } = await save(r, {
      name: 'sklep',
      environments: [
        { name: 'qa', api: 'api.qa.example.com' },
        { name: 'dev', api: 'http://api.dev.example.com:8080' },
      ],
    });
    expect(writes(r.fake.calls)[0]?.body).toMatchObject({
      environment_name: 'qa',
      base_url: 'https://api.qa.example.com',
    });
    expect(environmentPosts(r.fake.calls)[0]?.body).toMatchObject({
      name: 'dev',
      base_url: 'http://api.dev.example.com:8080',
      is_default: false,
    });
    expect(env(data, 'qa').default).toBe(true);
    expect(env(data, 'dev').default).toBe(false);
  });

  it('with none marked never moves the default, also when the list leaves it out', async () => {
    const r = await rig('project');
    // perf is the default in LoadCraft; the call lists other environments only, none marked
    const { data } = await save(r, {
      name: 'sklep',
      environments: SKLEP_ARGS.environments.filter((item) => item.name !== 'perf'),
    });
    expect(writes(r.fake.calls).some((call) => call.path.endsWith('/set-default'))).toBe(false);
    expect(data.environments.every((item) => !item.default)).toBe(true);
    expect(stored(r).find((item) => item.name === 'perf')?.is_default).toBe(true);
  });

  it('refuses two default environments before sending anything', async () => {
    const r = await rig('empty');
    const result = await settle(
      r,
      r.call('project_save_env', {
        environments: [
          { name: 'perf', api: 'api.perf.example.com', default: true },
          { name: 'qa', api: 'api.qa.example.com', default: true },
        ],
      }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('More than one environment is marked as the default: perf, qa.');
    expect(result.text).toContain('→ Mark exactly one environment with default: true');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('refuses a repeated environment name and an address that is not http(s)', async () => {
    const r = await rig('empty');
    const repeated = await settle(
      r,
      r.call('project_save_env', {
        environments: [
          { name: 'qa', api: 'api.qa.example.com' },
          { name: 'qa', api: 'api2.qa.example.com' },
        ],
      }),
    );
    expect(repeated.isError).toBe(true);
    expect(repeated.text).toContain('The environment name "qa" is used more than once.');

    const ftp = await settle(
      r,
      r.call('project_save_env', {
        environments: [{ name: 'qa', api: 'ftp://files.example.com' }],
      }),
    );
    expect(ftp.isError).toBe(true);
    expect(ftp.text).toContain(
      'The api address of environment "qa" is not a valid http(s) address',
    );

    const withPassword = await settle(
      r,
      r.call('project_save_env', {
        environments: [{ name: 'qa', api: `https://admin:${CANARY}@api.qa.example.com` }],
      }),
    );
    expect(withPassword.isError).toBe(true);
    expect(withPassword.text).toContain('not a valid http(s) address');
    expect(withPassword.text).not.toContain(CANARY);
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('without a bound project is the no-project error, and sends nothing', async () => {
    const r = await rig('empty');
    const result = await settle(
      r,
      r.call('project_save_env', { environments: SKLEP_ARGS.environments }),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no_project');
    expect(result.text).toContain('project_create');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('keeps the canary and masked values out of the result, the log and every request', async () => {
    const r = await rig('project');
    const environments = r.fake.store.collection<StoredEnvironment & Record<string, unknown>>(
      SKLEP_COLLECTIONS.environments,
    );
    environments.update(SKLEP_WORLD_IDS.environments.perf, {
      default_headers: { Authorization: '«masked»' },
    });
    environments.delete(SKLEP_WORLD_IDS.environments.dev);
    await save(r);
    const checked = await settle(r, r.call('project_check_env', {}));
    expect(checked.isError, checked.text).toBe(false);
    expect(JSON.stringify(r.fake.calls)).not.toContain('«masked»');
    expect(JSON.stringify(r.fake.calls)).not.toContain(CANARY);
    r.assertClean();
  });

  it('writes the default environment, the names and the check env_saved into the process', async () => {
    const r = await rig('empty');
    const { project } = await save(r);
    const process = processOf(r, project.id);
    const perf = stored(r).find((item) => item.name === 'perf');
    expect(process.ids.env_id).toBe(perf?.id);
    expect(process.labels[perf?.id ?? '']).toEqual(expect.objectContaining({ name: 'perf' }));
    expect(process.steps['project']?.checks['env_saved']).toMatchObject({
      ok: true,
      by: 'project_save_env',
    });
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('new project (%s)', async (locale) => {
      const r = await rig('empty', locale);
      const { text } = await save(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/projectSaveEnv.created.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)(
      'existing project with a difference and a new environment (%s)',
      async (locale) => {
        const r = await rig('project', locale);
        const args: Args = {
          ...SKLEP_ARGS,
          environments: [
            ...SKLEP_ARGS.environments.map((item) =>
              item.name === 'qa' ? { ...item, api: 'api-v2.qa.example.com' } : item,
            ),
            { name: 'local', api: 'http://localhost:8080' },
          ],
        };
        const { text } = await save(r, args);
        await expect(text).toMatchFileSnapshot(`__snapshots__/projectSaveEnv.reused.${locale}.txt`);
      },
    );
  });
});
