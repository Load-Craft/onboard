// The verdict of a test run on the stand-alone fake backend (`npm run fake -- --run <mode>`):
// `pass` ends every started run as SLA PASSED and `fail` as SLA FAILED against the thresholds sent
// with run_start, on the sklep document and on documentation of another application; `none` (the
// default) leaves the verdict to the world's own numbers. The tools are called through the MCP
// client on one state, the way a model calls them.

import { describe, expect, it, vi } from 'vitest';

import { ALL_TOOLS } from '../../src/tools/index.js';
import { RUN_MODES, setupStandalone, type RunMode } from '../fake-backend/standalone.js';
import { createTestClock, settleClock } from '../helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from '../helpers/rig.js';
import { handleFromText, runSetup, sklepOpenapi, START } from './driver.js';

vi.setConfig({ testTimeout: 60_000 });

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
];
const PACE = { stepMs: 10_000, limitMs: 3_600_000 } as const;

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

async function rigOf(openapi: string | object, run: RunMode | undefined): Promise<ToolRig> {
  const clock = createTestClock(START);
  return toolRig({
    tools: ALL_TOOLS,
    clock,
    world: (fake) => {
      setupStandalone(fake, clock, { stage: 'empty', ...(run === undefined ? {} : { run }) });
    },
    fake: { meta: { capabilities: ['meta', 'provision_environment'] } },
    env: { LOADCRAFT_LOCALE: 'pl' },
    files: {
      'loadcraft/openapi.json': typeof openapi === 'string' ? openapi : JSON.stringify(openapi),
    },
  });
}

interface Thresholds {
  readonly p95_ms?: number;
  readonly error_rate_pct?: number;
}

/** Steps 1 to 8 on a browsing journey (no accounts needed); returns the report and the diagnosis. */
async function session(
  rig: ToolRig,
  journey: string,
  thresholds: Thresholds | undefined,
): Promise<{ report: string; diagnosis: string }> {
  await runSetup((tool, args) => step(rig, tool, args), {
    name: 'projekt',
    openapi: 'loadcraft/openapi.json',
    environments: ENVIRONMENTS,
  });
  await step(rig, 'flows_suggest_journeys', {});
  await step(rig, 'flows_generate_from_suggestions', { suggestions: [journey] });
  await step(rig, 'scenario_suggest_split', { name: 'przeglad', flows: [journey] });
  await step(rig, 'scenario_generate', {
    name: 'przeglad',
    proportions: { [journey]: 100 },
    data_mix: 'normal',
  });
  const run = await step(rig, 'run_start', {
    scenario: 'przeglad',
    environment: 'perf',
    profile: { type: 'ramp_concurrency', vusers: 100, ramp: 120 },
    ...(thresholds === undefined ? {} : { thresholds }),
  });
  const execution = /\be-[0-9a-f]{8}\b/u.exec(run.text)?.[0];
  expect(execution, run.text).toBeDefined();
  const report = await step(rig, 'results_get_report', { execution });
  const diagnosis = await step(rig, 'results_analyze_run', { execution, force: true });
  rig.assertClean();
  return { report: report.text, diagnosis: diagnosis.text };
}

const op = (operationId: string, summary: string, tag: string) => ({
  operationId,
  summary,
  tags: [tag],
  responses: { '200': { description: 'OK' } },
});

/** Another application's documentation: a small lending library. */
const LIBRARY_OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'Library API', version: '1.4.0', 'x-loadcraft-source': { commit: '9c1d2e3' } },
  paths: {
    '/api/v1/auth/login': { post: op('logIn', 'Log in', 'auth') },
    '/api/v1/books': { get: op('listBooks', 'List books', 'books') },
    '/api/v1/books/{bookId}': { get: op('getBook', 'Get a book', 'books') },
    '/api/v1/loans': {
      get: op('listLoans', 'List my loans', 'loans'),
      post: op('borrowBook', 'Borrow a book', 'loans'),
    },
    '/api/v1/account': { get: op('getAccount', 'My account', 'account') },
  },
};

const DOCUMENTS = [
  ['the sklep document', sklepOpenapi(), 'przeglądanie'],
  ['documentation of another application', LIBRARY_OPENAPI, 'browse books'],
] as const;

describe('--run on the stand-alone fake', () => {
  it('lists none, pass and fail, none first', () => {
    expect(RUN_MODES).toEqual(['none', 'pass', 'fail']);
  });

  for (const [label, document, journey] of DOCUMENTS) {
    describe(label, () => {
      it('pass: SLA PASSED against the thresholds of run_start', async () => {
        const rig = await rigOf(document, 'pass');
        const { report } = await session(rig, journey, { p95_ms: 400, error_rate_pct: 1 });
        expect(report).toMatch(/SLA PASSED/u);
        expect(report).not.toMatch(/SLA FAILED/u);
      });

      it('pass: SLA PASSED also with a tight p95 and with no thresholds', async () => {
        const tight = await session(await rigOf(document, 'pass'), journey, { p95_ms: 90 });
        expect(tight.report).toMatch(/SLA PASSED/u);
        const errors = await session(await rigOf(document, 'pass'), journey, {
          error_rate_pct: 0.5,
        });
        expect(errors.report).toMatch(/SLA PASSED/u);
        const none = await session(await rigOf(document, 'pass'), journey, undefined);
        expect(none.report).toMatch(/SLA PASSED/u);
      });

      it('fail: SLA FAILED and a diagnosis that names a request', async () => {
        const rig = await rigOf(document, 'fail');
        const { report, diagnosis } = await session(rig, journey, {
          p95_ms: 5000,
          error_rate_pct: 20,
        });
        expect(report).toMatch(/SLA FAILED/u);
        expect(report).not.toMatch(/SLA PASSED/u);
        expect(diagnosis).toMatch(/(GET|POST|PUT) \/\S+/u);
      });

      it('fail: SLA FAILED on either threshold alone, however loose', async () => {
        for (const thresholds of [{ p95_ms: 5000 }, { error_rate_pct: 20 }]) {
          const { report } = await session(await rigOf(document, 'fail'), journey, thresholds);
          expect(report, JSON.stringify(thresholds)).toMatch(/SLA FAILED/u);
        }
      });

      it('fail: SLA FAILED with no thresholds', async () => {
        const { report } = await session(await rigOf(document, 'fail'), journey, undefined);
        expect(report).toMatch(/SLA FAILED/u);
      });
    });
  }

  it('none keeps the verdict to the thresholds, over the numbers of the world', async () => {
    const strict = await session(await rigOf(LIBRARY_OPENAPI, 'none'), 'browse books', {
      p95_ms: 50,
    });
    expect(strict.report).toMatch(/SLA FAILED/u);
    const loose = await session(await rigOf(LIBRARY_OPENAPI, undefined), 'browse books', {
      p95_ms: 60_000,
    });
    // The world's own numbers meet a loose threshold but keep their 503s on the slowest request.
    expect(loose.report).toMatch(/progi\s+p95 \d+ ms < [^\n]*✓/u);
    expect(loose.report).toMatch(/503/u);
  });
});
