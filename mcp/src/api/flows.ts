// Flow reads of the LoadCraft REST API: one flow with its raw blocks and the items the generator left
// open on it, the list of a project, and the flows on an older docs version. Errors come from the
// HTTP client as `LoadcraftApiError`.

import * as z from 'zod';

import { reads, type ResponseOf } from '../contract/reads.js';
import type { FlowNeeds } from '../flow/needsInput.js';
import { needsCurrentDocs, outdatedFlows } from '../flow/oldDocs.js';
import type { components } from '../http/generated/api.js';
import { callOperation } from '../http/operation.js';
import { must, type ApiContext, type SecretApiContext } from './context.js';

export type FlowDetail = components['schemas']['FlowDetail'];
export type FlowSummary = components['schemas']['FlowSummary'];

/** A gap the generator could not fill: an item of `needs_input` of the flow. */
export interface FlowQuestion {
  field: string;
  question: string;
  why: string;
  /** The kind as the backend names it; a kind it does not type is given as it was stored. */
  kind: string;
  /** The steps the item is about (`credential_scheme`: the steps that carry the token). */
  steps?: string[];
  /** The documentation proves the steps fail: they get 401 as built. */
  definite?: boolean;
}

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

type NeedsInputItem = components['schemas']['NeedsInputItem'];

function questionOf(item: NeedsInputItem): FlowQuestion | undefined {
  const steps = (item.steps ?? []).filter((step) => step !== '');
  const question: FlowQuestion = {
    field: item.field ?? '',
    question: item.question ?? '',
    why: item.why ?? '',
    kind: item.kind ?? item.kind_raw ?? '',
    ...(steps.length === 0 ? {} : { steps }),
    ...(item.definite === true ? { definite: true } : {}),
  };
  return question.question === '' ? undefined : question;
}

/** The items the generator left open on a flow (`needs_input` of its detail), with a question. */
export function flowQuestions(flow: Pick<FlowDetail, 'needs_input'>): FlowQuestion[] {
  return (flow.needs_input ?? [])
    .map(questionOf)
    .filter((item): item is FlowQuestion => item !== undefined);
}

/** The open items of a flow of the list, as its counts say (an older backend sends none: 0). */
export function needsOfSummary(flow: FlowSummary): FlowNeeds {
  return {
    id: flow.id,
    count: flow.needs_input_count ?? 0,
    definite: flow.needs_input_definite_count ?? 0,
  };
}

/** The open items of a flow read in full. */
export function needsOfDetail(flow: Pick<FlowDetail, 'id' | 'needs_input'>): FlowNeeds {
  const items = flow.needs_input ?? [];
  return {
    id: flow.id,
    count: items.length,
    definite: items.filter((item) => item.definite === true).length,
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
