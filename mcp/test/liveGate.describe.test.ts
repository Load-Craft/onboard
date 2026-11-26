// The scenario `describe` of the live gate: flows from a description, walked by the LoadCraft
// browser. What it refuses before the start, how it copies the account and reads the plan, which
// paths it approves, what it wants of the saved flows, and the whole scenario on the fake backend:
// a plan of several paths, at least one saved flow with the pauses of a person, the password of the
// account in no answer, a request for help that ends the gate as "needs a human" (exit code 2) and
// the time limit of the walk that stops the run.

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createTranslator } from '../src/render/i18n/index.js';
import { renderDescribeFlows, type DescribeFlowsData } from '../src/render/views/describeFlows.js';
import {
  accountFile,
  checkLaunch,
  describeFlowFacts,
  describeFlowProblems,
  envValues,
  handshakeOf,
  parseArgs,
  planFromText,
  SCENARIOS,
  walkChoice,
  type GateConfig,
  type GateDescription,
} from '../scripts/live-gate.js';
import { ALL_CANARIES, CANARY, FILE_CANARY, assertNoCanary } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

const DESCRIPTION: GateDescription = {
  description:
    'Customers log in, search for a product, add it to the cart and pay; some only browse the catalogue.',
  envFile: '/srv/sklep/.env',
};

/** The configuration of the other scenarios: no describe section. */
const BASE: GateConfig = {
  backend: { url: 'http://127.0.0.1:8123' },
  workspace: { openapi: '/tmp/openapi.json' },
  projectPrefix: 'live-gate',
  composition: 'gate-mix',
  environments: {
    main: { name: 'gate', api: 'http://127.0.0.1:9000', frontend: 'http://shop.example.com:9001' },
    capped: { name: 'gate-capped', api: 'http://127.0.0.1:9000', limit: [5, 5] },
  },
  journeys: 2,
  accounts: 30,
  profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
  thresholds: { p95_ms: 2000, error_rate_pct: 5 },
  costLimitUsd: 3,
  langfuse: { url: 'https://langfuse.example.com', api: 'v2', environment: 'mcp-live-gate' },
  timeoutMin: 45,
  forbiddenBackends: [],
};

const CONFIG: GateConfig = { ...BASE, describe: DESCRIPTION };

const ENV = {
  LIVE_GATE_I_HAVE_APPROVAL: 'http://127.0.0.1:8123',
  LIVE_GATE_TARGET_APPROVAL: 'http://127.0.0.1:9000,http://shop.example.com:9001',
  LIVE_GATE_API_TOKEN: CANARY,
  LANGFUSE_PUBLIC_KEY: 'pk-lf-example',
  LANGFUSE_SECRET_KEY: 'sk-lf-example',
};

const DESCRIBE = { scenarios: ['describe'] as const };

function refusalsOf(config: GateConfig, env: Record<string, string> = ENV): string {
  return checkLaunch(config, env, DESCRIBE).join('\n');
}

describe('--scenario describe', () => {
  it('is named explicitly: the default stays docs, describe comes after the others', () => {
    expect(SCENARIOS).toEqual(['docs', 'har', 'protected', 'describe']);
    expect(parseArgs(['--fake']).scenarios).toEqual(['docs']);
    expect(parseArgs(['--fake', '--scenario', 'describe']).scenarios).toEqual(['describe']);
    expect(parseArgs(['--fake', '--scenario', 'describe,docs']).scenarios).toEqual([
      'docs',
      'describe',
    ]);
  });
});

describe('what the describe scenario refuses before it starts', () => {
  it('starts with a description, an env file and a frontend of the main environment', () => {
    expect(checkLaunch(CONFIG, ENV, DESCRIBE)).toEqual([]);
  });

  it('needs the describe section only when the scenario is walked', () => {
    const without = BASE;
    expect(refusalsOf(without)).toMatch(/the scenario describe needs describe\.description/u);
    expect(checkLaunch(without, ENV, { scenarios: ['docs'] })).toEqual([]);
  });

  it('wants a description of at least 20 characters and an env file', () => {
    expect(
      refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, description: ' too short ' } }),
    ).toMatch(/describe\.description must have at least 20 characters/u);
    expect(refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, envFile: '' } })).toMatch(
      /describe\.envFile/u,
    );
  });

  it('wants the frontend of the main environment, checked like every other target', () => {
    const main = { name: 'gate', api: 'http://127.0.0.1:9000' };
    const at = (frontend?: string): GateConfig => ({
      ...CONFIG,
      environments: {
        ...CONFIG.environments,
        main: frontend === undefined ? main : { ...main, frontend },
      },
    });
    const approved = (frontend: string) => ({
      ...ENV,
      LIVE_GATE_TARGET_APPROVAL: `http://127.0.0.1:9000,${frontend}`,
    });
    expect(refusalsOf(at())).toMatch(/environments\.main\.frontend must be given/u);
    // A local shop is a target like any other: approved, it starts; whether the LoadCraft browser
    // may open it is for the plugin and the backend to decide.
    for (const frontend of [
      'http://localhost:9001',
      'http://127.0.0.1:9001',
      'http://shop.localhost:9001',
      'http://shop.gate.test:9001',
    ]) {
      expect(refusalsOf(at(frontend), approved(frontend)), frontend).toBe('');
    }
    // The rules of every target stay: port 8000 of this machine and an unapproved origin.
    expect(refusalsOf(at('http://localhost:8000'), approved('http://localhost:8000'))).toMatch(
      /environments\.main\.frontend http:\/\/localhost:8000 reaches this machine on port 8000/u,
    );
    expect(refusalsOf(at('http://localhost:9001'))).toMatch(
      /LIVE_GATE_TARGET_APPROVAL.*http:\/\/localhost:9001/su,
    );
  });

  it('wants the frontend in the approval of the targets like every other target', () => {
    expect(
      refusalsOf(CONFIG, { ...ENV, LIVE_GATE_TARGET_APPROVAL: 'http://127.0.0.1:9000' }),
    ).toMatch(/LIVE_GATE_TARGET_APPROVAL.*http:\/\/shop\.example\.com:9001/su);
  });

  it('checks the numbers of the section: paths 2 to 10, steps 1 to 60, a walk of at most 20 minutes', () => {
    for (const minPaths of [0, 11, 2.5]) {
      expect(
        refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, minPaths } }),
        String(minPaths),
      ).toMatch(/describe\.minPaths/u);
    }
    for (const maxSteps of [0, 61, 1.5]) {
      expect(
        refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, maxSteps } }),
        String(maxSteps),
      ).toMatch(/describe\.maxSteps/u);
    }
    for (const timeoutMin of [0, -1, 21]) {
      expect(
        refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, timeoutMin } }),
        String(timeoutMin),
      ).toMatch(/describe\.timeoutMin/u);
    }
    expect(
      refusalsOf({
        ...CONFIG,
        describe: { ...DESCRIPTION, minPaths: 3, maxSteps: 30, timeoutMin: 20 },
      }),
    ).toBe('');
  });

  it('refuses a key name an env file cannot hold', () => {
    expect(
      refusalsOf({ ...CONFIG, describe: { ...DESCRIPTION, passwordKey: 'TEST PASSWORD' } }),
    ).toMatch(/describe\.passwordKey/u);
  });

  it('keeps every refusal of the safety rules', () => {
    const env = { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: 'http://127.0.0.1:8000' };
    expect(
      checkLaunch({ ...CONFIG, backend: { url: 'http://127.0.0.1:8000' } }, env, DESCRIBE).join(
        '\n',
      ),
    ).toMatch(/port 8000/u);
    expect(
      checkLaunch({ ...CONFIG, backend: { url: 'https://app.loadcraft.io' } }, env, DESCRIBE).join(
        '\n',
      ),
    ).toMatch(/loadcraft\.io/u);
  });
});

describe('the account of the LoadCraft browser', () => {
  const PASSWORD = 'Gate-Account-Pass-91';
  const FILE = [
    '# the target application',
    'APP_SECRET=app-secret-value-1234',
    'DATABASE_URL=mysql://root:db-secret-5678@db/shop',
    'export TEST_USER_EMAIL="user@example.com"',
    `TEST_USER_PASSWORD='${PASSWORD}'`,
    '',
  ].join('\n');

  it('reads the dotenv lines the plugin reads', () => {
    const values = envValues(
      [
        'A=plain value # a comment',
        'B=pa#ss',
        "C='single # not a comment'",
        'D="double \\"quoted\\" \\\\ value"',
        'export E=exported',
        'F=first',
        'F=second',
        'not an assignment',
        '  # a comment line',
      ].join('\n'),
    );
    expect(Object.fromEntries(values)).toEqual({
      A: 'plain value',
      B: 'pa#ss',
      C: 'single # not a comment',
      D: 'double "quoted" \\ value',
      E: 'exported',
      F: 'second',
    });
  });

  it('copies only the login and the password, quoted so that the plugin reads them as they are', () => {
    const copy = accountFile(FILE, DESCRIPTION);
    if ('refusals' in copy) throw new Error(copy.refusals.join('\n'));
    expect(copy.password).toBe(PASSWORD);
    expect(copy.content).toContain("TEST_USER_EMAIL='user@example.com'");
    expect(copy.content).toContain(`TEST_USER_PASSWORD='${PASSWORD}'`);
    expect(copy.content).not.toContain('app-secret-value-1234');
    expect(copy.content).not.toContain('db-secret-5678');
    expect(Object.fromEntries(envValues(copy.content))).toEqual({
      TEST_USER_EMAIL: 'user@example.com',
      TEST_USER_PASSWORD: PASSWORD,
    });
  });

  it('takes the keys the configuration names', () => {
    const copy = accountFile('SHOP_LOGIN=a@example.com\nSHOP_PASS=Another-Pass-77\n', {
      ...DESCRIPTION,
      emailKey: 'SHOP_LOGIN',
      passwordKey: 'SHOP_PASS',
    });
    if ('refusals' in copy) throw new Error(copy.refusals.join('\n'));
    expect(copy.password).toBe('Another-Pass-77');
    expect(copy.content).toContain("SHOP_LOGIN='a@example.com'");
  });

  it.each([
    ['a missing key', 'TEST_USER_EMAIL=user@example.com\n', /TEST_USER_PASSWORD/u],
    ['an empty password', 'TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=\n', /empty/u],
    [
      'a password shorter than 8 characters (it would match ordinary words of an answer)',
      'TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=shop\n',
      /at least 8 characters/u,
    ],
    [
      'a password that is in the description (the search would find it in every call)',
      'TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=catalogue\n',
      /description/u,
    ],
    [
      'a password that is part of the login',
      'TEST_USER_EMAIL=user-example@example.com\nTEST_USER_PASSWORD=user-example\n',
      /login/u,
    ],
    [
      'a value with a single quote, which the copy cannot quote',
      'TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD="it\'s-a-pass"\n',
      /single quote/u,
    ],
  ])('refuses %s', (_what, text, reason) => {
    const copy = accountFile(text, DESCRIPTION);
    expect('refusals' in copy ? copy.refusals.join('\n') : 'accepted').toMatch(reason);
  });
});

const VIEW = (paths: DescribeFlowsData['paths'], rest: Partial<DescribeFlowsData> = {}) =>
  renderDescribeFlows(
    {
      plan: 'r-2481a3f0',
      paths,
      sharedSignIn: paths.map((path) => path.name),
      single: false,
      started: false,
      accountUsed: { file: '.env', emailKey: 'TEST_USER_EMAIL' },
      link: '',
      ...rest,
    },
    createTranslator('en'),
  );

const RUN_ID = '2481a3f0-9e6c-4d5b-b7a2-1f8e3c0d6a94';
/** The link line the registry writes under a result (`↗ <label>: <url>`). */
const LINK = `↗ live preview: https://app.example.com/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/scenario-from-description/runs/${RUN_ID}`;

function path(
  name: string,
  steps: string[],
  rest: Partial<DescribeFlowsData['paths'][number]> = {},
) {
  return { name, steps, dependsOnPrior: false, ownIdentity: false, ...rest };
}

describe('reading the plan from the text of flows_describe_journeys', () => {
  it('reads the handle, the run and every path with its steps', () => {
    const paths = [
      path('zakupy', ['logowanie', 'wyszukanie', 'koszyk', 'kod rabatowy', 'płatność']),
      path('przeglądanie', ['kategoria', 'produkt']),
      path('a very long name of a path that does not fit the column', ['first', 'second']),
      path('rejestracja', ['formularz', 'potwierdzenie'], { ownIdentity: true }),
      path(
        'konto',
        Array.from({ length: 12 }, (_, i) => `a rather long step number ${String(i + 1)}`),
        { dependsOnPrior: true },
      ),
    ];
    const text = `${VIEW(paths, { sharedSignIn: ['zakupy', 'konto'] })}\n${LINK}`;
    const plan = planFromText(text);
    expect(plan.plan).toBe('r-2481a3f0');
    expect(plan.runId).toBe(RUN_ID);
    expect(plan.paths.map((item) => item.name)).toEqual(paths.map((item) => item.name));
    paths.forEach((item, index) => {
      for (const step of item.steps) expect(plan.paths[index]?.steps).toContain(step);
    });
  });

  it('reads no names from a plan that only names one walked at once, but counts it as one path', () => {
    const text = `${VIEW([path('zakupy', [])], { single: true, started: true, sharedSignIn: [] })}\n${LINK}`;
    const plan = planFromText(text);
    expect(plan.plan).toBe('r-2481a3f0');
    expect(plan.paths).toEqual([]);
    expect(plan.declared).toBe(1);
    expect(handshakeOf(text).result).toBe('accepted');
  });

  it('reads the count of the header in every form of both locales (the words of the view, not a copy)', () => {
    for (const locale of ['en', 'pl'] as const) {
      const t = createTranslator(locale);
      for (let count = 1; count <= 30; count += 1) {
        const text = `${t('describe.plan', { plan: 'r-2481a3f0' })} · ${t.plural('describe.paths', count)}\nrest`;
        expect(planFromText(text).declared, `${locale} ${String(count)}`).toBe(count);
      }
    }
  });

  it('counts the paths of a plan of several as its names', () => {
    const text = VIEW([path('a', ['x', 'y']), path('b', ['z', 'w'])]);
    expect(planFromText(text).declared).toBe(2);
  });

  it('reads nothing from an error', () => {
    expect(planFromText('[describe_channel_refused] LoadCraft refused …')).toEqual({ paths: [] });
  });
});

describe('the paths the gate approves', () => {
  const safe = [
    { name: 'zakupy', steps: 'logowanie → koszyk → płatność' },
    { name: 'przeglądanie', steps: 'kategoria → produkt' },
  ];

  it('approves all when every path is safe', () => {
    expect(walkChoice(safe)).toEqual({
      approve: 'all',
      names: ['zakupy', 'przeglądanie'],
      skipped: [],
    });
  });

  it('leaves out a path that deletes, changes accounts or administers, and names the rest', () => {
    const choice = walkChoice([
      ...safe,
      { name: 'account removal', steps: 'settings → delete the account' },
      { name: 'roles', steps: 'log in → change the role of a user' },
    ]);
    expect(choice.approve).toEqual(['zakupy', 'przeglądanie']);
    expect(choice.skipped.map((item) => item.name)).toEqual(['account removal', 'roles']);
  });

  it('has nothing to approve when no path is safe', () => {
    const choice = walkChoice([{ name: 'admin', steps: 'admin panel → delete a user' }]);
    expect(choice.approve).toEqual([]);
    expect(choice.problem).toMatch(/no path of the plan is safe/u);
  });
});

describe('the flows of the walk', () => {
  const request = (id: string, actionClass?: string) => ({
    id,
    type: 'request',
    config: {
      method: 'GET',
      path: `/${id}`,
      ...(actionClass === undefined ? {} : { action_start: { class: actionClass } }),
    },
  });
  const pause = (id: string, source = 'default_human') => ({
    id,
    type: 'pause',
    config: { delay_min_ms: 1000, delay_max_ms: 2000, source },
  });
  const flow = (name: string, blocks: unknown[], edges?: [string, string][]) => ({
    name,
    blocks,
    ...(edges === undefined
      ? {}
      : { edges: edges.map(([source, target]) => ({ source, target })) }),
  });

  it('counts the pauses of a person and the action class of the request each one comes before', () => {
    const facts = describeFlowFacts(
      flow('zakupy', [
        request('a'),
        pause('p1'),
        request('b', 'form_submit'),
        pause('p2'),
        request('c'),
        pause('p3', 'recording'),
        request('d', 'page'),
      ]),
    );
    expect(facts).toEqual({ name: 'zakupy', requests: 4, humanPauses: 2, classifiedPauses: 1 });
  });

  it('follows the edges to the request after a pause', () => {
    const facts = describeFlowFacts(
      flow(
        'konto',
        [pause('p1'), request('b'), request('a'), request('c', 'in_page')],
        [
          ['a', 'p1'],
          ['p1', 'c'],
          ['c', 'b'],
        ],
      ),
    );
    expect(facts.classifiedPauses).toBe(1);
  });

  it.each([
    [
      'a pause of a person before a request with an action class',
      [request('a'), pause('p'), request('b', 'page')],
      true,
    ],
    [
      'only pauses taken from a recording',
      [request('a'), pause('p', 'recording'), request('b', 'page')],
      false,
    ],
    [
      'pauses of a person before requests without an action class',
      [request('a'), pause('p'), request('b')],
      false,
    ],
    [
      'an action class that is not one of the four',
      [request('a'), pause('p'), request('b', 'scroll')],
      false,
    ],
    ['no pause at all', [request('a'), request('b', 'page')], false],
  ])('a flow of several requests with %s passes: %3$s', (_what, blocks, passes) => {
    const problems = describeFlowProblems([describeFlowFacts(flow('zakupy', blocks))]);
    expect(problems.length === 0).toBe(passes);
  });

  it('does not fail a flow of one request, which has nothing to pause before', () => {
    expect(
      describeFlowProblems([
        describeFlowFacts(flow('one', [request('a')])),
        describeFlowFacts(flow('two', [request('a'), pause('p'), request('b', 'page')])),
      ]),
    ).toEqual([]);
  });
});

describe('the handshake of the run channel', () => {
  it('is accepted when the plan came, since it comes only through the channel', () => {
    expect(handshakeOf(`${VIEW([path('a', ['x']), path('b', ['y'])])}\n${LINK}`).result).toBe(
      'accepted',
    );
  });

  it('keeps the reason of a refusal and of a channel that did not open', () => {
    const refused = handshakeOf(
      '[describe_channel_refused] LoadCraft refused the connection to the channel of the run (HTTP 403: origin_not_allowed, project_access_denied, authentication_required or run_not_found; LoadCraft does not say which).',
    );
    expect(refused.result).toBe('refused');
    expect(refused.detail).toContain('HTTP 403: origin_not_allowed');
    expect(handshakeOf('[describe_channel_unavailable] The WebSocket channel …').result).toBe(
      'unavailable',
    );
    expect(handshakeOf('[target_unreachable] The LoadCraft browser will not reach …').result).toBe(
      'not reached',
    );
  });
});

// ---- the scenario on the fake backend --------------------------------------------------------

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(args: readonly string[]): Promise<Finished> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LIVE_GATE_FAKE_SPEED: '600',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });
}

// Removed once the file is done: its gates run side by side, so no test may clean up for the others.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-describe-'));
  dirs.push(dir);
  return dir;
}

async function describeRun(
  extra: readonly string[] = [],
): Promise<{ run: Finished; report: string }> {
  const dir = await scratch();
  const run = await runGate(['--fake', '--scenario', 'describe', '--report-dir', dir, ...extra]);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files, `${run.stdout}\n${run.stderr}`).toHaveLength(1);
  return { run, report: await readFile(join(dir, files[0] ?? ''), 'utf8') };
}

/** The password of the account never leaves the gate: not in the report, not in what it prints. */
function expectNoPassword(run: Finished, report: string): void {
  for (const text of [report, run.stdout, run.stderr]) {
    assertNoCanary(text);
    for (const canary of ALL_CANARIES) expect(text).not.toContain(canary);
    expect(text).not.toContain(FILE_CANARY);
  }
}

describe.concurrent('npm run gate -- --fake --scenario describe', () => {
  it('reads a plan of several paths, approves the safe ones through flows_record_journeys and checks the saved flows', async () => {
    const { run, report } = await describeRun();
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(report).toContain('Result: **PASSED**');
    expect(report).toContain('| Scenarios | describe |');
    expect(report).toContain('`flows_describe_journeys`');
    expect(report).toContain('`flows_record_journeys`');
    expect(report).toMatch(/the plan has at least 2 paths \(read from the header: 4\)/u);
    expect(report).toMatch(/the run waits in LoadCraft for the approval of its paths/u);
    expect(report).toMatch(/path left out: "account removal" — a step that deletes/u);
    expect(report).toMatch(
      /LoadCraft walks exactly the approved paths: zakupy, przeglądanie, konto/u,
    );
    expect(report).toMatch(/at least one path is saved \(3 of 3\)/u);
    expect(report).toMatch(
      /every saved flow of several requests has pauses of a person with an action class/u,
    );
    expect(report).toMatch(
      /the password of the account is in no answer of a tool \(\d+ answers searched\)/u,
    );
    // The walk is approved by flows_record_journeys alone: the wait that follows never carries paths.
    expect(report).not.toMatch(/`process_wait` \{[^\n]*paths/u);
    // The run channel: the handshake and the place for the operator's note.
    expect(report).toContain('## Run channel of the description');
    expect(report).toMatch(/\| Handshake \| accepted/u);
    expect(report).toMatch(/channel open/u);
    expect(report).toMatch(/\| Operator's note \|/u);
    // The fake backend saw one approval, and the start of the run carried the password.
    expect(report).toMatch(
      /fake backend: 1 description run\(s\), 1 approval\(s\) \(zakupy, przeglądanie, konto\), the start carried the password of the account/u,
    );
    // Nothing else was walked.
    expect(report).not.toContain('`flows_suggest_journeys`');
    expect(report).not.toContain('`run_start`');
    expectNoPassword(run, report);
  }, 300_000);

  it('walks a plan of one path through flows_record_journeys without approving anything, and notes the missing split', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-one-path']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(report).toContain('Result: **PASSED**');
    expect(report).toContain('`flows_record_journeys`');
    expect(report).toMatch(/the plan has 1 path\b/u);
    expect(report).toMatch(/LoadCraft did not split the description[^\n]*minPaths/u);
    expect(report).toMatch(/at least one path is saved \(1 of 1\)/u);
    expect(report).toMatch(/fake backend: 1 description run\(s\), 0 approval\(s\)/u);
    // The gate calls flows_record_journeys with the plan alone, as the "next" of the view says: no paths.
    expect(report).toMatch(
      /Call 1: `flows_record_journeys` \{\\?"plan\\?":\\?"r-[0-9a-f]{8}\\?",\\?"max_wait_s\\?":\d+\}/u,
    );
    expectNoPassword(run, report);
  }, 300_000);

  it('fails a walk that saved no flow', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-none-saved']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(report).toMatch(
      /Failed at step \d+ `flows_record_journeys` \(walk of the approved paths\)/u,
    );
    expect(report).toMatch(/at least one path is saved \(0 of 3\)/u);
  }, 300_000);

  it('fails saved flows without the pauses of a person', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-no-pauses']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(report).toMatch(
      /Failed at step \d+ `flows_record_journeys` \(walk of the approved paths\)/u,
    );
    expect(report).toMatch(/no pause of a person with an action class/u);
  }, 300_000);

  it('a request for help ends the gate as "needs a human" (exit code 2), not as a failure, and stops the run', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-help']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(2);
    expect(report).toContain('Result: **NEEDS HUMAN**');
    expect(report).not.toContain('Result: **FAILED**');
    expect(report).toMatch(
      /Needs a human at step \d+ `flows_record_journeys` \(walk of the approved paths\)/u,
    );
    expect(report).toMatch(
      /\| \d+ \| walk of the approved paths \| `flows_record_journeys` \|.*\| NEEDS HUMAN \|/u,
    );
    expect(report).toMatch(/cancel record_run:[0-9a-f-]{36} \(plugin\)/u);
    // The second layer: the runs of a description under way are read from the backend.
    expect(report).toMatch(
      /description run [0-9a-f-]{36} was running: cancelled on the backend|sweep 1: no run of a description under way/u,
    );
    expect(run.stdout.trim()).toMatch(/\.md$/u);
    expectNoPassword(run, report);
  }, 300_000);

  it('the time limit of the walk stops it: the gate cancels the run and fails', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-time-over-limit']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(report).toMatch(
      /Failed at step \d+ `flows_record_journeys` \(walk of the approved paths\): time limit of the walk reached: 20 min/u,
    );
    expect(report).toContain('## Stopping');
    expect(report).toMatch(/cancel (record_run:[0-9a-f-]{36}|r-[0-9a-f]{8}) \(plugin\)/u);
    expect(report).toMatch(
      /fake backend: .*stop message\(s\) [1-9]|scenario-from-description\/runs\/[0-9a-f-]{36}\/cancel/u,
    );
    expectNoPassword(run, report);
  }, 300_000);

  it('a run channel that does not open fails the plan and the report keeps how the handshake went', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-channel-blocked']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    expect(report).toMatch(
      /Failed at step \d+ `flows_describe_journeys` \(plan from the description\): the handshake of the run channel: unavailable/u,
    );
    expect(report).toMatch(/\| Handshake \| unavailable: \[describe_channel_unavailable\]/u);
    // The run waits for an approval nobody can send: it is stopped through the plugin and on the backend.
    expect(report).toMatch(/cancel r-[0-9a-f]{8} \(plugin\)/u);
    expect(report).toMatch(
      /description run [0-9a-f-]{36} was running: cancelled on the backend|sweep 1: no run of a description under way/u,
    );
  }, 300_000);

  it('a backend that repeats the password is masked by the plugin, so the gate passes', async () => {
    const { run, report } = await describeRun(['--fake-fault', 'describe-echo-password']);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(report).toMatch(/konto.*failed/u);
    expectNoPassword(run, report);
  }, 300_000);
});

/** A copy of the built server with one rule of the plugin switched off. */
async function brokenServer(from: string, to: string): Promise<string> {
  const source = await readFile(join(ROOT, 'dist', 'server.mjs'), 'utf8');
  expect(source.split(from).length - 1, `the built server holds ${from} once`).toBe(1);
  const dir = await scratch();
  const file = join(dir, 'server.mjs');
  await writeFile(file, source.replace(from, to));
  return file;
}

describe.concurrent(
  'npm run gate -- --fake --scenario describe --fake-server (the plugin shows the password)',
  () => {
    it('fails the gate on the password in an answer, and the report still does not show it', async () => {
      const server = await brokenServer('secrets: accountSecret,', '');
      const { run, report } = await describeRun([
        '--fake-fault',
        'describe-echo-password',
        '--fake-server',
        server,
      ]);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toContain('Result: **FAILED**');
      expect(report).toMatch(
        /Failed at step \d+ `flows_record_journeys` \(walk of the approved paths\): the password of the account is in 1 answer\(s\) of a tool/u,
      );
      expect(report).toMatch(/found in [1-9]\d* answer\(s\)/u);
      expectNoPassword(run, report);
    }, 300_000);

    it('a password in a request for help fails the gate instead of ending it as "needs a human"', async () => {
      const server = await brokenServer('secrets: accountSecret,', '');
      const { run, report } = await describeRun([
        '--fake-fault',
        'describe-help',
        '--fake-server',
        server,
      ]);
      expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
      expect(report).toContain('Result: **FAILED**');
      expect(report).toMatch(
        /Stopped by: the password of the account is in [1-9]\d* answer\(s\) and \d+ line\(s\) of the server log/u,
      );
      expectNoPassword(run, report);
    }, 300_000);
  },
);
