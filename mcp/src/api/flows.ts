// Flow reads of the LoadCraft REST API: one flow with its raw blocks and the items the generator left
// open on it, the list of a project, and the flows on an older docs version. Errors come from the
// HTTP client as `LoadcraftApiError`.

import * as z from 'zod';

import { reads, type ResponseOf } from '../contract/reads.js';
import type { FlowNeeds } from '../flow/needsInput.js';
import { flowQuestions, needsOfDetail, type FlowQuestion } from '../flow/questions.js';
import { needsCurrentDocs, outdatedFlows } from '../flow/oldDocs.js';
import type { components } from '../http/generated/api.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';

export type FlowDetail = components['schemas']['FlowDetail'];
export type FlowSummary = components['schemas']['FlowSummary'];

// the open items of a flow are read by `flow/questions.ts` (the tools of the modules need them too)
export { flowQuestions, needsOfDetail, type FlowQuestion };

/** The list endpoint has no paging; 100 is its maximum `limit`. */
const LIST_LIMIT = 100;

/** One flow with `blocks`, `edges` and `entry_block_id`: the input of `buildOutline`. */
export async function getFlow(
  api: SecretApiContext,
  projectId: string,
  flowId: string,
): Promise<FlowDetail> {
  return callOperation(
    api.services.http,
    'get_flow_api_v1_projects__project_id__flows__flow_id__get',
    {
      path: { project_id: projectId, flow_id: flowId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
}

/**
 * The newest flows of a project (at most `LIST_LIMIT`) and how many flows the project has in all;
 * the list has no paging, so `total` can be larger than the list.
 */
export async function listFlowsWithTotal(
  api: ApiContext,
  projectId: string,
): Promise<{ flows: FlowSummary[]; total: number }> {
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/flows', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
      signal: api.signal,
    }),
  );
  return { flows: data.flows, total: data.total };
}

/** Flows of a project, most recently updated first; `tags` keeps flows with any of them. */
export async function listFlows(
  api: ApiContext,
  projectId: string,
  options: { tags?: readonly string[] } = {},
): Promise<FlowSummary[]> {
  const tags =
    options.tags === undefined || options.tags.length === 0 ? {} : { tags: [...options.tags] };
  const data = await must(
    api.services.http.GET('/api/v1/projects/{project_id}/flows', {
      params: { path: { project_id: projectId }, query: { limit: LIST_LIMIT, ...tags } },
      signal: api.signal,
    }),
  );
  return data.flows;
}

/** The open items of a flow of the list, as its counts say (an older backend sends none: 0). */
export function needsOfSummary(flow: FlowSummary): FlowNeeds {
  return {
    id: flow.id,
    count: flow.needs_input_count ?? 0,
    definite: flow.needs_input_definite_count ?? 0,
  };
}

const projectDocs = reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(
  z.object({ openapi_spec_id: z.string().nullish() }),
);

/** `GET …/projects/{id}`: the project's current docs version, null when it has none. */
export async function getCurrentDocs(
  api: SecretApiContext,
  projectId: string,
): Promise<string | null> {
  const data = await callOperation(
    api.services.http,
    'get_project_api_v1_projects__project_id__get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return projectDocs.parse(data).openapi_spec_id ?? null;
}

export interface OldDocsFlows {
  /** Flows on an older docs version, sorted by name. */
  readonly flows: FlowSummary[];
  /** The project has more flows than the list returns: there may be more such flows. */
  readonly partial: boolean;
}

/**
 * Flows of the list pinned to a docs version other than the current one. `spec_status` of the list
 * decides; for a flow the server gave none, its pin is compared with `currentDocs` (read from the
 * project only when needed and not given). `total` (when known) says whether the list was cut.
 */
export async function flowsOnOldDocs(
  api: SecretApiContext,
  projectId: string,
  listed: { readonly flows: readonly FlowSummary[]; readonly total?: number },
  currentDocs?: string | null,
): Promise<OldDocsFlows> {
  const current =
    currentDocs !== undefined || !needsCurrentDocs(listed.flows)
      ? (currentDocs ?? null)
      : await getCurrentDocs(api, projectId);
  return {
    flows: outdatedFlows(listed.flows, current),
    partial: listed.total !== undefined && listed.total > listed.flows.length,
  };
}
