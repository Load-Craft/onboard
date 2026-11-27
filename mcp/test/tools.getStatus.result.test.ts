// `process_get_status` with `result`: the data a view is made from, for a result the model already has, as
// one JSON block (`format: "data"`). A client that draws results (the mod) reads it instead of the
// view. The data are the ones the tool computes for its own view: they are compared with the
// committed `*.view.json` of the golden corpus, never recomputed. Read-only, masked, bounded.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FlowOutline } from '../src/flow/outline.js';
import { capOutline, MAX_DATA_STEPS } from '../src/tools/flowsGet.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';
import { SKLEP_IDS } from './golden/index.js';
import {
  registerAnalysisReadRoute,
  registerErrorGroupsRoute,
} from './fake-backend/routes/analysis.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerResultRoutes } from './fake-backend/routes/results.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { registerExecutionRoutes } from './fake-backend/routes/executions.js';
import { registerDataRoutes } from './fake-backend/routes/data.js';
import {
  seedSklep,
  SKLEP_COLLECTIONS,
  type SklepExecutionResult,
} from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const NOW = Date.parse('2026-11-22T11:00:00Z');
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

async function rig(locale: 'en' | 'pl' = 'en'): Promise<ToolRig> {
  return toolRig({
    tools: [processGetStatus],
    world: (fake) => {
      registerLookupRoutes(fake);
      registerFlowRoutes(fake);
      registerDataRoutes(fake);
      registerExecutionRoutes(fake);
      registerStatusRoutes(fake);
      registerResultRoutes(fake);
      registerErrorGroupsRoute(fake);
      registerAnalysisReadRoute(fake);
      seedSklep(fake.store, { stage: 'executed' });
    },
    clock: createTestClock(NOW),
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
}

const view = (path: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'golden', `${path}.view.json`), 'utf8'));

async function data(r: ToolRig, result: unknown): Promise<unknown> {
  const answer = await r.call('process_get_status', { format: 'data', result });
  expect(answer.isError, answer.text).toBe(false);
  return JSON.parse(answer.text);
}

/** The perf run as the mock-up shows it: the four requests it lists, not the six of the world. */
function mockupRequests(r: ToolRig): void {
  const results = r.fake.store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results);
  const row = results.require(SKLEP_IDS.executionPerf);
  const wanted = ['POST /checkout', 'POST /cart/items', 'GET /products', 'GET /categories'];
  results.update(SKLEP_IDS.executionPerf, {
    endpoints: row.endpoints.filter((e) => wanted.includes(e.name)),
  });
}

describe('process_get_status with result: the data of the view', () => {
  it('gives the data of a report: the same as the golden view data', async () => {
    const r = await rig();
    mockupRequests(r);
    // The golden file keeps the rate rounded, as the view draws it; the data carry the exact one.
    const rounded = (report: unknown): unknown => {
      const copy = structuredClone(report) as { requests: { perSecond: number } };
      copy.requests.perSecond = Math.round(copy.requests.perSecond);
      return copy;
    };
    for (const id of ['e-3f9a12c4', SKLEP_IDS.executionPerf]) {
      expect(rounded(await data(r, { kind: 'report', id }))).toEqual(
        view('run1/11-results_get_report'),
      );
    }
  });

  it('gives the data of a diagnosis: the same as the golden view data', async () => {
    const r = await rig();
    // A stored analysis is returned as stored: the data say it was not run now.
    expect(await data(r, { kind: 'diagnosis', id: 'e-3f9a12c4' })).toEqual({
      ...(view('run1/12-results_analyze_run') as object),
      cached: true,
    });
  });

  it('gives the data of a flow: its outline and questions, by name or UUID', async () => {
    const r = await rig();
    const built = view('run1/04-flows_generate_from_suggestions') as { built: FlowOutline[] };
    for (const id of ['zakupy', SKLEP_IDS.flowZakupy]) {
      const got = (await data(r, { kind: 'flow', id })) as {
        project: { id: string };
        outline: FlowOutline;
        questions: unknown[];
      };
      expect(got.project.id).toBe(SKLEP_IDS.project);
      expect(got.outline).toEqual(built.built[0]);
      expect(Array.isArray(got.questions)).toBe(true);
    }
  });

  it('answers the same in either language: the data carry no wording', async () => {
    const en = await rig('en');
    const pl = await rig('pl');
    mockupRequests(en);
    mockupRequests(pl);
    const selector = { kind: 'report', id: 'e-3f9a12c4' };
    expect(await data(en, selector)).toEqual(await data(pl, selector));
  });

  it('reads only: no write, and nothing the backend would charge for', async () => {
    const r = await rig();
    await data(r, { kind: 'report', id: 'e-3f9a12c4' });
    await data(r, { kind: 'diagnosis', id: 'e-3f9a12c4' });
    await data(r, { kind: 'flow', id: 'zakupy' });
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('keeps the secret out of the answer', async () => {
    const r = await rig();
    const answer = await r.call('process_get_status', {
      format: 'data',
      result: { kind: 'report', id: 'e-3f9a12c4' },
    });
    expect(answer.text).not.toContain(CANARY);
    r.assertClean();
  });
});

describe('process_get_status with result: what it refuses, by name', () => {
  it('wants the data format: the view of a result is the result tool’s own', async () => {
    const r = await rig();
    const answer = await r.call('process_get_status', {
      result: { kind: 'report', id: 'e-3f9a12c4' },
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('[result_needs_data]');
  });

  it('names an unknown run, flow and kind', async () => {
    const r = await rig();
    const unknownRun = await r.call('process_get_status', {
      format: 'data',
      result: { kind: 'report', id: 'e-00000000' },
    });
    expect(unknownRun.isError).toBe(true);
    expect(unknownRun.text).toMatch(/^\[[a-z_]+\]/u);
    const unknownFlow = await r.call('process_get_status', {
      format: 'data',
      result: { kind: 'flow', id: 'nie-ma-takiego' },
    });
    expect(unknownFlow.isError).toBe(true);
    expect(unknownFlow.text).toMatch(/^\[[a-z_]+\]/u);
    const unknownKind = await r.call('process_get_status', {
      format: 'data',
      result: { kind: 'scenario', id: 'x' },
    });
    expect(unknownKind.isError).toBe(true);
  });

  it('says so when a diagnosis was never stored, and starts no analysis', async () => {
    const r = await rig();
    const analyses = r.fake.store.collection<{ id: string }>(SKLEP_COLLECTIONS.analyses);
    for (const row of analyses.list()) analyses.delete(row.id);
    const answer = await r.call('process_get_status', {
      format: 'data',
      result: { kind: 'diagnosis', id: 'e-3f9a12c4' },
    });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('[result_not_available]');
    expect(r.fake.calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });
});

describe('the size of the outline data', () => {
  const step = (index: number): FlowOutline['steps'][number] => ({
    num: String(index + 1),
    kind: 'request',
    blockType: 'request',
    depth: 0,
    name: `step ${index}`,
    method: 'GET',
    path: `/items/${index}`,
    uses: [],
    produces: [],
    feederVars: [],
    expectedStatuses: [],
    validators: [],
  });
  const outline = (count: number): FlowOutline => ({
    flowId: 'f',
    name: 'big',
    version: 1,
    stepCount: count,
    requestCount: count,
    pauseCount: 0,
    steps: Array.from({ length: count }, (_, index) => step(index)),
    truncated: false,
  });

  it('keeps the first steps up to the limit and says it cut', () => {
    const cut = capOutline(outline(250));
    expect(cut.steps).toHaveLength(MAX_DATA_STEPS);
    expect(cut.steps[0]?.num).toBe('1');
    expect(cut.stepCount).toBe(250);
    expect(cut.truncated).toBe(true);
  });

  it('leaves a short outline as it is', () => {
    const short = outline(7);
    expect(capOutline(short)).toBe(short);
  });
});
