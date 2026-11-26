// HAR import reads and writes of the LoadCraft REST API: the upload of a recording, its analysis and
// the default environment the recorded address is compared with. A recording carries the session of
// the person who made it, so each function keeps only counts, names of paths and variables, and
// codes: no header, cookie, body or value of a request ever leaves this file.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { uploadFile } from '../http/upload.js';
import { openAllowedForUpload, type AllowedFile } from '../workspace/uploads.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { callOperation } from '../http/operation.js';
import { must, stopRequest, type ApiContext, type SecretApiContext } from './context.js';

/** Time limit of the upload and of the analysis; both wait for the language model. */
export const HAR_CALL_TIMEOUT_MS = 300_000;

/**
 * Part of the backend's refusal of a recording saved without response bodies
 * (`flow_postprocessor.py:249-258` `sanitized_export_refusal`, backend `d93e08d80`).
 */
export const SANITIZED_MARKER = 'Allow generating HAR with sensitive data';

/**
 * A refusal of the HAR routes without the text of the backend: that text can quote the recording
 * (a parser error cites the entry it choked on, headers and cookies included). The code, the
 * status and whether a retry can help are kept; the message becomes the bare status.
 */
export function withoutBackendText(error: unknown): unknown {
  if (!(error instanceof LoadcraftApiError)) return error;
  return new LoadcraftApiError({
    status: error.status,
    code: error.code,
    message: `LoadCraft API answered HTTP ${String(error.status)}.`,
    retryable: error.retryable,
  });
}

async function quietly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw withoutBackendText(error);
  }
}

/** What the content hash and the size say about a recording; the key of the remembered answer. */
export interface HarFingerprint {
  readonly sha256: string;
  readonly size: number;
}

/** SHA-256 of the file, streamed from the descriptor that passed the allow-list checks. */
export async function fingerprintHar(file: AllowedFile): Promise<HarFingerprint> {
  const { handle, size } = await openAllowedForUpload(file);
  try {
    const hash = createHash('sha256');
    if (size > 0) {
      for await (const chunk of handle.createReadStream({
        start: 0,
        end: size - 1,
        autoClose: false,
      })) {
        hash.update(chunk as Uint8Array);
      }
    }
    return { sha256: hash.digest('hex'), size };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export interface HarUpload {
  readonly sessionId: string;
  readonly totalEntries: number;
  /** Entries left after the static assets were dropped, noise included. */
  readonly keptEntries: number;
  /** Of the kept entries, those scored as noise. */
  readonly noiseEntries: number;
  /** Address the recording was made against, as the backend detected it. */
  readonly baseUrl: string;
  /** `bearer_token`, `cookie_session`, `basic_auth`, or null (`har_parser.py:4739`). */
  readonly authPattern: string | null;
  readonly warningCodes: readonly string[];
}

const uploadSchema = reads<ResponseOf<'/api/v1/projects/{project_id}/har/upload', 'post'>>()(
  z.object({
    har_session_id: z.string(),
    total_entries: z.number(),
    filtered_entries: z.number(),
    excluded_count: z.number().default(0),
    base_url: z.string().default(''),
    detected_auth_pattern: z.string().nullish(),
    warnings: z.array(z.object({ code: z.string().optional() }).loose()).default([]),
  }),
);

const codesOf = (warnings: readonly { code?: string | undefined }[]): string[] =>
  warnings.flatMap((warning) => (warning.code === undefined ? [] : [warning.code]));

/** `POST …/har/upload`: the file streams from disk, the call is not repeated. */
export async function uploadHar(
  api: ApiContext,
  projectId: string,
  file: AllowedFile,
): Promise<HarUpload> {
  const data = await quietly(() =>
    uploadFile(api.services.http, {
      url: `/api/v1/projects/${encodeURIComponent(projectId)}/har/upload`,
      field: 'file',
      file,
      signal: api.signal,
      timeoutMs: HAR_CALL_TIMEOUT_MS,
    }),
  );
  const upload = uploadSchema.parse(data);
  return {
    sessionId: upload.har_session_id,
    totalEntries: upload.total_entries,
    keptEntries: upload.filtered_entries,
    noiseEntries: upload.excluded_count,
    baseUrl: upload.base_url,
    authPattern: upload.detected_auth_pattern ?? null,
    warningCodes: codesOf(upload.warnings),
  };
}

export interface HarCorrelation {
  readonly variable: string;
  /** 0..1 */
  readonly confidence: number;
  /** Whether the value goes into the `Authorization` header. */
  readonly sentAsAuth: boolean;
  /** Entry of the recording that produced the value. */
  readonly sourceEntry: number;
}

export interface HarActionGroup {
  readonly name: string;
  readonly entryIndices: readonly number[];
  readonly requests: readonly { readonly method: string; readonly path: string }[];
}

export interface HarAnalysis {
  readonly groups: readonly HarActionGroup[];
  readonly correlations: readonly HarCorrelation[];
  /** `target_location` of each value with more than one possible producer. */
  readonly ambiguousLocations: readonly string[];
  /** Shares of the recording's requests, 0..1. */
  readonly responseBodyRatio: number;
  readonly strippedResponseBodyRatio: number;
  readonly warningCodes: readonly string[];
}

const analysisSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/har/{har_session_id}/analyze', 'post'>
>()(
  z.object({
    action_groups: z
      .array(
        z.object({
          name: z.string(),
          entry_indices: z.array(z.number()).default([]),
          entries_summary: z
            .array(z.object({ method: z.string().optional(), path: z.string().optional() }).loose())
            .default([]),
        }),
      )
      .default([]),
    correlations: z
      .array(
        z.object({
          source_entry_index: z.number(),
          target_location: z.string().default(''),
          suggested_session_var: z.string(),
          confidence: z.number(),
        }),
      )
      .default([]),
    ambiguous_producers: z.array(z.object({ target_location: z.string().default('') })).default([]),
    evidence_coverage: z
      .object({
        response_body_ratio: z.number().default(0),
        stripped_response_body_ratio: z.number().default(0),
      })
      .default({ response_body_ratio: 0, stripped_response_body_ratio: 0 }),
    warnings: z.array(z.object({ code: z.string().optional() }).loose()).default([]),
  }),
);

const AUTHORIZATION = 'header:authorization';

/** A path of a request without its query: the query can carry values of the session. */
const bare = (path: string): string => path.split(/[?#]/u, 1)[0] ?? '';

/** `POST …/har/{id}/analyze`: groups the requests and finds the values passed between them. */
export async function analyzeHar(
  api: ApiContext,
  projectId: string,
  sessionId: string,
): Promise<HarAnalysis> {
  const data = analysisSchema.parse(
    await quietly(() =>
      must(
        api.services.http.POST('/api/v1/projects/{project_id}/har/{har_session_id}/analyze', {
          params: { path: { project_id: projectId, har_session_id: sessionId } },
          signal: api.signal,
          timeoutMs: HAR_CALL_TIMEOUT_MS,
        }),
      ),
    ),
  );
  return {
    groups: data.action_groups.map((group) => ({
      name: group.name,
      entryIndices: group.entry_indices,
      requests: group.entries_summary.map((request) => ({
        method: request.method ?? '',
        path: bare(request.path ?? ''),
      })),
    })),
    correlations: data.correlations.map((correlation) => ({
      variable: correlation.suggested_session_var,
      confidence: correlation.confidence,
      sentAsAuth: correlation.target_location.toLowerCase() === AUTHORIZATION,
      sourceEntry: correlation.source_entry_index,
    })),
    ambiguousLocations: data.ambiguous_producers.map((producer) => producer.target_location),
    responseBodyRatio: data.evidence_coverage.response_body_ratio,
    strippedResponseBodyRatio: data.evidence_coverage.stripped_response_body_ratio,
    warningCodes: codesOf(data.warnings),
  };
}

export interface DefaultEnvironment {
  readonly name: string;
  /** Hosts of its API and application addresses, lower case, with a non-default port. */
  readonly hosts: readonly string[];
}

const hostOf = (address: string | null | undefined): string[] => {
  if (address === null || address === undefined || address === '') return [];
  try {
    return [new URL(address).host.toLowerCase()];
  } catch {
    return [];
  }
};

/** The project's default environment, which the recorded address is compared with; null if none. */
export async function getDefaultEnvironment(
  api: SecretApiContext,
  projectId: string,
): Promise<DefaultEnvironment | null> {
  const data = await callOperation(
    api.services.http,
    'list_project_environments_api_v1_projects__project_id__environments_get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  const found = data.items.find((item) => item.is_default);
  if (found === undefined) return null;
  return { name: found.name, hosts: [...hostOf(found.base_url), ...hostOf(found.frontend_url)] };
}

/** A flow LoadCraft saved from a recording. */
export interface HarFlow {
  readonly flowId: string;
  readonly name: string;
}

const generatedSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/har/{har_session_id}/generate', 'post'>
>()(
  z.object({
    flow_id: z.string(),
    flow_name: z.string(),
    flows: z.array(z.object({ flow_id: z.string(), flow_name: z.string() })).nullish(),
  }),
);

/**
 * The flows of a generation answer: every flow of a split, or the one flow (`flows` is null then).
 * The same shape comes back from REST and in the `har:complete` frame of the channel.
 */
export function harFlowsOf(answer: unknown): HarFlow[] {
  const parsed = generatedSchema.parse(answer);
  const flows = parsed.flows ?? [{ flow_id: parsed.flow_id, flow_name: parsed.flow_name }];
  return flows.map((flow) => ({ flowId: flow.flow_id, name: flow.flow_name }));
}

/**
 * `POST …/har/{id}/generate`: one flow from the whole recording, saved under `flowName`. The call
 * waits for the language model (about two minutes) and never pauses for a split.
 */
export async function generateHarFlow(
  api: SecretApiContext,
  projectId: string,
  sessionId: string,
  flowName: string,
): Promise<HarFlow[]> {
  let data: unknown;
  try {
    data = await callOperation(
      api.services.http,
      'generate_flow_api_v1_projects__project_id__har__har_session_id__generate_post',
      {
        path: { project_id: projectId, har_session_id: sessionId },
        body: { flow_name: flowName },
      },
      { signal: api.signal, timeoutMs: HAR_CALL_TIMEOUT_MS, secrets: api.secrets },
    );
  } catch (error) {
    if (
      error instanceof LoadcraftApiError &&
      error.status === 422 &&
      error.message.includes(SANITIZED_MARKER)
    ) {
      throw new ToolError('har_recording_incomplete');
    }
    throw withoutBackendText(error);
  }
  return harFlowsOf(data);
}

/** `POST …/har/{id}/cancel`: stops whatever the session is generating; false when nothing was. */
export async function cancelHarSession(
  api: ApiContext,
  projectId: string,
  sessionId: string,
): Promise<boolean> {
  return stopRequest(async () => {
    const data = await quietly(() =>
      must(
        api.services.http.POST('/api/v1/projects/{project_id}/har/{har_session_id}/cancel', {
          params: { path: { project_id: projectId, har_session_id: sessionId } },
          signal: api.signal,
        }),
      ),
    );
    return data.cancelled;
  });
}
