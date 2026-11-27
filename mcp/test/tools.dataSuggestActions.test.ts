// `data_suggest_actions`: the data hub's suggestion as the calls of the data tools that apply it. The
// hub is a model, so it is asked only for a missing slot and only after the user's yes to a card;
// its actions become the calls in its order, and what no data tool applies is listed with why.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderSuggestion,
  type PlanStep,
  type SuggestCardView,
  type SuggestionView,
} from '../src/render/views/data.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataCreateDataset } from '../src/tools/dataCreateDataset.js';
import { dataSetBindings } from '../src/tools/dataSetBindings.js';
import { dataSuggestActions } from '../src/tools/dataSuggestActions.js';
import { SKLEP_IDS, goldenText } from './golden/index.js';
import { setFakePlanActions } from './fake-backend/routes/data.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepComposition,
  type SklepFeeder,
  type SklepScenario,
} from './fake-backend/worlds/sklep.js';
import {
  callConfirmed,
  contentlessSlot,
  dataCheck,
  dataOf,
  dataRig,
  hubPlan,
  PASSWORD_1,
  PLAIN_SLOT,
  writesOf,
  type DataRigOptions,
} from './helpers/dataWorlds.js';
import type { ToolRig } from './helpers/rig.js';

const TOOLS = [dataSuggestActions, dataCheckReadiness, dataSetBindings, dataCreateDataset];
const ZAKUPY = SKLEP_WORLD_IDS.scenarios.zakupy;
const PRZEGLADANIE = SKLEP_WORLD_IDS.scenarios.przegladanie;

const rig = (options: Omit<DataRigOptions, 'tools'> = {}): Promise<ToolRig> =>
  dataRig({ tools: TOOLS, ...options });

const autoPlans = (r: ToolRig): number =>
  r.fake.calls.filter((call) => call.path.endsWith('/data-hub/auto-plan')).length;

const compositionPicks = (r: ToolRig): Readonly<Record<string, string>> =>
  r.fake.store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .require(SKLEP_WORLD_IDS.composition).slot_bindings;

const picksOf = (r: ToolRig, scenarioId: string): Readonly<Record<string, string>> =>
  r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).require(scenarioId)
    .slot_bindings;

const feeders = (r: ToolRig): SklepFeeder[] =>
  r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();

async function suggest(r: ToolRig, scenario = 'checkout') {
  const { card, result } = await callConfirmed(r, 'data_suggest_actions', { scenario });
  expect(result.isError, result.text).toBe(false);
  return { ...result, card, data: dataOf<SuggestionView>(result) };
}

/** Runs the calls of a suggestion in its order, each pin a new dataset names right after it. */
async function applyAll(r: ToolRig, steps: readonly PlanStep[]): Promise<void> {
  for (const step of steps) {
    const { result } = await callConfirmed(r, step.tool, { ...step.args });
    expect(result.isError, `${step.tool}: ${result.text}`).toBe(false);
    const next = dataOf<{ next?: PlanStep }>(result)?.next;
    if (next !== undefined && step.tool === 'data_create_dataset') {
      const pinned = await r.call(next.tool, { ...next.args });
      expect(pinned.isError, pinned.text).toBe(false);
    }
  }
}

const json = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`./golden/run1/${name}.view.json`, import.meta.url), 'utf8'),
  ) as T;

describe('data_suggest_actions', () => {
  it('asks the hub only after the user said yes to a card', async () => {
    const r = await rig({ locale: 'pl' });
    const card = await r.call('data_suggest_actions', { scenario: 'checkout' });
    const data = dataOf<SuggestCardView>(card);
    expect(data).toMatchObject({ needsConfirmation: true, target: { name: 'checkout' } });
    expect(card.text).toContain('karta zgody · propozycja danych testowych dla checkout');
    expect(card.text).toContain('Koszt: do 3 wywołań LLM huba danych');
    expect(autoPlans(r)).toBe(0);
    const done = await r.call('data_suggest_actions', {
      scenario: 'checkout',
      confirm: data?.confirm,
    });
    expect(dataOf<SuggestionView>(done)?.asked).toBe(true);
    expect(autoPlans(r)).toBe(1);
    expect(dataCheck(r.workspace, SKLEP_IDS.project, 'planned')).toMatchObject({ ok: true });
  });

  it('a confirm for another target or with an old token gets a new card and asks nothing', async () => {
    const r = await rig();
    const first = dataOf<SuggestCardView>(
      await r.call('data_suggest_actions', { scenario: 'checkout' }),
    );
    const other = await r.call('data_suggest_actions', {
      scenario: 'konto',
      confirm: first?.confirm,
    });
    expect(dataOf<SuggestCardView>(other)).toMatchObject({ renewed: 'changed' });
    const stale = await r.call('data_suggest_actions', {
      scenario: 'checkout',
      confirm: first?.confirm,
    });
    // The confirm for konto used the card up; konto's new card has another token.
    expect(dataOf<SuggestCardView>(stale)).toMatchObject({ renewed: 'token' });
    expect(autoPlans(r)).toBe(0);
  });

  it('needs no card and asks no hub when every slot is filled', async () => {
    const r = await rig({ stage: 'data' });
    const result = await r.call('data_suggest_actions', { scenario: 'checkout' });
    expect(dataOf<SuggestionView>(result)).toMatchObject({ asked: false, ready: true, steps: [] });
    expect(autoPlans(r)).toBe(0);
  });

  it('turns binds and datasets from rules into calls and leaves accounts to a separate call', async () => {
    const r = await rig({ locale: 'pl' });
    setFakePlanActions(r.fake.store, hubPlan(r.fake));
    const result = await suggest(r);
    expect(result.text).toBe(
      goldenText('run1', '08b-data_suggest_actions-apply').replace(/\n$/u, ''),
    );
    expect(result.data).toEqual(json<SuggestionView>('08b-data_suggest_actions-apply'));
    expect(result.data?.skipped.map((item) => item.reason)).toEqual([
      'secret_columns',
      'separate_call',
      'dataset_gone',
    ]);
    // The suggestion applied nothing; its calls do, in its order.
    expect(writesOf(r)).toEqual([]);
    await applyAll(r, result.data?.steps ?? []);
    const rozmiary = feeders(r).find((feeder) => feeder.name === 'rozmiary');
    expect(compositionPicks(r)).toEqual({
      search_phrases: SKLEP_WORLD_IDS.feeders.frazy,
      order_details: rozmiary?.id,
    });
    expect(picksOf(r, ZAKUPY)).toEqual({ search_phrases: SKLEP_WORLD_IDS.feeders.frazy });
    expect(feeders(r).some((feeder) => feeder.name === 'konta')).toBe(false);
    expect(writesOf(r).filter((line) => line.includes('/provision'))).toEqual([]);
    const everything = JSON.stringify(r.results) + r.lines.join('\n') + result.text;
    expect(everything).not.toContain(PASSWORD_1);
    r.assertClean();
  });

  it('shows the same view in English', async () => {
    const r = await rig({ locale: 'en' });
    setFakePlanActions(r.fake.store, hubPlan(r.fake));
    const { text, card } = await suggest(r);
    await expect(text).toMatchFileSnapshot('__snapshots__/dataSuggestActions.apply.en.txt');
    await expect(card?.text.replace(/"[0-9a-f]{16}"/u, '"<token>"')).toMatchFileSnapshot(
      '__snapshots__/dataSuggestActions.card.en.txt',
    );
  });

  it('a pin keeps the picks of the calls before it', async () => {
    const r = await rig({ slots: [{ scenario: ZAKUPY, slot: contentlessSlot() }] });
    const konta = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).insert({
      ...structuredClone(feeders(r)[0] as SklepFeeder),
      id: 'konta-z-pliku',
      name: 'konta',
      columns: ['email', 'password'],
    });
    setFakePlanActions(r.fake.store, [
      ...hubPlan(r.fake).slice(0, 2),
      { kind: 'bind', slot: 'accounts', dataset_id: konta.id },
    ]);
    const { data } = await suggest(r);
    expect(data?.steps.map((step) => step.tool)).toEqual([
      'data_set_bindings',
      'data_create_dataset',
      'data_set_bindings',
      'data_create_dataset',
    ]);
    // The second pin comes after the dataset from rules: its map holds that dataset by name.
    expect(data?.steps[2]?.args).toEqual({
      scenario: 'checkout',
      bindings: {
        search_phrases: 'frazy wyszukiwania',
        order_details: 'rozmiary',
        accounts: 'konta',
      },
    });
    expect(data?.steps[3]?.args).toEqual({ scenario: 'checkout', slot: PLAIN_SLOT });
    await applyAll(r, data?.steps ?? []);
    expect(Object.keys(compositionPicks(r)).sort()).toEqual(
      ['accounts', 'order_details', 'scenario_auto_data', 'search_phrases'].sort(),
    );
  });

  it('pins a dataset only in the members whose columns it covers', async () => {
    const r = await rig({
      slots: [
        { scenario: PRZEGLADANIE, slot: contentlessSlot(['couponCode']) },
        { scenario: ZAKUPY, slot: contentlessSlot() },
      ],
    });
    const narrow = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).insert({
      ...structuredClone(feeders(r)[0] as SklepFeeder),
      id: 'narrow-coupons',
      name: 'coupons',
      file_name: 'coupons.csv',
      columns: ['couponCode'],
    });
    setFakePlanActions(r.fake.store, [{ kind: 'bind', slot: PLAIN_SLOT, dataset_id: narrow.id }]);
    const { data } = await suggest(r);
    // A bind fills the slot: its rows are not made from the columns as well.
    expect(data?.steps.map((step) => step.tool)).toEqual(['data_set_bindings']);
    await applyAll(r, data?.steps ?? []);
    expect(compositionPicks(r)[PLAIN_SLOT]).toBe(narrow.id);
    expect(picksOf(r, PRZEGLADANIE)[PLAIN_SLOT]).toBe(narrow.id);
    // zakupy also reads email and notes, which the dataset does not have: it would be a mismatch.
    expect(picksOf(r, ZAKUPY)[PLAIN_SLOT]).toBeUndefined();
  });

  it('does not offer a dataset whose name is taken', async () => {
    const r = await rig();
    setFakePlanActions(r.fake.store, [
      {
        kind: 'create_dataset',
        name: 'frazy wyszukiwania',
        bind_to_slot: 'search_phrases',
        row_count: 10,
        recipe: { columns: [{ column_name: 'q', generation_hint: 'faker:int' }], sample_rows: [] },
      },
    ]);
    const { data } = await suggest(r);
    expect(data?.steps).toEqual([]);
    expect(data?.skipped).toEqual([
      expect.objectContaining({ reason: 'exists', name: 'frazy wyszukiwania' }),
    ]);
  });

  it.each([
    ['pwd', 'faker:int', null, []],
    ['code', 'faker:int', 'credential', []],
    ['code', 'faker:int', null, [{ name: 'code', type: 'secret' }]],
  ])(
    'offers no call for a dataset with the secret column %s',
    async (column, hint, semantics, specs) => {
      const r = await rig();
      if (specs.length > 0) {
        const scenarios = r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
        for (const scenario of scenarios.list()) {
          scenarios.update(scenario.id, {
            feeder_slots: scenario.feeder_slots.map((slot) =>
              slot.slot === 'accounts' ? { ...slot, column_specs: specs } : slot,
            ),
          });
        }
      }
      setFakePlanActions(r.fake.store, [
        {
          kind: 'create_dataset',
          name: 'tajne',
          bind_to_slot: 'accounts',
          row_count: 10,
          recipe: {
            columns: [{ column_name: column, generation_hint: hint, semantics }],
            sample_rows: [],
          },
        },
      ]);
      const { data } = await suggest(r);
      expect(data?.steps).toEqual([]);
      expect(data?.skipped).toEqual([expect.objectContaining({ reason: 'secret_columns' })]);
    },
  );

  it('turns at most 40 actions of the hub into calls and says how many it left out', async () => {
    const r = await rig();
    setFakePlanActions(
      r.fake.store,
      Array.from({ length: 45 }, (_, index) => ({
        kind: 'bind',
        slot: 'search_phrases',
        dataset_id: `gone-${String(index)}`,
      })),
    );
    const { data, text } = await suggest(r);
    expect(data?.skipped).toHaveLength(41);
    expect(data?.skipped.slice(0, 40).every((item) => item.reason === 'dataset_gone')).toBe(true);
    expect(data?.skipped.at(-1)).toEqual({
      reason: 'over_limit',
      kind: 'actions',
      name: null,
      slot: null,
      count: 5,
    });
    expect(text.replace(/\s+/gu, ' ')).toContain(
      '5 more actions of the data hub: at most 40 become calls',
    );
  });

  it('says so when the hub proposes nothing', async () => {
    const r = await rig({ locale: 'pl' });
    setFakePlanActions(r.fake.store, []);
    const result = await suggest(r);
    expect(result.text).toContain('hub danych nie proponuje żadnych akcji');
    expect(writesOf(r)).toEqual([]);
  });

  it('a slot the hub plans for and no member covers is filled by the call of the suggestion', async () => {
    const r = await rig({
      slots: [
        { scenario: PRZEGLADANIE, slot: contentlessSlot(['couponCode', 'voucher']) },
        { scenario: ZAKUPY, slot: contentlessSlot() },
      ],
    });
    setFakePlanActions(r.fake.store, [
      {
        kind: 'create_dataset',
        name: 'kupony',
        bind_to_slot: PLAIN_SLOT,
        row_count: 50,
        recipe: {
          columns: ['couponCode', 'voucher', 'email', 'notes'].map((column_name) => ({
            column_name,
            generation_hint: 'faker:sentence',
          })),
          sample_rows: [],
        },
      },
    ]);
    const { data } = await suggest(r);
    expect(data?.fixes).toContainEqual({
      kind: 'data_missing',
      slot: PLAIN_SLOT,
      label: 'Coupon & email & notes',
    });
    await applyAll(r, data?.steps ?? []);
    const after = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(
      dataOf<SuggestionView>(after)?.slots.find((slot) => slot.slot === PLAIN_SLOT)?.state,
    ).toBe('bound');
  });

  it("shows the hub's reason when no tool can fill a slot", async () => {
    const r = await rig({
      slots: [
        { scenario: PRZEGLADANIE, slot: contentlessSlot(['couponCode', 'voucher']) },
        { scenario: ZAKUPY, slot: contentlessSlot() },
      ],
    });
    const { data, text } = await suggest(r);
    expect(data?.fixes).toContainEqual(
      expect.objectContaining({ kind: 'data_from_file', slot: PLAIN_SLOT, reason: 'no_source' }),
    );
    expect(text.replace(/\s+/gu, ' ')).toContain(
      'the data hub: I cannot create a synthetic dataset',
    );
    expect(text.replace(/\s+/gu, ' ')).toContain('data_create_dataset with file and slot');
  });

  it('turns a refusal of the hub into a named error with a hint', async () => {
    const r = await rig();
    r.fake.faults.next('POST', `/api/v1/projects/${SKLEP_IDS.project}/data-hub/auto-plan`, {
      status: 404,
      body: { detail: "Cannot prepare test data for scenario 'x': not in this project." },
    });
    const { result } = await callConfirmed(r, 'data_suggest_actions', { scenario: 'checkout' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('→');
    r.assertClean();
  });
});

describe('the golden view of the suggestion', () => {
  it('renders to the golden text', () => {
    expect(
      renderSuggestion(
        json<SuggestionView>('08b-data_suggest_actions-apply'),
        createTranslator('pl'),
      ),
    ).toBe(goldenText('run1', '08b-data_suggest_actions-apply').replace(/\n$/u, ''));
  });
});
