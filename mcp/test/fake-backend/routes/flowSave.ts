// Routes of the direct save of a flow (`flows_save`): `POST …/flows` creates one (version 1), `PUT …/flows/{id}`
// changes one. The PUT is partial: a field left out or null stays. A NEW VERSION is made only when the graph is
// given (`blocks`, `edges`, `entry_block_id`, `variables`, `input_config`) and carries `change_reason`; a new name,
// a description, tags or a timeout change the flow and make none. A graph is linted as far as the fake can: `blocks:
// []` on an update is refused, an entry that names no block is refused (422). The answer is the whole flow.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { FLOW_COLLECTIONS } from './flows.js';
import { seedFlowVersion } from './flowWrites.js';

type FlowDetail = components['schemas']['FlowDetail'];
type CreateFlowRequest = components['schemas']['CreateFlowRequest'];
type UpdateFlowRequest = components['schemas']['UpdateFlowRequest'];

const NOW = '2026-11-27T12:00:00Z';

function requireProject(store: Store, projectId: string): void {
  store
    .collection<{ id: string }>(FLOW_COLLECTIONS.projects)
    .require(projectId, `Project not found: ${projectId}`);
}

function flowOf(store: Store, projectId: string, flowId: string): FlowDetail {
  requireProject(store, projectId);
  const flow = store
    .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
    .require(flowId, `Flow not found: ${flowId}`);
  if (flow.project_id !== projectId) {
    throw new FakeHttpError(404, { detail: `Flow ${flowId} not found in project ${projectId}` });
  }
  return flow;
}

/** The lint the fake knows: a non-empty graph whose entry names one of its blocks. */
function lint(blocks: readonly Record<string, unknown>[], entry: string | null | undefined): void {
  if (blocks.length === 0) return;
  const ids = new Set(blocks.map((block) => String(block['id'])));
  if (entry !== null && entry !== undefined && !ids.has(entry)) {
    throw new FakeHttpError(422, {
      detail: `flow_entry_unresolvable: entry block ${entry} is not a block of the flow`,
    });
  }
}

const registered = new WeakSet<Fake>();

export function registerFlowSaveRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('POST', '/api/v1/projects/{project_id}/flows', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as CreateFlowRequest;
    if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 255) {
      throw new FakeHttpError(422, {
        detail: [
          { type: 'string_length', loc: ['body', 'name'], msg: 'name must be 1-255 characters' },
        ],
      });
    }
    const blocks = body.blocks ?? [];
    lint(blocks, body.entry_block_id);
    const flow: FlowDetail = {
      id: store.newId(),
      project_id: req.params.project_id,
      name: body.name,
      description: body.description ?? null,
      flow_type: body.flow_type,
      blocks: structuredClone(blocks),
      edges: structuredClone(body.edges ?? []),
      entry_block_id: body.entry_block_id ?? null,
      variables: structuredClone(body.variables ?? {}),
      timeout_ms: body.timeout_ms,
      retry_count: body.retry_count,
      retry_delay_ms: body.retry_delay_ms,
      tags: body.tags ?? [],
      is_active: true,
      can_regenerate: false,
      generated_by: null,
      generation_description: null,
      source_endpoints: [],
      source_operations: [],
      created_by: null,
      current_version: 1,
      created_at: NOW,
      updated_at: NOW,
    };
    store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).insert(flow);
    seedFlowVersion(store, flow, 1, null);
    return { status: 200, body: flow };
  });

  fake.route('PUT', '/api/v1/projects/{project_id}/flows/{flow_id}', (req, store) => {
    const flow = flowOf(store, req.params.project_id, req.params.flow_id);
    const body = req.body as UpdateFlowRequest;
    const graph =
      body.blocks != null ||
      body.edges != null ||
      body.entry_block_id != null ||
      body.variables != null ||
      body.input_config != null;
    if (body.blocks != null && body.blocks.length === 0) {
      throw new FakeHttpError(422, { detail: 'NON_EMPTY: a flow needs at least one block' });
    }
    lint(body.blocks ?? flow.blocks, body.entry_block_id ?? flow.entry_block_id);
    const next = graph ? flow.current_version + 1 : flow.current_version;
    const updated = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows).update(flow.id, {
      ...(body.name == null ? {} : { name: body.name }),
      ...(body.description == null ? {} : { description: body.description }),
      ...(body.tags == null ? {} : { tags: body.tags }),
      ...(body.is_active == null ? {} : { is_active: body.is_active }),
      ...(body.blocks == null ? {} : { blocks: structuredClone(body.blocks) }),
      ...(body.edges == null ? {} : { edges: structuredClone(body.edges) }),
      ...(body.entry_block_id == null ? {} : { entry_block_id: body.entry_block_id }),
      ...(body.variables == null ? {} : { variables: structuredClone(body.variables) }),
      current_version: next,
      updated_at: NOW,
    });
    if (graph) seedFlowVersion(store, updated, next, body.change_reason ?? null);
    return { status: 200, body: updated };
  });
}
