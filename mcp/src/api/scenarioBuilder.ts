// Scenario-builder chat of the LoadCraft REST API. `draft_id` is invented by the caller: the server
// keeps the conversation under `scenario-builder:{project}:{draft}` and has no record to create.

import { LoadcraftApiError } from '../http/apiError.js';
import { must, type ApiContext } from './context.js';

/** One row of the plan the model proposed; `proportion` is a percent (0, 100]. */
export interface ProposedShare {
  readonly flowId: string;
  readonly proportion: number;
}

/** Backend codes that mean "the language model gave no answer", not "the request is wrong". */
const MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'llm_generation_failed',
  'llm_not_configured',
  'llm_provider_failed',
  'prompt_over_budget',
]);
const MODEL_UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([502, 503]);

function modelUnavailable(error: unknown): boolean {
  return (
    error instanceof LoadcraftApiError &&
    (MODEL_UNAVAILABLE_CODES.has(error.code) || MODEL_UNAVAILABLE_STATUSES.has(error.status))
  );
}

/**
 * One turn of the chat about `flowIds`: the plan the model proposed, as its rows. Empty when the
 * model answered without a plan or was unavailable; every other refusal (401, 404, ...) is thrown.
 */
export async function askForSplit(
  api: ApiContext,
  projectId: string,
  draftId: string,
  flowIds: readonly string[],
  message: string,
): Promise<ProposedShare[]> {
  try {
    const answer = await must(
      api.services.http.POST('/api/v1/projects/{project_id}/scenario-builder/{draft_id}/messages', {
        params: { path: { project_id: projectId, draft_id: draftId } },
        body: { message, kind: 'chat', selected_flow_ids: [...flowIds] },
        signal: api.signal,
      }),
    );
    return (answer.proposal?.entries ?? []).map((entry) => ({
      flowId: entry.flow_id,
      proportion: entry.proportion,
    }));
  } catch (error) {
    if (modelUnavailable(error)) return [];
    throw error;
  }
}
