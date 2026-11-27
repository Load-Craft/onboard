// Flow reads over real HTTP against the fake backend seeded with the world "sklep".

import { describe, expect, it } from 'vitest';

import { flowQuestions, getFlow, listFlows } from '../src/api/flows.js';
import { loadConfig } from '../src/config.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import type { SecretApiContext } from '../src/api/context.js';
import { createHttp } from '../src/http/client.js';
import { createLinks } from '../src/links.js';
import type { components } from '../src/http/generated/api.js';
import { createLogger } from '../src/log.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { noopSecretScope } from './helpers/scope.js';
import { FLOW_COLLECTIONS, registerFlowRoutes } from './fake-backend/routes/flows.js';
import { startFake, type Fake } from './fake-backend/server.js';
import { SKLEP_WORLD_IDS, seedSklep } from './fake-backend/worlds/sklep.js';

type FlowDetail = components['schemas']['FlowDetail'];

const PROJECT = SKLEP_WORLD_IDS.project;
const ZAKUPY = SKLEP_WORLD_IDS.flowZakupy;

async function setup(): Promise<{ fake: Fake; api: SecretApiContext }> {
  const clock = createTestClock();
  const fake = await startFake({ clock });
  seedSklep(fake.store, { stage: 'flows' });
  registerFlowRoutes(fake);
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
    '/tmp',
  );
  const http = createHttp(config, createLogger({ level: 'error', sink: () => undefined }), {
    clock,
  });
  const api = {
    services: { http, links: createLinks(config.appUrl) },
    signal: new AbortController().signal,
    secrets: noopSecretScope(),
  };
  return { fake, api };
}

async function failure(promise: Promise<unknown>): Promise<LoadcraftApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LoadcraftApiError);
  return error as LoadcraftApiError;
}

describe('getFlow', () => {
  it('returns the flow with its raw blocks and edges', async () => {
    const { fake, api } = await setup();
    const flow = await getFlow(api, PROJECT, ZAKUPY);
    expect(flow.id).toBe(ZAKUPY);
    expect(flow.name).toBe('zakupy');
    expect(flow.blocks).toHaveLength(7);
    expect(flow.edges).toHaveLength(6);
    expect(fake.calls.at(-1)?.path).toBe(`/api/v1/projects/${PROJECT}/flows/${ZAKUPY}`);
  });

  it('a flow of another project is a 404 with the backend text', async () => {
    const { fake, api } = await setup();
    const flows = fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
    flows.update(ZAKUPY, { project_id: 'other-project' });
    const error = await failure(getFlow(api, PROJECT, ZAKUPY));
    expect(error.status).toBe(404);
    expect(error.message).toContain(`Flow ${ZAKUPY} not found in project ${PROJECT}`);
  });
});

describe('listFlows', () => {
  it('lists the project flows, newest first, asking for the backend maximum', async () => {
    const { fake, api } = await setup();
    const flows = await listFlows(api, PROJECT);
    expect(flows.map((flow) => flow.name).sort()).toEqual(['konto', 'przeglądanie', 'zakupy']);
    expect(flows.find((flow) => flow.id === ZAKUPY)?.step_count).toBe(7);
    expect(fake.calls.at(-1)?.query).toEqual({ limit: '100' });
  });

  it('passes tags as a repeated query parameter', async () => {
    const { fake, api } = await setup();
    fake.store
      .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
      .update(SKLEP_WORLD_IDS.flowKonto, { tags: ['login'] });
    const flows = await listFlows(api, PROJECT, { tags: ['login'] });
    expect(flows.map((flow) => flow.name)).toEqual(['konto']);
    expect(fake.calls.at(-1)?.query).toEqual({ limit: '100', tags: 'login' });
  });

  it('an unknown project is a 404', async () => {
    const { api } = await setup();
    const error = await failure(listFlows(api, 'missing-project'));
    expect(error.status).toBe(404);
  });
});

describe('flowQuestions', () => {
  it('reads the generator questions from needs_input of the flow detail', async () => {
    const { fake, api } = await setup();
    fake.store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(ZAKUPY, {
      needs_input: [
        {
          field: 'auth.token',
          question: 'Which account logs in?',
          why: 'The login needs credentials.',
          kind: 'auth',
          definite: false,
          steps: [],
        },
        { field: 'blank', kind: 'obstacle', question: '', why: '', definite: false, steps: [] },
        {
          field: 'status',
          question: 'Which statuses end the poll?',
          why: '',
          kind: 'poll_status',
          definite: false,
          steps: [],
        },
        {
          field: 'Checkout',
          question: 'Which token?',
          why: 'Another scheme.',
          kind: null,
          kind_raw: 'future_kind',
          definite: true,
          steps: ['Checkout'],
        },
      ],
    });
    const flow = await getFlow(api, PROJECT, ZAKUPY);
    expect(flowQuestions(flow)).toEqual([
      {
        field: 'auth.token',
        question: 'Which account logs in?',
        why: 'The login needs credentials.',
        kind: 'auth',
      },
      { field: 'status', question: 'Which statuses end the poll?', why: '', kind: 'poll_status' },
      {
        field: 'Checkout',
        question: 'Which token?',
        why: 'Another scheme.',
        kind: 'future_kind',
        steps: ['Checkout'],
        definite: true,
      },
    ]);
    expect(fake.calls.some((call) => call.path.includes('/versions/'))).toBe(false);
  });

  it('a flow without items gives no questions', async () => {
    const { api } = await setup();
    expect(flowQuestions(await getFlow(api, PROJECT, ZAKUPY))).toEqual([]);
  });
});
