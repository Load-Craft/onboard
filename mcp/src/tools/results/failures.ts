// Reads behind `results_get_errors`, `results_get_traces` and the attempts of a failed self-check:
// the error groups of a run, one group by its hash, the traces of a run and one trace with what the
// load generator recorded of the request. A trace holds what the test sent and what the target
// answered, so nothing of it leaves this file unmasked: header values never leave (only their
// names), the bodies, the address and every text leave with the values of secret fields replaced
// (`security/traceMask.ts`), and each value replaced is registered with the secret scope of the
// call, so it is masked wherever else it appears.

import type { ToolContext } from '../../context.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { callOperation } from '../../http/operation.js';
import { inline } from '../../render/primitives.js';
import { DATA_BODY_LIMIT, type BodyView } from '../../render/views/failures.js';
import { MIN_SECRET_LENGTH } from '../../security/mask.js';
import {
  contentType,
  headerNames,
  headerSecrets,
  maskBody,
  maskText,
  maskUrl,
  type Masked,
} from '../../security/traceMask.js';

/** The longest body a trace keeps, as the load generator caps it; nothing longer is read. */
export const BODY_LIMIT = 10_240;

/** The longest error or console text kept, in characters. */
const MESSAGE_LIMIT = 500;
/** Header names listed per request; a request has rarely more. */
const HEADER_NAMES_LIMIT = 40;

type Ctx = Pick<ToolContext, 'services' | 'signal' | 'secrets'>;

const options = (ctx: Ctx) => ({ signal: ctx.signal, secrets: ctx.secrets });

/** Registers what a mask replaced and returns the masked text. */
function kept(masked: Masked, ctx: Ctx): string {
  for (const value of masked.secrets) if (value.length >= MIN_SECRET_LENGTH) ctx.secrets.add(value);
  return masked.text;
}

/** A text from the run (an error, a console line), on one line, masked and cut. */
function cleanText(raw: string, ctx: Ctx): string {
  return inline(kept(maskText(raw), ctx), MESSAGE_LIMIT);
}

const shown = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === '' ? null : inline(value);

// ---- error groups -----------------------------------------------------------------------------

export interface ConsoleLine {
  readonly message: string;
  readonly count: number;
}

export interface RunErrorGroup {
  readonly hash: string;
  /** HTTP status; `null` for a group that is not a status (a failed check, no response). */
  readonly status: number | null;
  readonly message: string;
  readonly count: number;
  /** Share of all failed requests, in percent; `null` when the backend gave none. */
  readonly percent: number | null;
  readonly endpoints: readonly string[];
  /** Why the requests counted as failed: `http_status`, `no_response`, `unmet_check`, …; or `null`. */
  readonly kind: string | null;
  readonly source: string;
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
  /** Lines of the load generator's console folded into the group. */
  readonly console: readonly ConsoleLine[];
}

export interface RunErrors {
  readonly groups: readonly RunErrorGroup[];
  /** `prometheus` when the samples of the run are there; another value says why they are not. */
  readonly seriesSource: string;
  readonly retention: string | null;
}

/** The fields of a group, as the list and the detail both answer them. */
interface GroupWire {
  readonly error_hash: string;
  readonly message: string;
  readonly http_status: number | null;
  readonly count: number;
  readonly percentage?: number;
  readonly affected_endpoints: readonly string[];
  readonly ko_limb?: string;
  readonly source: string;
  readonly first_seen?: string;
  readonly last_seen?: string;
  readonly console_messages?: readonly { readonly message: string; readonly count: number }[];
}

function groupOf(wire: GroupWire, ctx: Ctx): RunErrorGroup {
  return {
    hash: inline(wire.error_hash),
    status: wire.http_status,
    message: cleanText(wire.message, ctx),
    count: wire.count,
    percent: wire.percentage ?? null,
    endpoints: wire.affected_endpoints.map((endpoint) => inline(endpoint)),
    kind: shown(wire.ko_limb),
    source: inline(wire.source),
    firstSeen: shown(wire.first_seen),
    lastSeen: shown(wire.last_seen),
    console: (wire.console_messages ?? []).map((line) => ({
      message: cleanText(line.message, ctx),
      count: line.count,
    })),
  };
}

/** The error groups of a run, the most frequent first as the backend lists them. */
export async function readRunErrors(
  ctx: Ctx,
  projectId: string,
  executionId: string,
): Promise<RunErrors> {
  const data = await callOperation(
    ctx.services.http,
    'get_execution_errors_api_v1_projects__project_id__gatling_executions__execution_id__errors_get',
    { path: { project_id: projectId, execution_id: executionId } },
    options(ctx),
  );
  return {
    groups: data.errors.map((group) => groupOf(group, ctx)),
    seriesSource: inline(data.series_source),
    retention: shown(data.series_retention),
  };
}

/** One error group of a run by its hash (`http-400`, `unmet_check`); a 404 when there is none. */
export async function readRunError(
  ctx: Ctx,
  projectId: string,
  executionId: string,
  hash: string,
): Promise<RunErrorGroup> {
  const data = await callOperation(
    ctx.services.http,
    'get_execution_error_detail_api_v1_projects__project_id__gatling_executions__execution_id__errors__error_hash__get',
    { path: { project_id: projectId, execution_id: executionId, error_hash: hash } },
    options(ctx),
  );
  return groupOf(data, ctx);
}

// ---- traces -----------------------------------------------------------------------------------

/** A trace of a run as the list shows it: no attributes, no bodies. */
export interface TraceRow {
  readonly id: string;
  /** The span name: `HTTP POST /checkout` or `HTTP POST zamówienie`. */
  readonly name: string;
  readonly method: string | null;
  readonly status: number | null;
  readonly durationMs: number;
  readonly startTime: string | null;
}

export interface TraceQuery {
  /** Only the requests that failed. */
  readonly failedOnly: boolean;
  /** Only the requests of this name, as the run records it (`POST /checkout`). */
  readonly request?: string;
  readonly limit: number;
}

/**
 * The traces of a run, in the window of the run. A run the trace store holds nothing of (too old,
 * never traced) and a trace store that does not answer give an empty list, not an error.
 */
export async function listTraces(
  ctx: Ctx,
  projectId: string,
  executionId: string,
  query: TraceQuery,
): Promise<TraceRow[]> {
  const data = await callOperation(
    ctx.services.http,
    'get_execution_traces_api_v1_projects__project_id__gatling_executions__execution_id__traces_get',
    {
      path: { project_id: projectId, execution_id: executionId },
      query: {
        limit: query.limit,
        ...(query.failedOnly ? { status: 'error' } : {}),
        ...(query.request === undefined ? {} : { request_name: query.request }),
      },
    },
    options(ctx),
  );
  return data.traces.map((trace) => ({
    id: inline(trace.trace_id),
    name: inline(trace.operation_name),
    method: shown(trace.http_method),
    status: trace.http_status_code,
    durationMs: trace.duration_ms,
    startTime: shown(trace.start_time),
  }));
}

/** One recorded request, masked: what the views and the `data` format may show of it. */
export interface RecordedRequest {
  readonly traceId: string;
  /** The request name of the scenario (`zamówienie`, `POST /checkout`); `null` when not recorded. */
  readonly step: string | null;
  readonly method: string | null;
  /** The address with the values of secret query parameters and any password replaced. */
  readonly url: string | null;
  readonly status: number | null;
  readonly failed: boolean;
  readonly durationMs: number;
  readonly startTime: string | null;
  /** Why the run counted the request as failed (the check that did not hold), masked. */
  readonly error: string | null;
  /** Names only: the values of headers are never shown. */
  readonly requestHeaders: readonly string[];
  readonly responseHeaders: readonly string[];
  /** The bodies, masked (or hidden whole in a format the mask does not read); `null` when not recorded. */
  readonly requestBody: BodyView | null;
  readonly responseBody: BodyView | null;
}

/** An attribute of a span that holds text; anything else is not read. */
function textOf(attributes: Record<string, unknown>, key: string): string {
  const value = attributes[key];
  return typeof value === 'string' ? value : '';
}

/**
 * A body masked as a whole (the mask reads the format of all of it), then cut to `limit`
 * characters; a body of a format the mask does not read is hidden, with its type and size.
 */
function bodyOf(
  raw: string,
  type: string | null,
  side: 'request' | 'response',
  limit: number,
  ctx: Ctx,
): BodyView | null {
  if (raw === '') return null;
  const recorded = raw.slice(0, BODY_LIMIT);
  const bytes = Buffer.byteLength(recorded, 'utf8');
  const masked = maskBody(recorded, type, side);
  if (masked.kind === 'hidden') return { kind: 'hidden', type: masked.type, bytes };
  const text = kept(masked, ctx);
  return text.length <= limit
    ? { kind: 'shown', text, bytes, cut: false }
    : { kind: 'shown', text: text.slice(0, limit), bytes, cut: true };
}

/** One trace by its id: the request it recorded, masked. 404 when the trace store has no such trace. */
export async function readTrace(
  ctx: Ctx,
  projectId: string,
  executionId: string,
  traceId: string,
  bodyLimit: number = BODY_LIMIT,
): Promise<RecordedRequest> {
  const trace = await callOperation(
    ctx.services.http,
    'get_execution_trace_detail_api_v1_projects__project_id__gatling_executions__execution_id__traces__trace_id__get',
    { path: { project_id: projectId, execution_id: executionId, trace_id: traceId } },
    options(ctx),
  );
  const { attributes } = trace;
  const requestHeaders = textOf(attributes, 'request.headers');
  const responseHeaders = textOf(attributes, 'response.headers');
  // The values of credential headers are registered before any other part is read, so a token the
  // answer or the error repeats is masked there too.
  for (const value of [...headerSecrets(requestHeaders), ...headerSecrets(responseHeaders)]) {
    if (value.length >= MIN_SECRET_LENGTH) ctx.secrets.add(value);
  }
  const requestBody = bodyOf(
    textOf(attributes, 'request.body'),
    contentType(requestHeaders),
    'request',
    bodyLimit,
    ctx,
  );
  const responseBody = bodyOf(
    textOf(attributes, 'response.body'),
    contentType(responseHeaders),
    'response',
    bodyLimit,
    ctx,
  );
  const errorEvent = trace.events.find((event) => event.name === 'error');
  const error = errorEvent === undefined ? '' : textOf(errorEvent.attributes, 'error.message');
  const step = textOf(attributes, 'request.name');
  return {
    traceId: inline(trace.trace_id),
    step: step === '' ? null : cleanText(step, ctx),
    method: shown(trace.http_method),
    url: trace.http_url === null ? null : inline(kept(maskUrl(trace.http_url), ctx)),
    status: trace.http_status_code,
    failed: trace.status_code === 'ERROR',
    durationMs: trace.duration_ms,
    startTime: shown(trace.start_time),
    error: error === '' ? null : cleanText(error, ctx),
    requestHeaders: headerNames(requestHeaders)
      .slice(0, HEADER_NAMES_LIMIT)
      .map((name) => inline(name)),
    responseHeaders: headerNames(responseHeaders)
      .slice(0, HEADER_NAMES_LIMIT)
      .map((name) => inline(name)),
    requestBody,
    responseBody,
  };
}

/** Failed traces of one self-check run read to pick the one to show. */
const ATTEMPT_TRACES = 20;

/**
 * The failed request of one run of a self-check, for its view: the request the check named when a
 * failed trace has that name, else the earliest failed one. A trace store that holds nothing of the
 * run, does not answer or does not know it gives none: the check has its result either way.
 */
export async function readFailedRequest(
  ctx: Ctx,
  projectId: string,
  executionId: string,
  named: string | null,
): Promise<RecordedRequest | null> {
  try {
    const failed = await listTraces(ctx, projectId, executionId, {
      failedOnly: true,
      limit: ATTEMPT_TRACES,
    });
    const ordered = [...failed].sort((a, b) =>
      (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    );
    const byName =
      named === null || named === ''
        ? undefined
        : ordered.find((trace) => trace.name.endsWith(` ${named}`));
    const chosen = byName ?? ordered[0];
    if (chosen === undefined) return null;
    return await readTrace(ctx, projectId, executionId, chosen.id, DATA_BODY_LIMIT);
  } catch (error) {
    if (error instanceof LoadcraftApiError && [404, 502, 503].includes(error.status)) return null;
    throw error;
  }
}
