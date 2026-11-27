// The ways of building a scenario in one place, for the test that compares the requests of
// `scenario_suggest_split` and `scenario_generate` with the recording of the single tool they
// replaced: each way is a world of the fake backend, a step done before (a proposal the generation
// continues from) and the arguments of the call. `requestsOf` runs one way with the tool names it is
// given and returns what the backend saw from that call alone: REST requests (reads included) and the
// messages the client sent over the scenario channel for every generation.

import type { Tool } from '../../src/registry.js';
import { registerCompositionRoutes } from '../fake-backend/routes/compositions.js';
import { registerFlowRoutes } from '../fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import {
  registerScenarioBuilderRoutes,
  scriptBuilderModel,
} from '../fake-backend/routes/scenarioBuilder.js';
import { registerScenarioRoutes } from '../fake-backend/routes/scenarios.js';
import { registerSelfCheckRoutes } from '../fake-backend/routes/selfCheck.js';
import type { Fake, FakeCall } from '../fake-backend/server.js';
import { seedSklep, type SklepStage } from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createTestClock, settleClock } from './clock.js';
import { toolRig, type RigCallResult } from './rig.js';

const NOW = Date.parse('2026-11-22T10:06:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const THREE = ['przeglądanie', 'zakupy', 'konto'];
const SPLIT = { przeglądanie: 40, zakupy: 50, konto: 10 };

export type Way =
  'propose' | 'propose-single' | 'generate-after-proposal' | 'generate-named' | 'generate-existing';

export const WAYS: readonly Way[] = [
  'propose',
  'propose-single',
  'generate-after-proposal',
  'generate-named',
  'generate-existing',
];

/** Which of the two calls a way makes: the proposal of the split or the generation. */
export const PHASE_OF: Readonly<Record<Way, 'propose' | 'generate'>> = {
  propose: 'propose',
  'propose-single': 'propose',
  'generate-after-proposal': 'generate',
  'generate-named': 'generate',
  'generate-existing': 'generate',
};

/** The arguments of the call in each way, the same for the old tool and the new one. */
export const WAY_ARGS: Readonly<Record<Way, Readonly<Record<string, unknown>>>> = {
  propose: { name: 'checkout', flows: THREE },
  'propose-single': { name: 'checkout', flows: ['zakupy'] },
  'generate-after-proposal': {
    name: 'checkout',
    proportions: SPLIT,
    data_mix: 'realistic',
  },
  'generate-named': { name: 'checkout', flows: THREE, proportions: SPLIT },
  'generate-existing': {
    name: 'checkout',
    flows: THREE,
    proportions: { przeglądanie: 30, zakupy: 60, konto: 10 },
  },
};

export interface Request {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface WayRecord {
  /** What differs from the first recording of the single tool, when something does. */
  readonly note?: string;
  readonly requests: readonly Request[];
  /** Messages the client sent over the scenario channel, one list per generation, in order. */
  readonly channel: readonly (readonly unknown[])[];
}

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;

function normalized(call: FakeCall): Request {
  const query = Object.keys(call.query).length === 0 ? {} : { query: call.query };
  const body =
    call.body === undefined || call.body === null
      ? {}
      : { body: JSON.parse(JSON.stringify(call.body).replace(ID, ':id')) as unknown };
  return { method: call.method, path: call.path.replace(ID, ':id'), ...query, ...body };
}

function world(way: Way, hold: { runs: () => string[] }) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerFlowRoutes(fake);
    registerScenarioBuilderRoutes(fake);
    registerSelfCheckRoutes(fake);
    const generation = registerScenarioRoutes(fake);
    hold.runs = () => generation.runs().map((run) => run.runId);
    registerCompositionRoutes(fake);
    const stage: SklepStage = way === 'generate-existing' ? 'scenario' : 'flows';
    seedSklep(fake.store, { stage });
  };
}

/**
 * Runs one way: the proposal before it (when the way continues from one) through `tools.propose`,
 * then the call of the way through the tool of its phase. Returns what the backend saw from that
 * call alone.
 */
export async function requestsOf(
  way: Way,
  names: { readonly propose: string; readonly generate: string },
  tools: readonly Tool[],
): Promise<{ result: RigCallResult; record: WayRecord }> {
  const clock = createTestClock(NOW);
  const hold = { runs: (): string[] => [] };
  const r = await toolRig({
    tools,
    world: world(way, hold),
    clock,
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
  });
  scriptBuilderModel(r.fake, [
    { flow: 'przeglądanie', proportion: 60 },
    { flow: 'zakupy', proportion: 30 },
    { flow: 'konto', proportion: 10 },
  ]);
  if (way === 'generate-after-proposal') {
    const proposed = await r.call(names.propose, WAY_ARGS.propose);
    if (proposed.isError) throw new Error(`the proposal failed: ${proposed.text}`);
  }
  const from = r.fake.calls.length;
  const phase = PHASE_OF[way];
  const result = await settleClock(r, r.call(names[phase], WAY_ARGS[way]), {
    stepMs: 1000,
    limitMs: 600_000,
  });
  const requests = r.fake.calls.slice(from).map(normalized);
  const channel = hold
    .runs()
    .map(
      (runId) =>
        JSON.parse(
          JSON.stringify(r.fake.channel('scenario', { run_id: runId }).received).replace(ID, ':id'),
        ) as unknown[],
    );
  return { result, record: { requests, channel } };
}
