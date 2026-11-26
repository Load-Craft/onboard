// The worlds of the test data tools: the shop at the scenario stage (a composition `checkout` of
// three scenarios, one slot of accounts and two of plain data), with or without a slot of plain data
// the generation left without rows, and the files a call reads. Shared by the tests of the data
// tools and by the comparison with the requests of the single data call they replaced.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { registerCompositionRoutes } from '../fake-backend/routes/compositions.js';
import { registerDataRoutes, seedAutoDatasets } from '../fake-backend/routes/data.js';
import { registerLookupRoutes } from '../fake-backend/routes/lookup.js';
import { registerProvisionRoutes } from '../fake-backend/routes/provision.js';
import type { Fake } from '../fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
  type SklepScenario,
  type SklepSlot,
  type SklepStage,
} from '../fake-backend/worlds/sklep.js';
import type { Tool } from '../../src/registry.js';
import { SKLEP_IDS } from '../golden/index.js';
import { createTestClock } from './clock.js';
import { CANARY, toolRig, type RigCallResult, type ToolRig } from './rig.js';

export const DATA_NOW = Date.parse('2026-11-22T10:30:00Z');

export const BOUND_FILES = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

// Passwords made of the canary: any copy of them in an output is caught by `assertClean` as well.
export const PASSWORD_1 = `Pw-${CANARY}-1`;
export const PASSWORD_2 = `Pw,"${CANARY}"-2`;
export const ACCOUNTS_CSV = [
  'Email,Password,Note',
  `anna@example.com,${PASSWORD_1},first`,
  `jan@example.com,"Pw,""${CANARY}""-2",second`,
  '',
].join('\n');
export const MORE_ACCOUNTS_CSV = `email,password\nzoe@example.com,${PASSWORD_1}\n`;

/** Key of a slot of plain data the generation of the scenario left without rows. */
export const PLAIN_SLOT = 'scenario_auto_data';
export const PLAIN_COLUMNS = ['couponCode', 'email', 'notes'];

/** A slot of plain data whose rows the generation did not make (`generated: false`). */
export const contentlessSlot = (columns: readonly string[] = PLAIN_COLUMNS): SklepSlot => ({
  slot: PLAIN_SLOT,
  label: 'Coupon & email & notes',
  columns: [...columns],
  strategy: 'circular',
  column_specs: columns.map((name) => ({ name, type: name === 'email' ? 'email' : 'string' })),
  identity_kind: null,
  default_file: `${PLAIN_SLOT}.csv`,
  role: 'data',
  generated: false,
  generated_rows: null,
});

/** Adds the slot to a scenario of the world (the composition `checkout` runs przeglądanie first). */
export function addSlot(fake: Fake, scenarioId: string, slot: SklepSlot): void {
  const scenarios = fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
  const scenario = scenarios.require(scenarioId);
  scenarios.update(scenarioId, { feeder_slots: [...scenario.feeder_slots, slot] });
}

export interface DataWorldOptions {
  readonly stage?: SklepStage;
  /** Slots added to scenarios of the world after it is seeded. */
  readonly slots?: readonly { readonly scenario: string; readonly slot: SklepSlot }[];
}

/** The world of the data tools: lookups, slots and datasets, the writes of datasets and picks. */
export function dataWorld(options: DataWorldOptions = {}) {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerDataRoutes(fake);
    registerProvisionRoutes(fake);
    registerCompositionRoutes(fake);
    seedSklep(fake.store, { stage: options.stage ?? 'scenario' });
    seedAutoDatasets(fake.store);
    for (const { scenario, slot } of options.slots ?? []) addSlot(fake, scenario, slot);
  };
}

/** The actions the data hub proposes in the recorded way `apply-composition`. */
export function hubPlan(fake: Fake): Record<string, unknown>[] {
  const first = fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list()[0];
  return [
    { kind: 'bind', slot: 'search_phrases', dataset_id: SKLEP_WORLD_IDS.feeders.frazy },
    {
      kind: 'create_dataset',
      name: 'rozmiary',
      bind_to_slot: 'order_details',
      row_count: 300,
      recipe: {
        columns: [{ column_name: 'size', generation_hint: 'enum', enum_values: ['S', 'M'] }],
        sample_rows: [],
      },
    },
    {
      kind: 'create_dataset',
      name: 'konta',
      bind_to_slot: 'accounts',
      row_count: 2000,
      recipe: {
        columns: [
          { column_name: 'email', generation_hint: 'faker:email' },
          { column_name: 'password', generation_hint: 'faker:password' },
        ],
        sample_rows: [{ email: 'a@example.com', password: PASSWORD_1 }],
      },
    },
    { kind: 'provision_accounts', dataset_id: first?.id ?? 'x', count: 2000 },
    { kind: 'bind', slot: 'accounts', dataset_id: 'gone-dataset' },
  ];
}

/** A check of the data step as the process in the state file holds it. */
export function dataCheck(workspace: string, projectId: string, name: string): unknown {
  const state = JSON.parse(
    readFileSync(join(workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as {
    process: Record<string, { steps: Record<string, { checks: Record<string, unknown> }> }>;
  };
  return state.process[projectId]?.steps['data']?.checks[name];
}

export interface DataRigOptions extends DataWorldOptions {
  readonly tools: readonly Tool[];
  readonly locale?: 'en' | 'pl';
  readonly files?: Readonly<Record<string, string>>;
}

/** A rig of the data tools on the shop, bound to its project, with the files of accounts. */
export async function dataRig(options: DataRigOptions): Promise<ToolRig> {
  return toolRig({
    tools: options.tools,
    world: dataWorld(options),
    fake: { meta: { capabilities: ['meta', 'provision_environment'] } },
    clock: createTestClock(DATA_NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      ...BOUND_FILES,
      'data/konta.csv': ACCOUNTS_CSV,
      'data/more.csv': MORE_ACCOUNTS_CSV,
      ...options.files,
    },
  });
}

/** The data of a result (its structured content). */
export const dataOf = <T>(result: RigCallResult): T | undefined =>
  (result.outcome as { data?: T } | undefined)?.data;

/** A call and, when it answered with a consent card, its repeat with the card's token. */
export async function callConfirmed(
  r: ToolRig,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ readonly card?: RigCallResult; readonly result: RigCallResult }> {
  const first = await r.call(tool, args);
  const card = first.isError
    ? undefined
    : dataOf<{ needsConfirmation?: boolean; confirm?: string }>(first);
  if (card?.needsConfirmation !== true) return { result: first };
  return { card: first, result: await r.call(tool, { ...args, confirm: card.confirm }) };
}

/** Requests that changed something at the backend (the pre-flights and the data hub's plan excluded). */
export const writesOf = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.method !== 'GET' && !call.path.endsWith('/preflight'))
    .filter((call) => !call.path.endsWith('/auto-plan'))
    .map((call) => `${call.method} ${call.path.replace(SKLEP_IDS.project, ':p')}`);
