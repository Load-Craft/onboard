// Generation of one flow from a description and a list of endpoints: the start of a run
// (`POST …/flows/generate-async`) and the read of its state. The run goes on in the background
// whether or not anybody listens, and its state is kept by the backend, so this way needs no
// WebSocket channel: the state read is the only source of progress and of the result.

import * as z from 'zod';

import { ToolError } from '../errors.js';
import { must, type ApiContext } from './context.js';
import { reads, type ResponseOf } from '../contract/reads.js';

const startedSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/flows/generate-async', 'post'>
>()(z.looseObject({ run_id: z.string().min(1) }));

const statusSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/flows/flow-generation/{run_id}/status', 'get'>
>()(
  z.looseObject({
    status: z.string(),
    current_step: z.string().nullish(),
    progress_pct: z.number().nullish(),
    result_flow_id: z.string().nullish(),
    error_message: z.string().nullish(),
  }),
);

export interface FlowGenerationRequest {
  readonly name: string;
  readonly description: string;
  /** In the formats the backend accepts: `METHOD:/path`, a UUID, a path or an `operationId`. */
  readonly endpoints: readonly string[];
}

/** The state of a run as the plugin uses it. */
export interface FlowGenerationStatus {
  readonly phase: 'running' | 'completed' | 'failed' | 'cancelled';
  /** 0..100 */
  readonly progress: number;
  readonly step: string | null;
  readonly flowId: string | null;
  readonly error: string | null;
}

/** Starts the run and returns its id; the backend answers at once. */
export async function startFlowGeneration(
  api: ApiContext,
  projectId: string,
  request: FlowGenerationRequest,
): Promise<string> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/flows/generate-async', {
      params: { path: { project_id: projectId } },
      body: {
        description: request.description,
        flow_name: request.name,
        endpoint_ids: [...request.endpoints],
        flow_type: 'api',
        skip_validators: false,
      },
      signal: api.signal,
    }),
  );
  const checked = startedSchema.safeParse(data);
  if (!checked.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft started the flow generation without naming the run.',
      cause: checked.error,
    });
  }
  return checked.data.run_id;
}

/** The state of a run; a run the backend does not know answers 404 (`LoadcraftApiError`). */
export async function getFlowGenerationStatus(
  api: ApiContext,
  projectId: string,
  runId: string,
): Promise<FlowGenerationStatus> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/flows/flow-generation/{run_id}/status', {
      params: { path: { project_id: projectId, run_id: runId } },
      signal: api.signal,
    }),
  );
  const checked = statusSchema.safeParse(data);
  if (!checked.success) {
    throw new ToolError('bad_gateway', {
      message: 'LoadCraft answered with a flow generation state the plugin cannot read.',
      cause: checked.error,
    });
  }
  const { status, current_step, progress_pct, result_flow_id, error_message } = checked.data;
  const phase =
    status === 'completed' || status === 'failed' || status === 'cancelled' ? status : 'running';
  return {
    phase,
    progress: Math.min(100, Math.max(0, progress_pct ?? 0)),
    step: current_step ?? null,
    flowId: result_flow_id ?? null,
    error: error_message ?? null,
  };
}
