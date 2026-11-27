// Result routes of the fake backend, over the executions and results of the sklep world: the run
// detail (`GET …/gatling/executions/{id}`, the facts the verdict is made of) and the stored result
// with its time series (`GET …/gatling/executions/{id}/result`). The request rows
// (`…/endpoints`) and the error groups (`…/errors`) are registered by their own sets, which this
// one calls, so a test that needs the whole report registers one function. Registration is
// idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store, SuccessBody } from '../server.js';
import { FakeHttpError } from '../server.js';
import {
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from '../worlds/sklep.js';
import { registerErrorGroupsRoute } from './analysis.js';
import { requireExecution, requireRun } from './executionOwner.js';
import { registerCompareRoute } from './compare.js';
import { registerSelfCheckRoutes } from './selfCheck.js';

const registered = new WeakSet<Fake>();

/**
 * `GET …/gatling/executions/{id}` and
 * `GET …/gatling/executions/{id}/result` (404 `No results
 * found for execution {id}` while the run has no stored result). The routes of the request rows
 * and of the error groups are registered with them.
 */
export function registerResultRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerSelfCheckRoutes(fake);
  registerErrorGroupsRoute(fake);
  registerCompareRoute(fake);
  registerResultModuleRoutes(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}',
    (req, store) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, `Project not found: ${req.params.project_id}`);
      const execution = store
        .collection<SklepExecution>(SKLEP_COLLECTIONS.executions)
        .require(req.params.execution_id, `Execution ${req.params.execution_id} not found`);
      return { status: 200, body: { ...execution } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/result',
    (req, store) => {
      const id = req.params.execution_id;
      requireRun(store, id, req.params.project_id);
      const result = store.collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results).get(id);
      if (result === undefined) {
        throw new FakeHttpError(404, { detail: `No results found for execution ${id}` });
      }
      return {
        status: 200,
        body: { ...result, peak_active_users: result.peak_active_users ?? null },
      };
    },
  );
}

// ---- the routes of the module results (src/tools/results/) ---------------------------------
//
// Each reads its own collection, filled by a seeding function of this file; a run with nothing
// seeded answers as the backend answers a run that has none of it. An error a test wants (a 404
// with a coded detail, a 409, a 503) is seeded as `{ error: { status, detail } }`.

type ExecutionPath<S extends string> =
  `/api/v1/projects/{project_id}/gatling/executions/{execution_id}${S}`;

/** The detail of one request of a run (`GET …/endpoints/{name}`). */
export type RequestDetailBody = SuccessBody<ExecutionPath<'/endpoints/{name}'>, 'GET'>;
/** The log lines of a run (`GET …/logs`). */
export type LogsBody = SuccessBody<ExecutionPath<'/logs'>, 'GET'>;
export type ProductionOverlayBody = components['schemas']['ProductionOverlay'];
export type ThinkTimeBody = components['schemas']['RunThinkTimeVerdict'];
export type BaselineBody = components['schemas']['ExecutionBaselineResponse'];

/** An error answer a test seeds in place of a body. */
export interface SeededError {
  readonly error: { readonly status: number; readonly detail: unknown };
}

export type Seeded<T> = T | SeededError;

function isSeededError<T>(value: Seeded<T>): value is SeededError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/** The answer of a seeded record: its body, or the error seeded in its place. */
function answer<T>(value: Seeded<T>): { status: 200; body: T } {
  if (isSeededError(value)) {
    throw new FakeHttpError(value.error.status, { detail: value.error.detail });
  }
  return { status: 200, body: value };
}

interface StoredValue<T> {
  readonly id: string;
  readonly value: T;
}

export const RESULT_MODULE_COLLECTIONS = {
  requests: 'results_request_details',
  logs: 'results_logs',
  reports: 'results_report_files',
  overlays: 'results_production_overlays',
  thinkTimes: 'results_think_time_verdicts',
  baselines: 'results_baselines',
  baselinePairs: 'results_baseline_pairs',
  reportDelays: 'results_report_delays',
} as const;

function put<T>(store: Store, collection: string, id: string, value: T): void {
  const records = store.collection<StoredValue<T>>(collection);
  records.delete(id);
  records.insert({ id, value });
}

function seeded<T>(store: Store, collection: string, id: string): T | undefined {
  return store.collection<StoredValue<T>>(collection).get(id)?.value;
}

/** The detail of the request `name` of a run, or an error in its place. */
export function seedRequestDetail(
  store: Store,
  executionId: string,
  name: string,
  body: Seeded<RequestDetailBody>,
): void {
  put(store, RESULT_MODULE_COLLECTIONS.requests, `${executionId}\n${name}`, body);
}

/** The log lines of a run, in the order the backend returns them, or an error in their place. */
export function seedLogs(store: Store, executionId: string, body: Seeded<LogsBody>): void {
  put(store, RESULT_MODULE_COLLECTIONS.logs, executionId, body);
}

/** The archived report of a run: its files by path inside the report (`index.html`, `js/stats.js`). */
export function seedReport(
  store: Store,
  executionId: string,
  files: Readonly<Record<string, string | Buffer>>,
): void {
  put(store, RESULT_MODULE_COLLECTIONS.reports, executionId, files);
}

/**
 * The file `path` of the report of a run is answered `ms` milliseconds late (real time): a read
 * still in flight when another read of the same export fails.
 */
export function delayReportFile(store: Store, executionId: string, path: string, ms: number): void {
  put(store, RESULT_MODULE_COLLECTIONS.reportDelays, `${executionId}\n${path}`, ms);
}

export function seedProductionOverlay(
  store: Store,
  executionId: string,
  body: Seeded<ProductionOverlayBody>,
): void {
  put(store, RESULT_MODULE_COLLECTIONS.overlays, executionId, body);
}

export function seedThinkTime(
  store: Store,
  executionId: string,
  body: Seeded<ThinkTimeBody>,
): void {
  put(store, RESULT_MODULE_COLLECTIONS.thinkTimes, executionId, body);
}

export function seedBaseline(store: Store, executionId: string, body: Seeded<BaselineBody>): void {
  put(store, RESULT_MODULE_COLLECTIONS.baselines, executionId, body);
}

/** The fake keeps one pair (scenario and load) for every run of its world: the runs compared with each other. */
const THE_PAIR = 'pair';

/**
 * Makes `baselineId` the baseline of the pair, as a pin does: every run then reads it back, in
 * place of its seeded answer. `executionId` must be a run of the world.
 */
export function seedBaselinePair(store: Store, executionId: string, baselineId: string): void {
  requireExecution(store, executionId);
  put(store, RESULT_MODULE_COLLECTIONS.baselinePairs, THE_PAIR, baselineId);
}

/** The run the pair of `executionId` points at, or undefined while nothing was pinned on the fake. */
export function pinnedBaselineOf(store: Store, executionId: string): string | undefined {
  requireExecution(store, executionId);
  return seeded<string>(store, RESULT_MODULE_COLLECTIONS.baselinePairs, THE_PAIR);
}

/** The media type of a report file, from its extension, as the backend sends it. */
const REPORT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  json: 'application/json',
};

function reportType(path: string): string {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(path)?.[1]?.toLowerCase() ?? '';
  return REPORT_TYPES[extension] ?? 'application/octet-stream';
}

/** The run of the project, or the 404 the backend sends for one it does not have. */

/**
 * The line filter of the log store: a line of level `level` names it in its text (`[ERROR] …`) or
 * in its `level` label, whatever the case.
 */
function hasLevel(line: LogsBody['logs'][number], level: string): boolean {
  const wanted = level.toLowerCase();
  return line.labels.level?.toLowerCase() === wanted || line.message.toLowerCase().includes(wanted);
}

/** The levels the log route takes (the enum of its `level` in the contract); any other is a 422. */
const LOG_LEVELS: ReadonlySet<string> = new Set(['error', 'warn', 'info', 'debug']);

const moduleRegistered = new WeakSet<Fake>();

/**
 * The routes the tools of module results read and no other file answers: the detail of one
 * request, the log lines, the files of the archived report, the production overlay, the think-time
 * verdict and the baseline of a run. Registered by `registerResultRoutes`.
 */
function registerResultModuleRoutes(fake: Fake): void {
  if (moduleRegistered.has(fake)) return;
  moduleRegistered.add(fake);

  // A request the run did not count is a 404, as for a name the run never had.
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints/{name}',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const body = seeded<Seeded<RequestDetailBody>>(
        store,
        RESULT_MODULE_COLLECTIONS.requests,
        `${req.params.execution_id}\n${req.params.name}`,
      );
      if (body === undefined) throw new FakeHttpError(404, { detail: 'Endpoint not found' });
      return answer(body);
    },
  );

  // The run's window of the log store: a run with nothing seeded logged nothing in it.
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/logs',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const level = req.query.level;
      if (level !== undefined && !LOG_LEVELS.has(level)) {
        throw new FakeHttpError(422, {
          detail: [
            {
              loc: ['query', 'level'],
              msg: "Input should be 'error', 'warn', 'info' or 'debug'",
              type: 'literal_error',
            },
          ],
        });
      }
      const body = seeded<Seeded<LogsBody>>(
        store,
        RESULT_MODULE_COLLECTIONS.logs,
        req.params.execution_id,
      ) ?? {
        logs: [],
        logs_window_start: null,
        logs_window_end: null,
        logs_retention: null,
        logs_source: 'loki' as const,
        series_source: 'absent_unmeasured' as const,
        series_retention: null,
      };
      const answered = answer(body);
      const limit = Number(req.query.limit ?? '100');
      const lines = answered.body.logs.filter(
        (line) => level === undefined || hasLevel(line, level),
      );
      return { status: 200, body: { ...answered.body, logs: lines.slice(0, limit) } };
    },
  );

  // A file of the report: its bytes, a 404 for a file the archive lacks (or a run without a
  // report), a 400 for a path that leaves the report.
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/report/{filepath}',
    async (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const path = req.params.filepath;
      if (path.split('/').includes('..') || path.startsWith('/')) {
        throw new FakeHttpError(400, { detail: 'Bad path' });
      }
      const files = seeded<Readonly<Record<string, string | Buffer>>>(
        store,
        RESULT_MODULE_COLLECTIONS.reports,
        req.params.execution_id,
      );
      const delay = seeded<number>(
        store,
        RESULT_MODULE_COLLECTIONS.reportDelays,
        `${req.params.execution_id}\n${path}`,
      );
      if (delay !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const content = files === undefined ? undefined : files[path];
      if (content === undefined) throw new FakeHttpError(404, { detail: 'Report asset not found' });
      return {
        status: 200,
        body: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
        headers: { 'content-type': reportType(path) },
      };
    },
  );

  // A run that did not replay production traffic has no overlay.
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/production-overlay',
    (req, store) => {
      const id = req.params.execution_id;
      requireRun(store, id);
      const body = seeded<Seeded<ProductionOverlayBody>>(
        store,
        RESULT_MODULE_COLLECTIONS.overlays,
        id,
      );
      if (body === undefined) {
        throw new FakeHttpError(404, {
          detail: {
            error: 'not_a_production_run',
            message: `Execution ${id} did not run a production plan.`,
          },
        });
      }
      return answer(body);
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/think-time-verdict',
    (req, store) => {
      const id = req.params.execution_id;
      requireRun(store, id);
      const body = seeded<Seeded<ThinkTimeBody>>(store, RESULT_MODULE_COLLECTIONS.thinkTimes, id);
      if (body === undefined) {
        throw new FakeHttpError(404, {
          detail: {
            error: 'not_a_production_run',
            message: `Execution ${id} did not run a production plan.`,
          },
        });
      }
      return answer(body);
    },
  );

  // A run with no baseline pinned for its scenario and load: `not_established`. A pin made on the
  // fake (PUT) answers before a seeded answer: it is the newer fact.
  const baselineOf = (store: Store, id: string, execution: SklepExecution): BaselineBody => {
    const pinned = pinnedBaselineOf(store, id);
    const seededBody = seeded<Seeded<BaselineBody>>(store, RESULT_MODULE_COLLECTIONS.baselines, id);
    if (pinned !== undefined) {
      const run = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).get(pinned);
      return {
        execution_id: id,
        scenario_id: execution.scenario_id ?? id,
        workload_identity: 'c'.repeat(64),
        workload: null,
        state: 'established',
        baseline: {
          execution_id: pinned,
          status: 'completed',
          started_at: run?.started_at ?? null,
          completed_at: run?.completed_at ?? null,
          target_base_url: null,
          has_measurements: true,
          is_this_execution: pinned === id,
        },
      };
    }
    if (seededBody !== undefined) return answer(seededBody).body;
    return {
      execution_id: id,
      scenario_id: execution.scenario_id ?? id,
      workload_identity: '0'.repeat(64),
      workload: null,
      state: 'not_established',
      baseline: null,
    };
  };

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/baseline',
    (req, store) => {
      const id = req.params.execution_id;
      return { status: 200, body: baselineOf(store, id, requireExecution(store, id)) };
    },
  );

  // Pins the run as the baseline of its pair, replacing the one there; an error seeded for the run
  // (a 409 of a run with no pair) answers instead.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/baseline',
    (req, store) => {
      const id = req.params.execution_id;
      const execution = requireExecution(store, id);
      const refusal = seeded<Seeded<BaselineBody>>(store, RESULT_MODULE_COLLECTIONS.baselines, id);
      if (refusal !== undefined && isSeededError(refusal)) answer(refusal);
      seedBaselinePair(store, id, id);
      return { status: 200, body: baselineOf(store, id, execution) };
    },
  );
}
