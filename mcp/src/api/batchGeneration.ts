// Batch generation of flows from approved proposals: the start of a run (`POST …/batch-generate`)
// and the one fact of the project's documentation that tells whether saved proposals are still
// current. The run itself is followed over the `batch` channel or read back through the flows list.

import * as z from 'zod';

import { ToolError } from '../errors.js';
import type { components } from '../http/generated/api.js';
import { must, type ApiContext } from './context.js';
import { getHeuristicSuggestions } from './suggestions.js';
import { reads, type ResponseOf } from '../contract/reads.js';

/** A proposal the user approved, as the backend takes it (`ApprovedBasket`). */
export type ApprovedBasket = components['schemas']['ApprovedBasket'];

const startedSchema = reads<
  ResponseOf<'/api/v1/projects/{project_id}/flow-suggestions/batch-generate', 'post'>
>()(z.looseObject({ run_id: z.string().min(1) }));

/**
 * Starts the run. The backend answers at once with the id of the run; the baskets are generated in
 * the background (five at a time), whether or not anybody listens.
 */
export async function startBatchGeneration(
  api: ApiContext,
  projectId: string,
  baskets: readonly ApprovedBasket[],
): Promise<string> {
  const data = await must(
    api.services.http.POST('/api/v1/projects/{project_id}/flow-suggestions/batch-generate', {
      params: { path: { project_id: projectId } },
      body: { baskets: [...baskets], skip_validators: false },
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

/**
 * Hash of the documentation the proposals are made from, as the free heuristic reports it (the same
 * value a saved proposal carries); null when LoadCraft does not report one.
 */
export async function currentSpecHash(api: ApiContext, projectId: string): Promise<string | null> {
  return (await getHeuristicSuggestions(api, projectId)).specHash;
}
