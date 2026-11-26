// `project_save_env`: a fixed header of an environment (`headers: [{ name, from_env }]`). The value is
// read from the `.env` file of the workspace and goes to the environment as `default_headers`; it is
// never taken from the call and never shown in a result, a log or the state file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectCreate } from '../src/tools/projectCreate.js';
import { projectSaveEnv } from '../src/tools/projectSaveEnv.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes, storedHeaderValues } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep, SKLEP_COLLECTIONS } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { FILE_CANARY } from './helpers/canary.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

interface StoredEnvironment {
  id: string;
  project_id: string;
  name: string;
  default_headers: Record<string, unknown>;
}

const KEY = 'x-api-key';
const VARIABLE = 'SHOP_API_KEY';
const MASK = '«masked»';
const VALUE = `pk_${FILE_CANARY}`;

const world =
  (stage: 'empty' | 'project') =>
  (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    seedSklep(fake.store, { stage });
  };

const rig = (
  stage: 'empty' | 'project' = 'empty',
  files: Record<string, string> = { '.env': `${VARIABLE}=${VALUE}\nOTHER=not-needed\n` },
): Promise<ToolRig> =>
  toolRig({
    tools: [projectCreate, projectSaveEnv],
    world: world(stage),
    env: { LOADCRAFT_LOCALE: 'en' },
    files,
  });

const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call, { limitMs: 120_000 });

interface Environment {
  readonly name: string;
  readonly api: string;
}

/** The input of `project_save_env` out of a whole setup call: the environments and the env file. */
function saveArgs(args: Record<string, unknown>): Record<string, unknown> {
  return {
    environments: args['environments'],
    ...(args['env_file'] === undefined ? {} : { env_file: args['env_file'] }),
  };
}

/** `project_save_env` alone: what it refuses, it refuses before anything is sent. */
const saveOnly = (r: ToolRig, args: Record<string, unknown>): Promise<RigCallResult> =>
  settle(r, r.call('project_save_env', saveArgs(args)));

/** `project_create` with the first environment, then `project_save_env` with all of them. */
async function run(r: ToolRig, args: Record<string, unknown>): Promise<RigCallResult> {
  const [first] = args['environments'] as readonly Environment[];
  if (first === undefined) throw new Error('no environment');
  const created = await settle(
    r,
    r.call('project_create', {
      name: args['name'],
      ...(args['description'] === undefined ? {} : { description: args['description'] }),
      environment: { name: first.name, api: first.api },
    }),
  );
  if (created.isError) return created;
  return saveOnly(r, args);
}

const environment = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  api: 'store.example.com',
  headers: [{ name: KEY, from_env: VARIABLE }],
  ...extra,
});

const call = (extra: Record<string, unknown> = {}, headers: unknown = undefined) => ({
  name: 'shop',
  description: 'Store API',
  environments: [headers === undefined ? environment('main') : { ...environment('main'), headers }],
  ...extra,
});

const stored = (r: ToolRig): StoredEnvironment[] =>
  r.fake.store.collection<StoredEnvironment>(SKLEP_COLLECTIONS.environments).list();

const requestsOf = (r: ToolRig) => r.fake.calls.filter((c) => c.method !== 'GET');

describe('project_save_env: fixed headers of an environment', () => {
  it('sends the value read from .env to the environment of a new project', async () => {
    const r = await rig();
    const result = await run(r, call());
    expect(result.isError).toBe(false);
    const env = stored(r).find((item) => item.name === 'main');
    expect(env).toBeDefined();
    expect(storedHeaderValues(r.fake, env?.id ?? '')).toEqual({ [KEY]: VALUE });
    r.assertClean();
  });

  it('shows the header name and the variable, never the value', async () => {
    const r = await rig();
    const result = await run(r, call());
    expect(result.text).toContain(KEY);
    expect(result.text).toContain(VARIABLE);
    expect(JSON.stringify(result.outcome)).not.toContain(FILE_CANARY);
    expect(result.text).not.toContain(FILE_CANARY);
    expect(r.lines.join('\n')).not.toContain(FILE_CANARY);
    r.assertClean();
  });

  it('keeps the value out of the state file', async () => {
    const r = await rig();
    await run(r, call());
    const state = readFileSync(join(r.workspace, 'loadcraft', 'project.json'), 'utf8');
    expect(state).not.toContain(FILE_CANARY);
    expect(state).not.toContain(KEY);
  });

  it('updates the headers of an environment that exists, again on a repeated call', async () => {
    const r = await rig();
    await run(r, call());
    const again = await run(r, call());
    expect(again.isError).toBe(false);
    const env = stored(r).find((item) => item.name === 'main');
    expect(storedHeaderValues(r.fake, env?.id ?? '')).toEqual({ [KEY]: VALUE });
    const puts = requestsOf(r).filter((c) => c.method === 'PUT');
    expect(puts.length).toBeGreaterThanOrEqual(1);
  });

  it('creates an additional environment with the header in one request', async () => {
    const r = await rig();
    await run(r, call());
    const second = {
      name: 'shop',
      environments: [environment('main'), environment('stage', { api: 'stage.example.com' })],
    };
    const result = await run(r, second);
    expect(result.isError).toBe(false);
    const stage = stored(r).find((item) => item.name === 'stage');
    expect(storedHeaderValues(r.fake, stage?.id ?? '')).toEqual({ [KEY]: VALUE });
    const created = requestsOf(r).filter(
      (c) => c.method === 'POST' && c.path.endsWith('/environments'),
    );
    expect(created.at(-1)?.path).toBeDefined();
  });

  it('does not touch the headers of an environment the call gives none', async () => {
    const r = await rig();
    await run(r, call());
    const before = requestsOf(r).length;
    const result = await run(r, {
      name: 'shop',
      environments: [{ name: 'main', api: 'store.example.com' }],
    });
    expect(result.isError).toBe(false);
    const env = stored(r).find((item) => item.name === 'main');
    expect(storedHeaderValues(r.fake, env?.id ?? '')).toEqual({ [KEY]: VALUE });
    const later = requestsOf(r).slice(before);
    expect(later.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('reads the variable from the file named by env_file', async () => {
    const r = await rig('empty', { '.env.store': `${VARIABLE}=${VALUE}\n` });
    const result = await run(r, call({ env_file: '.env.store' }));
    expect(result.isError).toBe(false);
    const env = stored(r).find((item) => item.name === 'main');
    expect(storedHeaderValues(r.fake, env?.id ?? '')).toEqual({ [KEY]: VALUE });
  });

  it('refuses a literal value: the field is unknown and the error names from_env', async () => {
    const r = await rig();
    const result = await saveOnly(r, call({}, [{ name: KEY, value: 'pk_literal-value-0001' }]));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('from_env');
    expect(result.text).not.toContain('pk_literal-value-0001');
    expect(requestsOf(r)).toEqual([]);
    expect(stored(r).some((item) => Object.keys(item.default_headers).includes(KEY))).toBe(false);
  });

  it('refuses a header that carries both a variable and a value', async () => {
    const r = await rig();
    const result = await saveOnly(
      r,
      call({}, [{ name: KEY, from_env: VARIABLE, value: 'pk_literal-value-0001' }]),
    );
    expect(result.isError).toBe(true);
    expect(requestsOf(r)).toEqual([]);
  });

  it.each([
    ['a space', 'x api'],
    ['an underscore (the backend would rewrite it)', 'x_api_key'],
    ['a colon', 'x-key:'],
    ['a leading digit', '1-key'],
    ['a line break', 'x-key\nInjected'],
    ['Host', 'Host'],
    ['Content-Length', 'content-length'],
    ['Authorization', 'AUTHORIZATION'],
    ['Transfer-Encoding', 'Transfer-Encoding'],
    ['Connection', 'connection'],
  ])('refuses the name %s before anything is sent', async (_label, name) => {
    const r = await rig();
    const result = await saveOnly(r, call({}, [{ name, from_env: VARIABLE }]));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_header_name_invalid');
    expect(requestsOf(r)).toEqual([]);
  });

  it('refuses the same header twice in one environment, whatever the case', async () => {
    const r = await rig();
    const result = await saveOnly(
      r,
      call({}, [
        { name: KEY, from_env: VARIABLE },
        { name: 'X-Api-Key', from_env: 'OTHER' },
      ]),
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_header_repeated');
    expect(requestsOf(r)).toEqual([]);
  });

  it('answers a variable missing from .env with a code and the next move, and sends nothing', async () => {
    const r = await rig('empty', { '.env': 'OTHER=1\n' });
    const result = await saveOnly(r, call());
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_header_variable_missing');
    expect(result.text).toContain(VARIABLE);
    expect(requestsOf(r)).toEqual([]);
  });

  it('answers an empty variable like a missing one', async () => {
    const r = await rig('empty', { '.env': `${VARIABLE}=\n` });
    const result = await saveOnly(r, call());
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_header_variable_missing');
  });

  it('refuses a value with a line break before anything is sent', async () => {
    const r = await rig('empty', { '.env': `${VARIABLE}="pk_${FILE_CANARY}\\nX-Evil: 1"\n` });
    const result = await saveOnly(r, call());
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_header_value_invalid');
    expect(result.text).not.toContain(FILE_CANARY);
    expect(requestsOf(r)).toEqual([]);
  });

  it('refuses a variable name that is not a name', async () => {
    const r = await rig();
    const result = await saveOnly(r, call({}, [{ name: KEY, from_env: 'bad name' }]));
    expect(result.isError).toBe(true);
    expect(requestsOf(r)).toEqual([]);
  });

  it('refuses a file that is not an env file', async () => {
    const r = await rig('empty', { 'notes.txt': `${VARIABLE}=${VALUE}\n` });
    const result = await saveOnly(r, call({ env_file: 'notes.txt' }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('env_file_not_allowed');
    expect(result.text).not.toContain(FILE_CANARY);
  });

  it('keeps the other headers of an environment that the backend shows in clear', async () => {
    const r = await rig();
    await run(r, call());
    const env = stored(r).find((item) => item.name === 'main');
    r.fake.store
      .collection<StoredEnvironment>(SKLEP_COLLECTIONS.environments)
      .update(env?.id ?? '', { default_headers: { 'x-region': 'eu' } });
    await run(r, call());
    expect(storedHeaderValues(r.fake, env?.id ?? '')).toEqual({ 'x-region': 'eu', [KEY]: VALUE });
  });

  it('stops when the environment has another header the backend masks and a write would drop it', async () => {
    const r = await rig();
    await run(r, call());
    const env = stored(r).find((item) => item.name === 'main');
    r.fake.store
      .collection<StoredEnvironment>(SKLEP_COLLECTIONS.environments)
      .update(env?.id ?? '', { default_headers: { 'x-api-token': MASK } });
    const before = requestsOf(r).length;
    const result = await run(r, call());
    expect(result.isError).toBe(true);
    expect(result.text).toContain('init_project_headers_unpreservable');
    expect(result.text).toContain('x-api-token');
    expect(
      requestsOf(r)
        .slice(before)
        .some((c) => c.method === 'PUT'),
    ).toBe(false);
  });

  it('is told by the tool description when to use headers', () => {
    expect(projectSaveEnv.description).toMatch(/headers[^.]*from_env/);
    expect(projectSaveEnv.description).toMatch(/never (a|the) value/i);
  });
});
