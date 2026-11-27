// Flow suggestions of the LoadCraft REST API: the free heuristic, the refinement (an answer from the
// backend's cache or a background job) and the operations of the project's specification that
// name the steps of a proposal. The answers carry more than the tools show; each read keeps only
// what the views and the saved baskets need.

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { must, stopRequest, type ApiContext } from './context.js';

/** A proposal as the backend describes it; `flows_generate_from_suggestions` generates a flow from it by name. */
export interface Basket {
  readonly name: string;
  /** Editable description for the generator. */
  readonly description: string;
  /** OpenAPI endpoint ids (UUIDs), in the order of the steps. */
  readonly endpointIds: readonly string[];
  readonly patternType: string;
  readonly tags: readonly string[];
  readonly confidence?: number;
  readonly reasoning?: string;
}

export interface Suggestions {
  readonly baskets: Basket[];
  /** Operations that appear in some proposal. */
  readonly covered: number;
  /** Endpoint ids no proposal contains. */
  readonly uncoveredIds: string[];
  /** Names of the refinement units that did not finish. */
  readonly failedUnits: string[];
  /** Hash of the specification the answer is keyed on. */
  readonly specHash: string | null;
}

/** The answer of `POST …/refine`: the result at once, or the job that will deliver it. */
export type RefineAnswer =
  | { readonly kind: 'result'; readonly result: Suggestions }
  | { readonly kind: 'job'; readonly jobId: string; readonly joined: boolean };

/** One operation of the specification. */
export interface EndpointRef {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string | null;
  readonly operationId: string | null;
}

const basketSchema = z.looseObject({
  name: z.string().default(''),
  description: z.string().default(''),
  endpoint_ids: z.array(z.string()).default([]),
  pattern_type: z.string().default('semantic'),
  tags: z.array(z.string()).default([]),
  confidence: z.number().nullish(),
  reasoning: z.string().nullish(),
});

const suggestionsSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/flow-suggestions/heuristic', 'post'>
>()(
  z.looseObject({
    baskets: z.array(basketSchema).default([]),
    total_endpoints_covered: z.number().default(0),
    uncovered_endpoint_ids: z.array(z.string()).default([]),
    units: z
      .array(z.looseObject({ name: z.string().default(''), status: z.string().default('') }))
      .default([]),
    openapi_hash: z.string().nullish(),
  }),
);

const refineSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/flow-suggestions/refine', 'post'>
>()(
  z.looseObject({
    job_id: z.string().nullish(),
    joined: z.boolean().default(false),
  }),
);

const endpointsSchema = reads<ResponseOf<'/api/v1/projects/{project_id}/openapi', 'get'>>()(
  z.looseObject({
    endpoints: z.array(
      z.looseObject({
        id: z.string().nullish(),
        method: z.string(),
        path: z.string(),
        summary: z.string().nullish(),
        operation_id: z.string().nullish(),
      }),
    ),
  }),
);

/**
 * The proposals of an answer (the body of a heuristic or a cached refine answer, or the `result`
 * of the channel's complete frame). A body outside the contract is a bad answer, not a crash.
 */
export function parseSuggestions(raw: unknown): Suggestions {
  const checked = suggestionsSchema.safeParse(raw);
  if (!checked.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered with flow suggestions the plugin cannot read.',
      cause: checked.error,
    });
  }
  const body = checked.data;
  return {
    baskets: body.baskets.map((basket) => ({
      name: basket.name,
      description: basket.description,
      endpointIds: basket.endpoint_ids,
      patternType: basket.pattern_type,
      tags: basket.tags,
      ...(basket.confidence == null ? {} : { confidence: basket.confidence }),
      ...(basket.reasoning == null || basket.reasoning === ''
        ? {}
        : { reasoning: basket.reasoning }),
    })),
    covered: body.total_endpoints_covered,
    uncoveredIds: body.uncovered_endpoint_ids,
    failedUnits: body.units.filter((unit) => unit.status === 'failed').map((unit) => unit.name),
    specHash: body.openapi_hash ?? null,
  };
}

function noSpecification(error: unknown): ToolError | undefined {
  if (!(error instanceof LoadcraftApiError)) return undefined;
  const text = error.message.toLowerCase();
  const missing =
    (error.status === 400 && text.includes('no openapi spec')) ||
    (error.status === 404 && text.includes('openapi spec not found'));
  return missing ? new ToolError('no_openapi_spec', { cause: error }) : undefined;
}

/** `POST …/flow-suggestions/heuristic`: free and immediate, no model involved. */
export async function getHeuristicSuggestions(
  api: ApiContext,
  projectId: string,
): Promise<Suggestions> {
  try {
    const data = await must(
      api.services.http.POST('/api/v1/projects/{project_id}/flow-suggestions/heuristic', {
        params: { path: { project_id: projectId } },
        signal: api.signal,
      }),
    );
    return parseSuggestions(data);
  } catch (error) {
    throw noSpecification(error) ?? error;
  }
}

/** The job of a refinement that is already running, named by a 409 of the backend. */
function runningJob(error: unknown): string | undefined {
  if (!(error instanceof LoadcraftApiError) || error.status !== 409) return undefined;
  if (error.code !== 'refine_in_progress') return undefined;
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('job_id' in details)) return undefined;
  return typeof details.job_id === 'string' && details.job_id !== '' ? details.job_id : undefined;
}

/**
 * `POST …/flow-suggestions/refine`: a refinement in the backend's cache comes back whole, otherwise
 * a background job starts (or an identical running one is joined) and only its id comes back.
 * Without `force` it is also how the result of a finished job is read.
 */
export async function startRefine(
  api: ApiContext,
  projectId: string,
  options: { force?: boolean } = {},
): Promise<RefineAnswer> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.POST('/api/v1/projects/{project_id}/flow-suggestions/refine', {
        params: { path: { project_id: projectId } },
        body: { force: options.force ?? false },
        signal: api.signal,
      }),
    );
  } catch (error) {
    const joined = runningJob(error);
    if (joined !== undefined) return { kind: 'job', jobId: joined, joined: true };
    throw noSpecification(error) ?? error;
  }
  const answer = refineSchema.safeParse(data);
  if (!answer.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered the refinement with something the plugin cannot read.',
      cause: answer.error,
    });
  }
  const { job_id: jobId, joined } = answer.data;
  if (jobId != null && jobId !== '') return { kind: 'job', jobId, joined };
  return { kind: 'result', result: parseSuggestions(data) };
}

/**
 * Stops a refine job at the user's request (`reason=user`, which always stops it); `false` when the
 * job is unknown or LoadCraft reports it did not stop.
 */
export function cancelRefine(api: ApiContext, projectId: string, jobId: string): Promise<boolean> {
  return stopRequest(async () => {
    const answer = await must(
      api.services.http.POST(
        '/api/v1/projects/{project_id}/flow-suggestions/refine/{job_id}/cancel',
        {
          params: { path: { project_id: projectId, job_id: jobId }, query: { reason: 'user' } },
          signal: api.signal,
        },
      ),
    );
    return answer.cancelled;
  });
}

/** Operations of the project's current specification; the document's own text is dropped here. */
export async function listEndpoints(api: ApiContext, projectId: string): Promise<EndpointRef[]> {
  let data: unknown;
  try {
    data = await must(
      api.services.http.GET('/api/v1/projects/{project_id}/openapi', {
        params: { path: { project_id: projectId } },
        signal: api.signal,
      }),
    );
  } catch (error) {
    throw noSpecification(error) ?? error;
  }
  const checked = endpointsSchema.safeParse(data);
  if (!checked.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered with a specification the plugin cannot read.',
      cause: checked.error,
    });
  }
  return checked.data.endpoints.flatMap((endpoint) =>
    endpoint.id == null || endpoint.id === ''
      ? []
      : [
          {
            id: endpoint.id,
            method: endpoint.method,
            path: endpoint.path,
            summary: endpoint.summary ?? null,
            operationId: endpoint.operation_id ?? null,
          },
        ],
  );
}
