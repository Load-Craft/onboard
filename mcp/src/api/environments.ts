// Environments of a project for the project setup tools: what exists, creating one, moving the default and
// the connection test. Addresses, flags and load limits are read and sent as they are. Of the
// secrets of an environment only the fixed headers pass through here, and only as `Secret`s going
// out: the backend masks them on read and refuses a masked value sent back (422), so what a read
// returns for a header is the name and whether it is masked, never the value. Variables and auth
// settings never pass through here.

import type { Secret } from '../secret.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';
import { capsSchema } from './status.js';

/** Load limits of a protected environment; a limit the environment does not set is absent. */
export interface Caps {
  readonly maxVu?: number;
  readonly maxRps?: number;
}

export interface EnvironmentRecord {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly frontendUrl: string | null;
  readonly isDefault: boolean;
  readonly protected: boolean;
  readonly caps: Caps;
  /**
   * The fixed headers as the backend shows them: a value it considers secret is `MASKED_VALUE`.
   * Held only to send back what is not masked; never shown.
   */
  readonly headers: Readonly<Record<string, unknown>>;
}

/** A fixed header to store: the value is read from the env file and goes out as it is. */
export interface HeaderToSet {
  readonly name: string;
  readonly value: Secret;
}

/** What the backend shows in place of a masked value (`MASKED_VALUE`). */
export const MASKED_VALUE = '«masked»';

export interface NewEnvironment {
  readonly name: string;
  readonly baseUrl: string;
  readonly frontendUrl?: string;
  readonly isDefault: boolean;
  /** Set: the environment is protected with these limits. */
  readonly limit?: { readonly maxVu: number; readonly maxRps: number };
  readonly headers?: readonly HeaderToSet[];
}

/**
 * `ok` | `unreachable` | `tls_error` | `blocked` | `too_many_redirects`
 * as the backend's probe reports them; `not_checked` when the answer has no probe of the address.
 */
export interface ProbeResult {
  readonly status: string;
  /** Answer time; only when the server answered. */
  readonly ms?: number;
}

export interface ConnectionCheck {
  readonly api: ProbeResult;
  /** Absent when the environment has no frontend address (the backend probes none). */
  readonly frontend?: ProbeResult;
}

type EnvironmentBody = {
  id: string;
  name: string;
  base_url: string;
  frontend_url?: string | null;
  is_default: boolean;
  protected: boolean;
  workload_caps?: Record<string, unknown> | null;
  default_headers?: Record<string, unknown> | null;
};

function record(item: EnvironmentBody): EnvironmentRecord {
  return {
    id: item.id,
    name: item.name,
    baseUrl: item.base_url,
    frontendUrl: item.frontend_url ?? null,
    isDefault: item.is_default,
    protected: item.protected,
    caps: capsSchema.parse(item.workload_caps),
    headers: item.default_headers ?? {},
  };
}

export async function listEnvironmentRecords(
  api: SecretApiContext,
  projectId: string,
): Promise<EnvironmentRecord[]> {
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return data.items.map(record);
}

function headerBody(headers: readonly HeaderToSet[]): Record<string, string> {
  return Object.fromEntries(headers.map((header) => [header.name, header.value.reveal()]));
}

/** `POST …/environments`; `is_default: true` clears the flag of the others in the backend. */
export async function createEnvironment(
  api: SecretApiContext,
  projectId: string,
  environment: NewEnvironment,
): Promise<EnvironmentRecord> {
  const data = await callOperation(
    api.services.http,
    'create_environment_api_v1_projects__project_id__environments_post',
    {
      path: { project_id: projectId },
      body: {
        name: environment.name,
        base_url: environment.baseUrl,
        ...(environment.frontendUrl === undefined ? {} : { frontend_url: environment.frontendUrl }),
        auth_type: 'none',
        ...(environment.headers === undefined || environment.headers.length === 0
          ? {}
          : { default_headers: headerBody(environment.headers) }),
        is_default: environment.isDefault,
        protected: environment.limit !== undefined,
        ...(environment.limit === undefined
          ? {}
          : {
              workload_caps: {
                max_vu: environment.limit.maxVu,
                max_rps: environment.limit.maxRps,
              },
            }),
      },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return record(data);
}

/**
 * `PUT …/environments/{id}` with only the protection flag and the workload caps (the backend
 * changes the fields the request carries). Without a limit the environment is left as it is:
 * the call exists to protect, never to lift a protection.
 */
export async function protectEnvironment(
  api: SecretApiContext,
  projectId: string,
  environmentId: string,
  limit: { readonly maxVu: number; readonly maxRps: number },
): Promise<EnvironmentRecord> {
  const data = await callOperation(
    api.services.http,
    'update_environment_api_v1_projects__project_id__environments__environment_id__put',
    {
      path: { project_id: projectId, environment_id: environmentId },
      body: { protected: true, workload_caps: { max_vu: limit.maxVu, max_rps: limit.maxRps } },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return record(data);
}

/**
 * `PUT …/environments/{id}` with `default_headers` only: the backend replaces the whole set with
 * the dict it is given (`update_environment`), so the caller sends every
 * header the environment is to have. `keep` are the unmasked headers the environment already has.
 */
export async function setEnvironmentHeaders(
  api: SecretApiContext,
  projectId: string,
  environmentId: string,
  headers: readonly HeaderToSet[],
  keep: Readonly<Record<string, unknown>>,
): Promise<EnvironmentRecord> {
  const data = await callOperation(
    api.services.http,
    'update_environment_api_v1_projects__project_id__environments__environment_id__put',
    {
      path: { project_id: projectId, environment_id: environmentId },
      body: { default_headers: { ...keep, ...headerBody(headers) } },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return record(data);
}

export async function setDefaultEnvironment(
  api: ApiContext,
  projectId: string,
  environmentId: string,
): Promise<void> {
  await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/environments/{environment_id}/set-default',
      {
        params: { path: { project_id: projectId, environment_id: environmentId } },
        signal: api.signal,
      },
    ),
  );
}

function probeResult(result: { status: string; latency_ms?: number | null }): ProbeResult {
  return result.latency_ms == null
    ? { status: result.status }
    : { status: result.status, ms: Math.round(result.latency_ms) };
}

/**
 * `POST …/test-connection`: one probe of the API address and one of the frontend address when
 * set. A refused private address (`blocked`) or a dead host is a result, not an error.
 */
export async function testConnection(
  api: ApiContext,
  projectId: string,
  environmentId: string,
): Promise<ConnectionCheck> {
  const data = await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/environments/{environment_id}/test-connection',
      {
        params: { path: { project_id: projectId, environment_id: environmentId } },
        signal: api.signal,
      },
    ),
  );
  const apiProbe = data.results.find((result) => result.kind === 'base_url');
  const frontendProbe = data.results.find((result) => result.kind === 'frontend_url');
  return {
    api: apiProbe === undefined ? { status: 'not_checked' } : probeResult(apiProbe),
    ...(frontendProbe === undefined ? {} : { frontend: probeResult(frontendProbe) }),
  };
}

/** What the conformance probe of one environment found; counts are of the project's operations. */
export interface Conformance {
  /** GET operations the target answers. */
  readonly exists: number;
  /** GET operations the target does not have. */
  readonly missing: number;
  /** The first `MISSING_LISTED` of them, as `METHOD path`. */
  readonly missingPaths: readonly string[];
  /**
   * GET operations the probe sent and could not classify (e.g. an SPA answering for every path, or
   * a 400 for a missing header). Operations it never sent are counted in the two fields below.
   */
  readonly inconclusive: number;
  /** Operations left unprobed because their method changes data. */
  readonly notProbedMethods: number;
  /** GET operations left unprobed because their path has parameters. */
  readonly skippedParams: number;
  /** GET operations left unprobed because their path names another host than the environment's. */
  readonly offHost: number;
  /**
   * Names of the headers every probe carried (the environment's fixed headers), never values;
   * undefined when the backend does not report them.
   */
  readonly headersSent: readonly string[] | undefined;
  /** HTTP statuses of the inconclusive probes with how many got each, the most frequent first. */
  readonly statuses: readonly StatusCount[];
  /** How the report ended (`complete`, or a canary or an abort); as the backend names it. */
  readonly reportStatus: string;
}

/** `count` probes were answered with HTTP `status`. */
export interface StatusCount {
  readonly status: number;
  readonly count: number;
}

/** The backend's reasons for an operation it did not send: a method that changes data, a path on another host. */
const NOT_SENT: ReadonlySet<string> = new Set(['method_not_probed', 'off_host']);

/** The statuses of the inconclusive probes that went on the wire, most frequent first. */
function statusCounts(
  items: readonly { http_status?: number | null; reason?: string | null }[],
): StatusCount[] {
  const counts = new Map<number, number>();
  for (const item of items) {
    if (
      (item.reason != null && NOT_SENT.has(item.reason)) ||
      item.http_status === undefined ||
      item.http_status === null
    ) {
      continue;
    }
    counts.set(item.http_status, (counts.get(item.http_status) ?? 0) + 1);
  }
  return [...counts]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status - b.status);
}

/** The backend bounds the whole probe at two minutes; the client waits a little longer. */
const CONFORMANCE_TIMEOUT_MS = 130_000;

/** Missing operations named in the result; the rest is only counted. */
export const MISSING_LISTED = 3;

/**
 * `POST …/conformance`: probes the project's endpoint candidates against the environment's
 * address (GET only, redirects not followed). Runs inline in the backend, up to two minutes.
 */
export async function runConformance(
  api: ApiContext,
  projectId: string,
  environmentId: string,
): Promise<Conformance> {
  const data = await must(
    api.services.http.POST(
      '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
      {
        params: { path: { project_id: projectId, environment_id: environmentId } },
        signal: api.signal,
        timeoutMs: CONFORMANCE_TIMEOUT_MS,
      },
    ),
  );
  return {
    exists: data.totals.exists,
    missing: data.totals.missing,
    missingPaths: (data.missing ?? [])
      .slice(0, MISSING_LISTED)
      .map((item) => `${item.method.toUpperCase()} ${item.path}`),
    // the backend counts the operations it did not send among the inconclusive ones; they are
    // reported as `notProbedMethods` and `offHost`, so each candidate falls into exactly one class
    inconclusive: Math.max(
      0,
      data.totals.inconclusive -
        data.sampled.not_probed_methods -
        (data.sampled.not_probed_off_host ?? 0),
    ),
    notProbedMethods: data.sampled.not_probed_methods,
    skippedParams: data.sampled.skipped_param_paths,
    offHost: data.sampled.not_probed_off_host ?? 0,
    headersSent: data.headers_sent,
    statuses: statusCounts(data.inconclusive ?? []),
    reportStatus: data.status,
  };
}
