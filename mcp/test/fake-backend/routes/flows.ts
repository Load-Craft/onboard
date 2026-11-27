// Flow read routes of the fake backend: list, detail and one version, over the `flows` collection
// the world "sklep" fills and a `flow_versions` collection a test fills. The list and the detail
// carry `spec_status` the way the backend computes it for these two routes only: `unpinned` without a
// pin, `current` when pinned to the project's active docs version (or the project has none),
// `outdated` otherwise. `withoutSpecStatus` makes them answer as an older backend does (null). Answers and 404 texts
// follow the backend's routes for flows (list, detail, version, summary, step count) and its tag
// filter.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';

type FlowDetail = components['schemas']['FlowDetail'];
type FlowSummary = components['schemas']['FlowSummary'];
type FlowVersionDetail = components['schemas']['FlowVersionDetail'];
type SpecStatus = NonNullable<FlowSummary['spec_status']>;

/** Fakes that answer like a backend from before `spec_status`. */
const legacy = new WeakSet<Fake>();

/** The list and the detail of flows answer `spec_status: null`, as an older backend does. */
export function withoutSpecStatus(fake: Fake): void {
  legacy.add(fake);
}

/** `spec_status` of a flow against the project's active docs version. */
export function specStatusOf(store: Store, flow: FlowDetail): SpecStatus {
  const pin = flow.openapi_spec_id ?? null;
  if (pin === null) return 'unpinned';
  const active = store
    .collection<{ id: string; openapi_spec_id?: string | null }>(FLOW_COLLECTIONS.projects)
    .get(flow.project_id)?.openapi_spec_id;
  return active === undefined || active === null || active === pin ? 'current' : 'outdated';
}

export const FLOW_COLLECTIONS = {
  projects: 'projects',
  flows: 'flows',
  versions: 'flow_versions',
} as const;

/** Blocks minus validators bound to a request (`_count_outline_steps`). */
function stepCount(blocks: FlowDetail['blocks']): number {
  return blocks.filter((block) => {
    const config = (block['config'] ?? {}) as Record<string, unknown>;
    const bound = block['bound_to_request_id'] ?? config['bound_to_request_id'];
    return !(block['type'] === 'validator' && typeof bound === 'string' && bound !== '');
  }).length;
}

type NeedsInputItem = components['schemas']['NeedsInputItem'];

const KINDS: ReadonlySet<string> = new Set([
  'poll_status',
  'websocket_frames',
  'auth',
  'step_outside_approved_endpoints',
  'asyncapi_channel_parameter',
  'obstacle',
  'credential_scheme',
  'static_credential',
]);

const text = (raw: Record<string, unknown>, key: string): string | null =>
  typeof raw[key] === 'string' && raw[key] !== '' ? raw[key] : null;

/**
 * The items of a flow the generation left open, as the API types them: a stored item keeps only the
 * keys of `NeedsInputItem` (others, such as an environment name, are not in the answer) and a kind
 * this version does not know is null with the stored one in `kind_raw`. None without the key.
 */
function needsOf(flow: FlowDetail): NeedsInputItem[] {
  return (flow.needs_input ?? []).map((item) => {
    const raw = item as unknown as Record<string, unknown>;
    const kind = text(raw, 'kind');
    const steps = raw['steps'];
    return {
      kind: kind !== null && KINDS.has(kind) ? (kind as NonNullable<NeedsInputItem['kind']>) : null,
      kind_raw: kind !== null && !KINDS.has(kind) ? kind : text(raw, 'kind_raw'),
      field: text(raw, 'field') ?? '',
      question: text(raw, 'question') ?? '',
      why: text(raw, 'why') ?? '',
      definite: raw['definite'] === true,
      steps: Array.isArray(steps) ? steps.filter((s): s is string => typeof s === 'string') : [],
      scheme: text(raw, 'scheme'),
      variable: text(raw, 'variable'),
      producer: text(raw, 'producer'),
      slot: text(raw, 'slot'),
    };
  });
}

function summaryOf(flow: FlowDetail, specStatus: SpecStatus | null): FlowSummary {
  return {
    id: flow.id,
    name: flow.name,
    description: flow.description,
    flow_type: flow.flow_type,
    blocks_count: flow.blocks.length,
    step_count: stepCount(flow.blocks),
    current_version: flow.current_version,
    is_active: flow.is_active,
    generated_by: flow.generated_by,
    openapi_spec_id: flow.openapi_spec_id ?? null,
    asyncapi_spec_id: flow.asyncapi_spec_id ?? null,
    tags: flow.tags,
    created_at: flow.created_at,
    updated_at: flow.updated_at,
    generation_target_url: flow.generation_target_url ?? null,
    generated_on_environment_id: flow.generated_on_environment_id ?? null,
    spec_status: specStatus,
    needs_input_count: needsOf(flow).length,
    needs_input_definite_count: needsOf(flow).filter((item) => item.definite === true).length,
  };
}

function requireProject(store: Store, projectId: string): void {
  store
    .collection<{ id: string }>(FLOW_COLLECTIONS.projects)
    .require(projectId, `Project not found: ${projectId}`);
}

function requireFlow(store: Store, projectId: string, flowId: string): FlowDetail {
  const flow = store
    .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
    .require(flowId, `Flow not found: ${flowId}`);
  if (flow.project_id !== projectId) {
    throw new FakeHttpError(404, { detail: `Flow ${flowId} not found in project ${projectId}` });
  }
  return flow;
}

/** Registers the three read routes; a repeated `tags` keeps flows with any of the tags. */
export function registerFlowRoutes(fake: Fake): void {
  const statusOf = (store: Store, flow: FlowDetail): SpecStatus | null =>
    legacy.has(fake) ? null : specStatusOf(store, flow);
  fake.route('GET', '/api/v1/projects/{project_id}/flows', (req, store) => {
    const projectId = req.params.project_id;
    requireProject(store, projectId);
    const limit = Number(req.query['limit'] ?? '50');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new FakeHttpError(422, { detail: 'limit must be between 1 and 100' });
    }
    const tags = req.queryAll['tags'];
    const isActive = req.query['is_active'];
    const all = store
      .collection<FlowDetail>(FLOW_COLLECTIONS.flows)
      .list((flow) => flow.project_id === projectId);
    const listed = all
      .filter((flow) =>
        tags === undefined
          ? isActive === undefined || String(flow.is_active) === isActive
          : flow.is_active && tags.some((tag) => flow.tags.includes(tag)),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit);
    const counted = all.filter(
      (flow) => isActive === undefined || String(flow.is_active) === isActive,
    );
    return {
      status: 200,
      body: {
        flows: listed.map((flow) => summaryOf(flow, statusOf(store, flow))),
        total: counted.length,
      },
    };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/flows/{flow_id}', (req, store) => {
    const flow = requireFlow(store, req.params.project_id, req.params.flow_id);
    return {
      status: 200,
      body: { ...flow, spec_status: statusOf(store, flow), needs_input: needsOf(flow) },
    };
  });

  // The versions of a flow, newest first, as summaries (`flow_versions` holds the details a test seeds).
  fake.route('GET', '/api/v1/projects/{project_id}/flows/{flow_id}/versions', (req, store) => {
    const { project_id: projectId, flow_id: flowId } = req.params;
    requireFlow(store, projectId, flowId);
    const versions = store
      .collection<FlowVersionDetail>(FLOW_COLLECTIONS.versions)
      .list((item) => item.flow_id === flowId)
      .sort((a, b) => b.version - a.version)
      .map((item) => ({
        id: item.id,
        version: item.version,
        change_reason: item.change_reason,
        created_at: item.created_at,
        created_by: item.created_by,
      }));
    return { status: 200, body: { versions, total: versions.length } };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/flows/{flow_id}/versions/{version}',
    (req, store) => {
      const { project_id: projectId, flow_id: flowId, version } = req.params;
      requireFlow(store, projectId, flowId);
      const found = store
        .collection<FlowVersionDetail>(FLOW_COLLECTIONS.versions)
        .list((item) => item.flow_id === flowId && String(item.version) === version)[0];
      if (found === undefined) {
        throw new FakeHttpError(404, { detail: `Version ${version} not found for flow ${flowId}` });
      }
      return { status: 200, body: found };
    },
  );
}
