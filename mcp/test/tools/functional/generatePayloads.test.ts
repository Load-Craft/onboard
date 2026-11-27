// `functional_generate_payloads` (module functional), a long operation on a consent card (level 2, costly):
// the card names the flows and test types, counts the cases and says where the ZIP goes; the run starts after
// the person's yes; the channel `payloadGen` joined once it has started; the ZIP, served once, is saved at
// once under the first free name, never overwriting a file, never read; `process_wait`, a lost channel, a lost
// ZIP, `process_cancel`, and what reaches the state file.

import {
  existsSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { functionalGeneratePayloads } from '../../../src/tools/functional/generatePayloads.js';
import { processCancel } from '../../../src/tools/processCancel.js';
import { processWait } from '../../../src/tools/processWait.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { seedFlows } from '../../fake-backend/routes/functional.js';
import {
  scriptPayloads,
  startedPayloads,
  type PayloadsScript,
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

const TOOL = 'functional_generate_payloads';
const PROJECT = SKLEP_IDS.project;
const NOW = '2026-11-27T12:00:00.000Z';
const FLOW_A = '4c0e2d3f-0001-4d00-8000-000000000001';
const FLOW_B = '4c0e2d3f-0002-4d00-8000-000000000002';
const stamp = { created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' };
const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('ZIPBODY-not-for-the-model'),
]);

const flow = (id: string, name: string) => ({
  id,
  name,
  description: null,
  openapi_spec_id: '3b9d1c2e-0001-4c00-8000-000000000001',
  version: '2.16.0',
  blocks_count: 1,
  blocks: [],
  edges: [],
  variables: {},
  is_active: true,
  tags: [],
  timeout_ms: 1000,
  retry_count: 0,
  retry_delay_ms: 0,
  ...stamp,
});

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly script?: PayloadsScript;
  readonly flowName?: string;
  readonly prepare?: (workspace: string) => void;
}

let TYPES: string[] = [];

function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  const empty = newProcess(PROJECT, NOW);
  return toolRig({
    tools: [functionalGeneratePayloads, processWait, processCancel],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'executed' });
      seedFlows(fake.store, [flow(FLOW_A, options.flowName ?? 'Checkout'), flow(FLOW_B, 'Login')]);
      TYPES = fake.store
        .collection<{ id: string }>(SKLEP_COLLECTIONS.testTypes)
        .list()
        .map((item) => item.id);
      scriptPayloads(fake, options.script ?? { bytes: ZIP });
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

const args = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  flow_ids: { [FLOW_A]: {}, [FLOW_B]: {} },
  test_types: { [TYPES[0] ?? '']: 3, [TYPES[1] ?? '']: 2 },
  ...over,
});

async function run(
  r: ToolRig,
  given: Record<string, unknown> = args(),
  seconds = 200,
): Promise<RigCallResult> {
  const card = await r.call(TOOL, given);
  expect(card.isError, card.text).toBe(false);
  return settleClock(r, r.call(TOOL, given), { limitMs: seconds * 1000 });
}

const starts = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.method === 'POST' && call.path.endsWith('/generate-payloads-async'))
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
const files = (r: ToolRig, dir: string): string[] =>
  existsSync(join(r.workspace, dir)) ? readdirSync(join(r.workspace, dir)).sort() : [];

describe('functional_generate_payloads: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(functionalGeneratePayloads);
    expect(functionalGeneratePayloads.implemented).toBe(true);
    expect(functionalGeneratePayloads.onCard).toBe(true);
  });

  it('the first call names the flows and test types, counts the cases, says where the ZIP goes, and only reads', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, args());
    expect(result.isError, result.text).toBe(false);
    const lines = result.text.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      'Consent needed (level 2) · Generate payloads for 2 flows',
      '  flows: Checkout, Login',
      expect.stringMatching(/^ {2}test types: .* \(3 cases\), .* \(2 cases\)$/u),
      '  test cases to generate: 10',
      '  the ZIP is saved as a new file under loadcraft/payloads/; no file is overwritten',
      'Cost: one model run per flow and test type: 2 flows x 2 test types',
      'Nothing to undo: it only writes a local file; delete the file by hand',
    ]);
    expect(writesOf(r, PROJECT)).toEqual([]);
    expect(starts(r)).toEqual([]);
    expect(who.asked).toEqual([]);
  });

  it('a file the call names is shown; one that cannot be used is refused before anything is read', async () => {
    const r = await rig();
    const named = await r.call(TOOL, args({ file: 'out/payloads.zip' }));
    expect(named.text).toContain(
      '  the ZIP is saved to out/payloads.zip, or the next free name when it is taken; no file is overwritten',
    );
    const reads = r.fake.calls.length;
    for (const file of [
      '/etc/x.zip',
      '../x.zip',
      'a/../../x.zip',
      'x.txt',
      '.hidden/x.zip',
      'C:/x.zip',
    ]) {
      const refused = await r.call(TOOL, args({ file }));
      expect(refused.text, file).toMatch(/^\[functional_payloads_file\] /u);
    }
    expect(r.fake.calls.length).toBe(reads);
  });

  it('refuses the arguments the catalog does not give, and ids and counts out of range, before any read', async () => {
    const r = await rig();
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [
        `4c0e2d3f-${String(i).padStart(4, '0')}-4d00-8000-000000000001`,
        {},
      ]),
    );
    const bad: Record<string, unknown>[] = [
      args({ confirm: true }),
      args({ max_wait_s: 5 }),
      args({ test_types: { [TYPES[0] ?? '']: 0 } }),
      args({ test_types: { [TYPES[0] ?? '']: 21 } }),
      args({ flow_ids: { [FLOW_A]: { x: 1 } } }),
      { test_types: args().test_types },
      args({ flow_ids: {} }),
      args({ flow_ids: many }),
      args({ flow_ids: { notanid: {} } }),
    ];
    for (const given of bad) {
      expect((await r.call(TOOL, given)).isError, JSON.stringify(given).slice(0, 80)).toBe(true);
    }
    expect(r.fake.calls.filter((call) => call.path.startsWith('/api/v1/'))).toEqual([]);
  });

  it('a flow the project does not have is not_found on the card, before any question', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(
      TOOL,
      args({ flow_ids: { '4c0e2d3f-0009-4d00-8000-000000000009': {} } }),
    );
    expect(result.text).toMatch(/^\[not_found\] /u);
    expect(who.asked).toEqual([]);
  });

  it('declined, unticked and cancelled start nothing', async () => {
    for (const answer of ['declined', 'unticked', 'cancelled'] as const) {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, args());
      expect((await r.call(TOOL, args())).text).toMatch(/^\[consent_missing\] /u);
      expect(starts(r)).toEqual([]);
    }
    const silent = await rig({ who: null });
    expect((await silent.call(TOOL, args())).text).toMatch(/^\[consent_missing\] /u);
  });
});

describe('functional_generate_payloads: the run and the file', () => {
  it('starts one run with the ids and the counts, saves the ZIP under loadcraft/payloads/ and says the path and the size', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    const result = await run(r);
    expect(result.isError, result.text).toBe(false);
    expect(starts(r)).toHaveLength(1);
    expect(
      r.fake.calls.find((call) => call.path.endsWith('/generate-payloads-async'))?.body,
    ).toEqual({
      flow_ids: [FLOW_A, FLOW_B],
      test_type_ids: [TYPES[0], TYPES[1]],
      test_counts: { [TYPES[0] ?? '']: 3, [TYPES[1] ?? '']: 2 },
    });
    const [run1] = startedPayloads(r.fake);
    const path = `loadcraft/payloads/payloads-${run1?.id.slice(0, 8) ?? ''}.zip`;
    expect(result.text.split('\n')[0]).toBe(
      `Payloads for 2 flows and 2 test types (10 cases) saved to ${path} (${String(ZIP.byteLength)} bytes).`,
    );
    expect(readFileSync(join(r.workspace, path))).toEqual(ZIP);
    expect(files(r, 'loadcraft/payloads')).toContain('.gitignore');
    expect(readFileSync(join(r.workspace, 'loadcraft/payloads/.gitignore'), 'utf8')).toBe('*\n');
    expect(result.text).not.toContain('ZIPBODY');
  });

  it('logs the call with the catalog templates, has no undo, ends the row of the operation', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    const result = await run(r);
    const path = /saved to (\S+) /u.exec(result.text)?.[1] ?? '';
    const log = saved(r).log;
    expect(log.map((entry) => [entry.tool, entry.args, entry.result, entry.status])).toEqual([
      [TOOL, 'Generate payloads for 2 flows', "awaiting the user's decision", 'queued'],
      [TOOL, 'Generate payloads for 2 flows', `ZIP saved to ${path}`, 'ok'],
    ]);
    expect(log.at(-1)?.undo).toBeUndefined();
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'payload_generation')
        .map((row) => row.status),
    ).toEqual(['done']);
  });

  it('a file the call names is made with its folders; a taken name is never overwritten, a symlink never followed', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    mkdirSync(join(r.workspace, 'out'));
    writeFileSync(join(r.workspace, 'out', 'p.zip'), 'MINE');
    symlinkSync(join(r.workspace, 'nowhere'), join(r.workspace, 'out', 'p-2.zip'));
    const result = await run(r, args({ file: 'out/p.zip' }));
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('saved to out/p-3.zip');
    expect(readFileSync(join(r.workspace, 'out', 'p.zip'), 'utf8')).toBe('MINE');
    expect(existsSync(join(r.workspace, 'nowhere'))).toBe(false);
    expect(readFileSync(join(r.workspace, 'out', 'p-3.zip'))).toEqual(ZIP);
    const fresh = await rig({ script: { bytes: ZIP } });
    const made = await run(fresh, args({ file: 'deep/er/payloads.zip' }));
    expect(made.text).toContain('saved to deep/er/payloads.zip');
    expect(existsSync(join(fresh.workspace, 'deep/er/payloads.zip'))).toBe(true);
  });

  it('refuses a folder that leads out of the workspace through a symlink', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    symlinkSync('/tmp', join(r.workspace, 'escape'));
    const result = await r.call(TOOL, args({ file: 'escape/x.zip' }));
    expect(result.isError).toBe(true);
    expect(starts(r)).toEqual([]);
  });

  it('reports progress as the backend gives it, and speaks Polish', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    const result = await run(r);
    expect(result.progress.map((entry) => entry.message ?? '')).toEqual(
      expect.arrayContaining(['Generating payloads: the model is generating (30%)']),
    );
    const pl = await rig({ locale: 'pl', script: { bytes: ZIP } });
    expect((await run(pl)).text).toMatch(
      /^Payloady dla flowów: 2, typów testów: 2 \(przypadków: 10\) zapisane w /u,
    );
  });
});

describe('functional_generate_payloads: a long run, resumed, joined and lost', () => {
  const LONG: PayloadsScript = { endMs: 130_000, bytes: ZIP };

  it('past the limit of one call it returns the handle; process_wait saves the ZIP and draws the same view', async () => {
    const r = await rig({ script: LONG });
    const first = await run(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const handle = (first.outcome as { operation: string }).operation;
    expect(handle).toMatch(/^payload_generation:[0-9a-f-]{36}$/u);
    const done = await settleClock(r, r.call('process_wait', { operation: handle }), {
      limitMs: 200_000,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('saved to loadcraft/payloads/');
    expect(files(r, 'loadcraft/payloads').filter((name) => name.endsWith('.zip'))).toHaveLength(1);
  });

  it('the same work asked again goes on with the same operation: one request starts it, one ZIP is saved', async () => {
    const r = await rig({ script: LONG });
    expect((await run(r)).outcome).toMatchObject({ status: 'running' });
    const again = await run(r);
    expect(again.isError, again.text).toBe(false);
    expect(starts(r)).toHaveLength(1);
    expect(files(r, 'loadcraft/payloads').filter((name) => name.endsWith('.zip'))).toHaveLength(1);
  });

  it('frames lost or a channel lost: process_wait takes the ZIP through REST once the run is done', async () => {
    const silent = await rig({ script: { endMs: 3000, outcome: 'silent', bytes: ZIP } });
    const first = await run(silent);
    const handle = (first.outcome as { operation?: string }).operation;
    const done =
      handle === undefined
        ? first
        : await settleClock(silent, silent.call('process_wait', { operation: handle }), {
            limitMs: 200_000,
          });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('saved to loadcraft/payloads/');
    expect(
      files(silent, 'loadcraft/payloads').filter((name) => name.endsWith('.zip')),
    ).toHaveLength(1);
  });

  it('a ZIP that can no longer be fetched is the code of the module, and nothing is saved', async () => {
    const r = await rig({ script: { bytes: ZIP } });
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/generate-payloads/{run_id}/download',
      { status: 404, body: { detail: 'Payloads not available' } },
      { outsideContract: true },
    );
    const result = await run(r);
    expect(result.text).toMatch(/^\[functional_payloads_lost\] /u);
    expect(files(r, 'loadcraft/payloads').filter((name) => name.endsWith('.zip'))).toEqual([]);
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
    expect(failed.text).toMatch(/^\[functional_payloads_failed\] /u);
    expect(failed.text).toContain('The model refused');
    expect(files(failing, 'loadcraft/payloads').filter((name) => name.endsWith('.zip'))).toEqual(
      [],
    );
  });
});

describe('functional_generate_payloads: what never reaches the model or the state', () => {
  it('a credential in a flow name or in the cause of a failure is masked everywhere; the ZIP is never read', async () => {
    const poisoned = await rig({
      flowName: `Checkout password: ${BACKEND_CANARY} Authorization: Bearer ${SHAPE_CANARY}`,
      script: { bytes: ZIP },
    });
    const card = await poisoned.call(TOOL, args());
    const result = await settleClock(poisoned, poisoned.call(TOOL, args()), { limitMs: 200_000 });
    for (const text of [card.text, result.text]) {
      expect(text).not.toContain(BACKEND_CANARY);
      expect(text).not.toContain(SHAPE_CANARY);
    }
    const failing = await rig({
      script: { endMs: 1000, outcome: { error: `cannot read password: ${BACKEND_CANARY}` } },
    });
    const failed = await run(failing);
    expect(failed.text).not.toContain(BACKEND_CANARY);
    failing.assertClean();
  });
});
