// `data_generate_dataset` (module data) on a consent card and the block of a long operation: a card for a flow, a
// scenario or one slot; a flow is a run (`dataset_generation`) followed on the channel `gatlingFeeder`, joined
// after the start (the backend names the run in its answer), with the list of datasets as the way back when the
// `complete` frame is lost; a scenario and a slot are one request. Fake backend over HTTP and WebSocket, test clock.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { dataGenerateDataset } from '../../../src/tools/data/generateDataset.js';
import { processCancel } from '../../../src/tools/processCancel.js';
import { processWait } from '../../../src/tools/processWait.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { State } from '../../../src/workspace/processState.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import {
  scriptFeederGeneration,
  startedRuns,
  type FeederGenerationScript,
} from '../../fake-backend/routes/dataGenerate.js';
import type { Fake } from '../../fake-backend/server.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepFeeder,
  type SklepScenario,
} from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { createTestClock, settleClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

const TOOL = 'data_generate_dataset';
const PROJECT = SKLEP_IDS.project;
const FLOW = SKLEP_IDS.flowZakupy;
const SCENARIO = SKLEP_WORLD_IDS.scenarios.zakupy;
const NOW = '2026-11-27T12:00:00.000Z';
const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

function stateFile(flows: string[] = [], scenarios: Record<string, string> = {}): string {
  const empty = newProcess(PROJECT, NOW);
  const state = {
    schema: 3,
    process: {
      [PROJECT]: {
        ...empty,
        ids: { ...empty.ids, flow_ids: flows, scenario_ids: scenarios },
      },
    },
  };
  State.parse(state);
  return JSON.stringify(state);
}

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly script?: FeederGenerationScript;
  readonly flows?: string[];
  readonly scenarios?: Record<string, string>;
  readonly edit?: (fake: Fake) => void;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: [dataGenerateDataset, processWait, processCancel],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      if (options.script !== undefined) scriptFeederGeneration(fake, options.script);
      options.edit?.(fake);
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': stateFile(options.flows, options.scenarios),
    },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

const FLOW_ARGS = { flow_id: FLOW, rows: 40, name: 'Shop customers' } as const;
const SLOT_ARGS = { scenario_id: SCENARIO, slot: 'search_phrases', rows: 25 } as const;

/** The card, then the repeat after the person's yes, with the test clock moving until the call settles. */
async function go(
  r: ToolRig,
  args: Record<string, unknown> = FLOW_ARGS,
  seconds = 300,
): Promise<RigCallResult> {
  const card = await r.call(TOOL, args);
  expect(card.isError, card.text).toBe(false);
  return settleClock(r, r.call(TOOL, args), { limitMs: seconds * 1000 });
}

const posts = (r: ToolRig, tail: string): string[] =>
  r.fake.calls
    .filter((call) => call.method === 'POST' && call.path.endsWith(tail))
    .map((call) => call.path);

const feeders = (r: ToolRig) =>
  r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();

interface Saved {
  operations: { handle: string; kind: string; status: string }[];
  ids: { dataset_ids: string[] };
  log: {
    tool: string;
    args: string;
    result: string;
    status: string;
    undo?: unknown;
    consent?: { via: string };
  }[];
}

function saved(r: ToolRig): Saved {
  const raw = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const process = (JSON.parse(raw) as { process: Record<string, Saved> }).process[PROJECT];
  if (process === undefined) throw new Error('no process in the state file');
  return process;
}

describe('data_generate_dataset: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(dataGenerateDataset);
    expect(dataGenerateDataset.implemented).toBe(true);
    expect(dataGenerateDataset.onCard).toBe(true);
  });

  it('the first call makes the card for a flow, a scenario or a slot, sends nothing and asks nobody', async () => {
    const who = person();
    const r = await rig({ who });
    const flow = await r.call(TOOL, FLOW_ARGS);
    expect(flow.text).toContain('Generate a dataset with AI for the flow zakupy');
    expect(flow.text).toContain('Rows: 40, file type csv');
    expect(flow.text).toContain('The new dataset is named Shop customers');
    expect(flow.text).toContain('about one LLM generation per dataset');
    const scenario = await r.call(TOOL, { scenario_id: SCENARIO, rows: 10 });
    expect(scenario.text).toContain('for the scenario zakupy');
    expect(scenario.text).toContain('The new dataset is named AI data for zakupy');
    const slot = await r.call(TOOL, SLOT_ARGS);
    expect(slot.text).toContain('for the slot search_phrases of the scenario zakupy');
    expect(slot.text).toContain('named by LoadCraft after the slot');
    expect(writesOf(r, PROJECT)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(feeders(r)).toHaveLength(
      r.fake.store.collection(SKLEP_COLLECTIONS.feeders).list().length,
    );
  });

  it('takes the target by name, or the only flow or scenario of the workspace', async () => {
    const r = await rig();
    expect((await r.call(TOOL, { flow_id: 'zakupy', rows: 5 })).text).toContain('flow zakupy');
    const withFlow = await rig({ flows: [FLOW] });
    expect((await withFlow.call(TOOL, { rows: 5 })).text).toContain('flow zakupy');
    const withScenario = await rig({ scenarios: { [FLOW]: SCENARIO } });
    expect((await withScenario.call(TOOL, { rows: 5 })).text).toContain('scenario zakupy');
    expect((await withScenario.call(TOOL, { slot: 'search_phrases' })).text).toContain(
      'slot search_phrases',
    );
    const none = await rig();
    expect((await none.call(TOOL, { rows: 5 })).text).toMatch(/^\[missing_argument\] /u);
  });

  it('arguments that do not fit together are refused before any request', async () => {
    const r = await rig();
    for (const args of [
      { flow_id: FLOW, scenario_id: SCENARIO },
      { flow_id: FLOW, slot: 'search_phrases' },
      { scenario_id: SCENARIO, slot: 'search_phrases', name: 'x' },
      { max_wait_s: 10, flow_id: FLOW },
      { flow_id: FLOW, confirm: true },
      { flow_id: FLOW, rows: 0 },
      { flow_id: FLOW, rows: 100001 },
      { flow_id: FLOW, feeder_type: 'xml' },
    ]) {
      expect((await r.call(TOOL, args)).isError, JSON.stringify(args)).toBe(true);
    }
    const both = await r.call(TOOL, { flow_id: FLOW, scenario_id: SCENARIO });
    expect(both.text).toMatch(/^\[invalid_arguments\] /u);
    expect(both.text).toContain('flow_id or scenario_id, not both');
    expect(writesOf(r, PROJECT)).toEqual([]);
  });

  it('a target the project does not have is not_found on the card, before any question', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { flow_id: 'no such flow' });
    expect(result.text).toMatch(/^\[not_found\] /u);
    expect(who.asked).toEqual([]);
  });

  it('declined, unticked and cancelled generate nothing', async () => {
    for (const answer of ['declined', 'unticked', 'cancelled'] as const) {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, FLOW_ARGS);
      expect((await r.call(TOOL, FLOW_ARGS)).text).toMatch(/^\[consent_missing\] /u);
      expect(posts(r, '/generate-async')).toEqual([]);
    }
  });
});

describe('data_generate_dataset: a flow (a run)', () => {
  it('after the yes starts one run, follows its progress and ends with the dataset, in the list of the state', async () => {
    const r = await rig();
    const result = await go(r);
    expect(result.isError, result.text).toBe(false);
    expect(startedRuns(r.fake)).toHaveLength(1);
    const body = r.fake.calls.find((call) => call.path.endsWith('/generate-async'))?.body;
    expect(body).toMatchObject({
      name: 'Shop customers',
      feeder_type: 'csv',
      record_count: 40,
      override_record_count: true,
      flow_id: FLOW,
    });
    expect(result.text.split('\n')).toEqual([
      'Generated the dataset Shop customers: 40 rows, 3 columns.',
      'Columns: name, email, city',
      'To remove it: data_delete with this dataset (it asks the user).',
    ]);
    const made = feeders(r).find((feeder) => feeder.name === 'Shop customers');
    expect(saved(r).ids.dataset_ids).toContain(made?.id);
    const lines = result.progress.map((entry) => entry.message ?? '');
    expect(lines).toEqual(
      expect.arrayContaining([
        'Starting the dataset generation',
        'Dataset generation: generating the rows (35%)',
        'Dataset generation: formatting (70%)',
      ]),
    );
  });

  it('logs the call with the templates of the catalog and the undo that removes the new dataset', async () => {
    const r = await rig();
    await go(r);
    const log = saved(r).log;
    expect(log.map((entry) => [entry.args, entry.result, entry.status])).toEqual([
      ['Generate a dataset with AI for zakupy', "awaiting the user's decision", 'queued'],
      ['Generate a dataset with AI for zakupy', 'dataset Shop customers: 40 rows', 'ok'],
    ]);
    expect(log.at(-1)?.consent).toEqual({ via: 'client_dialog' });
    const made = feeders(r).find((feeder) => feeder.name === 'Shop customers');
    expect(JSON.stringify(log.at(-1)?.undo)).toContain(made?.id ?? 'x');
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'dataset_generation')
        .map((row) => row.status),
    ).toEqual(['done']);
  });

  it('a frame lost before the connect does not lose the run: the list of datasets gives it back', async () => {
    // the run ends inside the request that starts it: the `complete` frame goes out before the channel is joined
    const r = await rig({ script: { endMs: 0 } });
    const result = await go(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Generated the dataset Shop customers: 40 rows');
    expect(posts(r, '/generate-async')).toHaveLength(1);
  });

  it('a lost channel falls back to the list too', async () => {
    const r = await rig({ script: { endMs: 5000 } });
    r.fake.faults.blockWebSocket();
    const result = await go(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Generated the dataset Shop customers');
  });

  it('a long run past the limit of one call returns the handle; process_wait finishes it with the same view', async () => {
    const r = await rig({ script: { endMs: 150_000 } });
    const first = await go(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const handle = (first.outcome as { operation: string }).operation;
    expect(handle).toMatch(/^dataset_generation:[0-9a-f-]{36}$/u);
    expect(feeders(r).some((feeder) => feeder.name === 'Shop customers')).toBe(true);
    const done = await settleClock(r, r.call('process_wait', { operation: handle }), {
      limitMs: 300_000,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('Generated the dataset Shop customers: 40 rows');
  });

  it('the same work asked again while it runs goes on with the same run: one request starts it', async () => {
    const r = await rig({ script: { endMs: 150_000 } });
    const first = await go(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const again = await go(r);
    expect(again.isError, again.text).toBe(false);
    expect(again.text).toContain('Generated the dataset');
    expect(posts(r, '/generate-async')).toHaveLength(1);
  });

  it('an error frame is the code of the module with its cause; nothing is saved and the row fails', async () => {
    const r = await rig({
      script: { endMs: 2000, outcome: { error: 'The flow has no steps that need data' } },
    });
    const result = await go(r);
    expect(result.text).toMatch(/^\[data_generate_failed\] /u);
    expect(result.text).toContain('The flow has no steps that need data');
    expect(saved(r).ids.dataset_ids).toEqual([]);
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'dataset_generation')
        .map((row) => row.status),
    ).toEqual(['failed']);
  });

  it('the backend cannot stop a run: process_cancel says the operation cannot be cancelled', async () => {
    const r = await rig({ script: { endMs: 150_000 } });
    const first = await go(r);
    const handle = (first.outcome as { operation: string }).operation;
    const result = await r.call('process_cancel', { operation: handle });
    expect(result.text).toMatch(/^\[not_cancellable\] /u);
  });
});

describe('data_generate_dataset: a scenario and a slot (one request)', () => {
  it('a scenario: one request after the yes, the dataset at once', async () => {
    const r = await rig();
    const result = await go(r, {
      scenario_id: SCENARIO,
      rows: 12,
      name: 'Scenario data',
      feeder_type: 'tsv',
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Generated the dataset Scenario data: 12 rows');
    expect(posts(r, '/generate-from-scenario')).toHaveLength(1);
    expect(posts(r, '/generate-async')).toEqual([]);
    const body = r.fake.calls.find((call) => call.path.endsWith('/generate-from-scenario'))?.body;
    expect(body).toMatchObject({
      scenario_id: SCENARIO,
      name: 'Scenario data',
      output_type: 'tsv',
      row_count: 12,
    });
    expect(saved(r).ids.dataset_ids).toHaveLength(1);
  });

  it('a slot: one request, named by LoadCraft after the slot; a repeat refreshes that dataset', async () => {
    const r = await rig();
    const first = await go(r, SLOT_ARGS);
    expect(first.text).toContain('Generated the dataset search_phrases data: 25 rows');
    const second = await go(r, { ...SLOT_ARGS, rows: 30 });
    expect(second.text).toContain('Refreshed the dataset search_phrases data of the slot: 30 rows');
    expect(posts(r, '/generate-feeder')).toHaveLength(2);
    const body = r.fake.calls.find((call) => call.path.endsWith('/generate-feeder'))?.body;
    expect(body).toMatchObject({ row_count: 25, enrich_with_llm: true });
  });

  it('a slot the backend refuses to invent (accounts) is the error of the backend, nothing saved', async () => {
    const r = await rig();
    const result = await go(r, { scenario_id: SCENARIO, slot: 'accounts' });
    expect(result.isError).toBe(true);
    expect(saved(r).ids.dataset_ids).toEqual([]);
  });
});

describe('data_generate_dataset: texts and secrets', () => {
  it('speaks Polish', async () => {
    const r = await rig({ locale: 'pl' });
    const card = await r.call(TOOL, FLOW_ARGS);
    expect(card.text).toContain('Wygeneruj zbiór danych przez AI dla flow zakupy');
    const result = await settleClock(r, r.call(TOOL, FLOW_ARGS), { limitMs: 300_000 });
    expect(result.text).toContain('Wygenerowano zbiór Shop customers: 40 wierszy, kolumn: 3.');
  });

  it('a credential in a name, a column or the cause of a failure never reaches the model, the entry or the state', async () => {
    const poisoned = await rig({
      script: { columns: [`password: ${BACKEND_CANARY}`, 'email'] },
      edit: (fake) => {
        fake.store
          .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
          .update(SCENARIO, { name: `shop password: ${BACKEND_CANARY}` });
      },
    });
    const result = await go(poisoned, { scenario_id: SCENARIO, rows: 5 });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toContain(BACKEND_CANARY);
    poisoned.assertClean();

    const failing = await rig({
      script: { endMs: 1000, outcome: { error: `cannot read password: ${BACKEND_CANARY}` } },
    });
    const failed = await go(failing);
    expect(failed.text).not.toContain(BACKEND_CANARY);
    failing.assertClean();
  });
});
