// The setup split into five tools asks LoadCraft for the same thing as the one setup call it
// replaced. `fixtures/project-setup-requests.json` holds the requests the fake backend saw from that
// call at fc70b30 (ids as `:id`), for four ways through it: documentation, a description only,
// nothing to analyse, and a project that exists. The tools called in the order of the skill must
// send the same writes and probes (every request but a GET), in the same order and with the same
// bodies; they may read more often, because each tool reads what it needs, but no other route.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../src/tools/index.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { SETUP_TOOLS, setUpProject, type SetupArgs } from './helpers/projectSetup.js';
import { toolRig, type RigCallResult } from './helpers/rig.js';
import { CURRENT_TO_TOOLS, TOOL_NAMES, type ToolName } from '../src/catalog.generated.js';

interface Request {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/project-setup-requests.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, readonly Request[]>>;

function openapiDocument(commit: string): string {
  const paths: Record<string, unknown> = {};
  for (let index = 1; index <= 3; index += 1) {
    paths[`/items/${String(index)}`] = { get: { operationId: `getItem${String(index)}` } };
  }
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Sklep API', version: '2.14.0', 'x-loadcraft-source': { commit } },
    paths,
  });
}

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  {
    name: 'dev',
    api: 'api.dev.example.com',
    frontend: 'dev.example.com',
    headers: [{ name: 'x-api-key', from_env: 'SHOP_KEY' }],
  },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

const WAYS: readonly [string, 'empty' | 'project', SetupArgs][] = [
  [
    'docs-empty',
    'empty',
    { name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS },
  ],
  [
    'description-empty',
    'empty',
    { name: 'sklep', description: 'Sklep API', environments: ENVIRONMENTS },
  ],
  ['nothing-empty', 'empty', { name: 'sklep', environments: ENVIRONMENTS }],
  [
    'docs-project',
    'project',
    { name: 'sklep', openapi: 'loadcraft/openapi.json', environments: ENVIRONMENTS },
  ],
];

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

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function normalized(call: FakeCall): Request {
  const query = Object.keys(call.query).length === 0 ? {} : { query: call.query };
  const hasBody =
    call.method !== 'GET' &&
    call.body !== undefined &&
    call.body !== null &&
    !(typeof call.body === 'object' && Object.keys(call.body).length === 0);
  return {
    method: call.method,
    path: call.path.replace(ID, ':id'),
    ...query,
    ...(hasBody ? { body: call.body } : {}),
  };
}

const sent = (requests: readonly Request[]): Request[] =>
  requests.filter((request) => request.method !== 'GET');

const readRoutes = (requests: readonly Request[]): string[] =>
  [...new Set(requests.filter((r) => r.method === 'GET').map((r) => r.path))].sort();

describe('project setup in five tools: the requests of the single setup call', () => {
  it('names the five tools of the migration map, all in the catalog and on the server', () => {
    const five: readonly ToolName[] = [
      'project_create',
      'project_save_env',
      'project_check_env',
      'project_analyze_setup',
      'project_apply_setup',
    ];
    const split = Object.entries(CURRENT_TO_TOOLS).find(
      ([, tools]) => tools.length === five.length && five.every((name) => tools.includes(name)),
    );
    expect(split?.[1]).toEqual(five);
    const listed = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of five) {
      expect(TOOL_NAMES).toContain(name);
      expect(listed.has(name)).toBe(true);
    }
  });

  it.each(WAYS)('%s: the same writes and probes in the same order', async (way, stage, args) => {
    const r = await toolRig({
      tools: SETUP_TOOLS,
      world: world(stage),
      env: { LOADCRAFT_LOCALE: 'en' },
      processServices: true,
      files: { 'loadcraft/openapi.json': openapiDocument('a41f9c2'), '.env': 'SHOP_KEY=k-123\n' },
    });
    const calls = await setUpProject(r, args);
    const failed = [calls.create, calls.saveEnv, calls.checkEnv, calls.analyze, calls.apply].filter(
      (call): call is RigCallResult => call?.isError === true,
    );
    expect(failed.map((call) => call.text)).toEqual([]);
    expect(calls.apply).toBeDefined();
    const recorded = RECORDED[way] ?? [];
    expect(recorded.length).toBeGreaterThan(0);
    const now = r.fake.calls.map(normalized);
    expect(sent(now)).toEqual(sent(recorded));
    expect(readRoutes(now)).toEqual(readRoutes(recorded));
  });
});
