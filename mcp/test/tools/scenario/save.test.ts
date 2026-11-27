// `scenario_save` (module scenario): creates an empty scenario or changes the name, tags, active flag and
// SLO thresholds of one, written through the fake backend over HTTP. The scenario in the fake is compared,
// not only the answer; the undo is taken from the log entry (docs/tools/scenario/save.md).

import { describe, expect, it } from 'vitest';

import { scenarioSave, classNameOf } from '../../../src/tools/scenario/save.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake } from '../../fake-backend/server.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepScenario,
} from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';
import { expectUndoApplies, expectUndoRestores, loggedCalls } from '../../helpers/undo.js';

const PROJECT = SKLEP_IDS.project;
const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;
const BASE = `/api/v1/projects/${PROJECT}/gatling/scenarios`;

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly seed?: (fake: Fake) => void;
}

const scenarios = (fake: Fake) => fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
const scenarioOf = (fake: Fake, id = SCENARIO): SklepScenario =>
  scenarios(fake).require(id, 'scenario');

/** The fields a save can change, as the fake holds them. */
const savedOf = (r: ToolRig, id = SCENARIO) => {
  const { name, tags, is_active, assertion_thresholds, current_version } = scenarioOf(r.fake, id);
  return { name, tags, is_active, assertion_thresholds, current_version };
};

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [scenarioSave],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      scenarios(fake).update(SCENARIO, { tags: ['checkout', 'smoke'], assertion_thresholds: null });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
}

const view = (result: { readonly text: string }): string =>
  result.text
    .split('\n')
    .filter((line) => !line.startsWith('↗ '))
    .join('\n');

const writes = (r: ToolRig) =>
  r.fake.calls
    .filter((call) => call.path.startsWith(BASE) && call.method !== 'GET')
    .map((call) => `${call.method} ${call.path.slice(BASE.length)}`);

describe('scenario_save', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(scenarioSave);
    expect(scenarioSave.implemented).toBe(true);
  });

  it('changes the name, tags, active flag and thresholds: one read, one write with only what differs', async () => {
    const r = await rig();
    const was = scenarioOf(r.fake).name;
    const result = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      name: 'Browsing the shop',
      tags: 'smoke, browse',
      is_active: false,
      slo_thresholds: { p95_ms: 800 },
    });
    expect(result.isError, result.text).toBe(false);
    expect(view(result)).toBe(
      [
        'scenario "Browsing the shop" saved',
        `  name: "${was}" → "Browsing the shop"`,
        '  tags: checkout, smoke → smoke, browse',
        '  active: yes → no',
        "  SLO thresholds: the project's → own (p95_ms=800)",
        '→ undo: scenario_save with the previous values (a changed name makes another version)',
      ].join('\n'),
    );
    expect(savedOf(r)).toMatchObject({
      name: 'Browsing the shop',
      tags: ['smoke', 'browse'],
      is_active: false,
      assertion_thresholds: { p95_ms: 800 },
    });
    expect(writes(r)).toEqual([`PUT /${SCENARIO}`]);
    const put = r.fake.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({
      name: 'Browsing the shop',
      tags: ['smoke', 'browse'],
      is_active: false,
      assertion_thresholds: { p95_ms: 800 },
    });
  });

  it('sends only the changed field: the other values are not in the body', async () => {
    const r = await rig();
    await r.call('scenario_save', {
      scenario_id: SCENARIO,
      is_active: false,
      tags: 'checkout,smoke',
    });
    expect(r.fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({ is_active: false });
  });

  it('takes the scenario by name too', async () => {
    const r = await rig();
    const result = await r.call('scenario_save', {
      scenario_id: scenarioOf(r.fake).name,
      is_active: false,
    });
    expect(result.isError, result.text).toBe(false);
    expect(savedOf(r).is_active).toBe(false);
  });

  it('writes nothing when every value is the one the scenario has: no PUT, no undo entry', async () => {
    const r = await rig();
    const result = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      tags: 'checkout, smoke',
      is_active: true,
    });
    expect(view(result)).toBe(
      `scenario "${scenarioOf(r.fake).name}": the values are the ones it has; nothing changed.`,
    );
    expect(writes(r)).toEqual([]);
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('clears the tags with an empty text and withdraws own thresholds with slo_from_project', async () => {
    const r = await rig({
      seed: (fake) => scenarios(fake).update(SCENARIO, { assertion_thresholds: { p95_ms: 500 } }),
    });
    const result = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      tags: '',
      slo_from_project: true,
    });
    expect(result.isError, result.text).toBe(false);
    expect(view(result)).toContain('  tags: checkout, smoke → (none)');
    expect(view(result)).toContain("  SLO thresholds: own (p95_ms=500) → the project's");
    expect(savedOf(r)).toMatchObject({ tags: [], assertion_thresholds: null });
    expect(r.fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      tags: [],
      assertion_thresholds: null,
    });
  });

  it('sets the standard SLO with {}', async () => {
    const r = await rig();
    const result = await r.call('scenario_save', { scenario_id: SCENARIO, slo_thresholds: {} });
    expect(view(result)).toContain("  SLO thresholds: the project's → standard");
    expect(savedOf(r).assertion_thresholds).toEqual({});
  });

  it('undo of a change: the same tool with the previous values restores the scenario', async () => {
    const r = await rig({
      seed: (fake) => scenarios(fake).update(SCENARIO, { assertion_thresholds: { p95_ms: 500 } }),
    });
    const undo = await expectUndoRestores(
      r,
      {
        tool: 'scenario_save',
        args: {
          scenario_id: SCENARIO,
          tags: 'only',
          is_active: false,
          slo_thresholds: { p99_ms: 900 },
        },
      },
      () => {
        const { name, tags, is_active, assertion_thresholds } = savedOf(r);
        return { name, tags, is_active, assertion_thresholds };
      },
    );
    expect(undo.tool).toBe('scenario_save');
    expect(undo.args).toEqual({
      scenario_id: SCENARIO,
      tags: 'checkout,smoke',
      is_active: true,
      slo_thresholds: { p95_ms: 500 },
    });
  });

  it('undo of withdrawn thresholds puts them back, and of added ones withdraws them', async () => {
    const r = await rig();
    await r.call('scenario_save', { scenario_id: SCENARIO, slo_thresholds: { p95_ms: 800 } });
    const undo = loggedCalls(r).at(-1)?.undo;
    expect(undo?.args).toEqual({ scenario_id: SCENARIO, slo_from_project: true });
    await r.call('scenario_save', undo?.args ?? {});
    expect(savedOf(r).assertion_thresholds).toBeNull();
  });

  it('a renamed scenario is renamed back by the undo, which makes another version', async () => {
    const r = await rig();
    const before = savedOf(r);
    await r.call('scenario_save', { scenario_id: SCENARIO, name: 'Another' });
    const undo = loggedCalls(r).at(-1)?.undo;
    await r.call('scenario_save', undo?.args ?? {});
    expect(savedOf(r)).toEqual({ ...before, current_version: before.current_version + 2 });
  });

  it('has no undo when a previous tag has a comma: the view says so', async () => {
    const r = await rig({
      seed: (fake) => scenarios(fake).update(SCENARIO, { tags: ['a,b'] }),
    });
    const result = await r.call('scenario_save', { scenario_id: SCENARIO, tags: 'c' });
    expect(view(result)).toContain('no undo: a previous tag with a comma cannot be written back');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('creates an empty scenario with a class name made from the name, and its undo is scenario_delete', async () => {
    const r = await rig();
    const before = scenarios(r.fake).list().length;
    const result = await r.call('scenario_save', {
      name: 'Zakupy: płatność kartą',
      tags: 'pay, card',
      slo_thresholds: { p95_ms: 700 },
    });
    expect(result.isError, result.text).toBe(false);
    const created = scenarios(r.fake)
      .list()
      .find((scenario) => scenario.name === 'Zakupy: płatność kartą');
    expect(created).toBeDefined();
    expect(scenarios(r.fake).list()).toHaveLength(before + 1);
    expect(created).toMatchObject({
      simulation_class_name: 'ZakupyPlatnoscKarta',
      tags: ['pay', 'card'],
      assertion_thresholds: { p95_ms: 700 },
    });
    expect(view(result)).toBe(
      [
        'scenario "Zakupy: płatność kartą" created, empty: no script yet',
        `→ undo: delete the new scenario ${created?.id} (the user decides)`,
      ].join('\n'),
    );
    expect(writes(r)).toEqual(['POST ']);
  });

  it('undo of a creation: the log names scenario_delete with the new id, and deleting it leaves the scenarios as before', async () => {
    const r = await rig();
    const snapshot = () =>
      scenarios(r.fake)
        .list()
        .map((scenario) => scenario.id)
        .sort();
    const undo = await expectUndoApplies(
      r,
      { tool: 'scenario_save', args: { name: 'New one' } },
      'scenario_delete',
      snapshot,
      (args) => {
        scenarios(r.fake).delete(String(args.scenario_id));
      },
    );
    expect(Object.keys(undo.args)).toEqual(['scenario_id']);
  });

  it('format data: the ids, the name, whether it was created and what changed', async () => {
    const r = await rig();
    const data = JSON.parse(
      (
        await r.call('scenario_save', {
          scenario_id: SCENARIO,
          is_active: false,
          format: 'data',
        })
      ).text.split('\n')[0] ?? '',
    ) as Record<string, unknown>;
    expect(data).toEqual({
      project_id: PROJECT,
      scenario_id: SCENARIO,
      name: scenarioOf(r.fake).name,
      created: false,
      changes: { is_active: { was: true, now: false } },
      undoable: true,
    });
  });

  it('writes the log entry: the scenario id as argument and the name saved', async () => {
    const r = await rig();
    await r.call('scenario_save', { scenario_id: SCENARIO, is_active: false });
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: 'scenario_save',
      args: SCENARIO,
      result: `${scenarioOf(r.fake).name} saved`,
    });
  });

  it('refuses locally, with no request: nothing to change, both SLO arguments, more than 20 tags', async () => {
    const r = await rig();
    const none = await r.call('scenario_save', { scenario_id: SCENARIO });
    const both = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      slo_thresholds: {},
      slo_from_project: true,
    });
    const many = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      tags: Array.from({ length: 21 }, (_, index) => `t${String(index)}`).join(','),
    });
    for (const result of [none, both, many]) {
      expect(result.text).toMatch(/^\[scenario_save_refused\] /u);
    }
    expect(none.text).toContain('give at least one of');
    expect(both.text).toContain('exclude each other');
    expect(many.text).toContain('at most 20 tags');
    expect(r.fake.calls.filter((call) => call.path.startsWith(BASE))).toEqual([]);
  });

  it('refuses a creation without a name, with the active flag, or with slo_from_project, with no request', async () => {
    const r = await rig();
    expect((await r.call('scenario_save', { tags: 'a' })).text).toMatch(/^\[missing_argument\] /u);
    expect((await r.call('scenario_save', { name: 'x', is_active: false })).text).toContain(
      'is_active applies to a scenario that exists',
    );
    expect((await r.call('scenario_save', { name: 'x', slo_from_project: true })).text).toContain(
      'slo_from_project applies to a scenario that exists',
    );
    expect(r.fake.calls.filter((call) => call.path.startsWith(BASE))).toEqual([]);
  });

  it('refuses an argument outside the catalog, an empty name and thresholds that are no numbers, before any request', async () => {
    const r = await rig();
    for (const args of [
      { scenario_id: SCENARIO, color: 'red' },
      { scenario_id: SCENARIO, name: '   ' },
      { scenario_id: SCENARIO, slo_thresholds: { p95_ms: '800' } },
    ]) {
      const result = await r.call('scenario_save', args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith(BASE))).toEqual([]);
  });

  it('a refused write (unknown threshold, 422) changes nothing and leaves no undo in the log', async () => {
    const r = await rig();
    const before = savedOf(r);
    const result = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      name: 'Renamed',
      slo_thresholds: { nonsense: 1 },
    });
    expect(result.isError).toBe(true);
    expect(savedOf(r)).toEqual(before);
    expect(loggedCalls(r).some((entry) => entry.tool === 'scenario_save' && entry.undo)).toBe(
      false,
    );
  });

  it('answers not_found for a scenario the project does not have, writing nothing', async () => {
    const r = await rig();
    const result = await r.call('scenario_save', { scenario_id: 'no such scenario', name: 'x' });
    expect(result.text).toMatch(/^\[not_found\] /u);
    expect(writes(r)).toEqual([]);
  });

  it('shows the Polish view', async () => {
    const r = await rig({ locale: 'pl' });
    const was = scenarioOf(r.fake).name;
    const result = await r.call('scenario_save', {
      scenario_id: SCENARIO,
      name: 'Przeglądanie',
      is_active: false,
      slo_thresholds: { p95_ms: 800 },
    });
    expect(view(result)).toBe(
      [
        'scenariusz "Przeglądanie" zapisany',
        `  nazwa: "${was}" → "Przeglądanie"`,
        '  aktywny: tak → nie',
        '  progi SLO: projektu → własne (p95_ms=800)',
        '→ cofnięcie: scenario_save z poprzednimi wartościami (zmiana nazwy tworzy kolejną wersję)',
      ].join('\n'),
    );
  });

  it('masks a secret in the name of the scenario the application holds', async () => {
    const r = await rig({
      seed: (fake) =>
        scenarios(fake).update(SCENARIO, {
          name: `Browsing Authorization: Bearer ${SHAPE_CANARY} password: ${BACKEND_CANARY}`,
        }),
    });
    const result = await r.call('scenario_save', { scenario_id: SCENARIO, name: 'Browsing' });
    expect(result.text).not.toContain(BACKEND_CANARY);
    r.assertClean();
  });
});

describe('classNameOf', () => {
  it.each([
    ['Browsing the shop', 'BrowsingTheShop'],
    ['Zakupy: płatność kartą', 'ZakupyPlatnoscKarta'],
    ['2 fast 2 furious', 'Scenario2Fast2Furious'],
    ['!!!', 'Scenario'],
    ['ółż', 'Olz'],
  ])('%s → %s', (name, expected) => {
    expect(classNameOf(name)).toBe(expected);
  });
});
