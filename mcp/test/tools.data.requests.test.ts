// The test data split into four tools asks LoadCraft for the same thing as the one data call it
// replaced. `fixtures/data-prepare-requests.json` holds the requests the fake backend saw from that
// call (ids as `:id`) for every way through it: the plan of a composition, of a scenario, on a named
// environment and when every slot is filled; a file of accounts, once and twice; and the actions of
// the data hub's plan with the rows of a slot of plain data, for a composition and for a scenario.
//
// The tools are called the way their own results tell: a consent card is confirmed with its token,
// the calls a suggestion lists run in its order and the pin a new dataset names follows it. They
// must send the same writes in the same order and with the same bodies. The pre-flights and the data
// hub's plan save nothing, so they count with the reads: the tools may read more often, since each
// reads what it needs, but no other route. One read is gone on purpose: a file of accounts no longer
// asks the data hub (a model) for the dataset's name, which is now an argument of the call.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CURRENT_TO_TOOLS, TOOL_NAMES, type ToolName } from '../src/catalog.generated.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataCreateDataset } from '../src/tools/dataCreateDataset.js';
import { dataSetBindings } from '../src/tools/dataSetBindings.js';
import { dataSuggestActions } from '../src/tools/dataSuggestActions.js';
import { setFakePlanActions } from './fake-backend/routes/data.js';
import type { FakeCall } from './fake-backend/server.js';
import { SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import {
  ACCOUNTS_CSV,
  BOUND_FILES,
  contentlessSlot,
  DATA_NOW,
  dataWorld,
  hubPlan,
  MORE_ACCOUNTS_CSV,
  type DataWorldOptions,
} from './helpers/dataWorlds.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

interface Request {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/data-prepare-requests.json', import.meta.url), 'utf8'),
) as Readonly<Record<string, readonly Request[]>>;

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
    ...(hasBody
      ? { body: JSON.parse(JSON.stringify(call.body).replace(ID, ':id')) as unknown }
      : {}),
  };
}

/** Requests that save nothing: reads, the pre-flights and the data hub's plan. */
const savesNothing = (request: Request): boolean =>
  request.method === 'GET' ||
  request.path.endsWith('/preflight') ||
  request.path.endsWith('/data-hub/auto-plan');

const writes = (requests: readonly Request[]): Request[] =>
  requests.filter((request) => !savesNothing(request));

const readRoutes = (requests: readonly Request[]): string[] =>
  [
    ...new Set(requests.filter(savesNothing).map((request) => `${request.method} ${request.path}`)),
  ].sort();

const TOOLS = [dataSuggestActions, dataCheckReadiness, dataSetBindings, dataCreateDataset];

interface Step {
  readonly tool: ToolName;
  readonly args: Readonly<Record<string, unknown>>;
}

interface StepsData {
  readonly needsConfirmation?: true;
  readonly confirm?: string;
  readonly steps?: readonly Step[];
  readonly next?: Step;
}

const dataOf = (result: RigCallResult): StepsData =>
  (result.outcome as { data?: StepsData } | undefined)?.data ?? {};

/** One call; a consent card is answered yes by repeating the call with its token. */
async function confirmed(r: ToolRig, step: Step): Promise<RigCallResult> {
  const first = await r.call(step.tool, step.args);
  expect(first.isError, `${step.tool}: ${first.text}`).toBe(false);
  const card = dataOf(first);
  if (card.needsConfirmation !== true) return first;
  expect(card.confirm).toEqual(expect.any(String));
  const done = await r.call(step.tool, { ...step.args, confirm: card.confirm });
  expect(done.isError, `${step.tool}: ${done.text}`).toBe(false);
  expect(dataOf(done).needsConfirmation).toBeUndefined();
  return done;
}

/** A call, then the call its result names next (the pin of a new dataset), when it names one. */
async function withNext(r: ToolRig, step: Step): Promise<void> {
  const result = await confirmed(r, step);
  const next = dataOf(result).next;
  if (next !== undefined) await confirmed(r, next);
}

/** The data hub's suggestion, then every call it lists, in its order. */
async function suggestedCalls(r: ToolRig, scenario: string): Promise<number> {
  const suggestion = await confirmed(r, { tool: 'data_suggest_actions', args: { scenario } });
  const steps = dataOf(suggestion).steps ?? [];
  for (const step of steps) await withNext(r, step);
  return steps.length;
}

const ZAKUPY = SKLEP_WORLD_IDS.scenarios.zakupy;
const PLAIN = { slots: [{ scenario: ZAKUPY, slot: contentlessSlot() }] };
const accounts = (file: string): Step => ({
  tool: 'data_create_dataset',
  args: { scenario: 'checkout', slot: 'accounts', file, name: 'konta' },
});
const readiness = (args: Record<string, unknown>): Step => ({
  tool: 'data_check_readiness',
  args,
});
const suggestion = (args: Record<string, unknown>): Step => ({
  tool: 'data_suggest_actions',
  args,
});

interface Way {
  readonly world: DataWorldOptions;
  /** The data hub answers with the recorded actions (else the fake's own plan). */
  readonly hub?: true;
  /** The single call asked the data hub only for a name, which the call now gives. */
  readonly withoutHub?: true;
  readonly run: (r: ToolRig) => Promise<void>;
}

const WAYS: Readonly<Record<string, Way>> = {
  'plan-composition': {
    world: {},
    run: async (r) => {
      await confirmed(r, readiness({ scenario: 'checkout' }));
      await confirmed(r, suggestion({ scenario: 'checkout' }));
    },
  },
  'plan-qa': {
    world: {},
    run: async (r) => {
      await confirmed(r, readiness({ scenario: 'checkout', environment: 'qa' }));
      await confirmed(r, suggestion({ scenario: 'checkout', environment: 'qa' }));
    },
  },
  'plan-scenario': {
    world: {},
    run: async (r) => {
      await confirmed(r, readiness({ scenario: 'zakupy' }));
      await confirmed(r, suggestion({ scenario: 'zakupy' }));
    },
  },
  'plan-ready': {
    world: { stage: 'data' },
    run: async (r) => {
      await confirmed(r, readiness({ scenario: 'checkout' }));
      await confirmed(r, suggestion({ scenario: 'checkout' }));
    },
  },
  'file-new': {
    world: {},
    withoutHub: true,
    run: async (r) => {
      await withNext(r, accounts('data/konta.csv'));
      await confirmed(r, readiness({ scenario: 'checkout' }));
    },
  },
  'file-twice': {
    world: {},
    withoutHub: true,
    run: async (r) => {
      await withNext(r, accounts('data/konta.csv'));
      await withNext(r, accounts('data/more.csv'));
      await confirmed(r, readiness({ scenario: 'checkout' }));
    },
  },
  'apply-composition': {
    world: PLAIN,
    hub: true,
    run: async (r) => {
      expect(await suggestedCalls(r, 'checkout')).toBe(3);
      await confirmed(r, readiness({ scenario: 'checkout' }));
    },
  },
  'apply-scenario': {
    world: PLAIN,
    run: async (r) => {
      expect(await suggestedCalls(r, 'zakupy')).toBe(1);
      await confirmed(r, readiness({ scenario: 'zakupy' }));
    },
  },
};

describe('test data in four tools: the requests of the single data call', () => {
  it('names the four tools of the migration map, all in the catalog and on the server', () => {
    const four: readonly ToolName[] = [
      'data_suggest_actions',
      'data_check_readiness',
      'data_set_bindings',
      'data_create_dataset',
    ];
    const split = Object.entries(CURRENT_TO_TOOLS).find(
      ([, tools]) => tools.length === four.length && four.every((name) => tools.includes(name)),
    );
    expect(split?.[1]).toEqual(four);
    const listed = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const name of four) {
      expect(TOOL_NAMES).toContain(name);
      expect(listed.has(name)).toBe(true);
    }
  });

  it('covers every recorded way', () => {
    expect(Object.keys(WAYS).sort()).toEqual(Object.keys(RECORDED).sort());
  });

  it.each(Object.keys(WAYS))('%s: the same writes in the same order', async (way) => {
    const spec = WAYS[way];
    if (spec === undefined) throw new Error(way);
    const r = await toolRig({
      tools: TOOLS,
      world: dataWorld(spec.world),
      fake: { meta: { capabilities: ['meta', 'provision_environment'] } },
      clock: createTestClock(DATA_NOW),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: {
        ...BOUND_FILES,
        'data/konta.csv': ACCOUNTS_CSV,
        'data/more.csv': MORE_ACCOUNTS_CSV,
      },
    });
    if (spec.hub === true) setFakePlanActions(r.fake.store, hubPlan(r.fake));
    await spec.run(r);
    const recorded = RECORDED[way] ?? [];
    expect(recorded.length).toBeGreaterThan(0);
    const now = r.fake.calls.map(normalized);
    expect(writes(now)).toEqual(writes(recorded));
    const hubRoute = 'POST /api/v1/projects/:id/data-hub/auto-plan';
    const expectedReads = readRoutes(recorded).filter(
      (route) => spec.withoutHub !== true || route !== hubRoute,
    );
    if (spec.withoutHub === true) expect(readRoutes(recorded)).toContain(hubRoute);
    expect(readRoutes(now)).toEqual(expectedReads);
    r.assertClean();
  });
});
