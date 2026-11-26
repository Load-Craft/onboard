import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { assertNoCanary, FILE_CANARY } from './helpers/canary.js';

import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import type { Fake } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { SETUP_TOOLS, setUpProject } from './helpers/projectSetup.js';
import { toolRig } from './helpers/rig.js';

const VALID = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'sklep', version: '1' },
  paths: { '/api/orders': { get: { responses: { '200': { description: 'ok' } } } } },
});
const KEY_FILE = JSON.stringify({
  type: 'service_account',
  private_key: `-----BEGIN PRIVATE KEY-----\n${FILE_CANARY}\n-----END PRIVATE KEY-----\n`,
});

const SERVICE_ACCOUNT = KEY_FILE;

const rigWith = (files: Record<string, string>) =>
  toolRig({
    tools: SETUP_TOOLS,
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerProjectRoutes(fake);
      registerSetupRoutes(fake);
      registerOpenapiReadRoute(fake);
      registerApiMapRoute(fake);
      registerConformanceRoute(fake);
      seedSklep(fake.store, { stage: 'empty' });
    },
    env: { LOADCRAFT_LOCALE: 'en' },
    files,
  });

const ENVIRONMENTS = [{ name: 'perf', api: 'api.perf.example.com', default: true }];

/** Every write the call sent: a refused document leaves LoadCraft untouched. */
const writes = (r: Awaited<ReturnType<typeof rigWith>>) =>
  r.fake.calls.filter((call) => call.method !== 'GET');

const analyzeUploads = (r: Awaited<ReturnType<typeof rigWith>>) =>
  r.fake.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/setup/analyze'));

describe('project_analyze_setup sends only API documents', () => {
  it('refuses a JSON file that is not an OpenAPI document before sending it', async () => {
    const r = await rigWith({ 'deploy/service-account.json': SERVICE_ACCOUNT });
    const result = await settleClock(
      r,
      r.call('project_analyze_setup', { openapi: 'deploy/service-account.json' }),
    );
    expect(analyzeUploads(r), 'the key file went to LoadCraft').toHaveLength(0);
    expect(writes(r)).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[openapi_not_openapi]');
    expect(result.text).toContain('Nothing was sent');
    assertNoCanary(result.text);
  });

  it('refuses an AsyncAPI slot filled with a non-AsyncAPI file', async () => {
    const r = await rigWith({ 'deploy/service-account.json': SERVICE_ACCOUNT });
    const result = await settleClock(
      r,
      r.call('project_analyze_setup', { asyncapi: 'deploy/service-account.json' }),
    );
    expect(analyzeUploads(r)).toHaveLength(0);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[asyncapi_not_asyncapi]');
  });

  it('refuses a file in a hidden directory, even when its content is a valid document', async () => {
    const r = await rigWith({ '.docker/openapi.json': VALID });
    const result = await settleClock(
      r,
      r.call('project_analyze_setup', { openapi: '.docker/openapi.json' }),
    );
    expect(analyzeUploads(r)).toHaveLength(0);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('[document_path_excluded]');
  });

  it('refuses a file under node_modules', async () => {
    const r = await rigWith({ 'node_modules/pkg/openapi.json': VALID });
    const result = await settleClock(
      r,
      r.call('project_analyze_setup', { openapi: 'node_modules/pkg/openapi.json' }),
    );
    expect(analyzeUploads(r)).toHaveLength(0);
    expect(result.text).toContain('[document_path_excluded]');
  });

  it('refuses a path that git ignores', async () => {
    const r = await rigWith({ 'dist/openapi.json': VALID, '.gitignore': 'dist/\n' });
    execFileSync('git', ['init', '-q'], { cwd: r.workspace });
    const result = await settleClock(
      r,
      r.call('project_analyze_setup', { openapi: 'dist/openapi.json' }),
    );
    expect(analyzeUploads(r)).toHaveLength(0);
    expect(result.text).toContain('[document_path_ignored]');
  });

  it('accepts a valid OpenAPI document', async () => {
    const r = await rigWith({ 'loadcraft/openapi.json': VALID });
    const calls = await setUpProject(r, {
      name: 'sklep',
      openapi: 'loadcraft/openapi.json',
      environments: ENVIRONMENTS,
    });
    expect(calls.analyze?.isError, calls.analyze?.text).toBe(false);
    expect(calls.apply?.isError, calls.apply?.text).toBe(false);
    expect(analyzeUploads(r).length).toBeGreaterThan(0);
  });
});
