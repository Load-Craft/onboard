// `functional_save_validators` (module functional) on a consent card, level 2: the first call reads
// what it needs and makes the card, nothing is sent; the repeat with the same arguments asks the
// person in the client's dialog and only their yes writes. The validators in the fake backend are
// compared, not only the answer.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { functionalSaveValidators } from '../../../src/tools/functional/saveValidators.js';
import { seedCatalog, type BaseValidatorBody } from '../../fake-backend/routes/functional.js';
import { SKLEP_COLLECTIONS } from '../../fake-backend/worlds/sklep.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH, SHAPE_CANARY } from '../../helpers/canary.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { RigCallResult, ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';
import { functionalRig, PROJECT } from './rig.js';

const TOOL = 'functional_save_validators';
const BASE_A = '2b3c4d5e-0001-4b00-8000-000000000001';
const BASE_B = '2b3c4d5e-0002-4b00-8000-000000000002';
const stamp = { created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' };

type Validator = {
  id: string;
  project_id: string;
  effective_name: string;
  priority: number;
  is_enabled: boolean;
  base_validator_id?: string | null;
  custom_name?: string | null;
  custom_description?: string | null;
  default_params: Record<string, unknown>;
};

const base = (id: string, name: string): BaseValidatorBody => ({
  id,
  name,
  display_name: name.toUpperCase(),
  category: 'http',
  description: null,
  validator_type: 'assertion',
  is_active: true,
  is_builtin: true,
  activation: 'auto',
  group: 'http',
  scope: 'step',
  requires_profile_flags: [],
  ai_prompt_template: null,
  parameters: [],
  ...stamp,
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return functionalRig({
    tools: [functionalSaveValidators],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(who === null ? {} : { elicit: answering(who) }),
    seed: (fake) => {
      seedCatalog.validators(fake.store, [base(BASE_A, 'body_size'), base(BASE_B, 'header_count')]);
    },
  });
}

const stored = (r: ToolRig) => r.fake.store.collection<Validator>(SKLEP_COLLECTIONS.validators);
const first = (r: ToolRig): Validator => stored(r).list()[0] as Validator;
const writes = (r: ToolRig) => writesOf(r, PROJECT);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

const CUSTOM = {
  source: 'custom',
  items: {
    body_has_id: { display_name: 'Body has id', description: 'The body names an id', priority: 5 },
    fast_enough: { scope: 'step' },
  },
};

describe('functional_save_validators: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalSaveValidators);
    expect(functionalSaveValidators.implemented).toBe(true);
  });

  it('the first call makes the card of an addition and sends nothing', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, CUSTOM);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Save 2 validators in the project',
        '  new custom validators: 2',
        '  body_has_id: display_name: Body has id, description: The body names an id, priority: 5',
        '  fast_enough: scope: step',
        'Can be undone: an added validator is removed with functional_delete, one at a time',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_save_validators again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'queued',
      args: 'Save 2 validators in the project',
    });
    expect(kept(r)).toHaveLength(1);
  });

  it('a catalog card names the catalog validators, not their ids', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { source: 'catalog', items: { [BASE_A]: {}, [BASE_B]: {} } });
    expect(result.text.split('\n').slice(0, 4)).toEqual([
      'Consent needed (level 2) · Save 2 validators in the project',
      '  catalog validators to add: 2',
      '  body_size: -',
      '  header_count: -',
    ]);
  });

  it('a change card shows only the fields that differ; values already as given need no card', async () => {
    const who = person();
    const r = await rig({ who });
    const target = first(r);
    const card = await r.call(TOOL, {
      validator_id: target.id,
      fields: { is_enabled: target.is_enabled, priority: 9, description: 'x'.repeat(200) },
    });
    expect(card.text.split('\n').slice(0, 4)).toEqual([
      `Consent needed (level 2) · Update validator "${target.effective_name}"`,
      `  change the validator ${target.id}`,
      '  description: a long value (200)',
      '  priority: "9"',
    ]);
    const same = await r.call(TOOL, {
      validator_id: target.id,
      fields: { priority: target.priority },
    });
    expect(same.text).toBe(
      `Validator "${target.effective_name}": nothing to change, the values are already as given.`,
    );
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const args = { source: 'custom', items: { body_has_id: { scope: 'step' } } };
    expect((await r.call(TOOL, args)).text.split('\n').slice(0, 4)).toEqual([
      'Potrzebna zgoda (poziom 2) · Zapis walidatorów w projekcie: 1',
      '  nowe własne walidatory: 1',
      '  body_has_id: scope: step',
      'Da się cofnąć: dodany walidator usuwa functional_delete, po jednym',
    ]);
    expect((await r.call(TOOL, args)).text.split('\n')[0]).toBe('Zapisano 1 walidator:');
  });
});

describe('functional_save_validators: the decision', () => {
  it("the person's yes adds the validators, one POST each, priorities appended; several have no undo", async () => {
    const who = person();
    const r = await rig({ who });
    const top = Math.max(
      ...stored(r)
        .list()
        .map((item) => item.priority),
    );
    await r.call(TOOL, CUSTOM);
    const done = await r.call(TOOL, CUSTOM);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('2 validators saved:');
    expect(done.text).toContain('log keeps no undo');
    expect(who.asked).toHaveLength(1);
    expect(writes(r)).toEqual(['POST /validators', 'POST /validators']);
    const added = stored(r)
      .list()
      .filter((item) => item.custom_name !== undefined && item.custom_name !== null);
    expect(added.map((item) => [item.custom_name, item.priority])).toEqual([
      ['body_has_id', 5],
      ['fast_enough', top + 2],
    ]);
    const entry = loggedCalls(r).at(-1);
    expect(entry).toMatchObject({
      tool: TOOL,
      status: 'ok',
      result: '2 validators saved',
      consent: { via: 'client_dialog' },
    });
    expect(entry?.undo).toBeUndefined();
    expect(kept(r)).toEqual([]);
  });

  it('one added validator is undone by functional_delete from the log', async () => {
    const r = await rig();
    const args = { source: 'custom', items: { body_has_id: { scope: 'step' } } };
    await r.call(TOOL, args);
    await r.call(TOOL, args);
    const created = stored(r)
      .list()
      .find((item) => item.custom_name === 'body_has_id');
    expect(loggedCalls(r).at(-1)?.undo).toMatchObject({
      tool: 'functional_delete',
      args: { kind: 'validator', item_id: created?.id },
    });
  });

  it('catalog entries are added in bulk with one POST; those the project has are skipped', async () => {
    const r = await rig();
    const args = { source: 'catalog', items: { [BASE_A]: {}, [BASE_B]: {} } };
    await r.call(TOOL, args);
    await r.call(TOOL, args);
    await r.call(TOOL, args);
    const again = await r.call(TOOL, args);
    expect(again.text).toContain('2 were already in the project and were skipped.');
    expect(writes(r)).toEqual(['POST /validators/bulk', 'POST /validators/bulk']);
    expect(
      stored(r)
        .list()
        .filter((item) => item.base_validator_id === BASE_A),
    ).toHaveLength(1);
  });

  it('accepted proposals are additions with the fields of the proposal under the backend names', async () => {
    const r = await rig();
    const args = {
      source: 'proposals',
      items: {
        status_is_ok: {
          display_name: 'Status is ok',
          description: 'Checks the status',
          template: 'status == {code}',
          default_params: { code: 200 },
          rationale: 'seen in 40 runs',
        },
      },
    };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    expect(writes(r)).toEqual(['POST /validators']);
    expect(r.fake.calls.find((call) => call.method === 'POST')?.body).toMatchObject({
      custom_name: 'status_is_ok',
      template: 'status == {code}',
      default_params: { code: 200 },
      auto_config_reason: 'seen in 40 runs',
    });
  });

  it('a change sends only the differing fields; the undo of the entry, run through its card, puts them back', async () => {
    const r = await rig();
    const target = first(r);
    const args = {
      validator_id: target.id,
      fields: { priority: 9, is_enabled: target.is_enabled },
    };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.text.split('\n')[0]).toBe(`Validator "${target.effective_name}" saved: priority.`);
    expect(writes(r)).toEqual([`PUT /validators/${target.id}`]);
    expect(r.fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({ priority: 9 });
    const undo = loggedCalls(r).at(-1)?.undo;
    expect(undo).toMatchObject({
      tool: TOOL,
      args: { validator_id: target.id, fields: { priority: target.priority } },
    });
    await r.call(TOOL, undo?.args ?? {});
    expect((await r.call(TOOL, undo?.args ?? {})).isError).toBe(false);
    expect(stored(r).get(target.id)?.priority).toBe(target.priority);
  });

  it('a previous empty value cannot be put back and is said so', async () => {
    const r = await rig();
    const target = first(r);
    const args = { validator_id: target.id, fields: { description: 'New' } };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.text).toContain('description are not undone from the log');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, CUSTOM);
      expect(code(await r.call(TOOL, CUSTOM))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(kept(r)).toEqual([]);
    },
  );

  it('other arguments are a new card; nobody is asked, nothing is written', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, CUSTOM);
    const other = await r.call(TOOL, { source: 'custom', items: { another: { scope: 'x' } } });
    expect(other.text).toContain('another');
    expect(other.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('the model has no argument that confirms; a client that cannot ask gets consent_missing', async () => {
    const r = await rig();
    for (const extra of [{ confirm: true }, { consent: 'given' }, { token: 'abc' }]) {
      const result = await r.call(TOOL, { ...CUSTOM, ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    const silent = await rig({ who: null });
    expect(code(await silent.call(TOOL, CUSTOM))).toBe('consent_missing');
    expect(writes(r)).toEqual([]);
    expect(kept(silent)).toEqual([]);
  });
});

describe('functional_save_validators: rules and the backend', () => {
  it('each rule is invalid_arguments before any request', async () => {
    const r = await rig();
    const target = first(r);
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`v${String(i)}`, {}]));
    const bad: Record<string, unknown>[] = [
      {},
      { source: 'custom' },
      { ...CUSTOM, validator_id: target.id },
      { validator_id: target.id },
      { validator_id: target.id, fields: {} },
      { source: 'custom', items: {} },
      { source: 'custom', items: many },
      { source: 'catalog', items: { notanid: {} } },
      { source: 'catalog', items: { [BASE_A]: { scope: 'x' } } },
      { source: 'custom', items: { a: { is_enabled: true } } },
      { source: 'proposals', items: { a: { display_name: 'x' } } },
    ];
    for (const args of bad) {
      expect(code(await r.call(TOOL, args)), JSON.stringify(args).slice(0, 80)).toBe(
        'invalid_arguments',
      );
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('an unknown validator is not_found; arguments outside the catalog are refused', async () => {
    const r = await rig();
    expect(
      code(
        await r.call(TOOL, {
          validator_id: '9a8b7c6d-0001-4e00-8000-000000000001',
          fields: { priority: 1 },
        }),
      ),
    ).toBe('not_found');
    for (const args of [
      { source: 'other', items: {} },
      { ...CUSTOM, items: { a: { colour: 'red' } } },
      { validator_id: 'x', fields: { priority: 1 } },
    ]) {
      expect((await r.call(TOOL, args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(writes(r)).toEqual([]);
  });
});

describe('functional_save_validators: secrets', () => {
  it('a secret in names and texts is masked on the card, in the answer and in the log; a previous secret blocks the undo', async () => {
    const r = await rig();
    const target = first(r);
    stored(r).update(target.id, {
      effective_name: `check password: ${BACKEND_CANARY}`,
      custom_description: `Authorization: Bearer ${SHAPE_CANARY}`,
    });
    const args = { validator_id: target.id, fields: { description: 'Clean' } };
    const card = await r.call(TOOL, { ...args, format: 'data' });
    const done = await r.call(TOOL, args);
    expect(done.isError, done.text).toBe(false);
    for (const text of [card.text, done.text]) {
      expect(text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
      expect(text).not.toContain(SHAPE_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    }
    expect(done.text).toContain('cannot be undone from the log');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it('a long template of an addition is shown by its size, never as text', async () => {
    const r = await rig();
    const template = `Use token ${BACKEND_CANARY} always`.padEnd(120, ' .');
    const card = await r.call(TOOL, {
      source: 'custom',
      items: { check: { template } },
    });
    expect(card.text).toContain('template (120)');
    expect(card.text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
  });
});
