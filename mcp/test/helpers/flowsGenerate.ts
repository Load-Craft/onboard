// The ways of building flows in one place, for the test that compares the requests of the three
// `flows_generate_*` tools with the recording of the single tool they replaced: each way is a world
// of the fake backend, a step done before the build (proposals suggested, a recording imported) and
// the arguments of the build. `requestsOf` runs one way with the tool it is given and returns what
// the backend saw from the build alone: REST requests and the messages of the HAR channel.

import { readFileSync } from 'node:fs';

import type { components } from '../../src/http/generated/api.js';
import type { Tool } from '../../src/registry.js';
import { registerBatchGenerateRoute } from '../fake-backend/routes/batch.js';
import { registerFlowGenerationRoutes } from '../fake-backend/routes/flowGeneration.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import {
  HAR_SESSIONS,
  registerHarRoutes,
  type HarSessionRecord,
} from '../fake-backend/routes/har.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import {
  registerOpenapiReadRoute,
  registerSuggestionRoutes,
  SKLEP_SUGGESTIONS,
} from '../fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from '../fake-backend/server.js';
import { createIdSource, createStore } from '../fake-backend/store.js';
import { seedSklep, SKLEP_COLLECTIONS } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createTestClock, settleClock } from './clock.js';
import { toolRig, type RigCallResult } from './rig.js';

type FlowDetail = components['schemas']['FlowDetail'];

const NOW = Date.parse('2026-11-22T09:00:00Z');
const RECORDING = 'nagrania/sesja.har';
const HOST = 'https://perf.example.com';
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

export type Way = 'suggestions' | 'endpoints' | 'har-one' | 'har-split' | 'har-split-imported';

export const WAYS: readonly Way[] = [
  'suggestions',
  'endpoints',
  'har-one',
  'har-split',
  'har-split-imported',
];

/** The arguments of the build in each way, the same for the old tool and the new one. */
export const WAY_ARGS: Readonly<Record<Way, Readonly<Record<string, unknown>>>> = {
  suggestions: { suggestions: ['zakupy', 'przeglądanie', 'konto'] },
  endpoints: {
    name: 'zakupy',
    description: 'Log in, search the shop, put an item in the cart and pay for it',
    endpoints: [
      'POST /auth/login',
      'GET /products',
      'post:/cart/items',
      'GET /cart',
      'POST /checkout',
    ],
  },
  'har-one': { har: RECORDING, split: false, name: 'zakupy' },
  'har-split': { har: RECORDING, split: true },
  'har-split-imported': { har: RECORDING, split: true, paths: ['konto', ' Zakupy '] },
};

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface WayRecord {
  readonly requests: readonly Request[];
  /** Messages the client sent over the HAR channel (none for the other ways). */
  readonly channel: readonly unknown[];
}

function fixture(name: string): FlowDetail {
  const url = new URL(`../fixtures/flows/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as FlowDetail;
}

function recording(): string {
  const entry = (method: string, path: string, body: unknown) => ({
    request: { method, url: `${HOST}${path}`, headers: [] },
    response: { status: 200, content: { size: 120, text: JSON.stringify(body) } },
  });
  return JSON.stringify({
    log: {
      version: '1.2',
      entries: [
        entry('POST', '/auth/login', { token: 't-1' }),
        entry('GET', '/products', { items: [] }),
        entry('POST', '/cart/items', { cartId: 'cart-7731' }),
        entry('POST', '/checkout', { ok: true }),
        entry('GET', '/categories', { items: [] }),
        entry('GET', '/orders', { items: [] }),
      ],
    },
  });
}

function run4Flows(): Record<string, FlowDetail> {
  const store = createStore(createIdSource(1));
  seedSklep(store, { stage: 'flows' });
  const flows = store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).list();
  const named = (name: string): FlowDetail => {
    const found = flows.find((flow) => flow.name === name);
    if (found === undefined) throw new Error(`no flow ${name}`);
    return found;
  };
  return {
    zakupy: { ...fixture('zakupy-run4-har'), id: SKLEP_IDS.flowZakupy },
    przeglądanie: named('przeglądanie'),
    konto: named('konto'),
  };
}

const JOURNEYS = [
  {
    name: 'zakupy',
    steps: ['POST /auth/login', 'GET /products', 'POST /cart/items', 'POST /checkout'],
  },
  { name: 'przeglądanie', steps: ['GET /categories', 'GET /products'] },
  { name: 'konto', steps: ['POST /auth/login', 'GET /orders'] },
];

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
/** The unique tag every basket of a batch carries is random: only its shape is compared. */
const TAG = /"mcp-[0-9a-f]{12}"/gu;

function normalized(call: FakeCall): Request {
  const query = Object.keys(call.query).length === 0 ? {} : { query: call.query };
  const body =
    call.body === undefined || call.body === null
      ? {}
      : { body: JSON.parse(JSON.stringify(call.body).replace(TAG, '"mcp-:tag"')) as unknown };
  return { method: call.method, path: call.path.replace(ID, ':id'), ...query, ...body };
}

function world(way: Way, clock: ReturnType<typeof createTestClock>) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerFlowRoutes(fake);
    if (way === 'suggestions') {
      registerSuggestionRoutes(fake, { ...SKLEP_SUGGESTIONS, cached: true });
      registerBatchGenerateRoute(
        fake,
        { plans: [{ name: 'zakupy', flow: fixture('zakupy-run1') }] },
        clock,
      );
    } else if (way === 'endpoints') {
      registerOpenapiReadRoute(fake);
      registerFlowGenerationRoutes(
        fake,
        { flow: { ...fixture('zakupy-run2-reczne'), id: SKLEP_IDS.flowZakupy } },
        clock,
      );
    } else {
      registerHarRoutes(fake, {
        clock,
        generate:
          way === 'har-one'
            ? {
                journeys: JOURNEYS,
                flows: { '*': { ...fixture('zakupy-run4-har'), id: SKLEP_IDS.flowZakupy } },
              }
            : { journeys: JOURNEYS, flows: run4Flows() },
      });
    }
    seedSklep(fake.store, { stage: 'project' });
  };
}

/**
 * Runs one way: the step before (when the way has one) through `before`, then the build through
 * `tool` with the arguments of the way. Returns what the backend saw from the build alone.
 */
export async function requestsOf(
  way: Way,
  tool: string,
  tools: readonly Tool[],
): Promise<{ result: RigCallResult; record: WayRecord }> {
  const clock = createTestClock(NOW);
  const har = way.startsWith('har');
  const r = await toolRig({
    tools,
    world: world(way, clock),
    fake: { meta: { capabilities: ['meta', 'api_token_sockets'] } },
    // The work of a HAR build goes on in the process after a call returns, as in the real server.
    processServices: har,
    clock,
    env: { LOADCRAFT_LOCALE: 'en' },
    files: { ...BOUND, ...(har ? { [RECORDING]: recording() } : {}) },
  });
  if (way === 'suggestions') {
    const suggested = await r.call('flows_suggest_journeys', {});
    if (suggested.isError) throw new Error(`flows_suggest_journeys failed: ${suggested.text}`);
  }
  if (way === 'har-split-imported') {
    const imported = await r.call('flows_import_har', { file: RECORDING });
    if (imported.isError) throw new Error(`flows_import_har failed: ${imported.text}`);
  }
  const from = r.fake.calls.length;
  const result = await settleClock(r, r.call(tool, WAY_ARGS[way]), {
    stepMs: har ? 5000 : 1000,
    limitMs: 600_000,
  });
  const requests = r.fake.calls.slice(from).map(normalized);
  let channel: readonly unknown[] = [];
  if (har) {
    const [session] = r.fake.store.collection<HarSessionRecord>(HAR_SESSIONS).list();
    if (session !== undefined) {
      channel = r.fake.channel('har', {
        project_id: SKLEP_IDS.project,
        session_id: session.id,
      }).received;
    }
  }
  return { result, record: { requests, channel } };
}
