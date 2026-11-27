// The routes of the fake backend for the tools of module results serve the shared fixtures within
// the contract: every seeded body passes the check of its operation, an unseeded run answers as the
// backend answers a run without it, and a seeded error is sent as seeded.

import { describe, expect, it } from 'vitest';

import { seedComparison } from '../../fake-backend/routes/compare.js';
import {
  registerResultRoutes,
  seedBaseline,
  seedLogs,
  seedProductionOverlay,
  seedReport,
  seedRequestDetail,
  seedThinkTime,
} from '../../fake-backend/routes/results.js';
import { startFake, type Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { createTestClock } from '../../helpers/clock.js';
import {
  BASELINE_CONFLICT,
  BASELINE_ESTABLISHED,
  BASELINE_SELF,
  BASELINE_UNMEASURED,
  COMPARE_NO_RESULT,
  COMPARE_NOT_COMPARABLE,
  COMPARE_SYNTHETIC,
  executionPath,
  LOGS_EMPTY_OLD,
  LOGS_FULL,
  LOGS_LEVEL_MIX,
  LOGS_ODD,
  LOGS_SECRET,
  LOGS_SECRET_LATE,
  OTHER,
  OVERLAY_FULL,
  OVERLAY_NOT_JUDGED,
  OVERLAY_NOT_PRODUCTION,
  OVERLAY_TIE,
  PROJECT,
  REPORT_FILES,
  REQUEST_FULL,
  REQUEST_HOSTILE,
  REQUEST_SECRET,
  REQUEST_UNMEASURED,
  RUN,
  THINK_FULL,
  THINK_MANY,
  THINK_UNAVAILABLE,
  THINK_WITHIN,
} from './fixtures.js';

async function fake(): Promise<Fake> {
  const f = await startFake({ clock: createTestClock(Date.parse('2026-11-26T12:00:00Z')) });
  seedSklep(f.store, { stage: 'executed' });
  registerResultRoutes(f);
  return f;
}

async function get(
  f: Fake,
  path: string,
): Promise<{ status: number; body: unknown; type: string }> {
  const response = await fetch(new URL(path, f.url), {
    headers: { authorization: `Bearer ${f.token}` },
    redirect: 'manual',
  });
  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  return {
    status: response.status,
    body: type.startsWith('application/json') ? JSON.parse(text) : text,
    type,
  };
}

describe('fake backend routes of module results', () => {
  it('serves every seeded detail, log, overlay, verdict and baseline within the contract', async () => {
    const f = await fake();
    const bodies = [REQUEST_FULL, REQUEST_UNMEASURED, REQUEST_HOSTILE, REQUEST_SECRET];
    bodies.forEach((body, i) => {
      seedRequestDetail(f.store, RUN, `R${String(i)}`, body);
    });
    for (const [i, body] of bodies.entries()) {
      const answer = await get(f, executionPath(RUN, `/endpoints/R${String(i)}`));
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual(body);
    }
    for (const body of [LOGS_FULL, LOGS_SECRET, LOGS_SECRET_LATE, LOGS_ODD, LOGS_EMPTY_OLD]) {
      seedLogs(f.store, RUN, body);
      expect((await get(f, executionPath(RUN, '/logs?limit=50'))).body).toEqual(body);
    }
    for (const body of [OVERLAY_FULL, OVERLAY_NOT_JUDGED, OVERLAY_TIE]) {
      seedProductionOverlay(f.store, RUN, body);
      expect((await get(f, executionPath(RUN, '/production-overlay'))).body).toEqual(body);
    }
    for (const body of [THINK_FULL, THINK_WITHIN, THINK_MANY]) {
      seedThinkTime(f.store, RUN, body);
      expect((await get(f, executionPath(RUN, '/think-time-verdict'))).body).toEqual(body);
    }
    for (const body of [BASELINE_ESTABLISHED, BASELINE_SELF, BASELINE_UNMEASURED]) {
      seedBaseline(f.store, RUN, body);
      expect((await get(f, executionPath(RUN, '/baseline'))).body).toEqual(body);
    }
    for (const body of [COMPARE_SYNTHETIC, COMPARE_NOT_COMPARABLE]) {
      seedComparison(f.store, OTHER, RUN, body);
      const answer = await get(
        f,
        `/api/v1/projects/${PROJECT}/gatling/executions/compare?a=${OTHER}&b=${RUN}`,
      );
      expect(answer.body).toEqual(body);
    }
    await f.close();
  });

  it('answers an unseeded run as the backend answers a run without it', async () => {
    const f = await fake();
    expect((await get(f, executionPath(RUN, '/endpoints/GET%20%2Fnope'))).status).toBe(404);
    expect((await get(f, executionPath(RUN, '/logs?limit=50'))).body).toEqual({
      logs: [],
      logs_window_start: null,
      logs_window_end: null,
      logs_retention: null,
      logs_source: 'loki',
      series_source: 'absent_unmeasured',
      series_retention: null,
    });
    // a level outside the four words is refused before the log store is asked
    expect((await get(f, executionPath(RUN, '/logs?level=fatal'))).status).toBe(422);
    expect(await get(f, executionPath(RUN, '/production-overlay'))).toMatchObject({
      status: 404,
      body: { detail: { error: 'not_a_production_run' } },
    });
    expect((await get(f, executionPath(RUN, '/report/index.html'))).status).toBe(404);
    expect((await get(f, executionPath(RUN, '/baseline'))).body).toMatchObject({
      state: 'not_established',
      baseline: null,
    });
    // an unknown run and a run of another project answer one 404 on every result route
    for (const tail of ['/logs', '/result', '/errors', '/endpoints']) {
      expect(
        await get(f, executionPath('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', tail)),
        tail,
      ).toMatchObject({
        status: 404,
        body: { detail: 'Execution 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d not found' },
      });
    }
    await f.close();
  });

  it('sends a seeded error as seeded', async () => {
    const f = await fake();
    seedProductionOverlay(f.store, RUN, OVERLAY_NOT_PRODUCTION);
    seedThinkTime(f.store, RUN, THINK_UNAVAILABLE);
    seedBaseline(f.store, RUN, BASELINE_CONFLICT);
    seedComparison(f.store, OTHER, RUN, COMPARE_NO_RESULT);
    expect((await get(f, executionPath(RUN, '/production-overlay'))).body).toEqual({
      detail: OVERLAY_NOT_PRODUCTION.error.detail,
    });
    expect((await get(f, executionPath(RUN, '/think-time-verdict'))).status).toBe(503);
    expect((await get(f, executionPath(RUN, '/baseline'))).status).toBe(409);
    const compare = await get(
      f,
      `/api/v1/projects/${PROJECT}/gatling/executions/compare?a=${OTHER}&b=${RUN}`,
    );
    expect(compare.status).toBe(404);
    await f.close();
  });

  it('serves the files of a report by their path, with the media type of their extension', async () => {
    const f = await fake();
    seedReport(f.store, RUN, REPORT_FILES);
    const index = await get(f, executionPath(RUN, '/report/index.html'));
    expect(index).toMatchObject({ status: 200, body: REPORT_FILES['index.html'] });
    expect(index.type).toMatch(/^text\/html/u);
    const css = await get(f, executionPath(RUN, '/report/style/style.css'));
    expect(css).toMatchObject({ status: 200, body: REPORT_FILES['style/style.css'] });
    expect((await get(f, executionPath(RUN, '/report/missing.html'))).status).toBe(404);
    expect((await get(f, executionPath(RUN, '/report/style%2F..%2F..%2Fx'))).status).toBe(400);
    await f.close();
  });

  it('filters the log lines by level and cuts them at the limit, as the log store does', async () => {
    const f = await fake();
    seedLogs(f.store, RUN, LOGS_LEVEL_MIX);
    const errors = await get(f, executionPath(RUN, '/logs?limit=50&level=error'));
    expect(errors.body).toMatchObject({ logs: [{ message: '[ERROR] boom' }] });
    seedLogs(f.store, RUN, LOGS_FULL);
    const two = await get(f, executionPath(RUN, '/logs?limit=2'));
    expect((two.body as { logs: unknown[] }).logs).toHaveLength(2);
    await f.close();
  });
});
