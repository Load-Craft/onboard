// `data_set_bindings`: the whole map of a target's picks at once. A composition's run reads its own
// picks and each member's self-check reads the member's, so a pick goes to both, where the columns fit.

import { describe, expect, it } from 'vitest';

import type { BindingsView } from '../src/render/views/data.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataSetBindings } from '../src/tools/dataSetBindings.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepComposition,
  type SklepFeeder,
  type SklepScenario,
} from './fake-backend/worlds/sklep.js';
import { dataCheck, dataOf, dataRig, writesOf } from './helpers/dataWorlds.js';
import type { ToolRig } from './helpers/rig.js';
import { leakedPieces } from './helpers/canary.js';

const { zakupy: ZAKUPY, konto: KONTO } = SKLEP_WORLD_IDS.scenarios;
const { frazy: FRAZY, zamowienia: ZAMOWIENIA } = SKLEP_WORLD_IDS.feeders;
const PUT_COMPOSITION = `PUT /api/v1/projects/:p/gatling/compositions/${SKLEP_WORLD_IDS.composition}/slot-bindings`;
const putScenario = (id: string): string =>
  `PUT /api/v1/projects/:p/gatling/scenarios/${id}/slot-bindings`;

const rig = (locale: 'en' | 'pl' = 'en'): Promise<ToolRig> =>
  dataRig({ tools: [dataSetBindings, dataCheckReadiness], locale });

const compositionPicks = (r: ToolRig): Readonly<Record<string, string>> =>
  r.fake.store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .require(SKLEP_WORLD_IDS.composition).slot_bindings;

const picksOf = (r: ToolRig, scenarioId: string): Readonly<Record<string, string>> =>
  r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).require(scenarioId)
    .slot_bindings;

async function bind(r: ToolRig, bindings: Record<string, string>, scenario = 'checkout') {
  const result = await r.call('data_set_bindings', { scenario, bindings });
  return { ...result, data: dataOf<BindingsView>(result) };
}

describe('data_set_bindings', () => {
  it('pins in the composition and in every member that reads the slot, by name or id', async () => {
    const r = await rig();
    const result = await bind(r, {
      search_phrases: 'frazy wyszukiwania',
      order_details: ZAMOWIENIA,
    });
    expect(result.isError, result.text).toBe(false);
    expect(compositionPicks(r)).toEqual({ search_phrases: FRAZY, order_details: ZAMOWIENIA });
    expect(picksOf(r, ZAKUPY)).toEqual({ search_phrases: FRAZY, order_details: ZAMOWIENIA });
    expect(picksOf(r, KONTO)).toEqual({});
    expect(writesOf(r)).toEqual([PUT_COMPOSITION, putScenario(ZAKUPY), putScenario(ZAKUPY)]);
    expect(result.data?.bound).toEqual([
      { slot: 'search_phrases', dataset: 'frazy wyszukiwania', scenarios: 1 },
      { slot: 'order_details', dataset: 'zamówienia', scenarios: 1 },
    ]);
    expect(result.data?.next).toEqual({
      tool: 'data_check_readiness',
      args: { scenario: 'checkout' },
    });
    expect(result.text).toContain('→ next: data_check_readiness scenario: "checkout"');
    expect(dataCheck(r.workspace, SKLEP_IDS.project, 'bindings_set')).toMatchObject({ ok: true });
  });

  it('replaces the whole map of a scenario; a slot left out loses its pick', async () => {
    const r = await rig('pl');
    await bind(r, { search_phrases: FRAZY, order_details: ZAMOWIENIA }, 'zakupy');
    const result = await bind(r, { order_details: ZAMOWIENIA }, 'zakupy');
    expect(picksOf(r, ZAKUPY)).toEqual({ order_details: ZAMOWIENIA });
    expect(result.data?.cleared).toEqual(['search_phrases']);
    expect(result.text).toContain('usunięte: search_phrases');
    const cleared = await bind(r, {}, 'zakupy');
    expect(picksOf(r, ZAKUPY)).toEqual({});
    expect(cleared.text).toContain('powiązania zakupy · brak');
  });

  it('sends nothing when the target already has the map', async () => {
    const r = await rig();
    await bind(r, { search_phrases: FRAZY }, 'zakupy');
    const before = writesOf(r).length;
    const again = await bind(r, { search_phrases: 'frazy wyszukiwania' }, 'zakupy');
    expect(again.data?.unchanged).toBe(true);
    expect(again.text).toContain('nothing was sent');
    expect(writesOf(r)).toHaveLength(before);
  });

  it('pins a dataset only in the members whose columns it covers', async () => {
    const r = await rig();
    const narrow = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).insert({
      ...structuredClone(
        r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).require(FRAZY),
      ),
      id: 'emails-only',
      name: 'emails',
      columns: ['email'],
    });
    const result = await bind(r, { accounts: narrow.name });
    expect(compositionPicks(r)['accounts']).toBe(narrow.id);
    // zakupy and konto read the password too, which the dataset does not have.
    expect(picksOf(r, ZAKUPY)['accounts']).toBeUndefined();
    expect(picksOf(r, KONTO)['accounts']).toBeUndefined();
    expect(result.data?.bound).toEqual([{ slot: 'accounts', dataset: 'emails', scenarios: 0 }]);
  });

  it('refuses an unknown slot, an unknown dataset and a name two datasets share, sending nothing', async () => {
    const r = await rig();
    const twin = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
    twin.insert({ ...structuredClone(twin.require(FRAZY)), id: 'frazy-2' });
    expect((await bind(r, { buyers: ZAMOWIENIA })).text).toContain('[slot_unknown]');
    expect((await bind(r, { order_details: 'nie ma' })).text).toContain('[dataset_unknown]');
    expect((await bind(r, { search_phrases: 'frazy wyszukiwania' })).text).toContain(
      '[dataset_ambiguous]',
    );
    expect(writesOf(r)).toEqual([]);
  });

  it('masks a credential in the names of the datasets it lists in a refusal (FIX-74)', async () => {
    const r = await rig();
    const feeders = r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders);
    const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkYXRhc2V0In0.c2VudGluZWwtZGF0YXNldC1zaWc';
    feeders.update(FRAZY, { name: `frazy ${secret}` });
    const unknown = await bind(r, { order_details: 'nie ma' });
    expect(unknown.text).toContain('[dataset_unknown]');
    expect(leakedPieces(unknown.text, [secret])).toEqual([]);
    expect(unknown.text).toContain('frazy');
  });

  it('keeps the previous map for the undo', async () => {
    const r = await rig();
    await bind(r, { search_phrases: FRAZY }, 'zakupy');
    await bind(r, {}, 'zakupy');
    const { readFileSync } = await import('node:fs');
    const state = JSON.parse(
      readFileSync(`${r.workspace}/loadcraft/.cache/state.json`, 'utf8'),
    ) as { process: Record<string, { log: { tool: string; undo?: { args?: unknown } }[] }> };
    const log = state.process[SKLEP_IDS.project]?.log ?? [];
    expect(log.at(-1)).toMatchObject({
      tool: 'data_set_bindings',
      undo: {
        args: { scenario: 'zakupy', bindings: { search_phrases: 'frazy wyszukiwania' } },
      },
    });
  });
});
