// Sentinel cases of the tools of module project (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import { seedAreaPrefixes } from '../../fake-backend/routes/documentation.js';
import { gatlingProjectBody, seedHttpSettings } from '../../fake-backend/routes/provision.js';
import {
  seedSearchHits,
  seedActiveRuns,
  seedActivity,
  seedAsyncSpec,
  seedTeamMember,
  seedEndpointExtras,
  seedProjectNotes,
} from '../../fake-backend/routes/project.js';
import {
  defaultProtocolConfig,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepTelemetrySource,
} from '../../fake-backend/worlds/sklep.js';
import type { StoredSpec } from '../../fake-backend/routes/setup.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

const PERF = SKLEP_WORLD_IDS.environments.perf;
/** An endpoint whose texts and property names carry credentials only the mask finds. */
function endpointSecrets(fake: Fake): void {
  const endpoint = fake.store
    .collection<{ id: string; spec_id: string }>(SKLEP_COLLECTIONS.endpoints)
    .list()[0];
  if (endpoint === undefined) return;
  fake.store
    .collection(SKLEP_COLLECTIONS.endpoints)
    .update(endpoint.id, { summary: `Call with Authorization: Bearer ${SHAPE_CANARY}` });
  seedEndpointExtras(fake.store, endpoint.id, {
    detail: {
      description: `password: ${BACKEND_CANARY}`,
      responses: [
        {
          status_code: 200,
          content_type: 'application/json',
          description: null,
          example: { token: HEADER_CANARY },
          response_type: 'json',
          schema_def: { type: 'object', properties: { [`api_key=${HEADER_CANARY}`]: {} } },
        },
      ],
    },
    bindings: {
      suggested_assertions: [
        { type: 'body', description: `equals ${BACKEND_CANARY}`, config: { value: HEADER_CANARY } },
      ],
    },
  });
}

/** The settings of the project carry credentials in the base URL and in the user agent. */
function httpSettingsSecrets(fake: Fake): void {
  seedHttpSettings(fake.store, SKLEP_IDS.project, {
    base_url: `https://svc:${BACKEND_CANARY}@api.perf.example.com/v1?token=${HEADER_CANARY}`,
    protocol_config: {
      ...defaultProtocolConfig(),
      user_agent_header: `agent password: ${BACKEND_CANARY}`,
    },
  });
}

/** The project has a log server whose label and address carry credentials. */
function telemetrySecrets(fake: Fake): void {
  const sources = fake.store.collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry);
  const tainted = {
    kind: 'mcp' as const,
    label: `logs password: ${BACKEND_CANARY}`,
    url: `https://logs.example.test/mcp/${HEADER_CANARY}?token=${SHAPE_CANARY}`,
    enabled_tools: [],
  };
  if (sources.get(SKLEP_IDS.project) === undefined) {
    sources.insert({ id: SKLEP_IDS.project, ...tainted });
  } else {
    sources.update(SKLEP_IDS.project, tainted);
  }
}

const MEMBER = '2b6e9c41-0a73-4d58-9e1f-8c3a5d7f0e62';

/** A member of the team whose role, a text of the backend, holds a credential. */
function memberSecrets(fake: Fake): void {
  seedTeamMember(fake.store, SKLEP_IDS.project, {
    id: 'm-canary',
    user_id: MEMBER,
    role: `viewer password: ${BACKEND_CANARY}`,
  });
}

const ASYNC = '8b1f3d57-2a64-4c90-b7e5-1d9a0c6e4f38';

/** The documentation of the project describes itself with a credential only the mask finds. */
function documentationSecrets(fake: Fake): void {
  fake.store.collection(SKLEP_COLLECTIONS.specs).update(SKLEP_WORLD_IDS.spec, {
    description: `Call with Authorization: Bearer ${SHAPE_CANARY}`,
    source_url: `https://user:${BACKEND_CANARY}@docs.example.test/api.yaml?token=${HEADER_CANARY}`,
  });
  seedAsyncSpec(fake.store, SKLEP_IDS.project, {
    id: ASYNC,
    title: 'Events',
    version: '1.0.0',
    description: `Use password: ${BACKEND_CANARY} and Authorization: Bearer ${SHAPE_CANARY}`,
    source_url: `https://docs.example.test/events.yaml?key=${HEADER_CANARY}`,
  });
}

/** The default environment keeps a secret in a header, a variable and the authentication. */
function environmentSecrets(fake: Fake): void {
  fake.store.collection(SKLEP_COLLECTIONS.environments).update(PERF, {
    default_headers: { 'x-api-key': HEADER_CANARY },
    variables: { api_secret: BACKEND_CANARY },
    auth_type: 'bearer',
    auth_config: { token: BACKEND_CANARY },
  });
}

/** The description of the project holds credentials only the mask finds, and a name to match. */
function projectSecrets(fake: Fake): void {
  fake.store.collection(SKLEP_COLLECTIONS.projects).update(SKLEP_IDS.project, {
    description: `Call with Authorization: Bearer ${SHAPE_CANARY}, password: ${BACKEND_CANARY}`,
  });
}

const OLDER_SPEC = '5c2e8a14-7d39-4b60-9f1a-3e6b0d8c4a72';

/** An older stored version whose title and version carry credentials only the mask finds. */
function olderVersionSecrets(fake: Fake): void {
  fake.store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).insert({
    id: OLDER_SPEC,
    title: `Call with Authorization: Bearer ${SHAPE_CANARY}`,
    version: `2.13.0 password: ${BACKEND_CANARY}`,
    description: null,
    created_at: '2026-10-01T09:00:00Z',
    endpoints_count: 20,
    is_active: false,
    is_current: false,
    source_url: null,
  });
}

/** Prefixes saved earlier carry credentials only the mask finds (they come back as the way back). */
function savedPrefixSecrets(fake: Fake): void {
  seedAreaPrefixes(fake.store, SKLEP_IDS.project, [
    `/x/Bearer-${SHAPE_CANARY}`,
    `/y?password=${BACKEND_CANARY}`,
  ]);
}

const SECRET_NOTE = '3f2a9c0b7d4e4a51b8c6d2e1f09a7b34';

/** A note whose text and page carry credentials only the mask finds. */
function noteSecrets(fake: Fake): void {
  seedProjectNotes(fake.store, SKLEP_IDS.project, [
    {
      id: SECRET_NOTE,
      text: `Call with Authorization: Bearer ${SHAPE_CANARY}, password: ${BACKEND_CANARY}`,
      scope: { kind: 'url_path', url_path: `/x?token=${HEADER_CANARY}` },
    },
  ]);
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'project_update_note',
    label: 'a new text over one that held secrets',
    stage: 'project',
    args: () => ({ note_id: SECRET_NOTE, text: 'A clean text.' }),
    setup: noteSecrets,
  },
  {
    tool: 'project_update_note',
    label: 'the same, format data, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ note_id: SECRET_NOTE, text: 'A clean text.', format: 'data' }),
    setup: noteSecrets,
  },
  {
    tool: 'project_set_apimap',
    label: 'new prefixes over saved ones that held secrets',
    stage: 'project',
    args: () => ({ prefixes: '/auth,/orders' }),
    setup: savedPrefixSecrets,
  },
  {
    tool: 'project_set_apimap',
    label: 'back to detected, format data, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ detected: true, format: 'data' }),
    setup: savedPrefixSecrets,
  },
  {
    tool: 'project_set_active_docs',
    label: 'an older version whose title and version held secrets',
    stage: 'project',
    args: () => ({ docs_id: OLDER_SPEC }),
    setup: olderVersionSecrets,
  },
  {
    tool: 'project_set_active_docs',
    label: 'the same, format data, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ docs_id: OLDER_SPEC, format: 'data' }),
    setup: olderVersionSecrets,
  },
  {
    tool: 'project_update',
    label: 'the new name, a description that held secrets',
    stage: 'project',
    args: () => ({ name: 'sklep-renamed' }),
    setup: projectSecrets,
  },
  {
    tool: 'project_update',
    label: 'the new description replaces one that held secrets, format data',
    stage: 'project',
    args: () => ({ description: 'Clean description', format: 'data' }),
    setup: projectSecrets,
  },
  {
    tool: 'project_list_notes',
    label: 'notes of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        { text: 'Accept the cookie banner first.', scope: { kind: 'url_path', url_path: '/' } },
      ]);
    },
  },
  {
    tool: 'project_list_notes',
    label: 'format data, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ format: 'data' }),
    setup: (fake) => {
      seedProjectNotes(fake.store, SKLEP_IDS.project, [
        { text: 'Log in before the cart.', scope: { kind: 'plan_step', plan_step: 'Log in' } },
      ]);
    },
  },
  {
    tool: 'project_get_envs',
    label: 'list of the environments',
    stage: 'project',
    args: () => ({}),
    setup: environmentSecrets,
  },
  {
    tool: 'project_get_envs',
    label: 'the default environment, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ env: 'default' }),
    setup: environmentSecrets,
  },
  {
    tool: 'project_get_envs',
    label: 'one environment by id, format data',
    stage: 'project',
    args: () => ({ env: PERF, format: 'data' }),
    setup: environmentSecrets,
  },
  {
    tool: 'project_get_envs',
    label: 'effective view of the default, format data',
    stage: 'project',
    args: () => ({ env: 'default', effective: true, format: 'data' }),
    setup: environmentSecrets,
  },
  {
    tool: 'project_get_docs',
    label: 'active OpenAPI documentation',
    stage: 'project',
    args: () => ({}),
    setup: documentationSecrets,
  },
  {
    tool: 'project_get_docs',
    label: 'stored OpenAPI versions, names tainted',
    stage: 'project',
    names: true,
    args: () => ({ versions: true }),
    setup: documentationSecrets,
  },
  {
    tool: 'project_get_docs',
    label: 'active AsyncAPI documentation, format data',
    stage: 'project',
    args: () => ({ kind: 'asyncapi', format: 'data' }),
    setup: documentationSecrets,
  },
  {
    tool: 'project_get_docs',
    label: 'one AsyncAPI version by id',
    stage: 'project',
    args: () => ({ kind: 'asyncapi', docs_id: ASYNC }),
    setup: documentationSecrets,
  },
  {
    tool: 'project_get_docs',
    label: 'one OpenAPI version by id',
    stage: 'project',
    args: () => ({ docs_id: SKLEP_WORLD_IDS.spec }),
    setup: documentationSecrets,
  },
  {
    tool: 'project_get_endpoints',
    label: 'list of the endpoints',
    stage: 'project',
    args: () => ({ docs_id: SKLEP_WORLD_IDS.spec, limit: 5 }),
    setup: endpointSecrets,
  },
  {
    tool: 'project_get_endpoints',
    label: 'list, names tainted, format data',
    stage: 'project',
    names: true,
    args: () => ({ docs_id: SKLEP_WORLD_IDS.spec, format: 'data' }),
    setup: endpointSecrets,
  },
  {
    tool: 'project_get_endpoints',
    label: 'one endpoint by operationId with the bindings',
    stage: 'project',
    args: () => ({
      docs_id: SKLEP_WORLD_IDS.spec,
      endpoint: 'POST /auth/login',
      include: ['bindings'],
    }),
    setup: endpointSecrets,
  },
  {
    tool: 'project_get_apimap',
    label: 'map of the API of the project',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      fake.store
        .collection(SKLEP_COLLECTIONS.specs)
        .update(SKLEP_WORLD_IDS.spec, { title: `Shop password: ${BACKEND_CANARY}` });
    },
  },
  {
    tool: 'project_get_apimap',
    label: 'map of the API, names tainted, format data',
    stage: 'project',
    names: true,
    args: () => ({ format: 'data' }),
  },
  {
    tool: 'project_get_http_settings',
    label: 'the HTTP settings with secret headers and a proxy',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      fake.faults.next('GET', `/api/v1/projects/${SKLEP_IDS.project}/gatling/project`, {
        status: 200,
        body: gatlingProjectBody(SKLEP_IDS.project, true, {
          default_headers: { 'x-api-key': HEADER_CANARY },
          protocol_config: {
            ...gatlingProjectBody(SKLEP_IDS.project, true).protocol_config,
            proxy_host: 'proxy.example.test',
            proxy_username: 'svc',
            proxy_password: BACKEND_CANARY,
            user_agent_header: `acme Authorization: Bearer ${SHAPE_CANARY}`,
          },
        }),
      });
    },
  },
  {
    tool: 'project_get_http_settings',
    label: 'the HTTP settings, names tainted, format data',
    stage: 'project',
    names: true,
    args: () => ({ format: 'data' }),
  },
  {
    tool: 'project_list_team',
    label: 'the team of the project, roles tainted',
    stage: 'project',
    names: true,
    args: () => ({}),
    setup: (fake) => {
      seedTeamMember(
        fake.store,
        SKLEP_IDS.project,
        {
          id: 'm1',
          user_id: '3f2a9c1e-7b45-4d68-a0e2-9c1d5b8f3e70',
          role: `owner password: ${BACKEND_CANARY}`,
        },
        true,
      );
    },
  },
  {
    tool: 'project_list_team',
    label: 'the role of the caller, format data',
    stage: 'project',
    args: () => ({ me: true, format: 'data' }),
    setup: (fake) => {
      seedTeamMember(
        fake.store,
        SKLEP_IDS.project,
        { id: 'm1', user_id: '3f2a9c1e-7b45-4d68-a0e2-9c1d5b8f3e70', role: 'owner' },
        true,
      );
    },
  },
  {
    tool: 'project_get_activity',
    label: 'recent events and runs in progress whose names hold credentials',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedActivity(fake.store, [
        {
          id: 'ev1',
          type: 'execution_completed',
          timestamp: '2026-11-27T10:40:00Z',
          project_id: SKLEP_IDS.project,
          project_name: `p password: ${BACKEND_CANARY}`,
          entity_id: '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42',
          entity_name: `Authorization: Bearer ${SHAPE_CANARY}`,
          metadata: { source: 'gatling', status: 'completed' },
          sla_verdict: { status: 'failed', reason: `password=${BACKEND_CANARY}` },
        },
      ]);
      seedActiveRuns(fake.store, [
        {
          id: '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42',
          project_id: SKLEP_IDS.project,
          project_name: `p password=${BACKEND_CANARY}`,
          scenario_name: `Authorization: Bearer ${SHAPE_CANARY}`,
          status: 'running',
          progress: 10,
          started_at: '2026-11-27T11:00:00Z',
          supervised: true,
        },
      ]);
    },
  },
  {
    tool: 'project_list',
    label: 'the projects, names and descriptions that hold credentials',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      const projects = fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.projects);
      projects.update(SKLEP_IDS.project, {
        name: `sklep password: ${BACKEND_CANARY}`,
        description: `Authorization: Bearer ${SHAPE_CANARY}`,
      });
    },
  },
  {
    tool: 'project_list',
    label: 'a search whose hits hold credentials, format data',
    stage: 'project',
    args: () => ({ query: 'flow', format: 'data' }),
    setup: (fake) => {
      seedSearchHits(fake.store, [
        {
          id: 'f1',
          type: 'scenario',
          title: `Flow password: ${BACKEND_CANARY}`,
          subtitle: `Authorization: Bearer ${SHAPE_CANARY}`,
          href: '/flows/f1',
        },
      ]);
    },
  },
  {
    tool: 'project_save_member',
    label: 'the card of a role change whose current role is a text that holds credentials',
    stage: 'project',
    personSaysYes: true,
    args: () => ({ user_id: MEMBER, role: 'editor' }),
    setup: memberSecrets,
  },
  {
    tool: 'project_save_member',
    label: 'a role changed after the yes of the person, the current role tainted',
    stage: 'project',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('project_save_member', { user_id: MEMBER, role: 'editor' });
      return {};
    },
    args: () => ({ user_id: MEMBER, role: 'editor' }),
    setup: memberSecrets,
  },
  {
    tool: 'project_set_http_settings',
    label: 'the card of a settings change whose current user agent and base URL carry credentials',
    stage: 'project',
    personSaysYes: true,
    args: () => ({ base_url: 'https://shop.example.test', protocol: { http2_enabled: true } }),
    setup: httpSettingsSecrets,
  },
  {
    tool: 'project_set_http_settings',
    label: 'a settings change after the yes of the person, the current values tainted',
    stage: 'project',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('project_set_http_settings', {
        base_url: 'https://shop.example.test',
        protocol: { http2_enabled: true },
      });
      return {};
    },
    args: () => ({ base_url: 'https://shop.example.test', protocol: { http2_enabled: true } }),
    setup: httpSettingsSecrets,
  },
  {
    tool: 'project_disconnect_telemetry',
    label: 'the card of a log server whose label and address carry credentials',
    stage: 'project',
    personSaysYes: true,
    names: true,
    args: () => ({}),
    setup: telemetrySecrets,
  },
  {
    tool: 'project_disconnect_telemetry',
    label: 'a log server disconnected after the yes of the person, its label tainted',
    stage: 'project',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('project_disconnect_telemetry', {});
      return {};
    },
    args: () => ({}),
    setup: telemetrySecrets,
  },
];
