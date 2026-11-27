// `functional_get_flows` (module functional): Get functional test flows (block graphs, per docs
// version): list, one, or version history.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The flows are not read by project: the list is narrowed to a documentation version (`docs_id`,
// default `ids.docs_id` of the state, none: every flow the token sees). A flow is named by its id (one
// read) or its name (found in the list). The block graph is shown as the first blocks with their
// type and label; every text in it was written by a person or a model, so it passes `content`.
// Log: args "", result "{count} functional flows": the data carries the count.
// Arguments (the catalog's): `flow`, `view`, `docs_id`, `limit`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetFlows,
  type BlockRow,
  type FlowDetail,
  type FlowRow,
  type FlowsData,
  type VersionRow,
} from '../../render/functional/getFlows.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { LIMITS, isUuid, refuseRule, thirdParty, thirdPartyOrNull } from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { pickNamed } from '../run/common.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_GET_FLOWS } from './meta.generated.js';

/** GET /test-flows (REST API v1) */
export function listTestFlows(
  ctx: CallContext,
  query?: QueryOf<'list_test_flows_api_v1_test_flows_get'>,
): Promise<OpOutput<'list_test_flows_api_v1_test_flows_get'>> {
  return callBackend(ctx, 'list_test_flows_api_v1_test_flows_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /test-flows/{flow_id} (REST API v1) */
export function getTestFlow(
  ctx: CallContext,
  path: { readonly flow_id: string },
): Promise<OpOutput<'get_test_flow_api_v1_test_flows__flow_id__get'>> {
  return callBackend(ctx, 'get_test_flow_api_v1_test_flows__flow_id__get', { path });
}

/** GET /test-flows/{flow_id}/versions (REST API v1) */
export function listVersions(
  ctx: CallContext,
  path: { readonly flow_id: string },
): Promise<OpOutput<'list_versions_api_v1_test_flows__flow_id__versions_get'>> {
  return callBackend(ctx, 'list_versions_api_v1_test_flows__flow_id__versions_get', { path });
}

const ITEMS_SHOWN = 50;
const BLOCKS_SHOWN = 40;
const VARIABLES_SHOWN = 20;
const TAGS_SHOWN = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Summary = OpOutput<'list_test_flows_api_v1_test_flows_get'>[number];
type Detail = OpOutput<'get_test_flow_api_v1_test_flows__flow_id__get'>;

function rowOf(ctx: CallContext, flow: Summary): FlowRow {
  return {
    id: flow.id,
    name: thirdParty(ctx, flow.name, LIMITS.name),
    description: thirdPartyOrNull(ctx, flow.description, LIMITS.sentence),
    version: thirdParty(ctx, flow.version, LIMITS.name),
    blocksCount: flow.blocks_count,
    active: flow.is_active,
    tags: (flow.tags ?? []).slice(0, TAGS_SHOWN).map((tag) => thirdParty(ctx, tag, LIMITS.name)),
    updatedAt: flow.updated_at,
  };
}

function blockOf(ctx: CallContext, block: Readonly<Record<string, unknown>>): BlockRow {
  const word = (key: string): string | null => {
    const value = block[key];
    return typeof value === 'string' && value !== '' ? thirdParty(ctx, value, LIMITS.name) : null;
  };
  return {
    id: word('id'),
    type: word('type'),
    label: word('name') ?? word('label') ?? word('title'),
  };
}

function detailOf(ctx: CallContext, flow: Detail): FlowDetail {
  const variables = Object.keys(flow.variables ?? {});
  return {
    ...rowOf(ctx, flow),
    specId: flow.openapi_spec_id,
    entryBlockId: thirdPartyOrNull(ctx, flow.entry_block_id, LIMITS.name),
    timeoutMs: flow.timeout_ms,
    retryCount: flow.retry_count,
    retryDelayMs: flow.retry_delay_ms,
    blocks: (flow.blocks ?? []).slice(0, BLOCKS_SHOWN).map((block) => blockOf(ctx, block)),
    edges: (flow.edges ?? []).length,
    variables: variables
      .slice(0, VARIABLES_SHOWN)
      .map((name) => thirdParty(ctx, name, LIMITS.name)),
    variableCount: variables.length,
  };
}

const empty = (view: FlowsData['view'], docsId: string | null, limit: number): FlowsData => ({
  view,
  docsId,
  count: 0,
  shown: 0,
  limit,
  items: [],
  flow: null,
  versionsOf: null,
  versions: [],
});

export const functionalGetFlows = moduleTool(FUNCTIONAL_GET_FLOWS, {
  title: 'Get functional test flows',
  input: {
    flow: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('One functional flow (id); without it, the list.'),
    view: z
      .enum(['list', 'versions'])
      .default('list')
      .describe('list (default) or the versions of one flow.'),
    docs_id: uuidArgument()
      .optional()
      .describe('Only flows of this documentation version; default: the one of this workspace.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many flows to return (1-200).'),
  },
  async run(ctx, args) {
    const kept = fromState(ctx, 'ids.docs_id');
    const docsId =
      args.docs_id ??
      (typeof kept === 'string' && UUID.test(kept) ? kept.toLowerCase() : undefined);
    if (args.view === 'versions' && args.flow === undefined) {
      refuseRule('versions_without_flow');
    }
    const given = args.flow?.trim();
    const byId = given !== undefined && isUuid(given);
    // a flow by name is found in the list of the documentation version
    const all =
      given !== undefined && byId
        ? null
        : await listTestFlows(ctx, {
            ...(docsId === undefined ? {} : { spec_id: docsId }),
            limit: args.limit,
          });
    let flowId: string | null = byId ? given.toLowerCase() : null;
    if (given !== undefined && !byId && all !== null) {
      flowId = pickNamed(
        ctx,
        'flow',
        given,
        all.map((item) => ({ id: item.id, name: item.name })),
      ).id;
    }
    if (flowId !== null) {
      const flow = await getTestFlow(ctx, { flow_id: flowId });
      if (args.view === 'versions') {
        const versions = await listVersions(ctx, { flow_id: flowId });
        const rows: VersionRow[] = versions.slice(0, ITEMS_SHOWN).map((version) => ({
          id: version.id,
          version: thirdParty(ctx, version.version, LIMITS.name),
          createdAt: version.created_at,
          changeReason: thirdPartyOrNull(ctx, version.change_reason, LIMITS.sentence),
        }));
        const data: FlowsData = {
          ...empty('versions', docsId ?? null, args.limit),
          count: versions.length,
          shown: rows.length,
          versionsOf: { id: flowId, name: thirdParty(ctx, flow.name, LIMITS.name) },
          versions: rows,
        };
        return { status: 'done', data };
      }
      const data: FlowsData = {
        ...empty('list', docsId ?? null, args.limit),
        count: 1,
        flow: detailOf(ctx, flow),
      };
      return { status: 'done', data };
    }
    const list = all ?? [];
    const items = list.slice(0, ITEMS_SHOWN).map((flow) => rowOf(ctx, flow));
    const data: FlowsData = {
      ...empty('list', docsId ?? null, args.limit),
      count: list.length,
      shown: items.length,
      items,
    };
    return { status: 'done', data };
  },
  render: renderGetFlows,
});
