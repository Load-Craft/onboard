// `functional_suggest_test_types` (module functional), a long operation on a consent card (level 2, costly;
// docs/long-operation.md): a card with the cost and no request, the channel `testTypes` joined once the run
// has started, the progress, the suggestions, the outcome read through REST when the frames were lost,
// `process_wait`, `process_cancel` (the run cannot be stopped), and what reaches the state file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { functionalSuggestTestTypes } from '../../../src/tools/functional/suggestTestTypes.js';
import { processCancel } from '../../../src/tools/processCancel.js';
import { processWait } from '../../../src/tools/processWait.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import {
  scriptTestTypes,
  type TestTypesScript,
} from '../../fake-backend/routes/functionalProcess.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock, settleClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';
import { BOUND } from './rig.js';

vi.setConfig({ testTimeout: 120_000 });

const TOOL = 'functional_suggest_test_types';
const PROJECT = SKLEP_IDS.project;
const DOCS = '3b9d1c2e-0001-4c00-8000-000000000001';
const ARGS = { docs_id: DOCS } as const;
const NOW = '2026-11-27T12:00:00.000Z';

const SUGGESTION = {
  category: 'security',
  description: 'Rate limits hold',
  display_name: 'Rate limits',
  example_inputs: [{ burst: 100 }, { burst: 1000 }],
  expected_outcome: 'blocked',
  input_generation_prompt: 'Make bursts of requests',
  name: 'rate_limits',
  rationale: 'The docs name a 429',
};

function stateFile(docs: string | null = DOCS): string {
  const empty = newProcess(PROJECT, NOW);
  const ids = docs === null ? empty.ids : { ...empty.ids, docs_id: docs };
  return JSON.stringify({ schema: 3, process: { [PROJECT]: { ...empty, ids } } });
}

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly script?: TestTypesScript;
  readonly docs?: string | null;
}

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: [functionalSuggestTestTypes, processWait, processCancel],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      scriptTestTypes(fake, options.script ?? { suggestions: [SUGGESTION] });
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': stateFile(options.docs),
    },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

/** The card, then the repeat after the yes, with the test clock moving until the call settles. */
async function run(
  r: ToolRig,
  args: Record<string, unknown> = ARGS,
  seconds = 200,
): Promise<RigCallResult> {
  const card = await r.call(TOOL, args);
  expect(card.isError, card.text).toBe(false);
  return settleClock(r, r.call(TOOL, args), { limitMs: seconds * 1000 });
}

const starts = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.method === 'POST' && call.path.endsWith('/suggest-async'))
    .map((call) => call.path);

interface Saved {
  operations: { handle: string; kind: string; status: string }[];
  log: { tool: string; args: string; result: string; status: string; undo?: unknown }[];
}
function saved(r: ToolRig): Saved {
  const raw = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const process = (JSON.parse(raw) as { process: Record<string, Saved> }).process[PROJECT];
  if (process === undefined) throw new Error('no process in the state file');
  return process;
}

describe('functional_suggest_test_types: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalSuggestTestTypes);
    expect(functionalSuggestTestTypes.implemented).toBe(true);
    expect(functionalSuggestTestTypes.onCard).toBe(true);
  });

  it('the first call makes the card with the cost and the focus and sends nothing, not even a read', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, { ...ARGS, focus_areas: 'security, limits, security' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Consent needed (level 2) · Suggest test types from the API docs',
        `  reads the API docs ${DOCS} of the project`,
        '  focus: security, limits',
        'Cost: one LLM run; nothing is saved',
        'Nothing to undo: nothing is saved, the run only proposes',
        'Nothing was done yet. Tell the user what this card says. To go on, call functional_suggest_test_types again with the same arguments: the user is then asked to confirm in a dialog, and only their yes there runs it. The card is valid for 30 min.',
      ].join('\n'),
    );
    expect(starts(r)).toEqual([]);
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
    expect(who.asked).toEqual([]);
  });

  it('a docs_id that is not the active docs is refused before a card; docs_id is required', async () => {
    const r = await rig();
    const other = await r.call(TOOL, { docs_id: '3b9d1c2e-0002-4c00-8000-000000000002' });
    expect(other.text).toMatch(/^\[invalid_arguments\] /u);
    for (const args of [
      {},
      { docs_id: 'x' },
      { ...ARGS, confirm: true },
      { ...ARGS, max_wait_s: 5 },
    ]) {
      expect((await r.call(TOOL, args)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(starts(r)).toEqual([]);
  });

  it('declined, unticked and cancelled start nothing', async () => {
    for (const answer of ['declined', 'unticked', 'cancelled'] as const) {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, ARGS);
      expect((await r.call(TOOL, ARGS)).text).toMatch(/^\[consent_missing\] /u);
      expect(starts(r)).toEqual([]);
    }
    const silent = await rig({ who: null });
    expect((await silent.call(TOOL, ARGS)).text).toMatch(/^\[consent_missing\] /u);
  });
});

describe('functional_suggest_test_types: the run', () => {
  it('starts one run after the yes, with the focus as a list, and draws the suggestions with what accepting one needs', async () => {
    const r = await rig({ script: { endMs: 0, suggestions: [SUGGESTION] } });
    const result = await run(r, { ...ARGS, focus_areas: 'security, limits' });
    expect(result.isError, result.text).toBe(false);
    expect(starts(r)).toHaveLength(1);
    expect(r.fake.calls.find((call) => call.path.endsWith('/suggest-async'))?.body).toEqual({
      focus_areas: ['security', 'limits'],
    });
    expect(writesOf(r, PROJECT)).toEqual(['POST /test-types/suggest-async']);
    expect(result.text).toBe(
      [
        '1 test type suggested (nothing is saved):',
        '- rate_limits (Rate limits), category security',
        '  description: Rate limits hold',
        '  expected outcome: blocked',
        '  input prompt: Make bursts of requests',
        '  why: The docs name a 429 (2 example inputs)',
        'To save one, call functional_save_test_types with source suggestions: the name as the key of items, and category, display_name, description, input_prompt (the input prompt above) and expected_outcome as its fields.',
      ].join('\n'),
    );
  });

  it('reports progress as the backend gives it, and logs the call with the catalog templates; no undo', async () => {
    const r = await rig({ script: { suggestions: [SUGGESTION] } });
    const result = await run(r);
    const lines = result.progress.map((entry) => entry.message ?? '');
    expect(lines).toEqual(
      expect.arrayContaining(['Suggesting test types: the model is working (55%)']),
    );
    const log = saved(r).log;
    expect(log.map((entry) => [entry.tool, entry.args, entry.result, entry.status])).toEqual([
      [TOOL, 'Suggest test types from the API docs', "awaiting the user's decision", 'queued'],
      [TOOL, 'Suggest test types from the API docs', '1 test types proposed', 'ok'],
    ]);
    expect(log.at(-1)?.undo).toBeUndefined();
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'test_types_generation')
        .map((row) => row.status),
    ).toEqual(['done']);
  });

  it('no suggestions is said; the data carries the numbers; Polish speaks', async () => {
    const empty = await rig({
      script: { endMs: 0, suggestions: [], omitted: ['GET /a', 'GET /b'] },
    });
    const result = await run(empty);
    expect(result.text.split('\n')).toEqual([
      'No test types suggested.',
      '2 operations of a large API were not shown to the model.',
    ]);
    const pl = await rig({ locale: 'pl', script: { endMs: 0, suggestions: [SUGGESTION] } });
    expect((await run(pl)).text.split('\n')[0]).toBe(
      'Zaproponowano 1 typ testu (nic nie jest zapisane):',
    );
  });

  it('more than 20 suggestions show the first 20 and count the rest', async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      ...SUGGESTION,
      name: `type_${String(i)}`,
    }));
    const r = await rig({ script: { endMs: 0, suggestions: many } });
    const result = await run(r);
    expect(result.text.split('\n')[0]).toBe('23 test types suggested (nothing is saved):');
    expect(result.text).toContain('type_19');
    expect(result.text).not.toContain('type_20');
    expect(result.text).toContain('and 3 more, not shown');
  });
});

describe('functional_suggest_test_types: a long run, resumed, joined and lost', () => {
  const LONG: TestTypesScript = { endMs: 130_000, suggestions: [SUGGESTION] };

  it('past the limit of one call it returns the handle; process_wait finishes it with the same view', async () => {
    const r = await rig({ script: LONG });
    const first = await run(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const handle = (first.outcome as { operation: string }).operation;
    expect(handle).toMatch(/^test_types_generation:[0-9a-f-]{36}$/u);
    const done = await settleClock(r, r.call('process_wait', { operation: handle }), {
      limitMs: 200_000,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('rate_limits (Rate limits)');
  });

  it('the same work asked again while it runs goes on with the same operation: one request starts the run', async () => {
    const r = await rig({ script: LONG });
    expect((await run(r)).outcome).toMatchObject({ status: 'running' });
    const again = await run(r);
    expect(again.isError, again.text).toBe(false);
    expect(again.text).toContain('rate_limits');
    expect(starts(r)).toHaveLength(1);
  });

  it('a lost channel does not lose the result: the outcome comes through REST', async () => {
    const r = await rig({ script: { endMs: 5000, suggestions: [SUGGESTION] } });
    r.fake.faults.blockWebSocket();
    const result = await run(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('rate_limits (Rate limits)');
  });

  it('frames sent before the socket joined are lost; the outcome is still read through REST', async () => {
    const r = await rig({ script: { endMs: 0, suggestions: [SUGGESTION] } });
    const result = await run(r);
    expect(result.text).toContain('rate_limits (Rate limits)');
  });

  it('process_cancel says the run cannot be stopped', async () => {
    const r = await rig({ script: LONG });
    const first = await run(r);
    const handle = (first.outcome as { operation: string }).operation;
    const result = await settleClock(r, r.call('process_cancel', { operation: handle }), {
      limitMs: 10_000,
    });
    expect(result.text.toLowerCase()).toMatch(/cannot be stopped|can't be stopped|not.*stopp/u);
  });

  it('an error frame is the code of the module with its cause, and the row of the operation fails', async () => {
    const r = await rig({
      script: { endMs: 2000, outcome: { error: 'The docs have no operations' } },
    });
    const result = await run(r);
    expect(result.text).toMatch(/^\[functional_test_types_failed\] /u);
    expect(result.text).toContain('The docs have no operations');
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'test_types_generation')
        .map((row) => row.status),
    ).toEqual(['failed']);
  });
});

describe('functional_suggest_test_types: what never reaches the model or the state', () => {
  it('a credential in a suggestion or in the cause of a failure is masked, and no operation entry or state file holds it', async () => {
    const poisoned = await rig({
      script: {
        endMs: 0,
        suggestions: [
          {
            ...SUGGESTION,
            name: `probe password: ${BACKEND_CANARY}`,
            description: `Authorization: Bearer ${SHAPE_CANARY}`,
            input_generation_prompt: `use token ${BACKEND_CANARY}\u001b[31m`,
            rationale: `password=${BACKEND_CANARY}`,
          },
        ],
      },
    });
    const result = await run(poisoned);
    expect(result.isError, result.text).toBe(false);
    for (const secret of [BACKEND_CANARY, SHAPE_CANARY, '\u001b']) {
      expect(result.text).not.toContain(secret);
    }
    poisoned.assertClean();

    const failing = await rig({
      script: { endMs: 1000, outcome: { error: `cannot read password: ${BACKEND_CANARY}` } },
    });
    const failed = await run(failing);
    expect(failed.text).not.toContain(BACKEND_CANARY);
    failing.assertClean();
  });
});
