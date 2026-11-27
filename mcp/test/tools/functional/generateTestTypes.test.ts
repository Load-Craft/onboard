// `functional_generate_test_types` (module functional), a long operation on a consent card (level 2, costly):
// the card counts the base test types the project lacks and sends only reads, the run starts after the person's
// yes, creates the test types, writes the check `functional.test_types`, and is followed like any long
// operation (handle, `process_wait`, the outcome through REST when the frames were lost, no stop).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { functionalGenerateTestTypes } from '../../../src/tools/functional/generateTestTypes.js';
import { processCancel } from '../../../src/tools/processCancel.js';
import { processWait } from '../../../src/tools/processWait.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { seedCatalog, type BaseTestTypeBody } from '../../fake-backend/routes/functional.js';
import {
  scriptTestTypes,
  type TestTypesScript,
} from '../../fake-backend/routes/functionalProcess.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_COLLECTIONS, seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock, settleClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { BOUND } from './rig.js';

vi.setConfig({ testTimeout: 120_000 });

const NAME = 'functional_generate_test_types';
const PROJECT = SKLEP_IDS.project;
const NOW = '2026-11-27T12:00:00.000Z';
const stamp = { created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z' };

const base = (n: number, name: string, category: string): BaseTestTypeBody => ({
  id: `1a2b3c4d-000${String(n)}-4a00-8000-00000000000${String(n)}`,
  name,
  display_name: name,
  category,
  description: null,
  is_active: true,
  is_builtin: true,
  expected_outcome: null,
  input_generation_prompt: '',
  input_schema: {},
  example_inputs: [],
  ...stamp,
});
const BASES = [
  base(1, 'negative_testing', 'negative'),
  base(2, 'edge_cases', 'edge'),
  base(3, 'rate_limits', 'security'),
];

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly script?: TestTypesScript;
  readonly bases?: readonly BaseTestTypeBody[];
  /** Names of base types the project already has. */
  readonly have?: readonly string[];
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  const empty = newProcess(PROJECT, NOW);
  return toolRig({
    tools: [functionalGenerateTestTypes, processWait, processCancel],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      const bases = options.bases ?? BASES;
      seedCatalog.testTypes(fake.store, bases);
      const types = fake.store.collection<{ id: string; base_type_id?: string | null }>(
        SKLEP_COLLECTIONS.testTypes,
      );
      for (const record of types.list()) types.update(record.id, { base_type_id: null });
      const [first] = types.list();
      const owned = bases.find((item) => (options.have ?? []).includes(item.name));
      if (first !== undefined && owned !== undefined)
        types.update(first.id, { base_type_id: owned.id });
      scriptTestTypes(fake, options.script ?? { created: ['negative_testing', 'edge_cases'] });
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': JSON.stringify({ schema: 3, process: { [PROJECT]: empty } }),
    },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

async function run(
  r: ToolRig,
  args: Record<string, unknown> = {},
  seconds = 200,
): Promise<RigCallResult> {
  const card = await r.call(NAME, args);
  expect(card.isError, card.text).toBe(false);
  return settleClock(r, r.call(NAME, args), { limitMs: seconds * 1000 });
}

const starts = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.method === 'POST' && call.path.endsWith('/generate-async'))
    .map((call) => call.path);

interface Saved {
  operations: { handle: string; kind: string; status: string }[];
  steps: { functional: { checks: Record<string, { ok: boolean | null; by: string }> } };
  log: { tool: string; args: string; result: string; status: string; undo?: unknown }[];
}
function saved(r: ToolRig): Saved {
  const raw = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const process = (JSON.parse(raw) as { process: Record<string, Saved> }).process[PROJECT];
  if (process === undefined) throw new Error('no process in the state file');
  return process;
}
const testTypes = (r: ToolRig) =>
  r.fake.store.collection<{ id: string; effective_name: string }>(SKLEP_COLLECTIONS.testTypes);

describe('functional_generate_test_types: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalGenerateTestTypes);
    expect(functionalGenerateTestTypes.implemented).toBe(true);
    expect(functionalGenerateTestTypes.onCard).toBe(true);
  });

  it('the first call counts the missing base test types, names them and the cost, and only reads', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(NAME, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Generate the missing base test types',
        '  3 base test types are missing from the project: negative_testing, edge_cases, rate_limits',
        'Cost: one LLM run that fills the expected outcome of each type',
        'Can be undone: functional_delete removes a test type it created, one at a time',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_generate_test_types again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(writesOf(r, PROJECT)).toEqual([]);
    expect(starts(r)).toEqual([]);
    expect(who.asked).toEqual([]);
  });

  it('a base type the project has is not missing; categories narrow the list', async () => {
    const r = await rig({ have: ['edge_cases'] });
    const all = await r.call(NAME, {});
    expect(all.text).toContain(
      '2 base test types are missing from the project: negative_testing, rate_limits',
    );
    const narrowed = await r.call(NAME, { include_categories: 'Security, security' });
    expect(narrowed.text).toContain('1 base test type is missing from the project: rate_limits');
    expect(narrowed.text).toContain('only the categories: security');
  });

  it('nothing missing is answered at once: no card, nobody asked, no run', async () => {
    const who = person();
    const r = await rig({ who, bases: [BASES[0] as BaseTestTypeBody], have: ['negative_testing'] });
    const result = await r.call(NAME, {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe('Test types generated: 0 created, 1 the project already had.');
    expect(who.asked).toEqual([]);
    expect(starts(r)).toEqual([]);
  });

  it('declined, unticked and cancelled start nothing; arguments outside the catalog are refused', async () => {
    for (const answer of ['declined', 'unticked', 'cancelled'] as const) {
      const r = await rig({ who: person(answer) });
      await r.call(NAME, {});
      expect((await r.call(NAME, {})).text).toMatch(/^\[consent_missing\] /u);
      expect(starts(r)).toEqual([]);
    }
    const r = await rig();
    for (const args of [{ confirm: true }, { max_wait_s: 5 }, { include_categories: 1 }]) {
      expect((await r.call(NAME, args)).isError, JSON.stringify(args)).toBe(true);
    }
  });
});

describe('functional_generate_test_types: the run', () => {
  it('starts one run after the yes with the categories as a list, creates the test types and says so', async () => {
    const r = await rig({
      script: {
        endMs: 0,
        created: ['negative_testing', 'edge_cases'],
        skipped: 1,
        rationale: 'Chosen from the docs',
      },
    });
    const before = testTypes(r).list().length;
    const result = await run(r, { include_categories: 'negative, edge' });
    expect(result.isError, result.text).toBe(false);
    expect(starts(r)).toHaveLength(1);
    expect(r.fake.calls.find((call) => call.path.endsWith('/generate-async'))?.body).toEqual({
      include_categories: ['negative', 'edge'],
    });
    expect(testTypes(r).list()).toHaveLength(before + 2);
    const lines = result.text.split('\n');
    expect(lines[0]).toBe('Test types generated: 2 created, 1 the project already had.');
    expect(lines[1]).toMatch(/^- negative_testing \([0-9a-f-]{36}\)$/u);
    expect(lines).toContain('LoadCraft says: Chosen from the docs');
    expect(lines.at(-1)).toContain('the log keeps no undo');
  });

  it('writes the check and logs the call; exactly one created test type is undone by functional_delete', async () => {
    const one = await rig({ script: { endMs: 0, created: ['edge_cases'] } });
    await run(one);
    expect(saved(one).steps.functional.checks['test_types']).toMatchObject({ ok: true, by: NAME });
    const [entry] = saved(one).log.slice(-1);
    expect(entry).toMatchObject({
      tool: NAME,
      args: 'Generate the missing base test types',
      result: '1 test types added',
      status: 'ok',
    });
    const created = testTypes(one)
      .list()
      .find((item) => item.effective_name === 'edge_cases');
    expect(entry?.undo).toMatchObject({
      tool: 'functional_delete',
      args: { kind: 'test_type', item_id: created?.id },
    });
    const two = await rig({ script: { endMs: 0, created: ['a', 'b'] } });
    await run(two);
    expect(saved(two).log.at(-1)?.undo).toBeUndefined();
    expect(
      saved(one)
        .operations.filter((row) => row.kind === 'test_types_generation')
        .map((row) => row.status),
    ).toEqual(['done']);
  });

  it('reports progress, and speaks Polish', async () => {
    const r = await rig({ script: { created: ['edge_cases'] } });
    const result = await run(r);
    expect(result.progress.map((entry) => entry.message ?? '')).toEqual(
      expect.arrayContaining(['Generating test types: the model is working (55%)']),
    );
    const pl = await rig({ locale: 'pl', script: { endMs: 0, created: ['edge_cases'] } });
    expect((await run(pl)).text.split('\n')[0]).toBe(
      'Typy testów wygenerowane: utworzono 1, projekt miał już 0.',
    );
  });
});

describe('functional_generate_test_types: a long run, resumed, joined and lost', () => {
  const LONG: TestTypesScript = { endMs: 130_000, created: ['edge_cases'] };

  it('past the limit of one call it returns the handle; process_wait finishes it with the same view', async () => {
    const r = await rig({ script: LONG });
    const first = await run(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const handle = (first.outcome as { operation: string }).operation;
    const done = await settleClock(r, r.call('process_wait', { operation: handle }), {
      limitMs: 200_000,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('Test types generated: 1 created');
  });

  it('the same work asked again goes on with the same operation: one request starts the run', async () => {
    const r = await rig({ script: LONG });
    expect((await run(r)).outcome).toMatchObject({ status: 'running' });
    const again = await run(r);
    expect(again.isError, again.text).toBe(false);
    expect(starts(r)).toHaveLength(1);
  });

  it('frames lost or a channel lost: the outcome comes through REST', async () => {
    const silent = await rig({
      script: { endMs: 3000, outcome: 'silent', created: ['edge_cases'] },
    });
    const a = await run(silent);
    expect(a.text).toContain('Test types generated: 1 created');
    const blocked = await rig({ script: { endMs: 5000, created: ['edge_cases'] } });
    blocked.fake.faults.blockWebSocket();
    const b = await run(blocked);
    expect(b.text).toContain('Test types generated: 1 created');
  });

  it('process_cancel says the run cannot be stopped; an error frame is the code of the module', async () => {
    const r = await rig({ script: LONG });
    const first = await run(r);
    const handle = (first.outcome as { operation: string }).operation;
    const result = await settleClock(r, r.call('process_cancel', { operation: handle }), {
      limitMs: 10_000,
    });
    expect(result.text.toLowerCase()).toMatch(/cannot be stopped|can't be stopped|not.*stopp/u);
    const failing = await rig({ script: { endMs: 2000, outcome: { error: 'The model refused' } } });
    const failed = await run(failing);
    expect(failed.text).toMatch(/^\[functional_test_types_failed\] /u);
    expect(failed.text).toContain('The model refused');
  });
});

describe('functional_generate_test_types: what never reaches the model or the state', () => {
  it('a credential in a name of the base catalog or of what was created is masked everywhere', async () => {
    const poisoned = await rig({
      bases: [{ ...BASES[0], name: `probe password: ${BACKEND_CANARY}` } as BaseTestTypeBody],
      script: {
        endMs: 0,
        created: [`probe password: ${BACKEND_CANARY}`],
        rationale: `Authorization: Bearer ${SHAPE_CANARY}`,
      },
    });
    const card = await poisoned.call(NAME, {});
    const result = await settleClock(poisoned, poisoned.call(NAME, {}), { limitMs: 200_000 });
    for (const text of [card.text, result.text]) {
      expect(text).not.toContain(BACKEND_CANARY);
      expect(text).not.toContain(SHAPE_CANARY);
    }
    poisoned.assertClean();
  });
});
