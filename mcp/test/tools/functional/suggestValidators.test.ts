// `functional_suggest_validators` (module functional) on a consent card, level 2, costly: the first
// call makes the card (the docs, the cost line) and sends nothing; the repeat with the same arguments
// asks the person in the client's dialog and only their yes runs the one model call. Nothing is saved,
// so the entry has no undo.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { functionalSuggestValidators } from '../../../src/tools/functional/suggestValidators.js';
import { seedDiscovery } from '../../fake-backend/routes/functionalConsentWrites.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH, SHAPE_CANARY } from '../../helpers/canary.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { RigCallResult, ToolRig } from '../../helpers/rig.js';
import { loggedCalls } from '../../helpers/undo.js';
import { functionalRig, PROJECT, BOUND } from './rig.js';
import { newProcess } from '../../../src/workspace/migrate.js';

const TOOL = 'functional_suggest_validators';
const DOCS = '3b9d1c2e-0001-4c00-8000-000000000001';
const OTHER_DOCS = '3b9d1c2e-0002-4c00-8000-000000000002';

const proposal = (over: Record<string, unknown> = {}) => ({
  bucket: 'high',
  confidence: 0.91,
  description: 'The status is 200',
  display_name: 'Status is ok',
  evidence_count: 40,
  evidence_source: 'response_samples',
  fields: ['status'],
  name: 'status_is_ok',
  params: { code: 200 },
  rationale: 'seen in 40 runs',
  template: 'status == {code}',
  ...over,
});
const answer = (proposals: ReturnType<typeof proposal>[]) => ({
  already_in_project: 1,
  considered_count: proposals.length + 2,
  rejected_count: 2,
  proposals,
  evidence_summary: {
    basis: 'recorded_responses' as const,
    has_app_description: 1,
    openapi_schemas: 3,
    operations: 4,
    operations_not_shown: 0,
    response_samples: 9,
    sampled_operations: 3,
  },
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly proposals?: ReturnType<typeof proposal>[];
  readonly activeDocs?: string;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  const empty = newProcess(PROJECT, '2026-11-27T12:00:00.000Z');
  const state = JSON.stringify({
    schema: 3,
    process: {
      [PROJECT]: { ...empty, ids: { ...empty.ids, docs_id: options.activeDocs ?? DOCS } },
    },
  });
  return functionalRig({
    tools: [functionalSuggestValidators],
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(who === null ? {} : { elicit: answering(who) }),
    files: { 'loadcraft/project.json': BOUND, 'loadcraft/.cache/state.json': state },
    seed: (fake) => {
      seedDiscovery(fake.store, answer(options.proposals ?? [proposal()]));
    },
  });
}

const writes = (r: ToolRig) => writesOf(r, PROJECT);
const code = (result: RigCallResult): string | undefined =>
  result.isError ? /^\[([a-z_]+)\]/u.exec(result.text)?.[1] : undefined;
const kept = (r: ToolRig): string[] => {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { drafts?: Record<string, unknown> };
  return Object.keys(state.drafts ?? {}).filter((key) => key.startsWith(`card:${TOOL}:`));
};

describe('functional_suggest_validators: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalSuggestValidators);
    expect(functionalSuggestValidators.implemented).toBe(true);
  });

  it('the first call makes the card with the cost line and sends nothing, not even a read', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { docs_id: DOCS });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Suggest validators from the API docs and recorded runs',
        `  reads the API docs ${DOCS} and the recorded runs of the project`,
        'Cost: one LLM run; nothing is saved',
        'Nothing to undo: nothing is saved, the suggestion only proposes',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_suggest_validators again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
    expect(who.asked).toEqual([]);
    expect(loggedCalls(r).at(-1)).toMatchObject({
      tool: TOOL,
      status: 'queued',
      args: 'Suggest validators from the API docs and recorded runs',
    });
    expect(kept(r)).toHaveLength(1);
  });

  it('answers in Polish with every line of the card and of the result', async () => {
    const r = await rig({ locale: 'pl' });
    const card = await r.call(TOOL, { docs_id: DOCS });
    expect(card.text.split('\n').slice(0, 4)).toEqual([
      'Potrzebna zgoda (poziom 2) · Propozycje walidatorów z dokumentacji API i zapisanych przebiegów',
      `  czyta dokumentację API ${DOCS} i zapisane przebiegi projektu`,
      'Koszt: jedno uruchomienie modelu; nic nie jest zapisywane',
      'Nie ma czego cofać: nic nie jest zapisywane, to tylko propozycje',
    ]);
    const done = await r.call(TOOL, { docs_id: DOCS });
    expect(done.text.split('\n').slice(0, 2)).toEqual([
      'Zaproponowano 1 walidator (nic nie jest zapisane):',
      'Oparte na zapisanych odpowiedziach.',
    ]);
  });
});

describe('functional_suggest_validators: the decision', () => {
  it("the person's yes runs the one POST; the proposals carry what functional_save_validators needs; no undo", async () => {
    const who = person();
    const r = await rig({ who });
    await r.call(TOOL, { docs_id: DOCS });
    const done = await r.call(TOOL, { docs_id: DOCS });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(
      [
        '1 validator proposed (nothing is saved):',
        'Built on recorded responses.',
        '- status_is_ok (Status is ok): high, confidence 91%',
        '  description: The status is 200',
        '  template: status == {code}',
        '  parameters: {"code":200}',
        '  why: seen in 40 runs (evidence: response_samples, 40)',
        'The project already has 1 similar validators.',
        'To save one, call functional_save_validators with source proposals: the name as the key of items, and display_name, description, template, default_params (the parameters above) and rationale as its fields.',
      ].join('\n'),
    );
    expect(who.asked).toHaveLength(1);
    expect(who.asked[0]).toContain('Cost: one LLM run');
    expect(writes(r)).toEqual(['POST /validators/discover']);
    const entry = loggedCalls(r).at(-1);
    expect(entry).toMatchObject({
      tool: TOOL,
      status: 'ok',
      result: '1 validators proposed',
      consent: { via: 'client_dialog' },
    });
    expect(entry?.undo).toBeUndefined();
    expect(kept(r)).toEqual([]);
  });

  it('an answer with no proposals says what the model considered and the guardrails dropped', async () => {
    const r = await rig({ proposals: [] });
    await r.call(TOOL, { docs_id: DOCS });
    const done = await r.call(TOOL, { docs_id: DOCS });
    expect(done.text.split('\n')[0]).toBe(
      'No validators proposed: the model considered 2, the guardrails rejected 2.',
    );
  });

  it('more than 20 proposals show the first 20 and count the rest', async () => {
    const many = Array.from({ length: 23 }, (_, i) => proposal({ name: `check_${String(i)}` }));
    const r = await rig({ proposals: many });
    await r.call(TOOL, { docs_id: DOCS });
    const done = await r.call(TOOL, { docs_id: DOCS });
    expect(done.text.split('\n')[0]).toBe('23 validators proposed (nothing is saved):');
    expect(done.text).toContain('check_19');
    expect(done.text).not.toContain('check_20');
    expect(done.text).toContain('and 3 more, not shown');
  });

  it.each(['unticked', 'declined', 'cancelled'] as const)(
    'the person answering %s runs nothing: consent_missing, and the card is gone',
    async (answerKind) => {
      const r = await rig({ who: person(answerKind) });
      await r.call(TOOL, { docs_id: DOCS });
      expect(code(await r.call(TOOL, { docs_id: DOCS }))).toBe('consent_missing');
      expect(writes(r)).toEqual([]);
      expect(kept(r)).toEqual([]);
    },
  );

  it('the model has no argument that confirms; a client that cannot ask gets consent_missing', async () => {
    const r = await rig();
    for (const extra of [{ confirm: true }, { consent: 'given' }, { token: 'abc' }]) {
      const result = await r.call(TOOL, { docs_id: DOCS, ...extra });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    }
    const silent = await rig({ who: null });
    expect(code(await silent.call(TOOL, { docs_id: DOCS }))).toBe('consent_missing');
    expect(writes(r)).toEqual([]);
    expect(kept(silent)).toEqual([]);
  });
});

describe('functional_suggest_validators: arguments and the backend', () => {
  it('docs_id is required and must be a UUID; one that is not the active docs is refused before a card', async () => {
    const r = await rig();
    expect((await r.call(TOOL, {})).isError).toBe(true);
    expect((await r.call(TOOL, { docs_id: 'x' })).isError).toBe(true);
    expect(code(await r.call(TOOL, { docs_id: OTHER_DOCS }))).toBe('invalid_arguments');
    expect(kept(r)).toEqual([]);
    expect(writes(r)).toEqual([]);
  });

  it('a refusal of the backend (503, the model is not configured) is the error of the call, the card is spent', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/validators/discover',
      { status: 503, body: { error: 'llm_not_configured' } },
      { outsideContract: true },
    );
    await r.call(TOOL, { docs_id: DOCS });
    const failed = await r.call(TOOL, { docs_id: DOCS });
    expect(failed.isError).toBe(true);
    expect(kept(r)).toEqual([]);
    expect(loggedCalls(r).at(-1)?.undo).toBeUndefined();
  });
});

describe('functional_suggest_validators: secrets', () => {
  it('a secret in the texts of a proposal is masked in the answer and the log', async () => {
    const r = await rig({
      proposals: [
        proposal({
          name: `check password: ${BACKEND_CANARY}`,
          description: `Authorization: Bearer ${SHAPE_CANARY}`,
          template: `token ${BACKEND_CANARY}\u001b[31m`,
          params: { secret: BACKEND_CANARY },
          rationale: `password=${BACKEND_CANARY}`,
        }),
      ],
    });
    await r.call(TOOL, { docs_id: DOCS });
    const done = await r.call(TOOL, { docs_id: DOCS, format: 'data' });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    expect(done.text).not.toContain(SHAPE_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    expect(done.text).not.toContain('\u001b');
  });
});
