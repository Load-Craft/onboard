// Vitest file. Named *.spec.ts on purpose: `claude plugin test` collects every *.test.ts in the
// plugin and would try to run this file in the mods environment (see mod/docs/mods-facts.md).
//
// The consent of the user before a LoadCraft tool with an effect outside the editor: what the mod
// reads, when it asks, what it asks, what the answer means, and the record that keeps it from
// asking twice for the same facts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PluginState } from 'claude-code';

import { flowsDescribeJourneys } from '../../mcp/src/tools/flowsDescribeJourneys.js';
import { processGetStatus } from '../../mcp/src/tools/processGetStatus.js';
import { dataCreateAccounts } from '../../mcp/src/tools/dataCreateAccounts.js';
import { registerDataRoutes } from '../../mcp/test/fake-backend/routes/data.js';
import { registerExecutionRoutes } from '../../mcp/test/fake-backend/routes/executions.js';
import { registerFlowRoutes } from '../../mcp/test/fake-backend/routes/flows.js';
import { registerLookupRoutes } from '../../mcp/test/fake-backend/routes/lookup.js';
import { SKLEP_IDS } from '../../mcp/test/golden/index.js';
import { seedSklep } from '../../mcp/test/fake-backend/worlds/sklep.js';
import { createTestClock, settleClock } from '../../mcp/test/helpers/clock.js';
import { toolRig } from '../../mcp/test/helpers/rig.js';

import {
  CONSENT_TOOLS,
  consentPlan,
  decide,
  readFacts,
  settle,
  type ConsentFacts,
  type Decision,
  type Question,
} from '../src/consent/decide.js';
import {
  CONSENT_TTL_MS,
  EMPTY_LEDGER,
  consume,
  grant,
  type Ledger,
} from '../src/consent/ledger.js';

// The declaration the manifest points at and `Ledger` must describe the same value, both ways.
type Declared = PluginState['loadcraft']['consent'];
const declaredFromLedger: Declared = EMPTY_LEDGER;
const ledgerFromDeclared: Ledger = declaredFromLedger;

const NOW = 1_700_000_000_000;
const NNBSP = ' ';
const HANDLE = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

/** What `process_get_status` with `preflight` and `format: "data"` answers for a clamped test on qa. */
const QA_CLAMPED = {
  dry_run: true,
  target: { kind: 'composition', name: 'checkout' },
  environment: { name: 'qa', protected: true, limit: { max_vu: 100, max_rps: 20 } },
  profile_label: 'Ramp load (closed)',
  profile_requested: RAMP_2000,
  profile_effective: { type: 'ramp_concurrency', vusers: 100, ramp: 600 },
  capped: true,
  consent_required: true,
  data: { needed: 1200, available: 2000, ready: true, slots: [], refusal: null },
  planned_s: 600,
  busy: null,
};

const PERF_FREE = {
  ...QA_CLAMPED,
  environment: { name: 'perf', protected: false },
  profile_effective: RAMP_2000,
  capped: false,
  consent_required: false,
};

const SNAPSHOT = {
  operation: HANDLE,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: 405,
  load_elapsed_s: 400,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
};

const STATUS = {
  environments: [
    { name: 'perf', isDefault: true, protected: false, active: true, caps: {} },
    { name: 'qa', isDefault: false, protected: true, active: false, caps: { maxVu: 100 } },
  ],
};

const RUN_CALL = {
  tool: 'mcp__plugin_loadcraft_lc__run_start',
  scenario: 'checkout',
  environment: 'qa',
  profile: RAMP_2000,
};

/** The facts for one call of `tool` with these arguments and this answer of `process_get_status`. */
function factsOf(tool: string, call: Record<string, unknown>, data: unknown): ConsentFacts {
  const plan = consentPlan(tool, call);
  if (plan === undefined) throw new Error(`no plan for ${tool}`);
  const facts = readFacts(plan, data);
  if (facts === undefined) throw new Error(`no facts for ${tool}`);
  return facts;
}

function asked(decision: Decision): Question {
  if (!('ask' in decision)) throw new Error('expected a question');
  return decision.ask;
}

const runFacts = (data: unknown = QA_CLAMPED, call: Record<string, unknown> = RUN_CALL) =>
  factsOf('run_start', call, data);

describe('consentPlan: what the mod reads before it decides', () => {
  it('reads the preflight of run_start with the arguments of the call', () => {
    expect(
      consentPlan('run_start', { ...RUN_CALL, project: 'sklep', confirm_capped: true }),
    ).toMatchObject({
      tool: 'run_start',
      read: {
        preflight: { scenario: 'checkout', environment: 'qa', profile: RAMP_2000 },
        project: 'sklep',
        format: 'data',
      },
    });
  });

  it('reads a snapshot of the operation before cancel', () => {
    expect(consentPlan('process_cancel', { operation: HANDLE })).toMatchObject({
      tool: 'process_cancel',
      read: { operation: HANDLE, format: 'data' },
    });
  });

  it('reads the environments before data_create_accounts creates accounts, and nothing else', () => {
    expect(
      consentPlan('data_create_accounts', { scenario: 'checkout', slot: 'a', count: 5 }),
    ).toMatchObject({ tool: 'data_create_accounts', read: { format: 'data' } });
    // The other data tools create no account: the plan, a file of accounts, datasets and pins are
    // not guarded by the mod (their cards are the server's own until the consent window).
    expect(consentPlan('data_check_readiness', { scenario: 'checkout' })).toBeUndefined();
    expect(consentPlan('data_suggest_actions', { scenario: 'checkout' })).toBeUndefined();
    expect(
      consentPlan('data_create_dataset', { scenario: 'c', slot: 'a', file: 'a.csv' }),
    ).toBeUndefined();
    expect(
      consentPlan('data_set_bindings', { scenario: 'checkout', bindings: {} }),
    ).toBeUndefined();
    // A call without the slot or the count is refused by the server, not asked about.
    expect(consentPlan('data_create_accounts', { scenario: 'checkout', count: 5 })).toBeUndefined();
    expect(
      consentPlan('data_create_accounts', { scenario: 'checkout', slot: 'a' }),
    ).toBeUndefined();
  });

  // Contract with the server: the names consentPlan reads are the names of the tool's input, and
  // the input refuses any other spelling of them, so no call of the tool creates accounts unasked.
  it('reads data_create_accounts with the names of its input schema', () => {
    const call = {
      scenario: 'checkout',
      slot: 'konta',
      count: 2000,
      environment: 'qa',
      project: 'sklep',
      confirm_protected: true,
    };
    expect(dataCreateAccounts.input.safeParse(call).success).toBe(true);
    const plan = consentPlan('data_create_accounts', call);
    expect(plan).toMatchObject({ tool: 'data_create_accounts', read: { project: 'sklep' } });
    expect(plan === undefined ? undefined : readFacts(plan, STATUS)).toMatchObject({
      scenario: 'checkout',
      slot: 'konta',
      count: 2000,
      environment: 'qa',
      protected: true,
      confirmed: true,
    });
    // Another spelling of the numbers is refused by the server, not passed by the mod unasked.
    for (const other of [
      { scenario: 'checkout', provision: { slot: 'konta', count: 2000 } },
      { scenario: 'checkout', slot: 'konta', accounts: 2000 },
      { scenario: 'checkout', slot_key: 'konta', count: 2000 },
      { ...call, count: '2000' },
    ]) {
      expect(dataCreateAccounts.input.safeParse(other).success).toBe(false);
    }
  });

  it('asks before flows_describe_journeys only when the browser signs in with an account', () => {
    const account = { from_env: '.env.perf', email_key: 'E2E_EMAIL' };
    const plan = consentPlan('flows_describe_journeys', {
      description: 'buy',
      environment: 'qa',
      account,
    });
    expect(plan).toMatchObject({ tool: 'flows_describe_journeys' });
    expect(plan?.read).toBeUndefined();
    expect(
      consentPlan('flows_describe_journeys', { description: 'buy', environment: 'qa' }),
    ).toBeUndefined();
  });

  // Contract with the server: the names consentPlan reads are the names of the tool's input, and
  // the input refuses any other spelling of them, so no call of the tool signs in unasked.
  it('reads flows_describe_journeys with the names of its input schema', () => {
    const call = {
      description: 'Customers log in, search and pay for an order.',
      environment: 'qa',
      account: { from_env: '.env.perf', email_key: 'QA_EMAIL', password_key: 'QA_PASSWORD' },
    };
    expect(flowsDescribeJourneys.input.safeParse(call).success).toBe(true);
    const plan = consentPlan('flows_describe_journeys', call);
    expect(plan).toMatchObject({ tool: 'flows_describe_journeys' });
    expect(plan === undefined ? undefined : readFacts(plan, undefined)).toMatchObject({
      fromEnv: '.env.perf',
      emailKey: 'QA_EMAIL',
      passwordKey: 'QA_PASSWORD',
    });
    // Another spelling of the account is refused by the server, not passed by the mod unasked.
    for (const other of [{ fromEnv: '.env.perf' }, { from_env: '.env.perf', emailKey: 'X' }]) {
      expect(flowsDescribeJourneys.input.safeParse({ ...call, account: other }).success).toBe(
        false,
      );
    }
    expect(flowsDescribeJourneys.input.safeParse({ ...call, credentials: {} }).success).toBe(false);
  });

  it('leaves alone a call it cannot read and a tool it does not guard', () => {
    expect(consentPlan('run_start', { scenario: 'checkout', environment: 'qa' })).toBeUndefined();
    expect(consentPlan('process_cancel', {})).toBeUndefined();
    expect(consentPlan('process_get_status', {})).toBeUndefined();
    expect(consentPlan(undefined, {})).toBeUndefined();
  });

  it('guards exactly the four tools with an effect outside the editor', () => {
    expect([...CONSENT_TOOLS].sort()).toEqual(
      ['process_cancel', 'flows_describe_journeys', 'data_create_accounts', 'run_start'].sort(),
    );
  });
});

describe('readFacts: facts the server did not give mean no question', () => {
  it('needs the preflight of run_start', () => {
    const plan = consentPlan('run_start', RUN_CALL);
    if (plan === undefined) throw new Error('no plan');
    expect(readFacts(plan, undefined)).toBeUndefined();
    expect(readFacts(plan, { dry_run: true })).toBeUndefined();
    expect(readFacts(plan, { ...QA_CLAMPED, consent_required: 'yes' })).toBeUndefined();
  });

  it('needs a snapshot of the very operation cancel names', () => {
    const plan = consentPlan('process_cancel', { operation: HANDLE });
    if (plan === undefined) throw new Error('no plan');
    expect(readFacts(plan, undefined)).toBeUndefined();
    expect(readFacts(plan, { ...SNAPSHOT, operation: 'test_run:other' })).toBeUndefined();
    expect(readFacts(plan, SNAPSHOT)).toBeDefined();
  });

  it('takes the numbers of data_create_accounts from the call even without the status', () => {
    const call = { scenario: 'checkout', slot: 'konta', count: 2000 };
    expect(factsOf('data_create_accounts', call, undefined)).toMatchObject({
      tool: 'data_create_accounts',
      count: 2000,
      slot: 'konta',
      protected: null,
    });
  });
});

describe('decide: run_start', () => {
  it('passes an unprotected environment and a profile within its limits without a question', () => {
    expect(decide(runFacts(PERF_FREE), EMPTY_LEDGER, NOW, 'en')).toEqual({ pass: true });
  });

  it('asks with the numbers on a protected environment with a clamped profile (en)', () => {
    const question = asked(decide(runFacts(), EMPTY_LEDGER, NOW, 'en'));
    expect(question.text).toBe(
      'Start a test of checkout on qa (protected): Ramp load (closed) clamped from 2,000 to ' +
        '100 users, planned 10:00, data 2,000 ≥ 1,200?',
    );
    expect(question.options).toEqual(['Run clamped', "Don't run"]);
    expect(question.yes).toBe('Run clamped');
    expect(question.denial).toBe(
      '[user_declined] The user declined to start this test (checkout on environment qa, ' +
        'protected, profile capped 2,000 → 100 users). Nothing was started. Do not retry; ask ' +
        'the user what to change.',
    );
  });

  it('asks with the numbers on a protected environment with a clamped profile (pl)', () => {
    const question = asked(decide(runFacts(), EMPTY_LEDGER, NOW, 'pl'));
    expect(question.text).toBe(
      `Uruchomić test checkout na qa (chronione): Ramp load (closed) przycięty z 2${NNBSP}000 ` +
        `do 100 użytkowników, plan 10:00, dane 2${NNBSP}000 ≥ 1${NNBSP}200?`,
    );
    expect(question.options).toEqual(['Uruchom przycięty', 'Nie uruchamiaj']);
    // What the model reads is English in every locale, like every other tool result.
    expect(question.denial).toBe(asked(decide(runFacts(), EMPTY_LEDGER, NOW, 'en')).denial);
  });

  it('asks on a protected environment whose limits keep the profile, with plain options', () => {
    const within = {
      ...QA_CLAMPED,
      profile_requested: { type: 'ramp_concurrency', vusers: 80, ramp: 600 },
      profile_effective: { type: 'ramp_concurrency', vusers: 80, ramp: 600 },
      capped: false,
      data: { ...QA_CLAMPED.data, needed: null, available: null },
      planned_s: null,
    };
    const en = asked(decide(runFacts(within), EMPTY_LEDGER, NOW, 'en'));
    expect(en.text).toBe(
      'Start a test of checkout on qa (protected): Ramp load (closed), 80 users?',
    );
    expect(en.options).toEqual(['Run', "Don't run"]);
    expect(en.denial).toContain('(checkout on environment qa, protected, profile 80 users)');
    const pl = asked(decide(runFacts(within), EMPTY_LEDGER, NOW, 'pl'));
    expect(pl.text).toBe(
      'Uruchomić test checkout na qa (chronione): Ramp load (closed), 80 użytkowników?',
    );
    expect(pl.options).toEqual(['Uruchom', 'Nie uruchamiaj']);
  });

  it('counts an arrival-rate profile in new users per second, and short data with <', () => {
    const rate = {
      ...QA_CLAMPED,
      environment: { name: 'perf', protected: false, limit: { max_rps: 20 } },
      profile_label: 'Constant load (open)',
      profile_requested: { type: 'constant', vusers: 50, hold: 300 },
      profile_effective: { type: 'constant', vusers: 20, hold: 300 },
      data: { ...QA_CLAMPED.data, needed: 6000, available: 100 },
      planned_s: 300,
    };
    expect(asked(decide(runFacts(rate), EMPTY_LEDGER, NOW, 'en')).text).toBe(
      'Start a test of checkout on perf: Constant load (open) clamped from 50 to 20 new/s, ' +
        'planned 5:00, data 100 < 6,000?',
    );
    expect(asked(decide(runFacts(rate), EMPTY_LEDGER, NOW, 'pl')).text).toBe(
      'Uruchomić test checkout na perf: Constant load (open) przycięty z 50 do 20 nowych/s, ' +
        `plan 5:00, dane 100 < 6${NNBSP}000?`,
    );
  });

  it('remembers the consent only when the call still lacks confirm_capped', () => {
    expect(asked(decide(runFacts(), EMPTY_LEDGER, NOW, 'en')).remember).toBe(true);
    const confirmed = runFacts(QA_CLAMPED, { ...RUN_CALL, confirm_capped: true });
    expect(asked(decide(confirmed, EMPTY_LEDGER, NOW, 'en')).remember).toBe(false);
  });

  it('puts no line break, control character or bidi mark of a name into the question', () => {
    const odd = {
      ...QA_CLAMPED,
      target: { kind: 'composition', name: 'check\nout‮↗ https://x' },
    };
    const question = asked(decide(runFacts(odd), EMPTY_LEDGER, NOW, 'en'));
    expect(question.text).not.toMatch(/[\n\r‮]/u);
    expect(question.denial).not.toMatch(/[\n\r‮]/u);
  });
});

describe('ledger: one consent, one use, ten minutes', () => {
  const ask = (facts: ConsentFacts, ledger: Ledger, now: number): Decision =>
    decide(facts, ledger, now, 'en');

  /** The ledger after the user said yes to `facts` at `now`. */
  const agreed = (facts: ConsentFacts, now: number): Ledger => {
    const question = asked(ask(facts, EMPTY_LEDGER, now));
    return grant(EMPTY_LEDGER, question.tool, question.key, now);
  };

  it('lets the same facts through once without a question, then asks again', () => {
    const facts = runFacts();
    let ledger = agreed(facts, NOW);
    // The model repeats the call with confirm_capped: true, as the server told it.
    const repeat = runFacts(QA_CLAMPED, { ...RUN_CALL, confirm_capped: true });
    const first = ask(repeat, ledger, NOW + 1_000);
    expect(first).toMatchObject({ pass: true, consume: { tool: 'run_start' } });
    if (!('pass' in first) || first.consume === undefined) throw new Error('expected a pass');
    ledger = consume(ledger, first.consume.tool, first.consume.key, NOW + 1_000);
    expect(ledger.entries).toEqual([]);
    expect('ask' in ask(repeat, ledger, NOW + 2_000)).toBe(true);
  });

  it('asks again when the effective profile changed', () => {
    const ledger = agreed(runFacts(), NOW);
    const other = {
      ...QA_CLAMPED,
      profile_effective: { type: 'ramp_concurrency', vusers: 90, ramp: 600 },
    };
    expect('ask' in ask(runFacts(other), ledger, NOW + 1_000)).toBe(true);
  });

  it('asks again on another environment and for another number of accounts', () => {
    const ledger = agreed(runFacts(), NOW);
    const elsewhere = { ...QA_CLAMPED, environment: { ...QA_CLAMPED.environment, name: 'qa2' } };
    expect('ask' in ask(runFacts(elsewhere), ledger, NOW + 1_000)).toBe(true);

    const provision = (count: number) =>
      factsOf(
        'data_create_accounts',
        { scenario: 'checkout', environment: 'qa', slot: 'konta', count },
        STATUS,
      );
    const accounts = agreed(provision(2000), NOW);
    expect('ask' in ask(provision(2001), accounts, NOW + 1_000)).toBe(true);
    expect(ask(provision(2000), accounts, NOW + 1_000)).toMatchObject({ pass: true });
  });

  it('asks again ten minutes after the consent', () => {
    const ledger = agreed(runFacts(), NOW);
    expect(ask(runFacts(), ledger, NOW + CONSENT_TTL_MS - 1)).toMatchObject({ pass: true });
    expect('ask' in ask(runFacts(), ledger, NOW + CONSENT_TTL_MS)).toBe(true);
  });

  it('does not take the consent for one tool as the consent for another', () => {
    const facts = runFacts();
    const question = asked(ask(facts, EMPTY_LEDGER, NOW));
    const ledger = grant(EMPTY_LEDGER, 'data_create_accounts', question.key, NOW);
    expect('ask' in ask(facts, ledger, NOW + 1_000)).toBe(true);
  });

  it('keeps the other entries when one is used, and drops the expired ones', () => {
    let ledger = grant(EMPTY_LEDGER, 'run_start', 'a', NOW);
    ledger = grant(ledger, 'run_start', 'b', NOW + 1);
    ledger = grant(ledger, 'run_start', 'c', NOW + CONSENT_TTL_MS + 2);
    expect(ledger.entries.map((entry) => entry.key)).toEqual(['c']);
    ledger = grant(ledger, 'run_start', 'd', NOW + CONSENT_TTL_MS + 3);
    ledger = consume(ledger, 'run_start', 'c', NOW + CONSENT_TTL_MS + 4);
    expect(ledger.entries.map((entry) => entry.key)).toEqual(['d']);
  });

  it('reads a damaged ledger as an empty one', () => {
    const damaged = { entries: 'x' } as unknown as Ledger;
    expect('ask' in ask(runFacts(), damaged, NOW)).toBe(true);
    expect(grant(damaged, 'run_start', 'a', NOW).entries).toHaveLength(1);
  });
});

describe('decide: data_create_accounts, flows_describe_journeys and process_cancel always ask', () => {
  it('asks before accounts are created, with the count, the slot and the environment', () => {
    const call = {
      scenario: 'checkout',
      environment: 'qa',
      slot: 'konta',
      count: 2000,
    };
    const en = asked(
      decide(factsOf('data_create_accounts', call, STATUS), EMPTY_LEDGER, NOW, 'en'),
    );
    expect(en.text).toBe(
      'Create 2,000 accounts for slot konta on qa (protected) in the tested system?',
    );
    expect(en.options).toEqual(['Create accounts', "Don't create"]);
    expect(en.denial).toBe(
      '[user_declined] The user declined to create these accounts (2,000 for slot konta on ' +
        'environment qa). Nothing was sent. Do not retry; ask the user what to change.',
    );
    const pl = asked(
      decide(factsOf('data_create_accounts', call, STATUS), EMPTY_LEDGER, NOW, 'pl'),
    );
    expect(pl.text).toBe(
      `Założyć 2${NNBSP}000 kont dla slotu konta na qa (chronione) w testowanym systemie?`,
    );
    expect(pl.options).toEqual(['Załóż konta', 'Nie zakładaj']);
  });

  it('names the default environment when the call names none', () => {
    const call = { scenario: 'checkout', slot: 'konta', count: 1 };
    expect(
      asked(decide(factsOf('data_create_accounts', call, STATUS), EMPTY_LEDGER, NOW, 'en')).text,
    ).toBe('Create 1 account for slot konta on perf (default) in the tested system?');
    expect(
      asked(decide(factsOf('data_create_accounts', call, undefined), EMPTY_LEDGER, NOW, 'pl')).text,
    ).toBe('Założyć 1 konto dla slotu konta na środowisku domyślnym w testowanym systemie?');
  });

  it('remembers the consent for accounts only while the server will still ask for it', () => {
    const on = (environment: string | undefined, extra: Record<string, unknown> = {}) =>
      asked(
        decide(
          factsOf(
            'data_create_accounts',
            {
              scenario: 'checkout',
              ...(environment === undefined ? {} : { environment }),
              slot: 'konta',
              count: 10,
              ...extra,
            },
            STATUS,
          ),
          EMPTY_LEDGER,
          NOW,
          'en',
        ),
      ).remember;
    // A protected environment answers with a request for consent: the call comes again.
    expect(on('qa')).toBe(true);
    // An unprotected one creates the accounts at once, and so does a call that carries the consent.
    expect(on('perf')).toBe(false);
    expect(on(undefined)).toBe(false);
    expect(on('qa', { confirm_protected: true })).toBe(false);
  });

  it('asks before the browser agent signs in with an account', () => {
    const call = {
      description: 'buy a product',
      environment: 'qa',
      account: { from_env: '.env.perf', email_key: 'E2E_EMAIL', password_key: 'E2E_PASSWORD' },
    };
    const en = asked(
      decide(factsOf('flows_describe_journeys', call, undefined), EMPTY_LEDGER, NOW, 'en'),
    );
    expect(en.text).toBe(
      'LoadCraft keeps this sign-in for the run: let its browser agent sign in to qa with the ' +
        'account from .env.perf (E2E_EMAIL)?',
    );
    expect(en.options).toEqual(['Let it sign in', "Don't sign in"]);
    expect(en.remember).toBe(false);
    expect(en.denial).toBe(
      '[user_declined] The user declined to let the browser agent sign in (environment qa, ' +
        'account from .env.perf). Nothing was sent. Do not retry; ask the user what to change.',
    );
    const pl = asked(
      decide(factsOf('flows_describe_journeys', call, undefined), EMPTY_LEDGER, NOW, 'pl'),
    );
    expect(pl.text).toBe(
      'LoadCraft przechowa to logowanie na czas przebiegu: pozwolić jego agentowi przeglądarki ' +
        'zalogować się na qa kontem z .env.perf (E2E_EMAIL)?',
    );
    expect(pl.options).toEqual(['Pozwól zalogować', 'Nie loguj']);
  });

  it('asks before a test is stopped, with the time from the snapshot, stopping first', () => {
    const facts = factsOf('process_cancel', { operation: HANDLE }, SNAPSHOT);
    const en = asked(decide(facts, EMPTY_LEDGER, NOW, 'en'));
    expect(en.text).toBe('Stop test e-3f9a12c4 after 6:40 of 10:00?');
    expect(en.options).toEqual(['Stop the test', 'Keep it running']);
    expect(en.yes).toBe(en.options[0]);
    expect(en.remember).toBe(false);
    expect(en.denial).toBe(
      `[user_declined] The user chose to keep this operation running (${HANDLE}, 6:40 of ` +
        '10:00). Nothing was stopped. Do not retry; follow it with process_wait, or ask the user what ' +
        'to change.',
    );
    const pl = asked(decide(facts, EMPTY_LEDGER, NOW, 'pl'));
    expect(pl.text).toBe('Przerwać test e-3f9a12c4 po 6:40 z 10:00?');
    expect(pl.options).toEqual(['Przerwij test', 'Niech trwa']);
  });

  it('counts from the start of the operation before the load runs, and for other kinds', () => {
    const building = factsOf(
      'process_cancel',
      { operation: HANDLE },
      { operation: HANDLE, kind: 'test_run', phase: 'building', elapsed_s: 45 },
    );
    expect(asked(decide(building, EMPTY_LEDGER, NOW, 'en')).text).toBe(
      'Stop test e-3f9a12c4, started 0:45 ago?',
    );
    expect(asked(decide(building, EMPTY_LEDGER, NOW, 'pl')).text).toBe(
      'Przerwać test e-3f9a12c4 uruchomiony 0:45 temu?',
    );
    const refine = 'refine:job-7';
    const other = factsOf(
      'process_cancel',
      { operation: refine },
      { operation: refine, kind: 'refine', elapsed_s: 80 },
    );
    const en = asked(decide(other, EMPTY_LEDGER, NOW, 'en'));
    expect(en.text).toBe('Stop operation refine:job-7, started 1:20 ago?');
    expect(en.options).toEqual(['Stop it', 'Keep it running']);
    expect(asked(decide(other, EMPTY_LEDGER, NOW, 'pl')).text).toBe(
      'Przerwać operację refine:job-7 uruchomioną 1:20 temu?',
    );
  });

  it('does not ask before cancelling an operation that has ended', () => {
    for (const phase of ['completed', 'failed', 'cancelled', 'abandoned']) {
      const facts = factsOf('process_cancel', { operation: HANDLE }, { ...SNAPSHOT, phase });
      expect(decide(facts, EMPTY_LEDGER, NOW, 'en')).toEqual({ pass: true });
    }
  });
});

describe('settle: only the exact yes label is a yes', () => {
  const question = asked(decide(runFacts(), EMPTY_LEDGER, NOW, 'en'));

  it('lets the call on after the yes label', () => {
    expect(settle(question, { answer: 'Run clamped' })).toBe('allow');
  });

  it('refuses after the no label, a typed answer, or a near miss', () => {
    expect(settle(question, { answer: "Don't run" })).toBe('deny');
    expect(settle(question, { answer: 'yes, run it' })).toBe('deny');
    expect(settle(question, { answer: 'run clamped' })).toBe('deny');
    expect(settle(question, { answer: ' Run clamped' })).toBe('deny');
    expect(settle(question, { answer: 'Run clamped, Don’t run' })).toBe('deny');
  });

  it('refuses a closed dialog while someone could answer, and lets the call on when nobody can', () => {
    expect(settle(question, { dismissed: true, surfaces: 1 })).toBe('deny');
    expect(settle(question, { dismissed: true, surfaces: 0 })).toBe('pass');
  });
});

// A small deterministic generator, so a failure names its seed and can be replayed.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('property: a yes to the facts is never a refusal', () => {
  const NAMES = ['qa', 'perf', 'staging', 'konta', 'a\nb', 'x'.repeat(200), 'ünï', '‮rtl', ''];
  const TYPES = ['ramp_concurrency', 'constant', 'stress', 'spike', 'soak', 'smoke'];

  function randomFacts(next: () => number): ConsentFacts {
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    // A name the server and the model never leave empty; the empty one still goes where allowed.
    const named = (): string => pick(NAMES) || 'x';
    const count = () => 1 + Math.floor(next() * 20_000);
    const tool = pick(CONSENT_TOOLS);
    switch (tool) {
      case 'run_start': {
        const type = pick(TYPES);
        const requested = count();
        const capped = next() < 0.5;
        const isProtected = !capped || next() < 0.5;
        const needed = next() < 0.3 ? null : count();
        return factsOf(
          'run_start',
          { ...RUN_CALL, confirm_capped: next() < 0.5 },
          {
            ...QA_CLAMPED,
            target: { kind: 'scenario', name: named() },
            environment: { name: named(), protected: isProtected },
            profile_label: pick(NAMES),
            profile_requested: { type, vusers: requested },
            profile_effective: { type, vusers: capped ? Math.max(1, requested >> 1) : requested },
            capped,
            consent_required: true,
            data: { ...QA_CLAMPED.data, needed, available: needed === null ? null : count() },
            planned_s: next() < 0.3 ? null : count(),
          },
        );
      }
      case 'data_create_accounts':
        return factsOf(
          'data_create_accounts',
          {
            scenario: pick(NAMES),
            ...(next() < 0.3 ? {} : { environment: pick(NAMES) }),
            slot: named(),
            count: count(),
            confirm_protected: next() < 0.5,
          },
          next() < 0.5 ? STATUS : undefined,
        );
      case 'flows_describe_journeys':
        return factsOf(
          'flows_describe_journeys',
          {
            description: 'x',
            ...(next() < 0.3 ? {} : { environment: pick(NAMES) }),
            account: {
              from_env: named(),
              ...(next() < 0.5 ? {} : { email_key: pick(NAMES) }),
            },
          },
          undefined,
        );
      case 'process_cancel': {
        const operation = `${pick(['test_run', 'refine', 'record_run'])}:${pick(NAMES)}x`;
        return factsOf(
          'process_cancel',
          { operation },
          {
            operation,
            kind: operation.split(':')[0],
            phase: pick(['running', 'building', 'pending', undefined]),
            elapsed_s: count(),
            ...(next() < 0.5 ? {} : { load_elapsed_s: count(), planned_s: count() }),
          },
        );
      }
    }
  }

  it('for 2000 random facts in both languages: asked, a yes lets the call on; the same facts again pass once', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const next = random(seed);
      const facts = randomFacts(next);
      const locale = next() < 0.5 ? 'en' : 'pl';
      const others = Array.from({ length: Math.floor(next() * 4) }, (_, i) => ({
        tool: pick2(next),
        key: `other-${String(i)}`,
        at: NOW - Math.floor(next() * CONSENT_TTL_MS * 2),
      }));
      const ledger: Ledger = { entries: others };
      const decision = decide(facts, ledger, NOW, locale);
      if ('pass' in decision) continue;
      const question = decision.ask;
      const where = `seed ${String(seed)}: ${question.text}`;
      expect(question.text.endsWith('?'), where).toBe(true);
      expect(question.text, where).not.toMatch(/[\n\r]/u);
      expect(question.options.length, where).toBeGreaterThanOrEqual(2);
      expect(question.options.length, where).toBeLessThanOrEqual(4);
      expect(new Set(question.options).size, where).toBe(question.options.length);
      expect(question.options, where).toContain(question.yes);
      expect(question.denial.startsWith('[user_declined] '), where).toBe(true);
      expect(settle(question, { answer: question.yes }), where).toBe('allow');
      if (question.remember) {
        const after = grant(ledger, question.tool, question.key, NOW);
        expect(decide(facts, after, NOW + 1, locale), where).toMatchObject({ pass: true });
      }
    }
  });

  function pick2(next: () => number): string {
    return CONSENT_TOOLS[Math.floor(next() * CONSENT_TOOLS.length)] ?? 'run_start';
  }
});

describe('the facts of the real server', () => {
  it('turns the preflight the server answers for a clamped test on qa into the question', async () => {
    const clock = createTestClock(Date.parse('2026-11-22T11:00:00Z'));
    const r = await toolRig({
      tools: [processGetStatus],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerDataRoutes(fake);
        registerExecutionRoutes(fake);
        seedSklep(fake.store, { stage: 'data' });
      },
      clock,
      env: { LOADCRAFT_LOCALE: 'pl' },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const plan = consentPlan('run_start', RUN_CALL);
    if (plan?.read === undefined) throw new Error('no read');
    const answer = await settleClock(r, r.call('process_get_status', plan.read));
    expect(answer.isError).toBe(false);
    const facts = readFacts(plan, JSON.parse(answer.text));
    if (facts === undefined) throw new Error('no facts');
    const question = asked(decide(facts, EMPTY_LEDGER, NOW, 'pl'));
    expect(question.text).toMatch(
      new RegExp(
        `^Uruchomić test checkout na qa \\(chronione\\): Ramp load \\(closed\\) przycięty z 2${NNBSP}000 do \\d+ użytkowników, plan 10:00`,
        'u',
      ),
    );
    // The numbers are written as the server's own view of the same facts writes them.
    const view = await settleClock(
      r,
      r.call('process_get_status', { preflight: (plan.read as { preflight: unknown }).preflight }),
    );
    expect(view.text).toContain(`2${NNBSP}000 →`);
    expect(view.text).toContain('10:00');
  });
});

describe('the hook in register.ts', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'register.ts'), 'utf8');
  const built = readFileSync(join(import.meta.dirname, '..', 'register.js'), 'utf8');

  it('names exactly the four guarded tools in its matcher', () => {
    const block = /on\(\s*'tool\.call',\s*\{\s*tool:\s*\[([^\]]*)\]/u.exec(source)?.[1] ?? '';
    const names = [...block.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
    expect(names.sort()).toEqual(
      CONSENT_TOOLS.map((tool) => `mcp__plugin_loadcraft_lc__${tool}`).sort(),
    );
  });

  it('carries a .catch that passes the call on, in the source and in the built module', () => {
    expect(source).toMatch(/\)\.catch\(\(\$, e, next\) => next\(e\)\);/u);
    expect(built).toMatch(/\)\.catch\(\(\$,\s*e,\s*next\)\s*=>\s*next\(e\)\);/u);
  });

  it('never approves anything in place of Claude Code and never changes the arguments', () => {
    expect(source).not.toMatch(/tool\.check|confirm_capped\s*:|confirm_protected\s*:/u);
    expect(source).not.toMatch(/next\(\{/u);
  });
});

// Keep the declared shape in use, so the compiler checks it both ways.
export const DECLARED = [declaredFromLedger, ledgerFromDeclared];
