// `project_create`: the project found by the binding or its exact name, or created with its default
// environment and the API token's user as owner; the binding of the repository; the description from
// the overview or the plain text; the input it refuses before anything is sent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectCreate } from '../src/tools/projectCreate.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';
import { settleClock } from './helpers/clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

interface CreateView {
  readonly project: { readonly id: string; readonly name: string; readonly reused: boolean };
  readonly created: boolean;
  readonly adopted: boolean;
  readonly environment?: string;
}

interface Check {
  readonly ok: boolean | null;
  readonly by: string;
}

interface ProcessFile {
  readonly ids: { readonly project_id?: string };
  readonly labels: Record<string, { readonly name: string }>;
  readonly steps: Record<string, { readonly checks: Record<string, Check | undefined> }>;
}

/** The call of the mock-up session (step 02): the default environment of the project. */
const SKLEP_ARGS = {
  name: 'sklep',
  description: 'Sklep API',
  environment: { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com' },
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

async function rig(
  stage: 'empty' | 'project',
  options: { locale?: 'en' | 'pl'; files?: Record<string, string> } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: [projectCreate],
    world: world(stage),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    ...(options.files === undefined ? {} : { files: options.files }),
  });
}

const call = (r: ToolRig, args: Record<string, unknown>): Promise<RigCallResult> =>
  settleClock(r, r.call('project_create', args), { limitMs: 120_000 });

async function create(
  r: ToolRig,
  args: Record<string, unknown> = SKLEP_ARGS,
): Promise<{ text: string; data: CreateView }> {
  const result = await call(r, args);
  if (result.isError) throw new Error(`project_create failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: CreateView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

const writes = (calls: readonly FakeCall[]): FakeCall[] =>
  calls.filter((item) => WRITES.has(item.method));

function binding(r: ToolRig): unknown {
  return JSON.parse(readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8'));
}

function processOf(r: ToolRig, key: string): ProcessFile {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, ProcessFile> };
  const found = state.process[key];
  if (found === undefined) throw new Error(`no process under ${key}`);
  return found;
}

describe('project_create', () => {
  it('in an empty world creates the project with its default environment and binds the repository', async () => {
    const r = await rig('empty');
    const { data } = await create(r);

    expect(writes(r.fake.calls).map((item) => `${item.method} ${item.path}`)).toEqual([
      'POST /api/v1/projects',
    ]);
    expect(writes(r.fake.calls)[0]?.body).toEqual({
      name: 'sklep',
      description: 'Sklep API',
      project_type: 'api',
      environment_name: 'perf',
      base_url: 'https://api.perf.example.com',
      frontend_url: 'https://perf.example.com',
    });
    // The search ran before the create, so an existing project would have been found.
    const search = r.fake.calls.findIndex((item) => item.path === '/api/v1/search');
    const created = r.fake.calls.findIndex((item) => item.path === '/api/v1/projects');
    expect(search).toBeGreaterThanOrEqual(0);
    expect(search).toBeLessThan(created);

    const projects = r.fake.store.collection<{ id: string; created_by: string | null }>(
      SKLEP_COLLECTIONS.projects,
    );
    const [stored] = projects.list();
    expect(stored?.created_by).toBe('user@example.com');
    expect(data).toEqual({
      project: { id: stored?.id, name: 'sklep', reused: false },
      created: true,
      adopted: false,
      environment: 'perf',
    });
    expect(binding(r)).toEqual({
      schema: 1,
      url: r.config.appUrl,
      project: { id: stored?.id, name: 'sklep' },
    });
  });

  it('called again finds the project by the binding and writes nothing', async () => {
    const r = await rig('empty');
    const first = await create(r);
    const before = r.fake.calls.length;
    const second = await create(r);
    const again = r.fake.calls.slice(before);

    expect(writes(again)).toEqual([]);
    expect(again.some((item) => item.path === '/api/v1/search')).toBe(false);
    expect(second.data).toEqual({
      project: { ...first.data.project, reused: true },
      created: false,
      adopted: true,
    });
  });

  it('reuses a project found by its exact name', async () => {
    const r = await rig('project');
    const { data } = await create(r);
    expect(writes(r.fake.calls)).toEqual([]);
    expect(data.project).toEqual({ id: SKLEP_IDS.project, name: 'sklep', reused: true });
    expect(data.environment).toBeUndefined();
    expect(binding(r)).toMatchObject({ project: { id: SKLEP_IDS.project, name: 'sklep' } });
  });

  it('does not reuse a project whose name only contains the name or differs in case', async () => {
    const r = await rig('project');
    r.fake.store
      .collection<{ id: string; name: string }>(SKLEP_COLLECTIONS.projects)
      .update(SKLEP_IDS.project, { name: 'Sklep' });
    const { data } = await create(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'api.qa.example.com' },
    });
    expect(writes(r.fake.calls).map((item) => item.path)).toEqual(['/api/v1/projects']);
    expect(data.project.id).not.toBe(SKLEP_IDS.project);
    expect(data.project.reused).toBe(false);
  });

  it('creates the project with the environment given, its address made https', async () => {
    const r = await rig('empty');
    await create(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'api.qa.example.com' },
    });
    const body = writes(r.fake.calls)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ environment_name: 'qa', base_url: 'https://api.qa.example.com' });
    expect(body['frontend_url']).toBeUndefined();
  });

  it('refuses a name taken by a project it cannot see, and writes no binding', async () => {
    const r = await rig('empty');
    r.fake.faults.next('POST', '/api/v1/projects', {
      status: 400,
      body: { detail: 'Project with name "sklep" already exists' },
    });
    const result = await call(r, SKLEP_ARGS);

    expect(result.isError).toBe(true);
    expect(result.text).toContain('The project name "sklep" is already taken in LoadCraft');
    expect(result.text).toContain('→ Ask the user for another project name');
    expect(result.text).toContain('project_create');
    expect(() => binding(r)).toThrow();
  });

  it('reuses its own project the search did not return when the create says the name is taken', async () => {
    const r = await rig('project');
    // The search answers 50 results at most; here it misses the project entirely.
    r.fake.faults.next('GET', '/api/v1/search', { status: 200, body: { results: [], total: 0 } });
    const { data } = await create(r);
    expect(data.project).toEqual({ id: SKLEP_IDS.project, name: 'sklep', reused: true });
    expect(writes(r.fake.calls).map((item) => item.path)).toEqual(['/api/v1/projects']);
  });

  it('refuses an address that is not http(s), or one with a password, before sending anything', async () => {
    const r = await rig('empty');
    const ftp = await call(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'ftp://files.example.com' },
    });
    expect(ftp.isError).toBe(true);
    expect(ftp.text).toContain(
      'The api address of environment "qa" is not a valid http(s) address',
    );

    const withPassword = await call(r, {
      name: 'sklep',
      environment: { name: 'qa', api: `https://admin:${CANARY}@api.qa.example.com` },
    });
    expect(withPassword.isError).toBe(true);
    expect(withPassword.text).toContain('not a valid http(s) address');
    expect(withPassword.text).not.toContain(CANARY);

    const frontend = await call(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'api.qa.example.com', frontend: 'ftp://qa.example.com' },
    });
    expect(frontend.isError).toBe(true);
    expect(frontend.text).toContain('frontend');
    expect(writes(r.fake.calls)).toEqual([]);
    expect(r.fake.calls.some((item) => item.path === '/api/v1/search')).toBe(false);
  });

  it('refuses the limits or headers of an environment and an unknown field, naming project_save_env', async () => {
    const r = await rig('empty');
    const limit = await call(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'api.qa.example.com', limit: [100, 20] },
    });
    expect(limit.isError).toBe(true);
    expect(limit.text).toContain('"limit"');
    expect(limit.text).toContain('project_save_env');

    const environments = await call(r, {
      name: 'sklep',
      environment: { name: 'qa', api: 'api.qa.example.com' },
      environments: [{ name: 'qa', api: 'api.qa.example.com' }],
    });
    expect(environments.isError).toBe(true);
    expect(environments.text).toContain('"environments"');

    const openapi = await call(r, {
      ...SKLEP_ARGS,
      openapi: 'loadcraft/openapi.json',
    });
    expect(openapi.isError).toBe(true);
    expect(openapi.text).toContain('"openapi"');
    expect(r.fake.calls.filter((item) => item.method !== 'GET')).toEqual([]);
  });

  it('uses the overview file as the project description', async () => {
    const r = await rig('empty', {
      files: { 'loadcraft/overview.md': '# Sklep\n\nShop API: catalog, cart, orders.\n' },
    });
    await create(r, {
      name: 'sklep',
      overview: 'loadcraft/overview.md',
      environment: SKLEP_ARGS.environment,
    });
    expect(writes(r.fake.calls)[0]?.body).toMatchObject({
      description: '# Sklep\n\nShop API: catalog, cart, orders.',
    });
  });

  it('refuses an overview longer than the description limit before creating anything', async () => {
    const r = await rig('empty', { files: { 'loadcraft/overview.md': 'x'.repeat(8001) } });
    const result = await call(r, { ...SKLEP_ARGS, overview: 'loadcraft/overview.md' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('loadcraft/overview.md has 8001 characters');
    expect(writes(r.fake.calls)).toEqual([]);
  });

  it('refuses a plain description longer than the limit before creating anything', async () => {
    const r = await rig('empty');
    const result = await call(r, { ...SKLEP_ARGS, description: 'x'.repeat(8001) });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('8001');
    expect(writes(r.fake.calls)).toEqual([]);
  });

  it('searches with the first 100 characters of a long name and compares the whole name', async () => {
    const r = await rig('empty');
    const name = `sklep-${'a'.repeat(120)}`;
    const { data } = await create(r, {
      name,
      environment: { name: 'qa', api: 'api.qa.example.com' },
    });
    const search = r.fake.calls.find((item) => item.path === '/api/v1/search');
    expect(search?.query['q']).toBe(name.slice(0, 100));
    expect(data.project.name).toBe(name);
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig('empty');
    r.fake.faults.next('POST', '/api/v1/projects', {
      status: 401,
      body: { detail: 'Invalid principal token signature' },
    });
    const result = await call(r, SKLEP_ARGS);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
  });

  it('refuses a backend without /meta as too old, before any write', async () => {
    const r = await rig('empty');
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await call(r, SKLEP_ARGS);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
    expect(writes(r.fake.calls)).toEqual([]);
  });

  it('refuses a backend with a too old API revision', async () => {
    const r = await toolRig({
      tools: [projectCreate],
      world: world('empty'),
      fake: { meta: { api_revision: 0 } },
    });
    const result = await call(r, SKLEP_ARGS);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('API revision 0');
    expect(writes(r.fake.calls)).toEqual([]);
  });

  it('writes the project, its name and the check created into the process', async () => {
    const r = await rig('empty');
    const { data } = await create(r);
    const process = processOf(r, data.project.id);
    expect(process.ids.project_id).toBe(data.project.id);
    expect(process.labels[data.project.id]).toEqual(expect.objectContaining({ name: 'sklep' }));
    expect(process.steps['project']?.checks['created']).toMatchObject({
      ok: true,
      by: 'project_create',
    });
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('new and existing project (%s)', async (locale) => {
      const created = await create(await rig('empty', { locale }));
      await expect(created.text).toMatchFileSnapshot(
        `__snapshots__/projectCreate.created.${locale}.txt`,
      );
      const reused = await create(await rig('project', { locale }));
      await expect(reused.text).toMatchFileSnapshot(
        `__snapshots__/projectCreate.reused.${locale}.txt`,
      );
    });
  });
});
