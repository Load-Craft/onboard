// `functional_save_catalog` (module functional) on a consent card, level 2: the first call makes the
// card and sends nothing; the repeat with the same arguments asks the person in the client's dialog and
// only their yes writes. The shared catalog in the fake backend is compared, not only the answer.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { functionalSaveCatalog } from '../../../src/tools/functional/saveCatalog.js';
import {
  seedCatalog,
  read,
  type AssertionTypeBody,
  type BaseTestTypeBody,
  type BaseValidatorBody,
} from '../../fake-backend/routes/functional.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH, SHAPE_CANARY } from '../../helpers/canary.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { RigCallResult, ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';
import { functionalRig, PROJECT } from './rig.js';

const TOOL = 'functional_save_catalog';
const TYPE = '1a2b3c4d-0001-4a00-8000-000000000001';
const VALIDATOR = '2b3c4d5e-0001-4b00-8000-000000000001';
const ASSERTION = '3c4d5e6f-0001-4c00-8000-000000000001';
const stamp = { created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' };

const baseType = (over: Partial<BaseTestTypeBody> = {}): BaseTestTypeBody => ({
  id: TYPE,
  name: 'custom_probe',
  display_name: 'Custom probe',
  category: 'negative',
  description: 'Probes the edges',
  is_active: true,
  is_builtin: false,
  expected_outcome: null,
  input_generation_prompt: 'Make inputs',
  input_schema: {},
  example_inputs: [],
  ...stamp,
  ...over,
});
const validator = (over: Partial<BaseValidatorBody> = {}): BaseValidatorBody => ({
  id: VALIDATOR,
  name: 'status_code',
  display_name: 'Status code',
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
  ...over,
});
const assertion = (over: Partial<AssertionTypeBody> = {}): AssertionTypeBody => ({
  id: ASSERTION,
  name: 'equals',
  display_name: 'Equals',
  category: 'comparison',
  description: null,
  is_active: true,
  is_builtin: false,
  ...stamp,
  ...over,
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly type?: Partial<BaseTestTypeBody>;
  readonly validator?: Partial<BaseValidatorBody>;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return functionalRig({
    tools: [functionalSaveCatalog],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(who === null ? {} : { elicit: answering(who) }),
    seed: (fake) => {
      seedCatalog.testTypes(fake.store, [baseType(options.type)]);
      seedCatalog.validators(fake.store, [validator(options.validator)]);
      seedCatalog.assertionTypes(fake.store, [assertion()]);
    },
  });
}

const writes = (r: ToolRig) => writesOf(r, PROJECT);
const types = (r: ToolRig) => read<BaseTestTypeBody[]>(r.fake.store, 'cat-test-types') ?? [];
const validators = (r: ToolRig) => read<BaseValidatorBody[]>(r.fake.store, 'cat-validators') ?? [];
const assertions = (r: ToolRig) =>
  read<AssertionTypeBody[]>(r.fake.store, 'cat-assertion-types') ?? [];
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

const NEW_TYPE = {
  kind: 'catalog_test_type',
  name: 'rate_limits',
  fields: { category: 'load', display_name: 'Rate limits', input_generation_prompt: 'Burst it' },
};

describe('functional_save_catalog: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalSaveCatalog);
    expect(functionalSaveCatalog.implemented).toBe(true);
  });

  it('the first call makes the card for a new entry and sends nothing', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, NEW_TYPE);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Save catalog entry "rate_limits" (shared by all projects)',
        '  a new base test type',
        '  category: "load"',
        '  display_name: "Rate limits"',
        '  input_generation_prompt: "Burst it"',
        'Can be undone: functional_delete removes the new entry',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_save_catalog again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writes(r)).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(types(r)).toHaveLength(1);
    expect(loggedCalls(r).at(-1)).toMatchObject({ tool: TOOL, status: 'queued' });
    expect(kept(r)).toHaveLength(1);
  });

  it('a change card shows only the fields that differ, long values by size, a built-in entry as such', async () => {
    const r = await rig();
    const result = await r.call(TOOL, {
      kind: 'catalog_validator',
      entry_id: VALIDATOR,
      fields: { scope: 'step', group: 'status', ai_prompt_template: 'x'.repeat(200) },
    });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n').slice(0, 6)).toEqual([
      'Consent needed (level 2) · Save catalog entry "status_code" (shared by all projects)',
      `  change the base validator ${VALIDATOR}`,
      '  group: "status"',
      '  ai_prompt_template: a long value (200)',
      '  it is a built-in entry',
      'Can be undone: functional_save_catalog with the previous values of these fields',
    ]);
  });

  it('values already as given need no card: the tool answers at once', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, {
      kind: 'catalog_test_type',
      entry_id: TYPE,
      fields: { category: 'negative' },
    });
    expect(result.text).toBe(
      'base test type "custom_probe": nothing to change, the values are already as given.',
    );
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const args = {
      kind: 'catalog_assertion_type',
      entry_id: ASSERTION,
      fields: { category: 'text' },
    };
    expect((await r.call(TOOL, args)).text.split('\n').slice(0, 4)).toEqual([
      'Potrzebna zgoda (poziom 2) · Zapis wpisu katalogu „equals” (wspólny dla wszystkich projektów)',
      `  zmiana: typ asercji ${ASSERTION}`,
      '  category: „text”',
      'Da się cofnąć: functional_save_catalog z poprzednimi wartościami tych pól',
    ]);
    expect((await r.call(TOOL, args)).text).toBe('typ asercji „equals” zapisany: category.');
  });
});

describe('functional_save_catalog: the decision', () => {
  it("the person's yes creates the entry once; the entry has the dialog and the undo", async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, NEW_TYPE);
    const done = await r.call(TOOL, NEW_TYPE);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toMatch(/^base test type "rate_limits" created \([0-9a-f-]{36}\)\.$/u);
    expect(who.asked).toHaveLength(1);
    expect(writes(r)).toEqual(['POST /api/v1/base-test-types']);
    const created = types(r).find((item) => item.name === 'rate_limits');
    expect(created).toMatchObject({ category: 'load', is_builtin: false });
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'ok',
      result: 'catalog_test_type rate_limits saved',
      consent: { via: 'client_dialog' },
      undo: {
        tool: 'functional_delete',
        args: { kind: 'catalog_test_type', item_id: created?.id },
      },
    });
    expect(kept(r)).toEqual([]);
  });

  it('a validator and an assertion type are created the same way', async () => {
    const r = await rig();
    const validatorArgs = {
      kind: 'catalog_validator',
      name: 'body_size',
      fields: {
        activation: 'auto',
        category: 'http',
        display_name: 'Body size',
        group: 'http',
        scope: 'step',
        validator_type: 'assertion',
      },
    };
    const assertionArgs = {
      kind: 'catalog_assertion_type',
      name: 'matches',
      fields: { category: 'text', display_name: 'Matches' },
    };
    for (const args of [validatorArgs, assertionArgs]) {
      await r.call(TOOL, args);
      const done = await r.call(TOOL, args);
      expect(done.isError, done.text).toBe(false);
    }
    expect(writes(r)).toEqual(['POST /api/v1/base-validators', 'POST /api/v1/assertion-types']);
    expect(validators(r).some((item) => item.name === 'body_size')).toBe(true);
    expect(assertions(r).some((item) => item.name === 'matches')).toBe(true);
  });

  it('a change sends only the fields that differ; the undo of the entry, run through its card, puts them back', async () => {
    const r = await rig();
    const args = {
      kind: 'catalog_test_type',
      entry_id: TYPE,
      fields: { category: 'negative', description: 'New text', is_active: false },
    };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.text).toBe('base test type "custom_probe" saved: description, is_active.');
    expect(writes(r)).toEqual([`PUT /api/v1/base-test-types/${TYPE}`]);
    expect(r.fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      description: 'New text',
      is_active: false,
    });
    expect(types(r)[0]).toMatchObject({ description: 'New text', is_active: false });
    const undo = loggedCalls(r).at(-1)?.undo;
    expect(undo).toMatchObject({
      tool: TOOL,
      args: {
        kind: 'catalog_test_type',
        entry_id: TYPE,
        fields: { description: 'Probes the edges', is_active: true },
      },
    });
    await r.call(TOOL, undo?.args ?? {});
    const back = await r.call(TOOL, undo?.args ?? {});
    expect(back.isError, back.text).toBe(false);
    expect(types(r)[0]).toMatchObject({ description: 'Probes the edges', is_active: true });
  });

  it('a previous empty value cannot be put back and is said so', async () => {
    const r = await rig();
    const args = { kind: 'catalog_test_type', entry_id: TYPE, fields: { expected_outcome: 'ok' } };
    await r.call(TOOL, args);
    const done = await r.call(TOOL, args);
    expect(done.text).toContain('are not undone from the log');
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s changes nothing: consent_missing, and the card is gone',
    async (answer) => {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, NEW_TYPE);
      expect(code(await r.call(TOOL, NEW_TYPE))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(kept(r)).toEqual([]);
    },
  );

  it('other arguments are a new card; nobody is asked, nothing is written', async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, NEW_TYPE);
    const other = await r.call(TOOL, { ...NEW_TYPE, name: 'rate_limits_2' });
    expect(other.text).toContain('rate_limits_2');
    expect(other.text).toContain('this is a new one');
    expect(who.asked).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('the model has no argument that confirms: confirm, consent and token are refused', async () => {
    const r = await rig();
    for (const extra of [{ confirm: true }, { consent: 'given' }, { token: 'abc' }]) {
      const result = await r.call(TOOL, { ...NEW_TYPE, ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('a client that cannot ask anyone gets consent_missing and no card', async () => {
    const r = await rig({ who: null });
    for (let call = 0; call < 2; call += 1) {
      expect(code(await r.call(TOOL, NEW_TYPE))).toBe('consent_missing');
    }
    expect(writes(r)).toEqual([]);
    expect(kept(r)).toEqual([]);
  });
});

describe('functional_save_catalog: rules and the backend', () => {
  it('each rule is invalid_arguments before any request', async () => {
    const r = await rig();
    const bad: Record<string, unknown>[] = [
      { kind: 'catalog_test_type', name: 'x', fields: { category: 'a', scope: 'step' } },
      { kind: 'catalog_test_type', name: 'x', fields: { category: 'a' } },
      { kind: 'catalog_test_type', fields: NEW_TYPE.fields },
      { kind: 'catalog_test_type', entry_id: TYPE, name: 'renamed', fields: { category: 'a' } },
      { kind: 'catalog_test_type', entry_id: TYPE },
    ];
    for (const args of bad) {
      expect(code(await r.call(TOOL, args)), JSON.stringify(args)).toBe('invalid_arguments');
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
    expect(kept(r)).toEqual([]);
  });

  it('an unknown entry is not_found; arguments outside the catalog are refused', async () => {
    const r = await rig();
    const unknown = '9a8b7c6d-0001-4e00-8000-000000000001';
    expect(
      code(
        await r.call(TOOL, {
          kind: 'catalog_validator',
          entry_id: unknown,
          fields: { scope: 'a' },
        }),
      ),
    ).toBe('not_found');
    for (const args of [
      { kind: 'other', name: 'x' },
      { name: 'x' },
      { ...NEW_TYPE, id: TYPE },
      { ...NEW_TYPE, fields: { ...NEW_TYPE.fields, color: 'red' } },
    ]) {
      expect((await r.call(TOOL, args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(writes(r)).toEqual([]);
  });
});

describe('functional_save_catalog: secrets', () => {
  it('a secret in the names and texts is masked, and a previous value that holds one is not kept for undo', async () => {
    const r = await rig({
      type: {
        name: `probe password: ${BACKEND_CANARY}`,
        description: `Authorization: Bearer ${SHAPE_CANARY}`,
      },
    });
    const args = { kind: 'catalog_test_type', entry_id: TYPE, fields: { description: 'Clean' } };
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

  it('a long prompt of a new entry is shown by its size, never as text', async () => {
    const r = await rig();
    const secretPrompt = `Use token ${BACKEND_CANARY} always`.padEnd(120, ' .');
    const card = await r.call(TOOL, {
      ...NEW_TYPE,
      fields: { ...NEW_TYPE.fields, input_generation_prompt: secretPrompt },
    });
    expect(card.text).toContain('input_generation_prompt: a long value (120)');
    expect(card.text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
  });
});
