// `data_create_dataset`: a dataset from one source, after the user's yes to a consent card. A file
// of accounts keeps its passwords out of every output; rules come from a kept suggestion of the data
// hub; the rows of a slot of plain data are made from its columns. The pin is the next call.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderCreated, type CreateCardView, type CreatedView } from '../src/render/views/data.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataCreateAccounts } from '../src/tools/dataCreateAccounts.js';
import { dataCreateDataset } from '../src/tools/dataCreateDataset.js';
import { dataSetBindings } from '../src/tools/dataSetBindings.js';
import { dataSuggestActions } from '../src/tools/dataSuggestActions.js';
import { SKLEP_IDS, goldenText } from './golden/index.js';
import {
  FAKE_SLOT_STATUS,
  setFakePlanActions,
  type ForcedSlotStatus,
} from './fake-backend/routes/data.js';
import {
  FEEDER_REVISIONS,
  RULE_GENERATIONS,
  SLOT_GENERATIONS,
  type FeederRevision,
  type RecordedGeneration,
  type RecordedSlotGeneration,
} from './fake-backend/routes/provision.js';
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
  dataOf,
  dataRig,
  hubPlan,
  PASSWORD_1,
  PASSWORD_2,
  PLAIN_SLOT,
  writesOf,
  type DataRigOptions,
} from './helpers/dataWorlds.js';
import { CANARY, type ToolRig } from './helpers/rig.js';

const TOOLS = [
  dataCreateDataset,
  dataSetBindings,
  dataCheckReadiness,
  dataSuggestActions,
  dataCreateAccounts,
];
const ZAKUPY = SKLEP_WORLD_IDS.scenarios.zakupy;
const PRZEGLADANIE = SKLEP_WORLD_IDS.scenarios.przegladanie;

const rig = (options: Omit<DataRigOptions, 'tools'> = {}): Promise<ToolRig> =>
  dataRig({ tools: TOOLS, ...options });

// The rows the backend gets: the columns of the slot in its spelling, the file's other columns out.
const SENT = [
  'email,password',
  `anna@example.com,${PASSWORD_1}`,
  `jan@example.com,"${PASSWORD_2.replaceAll('"', '""')}"`,
  '',
].join('\n');

const feeders = (r: ToolRig): SklepFeeder[] =>
  r.fake.store.collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders).list();

function datasetNamed(r: ToolRig, name: string): SklepFeeder {
  const found = feeders(r).find((feeder) => feeder.name === name);
  if (found === undefined) throw new Error(`no dataset ${name}`);
  return found;
}

const picksOf = (r: ToolRig, scenarioId: string): Readonly<Record<string, string>> =>
  r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).require(scenarioId)
    .slot_bindings;

const compositionPicks = (r: ToolRig): Readonly<Record<string, string>> =>
  r.fake.store
    .collection<SklepComposition>(SKLEP_COLLECTIONS.compositions)
    .require(SKLEP_WORLD_IDS.composition).slot_bindings;

/** The text on one line: the views wrap long lines. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ');

async function create(r: ToolRig, args: Record<string, unknown>) {
  const { card, result } = await callConfirmed(r, 'data_create_dataset', args);
  return {
    ...result,
    card,
    cardData: card === undefined ? undefined : dataOf<CreateCardView>(card),
    data: dataOf<CreatedView>(result),
  };
}

const file = (r: ToolRig, extra: Record<string, unknown> = {}, path = 'data/konta.csv') =>
  create(r, { scenario: 'checkout', slot: 'accounts', file: path, name: 'konta', ...extra });

/** Runs the pin the result of a creation names. */
async function pin(r: ToolRig, data: CreatedView | undefined) {
  if (data?.next === undefined) throw new Error('the creation names no pin');
  const result = await r.call(data.next.tool, data.next.args);
  expect(result.isError, result.text).toBe(false);
  return result;
}

const json = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`./golden/run1/${name}.view.json`, import.meta.url), 'utf8'),
  ) as T;

describe('data_create_dataset with a file of accounts', () => {
  it('loads the accounts of a file into a new dataset after the card and keeps the passwords out', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await file(r);
    expect(result.isError, result.text).toBe(false);
    // The card shows the file's size and digest, never a cell; nothing was written before the yes.
    expect(result.cardData).toMatchObject({
      needsConfirmation: true,
      name: 'konta',
      source: { kind: 'file', file: 'data/konta.csv', rows: 2 },
      slot: { slot: 'accounts', target: 'checkout' },
      revision: false,
    });
    expect(result.card?.text).toContain('karta zgody · utworzenie zbioru „konta”');
    expect(result.card?.text).toMatch(/confirm: "[0-9a-f]{16}"/u);
    expect(result.text).toBe(
      goldenText('run1', '08a-data_create_dataset-konta-z-pliku').replace(/\n$/u, ''),
    );
    expect(result.data).toEqual(json<CreatedView>('08a-data_create_dataset-konta-z-pliku'));

    const konta = datasetNamed(r, 'konta');
    expect(konta.content).toBe(SENT);
    expect(konta.columns).toEqual(['email', 'password']);
    expect(konta.record_count).toBe(2);
    expect(konta.strategy).toBe('queue');
    expect(konta.file_name).toBe('accounts.csv');
    expect(writesOf(r)).toEqual(['POST /api/v1/projects/:p/gatling/feeders']);

    await pin(r, result.data);
    expect(writesOf(r)).toEqual([
      'POST /api/v1/projects/:p/gatling/feeders',
      `PUT /api/v1/projects/:p/gatling/compositions/${SKLEP_WORLD_IDS.composition}/slot-bindings`,
      `PUT /api/v1/projects/:p/gatling/scenarios/${ZAKUPY}/slot-bindings`,
      `PUT /api/v1/projects/:p/gatling/scenarios/${SKLEP_WORLD_IDS.scenarios.konto}/slot-bindings`,
    ]);
    expect(picksOf(r, SKLEP_WORLD_IDS.scenarios.konto)).toEqual({ accounts: konta.id });
    expect(compositionPicks(r)['accounts']).toBe(konta.id);

    // The backend answers every dataset read with the content: none of it may reach any output.
    const everything = JSON.stringify(r.results) + r.lines.join('\n') + result.text;
    for (const password of [PASSWORD_1, PASSWORD_2, 'Pw-', CANARY]) {
      expect(everything).not.toContain(password);
    }
    r.assertClean();
  });

  it('shows the same view in English', async () => {
    const r = await rig({ locale: 'en' });
    const { text, card } = await file(r);
    await expect(text).toMatchFileSnapshot('__snapshots__/dataCreateDataset.file.en.txt');
    await expect(card?.text.replace(/"[0-9a-f]{16}"/u, '"<token>"')).toMatchFileSnapshot(
      '__snapshots__/dataCreateDataset.card.en.txt',
    );
  });

  it('names the slot label when no name is given', async () => {
    const r = await rig();
    const result = await create(r, {
      scenario: 'checkout',
      slot: 'accounts',
      file: 'data/konta.csv',
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.data?.name).toBe('User accounts');
  });

  it('names the missing columns and never a value', async () => {
    const r = await rig({ files: { 'data/bad.csv': `login,secret\nanna,${PASSWORD_1}\n` } });
    const result = await file(r, {}, 'data/bad.csv');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('email, password');
    expect(result.text).not.toContain(PASSWORD_1);
    expect(writesOf(r)).toEqual([]);
  });

  it('refuses a file with no rows', async () => {
    const r = await rig({ files: { 'data/empty.csv': 'email,password\n' } });
    const result = await file(r, {}, 'data/empty.csv');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no rows');
    expect(writesOf(r)).toEqual([]);
  });

  it('refuses a row that is shorter than the header, naming the line only', async () => {
    const r = await rig({
      files: {
        'data/short.csv': `email,password\nanna@example.com,${PASSWORD_1}\njan@example.com\n`,
      },
    });
    const result = await file(r, {}, 'data/short.csv');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Line 3');
    expect(result.text).not.toContain(PASSWORD_1);
    expect(writesOf(r)).toEqual([]);
  });

  it('refuses a path outside the project directory, a wrong extension and a missing file', async () => {
    const r = await rig({ files: { 'data/konta.txt': 'email,password\n' } });
    for (const path of ['../konta.csv', 'data/konta.txt', 'data/none.csv']) {
      const result = await file(r, {}, path);
      expect(result.isError, path).toBe(true);
    }
    expect(writesOf(r)).toEqual([]);
  });

  it('refuses an unknown slot and sends nothing', async () => {
    const r = await rig();
    const result = await file(r, { slot: 'buyers' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('buyers');
    expect(result.text).toContain('accounts');
    expect(writesOf(r)).toEqual([]);
  });

  it('adds a revision to the dataset of that name instead of a duplicate', async () => {
    const r = await rig();
    await pin(r, (await file(r)).data);
    const first = datasetNamed(r, 'konta');
    const second = await file(r, {}, 'data/more.csv');
    expect(second.isError).toBe(false);
    expect(second.cardData).toMatchObject({ revision: true });
    expect(second.data).toMatchObject({ rows: 1, revision: true, name: 'konta' });
    expect(feeders(r).filter((feeder) => feeder.name === 'konta')).toHaveLength(1);
    expect(datasetNamed(r, 'konta')).toMatchObject({ id: first.id, record_count: 1 });
    expect(r.fake.store.collection<FeederRevision>(FEEDER_REVISIONS).list()).toHaveLength(1);
    await pin(r, second.data);
    expect(picksOf(r, SKLEP_WORLD_IDS.scenarios.konto)['accounts']).toBe(first.id);
    r.assertClean();
  });

  it('pins the clone when the backend answers a shared dataset with a copy', async () => {
    const r = await rig();
    await pin(r, (await file(r)).data);
    const first = datasetNamed(r, 'konta');
    r.fake.store
      .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
      .insert({ ...structuredClone(first), id: 'clone-1' });
    r.fake.faults.next(
      'PUT',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders/${first.id}/content`,
      {
        status: 200,
        body: {
          ...first,
          id: 'clone-1',
          record_count: 2,
          rebinding_patch: { new_feeder_id: 'clone-1', old_feeder_id: first.id },
        },
      },
    );
    const result = await file(r);
    expect(result.isError).toBe(false);
    // Two datasets now share the name: the pin names the clone by its id.
    expect(result.data?.next?.args).toMatchObject({ bindings: { accounts: 'clone-1' } });
    await pin(r, result.data);
    expect(picksOf(r, SKLEP_WORLD_IDS.scenarios.konto)['accounts']).toBe('clone-1');
  });

  it('turns a refusal of the backend into a named error with a hint', async () => {
    const r = await rig();
    r.fake.faults.next('POST', `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders`, {
      status: 403,
      body: { detail: 'Not allowed.' },
    });
    const result = await file(r);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('→');
    expect(result.text).not.toContain(PASSWORD_1);
    expect(feeders(r).filter((feeder) => feeder.name === 'konta')).toHaveLength(0);
    r.assertClean();
  });

  it('masks a password the backend quotes back in its refusal', async () => {
    // Not made of the canary: only the registration of the file's cells can mask it.
    const quoted = 'Zx9-plain-7c2e';
    const r = await rig({
      locale: 'pl',
      files: { 'data/plain.csv': `email,password\nanna@example.com,${quoted}\n` },
    });
    r.fake.faults.next('POST', `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders`, {
      status: 400,
      body: { detail: `Cell "${quoted}" starts like a spreadsheet formula.` },
    });
    const result = await file(r, {}, 'data/plain.csv');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('formula');
    expect(result.text).not.toContain(quoted);
    expect(JSON.stringify(r.results)).not.toContain(quoted);
    r.forgetLogs();
  });

  // A secret is told by the column's name (`pwd`) or by what the slot says it is (type `secret`).
  it.each([
    ['pwd', [{ name: 'pwd', type: 'string' }]],
    ['code', [{ name: 'code', type: 'secret' }]],
  ])('masks the column %s of the slot in a quoted refusal', async (column, specs) => {
    const quoted = 'Qv7-plain-91d0';
    const r = await rig({
      locale: 'pl',
      files: { 'data/odd.csv': `email,${column}\nanna@example.com,${quoted}\n` },
    });
    const scenarios = r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
    for (const scenario of scenarios.list()) {
      scenarios.update(scenario.id, {
        feeder_slots: scenario.feeder_slots.map((slot) =>
          slot.slot === 'accounts'
            ? { ...slot, columns: ['email', column], column_specs: specs }
            : slot,
        ),
      });
    }
    r.fake.faults.next('POST', `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders`, {
      status: 400,
      body: { detail: `Cell "${quoted}" starts like a spreadsheet formula.` },
    });
    const result = await file(r, {}, 'data/odd.csv');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('formula');
    expect(result.text).not.toContain(quoted);
    r.forgetLogs();
  });

  it('turns 401 into the invalid-token error and 404 on /meta into too old', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/meta', { status: 401, body: { detail: 'Invalid token' } });
    const denied = await file(r);
    expect(denied.text).toContain('did not accept the API token');
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const old = await file(r);
    expect(old.text).toContain('older than the plugin supports');
  });
});

describe('the consent card of data_create_dataset', () => {
  const args = { scenario: 'checkout', slot: 'accounts', file: 'data/konta.csv', name: 'konta' };
  const tokenOf = (result: { outcome: unknown }): string =>
    dataOf<CreateCardView>(result as never)?.confirm ?? '';

  it('writes nothing for the card, and a token serves one write', async () => {
    const r = await rig();
    const card = await r.call('data_create_dataset', args);
    expect(writesOf(r)).toEqual([]);
    const token = tokenOf(card);
    const done = await r.call('data_create_dataset', { ...args, confirm: token });
    expect(dataOf<CreatedView>(done)?.name).toBe('konta');
    const again = await r.call('data_create_dataset', { ...args, confirm: token });
    expect(dataOf<CreateCardView>(again)).toMatchObject({
      needsConfirmation: true,
      renewed: 'missing',
    });
    expect(writesOf(r)).toEqual(['POST /api/v1/projects/:p/gatling/feeders']);
  });

  it('gives a new card for other arguments, and for a file changed since the card', async () => {
    const r = await rig();
    const token = tokenOf(await r.call('data_create_dataset', args));
    const other = await r.call('data_create_dataset', { ...args, name: 'inne', confirm: token });
    expect(dataOf<CreateCardView>(other)).toMatchObject({
      needsConfirmation: true,
      renewed: 'changed',
    });
    const fresh = tokenOf(other);
    const changed = await rig({
      files: { 'data/konta.csv': 'email,password\nzoe@example.com,x1\n' },
    });
    // The same token on a workspace whose file differs: the digest is part of the card.
    expect(fresh).not.toBe('');
    const first = tokenOf(await changed.call('data_create_dataset', args));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${changed.workspace}/data/konta.csv`, 'email,password\nzoe@example.com,x2\n');
    const after = await changed.call('data_create_dataset', { ...args, confirm: first });
    expect(dataOf<CreateCardView>(after)).toMatchObject({
      needsConfirmation: true,
      renewed: 'changed',
    });
    expect(writesOf(changed)).toEqual([]);
    expect(writesOf(r)).toEqual([]);
  });

  it('takes one source', async () => {
    const r = await rig();
    for (const bad of [
      { ...args, rules: 'data_suggestion:00000000/1' },
      { scenario: 'checkout' },
      { slot: 'accounts', file: 'data/konta.csv' },
      { ...args, rows: 10 },
    ]) {
      const result = await r.call('data_create_dataset', bad);
      expect(result.isError, JSON.stringify(bad)).toBe(true);
      expect(result.text).toContain('[dataset_source]');
    }
    expect(writesOf(r)).toEqual([]);
  });
});

describe('data_create_dataset with rules of the data hub', () => {
  async function suggested(r: ToolRig): Promise<Record<string, unknown>[]> {
    const { result } = await callConfirmed(r, 'data_suggest_actions', { scenario: 'checkout' });
    const steps = dataOf<{ steps: { tool: string; args: Record<string, unknown> }[] }>(
      result,
    )?.steps;
    return (steps ?? []).filter((step) => step.tool === 'data_create_dataset').map((s) => s.args);
  }

  it('makes the dataset the suggestion proposed and names its pin', async () => {
    const r = await rig();
    setFakePlanActions(r.fake.store, hubPlan(r.fake));
    const [rules] = await suggested(r);
    // The yes to the card of the suggestion does not cover this call: it shows its own card.
    const result = await create(r, rules ?? {});
    expect(result.isError, result.text).toBe(false);
    expect(result.cardData).toMatchObject({
      name: 'rozmiary',
      rows: 300,
      source: { kind: 'rules' },
    });
    expect(r.fake.store.collection<RecordedGeneration>(RULE_GENERATIONS).list()).toEqual([
      expect.objectContaining({ name: 'rozmiary', columns: ['size'], row_count: 300 }),
    ]);
    expect(result.data?.next).toEqual({
      tool: 'data_set_bindings',
      args: { scenario: 'checkout', bindings: { order_details: 'rozmiary' } },
    });
    await pin(r, result.data);
    expect(compositionPicks(r)['order_details']).toBe(datasetNamed(r, 'rozmiary').id);
    // The rows of `rozmiary` have only `size`: no member reads the slot with that column alone.
    expect(picksOf(r, ZAKUPY)['order_details']).toBeUndefined();
  });

  it('refuses an unknown handle, a secret rule set and a taken name before anything is sent', async () => {
    const r = await rig();
    setFakePlanActions(r.fake.store, hubPlan(r.fake));
    const [rules] = await suggested(r);
    const handle = String(rules?.['rules']);
    const unknown = await r.call('data_create_dataset', { rules: 'data_suggestion:00000000/2' });
    expect(unknown.text).toContain('[suggestion_unknown]');
    // The third action makes accounts with a password column: never generated.
    const secret = await r.call('data_create_dataset', { rules: handle.replace(/\/\d+$/u, '/3') });
    expect(secret.text).toContain('[suggestion_rules_unusable]');
    const taken = await r.call('data_create_dataset', {
      rules: handle,
      name: 'frazy wyszukiwania',
    });
    expect(taken.text).toContain('[dataset_name_taken]');
    expect(writesOf(r)).toEqual([]);
  });

  it('turns a refusal of the backend into a named error with a hint', async () => {
    const r = await rig();
    setFakePlanActions(r.fake.store, hubPlan(r.fake));
    const [rules] = await suggested(r);
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders/generate-from-rules`,
      { status: 403, body: { detail: 'Not allowed.' } },
    );
    const result = await create(r, rules ?? {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('→');
  });
});

describe('data_create_dataset with the columns of a slot of plain data', () => {
  const generations = (r: ToolRig): RecordedSlotGeneration[] =>
    r.fake.store.collection<RecordedSlotGeneration>(SLOT_GENERATIONS).list();
  const PLAIN = [{ scenario: ZAKUPY, slot: contentlessSlot() }];
  const NO_SOURCE = [
    { scenario: PRZEGLADANIE, slot: contentlessSlot(['couponCode', 'voucher']) },
    { scenario: ZAKUPY, slot: contentlessSlot() },
  ];
  const slotData = (r: ToolRig, scenario = 'checkout', extra: Record<string, unknown> = {}) =>
    create(r, { scenario, slot: PLAIN_SLOT, ...extra });

  it('makes the rows from the columns of a member, then the pin goes to the composition and that member', async () => {
    const r = await rig({ slots: PLAIN });
    const result = await slotData(r);
    expect(result.isError, result.text).toBe(false);
    expect(generations(r)).toEqual([
      expect.objectContaining({
        scenario_id: ZAKUPY,
        slot: PLAIN_SLOT,
        row_count: 100,
        enrich_with_llm: false,
      }),
    ]);
    expect(flat(result.text)).toContain(
      `slot ${PLAIN_SLOT}: dataset "${PLAIN_SLOT} data" made from its columns`,
    );
    const bound = await pin(r, result.data);
    const made = datasetNamed(r, `${PLAIN_SLOT} data`);
    expect(compositionPicks(r)[PLAIN_SLOT]).toBe(made.id);
    expect(picksOf(r, ZAKUPY)[PLAIN_SLOT]).toBe(made.id);
    expect(flat(bound.text)).toContain('pinned in member scenarios: 1');
    const after = await r.call('data_check_readiness', { scenario: 'zakupy' });
    expect(after.text).not.toContain(PLAIN_SLOT + ')  missing');
    r.assertClean();
  });

  it('says it in Polish', async () => {
    const r = await rig({ locale: 'pl', slots: PLAIN });
    const result = await slotData(r);
    expect(flat(result.text)).toContain(
      `slot ${PLAIN_SLOT}: zbiór „${PLAIN_SLOT} data” z jego kolumn`,
    );
    expect(result.text).toContain('wierszy: 100');
    expect(flat(result.card?.text ?? '')).toContain(`Źródło: kolumny slotu ${PLAIN_SLOT}`);
  });

  it('takes the member whose slot has every column the composition requires', async () => {
    const r = await rig({
      slots: [
        { scenario: PRZEGLADANIE, slot: contentlessSlot(['couponCode']) },
        { scenario: ZAKUPY, slot: contentlessSlot() },
      ],
    });
    const result = await slotData(r);
    expect(result.isError, result.text).toBe(false);
    expect(generations(r).map((item) => item.scenario_id)).toEqual([ZAKUPY]);
    await pin(r, result.data);
    // Both members read the slot and the rows cover the columns of both: both hold the pick.
    const made = datasetNamed(r, `${PLAIN_SLOT} data`);
    expect(picksOf(r, PRZEGLADANIE)[PLAIN_SLOT]).toBe(made.id);
    expect(picksOf(r, ZAKUPY)[PLAIN_SLOT]).toBe(made.id);
  });

  it('pins the dataset to a single scenario', async () => {
    const r = await rig({ slots: PLAIN });
    const result = await slotData(r, 'zakupy');
    await pin(r, result.data);
    expect(writesOf(r)).toEqual([
      `POST /api/v1/projects/:p/gatling/scenarios/${ZAKUPY}/slots/${PLAIN_SLOT}/generate-feeder`,
      `PUT /api/v1/projects/:p/gatling/scenarios/${ZAKUPY}/slot-bindings`,
    ]);
    expect(picksOf(r, ZAKUPY)[PLAIN_SLOT]).toBe(datasetNamed(r, `${PLAIN_SLOT} data`).id);
  });

  it('keeps a refusal of the backend: the plan names a file and the generation is not offered again', async () => {
    const r = await rig({ slots: PLAIN });
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/scenarios/${ZAKUPY}/slots/${PLAIN_SLOT}/generate-feeder`,
      { status: 422, body: { detail: "Slot 'scenario_auto_data' carries column(s) ['email']." } },
    );
    const refused = await slotData(r);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('[slot_data_refused]');
    expect(refused.text).toContain('carries column(s)');
    expect(flat(refused.text)).toContain('data_create_dataset with file and slot');
    const plan = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(flat(plan.text)).toContain('LoadCraft refused');
    expect(flat(plan.text)).not.toContain('data_create_dataset makes its rows');
    const again = await r.call('data_create_dataset', { scenario: 'checkout', slot: PLAIN_SLOT });
    expect(again.text).toContain('[slot_data_unavailable]');
    expect(generations(r)).toEqual([]);
  });

  it.each([
    ['no member declares every column', NO_SOURCE, 'no scenario of the target declares'],
    [
      'a secret column',
      [{ scenario: ZAKUPY, slot: contentlessSlot(['code', 'password']) }],
      'secret',
    ],
  ] as const)('sends the slot to a file when %s', async (_, slots, reason) => {
    const r = await rig({ slots });
    const result = await r.call('data_create_dataset', { scenario: 'checkout', slot: PLAIN_SLOT });
    expect(result.text).toContain('[slot_data_unavailable]');
    expect(flat(result.text)).toContain(reason);
    expect(flat(result.text)).toContain('data_create_dataset with file and slot');
    expect(generations(r)).toEqual([]);
  });

  it('refuses a slot of accounts: they come from a file or data_create_accounts', async () => {
    const r = await rig();
    const result = await r.call('data_create_dataset', { scenario: 'checkout', slot: 'accounts' });
    expect(result.text).toContain('[slot_data_unavailable]');
    expect(result.text).toContain('accounts');
    expect(writesOf(r)).toEqual([]);
  });

  it('every way on the texts name has an effect: a plan that names the generation keeps it', async () => {
    for (const [slots, generates] of [
      [PLAIN, true],
      [NO_SOURCE, false],
    ] as const) {
      for (const locale of ['en', 'pl'] as const) {
        const r = await rig({ locale, slots });
        const plan = await r.call('data_check_readiness', { scenario: 'checkout' });
        const steps = dataOf<{ steps: { tool: string; args: Record<string, unknown> }[] }>(
          plan,
        )?.steps;
        expect(steps?.length ?? 0).toBe(generates ? 1 : 0);
        const refused = await r.call('data_create_accounts', {
          scenario: 'checkout',
          slot: PLAIN_SLOT,
          count: 10,
        });
        expect(refused.text).toContain('[slot_not_accounts]');
        // The refusal of the accounts names the same way on as the plan.
        expect(flat(refused.text)).toMatch(
          generates ? /data_create_dataset (with|ze) (the )?scenari/u : /(with|z) file/u,
        );
        const result = await create(r, { scenario: 'checkout', slot: PLAIN_SLOT });
        expect(result.isError).toBe(!generates);
        if (!generates) {
          expect(flat(plan.text)).toContain('couponCode, voucher, email, notes');
          expect(flat(plan.text)).toMatch(/data_create_dataset (with|z) file/u);
        }
        // The hub's auto-plan is a turn of a model: none of these calls costs one.
        expect(r.fake.calls.some((call) => call.path.endsWith('/auto-plan'))).toBe(false);
      }
    }
  });

  it('a slot that is still missing after the rows were made is not hidden', async () => {
    const r = await rig({ slots: PLAIN });
    r.fake.store
      .collection<ForcedSlotStatus>(FAKE_SLOT_STATUS)
      .insert({ id: PLAIN_SLOT, status: 'missing' });
    const result = await slotData(r);
    await pin(r, result.data);
    const plan = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(flat(plan.text)).toContain(`${PLAIN_SLOT})`);
    expect(dataOf<{ ready: boolean }>(plan)?.ready).toBe(false);
  });
});

describe('the golden view of a file of accounts', () => {
  it('renders to the golden text', () => {
    const t = createTranslator('pl');
    expect(renderCreated(json<CreatedView>('08a-data_create_dataset-konta-z-pliku'), t)).toBe(
      goldenText('run1', '08a-data_create_dataset-konta-z-pliku').replace(/\n$/u, ''),
    );
  });
});

describe('every call shows its own card: no yes covers another call', () => {
  const PLAIN = [{ scenario: ZAKUPY, slot: contentlessSlot() }];
  const slot = { scenario: 'checkout', slot: PLAIN_SLOT };
  const writeCount = (r: ToolRig): number => writesOf(r).length;

  it('without a yes nothing is written; after a yes the next call shows a card again', async () => {
    const r = await rig({ slots: PLAIN });
    const card = await r.call('data_create_dataset', slot);
    expect(dataOf<CreateCardView>(card)?.needsConfirmation).toBe(true);
    expect(card.text).toContain(
      "Cost: LoadCraft may use its model for the rows and the project's budget",
    );
    expect(card.text).not.toMatch(/covers the next calls/u);
    expect(writeCount(r)).toBe(0);
    const token = dataOf<CreateCardView>(card)?.confirm;
    await r.call('data_create_dataset', { ...slot, confirm: token });
    expect(writeCount(r)).toBe(1);
    const again = await r.call('data_create_dataset', slot);
    expect(dataOf<CreateCardView>(again)?.needsConfirmation).toBe(true);
    expect(writeCount(r)).toBe(1);
  });

  it('a yes to the card of the suggestion covers no dataset, and none covers a file of accounts', async () => {
    const r = await rig({ slots: PLAIN });
    await callConfirmed(r, 'data_suggest_actions', { scenario: 'checkout' });
    const after = await r.call('data_create_dataset', slot);
    expect(dataOf<CreateCardView>(after)?.needsConfirmation).toBe(true);
    const own = await r.call('data_create_dataset', {
      scenario: 'checkout',
      slot: 'accounts',
      file: 'data/konta.csv',
      name: 'konta',
    });
    expect(dataOf<CreateCardView>(own)?.needsConfirmation).toBe(true);
    expect(writesOf(r).filter((line) => line.endsWith('/gatling/feeders'))).toEqual([]);
  });
});
