// `flows_migrate_docs` against the fake backend: the project gets a newer docs version without the
// operation `GET /orders`, the flows of the world stay pinned to the version they were built on. The
// tool shows a preview that saves nothing, asks for consent with a card, migrates only with
// `confirm` set to the token of the card, sends an explicit list of flows with the versions and the
// target the user saw, refuses a call that is not the call of the card, shows the
// refusals of the backend per flow and its 409 answers as errors with a next step, and refuses on a
// server without the capability.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { flowsMigrateDocs } from '../src/tools/flowsMigrateDocs.js';
import type { MigrateDocsData } from '../src/render/views/migrateDocs.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerAllRoutes } from './fake-backend/routes/index.js';
import { saveSpecification } from './fake-backend/routes/setup.js';
import { failListAfterMigration, seedValueDiff } from './fake-backend/routes/specMigration.js';
import type { Fake } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepEndpoint,
} from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const CAPABLE = { capabilities: ['meta', 'flows_spec_migration'] };
const PREVIEW = `/api/v1/projects/${SKLEP_IDS.project}/flows/spec-migration/preview`;
const MIGRATE = `/api/v1/projects/${SKLEP_IDS.project}/flows/spec-migration`;
const ZAKUPY = SKLEP_IDS.flowZakupy;
const KONTO = SKLEP_WORLD_IDS.flowKonto;
const PRZEGLADANIE = SKLEP_WORLD_IDS.flowPrzegladanie;

interface FlowRecord {
  readonly id: string;
  readonly name: string;
  readonly current_version: number;
  readonly openapi_spec_id?: string | null;
  readonly blocks: readonly { id: string; config?: Record<string, unknown> }[];
}

/** A newer version of the documentation: the operations of the world without `GET /orders`. */
function newerDocs(fake: Fake): string {
  const paths: Record<string, Record<string, { operationId: string }>> = {};
  const endpoints = fake.store
    .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
    .list((endpoint) => endpoint.spec_id === SKLEP_WORLD_IDS.spec);
  for (const endpoint of endpoints) {
    if (endpoint.method === 'GET' && endpoint.path === '/orders') continue;
    const item = (paths[endpoint.path] ??= {});
    item[endpoint.method.toLowerCase()] = { operationId: endpoint.operation_id ?? endpoint.id };
  }
  return saveSpecification(fake.store, SKLEP_IDS.project, {
    openapi: '3.0.3',
    info: { title: 'Sklep API', version: '2.16.0' },
    paths,
  });
}

function world(options: { newer: boolean }) {
  return (fake: Fake): void => {
    registerAllRoutes(fake);
    seedSklep(fake.store, { stage: 'scenario' });
    if (!options.newer) return;
    NEWER = newerDocs(fake);
    seedValueDiff(fake.store, {
      flow_id: ZAKUPY,
      block_id: 'zakupy-7',
      location: 'body',
      field: 'paymentMethod',
      kind: 'example_changed',
      action: 'set',
      adoptable: true,
      current_value: 'card',
      source_value: 'card',
      target_value: 'blik',
    });
  };
}

async function rig(
  options: { locale?: 'en' | 'pl'; capable?: boolean; newer?: boolean } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: [flowsMigrateDocs],
    world: world({ newer: options.newer ?? true }),
    clock: createTestClock(Date.parse('2026-11-26T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
    ...(options.capable === false ? {} : { fake: { meta: CAPABLE } }),
  });
}

async function done(
  r: ToolRig,
  args: Record<string, unknown>,
): Promise<{ text: string; data: MigrateDocsData }> {
  const result = await r.call('flows_migrate_docs', args);
  if (result.isError) throw new Error(`flows_migrate_docs failed: ${result.text}`);
  const outcome = result.outcome as { status: string; data: MigrateDocsData };
  expect(outcome.status).toBe('done');
  return { text: result.text, data: outcome.data };
}

const posts = (r: ToolRig, path: string) =>
  r.fake.calls.filter((call) => call.method === 'POST' && call.path === path);

const flowOf = (r: ToolRig, id: string): FlowRecord =>
  r.fake.store.collection<FlowRecord>(SKLEP_COLLECTIONS.flows).require(id);

/** Id of the docs version the world's migration moves to (the newer one of `world`). */
let NEWER = '';
const valueId = (version: number): string =>
  `${ZAKUPY}:${String(version)}:${NEWER}:zakupy-7:body:paymentMethod`;

interface StateProblem {
  readonly code: string;
  readonly flow_ids?: readonly string[];
}

function problemsOf(r: ToolRig): StateProblem[] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { problems: StateProblem[] }> };
  return state.process[SKLEP_IDS.project]?.problems ?? [];
}

/** The consent card of `args` and its token, for the `confirm` of the same call after the yes. */
async function cardToken(r: ToolRig, args: Record<string, unknown>): Promise<string> {
  const { data } = await done(r, args);
  if (data.kind !== 'card') throw new Error(`expected a card, got ${data.kind}`);
  return data.token;
}

/** The card of `args`, then the same call with its token: what the yes of the user leads to. */
async function confirmed(r: ToolRig, args: Record<string, unknown>) {
  const token = await cardToken(r, args);
  return r.call('flows_migrate_docs', { ...args, confirm: token });
}

/** The text with the token of the card (random for every card) as a placeholder. */
const anyToken = (text: string): string =>
  text.replace(/confirm: "[0-9a-f]{16}"/gu, 'confirm: "<token>"');

function errorOf(result: RigCallResult): string {
  expect(result.isError).toBe(true);
  return result.text;
}

describe('flows_migrate_docs', () => {
  it('previews every flow on an older docs version and saves nothing', async () => {
    const r = await rig();
    const { text, data } = await done(r, { preview: true });
    expect(data.kind).toBe('preview');
    const sent = posts(r, PREVIEW)[0]?.body as { flow_ids?: string[]; target_spec_id?: string };
    // the omitted list is sent as the explicit list of the outdated flows
    expect([...(sent.flow_ids ?? [])].sort()).toEqual([ZAKUPY, PRZEGLADANIE, KONTO].sort());
    expect(posts(r, MIGRATE)).toEqual([]);
    expect(flowOf(r, ZAKUPY).current_version).toBe(1);
    expect(flowOf(r, ZAKUPY).openapi_spec_id).toBe(SKLEP_WORLD_IDS.spec);
    expect(text).toContain('nothing was saved');
    expect(text).toMatch(/konto[^\n]*1 unmatched/u);
    expect(text).toMatch(/List my orders · GET \/orders[^\n]*endpoint removed/u);
    expect(text).toMatch(/paymentMethod[^\n]*"card" → "blik"/u);
    expect(text).toContain(valueId(1));
    expect(text).toMatch(/allow_unmatched/u);
    await expect(text).toMatchFileSnapshot('__snapshots__/flowsMigrateDocs.preview.en.txt');
    r.assertClean();
  });

  it('without confirm returns the consent card and migrates nothing', async () => {
    const r = await rig();
    const { text, data } = await done(r, { adopt_values: 'all' });
    expect(data.kind).toBe('card');
    expect(text).toMatch(/^Migrate 3 flows to the current docs version/u);
    expect(text).toMatch(/Flows\s+konto, przeglądanie, zakupy/u);
    expect(text).toMatch(/Adopt example values\s+all/u);
    expect(text).toMatch(/Docs version\s+2\.16\.0/u);
    expect(text).toMatch(/Outdated flows\s+3/u);
    expect(text).toMatch(/only after a yes[^\n]*confirm: "[0-9a-f]{16}"/iu);
    expect(text).toContain(`confirm: "${data.kind === 'card' ? data.token : ''}"`);
    expect(posts(r, MIGRATE)).toEqual([]);
    expect(posts(r, PREVIEW)).toEqual([]);
    await expect(anyToken(text)).toMatchFileSnapshot('__snapshots__/flowsMigrateDocs.card.en.txt');
  });

  it('migrates with confirm: the versions of the preview, the picked values, a refusal per flow and what to undo', async () => {
    const r = await rig();
    await done(r, { preview: true });
    const result = await confirmed(r, { adopt_value_ids: [valueId(1)] });
    const { text } = result;
    expect((result.outcome?.data as MigrateDocsData).kind).toBe('migrated');
    const sent = posts(r, MIGRATE)[0]?.body as {
      flow_ids?: string[];
      expected_versions?: Record<string, number>;
      adopt_value_ids?: string[];
      allow_unmatched?: boolean;
    };
    expect([...(sent.flow_ids ?? [])].sort()).toEqual([ZAKUPY, PRZEGLADANIE, KONTO].sort());
    expect(sent.expected_versions).toEqual({ [ZAKUPY]: 1, [PRZEGLADANIE]: 1, [KONTO]: 1 });
    expect(sent.adopt_value_ids).toEqual([valueId(1)]);
    expect(sent.allow_unmatched).toBe(false);
    const zakupy = flowOf(r, ZAKUPY);
    expect(zakupy.current_version).toBe(2);
    expect(zakupy.openapi_spec_id).not.toBe(SKLEP_WORLD_IDS.spec);
    const checkout = zakupy.blocks.find((block) => block.id === 'zakupy-7');
    expect((checkout?.config?.['body'] as Record<string, unknown>)['paymentMethod']).toBe('blik');
    expect(flowOf(r, KONTO).current_version).toBe(1);
    expect(text).toMatch(/^Migrated 2 of 3 flows to docs version 2\.16\.0/u);
    expect(text).toMatch(/zakupy[^\n]*v1 → v2[^\n]*1 value adopted[^\n]*undo: restore v1/u);
    expect(text).toMatch(/konto[^\n]*refused[^\n]*lost their endpoint/u);
    expect(text).toMatch(/stale[^\n]*zakupy/u);
    expect(text).toContain('scenario_generate');
    // the warning in the state is left with the flow that stays on the older version
    const warning = problemsOf(r).filter((problem) => problem.code === 'flows_on_old_docs');
    expect(warning.map((problem) => problem.flow_ids)).toEqual([[KONTO]]);
    await expect(text).toMatchFileSnapshot('__snapshots__/flowsMigrateDocs.migrated.en.txt');
  });

  it('a flow named by the user moves with allow_unmatched, and the endpoints it drops are named', async () => {
    const r = await rig();
    const { text } = await confirmed(r, { flow_ids: ['konto'], allow_unmatched: true });
    const sent = posts(r, MIGRATE)[0]?.body as { flow_ids?: string[]; allow_unmatched?: boolean };
    expect(sent.flow_ids).toEqual([KONTO]);
    expect(sent.allow_unmatched).toBe(true);
    expect(flowOf(r, KONTO).current_version).toBe(2);
    expect(text).toMatch(/dropped[^\n]*GET \/orders/u);
    expect(problemsOf(r).map((problem) => problem.code)).toContain('flows_on_old_docs');
  });

  it('a flow that changed since the card refuses the whole migration with a next step', async () => {
    const r = await rig();
    const token = await cardToken(r, {});
    r.fake.store
      .collection<FlowRecord>(SKLEP_COLLECTIONS.flows)
      .update(ZAKUPY, { current_version: 2 });
    const text = errorOf(await r.call('flows_migrate_docs', { confirm: token }));
    expect(text).toMatch(/^\[flows_migration_stale\]/u);
    expect(text).toContain('zakupy');
    expect(text).toMatch(/→ [^\n]*preview: true/u);
    expect(flowOf(r, PRZEGLADANIE).current_version).toBe(1);
  });

  it('migrates to the version the preview showed, also after a newer import, and never leaves the target out', async () => {
    const r = await rig();
    const { data } = await done(r, { preview: true });
    const shown = data.kind === 'preview' ? data.target.id : '';
    expect(posts(r, PREVIEW)[0]?.body).toMatchObject({ target_spec_id: shown });
    // the user imports another version between the preview and the yes
    const third = saveSpecification(r.fake.store, SKLEP_IDS.project, {
      openapi: '3.0.3',
      info: { title: 'Sklep API', version: '2.17.0' },
      paths: {},
    });
    expect(third).not.toBe(shown);
    const token = await cardToken(r, { allow_unmatched: true });
    const fourth = saveSpecification(r.fake.store, SKLEP_IDS.project, {
      openapi: '3.0.3',
      info: { title: 'Sklep API', version: '2.18.0' },
      paths: {},
    });
    expect(fourth).not.toBe(third);
    await done(r, { allow_unmatched: true, confirm: token });
    expect(posts(r, MIGRATE)[0]?.body).toMatchObject({ target_spec_id: third });
    expect(flowOf(r, ZAKUPY).openapi_spec_id).toBe(third);
  });

  it('migrates to the version the preview showed when the card names it', async () => {
    const r = await rig();
    const { data } = await done(r, { preview: true });
    const shown = data.kind === 'preview' ? data.target.id : '';
    const token = await cardToken(r, { target_spec_id: shown, allow_unmatched: true });
    saveSpecification(r.fake.store, SKLEP_IDS.project, {
      openapi: '3.0.3',
      info: { title: 'Sklep API', version: '2.17.0' },
      paths: {},
    });
    await done(r, { allow_unmatched: true, confirm: token });
    expect(posts(r, MIGRATE)[0]?.body).toMatchObject({ target_spec_id: shown });
    expect(flowOf(r, ZAKUPY).openapi_spec_id).toBe(shown);
  });

  it('a flow that changed while LoadCraft wrote rolls the whole migration back, shown as such', async () => {
    const r = await rig();
    const token = await cardToken(r, {});
    r.fake.faults.next('POST', MIGRATE, {
      status: 409,
      body: {
        detail: {
          code: 'write_conflict',
          message: 'A flow changed during the write; nothing was saved.',
          flow_ids: [ZAKUPY],
          value_ids: [],
        },
      },
    });
    const text = errorOf(await r.call('flows_migrate_docs', { confirm: token }));
    expect(text).toMatch(/^\[flows_migration_conflict\]/u);
    expect(text).toMatch(/zakupy[^\n]*rolled back/u);
    expect(text).toMatch(/→ [^\n]*preview: true/u);
  });

  it('value ids the preview did not give are refused with the ids named', async () => {
    const r = await rig();
    const text = errorOf(
      await confirmed(r, {
        allow_unmatched: true,
        adopt_value_ids: [`${ZAKUPY}:1:${NEWER}:zakupy-1:body:nope`],
      }),
    );
    expect(text).toMatch(/^\[flows_migration_values_unknown\]/u);
    expect(text).toContain('zakupy-1:body:nope');
    expect(text).toMatch(/→ [^\n]*preview: true/u);
  });

  it.each([
    [
      'without a card',
      async (): Promise<string> => Promise.resolve('0123456789abcdef'),
      {},
      'missing',
    ],
    [
      "with a token that is not the card's",
      async (r: ToolRig): Promise<string> => {
        await cardToken(r, {});
        return '0123456789abcdef';
      },
      {},
      'token',
    ],
    [
      'with other arguments than the card',
      async (r: ToolRig): Promise<string> => cardToken(r, {}),
      { allow_unmatched: true, adopt_values: 'all' },
      'changed',
    ],
    [
      'after a preview made since the card',
      async (r: ToolRig): Promise<string> => {
        const token = await cardToken(r, {});
        await done(r, { preview: true });
        return token;
      },
      {},
      'missing',
    ],
    [
      'after the card expired (30 minutes)',
      async (r: ToolRig): Promise<string> => {
        const token = await cardToken(r, {});
        await r.clock.advance(31 * 60_000);
        return token;
      },
      {},
      'expired',
    ],
  ] as const)('a confirm %s gets a new card and sends nothing', async (_how, before, args, why) => {
    const r = await rig();
    const token = await before(r);
    const { text, data } = await done(r, { ...args, confirm: token });
    expect(data.kind).toBe('card');
    expect(data.kind === 'card' ? data.renewed : undefined).toBe(why);
    expect(data.kind === 'card' ? data.token : '').not.toBe(token);
    expect(text).toMatch(/^Nothing was migrated/u);
    expect(posts(r, MIGRATE)).toEqual([]);
  });

  it('the write takes what the card froze, not what the confirm repeats', async () => {
    const r = await rig();
    const token = await cardToken(r, { flow_ids: ['konto', 'zakupy'], allow_unmatched: true });
    // the confirm leaves the arguments out: they are the card's
    await done(r, { confirm: token });
    const sent = posts(r, MIGRATE)[0]?.body as { flow_ids?: string[]; allow_unmatched?: boolean };
    expect([...(sent.flow_ids ?? [])].sort()).toEqual([KONTO, ZAKUPY].sort());
    expect(sent.allow_unmatched).toBe(true);
    // the card is used up
    const again = await done(r, { confirm: token });
    expect(again.data.kind).toBe('card');
    expect(posts(r, MIGRATE)).toHaveLength(1);
  });

  it('a preview never writes, also with the valid token of a card', async () => {
    const r = await rig();
    const token = await cardToken(r, {});
    const { data } = await done(r, { preview: true, confirm: token });
    expect(data.kind).toBe('preview');
    expect(posts(r, MIGRATE)).toEqual([]);
    expect(posts(r, PREVIEW)).toHaveLength(1);
    expect(flowOf(r, ZAKUPY).current_version).toBe(1);
  });

  it('a card is gone after a 409: the same token gets a new card', async () => {
    const r = await rig();
    const token = await cardToken(r, {});
    r.fake.store
      .collection<FlowRecord>(SKLEP_COLLECTIONS.flows)
      .update(ZAKUPY, { current_version: 2 });
    errorOf(await r.call('flows_migrate_docs', { confirm: token }));
    const { data } = await done(r, { confirm: token });
    expect(data.kind === 'card' ? data.renewed : undefined).toBe('missing');
    expect(posts(r, MIGRATE)).toHaveLength(1);
  });

  it('a migration whose list cannot be read afterwards still succeeds and follows its results', async () => {
    const r = await rig();
    const token = await cardToken(r, { allow_unmatched: true });
    failListAfterMigration(r.fake);
    const result = await r.call('flows_migrate_docs', { allow_unmatched: true, confirm: token });
    expect(result.isError).toBe(false);
    const data = result.outcome?.data as MigrateDocsData;
    expect(data.kind, result.text).toBe('migrated');
    expect(data.kind === 'migrated' ? data.listNotRefreshed : undefined).toBe(true);
    expect(result.text).toContain('could not be read after the migration');
    expect(result.text).toContain('undo: restore v1');
    // every flow moved: no warning left
    expect(problemsOf(r).map((problem) => problem.code)).not.toContain('flows_on_old_docs');
  });

  it('says there is nothing to migrate when every flow is on the current version', async () => {
    const r = await rig({ newer: false });
    const { text, data } = await done(r, { preview: true });
    expect(data.kind).toBe('nothing');
    expect(text).toContain('No flow is on an older docs version');
    expect(posts(r, PREVIEW)).toEqual([]);
  });

  it('refuses readably on a server without the migration and sends nothing', async () => {
    const r = await rig({ capable: false });
    const text = errorOf(await r.call('flows_migrate_docs', { preview: true }));
    expect(text).toMatch(/^\[backend_too_old\]/u);
    expect(text).toContain('flows_spec_migration');
    expect(posts(r, PREVIEW)).toEqual([]);
  });

  it('draws the card in Polish', async () => {
    const r = await rig({ locale: 'pl' });
    const { text } = await done(r, {});
    expect(text).toMatch(/^Migracja 3 flowów na bieżącą wersję dokumentacji/u);
    await expect(anyToken(text)).toMatchFileSnapshot('__snapshots__/flowsMigrateDocs.card.pl.txt');
  });
});
