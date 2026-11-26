// Cases and runner of the sentinel suite (canary.*.test.ts): for every tool of the registry, a
// secret that arrives in an answer or that sits in a file of the customer's repository never
// reaches the model. The suite walks `ALL_TOOLS`, so a tool added without a case here turns the
// "every tool has a case" test (canary.success.test.ts) red.
//
// What is fed in: the API token is the sentinel (so is the password in `.env.perf` and in the
// accounts file), and a proxy in front of the fake backend taints every JSON answer with the
// sentinel in a free-text value, under a nested `password` key and in a list, and adds it to the
// headers. A second pass answers every request with an error that quotes the sentinel.
// What is checked, per call: the text of the result (success and `[code]` error), the structured
// content and the progress notifications, the log lines and every file under `loadcraft/`
// (`rig.assertClean`). Cases never put the sentinel in a tool argument: a name the user typed may
// come back in the result.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ALL_TOOLS } from '../../src/tools/index.js';
import { fixtureFiles, handleFromText } from '../e2e/driver.js';
import { taintProxy, type FailOptions, type TaintProxy } from '../fake-backend/faults.js';
import type { Fake } from '../fake-backend/server.js';
import { planExecutionIds, scriptRuns, type RunScript } from '../fake-backend/routes/executions.js';
import { registerAllRoutes } from '../fake-backend/routes/index.js';
import { seedTraces } from '../fake-backend/routes/traces.js';
import { scriptBuilderModel } from '../fake-backend/routes/scenarioBuilder.js';
import { seedAutoDatasets } from '../fake-backend/routes/data.js';
import { setFakeProvision } from '../fake-backend/routes/provision.js';
import { saveSpecification } from '../fake-backend/routes/setup.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepStage,
} from '../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../golden/index.js';
import { BACKEND_CANARY, FILE_CANARY, HEADER_CANARY } from '../helpers/canary.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from '../helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const FAST = { stepMs: 10_000, limitMs: 3_600_000 } as const;
const MAX_CONTINUATIONS = 20;
const PERF = SKLEP_IDS.executionPerf;
const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: SKLEP_IDS.project, name: 'sklep' },
});

// ---- what the customer's repository holds -----------------------------------------------------

const ACCOUNTS_CSV = [
  'Email,Password',
  `anna@example.com,Pw-${FILE_CANARY}-1`,
  `jan@example.com,Pw-${FILE_CANARY}-2`,
  '',
].join('\n');

const HAR = JSON.stringify({
  log: {
    version: '1.2',
    entries: [
      {
        request: { method: 'POST', url: 'https://perf.example.com/auth/login', headers: [] },
        response: {
          status: 200,
          content: { size: 120, text: JSON.stringify({ token: FILE_CANARY }) },
        },
      },
      {
        request: {
          method: 'GET',
          url: 'https://perf.example.com/shop',
          headers: [{ name: 'Authorization', value: `Bearer ${FILE_CANARY}` }],
        },
        response: { status: 200, content: { size: 120, text: '{"items":[]}' } },
      },
    ],
  },
});

function workspaceFiles(): Record<string, string> {
  return {
    ...fixtureFiles(),
    'loadcraft/project.json': BOUND,
    '.env.perf': `API_URL=https://api.perf.example.com\nTEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${FILE_CANARY}\n`,
    'data/konta.csv': ACCOUNTS_CSV,
    'captures/shop.har': HAR,
  };
}

/** The environment of the run keeps a secret variable, which a refusal of the backend may quote. */
export function envSecret(fake: Fake): void {
  fake.store
    .collection(SKLEP_COLLECTIONS.environments)
    .update(SKLEP_WORLD_IDS.environments.perf, { variables: { api_secret: BACKEND_CANARY } });
}

// ---- the cases ---------------------------------------------------------------------------------

const ACCOUNTS_FILE_ARGS = {
  scenario: 'checkout',
  slot: 'accounts',
  file: 'data/konta.csv',
  name: 'konta',
};

/** The token of the consent card a call returns, carried as the handle of the step before. */
async function cardToken(
  drive: Drive,
  tool: string,
  args: Record<string, unknown>,
): Promise<Before> {
  const card = await drive.once(tool, args);
  const data = card.outcome?.data as { confirm?: string } | undefined;
  return data?.confirm === undefined ? {} : { handle: data.confirm };
}

/** Handle left by the step that ran before the call under test. */
interface Before {
  readonly handle?: string;
}

interface Drive {
  readonly r: ToolRig;
  /** Calls a tool and, while its result is unfinished, `process_wait` on the handle it names. */
  call(tool: string, args: Record<string, unknown>): Promise<RigCallResult[]>;
  /** One call only: an unfinished result stays unfinished. */
  once(tool: string, args: Record<string, unknown>): Promise<RigCallResult>;
}

export interface Case {
  /** The tool the case covers (a name of `ALL_TOOLS`). */
  readonly tool: string;
  readonly label: string;
  readonly stage: SklepStage;
  readonly args: (before: Before) => Record<string, unknown>;
  /** Healthy steps before the call under test. */
  readonly before?: (drive: Drive) => Promise<Before>;
  readonly script?: RunScript;
  readonly capabilities?: readonly string[];
  /** Names are tainted as well (only for cases that do not look an object up by name). */
  readonly names?: boolean;
  /**
   * The tainted call is refused by the state file's guard (the backend's text that holds a secret
   * must not be saved), with this code, instead of finishing.
   */
  readonly refusedAs?: string;
  /** Runs on the fake before the call (records the backend holds, how it answers). */
  readonly setup?: (fake: Fake) => void;
  /** Which requests fail in the error runs; default: all but the identity reads. */
  readonly failOptions?: FailOptions;
  /** The error runs end in an error that quotes the backend text, masked. */
  readonly quotes?: boolean;
  /** One call only, with no `process_wait` after it. */
  readonly single?: boolean;
  /** The call emits progress notifications. */
  readonly progress?: boolean;
  /** Only answers to reads are tainted: what a long operation polls, not what it saves at the start. */
  readonly readsOnly?: boolean;
  /** The person behind the client ticks yes to every question the server asks (elicitation). */
  readonly personSaysYes?: boolean;
  /**
   * Free texts also carry a credential known only by its shape (`TaintOptions.shapes`). Every case of
   * a tool of a module has it: such a tool masks a third party's text with `content` or `body`.
   */
  readonly shapes?: boolean;
}

const SHORT_RUN: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 120,
  end: 'completed',
  live: (elapsed) => ({ rps: elapsed * 1.7, p95: 500, errorRate: 0.006 }),
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: [0, 150, 290, 430, 570, 710, 860, 1000],
};

const LONG_RUN: RunScript = { ...SHORT_RUN, loadS: 3600 };

const PERF_RUN_ARGS = { scenario: 'checkout', environment: 'perf', profile: RAMP_2000 };

export const CREATE_ARGS = {
  name: 'sklep',
  environment: { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com' },
};
const SAVE_ENV_ARGS = {
  environments: [
    { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
    { name: 'qa', api: 'api.qa.example.com', limit: [100, 20] },
  ],
};
const ANALYZE_ARGS = { openapi: 'loadcraft/openapi.json' };

/** The steps of the project setup before `upTo`, on a healthy backend; the handle of the analysis. */
async function setupBefore(drive: Drive, upTo: string): Promise<Before> {
  const steps: readonly [string, Record<string, unknown>][] = [
    ['project_create', CREATE_ARGS],
    ['project_save_env', SAVE_ENV_ARGS],
    ['project_analyze_setup', ANALYZE_ARGS],
  ];
  let handle: string | undefined;
  for (const [tool, args] of steps) {
    if (tool === upTo) break;
    const last = (await drive.call(tool, args)).at(-1);
    if (last === undefined || last.isError) throw new Error(`${tool} failed: ${last?.text ?? ''}`);
    const data = last.outcome?.data as { operation?: unknown } | undefined;
    if (typeof data?.operation === 'string') handle = data.operation;
  }
  return handle === undefined ? {} : { handle };
}

const MIGRATION_CAPABILITIES = ['meta', 'flows_spec_migration'];

/** The project gets a newer docs version without operations: every flow of the world is on an older one. */
function newerDocs(fake: Fake): void {
  saveSpecification(fake.store, SKLEP_IDS.project, {
    openapi: '3.0.3',
    info: { title: 'Sklep API', version: '2.16.0' },
    paths: {},
  });
}

const PROVISION_CAPABILITIES = [
  'meta',
  'provision_environment',
  'provision_register_operation',
  'provision_protected_confirmation',
];

/** The plan `flows_describe_journeys` returned (account from the env file): what `flows_record_journeys` approves. */
async function describedPlan(drive: Drive): Promise<Before> {
  const results = await drive.call('flows_describe_journeys', {
    description: 'Customers log in, search for a product, put it in the cart and pay.',
    environment: 'perf',
    account: { from_env: '.env.perf' },
  });
  const plan = results.at(-1);
  const handle = /\bplan (r-[0-9a-f]{8})\b/u.exec(plan?.text ?? '')?.[1];
  if (handle === undefined)
    throw new Error(`flows_describe_journeys gave no plan: ${plan?.text ?? ''}`);
  return { handle };
}

/** A run that is still going: the handle of the call is what `process_wait` and `process_cancel` are given. */
async function startedRun(drive: Drive): Promise<Before> {
  const first = await drive.once('run_start', { ...PERF_RUN_ARGS, max_wait_s: 1 });
  const handle = handleFromText(first.text);
  if (handle === undefined) throw new Error(`run_start gave no handle: ${first.text}`);
  return { handle };
}

const OWN_CASES: readonly Case[] = [
  { tool: 'process_get_status', label: 'summary', stage: 'executed', args: () => ({}) },
  {
    tool: 'process_get_status',
    label: 'format data, names tainted',
    stage: 'executed',
    names: true,
    args: () => ({ format: 'data', detail: 'runs' }),
  },
  {
    tool: 'process_get_status',
    label: 'preflight',
    stage: 'data',
    args: () => ({ preflight: PERF_RUN_ARGS, format: 'data' }),
  },
  { tool: 'project_create', label: 'new project', stage: 'empty', args: () => CREATE_ARGS },
  {
    tool: 'project_save_env',
    label: 'environments of a new project',
    stage: 'empty',
    before: (drive) => setupBefore(drive, 'project_save_env'),
    args: () => SAVE_ENV_ARGS,
  },
  {
    tool: 'project_check_env',
    label: 'connection test',
    stage: 'empty',
    before: (drive) => setupBefore(drive, 'project_analyze_setup'),
    args: () => ({}),
  },
  {
    tool: 'project_analyze_setup',
    label: 'analysis of the documentation',
    stage: 'empty',
    before: (drive) => setupBefore(drive, 'project_analyze_setup'),
    args: () => ANALYZE_ARGS,
  },
  {
    tool: 'project_apply_setup',
    label: 'profile from the analysis',
    stage: 'empty',
    before: (drive) => setupBefore(drive, 'project_apply_setup'),
    args: (before) => (before.handle === undefined ? {} : { analysis: before.handle }),
  },
  {
    tool: 'project_get',
    label: 'profile with stats, setup and log server',
    stage: 'project',
    args: () => ({ include: ['stats', 'setup', 'telemetry'] }),
  },
  {
    tool: 'project_set_profile',
    label: 'consent card',
    stage: 'project',
    args: () => ({ fields: { app_architecture: 'ssr' } }),
  },
  {
    tool: 'project_set_profile',
    label: 'write after the card',
    stage: 'project',
    // the token of the card rides in `handle`
    before: async (drive) => {
      const result = await drive.once('project_set_profile', {
        fields: { app_architecture: 'ssr' },
      });
      const data = result.outcome?.data as { confirm?: string } | undefined;
      return data?.confirm === undefined ? {} : { handle: data.confirm };
    },
    args: (before) => ({
      fields: { app_architecture: 'ssr' },
      ...(before.handle === undefined ? {} : { confirm: before.handle }),
    }),
  },
  {
    tool: 'project_connect_telemetry',
    label: 'log server',
    stage: 'project',
    args: () => ({ label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' }),
  },
  {
    tool: 'flows_suggest_journeys',
    label: 'every answer tainted',
    stage: 'project',
    refusedAs: 'internal_secret_in_state',
    args: () => ({}),
  },
  {
    tool: 'flows_suggest_journeys',
    label: 'reads tainted, progress',
    stage: 'project',
    readsOnly: true,
    progress: true,
    args: () => ({}),
  },
  {
    tool: 'flows_generate_from_suggestions',
    label: 'from proposals',
    stage: 'project',
    before: async (drive) => {
      await drive.call('flows_suggest_journeys', {});
      return {};
    },
    args: () => ({ suggestions: ['zakupy'] }),
  },
  { tool: 'flows_get', label: 'outline', stage: 'flows', args: () => ({ flow: 'zakupy' }) },
  {
    tool: 'scenario_suggest_split',
    label: 'proposal',
    stage: 'flows',
    args: () => ({ name: 'checkout', flows: ['przeglądanie', 'zakupy', 'konto'] }),
  },
  {
    tool: 'scenario_generate',
    label: 'generation',
    stage: 'flows',
    args: () => ({
      name: 'checkout',
      flows: ['przeglądanie', 'zakupy', 'konto'],
      proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
      data_mix: 'normal',
    }),
  },
  {
    tool: 'data_check_readiness',
    label: 'plan',
    stage: 'scenario',
    args: () => ({ scenario: 'checkout' }),
  },
  {
    tool: 'data_suggest_actions',
    label: 'consent card',
    stage: 'scenario',
    args: () => ({ scenario: 'checkout' }),
  },
  {
    tool: 'data_suggest_actions',
    label: 'suggestion after the card',
    stage: 'scenario',
    before: (drive) => cardToken(drive, 'data_suggest_actions', { scenario: 'checkout' }),
    args: (before) => ({ scenario: 'checkout', confirm: before.handle ?? '' }),
  },
  {
    tool: 'data_create_dataset',
    label: 'accounts file, consent card',
    stage: 'scenario',
    args: () => ACCOUNTS_FILE_ARGS,
  },
  {
    tool: 'data_create_dataset',
    label: 'accounts file after the card',
    stage: 'scenario',
    before: (drive) => cardToken(drive, 'data_create_dataset', ACCOUNTS_FILE_ARGS),
    args: (before) => ({ ...ACCOUNTS_FILE_ARGS, confirm: before.handle ?? '' }),
  },
  {
    tool: 'data_set_bindings',
    label: 'pins',
    stage: 'scenario',
    args: () => ({
      scenario: 'checkout',
      bindings: { search_phrases: SKLEP_WORLD_IDS.feeders.frazy },
    }),
  },
  {
    tool: 'data_create_accounts',
    label: 'provision',
    stage: 'scenario',
    capabilities: PROVISION_CAPABILITIES,
    args: () => ({ scenario: 'checkout', slot: 'accounts', count: 2 }),
  },
  // The values below come from the customer's file and from the backend's data, never from the
  // token: only the registration of the value itself can hide them. The refused request is the
  // way they reach the model, in the text the backend quotes.
  {
    tool: 'data_create_dataset',
    label: 'accounts file, the refused upload quotes the passwords',
    stage: 'scenario',
    failOptions: { methods: ['POST', 'PUT', 'PATCH'], path: /\/gatling\/feeders/u },
    quotes: true,
    before: (drive) => cardToken(drive, 'data_create_dataset', ACCOUNTS_FILE_ARGS),
    args: (before) => ({ ...ACCOUNTS_FILE_ARGS, confirm: before.handle ?? '' }),
  },
  {
    tool: 'data_check_readiness',
    label: 'plan, a dataset with a password column',
    stage: 'scenario',
    setup: (fake) => {
      fake.store.collection(SKLEP_COLLECTIONS.feeders).update(SKLEP_WORLD_IDS.feeders.frazy, {
        columns: ['q', 'password'],
        content: `q,password\nshoes,${BACKEND_CANARY}\n`,
        audit_metadata: { sample_rows_preview: [{ q: 'shoes', password: BACKEND_CANARY }] },
      });
    },
    failOptions: { methods: ['POST'], quoteBackend: true },
    quotes: true,
    args: () => ({ scenario: 'checkout' }),
  },
  {
    tool: 'data_create_accounts',
    label: 'provision, the rows carry the passwords',
    stage: 'scenario',
    capabilities: PROVISION_CAPABILITIES,
    setup: (fake) => {
      setFakeProvision(fake.store, { leakRows: true });
    },
    failOptions: { methods: ['PUT'], quoteBackend: true },
    quotes: true,
    args: () => ({ scenario: 'checkout', slot: 'accounts', count: 2 }),
  },
  {
    tool: 'scenario_check_self',
    label: 'two scenarios',
    stage: 'data',
    args: () => ({ scenarios: ['zakupy', 'konto'] }),
  },
  {
    tool: 'run_plan',
    label: 'profiles',
    stage: 'data',
    args: () => ({ scenario: 'checkout', environment: 'perf', target_users: 2000 }),
  },
  {
    tool: 'run_start',
    label: 'every answer tainted',
    stage: 'data',
    script: SHORT_RUN,
    refusedAs: 'internal_secret_in_state',
    args: () => PERF_RUN_ARGS,
  },
  {
    tool: 'run_plan',
    label: 'profiles with the data check, the refused check quotes a secret of the environment',
    stage: 'data',
    setup: envSecret,
    failOptions: { methods: ['POST'], path: /\/feeders\/preflight$/u, quoteBackend: true },
    args: () => ({
      scenario: 'checkout',
      environment: 'perf',
      target_users: 2000,
      include_data: true,
    }),
  },
  {
    tool: 'run_start',
    label: 'the data check is refused, the refusal quotes a secret of the environment',
    stage: 'data',
    script: SHORT_RUN,
    refusedAs: 'internal_secret_in_state',
    setup: envSecret,
    failOptions: { methods: ['POST'], path: /\/feeders\/preflight$/u, quoteBackend: true },
    args: () => PERF_RUN_ARGS,
  },
  {
    tool: 'run_start',
    label: 'the start is refused, the refusal quotes a secret of the environment',
    stage: 'data',
    script: SHORT_RUN,
    refusedAs: 'internal_secret_in_state',
    setup: envSecret,
    failOptions: { methods: ['POST'], path: /\/execute$/u, quoteBackend: true },
    args: () => PERF_RUN_ARGS,
  },
  {
    tool: 'run_start',
    label: 'reads tainted, a run to its end',
    stage: 'data',
    script: SHORT_RUN,
    readsOnly: true,
    progress: true,
    args: () => PERF_RUN_ARGS,
  },
  {
    tool: 'results_get_report',
    label: 'report',
    stage: 'executed',
    args: () => ({ execution: PERF }),
  },
  {
    tool: 'results_analyze_run',
    label: 'stored analysis',
    stage: 'executed',
    args: () => ({ execution: PERF }),
  },
  {
    tool: 'results_get_errors',
    label: 'error groups',
    stage: 'executed',
    args: () => ({ execution: PERF }),
  },
  {
    tool: 'results_get_traces',
    label: 'failed requests with a password in the body and a token in a header',
    stage: 'executed',
    setup: (fake) => {
      seedTraces(fake, PERF, [
        {
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
          request: 'POST /checkout',
          method: 'POST',
          url: 'https://api.perf.example.com/checkout',
          status: 400,
          requestHeaders: `Authorization: Bearer ${HEADER_CANARY}\nContent-Type: application/json`,
          requestBody: JSON.stringify({ email: 'user@example.com', password: BACKEND_CANARY }),
          responseBody: JSON.stringify({ error: `bad password ${BACKEND_CANARY}` }),
          error: 'status.find.is(200), found 400',
        },
      ]);
    },
    args: () => ({ execution: PERF }),
  },
  {
    tool: 'flows_import_har',
    label: 'recording',
    stage: 'project',
    args: () => ({ file: 'captures/shop.har' }),
  },
  {
    tool: 'flows_describe_journeys',
    label: 'account from .env.perf',
    stage: 'project',
    capabilities: ['meta', 'api_token_sockets'],
    args: () => ({
      description: 'Customers log in, search for a product, put it in the cart and pay.',
      environment: 'perf',
      account: { from_env: '.env.perf' },
    }),
  },
  // The refused start quotes the request it got, the password from the env file included.
  {
    tool: 'flows_describe_journeys',
    label: 'account from .env.perf, the refused start quotes the password',
    stage: 'project',
    capabilities: ['meta', 'api_token_sockets'],
    failOptions: { methods: ['POST'], path: /\/scenario-from-description\/generate$/u },
    quotes: true,
    args: () => ({
      description: 'Customers log in, search for a product, put it in the cart and pay.',
      environment: 'perf',
      account: { from_env: '.env.perf' },
    }),
  },
  {
    tool: 'flows_record_journeys',
    label: 'the plan of a description, approved and walked',
    stage: 'project',
    capabilities: ['meta', 'api_token_sockets'],
    before: describedPlan,
    args: (before) => ({ plan: before.handle ?? '', paths: 'all' }),
  },
  {
    tool: 'project_import_docs',
    label: 'new documentation',
    stage: 'flows',
    args: () => ({ openapi: 'loadcraft/openapi.json' }),
  },
  {
    tool: 'flows_migrate_docs',
    label: 'preview of the flows on an older docs version',
    stage: 'flows',
    capabilities: MIGRATION_CAPABILITIES,
    setup: newerDocs,
    args: () => ({ preview: true }),
  },
  {
    tool: 'flows_migrate_docs',
    label: 'migration after the consent, steps without an endpoint allowed',
    stage: 'flows',
    capabilities: MIGRATION_CAPABILITIES,
    setup: newerDocs,
    // the consent card first: its token is what the confirm of the same call carries
    before: async (drive) => {
      const card = await drive.once('flows_migrate_docs', { allow_unmatched: true });
      return { handle: /confirm: "([0-9a-f]+)"/u.exec(card.text)?.[1] ?? '' };
    },
    args: (before) => ({ confirm: before.handle ?? '', allow_unmatched: true }),
  },
  {
    tool: 'project_delete',
    label: 'card of the project and what goes with it',
    stage: 'executed',
    args: () => ({ kind: 'project', ids: [SKLEP_IDS.project] }),
  },
  {
    tool: 'project_delete',
    label: 'deletion after the yes of the person',
    stage: 'executed',
    personSaysYes: true,
    // the card first; its token rides in `handle`
    before: async (drive) => {
      const card = await drive.once('project_delete', {
        kind: 'project',
        ids: [SKLEP_IDS.project],
      });
      return { handle: /confirm: "([0-9a-f]+)"/u.exec(card.text)?.[1] ?? '' };
    },
    args: (before) => ({ kind: 'project', ids: [SKLEP_IDS.project], confirm: before.handle ?? '' }),
  },
  {
    tool: 'flows_delete',
    label: 'card of a flow and what stays behind it',
    stage: 'executed',
    args: () => ({ kind: 'flow', flow_ids: [SKLEP_IDS.flowZakupy] }),
  },
  {
    tool: 'flows_delete',
    label: 'deletion after the yes of the person',
    stage: 'executed',
    personSaysYes: true,
    before: async (drive) => {
      const card = await drive.once('flows_delete', {
        kind: 'flow',
        flow_ids: [SKLEP_IDS.flowZakupy],
      });
      return { handle: /confirm: "([0-9a-f]+)"/u.exec(card.text)?.[1] ?? '' };
    },
    args: (before) => ({
      kind: 'flow',
      flow_ids: [SKLEP_IDS.flowZakupy],
      confirm: before.handle ?? '',
    }),
  },
  // The modes of runs 2, 4 and 5: a flow by hand, a flow from a recording (REST and the HAR
  // channel), the documentation read for a protected environment, accounts created on one and a
  // test whose load the plugin clamps after the consent of the user.
  {
    tool: 'flows_generate_from_endpoints',
    label: 'by hand',
    stage: 'project',
    args: () => ({
      name: 'zakupy',
      description: 'Log in, search the shop, put an item in the cart and pay for it',
      endpoints: ['POST:/auth/login', 'GET:/products', 'POST:/cart/items', 'POST:/checkout'],
    }),
  },
  {
    tool: 'flows_generate_from_har',
    label: 'from a recording, one flow',
    stage: 'project',
    args: () => ({ har: 'captures/shop.har', split: false, name: 'sesja' }),
  },
  {
    tool: 'flows_generate_from_har',
    label: 'from a recording, split through the HAR channel',
    stage: 'project',
    capabilities: ['meta', 'api_token_sockets'],
    args: () => ({ har: 'captures/shop.har', split: true }),
  },
  {
    tool: 'project_import_docs',
    label: 'new documentation, a protected environment named',
    stage: 'flows',
    args: () => ({ openapi: 'loadcraft/openapi.json', environment: 'qa' }),
  },
  {
    tool: 'data_create_accounts',
    label: 'provision on a protected environment, confirmed',
    stage: 'scenario',
    capabilities: PROVISION_CAPABILITIES,
    args: () => ({
      scenario: 'checkout',
      environment: 'qa',
      slot: 'accounts',
      count: 2,
      confirm_protected: true,
    }),
  },
  {
    tool: 'run_start',
    label: 'clamped on a protected environment, confirmed',
    stage: 'data',
    script: SHORT_RUN,
    readsOnly: true,
    progress: true,
    args: () => ({
      scenario: 'checkout',
      environment: 'qa',
      profile: RAMP_2000,
      confirm_capped: true,
    }),
  },
  {
    tool: 'process_wait',
    label: 'a run in flight',
    stage: 'data',
    script: LONG_RUN,
    before: startedRun,
    single: true,
    args: (before) => ({ operation: before.handle ?? '', max_wait_s: 1 }),
  },
  {
    tool: 'process_cancel',
    label: 'a run in flight',
    stage: 'data',
    script: LONG_RUN,
    before: startedRun,
    args: (before) => ({ operation: before.handle ?? '' }),
  },
];

// ---- running a case ----------------------------------------------------------------------------

interface Started {
  readonly r: ToolRig;
  readonly proxy: TaintProxy;
  readonly drive: Drive;
}

export async function start(item: Case): Promise<Started> {
  const clock = createTestClock(NOW);
  let proxy: TaintProxy | undefined;
  // The server reads its configuration after the world is built, so the address is set from there.
  const env: NodeJS.ProcessEnv = { LOADCRAFT_LOCALE: 'en' };
  const r = await toolRig({
    tools: ALL_TOOLS,
    // Work a call leaves running (accounts created in batches) goes on in the process, as for real.
    processServices: true,
    clock,
    env,
    files: workspaceFiles(),
    ...(item.personSaysYes === true
      ? { elicit: () => ({ action: 'accept' as const, content: { confirm: true } }) }
      : {}),
    fake: { meta: { capabilities: item.capabilities ?? ['meta', 'provision_environment'] } },
    world: async (fake) => {
      if (item.script !== undefined) {
        // The scripted run owns the two run routes; the stored-record ones of the full set yield.
        scriptRuns(fake, clock, item.script);
        registerAllExceptTaken(fake);
      } else {
        registerAllRoutes(fake);
      }
      seedSklep(fake.store, { stage: item.stage });
      seedAutoDatasets(fake.store);
      scriptBuilderModel(fake, [
        { flow: 'przeglądanie', proportion: 60 },
        { flow: 'zakupy', proportion: 30 },
        { flow: 'konto', proportion: 10 },
      ]);
      planExecutionIds(fake, [PERF]);
      item.setup?.(fake);
      proxy = await taintProxy(fake, {
        ...(item.names === true ? { names: true } : {}),
        ...(item.readsOnly === true ? { methods: ['GET'] } : {}),
        ...(item.shapes === true ? { shapes: true } : {}),
      });
      env.LOADCRAFT_API_URL = `${proxy.url}/api/v1`;
    },
  });
  if (proxy === undefined) throw new Error('the world did not start the proxy');
  const drive: Drive = {
    r,
    once: (tool, args) => settleClock(r, r.call(tool, args), FAST),
    async call(tool, args) {
      const calls: RigCallResult[] = [];
      let last = await settleClock(r, r.call(tool, args), FAST);
      calls.push(last);
      for (let again = 0; again < MAX_CONTINUATIONS; again += 1) {
        if (last.isError || last.outcome?.status === 'done' || last.outcome === undefined) break;
        const handle = handleFromText(last.text);
        if (handle === undefined) break;
        last = await settleClock(r, r.call('process_wait', { operation: handle }), FAST);
        calls.push(last);
      }
      return calls;
    },
  };
  return { r, proxy, drive };
}

/** The full set of routes, without the ones a scripted run has already taken. */
/** The cases of the tools of the modules: `CANARY_CASES` of every `test/tools/<module>/canary.ts`. */
async function moduleCases(): Promise<Case[]> {
  const dir = resolve(import.meta.dirname, '..', 'tools');
  const modules = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  const files = modules
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'canary.ts')))
    .map((entry) => join(dir, entry.name, 'canary.ts'))
    .sort();
  const loaded = await Promise.all(
    files.map(async (file) => (await import(file)) as { CANARY_CASES?: readonly Case[] }),
  );
  return loaded.flatMap((module, at) => {
    if (module.CANARY_CASES === undefined) throw new Error(`${files[at] ?? ''}: no CANARY_CASES`);
    return module.CANARY_CASES.map((item) => ({ ...item, shapes: true }));
  });
}

export const CASES: readonly Case[] = [...OWN_CASES, ...(await moduleCases())];

function registerAllExceptTaken(fake: Fake): void {
  const original = fake.route.bind(fake) as (...args: unknown[]) => void;
  const holder = fake as { route: unknown };
  holder.route = (...args: unknown[]): void => {
    try {
      original(...args);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already registered')) throw error;
    }
  };
  try {
    registerAllRoutes(fake);
  } finally {
    holder.route = original;
  }
}

/** The steps before the call under test run on a healthy, untainted backend. */
export async function runBefore(item: Case, drive: Drive, proxy: TaintProxy): Promise<Before> {
  proxy.taint(false);
  try {
    return (await item.before?.(drive)) ?? {};
  } finally {
    proxy.taint(true);
  }
}

export async function callUnderTest(
  item: Case,
  drive: Drive,
  before: Before,
): Promise<RigCallResult[]> {
  const args = item.args(before);
  return item.single === true ? [await drive.once(item.tool, args)] : drive.call(item.tool, args);
}

export const CODE_LINE = /^\[[a-z][a-z0-9_]*\] \S/u;

export const TOOL_NAMES = new Set(ALL_TOOLS.map((tool) => tool.name));
