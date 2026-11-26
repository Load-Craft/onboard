// A run of the stand-alone fake backend (`npm run fake`) on API documentation that is not the
// `sklep` world's: a small invented lending library. The fake builds its world from the uploaded
// document, so every step of the run, from the project to the diagnosis, answers with the
// operations of that document. The tools are called through the MCP client on one state, the way
// a model calls them: the handle of a long step is read from the text and given to `process_wait`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/index.js';
import { setupStandalone } from '../fake-backend/standalone.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from '../helpers/rig.js';
import { handleFromText, runSetup, sklepOpenapi, START } from './driver.js';

vi.setConfig({ testTimeout: 60_000 });

const op = (operationId: string, summary: string, tag?: string) => ({
  operationId,
  summary,
  ...(tag === undefined ? {} : { tags: [tag] }),
  responses: { '200': { description: 'OK' } },
});

/** Sixteen operations in seven areas, under a versioned prefix; `/health` has no tag. */
export const LIBRARY_OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'Library API',
    version: '1.4.0',
    'x-loadcraft-source': { commit: '9c1d2e3' },
  },
  paths: {
    '/api/v1/auth/login': { post: op('logIn', 'Log in', 'auth') },
    '/api/v1/auth/logout': { post: op('logOut', 'Log out', 'auth') },
    '/api/v1/members': { post: op('joinLibrary', 'Join the library', 'members') },
    '/api/v1/books': { get: op('listBooks', 'List books', 'books') },
    '/api/v1/books/{bookId}': { get: op('getBook', 'Get a book', 'books') },
    '/api/v1/books/{bookId}/reviews': {
      get: op('listReviews', 'List reviews of a book', 'reviews'),
      post: op('addReview', 'Review a book', 'reviews'),
    },
    '/api/v1/authors': { get: op('listAuthors', 'List authors', 'authors') },
    '/api/v1/authors/{authorId}': { get: op('getAuthor', 'Get an author', 'authors') },
    '/api/v1/loans': {
      get: op('listLoans', 'List my loans', 'loans'),
      post: op('borrowBook', 'Borrow a book', 'loans'),
    },
    '/api/v1/loans/{loanId}': {
      put: op('extendLoan', 'Extend a loan', 'loans'),
      delete: op('returnBook', 'Return a book', 'loans'),
    },
    '/api/v1/account': {
      get: op('getAccount', 'My account', 'account'),
      put: op('updateAccount', 'Update my account', 'account'),
    },
    '/api/v1/health': { get: op('health', 'Health check') },
  },
};

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
];

const PACE = { stepMs: 10_000, limitMs: 3_600_000 } as const;

/** Calls a tool and follows its handle with `process_wait` until the step is over, as a model does. */
async function step(
  rig: ToolRig,
  tool: string,
  args: Record<string, unknown>,
): Promise<RigCallResult> {
  let last = await settleClock(rig, rig.call(tool, args), PACE);
  for (let again = 0; again < 20; again += 1) {
    if (last.isError || last.outcome === undefined || last.outcome.status === 'done') break;
    const handle = handleFromText(last.text);
    if (handle === undefined)
      throw new Error(`${tool}: unfinished without a handle:\n${last.text}`);
    last = await settleClock(rig, rig.call('process_wait', { operation: handle }), PACE);
  }
  expect(last.isError, `${tool}: ${last.text}`).toBe(false);
  return last;
}

/** The stand-alone fake from an empty instance, with `openapi` as the repository's document. */
async function standaloneRig(openapi: string = JSON.stringify(LIBRARY_OPENAPI)): Promise<ToolRig> {
  const clock = createTestClock(START);
  return toolRig({
    tools: ALL_TOOLS,
    clock,
    world: (fake) => {
      setupStandalone(fake, clock, { stage: 'empty' });
    },
    fake: {
      meta: {
        capabilities: [
          'meta',
          'provision_environment',
          'provision_register_operation',
          'provision_protected_confirmation',
        ],
      },
    },
    env: { LOADCRAFT_LOCALE: 'pl' },
    files: { 'loadcraft/openapi.json': openapi },
  });
}

describe('the stand-alone fake on documentation of another application', () => {
  it('runs steps 1 to 8 with the operations of the uploaded document', async () => {
    const rig = await standaloneRig();

    await step(rig, 'process_get_status', {});
    await runSetup((tool, args) => step(rig, tool, args), {
      name: 'biblioteka',
      openapi: 'loadcraft/openapi.json',
      environments: ENVIRONMENTS,
    });

    // Step 3: journeys built from the tags and paths of the document, no model involved.
    const journeys = await step(rig, 'flows_suggest_journeys', {});
    for (const name of ['browse books', 'create loans', 'account']) {
      expect(journeys.text).toContain(name);
    }
    expect(journeys.text).not.toContain('zakupy');

    const flows = await step(rig, 'flows_generate_from_suggestions', {
      suggestions: ['browse books', 'create loans', 'account'],
    });
    expect(flows.text).not.toContain('zakupy');

    // Step 4: the split, then the scenarios; the ones that log in wait for accounts.
    await step(rig, 'scenario_suggest_split', {
      name: 'wypozyczenia',
      flows: ['browse books', 'create loans', 'account'],
    });
    const scenarios = await step(rig, 'scenario_generate', {
      name: 'wypozyczenia',
      proportions: { 'browse books': 50, 'create loans': 30, account: 20 },
      data_mix: 'normal',
    });
    expect(scenarios.text).toContain('czeka na dane');
    expect(scenarios.text).toContain('List books');
    expect(scenarios.text).not.toMatch(/categories|kategorie/u);

    // Step 5: the accounts slot of the scenarios that log in.
    const plan = await step(rig, 'data_check_readiness', { scenario: 'wypozyczenia' });
    expect(plan.text).toContain('accounts');
    const provisioned = await step(rig, 'data_create_accounts', {
      scenario: 'wypozyczenia',
      slot: 'accounts',
      count: 100,
    });
    expect(provisioned.text).toContain('POST /api/v1/members');
    expect(provisioned.text).not.toMatch(/\/auth\/register|konta/u);

    // The checks of the scenarios that waited for data now pass, step by step of their flows.
    const checks = await step(rig, 'scenario_check_self', {
      scenarios: ['create loans', 'account'],
    });
    expect(checks.text).toContain('Log in');
    expect(checks.text).toContain('Borrow a book');
    expect(checks.text).not.toContain('czeka na dane');

    // Steps 6 to 8: the test, its report and its diagnosis name the operations of the document.
    const run = await step(rig, 'run_start', {
      scenario: 'wypozyczenia',
      environment: 'perf',
      profile: { type: 'ramp_concurrency', vusers: 100, ramp: 120 },
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
    });
    const execution = /\be-[0-9a-f]{8}\b/u.exec(run.text)?.[0];
    expect(execution, run.text).toBeDefined();

    const report = await step(rig, 'results_get_report', { execution });
    expect(report.text).toContain('POST /api/v1/loans');
    expect(report.text).toMatch(/2 min · planowane 0 → 100/u);
    expect(report.text).not.toContain('/checkout');

    const diagnosis = await step(rig, 'results_analyze_run', { execution, force: true });
    expect(diagnosis.text).toMatch(/\/api\/v1\//u);
    expect(diagnosis.text).not.toContain('/checkout');

    rig.assertClean();
  });

  it('keeps the proposals of the sklep world for the sklep document', async () => {
    const rig = await standaloneRig(sklepOpenapi());
    await runSetup((tool, args) => step(rig, tool, args), {
      name: 'sklep',
      openapi: 'loadcraft/openapi.json',
      environments: ENVIRONMENTS,
    });
    const journeys = await step(rig, 'flows_suggest_journeys', {});
    for (const name of ['zakupy', 'przeglądanie', 'konto', 'status zamówienia']) {
      expect(journeys.text).toContain(name);
    }
    expect(journeys.text).not.toContain('browse');

    // Each scenario gets its own check: the ones that log in wait for accounts.
    await step(rig, 'flows_generate_from_suggestions', {
      suggestions: ['zakupy', 'przeglądanie', 'konto'],
    });
    const scenarios = await step(rig, 'scenario_generate', {
      name: 'checkout',
      proportions: { zakupy: 50, przeglądanie: 40, konto: 10 },
      data_mix: 'normal',
    });
    expect(scenarios.text).toMatch(/zakupy +czeka na dane/u);
    expect(scenarios.text).toMatch(/konto +czeka na dane/u);
    expect(scenarios.text).toMatch(/przeglądanie +kategorie ✓ → produkt ✓/u);
  });

  it('takes the document of the evals fixture as it is and proposes journeys from it', async () => {
    const fixture = resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'evals',
      'fixtures',
      'sklep',
      'loadcraft',
      'openapi.json',
    );
    const rig = await standaloneRig(readFileSync(fixture, 'utf8'));
    await runSetup((tool, args) => step(rig, tool, args), {
      name: 'sklep',
      openapi: 'loadcraft/openapi.json',
      environments: ENVIRONMENTS,
    });
    const journeys = await step(rig, 'flows_suggest_journeys', {});
    expect(journeys.text).toContain('browse products');
    expect(journeys.text).toContain('create cart');
  });
});
