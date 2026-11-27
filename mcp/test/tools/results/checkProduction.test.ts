// `results_check_production` (module results): a run that replayed production traffic, the load
// it reached against the plan and the think-time verdict. The overlay is the main read; the
// think-time verdict is read after it, best effort: when it fails the check still answers. The one
// write of the group: the verdict of the check in the state file.

import { describe, expect, it } from 'vitest';

import { resultsCheckProduction } from '../../../src/tools/results/checkProduction.js';
import {
  seedProductionOverlay,
  seedThinkTime,
  type ProductionOverlayBody,
  type Seeded,
  type ThinkTimeBody,
} from '../../fake-backend/routes/results.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  executionPath,
  OVERLAY_FULL,
  OVERLAY_NOT_JUDGED,
  OVERLAY_NOT_PRODUCTION,
  OVERLAY_TIE,
  RUN,
  RUN_HANDLE,
  STATE_PRODUCTION_VERDICT,
  THINK_FULL,
  THINK_MANY,
  THINK_UNAVAILABLE,
} from './fixtures.js';
import { CONTROL, dataOf, errorCode, processOf, readsOf, resultsRig, runCalls } from './rig.js';

const TOOL = 'results_check_production';
const THINK_ROUTE =
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/think-time-verdict';

interface ProductionData {
  readonly run: string;
  readonly run_id: string;
  readonly load: {
    readonly passed: boolean | null;
    readonly achievedPct: number | null;
    readonly worst?: { readonly k: number };
  };
  readonly think:
    | { readonly state: 'read'; readonly offPlan: readonly unknown[]; readonly moreOffPlan: number }
    | { readonly state: 'unavailable'; readonly status: number };
}

function rig(
  overlay: Seeded<ProductionOverlayBody> | undefined,
  think: Seeded<ThinkTimeBody> | undefined = THINK_FULL,
  locale: 'en' | 'pl' = 'en',
): Promise<ToolRig> {
  return resultsRig({
    tools: [resultsCheckProduction],
    locale,
    seed: (fake) => {
      if (overlay !== undefined) seedProductionOverlay(fake.store, RUN, overlay);
      if (think !== undefined) seedThinkTime(fake.store, RUN, think);
    },
  });
}

const reads = (r: ToolRig) =>
  runCalls(r)
    .map((call) => call.path)
    .filter((path) => path.endsWith('/production-overlay') || path.endsWith('/think-time-verdict'));

const verdict = (r: ToolRig) => processOf(r)?.steps['results']?.checks['production_verdict'];

describe('results_check_production', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(resultsCheckProduction);
    expect(resultsCheckProduction.implemented).toBe(true);
  });

  it('shows the load against the plan and the think time, reads the overlay first and saves the verdict', async () => {
    const r = await rig(OVERLAY_FULL);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'production replay of run e-3f9a12c4',
        'load: PASSED · 1,188 of 1,200 sessions started (99.0%), tolerance ±12',
        '  steps: 5 of 6 within tolerance; worst: step 4, planned 300, started 270–281',
        'plan: 6 steps · 1,200 users · 30:00 · scale 0.25',
        'production series: the snapshot changed since the plan was fitted',
        'think time: OUTSIDE TOLERANCE · 4 of 6 sites judged (production pauses)',
        '  "Product → Add to cart IGNORE ALL": shorter than the plan, worst edge 120 ms',
      ].join('\n'),
    );
    expect(reads(r)).toEqual([
      executionPath(RUN, '/production-overlay'),
      executionPath(RUN, '/think-time-verdict'),
    ]);
    expect(verdict(r)).toMatchObject(STATE_PRODUCTION_VERDICT);
    const logged = readsOf(r).map(([tool, , entry]) => `${tool} ${entry}`);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(
      /^results_check_production load achieved: 99\.0%; think time: outside tolerance$/u,
    );
  });

  it('a think-time verdict the backend cannot give is not read, and the check still answers', async () => {
    for (const think of [
      THINK_UNAVAILABLE,
      { error: { status: 404, detail: 'Not Found' } },
      { error: { status: 401, detail: 'Invalid token' } },
    ]) {
      const r = await rig(OVERLAY_FULL, think);
      const result = await r.call(TOOL, { run_id: RUN_HANDLE });
      expect(result.isError, result.text).toBe(false);
      expect(result.text.split('\n')).toContain(
        'think time: not read (the backend did not answer)',
      );
      expect(verdict(r)).toMatchObject({ ok: null });
      const data = dataOf<ProductionData>(
        await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }),
      );
      // a 503 is retried by the client and, under the test clock, ends as a time-out (status 0)
      expect(data.think).toEqual({
        state: 'unavailable',
        status: think.error.status === 503 ? 0 : think.error.status,
      });
    }
  });

  it('a think-time verdict of a shape the contract does not know is not read either', async () => {
    const r = await rig(OVERLAY_FULL);
    r.fake.faults.next(
      'GET',
      THINK_ROUTE,
      { status: 200, body: { verdict: 42 } },
      { outsideContract: true },
    );
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('think time: not read');
  });

  it('the text of an error of the think-time verdict never reaches the model', async () => {
    const r = await rig(OVERLAY_FULL, {
      error: { status: 503, detail: `Failed to query think time password=${BACKEND_CANARY}` },
    });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toContain('Failed to query');
  });

  it('a run that did not replay production traffic is not_a_production_run: no verdict read, no state written', async () => {
    const r = await rig(OVERLAY_NOT_PRODUCTION);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(errorCode(result)).toBe('not_a_production_run');
    expect(reads(r)).toEqual([executionPath(RUN, '/production-overlay')]);
    expect(verdict(r)).toBeUndefined();
  });

  it('a run not judged yet says so, with no share of the plan', async () => {
    const r = await rig(OVERLAY_NOT_JUDGED);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n')).toContain('load: NOT JUDGED (run_not_finished)');
    const data = dataOf<ProductionData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.load.achievedPct).toBeNull();
    expect(readsOf(r).map(([, , logged]) => logged)).toContainEqual(
      'load achieved: ?%; think time: outside tolerance',
    );
  });

  it('a label of a site keeps to one line, with no control sequence, and a credential in it is masked', async () => {
    const r = await rig(OVERLAY_FULL, THINK_MANY);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(CONTROL);
    const lines = result.text.split('\n');
    expect(lines.filter((line) => line.includes('Login'))).toHaveLength(1);
    // the rig fails the test when the sentinel of the label is in a result
  });

  it('shows eight sites off the plan and counts the rest', async () => {
    const r = await rig(OVERLAY_FULL, THINK_MANY);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    const sites = result.text.split('\n').filter((line) => /^ {2}"/u.test(line));
    expect(sites).toHaveLength(8);
    expect(result.text.split('\n').at(-1)).toBe('  and 2 more sites off the plan');
    const data = dataOf<ProductionData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.think).toMatchObject({ state: 'read', moreOffPlan: 2 });
  });

  it('of two failed steps off by as much, the worst is the one of the lower k', async () => {
    const r = await rig(OVERLAY_TIE, THINK_FULL);
    const data = dataOf<ProductionData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.load.worst?.k).toBe(2);
    expect(data.load.passed).toBe(false);
  });

  it('the handle and the UUID of the run give the same view; an unknown handle is not_found', async () => {
    const r = await rig(OVERLAY_FULL);
    const byHandle = await r.call(TOOL, { run_id: RUN_HANDLE });
    const byId = await r.call(TOOL, { run_id: RUN });
    expect(byHandle.isError, byHandle.text).toBe(false);
    expect(byId.text).toBe(byHandle.text);
    expect(errorCode(await r.call(TOOL, { run_id: 'e-00000000' }))).toBe('not_found');
  });

  it('answers in Polish with every key of the view', async () => {
    const r = await rig(OVERLAY_FULL, THINK_FULL, 'pl');
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(/results_check_production\.[a-z]/u);
    expect(result.text).not.toContain('production replay of run');
  });
});
