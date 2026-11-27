// The coverage of module project: the operations of the backend the tests of its tools call on the fake
// backend equal the operations of the module's written tools. Every view of every tool is called once here
// with a minimal world; the requests the fake saw are turned into the catalog's operations.

import { describe, it } from 'vitest';

import { MODULE_INDEX } from '../../../src/tools/_generated/modules.js';
import { seedAreaPrefixes } from '../../fake-backend/routes/documentation.js';
import {
  seedActiveRuns,
  seedActivity,
  seedAsyncSpec,
  seedEndpointExtras,
  seedProjectNotes,
  seedTeamMember,
} from '../../fake-backend/routes/project.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import { seedHttpSettings } from '../../fake-backend/routes/provision.js';
import type { StoredSpec } from '../../fake-backend/routes/setup.js';
import type { Fake } from '../../fake-backend/server.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepEndpoint,
  type SklepTelemetrySource,
} from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { createTestClock } from '../../helpers/clock.js';
import {
  expectModuleCoverage,
  operationOf,
  type UnusedOperations,
} from '../../helpers/moduleClosure.js';
import { answering, person } from '../../helpers/consentPerson.js';
import { toolRig } from '../../helpers/rig.js';
import { PROJECT_DEBTS } from './debts.js';

/** The operations of written tools that no test calls, with why. */
const UNUSED: UnusedOperations = {};

const PROJECT = SKLEP_IDS.project;
const SPEC = SKLEP_WORLD_IDS.spec;
const OLD_SPEC = '5c2e8a14-7d39-4b60-9f1a-3e6b0d8c4a72';
const ASYNC = '8b1f3d57-2a64-4c90-b7e5-1d9a0c6e4f38';
const ASYNC_OLD = '2f6a9c13-8e47-4d05-a1b3-7c5d0e9f2b64';
const NEW_MEMBER = '9c4a7e10-5b28-4f63-a0d9-1e6b3c8f2a75';
const NOTE = '3f2a9c0b7d4e4a51b8c6d2e1f09a7b34';
const ENV = SKLEP_WORLD_IDS.environments.perf;

function seed(fake: Fake): void {
  seedSklep(fake.store, { stage: 'project' });
  fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).insert({
    id: OLD_SPEC,
    title: 'Sklep API',
    version: '2.13.0',
    description: null,
    created_at: '2026-10-01T09:00:00Z',
    endpoints_count: 20,
    is_active: false,
    is_current: false,
    source_url: null,
  });
  seedAsyncSpec(fake.store, PROJECT, { id: ASYNC, title: 'Events', version: '1.2.0' });
  seedAsyncSpec(
    fake.store,
    PROJECT,
    { id: ASYNC_OLD, title: 'Events', version: '1.1.0' },
    { is_current: false, is_active: false },
  );
  seedProjectNotes(fake.store, PROJECT, [
    { id: NOTE, text: 'Accept the cookie banner.', scope: { kind: 'url_path', url_path: '/' } },
  ]);
  seedTeamMember(fake.store, PROJECT, { id: 'm1', user_id: 'u1', role: 'owner' }, true);
  seedAreaPrefixes(fake.store, PROJECT, ['/auth']);
  seedActivity(fake.store, []);
  seedActiveRuns(fake.store, []);
  const login = fake.store
    .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
    .list()
    .find((item) => item.method === 'POST' && item.path === '/auth/login');
  if (login !== undefined) seedEndpointExtras(fake.store, login.id, { detail: {} });
}

describe('module project: the tests call every operation of the written tools', () => {
  it('equals the operations of the catalog, but those named unused; the debts call none', async () => {
    const r = await toolRig({
      tools: MODULE_INDEX.project,
      world: (fake: Fake) => {
        registerAllRoutes(fake);
        seed(fake);
      },
      clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
      env: { LOADCRAFT_LOCALE: 'en' },
      elicit: answering(person()),
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: PROJECT, name: 'sklep' },
        }),
      },
    });
    const login = r.fake.store
      .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
      .list()
      .find((item) => item.method === 'POST' && item.path === '/auth/login');
    const calls: [string, Record<string, unknown>][] = [
      ['project_get_envs', {}],
      ['project_get_envs', { env: 'default' }],
      ['project_get_envs', { env: ENV }],
      ['project_get_envs', { env: ENV, effective: true }],
      ['project_get_docs', {}],
      ['project_get_docs', { versions: true }],
      ['project_get_docs', { docs_id: SPEC }],
      ['project_get_docs', { kind: 'asyncapi' }],
      ['project_get_docs', { kind: 'asyncapi', versions: true }],
      ['project_get_docs', { kind: 'asyncapi', docs_id: ASYNC }],
      ['project_get_endpoints', { docs_id: SPEC }],
      ['project_get_endpoints', { docs_id: SPEC, endpoint: login?.id }],
      ['project_get_endpoints', { docs_id: SPEC, endpoint: login?.id, include: ['bindings'] }],
      ['project_get_apimap', {}],
      ['project_list_notes', {}],
      ['project_list_team', {}],
      ['project_list_team', { me: true }],
      ['project_get_http_settings', {}],
      ['project_get_activity', {}],
      ['project_list', {}],
      ['project_list', { query: 'sklep' }],
      ['project_update', { description: 'A new description' }],
      ['project_set_active_docs', { docs_id: OLD_SPEC }],
      ['project_set_active_docs', { kind: 'asyncapi', docs_id: ASYNC_OLD }],
      ['project_set_apimap', { prefixes: '/auth,/orders' }],
      ['project_update_note', { note_id: NOTE, text: 'Close the cookie banner.' }],
      // a tool on a consent card: the card, then the yes of the person (one POST, one PUT)
      ...[NEW_MEMBER, NEW_MEMBER].map((id): [string, Record<string, unknown>] => [
        'project_save_member',
        { user_id: id, role: 'viewer' },
      ]),
      ...[NEW_MEMBER, NEW_MEMBER].map((id): [string, Record<string, unknown>] => [
        'project_save_member',
        { user_id: id, role: 'editor' },
      ]),
    ];
    const run = async (list: readonly (readonly [string, Record<string, unknown>])[]) => {
      for (const [tool, args] of list) {
        const result = await r.call(tool, args);
        if (result.isError) throw new Error(`${tool} ${JSON.stringify(args)}: ${result.text}`);
      }
    };
    await run(calls);
    // the settings of the generated tests: a change (PUT), then a project that has none yet (setup)
    const settings = { base_url: 'https://shop.example.test', protocol: { http2_enabled: true } };
    await run([
      ['project_set_http_settings', settings],
      ['project_set_http_settings', settings],
    ]);
    seedHttpSettings(r.fake.store, PROJECT, {}, { missing: true });
    // a log server, then its disconnection: the card, and the yes of the person
    const telemetry = r.fake.store.collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry);
    if (telemetry.get(PROJECT) === undefined) {
      telemetry.insert({
        id: PROJECT,
        kind: 'mcp',
        label: 'logs',
        url: 'https://logs.example.test/mcp',
        enabled_tools: [],
      });
    }
    await run([
      ['project_disconnect_telemetry', {}],
      ['project_disconnect_telemetry', {}],
    ]);
    await run([
      ['project_set_http_settings', settings],
      ['project_set_http_settings', settings],
    ]);
    const called = new Set(
      r.fake.calls
        .map((call) => operationOf('project', call.method, call.path))
        .filter((id): id is string => id !== undefined),
    );
    expectModuleCoverage('project', called, PROJECT_DEBTS, UNUSED);
  });
});
