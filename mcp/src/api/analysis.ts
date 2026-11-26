// Reads behind `results_analyze_run`: the stored AI analysis of a run, the start of a new one, and the
// error groups whose counts the diagnosis shows. The analysis document is written by a model from
// material that includes the customer's own logs, so every string leaves this file as data:
// line breaks, control characters and terminal escape sequences are removed on the way in.

// Namespace import: the bundler keeps only what is used; `import { z } from 'zod'` pulls in all of zod.
import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { inline } from '../render/primitives.js';
import { must, type ApiContext } from './context.js';
import { reads, type ResponseOf } from '../contract/reads.js';

// ---- cleaning ---------------------------------------------------------------------------

/** Quotation marks that could close the frame the view puts around a quote. */
const QUOTE_MARKS = /[„“”«»]/gu;

/** The longest quote the diagnosis shows, in characters. */
export const QUOTE_LIMIT = 120;

/**
 * A quotation from a log: on one line and cleaned (`inline`), with the marks that could end the
 * quotation early turned into plain ones, and cut to `QUOTE_LIMIT` characters (the last one is
 * `…` when it was cut).
 */
export function cleanQuote(raw: string): string {
  return inline(raw, QUOTE_LIMIT).replace(QUOTE_MARKS, '"');
}

// ---- the document -----------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';

export interface ErrorAnalysis {
  readonly errorHash: string;
  readonly status: number | null;
  readonly cause: string;
  readonly confidence: Confidence;
  /** Quotations, cleaned and cut (`cleanQuote`); `sources[i]` says where `evidence[i]` came from. */
  readonly evidence: readonly string[];
  /** `run` or `mcp:<tool>`; empty when the project has no telemetry source. */
  readonly sources: readonly string[];
  readonly fixes: readonly string[];
}

export interface PerformanceConcern {
  readonly endpoint: string;
  readonly metric: string;
  readonly observed: number | null;
  readonly summary: string;
  /** `T+m:ss` as the analysis wrote it; empty when the concern is not a step. */
  readonly windowStart: string;
  readonly beforeMs: number | null;
}

export interface AnalysisDocument {
  readonly verdict: string;
  readonly confidence: Confidence;
  readonly summary: string;
  readonly errorAnalyses: readonly ErrorAnalysis[];
  readonly performanceConcerns: readonly PerformanceConcern[];
  readonly recommendations: readonly string[];
  /** The telemetry source the evidence was taken from; absent when the project has none. */
  readonly telemetry?: {
    readonly label: string;
    readonly window: { readonly start: string; readonly end: string } | null;
  };
}

/** A stored analysis: the document and what the backend books beside it. */
export interface AnalysisRecord {
  /** Identifies the stored row; absent in the answer that only says the analysis was cached. */
  readonly id: string | null;
  readonly costUsd: number | null;
  readonly document: AnalysisDocument;
}

const nullable = <T extends z.ZodType>(schema: T) =>
  schema
    .nullish()
    .catch(null)
    .transform((value) => value ?? null);

const text = z
  .string()
  .catch('')
  .transform((value) => inline(value));
const texts = z.array(z.string().transform((value) => inline(value))).catch([]);
const confidence = z.enum(['high', 'medium', 'low']).catch('low');

const errorAnalysisSchema = z
  .object({
    error_hash: text,
    http_status: nullable(z.number()),
    probable_cause: text,
    confidence,
    evidence: z.array(z.string().transform(cleanQuote)).catch([]),
    evidence_sources: z.array(z.string()).catch([]),
    suggested_fixes: texts,
  })
  .transform((item): ErrorAnalysis => ({
    errorHash: item.error_hash,
    status: item.http_status,
    cause: item.probable_cause,
    confidence: item.confidence,
    evidence: item.evidence,
    sources: item.evidence_sources,
    fixes: item.suggested_fixes,
  }));

const concernSchema = z
  .object({
    endpoint: text,
    metric: text,
    observed: nullable(z.number()),
    summary: text,
    window_start_offset: text,
    before_ms: nullable(z.number()),
  })
  .transform((item): PerformanceConcern => ({
    endpoint: item.endpoint,
    metric: item.metric,
    observed: item.observed,
    summary: item.summary,
    windowStart: item.window_start_offset,
    beforeMs: item.before_ms,
  }));

const telemetrySchema = z
  .object({
    source: z.object({ label: text }),
    window: z
      .object({ start: z.string(), end: z.string() })
      .nullish()
      .catch(null)
      .transform((window) => window ?? null),
  })
  .nullish()
  .catch(null);

const documentSchema = reads<ResponseOf<typeof ANALYSIS_PATH, 'get'>['analysis']>()(
  z
    .object({
      verdict: text,
      summary: text,
      confidence,
      error_analyses: z.array(errorAnalysisSchema).catch([]),
      performance_concerns: z.array(concernSchema).catch([]),
      recommendations: texts,
      external_evidence: telemetrySchema,
    })
    .transform((item): AnalysisDocument => ({
      verdict: item.verdict,
      confidence: item.confidence,
      summary: item.summary,
      errorAnalyses: item.error_analyses,
      performanceConcerns: item.performance_concerns,
      recommendations: item.recommendations,
      ...(item.external_evidence == null
        ? {}
        : {
            telemetry: {
              label: item.external_evidence.source.label,
              window: item.external_evidence.window,
            },
          }),
    })),
);

/** The `analysis` document of a stored row or of a `complete` frame, narrowed to what is read. */
export function parseAnalysisDocument(raw: unknown): AnalysisDocument {
  return documentSchema.parse(raw);
}

// ---- reads ------------------------------------------------------------------------------

const storedSchema = reads<ResponseOf<typeof ANALYSIS_PATH, 'get'>>()(
  z.object({
    id: nullable(z.string()),
    cost_usd: nullable(z.number()),
    analysis: z.unknown(),
  }),
);

const analysisField = reads<ResponseOf<typeof ANALYSIS_PATH, 'get'>>()(
  z.object({ analysis: z.unknown() }),
);

function toRecord(raw: unknown, document: unknown): AnalysisRecord {
  const row = storedSchema.parse(raw);
  return { id: row.id, costUsd: row.cost_usd, document: parseAnalysisDocument(document) };
}

const ANALYSIS_PATH =
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analysis' as const;
const ANALYZE_PATH =
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/analyze-async' as const;
const ERRORS_PATH =
  '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/errors' as const;

/**
 * The newest stored analysis of the run, or null while there is none. The backend answers 404 for
 * "not started", "still running" and "failed" alike, so null never says which of the three it is.
 */
export async function getAnalysis(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<AnalysisRecord | null> {
  try {
    const data = await must(
      api.services.http.GET(ANALYSIS_PATH, {
        params: { path: { project_id: projectId, execution_id: executionId } },
        signal: api.signal,
      }),
    );
    return toRecord(data, analysisField.parse(data).analysis);
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return null;
    throw error;
  }
}

export type StartedAnalysis =
  | { readonly kind: 'cached'; readonly record: AnalysisRecord }
  | { readonly kind: 'started'; readonly runId: string };

const startedSchema = reads<ResponseOf<typeof ANALYZE_PATH, 'post'>>()(
  // One answer for both outcomes: `cached: true` carries the stored document, anything else the
  // key of the run that was started.
  z.object({
    cached: z.boolean().optional(),
    analysis: z.unknown().optional(),
    cost_usd: nullable(z.number()),
    run_id: z.string().optional(),
  }),
);

/**
 * Asks for an analysis. Every call that does not get a stored one back starts a NEW paid run: the
 * backend does not recognise a run already under way, so the caller must not ask twice.
 */
export async function startAnalysis(
  api: ApiContext,
  projectId: string,
  executionId: string,
  force: boolean,
): Promise<StartedAnalysis> {
  const data = await must(
    api.services.http.POST(ANALYZE_PATH, {
      params: {
        path: { project_id: projectId, execution_id: executionId },
        ...(force ? { query: { force: true } } : {}),
      },
      signal: api.signal,
    }),
  );
  const parsed = startedSchema.safeParse(data);
  if (parsed.success && parsed.data.cached === true) {
    return {
      kind: 'cached',
      record: {
        id: null,
        costUsd: parsed.data.cost_usd,
        document: parseAnalysisDocument(parsed.data.analysis),
      },
    };
  }
  const runId = parsed.success ? parsed.data.run_id : undefined;
  if (runId === undefined || runId === '') {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered the analysis request with neither a document nor a run.',
    });
  }
  return { kind: 'started', runId };
}

export interface ErrorGroup {
  readonly hash: string;
  /** HTTP status; null for a group that is not a status (a failed check). */
  readonly status: number | null;
  readonly message: string;
  readonly count: number;
  readonly endpoints: readonly string[];
}

const groupsSchema = reads<ResponseOf<typeof ERRORS_PATH, 'get'>>()(
  z.object({
    errors: z
      .array(
        z.object({
          error_hash: text,
          message: text,
          http_status: nullable(z.number()),
          count: z.number(),
          affected_endpoints: texts,
        }),
      )
      .catch([]),
  }),
);

/** The error groups of the run, as the Errors tab counts them. */
export async function listErrorGroups(
  api: ApiContext,
  projectId: string,
  executionId: string,
): Promise<ErrorGroup[]> {
  const data = await must(
    api.services.http.GET(ERRORS_PATH, {
      params: { path: { project_id: projectId, execution_id: executionId } },
      signal: api.signal,
    }),
  );
  return groupsSchema.parse(data).errors.map((group) => ({
    hash: group.error_hash,
    status: group.http_status,
    message: group.message,
    count: group.count,
    endpoints: group.affected_endpoints,
  }));
}
