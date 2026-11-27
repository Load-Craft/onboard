// Trace routes of the fake backend: the traces of a run (`GET …/executions/{id}/traces`, summaries
// without attributes, the failed ones with `status=error`, one request with `request_name`), the
// failed ones of the last day (`…/error-traces`), the detail of one trace with the attributes the
// load generator records (`…/traces/{trace_id}`: headers as `Name: value` lines, the bodies, the
// address) and one error group by its hash (`…/errors/{error_hash}`). A test seeds the traces of a
// run with `seedTraces`; a run without seeded traces has none, as a run Tempo holds nothing of.
// Registration is idempotent per fake.

import type { ResponseOf } from '../../../src/contract/reads.js';
import type { components } from '../../../src/http/generated/api.js';
import type { Fake } from '../server.js';
import { FakeHttpError } from '../server.js';
import {
  SKLEP_COLLECTIONS,
  type SklepExecution,
  type SklepExecutionResult,
} from '../worlds/sklep.js';
import { registerErrorGroupsRoute } from './analysis.js';
import { requireRun } from './executionOwner.js';

/** One request of a run as the load generator records it on its span. */
export interface FakeTraceInput {
  readonly traceId: string;
  /** The request name of the scenario (`zamówienie`, `POST /checkout`). */
  readonly request: string;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly durationMs?: number;
  readonly startTime?: string;
  readonly requestHeaders?: string;
  readonly responseHeaders?: string;
  readonly requestBody?: string;
  readonly responseBody?: string;
  /** The text of the failed check; a failed request always has one. */
  readonly error?: string;
}

interface StoredTrace extends FakeTraceInput {
  readonly failed: boolean;
}

type TraceSummary = components['schemas']['TraceSummary'];
type TraceDetail = ResponseOf<
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/traces/{trace_id}',
  'get'
>;

const traces = new WeakMap<Fake, Map<string, StoredTrace[]>>();
const registered = new WeakSet<Fake>();

function tracesOf(fake: Fake): Map<string, StoredTrace[]> {
  let known = traces.get(fake);
  if (known === undefined) {
    known = new Map();
    traces.set(fake, known);
  }
  return known;
}

/**
 * The requests of a run; one with a status of 400 or more, or with an error text, failed. A run the
 * trace store holds is a run of the project (the trace routes answer only those), so a run that is
 * not an execution of the world yet becomes one, a copy of the world's first run.
 */
export function seedTraces(
  fake: Fake,
  executionId: string,
  items: readonly FakeTraceInput[],
): void {
  registerTraceRoutes(fake);
  const executions = fake.store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions);
  const [template] = executions.list();
  if (executions.get(executionId) === undefined && template !== undefined) {
    executions.insert({ ...template, id: executionId });
  }
  const runs = tracesOf(fake);
  runs.set(executionId, [
    ...(runs.get(executionId) ?? []),
    ...items.map((item) => ({ ...item, failed: item.status >= 400 || item.error !== undefined })),
  ]);
}

const spanName = (trace: StoredTrace): string =>
  trace.request.toUpperCase().startsWith(`${trace.method.toUpperCase()} `)
    ? `HTTP ${trace.request}`
    : `HTTP ${trace.method} ${trace.request}`;

function summary(trace: StoredTrace): TraceSummary {
  return {
    trace_id: trace.traceId,
    span_id: trace.traceId.slice(0, 16).padStart(16, '0'),
    parent_span_id: null,
    operation_name: spanName(trace),
    service_name: 'gatling',
    start_time: trace.startTime ?? '2026-11-22T10:20:00Z',
    end_time: trace.startTime ?? '2026-11-22T10:20:00Z',
    duration_ms: trace.durationMs ?? 50,
    status_code: 'OK',
    http_method: trace.method,
    http_url: null,
    http_status_code: trace.status,
    attributes: {},
    events: [],
  };
}

function detail(trace: StoredTrace): TraceDetail {
  const attributes: Record<string, unknown> = {
    'service.name': 'gatling',
    'http.method': trace.method,
    'http.status_code': trace.status,
    'http.url': trace.url,
    'request.name': trace.request,
    'loadcraft.request.name': trace.request,
  };
  if (trace.requestHeaders !== undefined) attributes['request.headers'] = trace.requestHeaders;
  if (trace.responseHeaders !== undefined) attributes['response.headers'] = trace.responseHeaders;
  if (trace.responseBody !== undefined) attributes['response.body'] = trace.responseBody;
  if (trace.requestBody !== undefined) attributes['request.body'] = trace.requestBody;
  return {
    ...summary(trace),
    parent_span_id: null,
    status_code: trace.failed ? 'ERROR' : 'OK',
    http_url: trace.url,
    attributes,
    events: trace.failed
      ? [
          {
            name: 'error',
            timestamp: trace.startTime ?? '2026-11-22T10:20:00Z',
            attributes: {
              'error.message': trace.error ?? '',
              'response.body': trace.responseBody ?? '',
            },
          },
        ]
      : [],
  };
}

export function registerTraceRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  registerErrorGroupsRoute(fake);
  const runs = tracesOf(fake);

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/traces',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const limit = Number(req.query['limit'] ?? '100');
      const wanted = req.query['request_name'];
      const listed = (runs.get(req.params.execution_id) ?? [])
        .filter((trace) => req.query['status'] !== 'error' || trace.failed)
        .filter((trace) => wanted === undefined || trace.request === wanted)
        .slice(0, limit);
      return {
        status: 200,
        body: {
          traces: listed.map(summary),
          series_source: 'prometheus' as const,
          series_retention: null,
        },
      };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/error-traces',
    (req, store) => {
      requireRun(store, req.params.execution_id, req.params.project_id);
      const limit = Number(req.query['limit'] ?? '50');
      const listed = (runs.get(req.params.execution_id) ?? []).filter((trace) => trace.failed);
      return { status: 200, body: listed.slice(0, limit).map(summary) };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/traces/{trace_id}',
    (req, store) => {
      // The run in the path only has to be the project's; the trace is read by its id alone.
      requireRun(store, req.params.execution_id, req.params.project_id);
      for (const run of runs.values()) {
        const found = run.find((trace) => trace.traceId === req.params.trace_id);
        if (found !== undefined) return { status: 200, body: detail(found) };
      }
      throw new FakeHttpError(404, { detail: 'Trace not found' });
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/errors/{error_hash}',
    (req, store) => {
      const result = store
        .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
        .get(req.params.execution_id);
      const group = result?.errors.find((item) => item.error_hash === req.params.error_hash);
      if (group === undefined) throw new FakeHttpError(404, { detail: 'Error group not found' });
      return { status: 200, body: { ...group, console_messages: [], occurrences: [] } };
    },
  );
}
