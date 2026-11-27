import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import type { ToolContext } from '../src/context.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { toToolError } from '../src/http/errors.js';
import { createLogger } from '../src/log.js';
import { refusal } from '../src/tools/dataCreateAccounts/provision.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { renderDataPlan, renderProvision, type ProvisionView } from '../src/render/views/data.js';
import { createServer, createServices } from '../src/server.js';
import { processCancel } from '../src/tools/processCancel.js';
import { dataCheckReadiness } from '../src/tools/dataCheckReadiness.js';
import { dataCreateAccounts } from '../src/tools/dataCreateAccounts.js';
import { processWait } from '../src/tools/processWait.js';
import { SKLEP_IDS, goldenText } from './golden/index.js';
import { DATA_SENTINEL, registerDataRoutes, seedAutoDatasets } from './fake-backend/routes/data.js';
import { registerCompositionRoutes } from './fake-backend/routes/compositions.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  PROVISION_BATCHES,
  holdProvision,
  registerProvisionRoutes,
  setFakeProvision,
  type FakeProvisionConfig,
  type RecordedBatch,
} from './fake-backend/routes/provision.js';
import type { Fake } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepFeeder,
  type SklepScenario,
} from './fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { connect, type McpSession } from './helpers/mcp.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T10:30:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const CAPABILITIES = [
  'meta',
  'provision_environment',
  'provision_register_operation',
  'provision_protected_confirmation',
];
const PROVISION_PATH = /\/gatling\/feeders\/[^/]+\/provision$/u;

const TOOLS = [dataCheckReadiness, dataCreateAccounts, processWait, processCancel];

async function rig(
  options: {
    locale?: 'en' | 'pl';
    capabilities?: readonly string[];
    config?: Partial<Omit<FakeProvisionConfig, 'id'>>;
    /** One set of services for every call, as the real process has: work goes on between calls. */
    processServices?: boolean;
  } = {},
): Promise<ToolRig> {
  const r = await toolRig({
    tools: TOOLS,
    ...(options.processServices === true ? { processServices: true } : {}),
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerDataRoutes(fake);
      registerProvisionRoutes(fake);
      registerCompositionRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      seedAutoDatasets(fake.store);
    },
    fake: { meta: { capabilities: options.capabilities ?? CAPABILITIES } },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
  if (options.config !== undefined) setFakeProvision(r.fake.store, options.config);
  return r;
}

const batches = (r: ToolRig): RecordedBatch[] =>
  r.fake.store.collection<RecordedBatch>(PROVISION_BATCHES).list();

const provisionCalls = (r: ToolRig): number =>
  r.fake.calls.filter((call) => call.method === 'POST' && PROVISION_PATH.test(call.path)).length;

const writes = (r: ToolRig): string[] =>
  r.fake.calls
    .filter((call) => call.method !== 'GET' && !call.path.endsWith('/preflight'))
    .filter((call) => !call.path.endsWith('/auto-plan'))
    .map((call) => `${call.method} ${call.path.replace(SKLEP_IDS.project, ':p')}`);

function datasetNamed(r: ToolRig, name: string): SklepFeeder {
  const found = r.fake.store
    .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
    .list()
    .find((feeder) => feeder.name === name);
  if (found === undefined) throw new Error(`no dataset ${name}`);
  return found;
}

const scenarioOf = (r: ToolRig, id: string): SklepScenario =>
  r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).require(id);

async function provision(
  r: ToolRig,
  count: number,
  extra: Record<string, unknown> = {},
  args: Record<string, unknown> = {},
) {
  const result = await r.call('data_create_accounts', {
    scenario: 'checkout',
    slot: 'accounts',
    count,
    ...extra,
    ...args,
  });
  return { ...result, data: (result.outcome as { data: ProvisionView } | undefined)?.data };
}

describe('data_create_accounts', () => {
  it('creates 2000 accounts in 40 batches of 50 and pins the dataset, keeping other bindings', async () => {
    const r = await rig({ locale: 'pl' });
    r.fake.store
      .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
      .update(SKLEP_WORLD_IDS.scenarios.zakupy, {
        slot_bindings: { search_phrases: SKLEP_WORLD_IDS.feeders.frazy },
      });
    const result = await provision(r, 2000);
    expect(result.isError).toBe(false);
    expect(result.text).toBe(goldenText('run1', '08-data_create_accounts').replace(/\n$/u, ''));
    expect(provisionCalls(r)).toBe(40);
    expect(batches(r).every((batch) => batch.count === 50)).toBe(true);
    expect(result.data).toMatchObject({
      slot: 'accounts',
      dataset: 'konta',
      created: 2000,
      failed: 0,
      batches: 40,
      masked: true,
      ready: true,
      failures: [],
    });
    // The reporter lets one notification through per second of the call's clock, which stands still here.
    expect(result.progress[0]?.message).toBe('50 / 2\u202f000 kont');
    const fractions = result.progress.map((entry) => entry.progress);
    expect([...fractions].sort((x, y) => x - y)).toEqual(fractions);

    const konta = datasetNamed(r, 'konta');
    expect(konta.record_count).toBe(2000);
    expect(konta.columns).toEqual(['email', 'password']);
    expect(scenarioOf(r, SKLEP_WORLD_IDS.scenarios.zakupy).slot_bindings).toEqual({
      search_phrases: SKLEP_WORLD_IDS.feeders.frazy,
      accounts: konta.id,
    });
    expect(scenarioOf(r, SKLEP_WORLD_IDS.scenarios.konto).slot_bindings).toEqual({
      accounts: konta.id,
    });
    expect(batches(r).every((batch) => batch.environment_id === null)).toBe(true);
    r.assertClean();
  });

  // The last batch asks only for what is left: never one account more than `count` in the customer's system.
  it('creates exactly 120 accounts in batches of 50, 50 and 20', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await provision(r, 120);
    expect(result.isError, result.text).toBe(false);
    expect(batches(r).map((batch) => batch.count)).toEqual([50, 50, 20]);
    expect(datasetNamed(r, 'konta').record_count).toBe(120);
    expect(result.data).toMatchObject({ created: 120, ready: true });
  });

  it('a repeat after a partial series asks for exactly the missing accounts', async () => {
    const r = await rig({ locale: 'pl', config: { abortAtBatch: 2 } });
    const first = await provision(r, 130);
    expect(first.data).toMatchObject({ created: 50, aborted: true, ready: false });
    expect(datasetNamed(r, 'konta').record_count).toBe(50);

    setFakeProvision(r.fake.store, { abortAtBatch: null });
    const before = batches(r).length;
    const second = await provision(r, 130);
    expect(second.isError, second.text).toBe(false);
    expect(
      batches(r)
        .slice(before)
        .map((batch) => batch.count),
    ).toEqual([50, 30]);
    expect(second.data).toMatchObject({ earlier: 50, created: 80, ready: true });
    expect(datasetNamed(r, 'konta').record_count).toBe(130);
  });

  it('asks before creating accounts on a protected environment and sends nothing', async () => {
    const r = await rig({ locale: 'pl' });
    const asked = await provision(r, 100, {}, { environment: 'qa' });
    expect(asked.isError).toBe(false);
    expect(asked.text).toContain('chronionym środowisku qa');
    expect(asked.text).toContain('confirm_protected: true');
    expect(provisionCalls(r)).toBe(0);
    expect(writes(r)).toEqual([]);

    const agreed = await provision(r, 100, {}, { environment: 'qa', confirm_protected: true });
    expect(agreed.isError).toBe(false);
    expect(provisionCalls(r)).toBe(2);
    expect(agreed.data?.created).toBe(100);
  });

  it('sends confirm_protected: true after the user agreed, and only then', async () => {
    const r = await rig();
    await provision(r, 100, {}, { environment: 'qa' });
    expect(batches(r)).toHaveLength(0);
    await provision(r, 100, {}, { environment: 'qa', confirm_protected: true });
    expect(batches(r)).toHaveLength(2);
    expect(batches(r).every((batch) => batch.confirm_protected === true)).toBe(true);
  });

  it('does not consent for an unprotected environment', async () => {
    const r = await rig();
    await provision(r, 50, {}, { environment: 'dev', confirm_protected: true });
    expect(batches(r).every((batch) => batch.confirm_protected === false)).toBe(true);
  });

  it('does not consent to a backend without the capability', async () => {
    const r = await rig({
      capabilities: ['meta', 'provision_environment'],
      config: { protectedConfirmation: false },
    });
    const done = await provision(r, 50, {}, { environment: 'qa', confirm_protected: true });
    expect(done.data?.created).toBe(50);
    expect(batches(r).every((batch) => batch.confirm_protected === false)).toBe(true);
  });

  it.each(['en', 'pl'] as const)(
    'a 409 that comes although the field was sent is unexpected and does not ask for a repeat (%s)',
    async (locale) => {
      const r = await rig({ locale });
      r.fake.faults.next(
        'POST',
        `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders/created-feeder-3/provision`,
        {
          status: 409,
          body: {
            detail: {
              code: 'protected_environment_requires_confirmation',
              message: 'The environment is protected.',
              environment_name: 'qa',
            },
          },
        },
      );
      const result = await provision(r, 50, {}, { environment: 'qa', confirm_protected: true });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(locale === 'en' ? 'unexpected' : 'nieoczekiwan');
      expect(result.text).not.toContain('repeat');
      expect(result.text).not.toContain('powtórz');
    },
  );

  it('does not ask for an unprotected environment', async () => {
    const r = await rig();
    const done = await provision(r, 50, {}, { environment: 'dev' });
    expect(done.data?.created).toBe(50);
  });

  it('refuses register_operation on a backend that lacks it, and writes nothing', async () => {
    const r = await rig({ capabilities: ['meta', 'provision_environment'] });
    const result = await provision(r, 100, { register_operation: 'POST:/auth/register' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('provision_register_operation');
    expect(result.text).toContain('older than the plugin supports');
    expect(provisionCalls(r)).toBe(0);
    expect(writes(r)).toEqual([]);
  });

  // The fake cannot send this body: the contract types a 422 as a validation list, the backend answers an object.
  it.each(['en', 'pl'] as const)(
    'turns 422 register_operation_method_not_allowed into a named error (%s)',
    (locale) => {
      const t = createTranslator(locale);
      const error = new LoadcraftApiError({
        status: 422,
        code: 'register_operation_method_not_allowed',
        message: 'GET is not allowed.',
      });
      const shown = toToolError(refusal(error, { t } as unknown as ToolContext), t);
      expect(shown.code).toBe('register_operation_method_not_allowed');
      expect(shown.message).toContain('GET is not allowed.');
      expect(shown.message).toContain('POST');
      expect(shown.hint).toBeDefined();
    },
  );

  it.each(['en', 'pl'] as const)(
    'turns 422 register_operation_unfillable into an error naming the fields and a file (%s)',
    (locale) => {
      const t = createTranslator(locale);
      const error = new LoadcraftApiError({
        status: 422,
        code: 'register_operation_unfillable',
        message: 'Cannot fill: captcha_token.',
      });
      const shown = toToolError(refusal(error, { t } as unknown as ToolContext), t);
      expect(shown.code).toBe('register_operation_unfillable');
      expect(shown.message).toContain('captcha_token');
      expect(shown.hint).toContain('data_create_dataset');
    },
  );

  it('refuses when probes are off and changes nothing', async () => {
    const r = await rig({ config: { probes: false } });
    const result = await provision(r, 100);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('probes');
    expect(result.text).toContain('https://app.loadcraft.io/projects/');
    expect(provisionCalls(r)).toBe(0);
    expect(writes(r)).toEqual([]);
  });

  it('refuses a backend that does not create accounts on an environment', async () => {
    const r = await rig({ capabilities: ['meta'] });
    const result = await provision(r, 100, {}, { environment: 'qa' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('provision_environment');
    expect(provisionCalls(r)).toBe(0);
    expect(writes(r)).toEqual([]);
  });

  it('creates accounts without an environment on a backend that cannot choose one', async () => {
    const r = await rig({ capabilities: ['meta'] });
    const result = await provision(r, 100);
    expect(result.isError).toBe(false);
    expect(provisionCalls(r)).toBeGreaterThan(0);
    expect(
      batches(r).every(
        (batch) => batch.environment_id === null || batch.environment_id === undefined,
      ),
    ).toBe(true);
  });

  it('creates the accounts on the chosen environment and says so', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await provision(r, 100, {}, { environment: 'qa', confirm_protected: true });
    expect(result.isError).toBe(false);
    expect(batches(r)).toHaveLength(2);
    expect(
      batches(r).every((batch) => batch.environment_id === SKLEP_WORLD_IDS.environments.qa),
    ).toBe(true);
    expect(result.data?.environment).toBe('qa');
    expect(result.text).toContain(' na qa');
    expect(result.text).not.toContain('środowisko qa');
  });

  it('names the register operation and the environment in the first line', async () => {
    const r = await rig({ locale: 'pl', config: { registerRequest: false } });
    const done = await provision(
      r,
      100,
      { register_operation: 'POST:/auth/register' },
      { environment: 'qa', confirm_protected: true },
    );
    expect(done.isError).toBe(false);
    expect(done.text.split('\n')[0]).toContain(
      'konta  100 założonych przez POST /auth/register na qa',
    );
  });

  it('names no environment when the call chose none', async () => {
    const r = await rig({ locale: 'en' });
    const done = await provision(r, 50);
    expect(done.data?.environment).toBeNull();
    expect(done.text.split('\n')[0]).not.toContain(' on ');
  });

  it('asks for the register operation when no flow registers accounts, then uses the named one', async () => {
    const r = await rig({ config: { registerRequest: false } });
    const refused = await provision(r, 100);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('POST:/auth/register');
    expect(refused.text).toContain('register_operation');
    expect(datasetNamed(r, 'konta').record_count).toBe(0);
    expect(r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios).list()).toSatisfy(
      (scenarios: SklepScenario[]) =>
        scenarios.every((scenario) => scenario.slot_bindings['accounts'] === undefined),
    );

    const done = await provision(r, 100, { register_operation: 'POST:/auth/register' });
    expect(done.isError).toBe(false);
    expect(batches(r).every((batch) => batch.register_operation === 'POST:/auth/register')).toBe(
      true,
    );
    expect(done.text).toContain('POST /auth/register');
    expect(done.data?.created).toBe(100);
    // The dataset made by the refused call is reused, not made again.
    expect(
      r.fake.store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .list()
        .filter((feeder) => feeder.name === 'konta'),
    ).toHaveLength(1);
  });

  it('stops on a failure streak with a partial result, and a repeat adds only what is missing', async () => {
    const r = await rig({ locale: 'pl', config: { abortAtBatch: 11 } });
    const first = await provision(r, 2000);
    expect(first.isError).toBe(false);
    expect(first.data).toMatchObject({ created: 500, aborted: true, ready: false, batches: 10 });
    expect(first.text).not.toContain('każdy slot przypięty i wypełniony');
    expect(first.text).toContain('500');
    expect(datasetNamed(r, 'konta').record_count).toBe(500);
    // the series is kept for the repeat in its own section, keyed by the dataset, never in drafts
    const dataset = datasetNamed(r, 'konta').id;
    const partial = stateFile(r);
    expect(partial.accountSeries?.[dataset]).toMatchObject({ value: { baseline: 0, count: 2000 } });
    expect(Object.keys(partial.drafts ?? {})).toEqual([]);

    setFakeProvision(r.fake.store, { abortAtBatch: null });
    const before = provisionCalls(r);
    const second = await provision(r, 2000);
    expect(second.isError).toBe(false);
    expect(provisionCalls(r) - before).toBe(30);
    expect(second.data).toMatchObject({ created: 1500, earlier: 500, ready: true });
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
    expect(second.text).toContain('każdy slot przypięty i wypełniony');
    // a series that ran to its end is not remembered
    expect(stateFile(r).accountSeries?.[dataset]).toBeUndefined();
    expect(
      r.fake.store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .list()
        .filter((f) => f.name === 'konta'),
    ).toHaveLength(1);

    // A finished provisioning is not remembered: the same count again adds that many accounts.
    const third = await provision(r, 100);
    expect(third.data).toMatchObject({ created: 100, earlier: 0 });
    expect(datasetNamed(r, 'konta').record_count).toBe(2100);
  });

  it('reports failed accounts by distinct reason and does not say the test can start', async () => {
    const r = await rig({ locale: 'pl', config: { failPerBatch: 10 } });
    const result = await provision(r, 100);
    expect(result.isError).toBe(false);
    expect(result.data).toMatchObject({ created: 80, failed: 20, ready: false });
    expect(result.data?.failures).toEqual([{ status: 409, count: 20 }]);
    expect(result.text).not.toContain('każdy slot przypięty i wypełniony');
    expect(result.text).toContain('20');
    // Failed accounts without an aborted series still say what each status of the target means.
    expect(result.text).toContain('→ odczytaj status: 400 lub 422');
  });

  it('shows the failures of a 502 by status of the target, with no text and no name from the body', async () => {
    const r = await rig({
      locale: 'pl',
      config: {
        failPerBatch: 100,
        failureDetail: 'Traceback: connect to db-internal.example failed',
        reportEnvironment: 'LEAK-env.example',
        reportOperation: 'POST:/LEAK-register',
      },
    });
    const result = await provision(r, 100);
    expect(result.data).toMatchObject({ created: 0, ready: false });
    expect(result.data?.failures).toEqual([{ status: 409, count: 20 }]);
    const shown = JSON.stringify(result.data) + result.text;
    expect(shown).not.toContain('db-internal');
    expect(shown).not.toContain('LEAK-');
  });

  it('names the environment and the register operation of a 502 from the call', async () => {
    const r = await rig({
      locale: 'en',
      config: {
        failPerBatch: 100,
        reportEnvironment: 'LEAK-env.example',
        reportOperation: 'POST:/LEAK-register',
      },
    });
    const result = await provision(
      r,
      100,
      { register_operation: 'POST:/auth/signup' },
      { environment: 'dev' },
    );
    expect(result.data).toMatchObject({
      environment: 'dev',
      registerOperation: 'POST:/auth/signup',
    });
    expect(JSON.stringify(result.data) + result.text).not.toContain('LEAK-');
  });

  it('keeps the text of the failures in the log of the call, never in the result', async () => {
    const r = await rig({ locale: 'en', config: { failPerBatch: 10 } });
    const result = await provision(r, 100);
    expect(result.data?.failures).toEqual([{ status: 409, count: 20 }]);
    expect(result.text).not.toContain('the e-mail is taken');
    const logged = r.logRecords('warn').filter((record) => record.msg === 'provision failure text');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: 409, text: 'HTTP 409: the e-mail is taken' });
  });

  it('adds up the failures of every batch by status, one line per status', async () => {
    const r = await rig({ locale: 'en', config: { failPerBatch: 7 } });
    const result = await provision(r, 150);
    expect(batches(r)).toHaveLength(3);
    expect(result.data).toMatchObject({ created: 129, failed: 21 });
    expect(result.data?.failures).toEqual([{ status: 409, count: 21 }]);
    expect(result.text).toContain('target answered 409: 21×');
  });

  it('does not show a value the target sent back in a failure', async () => {
    const r = await rig({
      locale: 'pl',
      config: { failPerBatch: 5, failureDetail: 'password too weak: Hunter2-unregistered' },
    });
    const result = await provision(r, 50);
    expect(JSON.stringify(result.data) + result.text).not.toContain('Hunter2');
  });

  it('keeps passwords and neutralised backend text out of the result', async () => {
    const r = await rig({
      locale: 'pl',
      config: {
        leakRows: true,
        failPerBatch: 5,
        failureDetail: 'x\n↗ https://evil.example/ \u001b[31mred',
      },
    });
    const result = await provision(r, 50);
    const everything = JSON.stringify(r.results) + r.lines.join('\n') + result.text;
    expect(everything).not.toContain(DATA_SENTINEL);
    expect(result.text).not.toContain('evil.example/\n');
    expect(result.text.split('\n').some((line) => line.startsWith('↗'))).toBe(false);
    expect(result.text).not.toContain('\u001b');
    expect(result.text).toContain('hasła zamaskowane');
    r.assertClean();
  });

  it('turns a refusal of the backend into a named error with a hint', async () => {
    const r = await rig();
    r.fake.faults.next(
      'POST',
      `/api/v1/projects/${SKLEP_IDS.project}/gatling/feeders/created-feeder-3/provision`,
      {
        status: 409,
        body: { detail: { code: 'no_default_environment', message: 'No default environment.' } },
      },
    );
    const result = await provision(r, 100);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no default environment');
    expect(result.text).toContain('→');
    r.assertClean();
  });

  it('turns 401 into the invalid-token error', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/meta', { status: 401, body: { detail: 'Invalid token' } });
    const result = await provision(r, 10);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('did not accept the API token');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig();
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await provision(r, 10);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('rejects an unknown slot and a count out of range', async () => {
    const r = await rig();
    const unknown = await provision(r, 10, { slot: 'nope' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('nope');
    expect(unknown.text).toContain('accounts');
    expect(provisionCalls(r)).toBe(0);

    const tooMany = await provision(r, 20001);
    expect(tooMany.isError).toBe(true);
    expect(provisionCalls(r)).toBe(0);
  });

  describe('a slot that is not a slot of accounts', () => {
    /** Rewrites what the backend says about the slot of the checkout scenario, as the artifact stamps it. */
    function restamp(
      r: ToolRig,
      slot: string,
      stamp: { identity_kind: 'existing' | 'fresh' | null; role: 'auth' | 'data' | null },
    ): void {
      const scenarios = r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      for (const scenario of scenarios.list()) {
        scenarios.update(scenario.id, {
          feeder_slots: scenario.feeder_slots.map((item) =>
            item.slot === slot ? { ...item, ...stamp } : item,
          ),
        });
      }
    }

    it('refuses a plain data slot with [slot_not_accounts], sending nothing; a filled slot needs nothing', async () => {
      const r = await rig();
      // The rows of order_details ride in the artifact: no data tool would do anything for it.
      const result = await provision(r, 50, { slot: 'order_details' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[slot_not_accounts]');
      expect(result.text).toContain('order_details');
      expect(result.text).toContain('data_check_readiness shows it filled');
      expect(result.text).not.toContain('data_create_dataset');
      expect(provisionCalls(r)).toBe(0);
      expect(writes(r)).toEqual([]);
      expect(batches(r)).toHaveLength(0);
    });

    it('sends a missing plain data slot to data_create_dataset when its columns can make the rows', async () => {
      const r = await rig();
      restamp(r, 'accounts', { identity_kind: null, role: 'data' });
      const scenarios = r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
      for (const scenario of scenarios.list()) {
        scenarios.update(scenario.id, {
          feeder_slots: scenario.feeder_slots.map((item) =>
            item.slot === 'accounts' ? { ...item, columns: ['email', 'nick'] } : item,
          ),
        });
      }
      const result = await provision(r, 50);
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[slot_not_accounts]');
      expect(result.text).toContain(
        'Fill it with data_create_dataset with the scenario and the slot',
      );
      expect(writes(r)).toEqual([]);
    });

    it('says it in Polish too', async () => {
      const r = await rig({ locale: 'pl' });
      const result = await provision(r, 50, { slot: 'order_details' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[slot_not_accounts]');
      expect(result.text).toContain('nie jest slotem kont');
      expect(result.text).toContain('pokazuje go jako wypełniony');
    });

    it('refuses before the question about a protected environment and before the probe consent', async () => {
      const r = await rig({ config: { probes: false } });
      const result = await provision(
        r,
        50,
        { slot: 'order_details' },
        { environment: 'qa', confirm_protected: false },
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[slot_not_accounts]');
      expect(result.text).not.toContain('confirm_protected: true');
      expect(provisionCalls(r)).toBe(0);
      expect(writes(r)).toEqual([]);
    });

    it('goes by what the backend stamped, not by the names of the columns', async () => {
      const r = await rig();
      // email and password columns, but the backend's verdict is "not an account".
      restamp(r, 'accounts', { identity_kind: null, role: 'data' });
      const refused = await provision(r, 50);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('[slot_not_accounts]');
      // Its password is never generated: the way on is a file, not the generation.
      expect(refused.text).toMatch(/data_create_dataset (with|z) file/u);
      expect(refused.text).not.toContain('with the scenario and the slot');
      expect(provisionCalls(r)).toBe(0);
      expect(writes(r)).toEqual([]);
    });

    it('leaves a slot of accounts alone: a legacy slot with no verdict, and refuses a register slot', async () => {
      const fresh = await rig();
      restamp(fresh, 'accounts', { identity_kind: 'fresh', role: 'auth' });
      // A register slot holds new identities the test makes itself: no account is created for it.
      const refused = await provision(fresh, 50);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('[slot_new_identities]');
      expect(provisionCalls(fresh)).toBe(0);

      // A verdict of the backend wins over the role.
      const stamped = await rig();
      restamp(stamped, 'accounts', { identity_kind: 'existing', role: 'data' });
      expect((await provision(stamped, 50)).data?.created).toBe(50);

      const legacy = await rig();
      restamp(legacy, 'accounts', { identity_kind: null, role: null });
      const result = await provision(legacy, 50);
      expect(result.isError).toBe(false);
      expect(result.data?.created).toBe(50);
    });

    it('keeps the existing refusal for a slot nobody reads', async () => {
      const r = await rig();
      const result = await provision(r, 50, { slot: 'nope' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('[slot_unknown]');
      expect(result.text).not.toContain('slot_not_accounts');
      expect(provisionCalls(r)).toBe(0);
      expect(writes(r)).toEqual([]);
    });
  });

  it('keeps the canary out of everything', async () => {
    const r = await rig();
    await provision(r, 100);
    expect(JSON.stringify(r.results)).not.toContain(CANARY);
    r.assertClean();
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('a complete provisioning (%s)', async (locale) => {
      const r = await rig({ locale });
      const { text } = await provision(r, 2000);
      await expect(text).toMatchFileSnapshot(
        `__snapshots__/dataCreateAccounts.provision.${locale}.txt`,
      );
    });

    it.each(['en', 'pl'] as const)('a stopped provisioning (%s)', async (locale) => {
      const r = await rig({ locale, config: { abortAtBatch: 11, failPerBatch: 0 } });
      const { text } = await provision(r, 2000);
      await expect(text).toMatchFileSnapshot(
        `__snapshots__/dataCreateAccounts.provision.stopped.${locale}.txt`,
      );
    });
  });
});

const HANDLE = /account_provision:[A-Za-z0-9._-]*[A-Za-z0-9]/u;

interface Gate {
  /** Settles when the provision call after the first `n` reaches the fake. */
  readonly reached: Promise<void>;
  /** Lets the held call and every later one through. */
  release(): void;
}

/**
 * The fake answers the first `n` provision calls at once and holds the next one. A test starts the
 * call, waits for `reached` and only then moves the clock, so the call returns with exactly `n`
 * batches done, however busy the machine is.
 */
function holdAfter(r: ToolRig, n: number): Gate {
  let reach = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let open = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    open = resolve;
  });
  holdProvision(r.fake.store, async (batch) => {
    if (batch <= n) return;
    reach();
    await released;
  });
  return {
    reached,
    release: () => {
      holdProvision(r.fake.store, undefined);
      open();
    },
  };
}

/** Starts data_create_accounts, lets `n` batches through, then moves the clock until the call returns. */
async function startHeld(r: ToolRig, n: number, args: Record<string, unknown> = {}) {
  const gate = holdAfter(r, n);
  const pending = r.call('data_create_accounts', {
    scenario: 'checkout',
    slot: 'accounts',
    count: 2000,
    max_wait_s: 10,
    ...args,
  });
  await gate.reached;
  return { gate, first: await settleClock(r, pending) };
}

function handleOf(text: string): string {
  const found = HANDLE.exec(text)?.[0];
  if (found === undefined) throw new Error(`no handle in:\n${text}`);
  return found;
}

/** `process_wait` with the handle until the operation ends; the last result. */
async function waitToEnd(r: ToolRig, handle: string) {
  for (let again = 0; again < 10; again += 1) {
    const result = await settleClock(r, r.call('process_wait', { operation: handle }));
    if (result.isError || result.outcome?.status === 'done') return result;
  }
  throw new Error('the provisioning did not end');
}

/** A second server process on the same workspace, backend and clock: what a restart leaves. */
async function restartedServer(r: ToolRig): Promise<McpSession> {
  const log = createLogger({ level: 'debug', sink: () => undefined });
  log.registerSecret(r.config.token.reveal());
  const services = createServices(r.config, log);
  const session = await connect(() =>
    createServer({ config: r.config, log, services, tools: TOOLS, clock: r.clock }),
  );
  onTestFinished(() => session.close());
  return session;
}

function stateFile(r: ToolRig): {
  accountSeries?: Record<string, unknown>;
  drafts?: Record<string, unknown>;
} {
  const file = join(r.workspace, 'loadcraft/.cache/state.json');
  return JSON.parse(readFileSync(file, 'utf8')) as {
    accountSeries?: Record<string, unknown>;
    drafts?: Record<string, unknown>;
  };
}

function operationHandles(r: ToolRig): string[] {
  const file = join(r.workspace, 'loadcraft/.cache/state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as { opPayloads?: Record<string, unknown> };
  return Object.keys(state.opPayloads ?? {});
}

/** The status of the row of `handle` in any process of the state file. */
function rowStatus(r: ToolRig, handle: string): string | undefined {
  const file = join(r.workspace, 'loadcraft/.cache/state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as {
    process: Record<string, { operations: { handle: string; status: string }[] }>;
  };
  return Object.values(state.process)
    .flatMap((p) => p.operations)
    .find((row) => row.handle === handle)?.status;
}

describe('data_create_accounts in tools/list', () => {
  it('asks the user on every call of data_create_accounts, never on data_check_readiness', async () => {
    const r = await rig();
    const listed = await r.session.listTools();
    const accounts = listed.find((tool) => tool.name === 'data_create_accounts');
    expect(accounts?.meta).toEqual({ 'anthropic/requiresUserInteraction': true });
    expect(accounts?.annotations).toMatchObject({ openWorldHint: true, idempotentHint: false });
    expect(accounts?.annotations?.['readOnlyHint']).not.toBe(true);
    const plan = listed.find((tool) => tool.name === 'data_check_readiness');
    expect(plan).toBeDefined();
    expect(plan?.meta).toBeUndefined();
  });

  it('the readiness check still reads the plan without asking', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call('data_check_readiness', { scenario: 'checkout' });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('plan danych');
    expect(provisionCalls(r)).toBe(0);
  });
});

describe('data_create_accounts as a long operation', () => {
  it('returns the handle at the time limit, and process_wait follows the same series to its end', async () => {
    const r = await rig({ locale: 'pl', processServices: true });
    const { gate, first } = await startHeld(r, 9);
    expect(first.isError, first.text).toBe(false);
    expect(first.outcome?.status).toBe('running');
    const handle = handleOf(first.text);
    expect(first.text).toContain(`"${handle}"`);
    expect(first.text).toContain('450 / 2\u202f000 kont');
    expect(first.text).toContain('process_wait');
    // The batch held by the fake has arrived; nothing after it was sent.
    expect(provisionCalls(r)).toBe(10);

    gate.release();
    const done = await waitToEnd(r, handle);
    expect(done.isError, done.text).toBe(false);
    expect(done.text).toBe(goldenText('run1', '08-data_create_accounts').replace(/\n$/u, ''));
    expect(provisionCalls(r)).toBe(40);
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
    expect(operationHandles(r)).toEqual([]);
    r.assertClean();
  });

  it('caps the wait of one call at 100 s, whatever max_wait_s asks for', async () => {
    const r = await rig({ processServices: true });
    const started = r.clock.now();
    const { first } = await startHeld(r, 1, { max_wait_s: 3600 });
    expect(first.outcome?.status).toBe('running');
    expect(r.clock.now() - started).toBe(100_000);
    handleOf(first.text);
  });

  it('joins the series under way when called again, and refuses another count for the slot', async () => {
    const r = await rig({ processServices: true });
    const { gate, first } = await startHeld(r, 3, { max_wait_s: 5 });
    const handle = handleOf(first.text);
    const args = { scenario: 'checkout', slot: 'accounts', count: 2000, max_wait_s: 5 };

    const again = await settleClock(r, r.call('data_create_accounts', args));
    expect(again.isError, again.text).toBe(false);
    expect(handleOf(again.text)).toBe(handle);
    expect(again.text).toContain('joined');
    expect(provisionCalls(r)).toBe(4);

    const other = await settleClock(r, r.call('data_create_accounts', { ...args, count: 1000 }));
    expect(other.isError).toBe(true);
    expect(other.text.split('\n')[0]).toMatch(/^\[provision_already_running\] /u);
    expect(other.text).toContain(handle);
    expect(provisionCalls(r)).toBe(4);

    gate.release();
    const done = await waitToEnd(r, handle);
    expect(done.isError, done.text).toBe(false);
    expect(provisionCalls(r)).toBe(40);
    expect(batches(r).every((batch) => batch.count === 50)).toBe(true);
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
  });

  it('two calls at once for the same slot start one series: the second joins it', async () => {
    const r = await rig({ processServices: true });
    const gate = holdAfter(r, 1);
    const args = { scenario: 'checkout', slot: 'accounts', count: 2000, max_wait_s: 5 };
    const both = Promise.all([
      r.call('data_create_accounts', args),
      r.call('data_create_accounts', args),
    ]);
    await gate.reached;
    const [one, two] = await settleClock(r, both);
    expect(one.isError, one.text).toBe(false);
    expect(two.isError, two.text).toBe(false);
    expect(handleOf(two.text)).toBe(handleOf(one.text));
    expect([one.text, two.text].filter((text) => text.includes('joined'))).toHaveLength(1);
    // One batch through, one held: a second series would have sent its own.
    expect(provisionCalls(r)).toBe(2);
    expect(
      r.fake.store
        .collection<SklepFeeder>(SKLEP_COLLECTIONS.feeders)
        .list()
        .filter((feeder) => feeder.name === 'konta'),
    ).toHaveLength(1);

    gate.release();
    const done = await waitToEnd(r, handleOf(one.text));
    expect(done.isError, done.text).toBe(false);
    expect(provisionCalls(r)).toBe(40);
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
  });

  it('cancel stops the series; a later call adds only what is missing', async () => {
    const r = await rig({ locale: 'pl', processServices: true });
    const { gate, first } = await startHeld(r, 6, { max_wait_s: 5 });
    const handle = handleOf(first.text);
    const stopped = await r.call('process_cancel', { operation: handle });
    expect(stopped.isError, stopped.text).toBe(false);
    expect(stopped.text).toContain(handle);
    const sent = provisionCalls(r);
    // The held batch is let through after the stop: the series sends nothing more.
    gate.release();
    await r.clock.advance(60_000);
    await settleClock(r, Promise.resolve());
    expect(provisionCalls(r)).toBe(sent);
    const rows = datasetNamed(r, 'konta').record_count;
    expect(rows).toBeLessThan(2000);

    const rest = await provision(r, 2000);
    expect(rest.isError, rest.text).toBe(false);
    expect(rest.data).toMatchObject({ earlier: rows, created: 2000 - rows, ready: true });
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
  });

  it('after a restart wait only reads the dataset and the bindings, and never creates an account', async () => {
    const r = await rig({ locale: 'pl', processServices: true });
    const { first } = await startHeld(r, 9);
    const handle = handleOf(first.text);
    const sent = provisionCalls(r);
    const rows = datasetNamed(r, 'konta').record_count;
    expect(rows).toBe(450);

    // The old process is gone: its batch held by the fake never ends.
    const restarted = await restartedServer(r);
    const read = await restarted.call('process_wait', { operation: handle });
    expect(read.isError, read.text).toBe(false);
    expect(provisionCalls(r)).toBe(sent);
    expect(read.text).toContain('450 z 2\u202f000');
    expect(read.text).toContain('data_create_accounts');
    expect(read.text).not.toContain('każdy slot przypięty i wypełniony');
    await expect(read.text).toMatchFileSnapshot('__snapshots__/provisionAccounts.restart.pl.txt');
    // The entry is settled: a second wait does not read it again, and the row says nobody follows it.
    expect(operationHandles(r)).not.toContain(handle);
    expect(rowStatus(r, handle)).toBe('lost');

    // The same count again, in the new process: only the missing accounts are created.
    holdProvision(r.fake.store, undefined);
    const rest = await restarted.call('data_create_accounts', {
      scenario: 'checkout',
      slot: 'accounts',
      count: 2000,
    });
    expect(rest.isError, rest.text).toBe(false);
    expect(provisionCalls(r) - sent).toBe(Math.ceil((2000 - rows) / 50));
    expect(datasetNamed(r, 'konta').record_count).toBe(2000);
    expect(rest.text).toContain('każdy slot przypięty i wypełniony');
  });

  it('a series of a restarted process gives way to a new one without a wait: its row says lost', async () => {
    const r = await rig({ locale: 'pl', processServices: true });
    const { first } = await startHeld(r, 9);
    const handle = handleOf(first.text);

    const restarted = await restartedServer(r);
    holdProvision(r.fake.store, undefined);
    const rest = await restarted.call('data_create_accounts', {
      scenario: 'checkout',
      slot: 'accounts',
      count: 2000,
    });
    expect(rest.isError, rest.text).toBe(false);
    expect(operationHandles(r)).not.toContain(handle);
    expect(rowStatus(r, handle)).toBe('lost');
  });

  it('keeps passwords out of a provisioning followed with process_wait', async () => {
    const r = await rig({
      locale: 'pl',
      processServices: true,
      config: { leakRows: true, failPerBatch: 5, failureDetail: `taken: ${DATA_SENTINEL}` },
    });
    const { gate, first } = await startHeld(r, 1, { count: 200, max_wait_s: 1 });
    expect(first.outcome?.status).toBe('running');
    gate.release();
    const done = await waitToEnd(r, handleOf(first.text));
    expect(done.isError, done.text).toBe(false);
    const everything = JSON.stringify(r.results) + r.lines.join('\n');
    expect(everything).not.toContain(DATA_SENTINEL);
    expect(done.text).toContain('hasła zamaskowane');
    r.assertClean();
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)(
      'a provisioning that goes on after the call (%s)',
      async (locale) => {
        const r = await rig({ locale, processServices: true });
        const { first } = await startHeld(r, 9);
        // The id of the series is random: the snapshot holds its place.
        const shown = first.text.replaceAll(handleOf(first.text), 'account_provision:<id>');
        await expect(shown).toMatchFileSnapshot(
          `__snapshots__/provisionAccounts.running.${locale}.txt`,
        );
      },
    );

    it('a provisioning read after a restart (en)', async () => {
      const r = await rig({ locale: 'en', processServices: true });
      const { first } = await startHeld(r, 9);
      const restarted = await restartedServer(r);
      const read = await restarted.call('process_wait', { operation: handleOf(first.text) });
      await expect(read.text).toMatchFileSnapshot('__snapshots__/provisionAccounts.restart.en.txt');
    });
  });
});

describe('data_create_accounts view against the golden text', () => {
  it('run1/08-data_create_accounts renders from its view.json', () => {
    const data = JSON.parse(
      readFileSync(
        new URL('./golden/run1/08-data_create_accounts.view.json', import.meta.url),
        'utf8',
      ),
    ) as ProvisionView;
    const text = renderProvision(data, createTranslator('pl'));
    expect(text).toBe(goldenText('run1', '08-data_create_accounts').replace(/\n$/u, ''));
  });

  it('run5/08a-data_create_accounts-qa renders from its view.json', () => {
    const data = JSON.parse(
      readFileSync(
        new URL('./golden/run5/08a-data_create_accounts-qa.view.json', import.meta.url),
        'utf8',
      ),
    ) as ProvisionView;
    const text = renderProvision(data, createTranslator('pl'));
    expect(text).toBe(goldenText('run5', '08a-data_create_accounts-qa').replace(/\n$/u, ''));
  });

  it('draws a plan with the plan view', () => {
    const data = JSON.parse(
      readFileSync(
        new URL('./golden/run1/07-data_check_readiness-plan.view.json', import.meta.url),
        'utf8',
      ),
    ) as Parameters<typeof renderDataPlan>[0];
    expect(renderDataPlan(data, createTranslator('pl'))).toContain('plan danych');
  });
});
