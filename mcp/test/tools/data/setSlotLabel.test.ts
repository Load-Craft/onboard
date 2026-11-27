// `data_set_slot_label` (module data): the display label of a data slot of a scenario, written through
// the fake backend over HTTP. The object in the fake is compared, not only the answer; the undo is
// taken from the log entry the write left.

import { describe, expect, it } from 'vitest';

import { dataSetSlotLabel } from '../../../src/tools/data/setSlotLabel.js';
import { seedSlotLabels, slotLabels } from '../../fake-backend/routes/dataWrites.js';
import { SKLEP_WORLD_IDS } from '../../fake-backend/worlds/sklep.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import { expectUndoRestores, loggedCalls } from '../../helpers/undo.js';
import { apiCalls, BOUND, dataRig, errorCode, stateWith } from './rig.js';

const TOOL = 'data_set_slot_label';
const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;

function rig(
  options: {
    locale?: 'en' | 'pl';
    labels?: Record<string, string | null>;
    files?: Record<string, string>;
  } = {},
): Promise<ToolRig> {
  return dataRig({
    tools: [dataSetSlotLabel],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.files === undefined ? {} : { files: options.files }),
    seed: (fake) => {
      seedSlotLabels(
        fake.store,
        SCENARIO,
        options.labels ?? { search_phrases: 'Search phrases', accounts: null },
      );
    },
  });
}

const labels = (r: ToolRig) => slotLabels(r.fake.store, SCENARIO);
const writes = (r: ToolRig) => r.fake.calls.filter((call) => call.method === 'PATCH');

describe('data_set_slot_label', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(dataSetSlotLabel);
    expect(dataSetSlotLabel.implemented).toBe(true);
  });

  it('relabels a slot: one read of the slots, one PATCH, the object holds the new label', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {
      scenario_id: SCENARIO,
      slot: 'search_phrases',
      label: 'Phrases customers type',
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Slot "search_phrases" is now labelled "Phrases customers type".',
        'label was: "Search phrases"',
      ].join('\n'),
    );
    expect(apiCalls(r)).toEqual([
      `GET /gatling/scenarios/${SCENARIO}/slots/options`,
      `PATCH /data-hub/scenarios/${SCENARIO}/slots/search_phrases/label`,
    ]);
    expect(writes(r)[0]?.body).toEqual({ label: 'Phrases customers type' });
    expect(labels(r)['search_phrases']).toBe('Phrases customers type');
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      args: 'search_phrases',
      result: 'slot search_phrases: Phrases customers type',
    });
  });

  it('the undo from the log puts the previous label back', async () => {
    const r = await rig();
    const undo = await expectUndoRestores(
      r,
      { tool: TOOL, args: { scenario_id: SCENARIO, slot: 'search_phrases', label: 'New' } },
      () => labels(r),
    );
    expect(undo).toMatchObject({
      tool: TOOL,
      args: { scenario_id: SCENARIO, slot: 'search_phrases', label: 'Search phrases' },
    });
  });

  it('a slot with no label cannot be restored: the write goes through, with no undo and a note', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {
      scenario_id: SCENARIO,
      slot: 'accounts',
      label: 'Test accounts',
    });
    expect(result.text).toContain('the slot had no label');
    expect(result.text).toContain('a label cannot be cleared');
    expect(labels(r)['accounts']).toBe('Test accounts');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('writes nothing when the label is already as given: no PATCH, no undo', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {
      scenario_id: SCENARIO,
      slot: 'search_phrases',
      label: '  Search phrases ',
    });
    expect(result.text).toBe(
      'Slot "search_phrases": nothing to change, the label is already "Search phrases".',
    );
    expect(writes(r)).toEqual([]);
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('a previous label that held a secret is masked and not kept for undo', async () => {
    const r = await rig({ labels: { search_phrases: `password=${BACKEND_CANARY}` } });
    const result = await r.call(TOOL, {
      scenario_id: SCENARIO,
      slot: 'search_phrases',
      label: 'Clean',
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('held a secret');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('the scenario defaults to the only one of the workspace; with none it is missing_argument', async () => {
    const files = {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': stateWith({
        scenario_ids: { [SKLEP_WORLD_IDS.flowPrzegladanie]: SCENARIO },
      }),
    };
    const known = await rig({ files });
    const result = await known.call(TOOL, { slot: 'search_phrases', label: 'X' });
    expect(result.isError, result.text).toBe(false);
    expect(labels(known)['search_phrases']).toBe('X');
    const bare = await rig();
    expect(errorCode(await bare.call(TOOL, { slot: 'search_phrases', label: 'X' }))).toBe(
      'missing_argument',
    );
    expect(apiCalls(bare)).toEqual([]);
  });

  it('a slot the scenario lacks is not_found with its slots; a scenario it lacks too', async () => {
    const r = await rig();
    const unknown = await r.call(TOOL, { scenario_id: SCENARIO, slot: 'nope', label: 'X' });
    expect(errorCode(unknown)).toBe('not_found');
    expect(unknown.text).toContain('"search_phrases"');
    const none = await r.call(TOOL, {
      scenario_id: '9a8b7c6d-0001-4e00-8000-000000000001',
      slot: 'search_phrases',
      label: 'X',
    });
    expect(errorCode(none)).toBe('not_found');
    expect(writes(r)).toEqual([]);
  });

  it('refuses arguments outside the catalog before a request', async () => {
    const r = await rig();
    for (const args of [
      { slot: 'a' },
      { label: 'x' },
      { slot: '', label: 'x' },
      { slot: 's'.repeat(101), label: 'x' },
      { slot: 's', label: '' },
      { slot: 's', label: 'x'.repeat(201) },
      { scenario_id: 'x', slot: 's', label: 'x' },
      { slot: 's', label: 'x', feeder: 'a' },
    ]) {
      const result = await r.call(TOOL, args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(apiCalls(r)).toEqual([]);
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig({ locale: 'pl' });
    expect(
      (await r.call(TOOL, { scenario_id: SCENARIO, slot: 'search_phrases', label: 'Frazy' })).text,
    ).toBe(
      ['Slot „search_phrases” ma teraz etykietę „Frazy”.', 'etykieta była: „Search phrases”'].join(
        '\n',
      ),
    );
    expect(
      (await r.call(TOOL, { scenario_id: SCENARIO, slot: 'search_phrases', label: 'Frazy' })).text,
    ).toBe('Slot „search_phrases”: nic do zmiany, etykieta to już „Frazy”.');
    expect(
      (await r.call(TOOL, { scenario_id: SCENARIO, slot: 'accounts', label: 'Konta' })).text,
    ).toContain('nie można wyczyścić');
  });
});
