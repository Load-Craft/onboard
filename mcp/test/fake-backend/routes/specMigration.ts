// Docs-version routes of the fake backend: the history of a project's OpenAPI documentation and the
// move of flows onto another version in place (preview and migration). Shapes follow the contract
// snapshot (`OpenAPISpecListResponse`, `FlowsSpecMigrationPreviewResponse`,
// `FlowsSpecMigrationResponse`, `FlowsSpecMigrationConflict`). The fake's rules are the backend's,
// made small: a request step whose method and path exist in the target version is `matched`
// (`changed` when a value difference names it), a step without an endpoint is `unmatched`
// `unbound`, a step whose endpoint the target lacks is `unmatched` `endpoint_removed`. Value
// differences are not computed: a test seeds them with `seedValueDiff` (id: flow, flow version, target
// version, step, place, field; an id of another target or flow version is `preview_stale`), and the migration applies
// the adopted ones to the step (set and add write `target_value`, remove drops the field).

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';
import type { StoredSpec } from './setup.js';

type FlowDetail = components['schemas']['FlowDetail'];
type Plan = components['schemas']['FlowSpecMigrationPlan'];
type Result = components['schemas']['FlowSpecMigrationResult'];
type Step = components['schemas']['SpecMigrationStepResponse'];
type ValueDiff = components['schemas']['ValueDiffResponse'];
type PreviewRequest = components['schemas']['FlowsSpecMigrationPreviewRequest'];
type MigrationRequest = components['schemas']['FlowsSpecMigrationRequest'];

const VALUE_DIFFS = 'spec_migration_value_diffs';

/** A value difference a test plants on one step of a flow; the id is made from the flow version. */
export type SeededValueDiff = Omit<ValueDiff, 'id'> & { readonly flow_id: string };

interface StoredDiff extends SeededValueDiff {
  readonly id: string;
}

/** Plants a value difference the preview reports for the step `block_id` of `flow_id`. */
export function seedValueDiff(store: Store, diff: SeededValueDiff): void {
  store.collection<StoredDiff>(VALUE_DIFFS).insert({ ...diff, id: store.newId() });
}

const registered = new WeakSet<Fake>();
const failingListAfter = new WeakSet<Fake>();

/** The next migration that writes makes the next read of the flow list fail with 500. */
export function failListAfterMigration(fake: Fake): void {
  failingListAfter.add(fake);
}

interface Target {
  readonly spec: StoredSpec;
}

function projectOf(
  store: Store,
  projectId: string,
): { id: string; openapi_spec_id?: string | null } {
  return store
    .collection<{ id: string; openapi_spec_id?: string | null }>(SKLEP_COLLECTIONS.projects)
    .require(projectId, `Project not found: ${projectId}`);
}

function targetOf(store: Store, projectId: string, targetId: string | null | undefined): Target {
  const specs = store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs);
  const id = targetId ?? projectOf(store, projectId).openapi_spec_id ?? null;
  if (id === null) {
    throw new FakeHttpError(400, { detail: 'Project has no active OpenAPI spec' });
  }
  const spec = specs.get(id);
  if (spec === undefined) throw new FakeHttpError(404, { detail: `OpenAPI spec not found: ${id}` });
  return { spec };
}

const endpointsOf = (store: Store, specId: string): SklepEndpoint[] =>
  store
    .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
    .list((endpoint) => endpoint.spec_id === specId);

function flowsOf(store: Store, projectId: string): FlowDetail[] {
  return store
    .collection<FlowDetail>(SKLEP_COLLECTIONS.flows)
    .list((flow) => flow.project_id === projectId);
}

/** The flows a request names, else every flow pinned to another version than the target. */
function chosen(
  store: Store,
  projectId: string,
  flowIds: readonly string[] | null | undefined,
  target: Target,
): { id: string; flow: FlowDetail | undefined }[] {
  const all = flowsOf(store, projectId);
  if (flowIds === null || flowIds === undefined) {
    return all
      .filter((flow) => (flow.openapi_spec_id ?? null) !== null)
      .filter((flow) => flow.openapi_spec_id !== target.spec.id)
      .map((flow) => ({ id: flow.id, flow }));
  }
  return flowIds.map((id) => ({ id, flow: all.find((flow) => flow.id === id) }));
}

interface Config {
  method?: string;
  path?: string;
  endpoint_id?: string | null;
  spec_id?: string | null;
  body?: unknown;
  query_params?: Record<string, unknown>;
}

const configOf = (block: Record<string, unknown>): Config => block['config'] ?? {};

function diffsOf(store: Store, flow: FlowDetail, targetId: string): ValueDiff[] {
  return store
    .collection<StoredDiff>(VALUE_DIFFS)
    .list((diff) => diff.flow_id === flow.id)
    .map((stored) => ({
      block_id: stored.block_id,
      location: stored.location,
      field: stored.field,
      kind: stored.kind,
      action: stored.action,
      adoptable: stored.adoptable,
      current_value: stored.current_value,
      source_value: stored.source_value,
      target_value: stored.target_value,
      id: `${stored.flow_id}:${String(flow.current_version)}:${targetId}:${stored.block_id}:${stored.location}:${stored.field}`,
    }));
}

function planOf(
  store: Store,
  projectId: string,
  id: string,
  flow: FlowDetail | undefined,
  target: Target,
): Plan {
  const refused = (code: NonNullable<Plan['refusal']>['code'], message: string): Plan => ({
    flow_id: id,
    flow_name: flow?.name ?? null,
    current_version: flow?.current_version ?? null,
    source_spec_id: flow?.openapi_spec_id ?? null,
    source_spec_version: null,
    refusal: { code, message },
    requires_allow_unmatched: false,
    report: null,
    scenarios: [],
  });
  if (flow === undefined)
    return refused('flow_not_found', `Flow ${id} not found in project ${projectId}`);
  const pin = flow.openapi_spec_id ?? null;
  if (pin === null)
    return refused('not_pinned', 'Flow has no OpenAPI spec pin; it reads the active spec');
  if (pin === target.spec.id)
    return refused('already_on_target', 'Flow is already on the target spec');
  const source = store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).get(pin);
  if (source === undefined)
    return refused('source_spec_missing', `Pinned spec ${pin} no longer exists`);

  const targetEndpoints = endpointsOf(store, target.spec.id);
  const diffs = diffsOf(store, flow, target.spec.id);
  const entries: Step[] = flow.blocks
    .filter((block) => block['type'] === 'request')
    .map((block) => {
      const config = configOf(block);
      const method = String(config.method ?? 'GET');
      const path = String(config.path ?? '/');
      const base = {
        block_id: String(block['id']),
        block_name: typeof block['name'] === 'string' ? block['name'] : '',
        method,
        path,
        response_schema_updated: false,
      };
      const found = targetEndpoints.find((e) => e.method === method && e.path === path);
      if (found === undefined) {
        const unbound = (config.endpoint_id ?? null) === null;
        return {
          ...base,
          status: 'unmatched',
          unmatched_reason: unbound ? 'unbound' : 'endpoint_removed',
          value_diffs: [],
        };
      }
      const own = diffs.filter((diff) => diff.block_id === base.block_id);
      return {
        ...base,
        status: own.length > 0 ? 'changed' : 'matched',
        unmatched_reason: null,
        new_endpoint_id: found.id,
        value_diffs: own,
      };
    });
  const count = (status: Step['status']): number =>
    entries.filter((e) => e.status === status).length;
  const kept = new Set(targetEndpoints.map((e) => `${e.method}:${e.path}`));
  const dropped = flow.source_endpoints
    .filter((item): item is string => typeof item === 'string' && !kept.has(item))
    .map((item) => item.replace(':', ' '));
  const scenarios = store
    .collection<{ id: string; name: string; source_flow_id: string; source_flow_version: number }>(
      SKLEP_COLLECTIONS.scenarios,
    )
    .list((scenario) => scenario.source_flow_id === flow.id)
    .map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      source_flow_version: scenario.source_flow_version,
    }));
  return {
    flow_id: flow.id,
    flow_name: flow.name,
    current_version: flow.current_version,
    source_spec_id: pin,
    source_spec_version: source.version,
    refusal: null,
    requires_allow_unmatched: entries.some((e) => e.unmatched_reason === 'endpoint_removed'),
    report: {
      total_request_blocks: entries.length,
      matched_count: count('matched'),
      changed_count: count('changed'),
      unmatched_count: count('unmatched'),
      entries,
      dropped_source_endpoints: dropped,
    },
    scenarios,
  };
}

function targetFields(target: Target) {
  return {
    target_spec_id: target.spec.id,
    target_spec_version: target.spec.version,
    target_spec_created_at: target.spec.created_at,
  };
}

/** A copy of the step with the adopted value differences applied to its body or query. */
function adopt(
  block: Record<string, unknown>,
  diffs: readonly ValueDiff[],
): Record<string, unknown> {
  const config = { ...configOf(block) } as Config & Record<string, unknown>;
  for (const diff of diffs) {
    const key = diff.location === 'query' ? 'query_params' : 'body';
    const holder = { ...((config[key] ?? {}) as Record<string, unknown>) };
    if (diff.action === 'remove') delete holder[diff.field];
    else holder[diff.field] = diff.target_value;
    config[key] = holder;
  }
  return { ...block, config };
}

function migrate(
  store: Store,
  flow: FlowDetail,
  plan: Plan,
  target: Target,
  adopted: readonly ValueDiff[],
): FlowDetail {
  const byBlock = new Map((plan.report?.entries ?? []).map((entry) => [entry.block_id, entry]));
  const blocks = flow.blocks.map((block) => {
    const entry = byBlock.get(String(block['id']));
    if (entry === undefined) return block;
    const config = configOf(block);
    const mine = adopted.filter((diff) => diff.block_id === entry.block_id);
    if (entry.status === 'unmatched') {
      if (entry.unmatched_reason !== 'endpoint_removed') return block;
      return { ...block, config: { ...config, endpoint_id: null, spec_id: null } };
    }
    const rebound = {
      ...block,
      config: { ...config, endpoint_id: entry.new_endpoint_id, spec_id: target.spec.id },
    };
    return adopt(rebound, mine);
  });
  const dropped = new Set(
    (plan.report?.dropped_source_endpoints ?? []).map((item) => item.replace(' ', ':')),
  );
  const values = store.collection<StoredDiff>(VALUE_DIFFS);
  for (const diff of values.list((item) => item.flow_id === flow.id)) values.delete(diff.id);
  return store.collection<FlowDetail>(SKLEP_COLLECTIONS.flows).update(flow.id, {
    blocks,
    openapi_spec_id: target.spec.id,
    source_endpoints: flow.source_endpoints.filter(
      (item) => typeof item !== 'string' || !dropped.has(item),
    ),
    current_version: flow.current_version + 1,
  });
}

/** Registers the docs history and the two migration routes; idempotent per fake. */
export function registerSpecMigrationRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('GET', '/api/v1/projects/{project_id}/openapi-specs', (req, store) => {
    const project = projectOf(store, req.params.project_id);
    const specs = store.collection<StoredSpec>(SKLEP_COLLECTIONS.specs).list();
    const current = project.openapi_spec_id ?? null;
    return {
      status: 200,
      body: {
        specs: specs.map((stored) => {
          const spec = { ...stored };
          delete spec.spec_content;
          return { ...spec, is_current: spec.id === current };
        }),
        total: specs.length,
        current_spec_id: current,
      },
    };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/flows/spec-migration/preview', (req, store) => {
    const projectId = req.params.project_id;
    projectOf(store, projectId);
    const body = (req.body ?? {}) as PreviewRequest;
    const target = targetOf(store, projectId, body.target_spec_id);
    const flows = chosen(store, projectId, body.flow_ids, target).map(({ id, flow }) =>
      planOf(store, projectId, id, flow, target),
    );
    const refused = flows.filter((plan) => plan.refusal !== null).length;
    return {
      status: 200,
      body: {
        ...targetFields(target),
        flows,
        migratable_count: flows.length - refused,
        refused_count: refused,
      },
    };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/flows/spec-migration', (req, store) => {
    const projectId = req.params.project_id;
    projectOf(store, projectId);
    const body = (req.body ?? {}) as MigrationRequest;
    const target = targetOf(store, projectId, body.target_spec_id);
    const picked = chosen(store, projectId, body.flow_ids, target);
    const expected = body.expected_versions ?? {};
    const stale = picked
      .filter(
        ({ id, flow }) =>
          flow !== undefined && id in expected && expected[id] !== flow.current_version,
      )
      .map(({ id }) => id);
    const wanted = body.adopt_value_ids ?? [];
    const staleByValue = wanted
      .map((valueId) => valueId.split(':'))
      .filter(([flowId, version, targetId]) => {
        const flow = picked.find((item) => item.id === flowId)?.flow;
        return (
          flow !== undefined &&
          (version !== String(flow.current_version) || targetId !== target.spec.id)
        );
      })
      .map(([flowId]) => flowId ?? '');
    const changed = [...new Set([...stale, ...staleByValue])];
    if (changed.length > 0) {
      throw new FakeHttpError(409, {
        detail: {
          code: 'preview_stale',
          message: 'Flows changed since the preview; preview again.',
          flow_ids: changed,
          value_ids: [],
        },
      });
    }
    const plans = picked.map(({ id, flow }) => ({
      flow,
      plan: planOf(store, projectId, id, flow, target),
    }));
    const adoptable = plans.flatMap(({ plan }) =>
      (plan.report?.entries ?? []).flatMap((entry) =>
        (entry.value_diffs ?? []).filter((d) => d.adoptable),
      ),
    );
    const unknown = wanted.filter((id) => !adoptable.some((diff) => diff.id === id));
    if (unknown.length > 0) {
      throw new FakeHttpError(409, {
        detail: {
          code: 'unknown_value_ids',
          message: 'Some adopt_value_ids are not adoptable value differences of these flows.',
          flow_ids: [],
          value_ids: unknown,
        },
      });
    }
    const all = body.adopt_values === 'all';
    const results: Result[] = plans.map(({ flow, plan }) => {
      const refusal =
        plan.refusal ??
        (plan.requires_allow_unmatched && body.allow_unmatched !== true
          ? {
              code: 'unmatched_steps' as const,
              message: 'Steps lost their endpoint; pass allow_unmatched.',
            }
          : null);
      if (refusal !== null || flow === undefined) {
        return {
          ...plan,
          refusal,
          outcome: 'refused',
          previous_version: null,
          adopted_value_ids: [],
        };
      }
      const adopted = (plan.report?.entries ?? [])
        .flatMap((entry) => entry.value_diffs ?? [])
        .filter((diff) => diff.adoptable && (all || wanted.includes(diff.id)));
      const moved = migrate(store, flow, plan, target, adopted);
      return {
        ...plan,
        outcome: 'migrated',
        previous_version: flow.current_version,
        current_version: moved.current_version,
        adopted_value_ids: adopted.map((diff) => diff.id),
      };
    });
    const migrated = results.filter((result) => result.outcome === 'migrated').length;
    if (failingListAfter.has(fake)) {
      failingListAfter.delete(fake);
      // a server failure the contract of the route does not declare
      fake.faults.next(
        'GET',
        '/api/v1/projects/{project_id}/flows',
        { status: 500, body: { detail: 'internal error' } },
        { outsideContract: true },
      );
    }
    return {
      status: 200,
      body: {
        ...targetFields(target),
        results,
        migrated_count: migrated,
        refused_count: results.length - migrated,
      },
    };
  });
}
