// `scenario_check_drift` (module scenario), the first tool written on the block of a long operation
// (docs/long-operation.md): a card, the channel `healthCheck` joined before the check starts, progress,
// the report, the score read from the cache of the backend when the channel is lost, `process_wait`,
// `process_cancel`, and what reaches the state file. Fake backend over HTTP and WebSocket, test clock.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { processCancel } from '../../../src/tools/processCancel.js';
import { processWait } from '../../../src/tools/processWait.js';
import { driftSessionOf, scenarioCheckDrift } from '../../../src/tools/scenario/checkDrift.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { State } from '../../../src/workspace/processState.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import {
  scriptHealthCheck,
  startedChecks,
  type HealthCheckScript,
} from '../../fake-backend/routes/healthCheck.js';
import type { Fake } from '../../fake-backend/server.js';
import {
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  seedSklep,
  type SklepScenario,
} from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { waitFor } from '../../helpers/async.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock, settleClock } from '../../helpers/clock.js';
import { answering, person, writesOf, type Person } from '../../helpers/consentPerson.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type RigCallResult, type ToolRig } from '../../helpers/rig.js';

vi.setConfig({ testTimeout: 120_000 });

const TOOL = 'scenario_check_drift';
const PROJECT = SKLEP_IDS.project;
const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;
const NOW = '2026-11-27T12:00:00.000Z';
const ARGS = {
  scenario_id: SCENARIO,
  reference_source: 'openapi',
  reference_id: 'spec-0001',
} as const;

const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

function stateFile(scenarios: Record<string, string> = {}): string {
  const empty = newProcess(PROJECT, NOW);
  const state = {
    schema: 3,
    process: { [PROJECT]: { ...empty, ids: { ...empty.ids, scenario_ids: scenarios } } },
  };
  State.parse(state);
  return JSON.stringify(state);
}

interface Options {
  readonly who?: Person | null;
  readonly locale?: 'en' | 'pl';
  readonly script?: HealthCheckScript;
  readonly scenarios?: Record<string, string>;
  readonly edit?: (fake: Fake) => void;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  const who = options.who === undefined ? person() : options.who;
  return toolRig({
    tools: [scenarioCheckDrift, processWait, processCancel],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      if (options.script !== undefined) scriptHealthCheck(fake, options.script);
      options.edit?.(fake);
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': stateFile(options.scenarios),
    },
    ...(who === null ? {} : { elicit: answering(who) }),
  });
}

/** The card, then the repeat after the person's yes, with the test clock moving until the call settles. */
async function runCheck(
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
    .filter((call) => call.method === 'POST' && call.path.endsWith('/health-check'))
    .map((call) => call.path);

interface Saved {
  operations: { handle: string; kind: string; status: string }[];
  problems: { code: string; severity: string; message: string; ref?: { id: string } }[];
  steps: { scenario: { checks: Record<string, { ok: boolean | null; by: string }> } };
  log: { tool: string; args: string; result: string; status: string; consent?: { via: string } }[];
}

function saved(r: ToolRig): Saved {
  const raw = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const process = (JSON.parse(raw) as { process: Record<string, Saved> }).process[PROJECT];
  if (process === undefined) throw new Error('no process in the state file');
  return process;
}

const REPORT: HealthCheckScript['result'] = {
  staleness_score: 0.62,
  covered_endpoints: [
    { method: 'GET', path_template: '/products', status: 'current', drift_details: null },
    {
      method: 'POST',
      path_template: '/cart',
      status: 'modified',
      drift_details: ['body field qty is now quantity'],
    },
    { method: 'GET', path_template: '/old', status: 'removed', drift_details: null },
  ],
  parameter_drifts: [
    {
      change_description: 'type changed from integer to string',
      endpoint: 'POST /cart',
      new_value_type: 'string',
      old_value_type: 'integer',
      param_location: 'body',
      param_name: 'quantity',
    },
  ],
  recommendations: ['Regenerate the scenario from the new documentation'],
  uncovered_endpoints: ['GET /wishlist'],
};

describe('scenario_check_drift: the card', () => {
  it('carries its catalog entry and is written on the consent card', () => {
    expectCatalogEntry(scenarioCheckDrift);
    expect(scenarioCheckDrift.implemented).toBe(true);
    expect(scenarioCheckDrift.onCard).toBe(true);
  });

  it('the first call makes the card with the cost and sends nothing; nobody is asked yet', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, ARGS);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Check drift of scenario przeglądanie');
    expect(result.text).toContain('Compared with the documentation version spec-0001');
    expect(result.text).toContain('about one LLM comparison');
    expect(starts(r)).toEqual([]);
    expect(writesOf(r, PROJECT)).toEqual([]);
    expect(who.asked).toEqual([]);
  });

  it('a scenario the project does not have is not_found on the card, before any question', async () => {
    const who = person();
    const r = await rig({ who });
    const result = await r.call(TOOL, {
      ...ARGS,
      scenario_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    });
    expect(result.text).toMatch(/^\[not_found\] /u);
    expect(who.asked).toEqual([]);
    expect(starts(r)).toEqual([]);
  });

  it('takes the scenario by name, or the only one of the workspace, and refuses what the catalog does not give', async () => {
    const byName = await rig();
    expect((await byName.call(TOOL, { ...ARGS, scenario_id: 'przeglądanie' })).text).toContain(
      'Check drift of scenario przeglądanie',
    );
    const fromState = await rig({ scenarios: { [SKLEP_WORLD_IDS.flowPrzegladanie]: SCENARIO } });
    const rest = { reference_source: ARGS.reference_source, reference_id: ARGS.reference_id };
    expect((await fromState.call(TOOL, rest)).text).toContain('przeglądanie');
    const none = await rig();
    expect((await none.call(TOOL, rest)).text).toMatch(/^\[missing_argument\] /u);
    for (const args of [
      { ...ARGS, max_wait_s: 10 },
      { ...ARGS, confirm: true },
      { scenario_id: SCENARIO, reference_id: 'x' },
      { scenario_id: SCENARIO, reference_source: 'csv', reference_id: 'x' },
      { ...ARGS, reference_id: '' },
    ]) {
      expect((await none.call(TOOL, args)).isError).toBe(true);
    }
    expect(starts(none)).toEqual([]);
  });

  it('declined, unticked and cancelled start nothing', async () => {
    for (const answer of ['declined', 'unticked', 'cancelled'] as const) {
      const r = await rig({ who: person(answer) });
      await r.call(TOOL, ARGS);
      const result = await r.call(TOOL, ARGS);
      expect(result.text).toMatch(/^\[consent_missing\] /u);
      expect(starts(r)).toEqual([]);
    }
  });
});

describe('scenario_check_drift: the check', () => {
  it('starts one check after the yes, with a session id the channel was joined under first', async () => {
    const r = await rig({ script: { endMs: 0, result: REPORT } });
    const result = await runCheck(r);
    expect(result.isError, result.text).toBe(false);
    const [only, ...more] = startedChecks(r.fake);
    expect(more).toEqual([]);
    const body = r.fake.calls.find((call) => call.path.endsWith('/health-check'))?.body as Record<
      string,
      string
    >;
    expect(body).toMatchObject({ reference_id: 'spec-0001', reference_source: 'openapi' });
    expect(body['session_id']).toBe(only?.id);
    // the session is not the id of the operation: the id is saved and shown, the session is a secret to the plugin
    expect(saved(r).operations.map((row) => row.handle)).not.toContainEqual(
      expect.stringContaining(only?.id ?? 'x'),
    );
    // the `complete` frame went out inside the request that started the check: only a connection made
    // before it could have caught it
    expect(result.text).not.toContain('Only the score was read');
    expect(result.text).toContain('staleness 0.62');
  });

  it('draws the report: changed endpoints, parameter drifts, recommendations marked as LoadCraft, what is not called', async () => {
    const r = await rig({ script: { result: REPORT } });
    const result = await runCheck(r);
    expect(result.text.split('\n')).toEqual([
      expect.stringMatching(
        /^Scenario przeglądanie: staleness 0\.62 \(0 current, 1 stale\), checked 2026-11-27 12:00$/u,
      ),
      'Compared with the documentation version spec-0001',
      '1 endpoints unchanged, 2 changed or gone, 1 parameter drifts, 1 of the reference not called',
      '  POST /cart: changed (body field qty is now quantity)',
      '  GET /old: gone from the reference',
      '  POST /cart body quantity: type changed from integer to string',
      'recommendations (LoadCraft):',
      '  - Regenerate the scenario from the new documentation',
      'endpoints of the reference the scenario does not call (1):',
      '  GET /wishlist',
    ]);
  });

  it('reports progress as the backend gives it: the node and the percent', async () => {
    const r = await rig();
    const result = await runCheck(r);
    const lines = result.progress.map((entry) => entry.message ?? '');
    // the client gets at most one notification a second, so the 20% that the 50% follows closely is not sent
    expect(lines).toEqual(
      expect.arrayContaining([
        'Starting the drift check',
        'Drift check: reading the endpoints of the reference (50%)',
        'Drift check: comparing with the scenario (60%)',
      ]),
    );
    const percent = (line: string): number => Number(/\((\d+)%\)/u.exec(line)?.[1] ?? 0);
    const seen = lines.filter((line) => /\(\d+%\)/u.test(line)).map(percent);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('writes the verdict: ok and no problem for a clean scenario; not ok and a warning with a fixed sentence for a drifted one', async () => {
    const clean = await rig({ script: { endMs: 0, result: { staleness_score: 0 } } });
    await runCheck(clean);
    expect(saved(clean).steps.scenario.checks['drift']).toMatchObject({ ok: true, by: TOOL });
    expect(saved(clean).problems).toEqual([]);

    const drifted = await rig({ script: { endMs: 0, result: REPORT } });
    await runCheck(drifted);
    expect(saved(drifted).steps.scenario.checks['drift']?.ok).toBe(false);
    expect(saved(drifted).problems).toHaveLength(1);
    expect(saved(drifted).problems[0]).toMatchObject({
      code: 'scenario_drifted',
      severity: 'warning',
      ref: { id: SCENARIO },
    });
    expect(JSON.stringify(saved(drifted).problems)).not.toContain('/cart');
  });

  it('logs the call with the templates of the catalog and ends the row of the operation', async () => {
    const r = await rig({ script: { endMs: 0, result: REPORT } });
    await runCheck(r);
    const log = saved(r).log;
    expect(log.map((entry) => [entry.tool, entry.args, entry.result, entry.status])).toEqual([
      [TOOL, 'Check drift of scenario przeglądanie', "awaiting the user's decision", 'queued'],
      [TOOL, 'Check drift of scenario przeglądanie', 'staleness 0.62', 'ok'],
    ]);
    expect(log.at(-1)?.consent).toEqual({ via: 'client_dialog' });
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'drift_check')
        .map((row) => row.status),
    ).toEqual(['done']);
  });

  it('format data carries the score as the backend gave it, the time and the report', async () => {
    const r = await rig({ script: { endMs: 0, result: REPORT } });
    await r.call(TOOL, { ...ARGS, format: 'data' });
    const result = await settleClock(r, r.call(TOOL, { ...ARGS, format: 'data' }), {
      limitMs: 200_000,
    });
    const data = JSON.parse(result.text) as {
      score: number;
      checked_at: string;
      report: { drifted_total: number; parameter_drifts_total: number };
    };
    expect(data.score).toBe(0.62);
    expect(typeof data.checked_at).toBe('string');
    expect(data.report).toMatchObject({ drifted_total: 2, parameter_drifts_total: 1 });
  });

  it('speaks Polish', async () => {
    const r = await rig({ locale: 'pl', script: { endMs: 0, result: REPORT } });
    const result = await runCheck(r);
    expect(result.text).toContain('nieaktualność 0,62');
    expect(result.text).toContain('rekomendacje (LoadCraft):');
  });
});

describe('scenario_check_drift: a long check, joined, resumed and stopped', () => {
  const LONG: HealthCheckScript = { endMs: 130_000, result: REPORT };

  it('past the limit of one call it returns the handle; process_wait finishes it with the same view', async () => {
    const r = await rig({ script: LONG });
    const first = await runCheck(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    const handle = (first.outcome as { operation: string }).operation;
    expect(handle).toMatch(/^drift_check:dc-[0-9a-f]{12}$/u);
    expect(saved(r).operations.find((row) => row.handle === handle)?.status).toBe('running');
    const done = await settleClock(r, r.call('process_wait', { operation: handle }), {
      limitMs: 200_000,
    });
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toContain('staleness 0.62');
    expect(done.text).toContain('POST /cart: changed');
  });

  it('the same work asked again while it runs goes on with the same operation: one request starts the check', async () => {
    const r = await rig({ script: LONG });
    const first = await runCheck(r);
    expect(first.outcome).toMatchObject({ status: 'running' });
    // the second call goes on with the check of the first, which ends within its limit
    const again = await runCheck(r);
    expect(again.isError, again.text).toBe(false);
    expect(again.text).toContain('staleness 0.62');
    expect(starts(r)).toHaveLength(1);
  });

  it('a lost channel does not lose the result: the score comes from the cache of the backend and the text says the report was not received', async () => {
    const r = await rig({ script: { endMs: 5000 } });
    r.fake.faults.blockWebSocket();
    const result = await runCheck(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('staleness 0.35');
    expect(result.text).toContain(
      'Only the score was read: the report of this check was not received.',
    );
  });

  it('process_cancel sends the stop on the channel: stopping, the check still ends on its own', async () => {
    const r = await rig({ script: LONG });
    const first = await runCheck(r);
    const handle = (first.outcome as { operation: string }).operation;
    const session = driftSessionOf(handle.split(':')[1] ?? '');
    const call = r.call('process_cancel', { operation: handle });
    const result = await settleClock(r, call, { limitMs: 10_000 });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.toLowerCase()).toContain('stopping');
    await waitFor(
      () => r.fake.channel('healthCheck', { session_id: session }).received.length > 0,
      'the stop message',
    );
    expect(r.fake.channel('healthCheck', { session_id: session }).received).toEqual([
      { type: 'cancel' },
    ]);
  });

  it('an error frame is the code of the module with its cause, and the row of the operation fails', async () => {
    const r = await rig({
      script: { endMs: 2000, outcome: { error: 'The reference has no endpoints' } },
    });
    const result = await runCheck(r);
    expect(result.text).toMatch(/^\[scenario_drift_failed\] /u);
    expect(result.text).toContain('The reference has no endpoints');
    expect(
      saved(r)
        .operations.filter((row) => row.kind === 'drift_check')
        .map((row) => row.status),
    ).toEqual(['failed']);
  });
});

describe('scenario_check_drift: what never reaches the model or the state', () => {
  it('a credential in a name, a recommendation, a path or the cause of a failure is masked, and no operation entry or state file holds it', async () => {
    const poisoned = await rig({
      script: {
        endMs: 0,
        result: {
          ...REPORT,
          recommendations: [
            `use password: ${BACKEND_CANARY} and Authorization: Bearer ${SHAPE_CANARY}`,
          ],
          uncovered_endpoints: [`GET /pay?token=${BACKEND_CANARY}`],
        },
      },
      edit: (fake) => {
        fake.store
          .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
          .update(SCENARIO, { name: `login password: ${BACKEND_CANARY}` });
      },
    });
    const result = await runCheck(poisoned);
    expect(result.isError, result.text).toBe(false);
    for (const secret of [BACKEND_CANARY, SHAPE_CANARY]) expect(result.text).not.toContain(secret);
    poisoned.assertClean();

    const failing = await rig({
      script: { endMs: 1000, outcome: { error: `cannot read password: ${BACKEND_CANARY}` } },
    });
    const failed = await runCheck(failing);
    expect(failed.text).not.toContain(BACKEND_CANARY);
    failing.assertClean();
  });
});
