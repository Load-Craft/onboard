import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import {
  renderSelfCheckChain,
  renderSelfCheckHeader,
  type CheckRepairView,
  type CheckRunStepView,
  type CheckRunView,
  type ScenarioCheck,
} from '../src/render/views/selfCheckChain.js';
import { renderSelfCheck, type SelfCheckData } from '../src/render/views/selfCheck.js';
import { scenarioCheckSelf } from '../src/tools/scenarioCheckSelf.js';
import { buildSelfCheckView } from '../src/tools/selfCheckStateView.js';
import { State } from '../src/workspace/processState.js';
import { processWait } from '../src/tools/processWait.js';
import { goldenText, goldenUrl, SKLEP_IDS } from './golden/index.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import {
  checkRunDocument,
  failureDocument,
  registerSelfCheckRoutes,
  selfCheckDocument,
  type SelfCheckDocument,
  type StepSpec,
  type SelfCheckFake,
} from './fake-backend/routes/selfCheck.js';
import { seedTraces } from './fake-backend/routes/traces.js';
import type { Fake, JobStep } from './fake-backend/server.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  SKLEP_WORLD_IDS,
  type SklepEndpointRow,
  type SklepExecution,
  type SklepExecutionResult,
  type SklepScenario,
  type SklepStage,
} from './fake-backend/worlds/sklep.js';
import { waitFor } from './helpers/async.js';
import { createTestClock, settleClock } from './helpers/clock.js';
import { BACKEND_CANARY } from './helpers/canary.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const tPl = createTranslator('pl');
const tEn = createTranslator('en');

// ---- the renderer ---------------------------------------------------------------------------

function view(file: string): SelfCheckData {
  return JSON.parse(readFileSync(goldenUrl(file), 'utf8')) as SelfCheckData;
}

const GOLDEN_VIEWS = [
  ['run1', '09-scenario_check_self'],
  ['run2', '10-scenario_check_self-naprawa'],
] as const;

const ok = (name: string) => ({ name, ok: true, failedRequest: null });

function check(fields: Partial<ScenarioCheck>): ScenarioCheck {
  return {
    name: 'zakupy',
    status: 'passed',
    steps: [ok('logowanie'), ok('koszyk')],
    requests: 2,
    responseMs: 500,
    failure: null,
    notes: [],
    missingSlots: [],
    repairs: [],
    ...fields,
  };
}

/** Whitespace of wrapped lines collapsed, so a hint can be found in a view that wrapped it. */
const flat = (text: string): string => text.replace(/\s+/gu, ' ').trim();

const render = (scenario: ScenarioCheck, t = tPl): string[] =>
  renderSelfCheckChain({ scenarios: [scenario] }, t).split('\n');

describe('self-check chain view', () => {
  it.each(GOLDEN_VIEWS)('%s/%s: the pl view is the golden text', (run, name) => {
    const data = view(`${run}/${name}.view.json`);
    const golden = goldenText(run, name);
    // The registry adds the link line, so a golden text that ends with one is drawn without it.
    const link = golden.trimEnd().split('\n').at(-1) ?? '';
    const drawn = `${renderSelfCheckChain(data, tPl)}\n`;
    expect(link.startsWith('↗ ') ? `${drawn}${link}\n` : drawn).toBe(golden);
  });

  const HINTED = [
    [
      'failed',
      {
        steps: [ok('logowanie')],
        failure: { request: 'POST /x', message: 'HTTP 400', goalUrl: null },
      },
    ],
    ['goal_step_missing', {}],
    ['waiting_for_data', {}],
    ['target_unreachable', {}],
    ['not_admitted', { notes: ['no_default_environment'] }],
    ['skipped_protected_environment', {}],
  ] as const;

  it.each(HINTED)('%s names what to do next, in pl and en', (status, fields) => {
    for (const t of [tPl, tEn]) {
      const text = flat(render(check({ status, ...fields }), t).join('\n'));
      expect(text).toContain(flat(t(`selfCheck.next.${status}`)));
    }
  });

  it('a failed step says where each cause leads: login, a fixed header, anything else', () => {
    const text = flat(render(check({ status: 'failed' }), tEn).join('\n'));
    expect(text).toMatch(/401 or 403 is the login or the accounts/u);
    expect(text).toMatch(/400 that names a key or a header is a fixed header of the environment/u);
    expect(text).toMatch(/Do not run the test/u);
  });

  it.each([
    'passed',
    'passed_after_repair',
    'waiting_for_data',
    'interrupted',
    'disabled',
    'pending',
  ])('%s adds no hint', (status) => {
    const lines = render(check({ status }), tEn).join('\n');
    expect(lines).not.toContain('→ read the failing step');
    expect(lines).not.toMatch(/→ (the flow|the default|LoadCraft did not|nothing was)/u);
  });

  it('the tool view draws the same text as the chain renderer', () => {
    const data = view('run2/10-scenario_check_self-naprawa.view.json');
    expect(renderSelfCheck(data, tPl)).toBe(renderSelfCheckChain(data, tPl));
  });

  it('the header names the default environment, or none', () => {
    expect(renderSelfCheckHeader('perf', tPl)).toBe(
      'self-check · perf (domyślne) · 1 użytkownik · jedno przejście',
    );
    expect(renderSelfCheckHeader('perf', tEn)).toBe(
      'self-check · perf (default) · 1 user · one pass',
    );
    expect(renderSelfCheckHeader(null, tPl)).toBe('self-check · 1 użytkownik · jedno przejście');
  });

  it('aligns scenario names to the widest one', () => {
    const lines = renderSelfCheckChain(
      {
        scenarios: [check({ name: 'przeglądanie' }), check({ name: 'konto' })],
      },
      tPl,
    ).split('\n');
    expect(lines).toEqual([
      'przeglądanie  logowanie ✓ → koszyk ✓ · 2 żądania · 0,5 s',
      'konto         logowanie ✓ → koszyk ✓ · 2 żądania · 0,5 s',
    ]);
  });

  it('wraps a long chain at 77 columns, a continuation line starting with the arrow', () => {
    const steps = Array.from({ length: 14 }, (_, i) => ok(`krok numer ${String(i + 1)}`));
    const lines = render(check({ steps, requests: 14, responseMs: 4100 }));
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(77);
    for (const line of lines.slice(1, -1)) expect(line.trimStart().startsWith('→ ')).toBe(true);
    expect(lines.at(-1)).toBe('        14 żądań · 4,1 s');
  });

  it('keeps the totals on the last line of the chain when they fit', () => {
    expect(render(check({}))).toEqual(['zakupy  logowanie ✓ → koszyk ✓ · 2 żądania · 0,5 s']);
  });

  const STATES: readonly (readonly [string, Partial<ScenarioCheck>, readonly string[]])[] = [
    [
      'waiting_for_data names the slots',
      {
        status: 'waiting_for_data',
        steps: [],
        missingSlots: [
          { slot: 'accounts', label: 'User accounts' },
          { slot: 'search_phrases', label: 'Search terms' },
        ],
      },
      [
        'zakupy  czeka na dane: User accounts (slot: accounts), Search terms (slot:',
        '        search_phrases)',
      ],
    ],
    [
      'target_unreachable',
      {
        status: 'target_unreachable',
        steps: [],
        failure: { request: 'GET /categories', message: 'connection refused', goalUrl: null },
      },
      ['zakupy  cel nieosiągalny: connection refused'],
    ],
    [
      'not_admitted with a known code',
      { status: 'not_admitted', steps: [], notes: ['no_default_environment'] },
      ['zakupy  niedopuszczony do uruchomienia: projekt nie ma środowiska domyślnego'],
    ],
    [
      'not_admitted with an unknown code shows the code and the message',
      {
        status: 'not_admitted',
        steps: [],
        notes: ['dataset_short'],
        failure: { request: null, message: 'Not enough rows.', goalUrl: null },
      },
      ['zakupy  niedopuszczony do uruchomienia: dataset_short — Not enough rows.'],
    ],
    [
      'skipped_protected_environment',
      { status: 'skipped_protected_environment', steps: [] },
      ['zakupy  pominięty: środowisko domyślne jest chronione'],
    ],
    [
      'interrupted tells to run it again',
      { status: 'interrupted', steps: [] },
      ['zakupy  przerwany (restart LoadCraft) — ponów'],
    ],
    ['disabled', { status: 'disabled', steps: [] }, ['zakupy  wyłączony w profilu projektu']],
    [
      'goal_step_missing',
      {
        status: 'goal_step_missing',
        failure: { request: null, message: null, goalUrl: '/order/confirmed' },
      },
      [
        'zakupy  logowanie ✓ → koszyk ✓ · 2 żądania · 0,5 s',
        '        flow nie ma kroku kończącego podróż: /order/confirmed',
      ],
    ],
    [
      'failed shows the failing request and the message',
      {
        status: 'failed',
        steps: [ok('logowanie'), { name: 'koszyk', ok: false, failedRequest: 'POST /cart/items' }],
        failure: {
          request: 'POST /cart/items',
          message: 'HTTP 500 Internal Server Error',
          goalUrl: null,
        },
      },
      ['zakupy  logowanie ✓ → koszyk ✕ POST /cart/items', '        HTTP 500 Internal Server Error'],
    ],
    [
      'failed after repairs lists every round',
      {
        status: 'failed',
        steps: [ok('logowanie'), { name: 'koszyk', ok: false, failedRequest: 'POST /cart/items' }],
        failure: {
          request: 'POST /cart/items',
          message: 'HTTP 500 Internal Server Error',
          goalUrl: null,
        },
        repairs: [
          { changes: 'dodano nagłówek', refused: null, version: 2 },
          { changes: null, refused: 'osłabia test', version: null },
        ],
      },
      [
        'zakupy  logowanie ✓ → koszyk ✕ POST /cart/items',
        '        naprawa AI: dodano nagłówek · wersja 2',
        '        naprawa AI odrzucona: osłabia test',
        '        ✕ nie przeszedł po 2 naprawach: HTTP 500 Internal Server Error',
      ],
    ],
    [
      'a step named by its request shows the last segment of the path',
      {
        steps: [ok('POST /auth/login'), ok('GET /api/v2/products/search')],
        requests: 2,
      },
      ['zakupy  login ✓ → search ✓ · 2 żądania · 0,5 s'],
    ],
    [
      'a passing check without request data says so',
      { steps: [], requests: 0, responseMs: 0 },
      ['zakupy  ✓ przeszedł · łańcuch żądań niedostępny'],
    ],
    ['in the queue', { status: 'pending', steps: [] }, ['zakupy  w kolejce']],
    ['running', { status: 'running', steps: [] }, ['zakupy  sprawdzanie']],
    ['repairing', { status: 'repairing', steps: [] }, ['zakupy  naprawa AI w toku']],
    ['a state the plugin does not know', { status: 'weird', steps: [] }, ['zakupy  status: weird']],
  ];

  it.each(STATES)('%s', (_name, fields, expected) => {
    // A status that names no next move by itself is followed by a hint (see the next describe).
    expect(render(check(fields)).slice(0, expected.length)).toEqual(expected);
  });

  it('draws two repair rounds of a check that passed in the end', () => {
    const lines = render(
      check({
        status: 'passed_after_repair',
        steps: [ok('logowanie'), { name: 'koszyk', ok: false, failedRequest: 'POST /cart' }],
        repairs: [
          { changes: 'a', refused: null, version: 2 },
          { changes: 'b', refused: null, version: 3 },
        ],
      }),
    );
    expect(lines.at(-1)).toBe('        ✓ po 2 naprawach · 2 żądania · 0,5 s');
  });

  it('cuts a very long failure message', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        failure: { request: 'GET /x', message: 'x'.repeat(2000), goalUrl: null },
      }),
    );
    const body = lines.join('\n').split('→ przeczytaj')[0] ?? '';
    expect(body.length).toBeLessThan(400);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(77);
  });

  it('en: every part of the repair chain reads in English', async () => {
    const data = view('run2/10-scenario_check_self-naprawa.view.json');
    await expect(renderSelfCheckChain(data, tEn)).toMatchFileSnapshot(
      '__snapshots__/selfCheck.chain.en.txt',
    );
  });
});

// ---- the tool -------------------------------------------------------------------------------

const NOW = Date.parse('2026-11-22T10:22:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
const IDS = SKLEP_WORLD_IDS;
const SCENARIO_PATH = '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}';
const START_PATH = `${SCENARIO_PATH}/self-check`;

interface Rig extends ToolRig {
  readonly checks: SelfCheckFake;
}

async function rig(
  stage: SklepStage,
  options: { locale?: 'en' | 'pl'; setup?: (fake: Fake) => void } = {},
): Promise<Rig> {
  let checks: SelfCheckFake | undefined;
  const r = await toolRig({
    tools: [scenarioCheckSelf, processWait],
    world: (fake) => {
      registerLookupRoutes(fake);
      checks = registerSelfCheckRoutes(fake);
      seedSklep(fake.store, { stage });
      options.setup?.(fake);
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'pl' },
    files: BOUND,
  });
  if (checks === undefined) throw new Error('the world was not built');
  return Object.assign(r, { checks });
}

/** Lets the call wait on the test clock until it ends (see `settleClock`). */
const settle = <T>(r: ToolRig, call: Promise<T>, steps = 200): Promise<T> =>
  settleClock(r, call, { limitMs: steps * 1000 });

interface Called {
  readonly text: string;
  readonly isError: boolean;
  readonly outcome: { status: string; operation?: string; data: ToolData };
  readonly progress: readonly { message?: string; progress: number }[];
}

interface ToolData {
  readonly environment: string | null;
  readonly scenarios: readonly ScenarioCheck[];
}

async function run(
  r: ToolRig,
  args: Record<string, unknown> = { scenarios: ['zakupy', 'konto'] },
): Promise<Called> {
  const result = await settle(r, r.call('scenario_check_self', args));
  return result as unknown as Called;
}

/** The text without the link lines the registry adds. */
/** Handles of the operations the workspace state holds. */
function recordedOperations(r: ToolRig): string[] {
  const file = join(r.workspace, 'loadcraft', '.cache', 'state.json');
  if (!existsSync(file)) return [];
  const state = JSON.parse(readFileSync(file, 'utf8')) as { opPayloads?: Record<string, unknown> };
  return Object.keys(state.opPayloads ?? {});
}

const withoutLinks = (text: string): string =>
  `${text
    .split('\n')
    .filter((line) => !line.startsWith('↗ '))
    .join('\n')}\n`;

const step = <S>(afterMs: number, state: S): JobStep<S> => ({ afterMs, state });
const doc = selfCheckDocument;

/** A run with the given rows, copied from a self-check run of the world (`name`, count, ms). */
function seedRun(
  r: ToolRig,
  runId: string,
  rows: readonly (readonly [name: string, ok: number, ko: number, ms: number])[],
): void {
  const { store } = r.fake;
  const executions = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const results = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
  const template = results.require(IDS.selfCheckKonto);
  const row = template.endpoints[0];
  if (row === undefined) throw new Error('the world has no endpoint row to copy');
  const endpoints: SklepEndpointRow[] = rows.map(([name, okCount, koCount, ms]) => ({
    ...row,
    name,
    count: okCount + koCount,
    ok_count: okCount,
    ko_count: koCount,
    error_count: koCount,
    mean_response_time: ms,
  }));
  if (executions.get(runId) === undefined) {
    executions.insert({ ...executions.require(IDS.selfCheckKonto), id: runId });
    results.insert({ ...template, id: runId, endpoints });
  } else {
    results.update(runId, { endpoints });
  }
}

/** Rows of the self-check runs of the world, named as the mock-up names its steps. */
function nameSteps(r: ToolRig): void {
  seedRun(r, IDS.selfCheckZakupy, [
    ['logowanie', 1, 0, 200],
    ['wyszukanie', 1, 0, 300],
    ['koszyk', 1, 0, 300],
    ['zamówienie', 1, 0, 400],
  ]);
  seedRun(r, IDS.selfCheckKonto, [
    ['logowanie', 1, 0, 200],
    ['zamówienia', 1, 0, 200],
  ]);
}

const ZAKUPY_DONE = '2026-11-22T10:20:03Z';
const KONTO_DONE = '2026-11-22T10:21:02Z';

function passed(
  runId: string,
  finishedAt: string,
  steps: readonly StepSpec[] = [],
): SelfCheckDocument {
  return doc({
    status: 'passed',
    execution_ids: [runId],
    runs: steps.length === 0 ? [] : [checkRunDocument(runId, 1, 'passed', steps)],
    started_at: '2026-11-22T10:19:55Z',
    finished_at: finishedAt,
  });
}

function planTwoPasses(r: Rig): void {
  r.checks.plan(IDS.scenarios.zakupy, [
    step(0, doc({})),
    step(2000, doc({ status: 'running', execution_ids: [IDS.selfCheckZakupy] })),
    step(5000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
  ]);
  r.checks.plan(IDS.scenarios.konto, [
    step(0, doc({})),
    step(4000, doc({ status: 'running', execution_ids: [IDS.selfCheckKonto] })),
    step(9000, passed(IDS.selfCheckKonto, KONTO_DONE)),
  ]);
}

describe('scenario_check_self', () => {
  it('re-checks two scenarios that end at different times and draws the golden chain', async () => {
    const r = await rig('data');
    nameSteps(r);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(2000, doc({ status: 'running', execution_ids: [IDS.selfCheckZakupy] })),
      step(5000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    r.checks.plan(IDS.scenarios.konto, [
      step(0, doc({})),
      step(4000, doc({ status: 'running', execution_ids: [IDS.selfCheckKonto] })),
      step(9000, passed(IDS.selfCheckKonto, KONTO_DONE)),
    ]);
    const result = await run(r);
    expect(result.isError, result.text).toBe(false);
    expect(result.outcome.status).toBe('done');
    expect(`${result.text}\n`).toBe(goldenText('run1', '09-scenario_check_self'));
    // The link goes to the Requests tab of the run that ended last.
    expect(result.text.split('\n').at(-1)).toBe(
      `↗ https://app.loadcraft.io/projects/${SKLEP_IDS.project}/gatling/executions/${IDS.selfCheckKonto}?tab=Requests`,
    );
    // Both checks were started, one POST each, and the first one ended before the second.
    const started = r.fake.calls.filter((call) => call.method === 'POST');
    expect(started.map((call) => call.path.split('/').at(-2)).sort()).toEqual(
      [IDS.scenarios.konto, IDS.scenarios.zakupy].sort(),
    );
    const messages = result.progress.map((entry) => entry.message ?? '');
    expect(messages.some((message) => message.includes('0/2'))).toBe(true);
    expect(messages.some((message) => message.includes('1/2'))).toBe(true);
    expect(messages.some((message) => message.includes('konto: sprawdzanie'))).toBe(true);
    expect(messages[0]).toContain('self-check · perf (domyślne) · 1 użytkownik · jedno przejście');
    // The operation is gone from the workspace state once it has ended.
    expect(recordedOperations(r)).toEqual([]);
    r.assertClean();
  });

  it('draws the AI repair of run 2: the failing first pass, the repair, the passing run', async () => {
    const r = await rig('data');
    nameSteps(r);
    const first = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';
    seedRun(r, first, [
      ['logowanie', 1, 0, 200],
      ['wyszukanie', 1, 0, 300],
      ['koszyk', 1, 0, 300],
      ['podgląd koszyka', 1, 0, 200],
      ['zamówienie', 0, 1, 400],
    ]);
    seedRun(r, IDS.selfCheckZakupy, [
      ['logowanie', 1, 0, 200],
      ['wyszukanie', 1, 0, 300],
      ['koszyk', 1, 0, 300],
      ['podgląd koszyka', 1, 0, 200],
      ['zamówienie', 1, 0, 400],
    ]);
    const failure = failureDocument('POST /checkout', 'HTTP 403 Forbidden', null, 403);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(2000, doc({ status: 'running', execution_ids: [first] })),
      step(4000, doc({ status: 'repairing', execution_ids: [first], failure })),
      step(
        7000,
        doc({
          status: 'passed_after_repair',
          scenario_version: 2,
          execution_ids: [first, IDS.selfCheckZakupy],
          runs: [
            checkRunDocument(first, 1, 'failed', [
              ['logowanie', 'ok'],
              ['wyszukanie', 'ok'],
              ['koszyk', 'ok'],
              ['podgląd koszyka', 'ok'],
              ['zamówienie', 'failed', 403, 'HTTP 403 Forbidden'],
            ]),
            checkRunDocument(IDS.selfCheckZakupy, 2, 'passed', [
              ['logowanie', 'ok'],
              ['wyszukanie', 'ok'],
              ['koszyk', 'ok'],
              ['podgląd koszyka', 'ok'],
              ['zamówienie', 'ok'],
            ]),
          ],
          repairs: [
            {
              round: 1,
              failure,
              changes_summary: 'dodano nagłówek X-CSRF-Token',
              refused_reason: null,
              refused_code: null,
              refused_message: null,
              scenario_version_after: 2,
              verdict: 'passed',
              recording_available: true,
            },
          ],
          started_at: '2026-11-22T10:19:55Z',
          finished_at: ZAKUPY_DONE,
        }),
      ),
    ]);
    // The second scenario's runs are listed with the names the mock-up gives its steps.
    r.checks.set(
      IDS.scenarios.konto,
      passed(IDS.selfCheckKonto, KONTO_DONE, [
        ['logowanie', 'ok'],
        ['zamówienia', 'ok'],
      ]),
    );
    const result = await run(r);
    expect(result.isError, result.text).toBe(false);
    expect(withoutLinks(result.text)).toBe(goldenText('run2', '10-scenario_check_self-naprawa'));
    expect(
      result.progress.some((entry) => (entry.message ?? '').includes('zakupy: naprawa AI')),
    ).toBe(true);
  });

  it('a check that waits for data is a result, not an error', async () => {
    const r = await rig('scenario');
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(false);
    expect(result.outcome.status).toBe('done');
    const text = withoutLinks(result.text);
    expect(
      text.startsWith(
        'zakupy  czeka na dane: User accounts (slot: accounts)\n        → odczytaj data_check_readiness',
      ),
    ).toBe(true);
    expect(flat(text)).toContain(flat(tPl('selfCheck.next.waiting_for_data')));
    expect(result.outcome.data.scenarios[0]?.missingSlots).toEqual([
      { slot: 'accounts', label: 'User accounts' },
    ]);
  });

  it('shows the interrupted check with the way on', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({ status: 'interrupted', failure: failureDocument('', 'the backend restarted') }),
      ),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(false);
    expect(withoutLinks(result.text)).toBe('zakupy  przerwany (restart LoadCraft) — ponów\n');
  });

  const ENDINGS: readonly (readonly [string, SelfCheckDocument, string])[] = [
    [
      'target_unreachable',
      doc({
        status: 'target_unreachable',
        failure: failureDocument('GET /products', 'dns failure'),
      }),
      'zakupy  cel nieosiągalny: dns failure',
    ],
    [
      'not_admitted',
      doc({ status: 'not_admitted', notes: ['protected_environment_requires_caps'] }),
      'zakupy  niedopuszczony do uruchomienia: środowisko domyślne jest chronione i\n        nie ma limitów obciążenia',
    ],
    [
      'skipped_protected_environment',
      doc({ status: 'skipped_protected_environment' }),
      'zakupy  pominięty: środowisko domyślne jest chronione',
    ],
    ['disabled', doc({ status: 'disabled' }), 'zakupy  wyłączony w profilu projektu'],
  ];

  it.each(ENDINGS)('shows %s as a sentence of its own', async (_name, document, expected) => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [step(0, doc({})), step(3000, document)]);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(false);
    const text = withoutLinks(result.text);
    expect(text.startsWith(`${expected}\n`)).toBe(true);
    // The one ending that is not a problem to act on has no hint; the others tell what to do.
    if (_name === 'disabled') expect(text).toBe(`${expected}\n`);
    else expect(flat(text)).toContain(flat(tPl(`selfCheck.next.${_name}`)));
  });

  it('shows a failing check: the chain up to the failing request and its message', async () => {
    const r = await rig('data');
    seedRun(r, IDS.selfCheckZakupy, [
      ['logowanie', 1, 0, 200],
      ['POST /cart/items', 0, 1, 300],
    ]);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'failed',
          execution_ids: [IDS.selfCheckZakupy],
          failure: failureDocument('POST /cart/items', 'HTTP 500 Internal Server Error'),
        }),
      ),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    const text = withoutLinks(result.text);
    expect(
      text.startsWith(
        [
          'zakupy  logowanie ✓ → items ✕ POST /cart/items',
          '        HTTP 500 Internal Server Error',
          '        → ',
        ].join('\n'),
      ),
    ).toBe(true);
    expect(flat(text)).toContain(flat(tPl('selfCheck.next.failed')));
  });

  it('counts every request of a row and weighs the mean time by its count', async () => {
    const r = await rig('data');
    seedRun(r, IDS.selfCheckZakupy, [
      ['POST /auth/login', 1, 0, 200],
      ['GET /products', 3, 0, 100],
    ]);
    // A check stored before the backend listed its runs: the chain comes from the metrics rows.
    r.checks.set(IDS.scenarios.zakupy, passed(IDS.selfCheckZakupy, ZAKUPY_DONE));
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(withoutLinks(result.text)).toBe('zakupy  login ✓ → products ✓ · 4 żądania · 0,5 s\n');
  });

  it('shows a check whose request data expired without failing', async () => {
    const r = await rig('data');
    r.fake.store.collection(SKLEP_COLLECTIONS.results).delete(IDS.selfCheckZakupy);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    // The steps come from the check itself, so only the totals are missing.
    expect(withoutLinks(result.text)).toBe(
      'zakupy  logowanie ✓ → wyszukanie ✓ → koszyk ✓ → zamówienie ✓\n',
    );
  });

  it('shows a check stored before runs, whose request data expired, without the chain', async () => {
    const r = await rig('data');
    r.fake.store.collection(SKLEP_COLLECTIONS.results).delete(IDS.selfCheckZakupy);
    r.checks.set(IDS.scenarios.zakupy, passed(IDS.selfCheckZakupy, ZAKUPY_DONE));
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    expect(withoutLinks(result.text)).toBe('zakupy  ✓ przeszedł · łańcuch żądań niedostępny\n');
  });

  it('joins a check that is already running: the 409 of the start is not an error', async () => {
    const r = await rig('data');
    nameSteps(r);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(6000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    const started = await fetch(
      `${r.fake.url}/api/v1/projects/${SKLEP_IDS.project}/gatling/scenarios/${IDS.scenarios.zakupy}/self-check`,
      { method: 'POST', headers: { authorization: `Bearer ${CANARY}` } },
    );
    expect(started.status).toBe(202);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    expect(withoutLinks(result.text)).toContain('zakupy  logowanie ✓ → wyszukanie ✓');
    const posts = r.fake.calls.filter((call) => call.method === 'POST');
    // The direct start and the tool's own, refused with 409 and joined.
    expect(posts).toHaveLength(2);
  });

  it('answers with a handle when the check outlasts the wait, and keeps the operation in the state', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(1_000_000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(false);
    expect(result.outcome.status).toBe('running');
    expect(result.outcome.operation).toMatch(/^self_check:[A-Za-z0-9._-]+$/);
    expect(result.text).toContain(result.outcome.operation ?? '');
    expect(recordedOperations(r)).toEqual([result.outcome.operation]);
  });

  it('wait continues a check from an earlier call and draws the chain the tool draws', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(2000, doc({ status: 'running', execution_ids: [IDS.selfCheckZakupy] })),
      step(130_000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    const first = await run(r, { scenarios: ['zakupy'] });
    expect(first.outcome.status).toBe('running');
    const handle = first.outcome.operation ?? '';
    const done = await settle(r, r.call('process_wait', { operation: handle }));
    expect(done.isError, done.text).toBe(false);
    expect((done.outcome as { status: string }).status).toBe('done');
    expect(done.text).toContain('zakupy');
    expect(done.text).toContain('✓');
    expect(recordedOperations(r)).toEqual([]);
  });

  it('the same scenarios checked again while the check runs join it: the same handle, one start', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(1_000_000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    const first = await run(r, { scenarios: ['zakupy'] });
    expect(first.outcome.status).toBe('running');
    const again = await run(r, { scenarios: ['zakupy'] });
    expect(again.outcome.status).toBe('running');
    expect(again.outcome.operation).toBe(first.outcome.operation);
    expect(again.text).toContain(first.outcome.operation ?? 'no handle');
    expect(recordedOperations(r)).toEqual([first.outcome.operation]);
    expect(r.fake.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('another set of scenarios is other work: a new handle, its own start, the first one untouched', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(1_000_000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    const first = await run(r, { scenarios: ['zakupy'] });
    expect(first.outcome.status).toBe('running');
    const wider = await run(r, { scenarios: ['zakupy', 'konto'] });
    expect(wider.outcome.operation).not.toBe(first.outcome.operation);
    expect(recordedOperations(r)).toHaveLength(2);
    expect(
      r.fake.calls.filter(
        (call) => call.method === 'POST' && call.path.includes(IDS.scenarios.konto),
      ),
    ).toHaveLength(1);
    const same = await run(r, { scenarios: ['zakupy'] });
    expect(same.outcome.operation).toBe(first.outcome.operation);
  });

  it('another set of the same size is other work too: a new handle, the first one untouched', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(1_000_000, passed(IDS.selfCheckZakupy, ZAKUPY_DONE)),
    ]);
    r.checks.plan(IDS.scenarios.konto, [
      step(0, doc({})),
      step(1_000_000, passed(IDS.selfCheckKonto, KONTO_DONE)),
    ]);
    const first = await run(r, { scenarios: ['zakupy'] });
    const other = await run(r, { scenarios: ['konto'] });
    expect(other.outcome.operation).not.toBe(first.outcome.operation);
    expect(recordedOperations(r)).toHaveLength(2);
    const same = await run(r, { scenarios: ['zakupy'] });
    expect(same.outcome.operation).toBe(first.outcome.operation);
  });

  it('keeps the artifact, its code and the canary out of the result and the state', async () => {
    const r = await rig('data');
    nameSteps(r);
    const scenarios = r.fake.store.collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios);
    for (const scenario of scenarios.list()) {
      scenarios.update(scenario.id, {
        scenario_artifact: Object.assign({}, scenario.scenario_artifact, {
          files: { 'Simulation.scala': `// SIMULATION_BODY ${CANARY} ${'x'.repeat(300_000)}` },
        }),
      });
    }
    const result = await run(r);
    expect(result.isError, result.text).toBe(false);
    const everything = JSON.stringify(result);
    for (const leak of [
      'scenario_artifact',
      'SIMULATION_BODY',
      'simulation_class_name',
      'feeder_slots',
      'ZakupySimulation',
      CANARY,
    ]) {
      expect(everything, leak).not.toContain(leak);
    }
    r.assertClean();
  });

  it('does not take a refusal to start for a running check: no old result is shown as new', async () => {
    const r = await rig('data', { locale: 'en' });
    r.checks.requireRebuild(IDS.scenarios.zakupy);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no modular build');
    expect(result.text).toContain('→ Regenerate the scenario with scenario_generate');
    expect(
      r.fake.calls.filter(
        (call) => call.method === 'GET' && call.path.endsWith(IDS.scenarios.zakupy),
      ),
    ).toEqual([]);
  });

  it('passes on a 409 that is not "already running" as the backend names it', async () => {
    const r = await rig('data', { locale: 'en' });
    r.fake.faults.next('POST', START_PATH, {
      status: 409,
      body: { detail: 'Scenario is locked.' },
    });
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Scenario is locked.');
  });

  it('reads the state of the checks every 3 seconds', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [step(0, doc({})), step(1_000_000, doc({}))]);
    const reads = (): number =>
      r.fake.calls.filter(
        (call) => call.method === 'GET' && call.path.endsWith(IDS.scenarios.zakupy),
      ).length;
    const call = r.call('scenario_check_self', { scenarios: ['zakupy'] });
    await waitFor(() => reads() === 1, 'the first read');
    await r.clock.advance(2999);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(reads()).toBe(1);
    await r.clock.advance(1);
    await waitFor(() => reads() === 2, 'the second read');
    await settle(r, call);
  });

  it('a failing read of the request rows of a run does not fail the result of the check', async () => {
    const r = await rig('data');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      r.fake.faults.next(
        'GET',
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
        { status: 500, body: { detail: 'boom' } },
      );
    }
    const result = await run(r, { scenarios: ['przeglądanie'] });
    expect(result.isError, result.text).toBe(false);
    expect(withoutLinks(result.text)).toBe('przeglądanie  kategorie ✓ → produkt ✓\n');
  });

  it('shows the result without the chain when the metrics store does not answer', async () => {
    const r = await rig('data');
    // The client retries a read that fails with 503; the store stays down for every attempt.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      r.fake.faults.next(
        'GET',
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
        {
          status: 503,
          body: { detail: 'Prometheus unreachable' },
        },
      );
    }
    const result = await run(r, { scenarios: ['przeglądanie'] });
    expect(result.isError, result.text).toBe(false);
    expect(withoutLinks(result.text)).toBe('przeglądanie  kategorie ✓ → produkt ✓\n');
  });

  it('a check stored before runs has only the metrics for its chain, and says so without them', async () => {
    const older = await rig('data');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      older.fake.faults.next(
        'GET',
        '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
        { status: 503, body: { detail: 'Prometheus unreachable' } },
      );
    }
    older.checks.set(IDS.scenarios.przegladanie, passed(IDS.selfCheckExecution, ZAKUPY_DONE));
    const oldResult = await run(older, { scenarios: ['przeglądanie'] });
    expect(withoutLinks(oldResult.text)).toBe(
      'przeglądanie  ✓ przeszedł · łańcuch żądań niedostępny\n',
    );
  });

  it('refuses a scenario the project does not have, naming the ones it has', async () => {
    const r = await rig('data');
    const result = await run(r, { scenarios: ['zakupy', 'nie-ma'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('nie-ma');
    expect(result.text).toContain('→');
    // Nothing was started before every name was resolved.
    expect(r.fake.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('starts one check for a scenario named twice', async () => {
    const r = await rig('data');
    await run(r, { scenarios: ['zakupy', 'zakupy'] });
    expect(r.fake.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('gives a named backend error a message with a way on', async () => {
    const r = await rig('data', { locale: 'en' });
    r.fake.faults.next('POST', START_PATH, { status: 403, body: { detail: 'Forbidden' } });
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft refused this action');
    expect(result.text).toContain('→ Tell the user');
  });

  it('turns 401 into the invalid-token error', async () => {
    const r = await rig('data', { locale: 'en' });
    r.fake.faults.next('GET', SCENARIO_PATH, { status: 401, body: { detail: 'Invalid token' } });
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
  });

  it('refuses a backend without /meta as too old, before anything is started', async () => {
    const r = await rig('data', { locale: 'en' });
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
    expect(r.fake.calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('refuses a backend that reports a revision that is too old', async () => {
    const r = await toolRig({
      tools: [scenarioCheckSelf],
      world: (fake) => {
        registerLookupRoutes(fake);
        registerSelfCheckRoutes(fake);
        seedSklep(fake.store, { stage: 'data' });
      },
      fake: { meta: { api_revision: 0 } },
      clock: createTestClock(NOW),
      env: { LOADCRAFT_LOCALE: 'en' },
      files: BOUND,
    });
    const result = await r.call('scenario_check_self', { scenarios: ['zakupy'] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('API revision 0');
  });

  it('validates the input: one to twenty scenarios', async () => {
    const r = await rig('data');
    for (const scenarios of [[], Array.from({ length: 21 }, (_, i) => `s${String(i)}`)]) {
      const result = await r.call('scenario_check_self', { scenarios });
      expect(result.isError).toBe(true);
    }
  });

  it('says in its description that it sends real requests to the default environment', async () => {
    const r = await rig('data');
    const [listed] = (await r.session.listTools()).filter(
      (tool) => tool.name === 'scenario_check_self',
    );
    expect(listed?.description).toMatch(/default environment/i);
    expect(listed?.description).toMatch(/real requests/i);
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('two passing checks (%s)', async (locale) => {
      const r = await rig('data', { locale });
      nameSteps(r);
      planTwoPasses(r);
      const result = await run(r);
      await expect(withoutLinks(result.text)).toMatchFileSnapshot(
        `__snapshots__/selfCheck.passed.${locale}.txt`,
      );
    });

    it.each(['en', 'pl'] as const)('a check that waits for data (%s)', async (locale) => {
      const r = await rig('scenario', { locale });
      const result = await run(r, { scenarios: ['zakupy', 'przeglądanie'] });
      await expect(withoutLinks(result.text)).toMatchFileSnapshot(
        `__snapshots__/selfCheck.waiting.${locale}.txt`,
      );
    });
  });
});

// ---- every attempt of a failed check --------------------------------------------------------

describe('a check that failed after AI repairs shows what every attempt got back', () => {
  const RUN_2 = '5d1e8a40-2c7b-4f93-b6e1-0a9d3c7f5e21';
  const RUN_3 = '8b4f2c19-7e3a-4d65-9c10-f2e6a8d0b347';
  const short = (id: string): string => `e-${id.slice(0, 8)}`;

  function repair(
    round: number,
    failure: ReturnType<typeof failureDocument>,
    changes: string,
    version: number,
  ): SelfCheckDocument['repairs'][number] {
    return {
      round,
      failure,
      changes_summary: changes,
      refused_reason: null,
      refused_code: null,
      refused_message: null,
      scenario_version_after: version,
      verdict: 'failed',
      recording_available: false,
    };
  }

  function seedAttempts(r: Rig): void {
    seedRun(r, IDS.selfCheckZakupy, [
      ['logowanie', 1, 0, 200],
      ['POST /checkout', 0, 1, 300],
    ]);
    const failedAt = (n: number): string => `2026-11-22T10:2${String(n)}:00Z`;
    seedTraces(r.fake, IDS.selfCheckZakupy, [
      {
        traceId: 'a1000000000000000000000000000001',
        request: 'POST /checkout',
        method: 'POST',
        url: 'https://api.perf.example.com/checkout',
        status: 400,
        startTime: failedAt(1),
        responseBody: '{"error":"missing csrf token"}',
        error: 'status.find.is(200), found 400',
      },
    ]);
    seedTraces(r.fake, RUN_2, [
      {
        traceId: 'a2000000000000000000000000000002',
        request: 'POST /checkout',
        method: 'POST',
        url: 'https://api.perf.example.com/checkout',
        status: 400,
        startTime: failedAt(2),
        requestBody: JSON.stringify({ password: BACKEND_CANARY }),
        responseBody: JSON.stringify({ error: 'csrf token expired', token: BACKEND_CANARY }),
        error: 'status.find.is(200), found 400',
      },
    ]);
    seedTraces(r.fake, RUN_3, [
      {
        traceId: 'a3000000000000000000000000000003',
        request: 'POST /payment',
        method: 'POST',
        url: 'https://api.perf.example.com/payment',
        status: 402,
        startTime: failedAt(3),
        responseBody: '{"error":"card declined"}',
        error: 'status.find.is(200), found 402',
      },
    ]);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'failed',
          scenario_version: 3,
          execution_ids: [IDS.selfCheckZakupy, RUN_2, RUN_3],
          failure: failureDocument('POST /payment', 'status.find.is(200), found 402'),
          repairs: [
            repair(
              1,
              failureDocument('POST /checkout', 'status.find.is(200), found 400'),
              'dodano nagłówek X-CSRF-Token',
              2,
            ),
            repair(
              2,
              failureDocument('POST /checkout', 'status.find.is(200), found 400'),
              'token CSRF czytany z odpowiedzi logowania',
              3,
            ),
          ],
        }),
      ),
    ]);
  }

  it('two repairs: three attempts, each with its step, status and response, the repairs between', async () => {
    const r = await rig('data');
    seedAttempts(r);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    const lines = withoutLinks(result.text).split('\n');
    const at = (start: string): number => lines.findIndex((line) => line.startsWith(start));
    const attempt1 = at(`        próba 1 · ${short(IDS.selfCheckZakupy)}: POST /checkout ✕`);
    const repair1 = at('        naprawa AI: dodano nagłówek X-CSRF-Token · wersja 2');
    const attempt2 = at(`        próba 2 · wersja 2 · ${short(RUN_2)}: POST /checkout ✕`);
    const repair2 = at('        naprawa AI: token CSRF czytany z odpowiedzi logowania · wersja 3');
    const attempt3 = at(`        próba 3 · wersja 3 · ${short(RUN_3)}: POST /payment ✕`);
    const end = at('        ✕ nie przeszedł po 2 naprawach');
    const order = [attempt1, repair1, attempt2, repair2, attempt3, end];
    expect(
      order.every((index) => index > 0),
      lines.join('\n'),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Each attempt: its message, then its answer one step further in, before the next repair.
    const block = (from: number, to: number): string[] => lines.slice(from, to);
    expect(flat(block(attempt1, repair1).join(' '))).toContain('status.find.is(200), found 400');
    expect(block(attempt1, repair1)).toContain(
      '          odpowiedź 400 celu (dane): „{"error":"missing csrf token"}”',
    );
    expect(flat(block(attempt2, repair2).join(' '))).toContain(
      'odpowiedź 400 celu (dane): „{"error":"csrf token expired","token":"[redacted]"}”',
    );
    expect(flat(block(attempt3, end).join(' '))).toContain('status.find.is(200), found 402');
    expect(block(attempt3, end)).toContain(
      '          odpowiedź 402 celu (dane): „{"error":"card declined"}”',
    );
    expect(flat(result.text)).toContain(`(ostatniej: "${short(RUN_3)}")`);
    expect(result.text).not.toContain(BACKEND_CANARY);
    const [check] = result.outcome.data.scenarios;
    expect(check?.attempts?.map((attempt) => attempt.run)).toEqual([
      short(IDS.selfCheckZakupy),
      short(RUN_2),
      short(RUN_3),
    ]);
  });

  it('the answer of an attempt in XML hides a key under a neutral name', async () => {
    const key = ['sk', 'live', 'TESTONLY8Hq2Wn5Kd7Lp3Rv9'].join('_');
    const r = await rig('data');
    seedRun(r, IDS.selfCheckZakupy, [['POST /orders', 0, 1, 300]]);
    seedTraces(r.fake, IDS.selfCheckZakupy, [
      {
        traceId: 'c1000000000000000000000000000001',
        request: 'POST /orders',
        method: 'POST',
        url: 'https://api.perf.example.com/orders',
        status: 400,
        responseHeaders: 'Content-Type: application/xml',
        responseBody: `<Fault><Code>400</Code><Detail>retry with ${key} for the order</Detail></Fault>`,
        error: 'status.find.is(200), found 400',
      },
    ]);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'failed',
          execution_ids: [IDS.selfCheckZakupy],
          failure: failureDocument('POST /orders', 'status.find.is(200), found 400'),
        }),
      ),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    expect(flat(result.text)).toContain('odpowiedź 400 celu (dane): „<Fault><Code>400</Code>');
    expect(result.text).not.toContain(key);
    expect(JSON.stringify(result.outcome)).not.toContain(key);
  });

  it('one failed run without repairs: the response under the message and the run to read', async () => {
    const r = await rig('data');
    seedRun(r, IDS.selfCheckZakupy, [
      ['logowanie', 1, 0, 200],
      ['POST /cart/items', 0, 1, 300],
    ]);
    seedTraces(r.fake, IDS.selfCheckZakupy, [
      {
        traceId: 'b1000000000000000000000000000001',
        request: 'POST /cart/items',
        method: 'POST',
        url: 'https://api.perf.example.com/cart/items',
        status: 500,
        responseBody: '{"error":"internal"}',
        error: 'status.find.is(200), found 500',
      },
    ]);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'failed',
          execution_ids: [IDS.selfCheckZakupy],
          failure: failureDocument('POST /cart/items', 'status.find.is(200), found 500'),
        }),
      ),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    const lines = withoutLinks(result.text).split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'zakupy  logowanie ✓ → items ✕ POST /cart/items',
      '        status.find.is(200), found 500',
      '          odpowiedź 500 celu (dane): „{"error":"internal"}”',
    ]);
    expect(flat(result.text)).toContain(
      `pełne nieudane żądanie: results_get_traces z execution "${short(IDS.selfCheckZakupy)}"`,
    );
  });
});

// ---- the runs of a check -----------------------------------------------------------------------

const runStep = (
  name: string,
  result: CheckRunStepView['result'] = 'ok',
  fields: Partial<CheckRunStepView> = {},
): CheckRunStepView => ({
  name,
  isPreflight: false,
  result,
  httpStatus: result === 'ok' ? 200 : null,
  reason: null,
  ...fields,
});

const runOf = (
  steps: readonly CheckRunStepView[],
  fields: Partial<CheckRunView> = {},
): CheckRunView => ({ version: 1, status: 'failed', stepsOmitted: 0, steps, ...fields });

const repairOf = (fields: Partial<CheckRepairView> = {}): CheckRepairView => ({
  changes: 'added a header',
  refused: null,
  version: 2,
  ...fields,
});

describe('self-check runs', () => {
  it('a failed run names the step that failed with its status, and the plan steps it never sent', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        runs: [
          runOf([
            runStep('login'),
            runStep('pay', 'failed', { httpStatus: 422, reason: 'card declined' }),
            runStep('confirm', 'not_run'),
          ]),
        ],
        failure: { request: 'pay', message: 'card declined', goalUrl: null },
      }),
      tEn,
    );
    expect(lines.slice(0, 3)).toEqual([
      'zakupy  login ✓ → pay ✕ 422 → confirm ○',
      '        ✕ pay 422: card declined',
      expect.stringMatching(/^ {8}→ /u),
    ]);
    // The failure message says what the step line did: it is not drawn a second time.
    expect(lines.join('\n').match(/card declined/gu)).toHaveLength(1);
    // One run has no attempt header.
    expect(lines.join('\n')).not.toMatch(/attempt/u);
  });

  it('every attempt of a repaired check is drawn, the repair between the run that failed and the next one', () => {
    const lines = render(
      check({
        status: 'passed_after_repair',
        steps: [],
        runs: [
          runOf([
            runStep('login'),
            runStep('pay', 'failed', { httpStatus: 403, reason: 'denied' }),
          ]),
          runOf([runStep('login'), runStep('pay')], { version: 2, status: 'passed' }),
        ],
        repairs: [repairOf()],
      }),
      tEn,
    );
    expect(lines).toEqual([
      'zakupy  attempt 1 · version 1 ✕',
      '        login ✓ → pay ✕ 403',
      '        ✕ pay 403: denied',
      '        AI repair: added a header · version 2',
      '        attempt 2 · version 2 ✓',
      '        login ✓ → pay ✓',
      '        ✓ after 1 repair · 2 requests · 0.5 s',
    ]);
  });

  it('a refused round stays before the next round, and a run follows only a round that wrote a version', () => {
    const failing = (version: number): CheckRunView =>
      runOf([runStep('pay', 'failed', { httpStatus: 403, reason: 'denied' })], { version });
    const lines = render(
      check({
        status: 'passed_after_repair',
        steps: [],
        runs: [failing(1), failing(2), runOf([runStep('pay')], { version: 3, status: 'passed' })],
        repairs: [
          repairOf({ changes: null, version: null, refusedMessage: 'Refused.' }),
          repairOf({ changes: 'second', version: 2 }),
          repairOf({ changes: 'third', version: 3 }),
        ],
      }),
      tEn,
    )
      .map((line) => line.replace(/^zakupy/u, '').trim())
      .filter((line) => /^(attempt|AI repair)/u.test(line));
    expect(lines).toEqual([
      'attempt 1 · version 1 ✕',
      'AI repair refused: Refused.',
      'AI repair: second · version 2',
      'attempt 2 · version 2 ✕',
      'AI repair: third · version 3',
      'attempt 3 · version 3 ✓',
    ]);
  });

  it('a refused round reads the sentence for a person, never the code or the raw text', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        runs: [runOf([runStep('login'), runStep('pay', 'failed', { reason: 'denied' })])],
        failure: { request: 'pay', message: 'denied', goalUrl: null },
        repairs: [
          repairOf({
            changes: null,
            version: null,
            refused: 'ValidationError: field x at line 3',
            refusedMessage: 'The change would make the test check less.',
            refusedCode: 'weakens_test',
          }),
        ],
      }),
      tEn,
    ).join('\n');
    expect(lines).toContain('AI repair refused: The change would make the test check less.');
    expect(lines).not.toContain('weakens_test');
    expect(lines).not.toContain('ValidationError');
  });

  it('a refused round of a state stored before codes falls back to the model words', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        runs: [runOf([runStep('pay', 'failed', { reason: 'denied' })])],
        repairs: [repairOf({ changes: null, version: null, refused: 'not allowed' })],
      }),
      tEn,
    ).join('\n');
    expect(lines).toContain('AI repair refused: not allowed');
  });

  it('says how many steps the backend left out of a run', () => {
    const lines = render(
      check({
        steps: [],
        runs: [runOf([runStep('login')], { status: 'passed', stepsOmitted: 12 })],
      }),
      tEn,
    );
    expect(lines[0]).toBe('zakupy  login ✓');
    expect(lines[1]).toMatch(/^ {8}… 12 steps not listed/u);
  });

  it('hides a preflight that passed and shows one that failed', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        runs: [
          runOf([
            runStep('Preflight OPTIONS /cart', 'ok', { isPreflight: true }),
            runStep('cart'),
            runStep('Preflight OPTIONS /pay', 'failed', { isPreflight: true, httpStatus: 403 }),
          ]),
        ],
      }),
      tEn,
    );
    expect(lines[0]).toBe('zakupy  cart ✓ → Preflight OPTIONS /pay ✕ 403');
  });

  it('shows the first attempt and the last three when there are more than four', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((n) =>
      runOf([runStep(`step-${String(n)}`)], { version: n, status: n === 6 ? 'passed' : 'failed' }),
    );
    const text = render(check({ status: 'passed_after_repair', steps: [], runs }), tEn).join('\n');
    expect(text).toContain('attempt 1 · version 1 ✕');
    expect(text).toContain('… 2 attempts not shown');
    expect(text).not.toContain('step-2');
    expect(text).not.toContain('step-3');
    expect(text).toContain('attempt 6 · version 6 ✓');
    expect(text).toContain('step-6');
  });
});

describe('scenario_check_self: the runs of the backend', () => {
  const FIRST = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';

  it('hands the runs, the round limit, the status of a step and the code of a refusal to the data', async () => {
    const r = await rig('data');
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'failed',
          execution_ids: [FIRST],
          max_repair_rounds: 3,
          failure: failureDocument('POST /checkout', 'HTTP 403 Forbidden', null, 403),
          runs: [
            checkRunDocument(FIRST, 1, 'failed', [
              ['logowanie', 'ok'],
              ['zamówienie', 'failed', 403, 'HTTP 403 Forbidden'],
              ['potwierdzenie', 'not_run'],
            ]),
          ],
          repairs: [
            {
              round: 1,
              failure: failureDocument('POST /checkout', 'HTTP 403 Forbidden', null, 403),
              changes_summary: '',
              refused_reason: 'raw validation text',
              refused_code: 'weakens_test',
              refused_message: 'The change would make the test check less.',
              scenario_version_after: null,
              verdict: null,
              recording_available: false,
            },
          ],
        }),
      ),
    ]);
    const result = await run(r, { scenarios: ['zakupy'] });
    const [view] = result.outcome.data.scenarios;
    expect(view?.maxRepairRounds).toBe(3);
    expect(view?.runs?.[0]).toMatchObject({
      executionId: FIRST,
      version: 1,
      status: 'failed',
      stepsOmitted: 0,
    });
    expect(view?.runs?.[0]?.steps.map((item) => [item.name, item.result, item.httpStatus])).toEqual(
      [
        ['logowanie', 'ok', 200],
        ['zamówienie', 'failed', 403],
        ['potwierdzenie', 'not_run', null],
      ],
    );
    expect(view?.failure?.httpStatus).toBe(403);
    expect(view?.repairs[0]).toMatchObject({
      refusedCode: 'weakens_test',
      refusedMessage: 'The change would make the test check less.',
    });
    // The code is data; the text has the sentence.
    expect(result.text).not.toContain('weakens_test');
    expect(flat(result.text)).toContain('odrzucona: The change would make the test check less.');
  });

  it('asks for the requests in run order and draws a chain stored before runs in that order', async () => {
    const r = await rig('data');
    const row = r.fake.store
      .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
      .require(IDS.selfCheckKonto).endpoints[0];
    if (row === undefined) throw new Error('the world has no endpoint row to copy');
    // The backend lists by count; run_order says which request the run answered first.
    const rows = [
      { ...row, time_series: [], name: 'POST /pay', run_order: 2, ok_count: 1, count: 1 },
      { ...row, time_series: [], name: 'GET /home', run_order: 1, ok_count: 1, count: 1 },
      { ...row, time_series: [], name: 'GET /late', run_order: null, ok_count: 1, count: 1 },
    ];
    r.fake.faults.next(
      'GET',
      '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
      {
        status: 200,
        body: {
          endpoints: rows,
          groups: [],
          repicks: [],
          series_source: 'prometheus',
          series_retention: null,
        },
      },
    );
    r.checks.set(IDS.scenarios.zakupy, passed(IDS.selfCheckZakupy, ZAKUPY_DONE));
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(withoutLinks(result.text)).toContain('home ✓ → pay ✓ → late ✓');
    const asked = r.fake.calls.filter((call) => call.path.endsWith('/endpoints'));
    expect(asked.length).toBeGreaterThan(0);
    for (const call of asked) expect(call.query['order']).toBe('run');
  });

  it('never shows a secret that a step name or a step reason carries', async () => {
    const r = await rig('data');
    r.checks.set(
      IDS.scenarios.zakupy,
      doc({
        status: 'failed',
        execution_ids: [FIRST],
        failure: failureDocument(`POST /login ${CANARY}`, `rejected ${CANARY}`, null, 401),
        runs: [
          checkRunDocument(FIRST, 1, 'failed', [
            [`login ${CANARY}`, 'failed', 401, `Authorization: Bearer ${CANARY}`],
          ]),
        ],
      }),
    );
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.text).toContain('401');
    expect(result.text).not.toContain(CANARY);
    expect(JSON.stringify(result.outcome.data)).not.toContain(CANARY);
    r.assertClean();
  });
});

// ---- the view in the state file ---------------------------------------------------------------

describe('scenario_check_self: the view for the client beside the chat', () => {
  const FIRST = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';

  function stateOf(r: ToolRig): unknown {
    return JSON.parse(readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'));
  }

  function planRepair(r: Rig): void {
    const failure = failureDocument('POST /checkout', 'HTTP 403 Forbidden', null, 403);
    r.checks.plan(IDS.scenarios.zakupy, [
      step(0, doc({})),
      step(
        3000,
        doc({
          status: 'passed_after_repair',
          scenario_version: 2,
          execution_ids: [FIRST, IDS.selfCheckZakupy],
          runs: [
            checkRunDocument(FIRST, 1, 'failed', [
              ['login', 'ok'],
              ['pay', 'failed', 403, `HTTP 403 Forbidden ${CANARY}`],
              ['confirm', 'not_run'],
            ]),
            checkRunDocument(IDS.selfCheckZakupy, 2, 'passed', [
              ['login', 'ok'],
              ['pay', 'ok'],
              ['confirm', 'ok'],
            ]),
          ],
          repairs: [
            {
              round: 1,
              failure,
              changes_summary: 'added a header',
              refused_reason: null,
              refused_code: null,
              refused_message: null,
              scenario_version_after: 2,
              verdict: 'passed',
              recording_available: true,
            },
          ],
          started_at: '2026-11-22T10:19:55+00:00',
          finished_at: ZAKUPY_DONE,
        }),
      ),
    ]);
  }

  it('is written once the check ends, in the shape the state schema defines, with no secret in it', async () => {
    const r = await rig('data');
    planRepair(r);
    const result = await run(r, { scenarios: ['zakupy'] });
    expect(result.isError, result.text).toBe(false);
    const state = stateOf(r) as { selfCheckViews: Record<string, { value: unknown }> };
    // The file as a whole is valid for the schema of the catalog.
    expect(State.safeParse(state).success).toBe(true);
    const entries = Object.entries(state.selfCheckViews);
    expect(entries).toHaveLength(1);
    // Keyed by the handle the check had; the finished outcome names none, the state does.
    expect(entries[0]?.[0]).toMatch(/^sc-[0-9a-f]{12}$/u);
    const [view] = (entries[0]?.[1].value as { scenarios: Record<string, unknown>[] }).scenarios;
    expect(view).toMatchObject({
      id: IDS.scenarios.zakupy,
      status: 'passed_after_repair',
      phase: 'finished',
      version: 2,
      run: 2,
      moreSteps: 0,
      repairLimit: 2,
      startedAt: '2026-11-22T10:19:55.000Z',
      steps: [
        { name: 'login', result: 'ok' },
        { name: 'pay', result: 'ok' },
        { name: 'confirm', result: 'ok' },
      ],
      repairs: [{ round: 1, outcome: 'repaired', text: 'added a header', version: 2 }],
    });
    const runs = (view as { runs: { run: number; verdict: string; results: unknown[] }[] }).runs;
    expect(runs.map((item) => [item.run, item.verdict])).toEqual([
      [1, 'failed'],
      [2, 'passed'],
    ]);
    expect(runs[0]?.results).toEqual([
      { step: 0, result: 'ok', http: [200] },
      { step: 1, result: 'failed', http: [403], reason: 'HTTP 403 Forbidden [redacted]' },
      { step: 2, result: 'skipped' },
    ]);
    expect(JSON.stringify(state)).not.toContain(CANARY);
  });

  it('a view of twenty long checks still fits the limits of the section', () => {
    const steps = Array.from({ length: 60 }, (_, index) =>
      runStep(`request number ${String(index)} with a rather long name `.repeat(2), 'ok', {
        planIndex: index,
        path: `/some/long/path/${String(index)}`,
        method: 'GET',
        reason: 'x'.repeat(200),
      }),
    );
    const scenarios = Array.from({ length: 20 }, (_, index) => ({
      id: `scenario-${String(index)}`,
      version: 3,
      startedAt: null,
      finishedAt: null,
      check: check({
        name: `scenario ${String(index)}`,
        status: index % 2 === 0 ? 'passed' : 'failed',
        runs: [1, 2, 3, 4, 5].map((n) => runOf(steps, { version: n })),
        repairs: [1, 2, 3, 4, 5].map((n) => repairOf({ round: n })),
      }),
    }));
    const view = buildSelfCheckView('perf', scenarios);
    const written = State.safeParse({
      schema: 3,
      selfCheckViews: { k: { savedAt: '2026-11-22T10:20:00.000Z', value: view } },
    });
    expect(written.error?.issues ?? []).toEqual([]);
  });

  it('five runs do not fit: the first one and the last three stay', () => {
    const run = (n: number): CheckRunView =>
      runOf([runStep('login', 'ok', { planIndex: 0 })], { version: n });
    const view = buildSelfCheckView('perf', [
      {
        id: 'scenario-1',
        version: 5,
        startedAt: null,
        finishedAt: null,
        check: check({ runs: [1, 2, 3, 4, 5].map(run) }),
      },
    ]);
    expect(view.scenarios[0]?.runs.map((item) => [item.run, item.version])).toEqual([
      [1, 1],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
  });
});

describe('self-check runs: groups, repeated names, runs without a verdict, a check that stopped', () => {
  const FIRST = '5d0c2a7e-9b13-4f68-a1d4-8e3b7c6f0a29';

  it('a step in a group says its group where it failed, and two steps of one name tell apart by group', () => {
    const lines = render(
      check({
        status: 'failed',
        steps: [],
        runs: [
          runOf([
            runStep('pay', 'ok', { group: 'Cart' }),
            runStep('pay', 'failed', { group: 'Checkout', httpStatus: 422, reason: 'declined' }),
          ]),
        ],
        failure: { request: 'Checkout / pay', message: 'declined', goalUrl: null },
      }),
      tEn,
    );
    expect(lines[0]).toBe('zakupy  Cart / pay ✓ → Checkout / pay ✕ 422');
    expect(lines[1]).toBe('        ✕ Checkout / pay 422: declined');
  });

  it('a plan that holds one name twice draws both steps', () => {
    const lines = render(
      check({
        status: 'passed',
        steps: [],
        runs: [
          runOf([runStep('poll'), runStep('poll'), runStep('done')], {
            status: 'passed',
          }),
        ],
      }),
      tEn,
    );
    expect(lines[0]).toMatch(/^zakupy {2}poll ✓ → poll ✓ → done ✓/u);
  });

  it('a run without a verdict has a header and no mark', () => {
    const lines = render(
      check({
        status: 'repairing',
        steps: [],
        runs: [
          runOf([runStep('pay', 'failed', { httpStatus: 403, reason: 'denied' })]),
          runOf([runStep('pay')], { version: 2, status: null }),
        ],
        repairs: [repairOf()],
      }),
      tEn,
    );
    expect(lines).toContain('        attempt 2 · version 2');
    expect(lines.at(-1)).toBe('        AI repair in progress');
  });

  it.each(['interrupted', 'repairing'])(
    'a check that is %s still shows the steps that ran and the one that failed',
    (status) => {
      const lines = render(
        check({
          status,
          steps: [],
          runs: [runOf([runStep('login'), runStep('pay', 'failed', { reason: 'denied' })])],
        }),
        tEn,
      );
      expect(lines[0]).toBe('zakupy  login ✓ → pay ✕');
      expect(lines).toContain('        ✕ pay: denied');
    },
  );

  it('with runs the trace is read by the failing step the backend names, and the attempt names its run', async () => {
    const r = await rig('data');
    seedTraces(r.fake, FIRST, [
      {
        traceId: 'b1000000000000000000000000000001',
        request: 'Checkout / pay',
        method: 'POST',
        url: 'https://api.perf.example.com/pay',
        status: 402,
        responseBody: '{"error":"card declined"}',
        error: 'status.find.is(200), found 402',
      },
    ]);
    r.checks.set(
      IDS.scenarios.zakupy,
      doc({
        status: 'failed',
        execution_ids: [FIRST],
        failure: failureDocument('Checkout / pay', 'found 402', null, 402),
        runs: [
          {
            ...checkRunDocument(FIRST, 1, 'failed', [['login', 'ok']]),
            steps: [
              ...checkRunDocument(FIRST, 1, 'failed', [['login', 'ok']]).steps,
              {
                name: 'pay',
                group: 'Checkout',
                plan_index: 1,
                is_preflight: false,
                method: 'POST',
                path: '/pay',
                result: 'failed',
                http_status: 402,
                reason: 'found 402',
              },
            ],
          },
        ],
      }),
    );
    const result = await run(r, { scenarios: ['zakupy'] });
    const text = withoutLinks(result.text);
    expect(text).toContain('✕ Checkout / pay 402: found 402');
    expect(text).toContain('odpowiedź 402 celu (dane): „{"error":"card declined"}”');
  });

  it('the words of a refused repair are cut and masked in the data', async () => {
    const r = await rig('data');
    r.checks.set(
      IDS.scenarios.zakupy,
      doc({
        status: 'failed',
        execution_ids: [FIRST],
        failure: failureDocument('POST /pay', 'denied', null, 403),
        runs: [checkRunDocument(FIRST, 1, 'failed', [['pay', 'failed', 403, 'denied']])],
        repairs: [
          {
            round: 1,
            failure: failureDocument('POST /pay', 'denied', null, 403),
            changes_summary: '',
            refused_reason: `target said ${CANARY}\n${'x'.repeat(2000)}`,
            refused_code: 'invalid_change',
            refused_message: 'The change does not apply to the flow.',
            scenario_version_after: null,
            verdict: null,
            recording_available: false,
          },
        ],
      }),
    );
    const result = await run(r, { scenarios: ['zakupy'] });
    const refused = result.outcome.data.scenarios[0]?.repairs[0]?.refused ?? '';
    expect(refused.length).toBeLessThanOrEqual(300);
    expect(refused).not.toContain('\n');
    expect(JSON.stringify(result.outcome.data)).not.toContain(CANARY);
  });

  it('the state view keeps the group of the failing step', () => {
    const view = buildSelfCheckView('perf', [
      {
        id: 's1',
        version: 1,
        startedAt: null,
        finishedAt: null,
        check: check({
          status: 'failed',
          runs: [
            runOf([runStep('pay', 'failed', { group: 'Checkout', httpStatus: 422, reason: 'no' })]),
          ],
          failure: { request: 'pay', message: 'no', httpStatus: 422, goalUrl: null },
        }),
      },
    ]);
    expect(view.scenarios[0]?.failure).toEqual({
      step: 'Checkout / pay',
      http: 422,
      message: 'no',
    });
  });
});
