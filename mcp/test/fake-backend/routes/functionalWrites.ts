// Write routes of the module functional (src/tools/functional/) for the functional flows and templates: create,
// update, the version snapshot of a flow. They work over the records the seeding functions of
// `routes/functional.ts` fill (`seedFlows`, `seedFlowVersions`, `seedTemplates`), so a test reads back what
// a tool wrote with the read routes. Rules follow the backend: an update is partial (omitted or null fields
// stay as they are); a version label already used for the flow is a 500; an unknown flow or template a 404.
// Registration is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import {
  answered,
  put,
  read,
  type FlowDetailBody,
  type FlowVersionBody,
  type Seeded,
  type TemplateDetailBody,
} from './functional.js';

type FlowCreate = components['schemas']['TestFlowCreate'];
type FlowUpdate = components['schemas']['TestFlowUpdate'];
type VersionCreate = components['schemas']['TestFlowVersionCreate'];
type TemplateCreate = components['schemas']['TestTemplateCreate'];
type TemplateUpdate = components['schemas']['TestTemplateUpdate'];

const registered = new WeakSet<Fake>();
const STAMP = '2026-11-27T12:00:00Z';

const flows = (store: Store): FlowDetailBody[] => [
  ...answered(read<Seeded<readonly FlowDetailBody[]>>(store, 'flows') ?? []),
];
const templates = (store: Store): TemplateDetailBody[] => [
  ...answered(read<Seeded<readonly TemplateDetailBody[]>>(store, 'templates') ?? []),
];

/** The fields of an update that are given (not omitted, not null). */
function given<T extends object>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<T>;
}

/** The versions (snapshots) a flow holds, newest first. */
export function flowVersionsOf(store: Store, flowId: string): FlowVersionBody[] {
  return [
    ...answered(read<Seeded<readonly FlowVersionBody[]>>(store, `flow-versions:${flowId}`) ?? []),
  ];
}

export function registerFunctionalWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('POST', '/api/v1/test-flows', (req, store) => {
    const body = req.body as FlowCreate;
    const created: FlowDetailBody = {
      id: store.newId(),
      name: body.name,
      description: body.description ?? null,
      openapi_spec_id: body.openapi_spec_id,
      version: 'main',
      blocks: body.blocks ?? [],
      edges: body.edges ?? [],
      entry_block_id: body.entry_block_id ?? null,
      timeout_ms: body.timeout_ms,
      retry_count: body.retry_count,
      retry_delay_ms: body.retry_delay_ms,
      variables: body.variables ?? {},
      tags: body.tags ?? [],
      blocks_count: (body.blocks ?? []).length,
      is_active: true,
      created_at: STAMP,
      updated_at: STAMP,
      created_by: null,
    };
    put(store, 'flows', [...flows(store), created]);
    return { status: 201, body: created };
  });

  fake.route('PUT', '/api/v1/test-flows/{flow_id}', (req, store) => {
    const all = flows(store);
    const index = all.findIndex((flow) => flow.id === req.params.flow_id);
    const current = all[index];
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Test flow not found' });
    const changes = given(req.body as FlowUpdate);
    const updated = {
      ...current,
      ...changes,
      blocks_count: (changes.blocks ?? current.blocks ?? []).length,
      updated_at: STAMP,
    } as FlowDetailBody;
    all[index] = updated;
    put(store, 'flows', all);
    return { status: 200, body: updated };
  });

  // A snapshot of the flow as it is now under a label; a label the flow already has is a 500.
  fake.route('POST', '/api/v1/test-flows/{flow_id}/versions', (req, store) => {
    const current = flows(store).find((flow) => flow.id === req.params.flow_id);
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Test flow not found' });
    const body = req.body as VersionCreate;
    const versions = flowVersionsOf(store, current.id);
    if (versions.some((entry) => entry.version === body.version)) {
      throw new FakeHttpError(500, { detail: 'Version label already used for this flow' });
    }
    const created: FlowVersionBody = {
      id: store.newId(),
      flow_id: current.id,
      version: body.version,
      created_at: STAMP,
      change_reason: body.change_reason ?? null,
      created_by: null,
    };
    put(store, `flow-versions:${current.id}`, [created, ...versions]);
    const snapshots =
      read<Record<string, FlowDetailBody>>(store, `flow-snapshots:${current.id}`) ?? {};
    put(store, `flow-snapshots:${current.id}`, { ...snapshots, [body.version]: { ...current } });
    return {
      status: 201,
      body: {
        ...created,
        blocks_snapshot: structuredClone(current.blocks ?? []),
        edges_snapshot: structuredClone(current.edges ?? []),
      },
    };
  });

  fake.route('POST', '/api/v1/test-templates', (req, store) => {
    const body = req.body as TemplateCreate;
    const created: TemplateDetailBody = {
      id: store.newId(),
      name: body.name,
      description: body.description ?? null,
      openapi_spec_id: body.openapi_spec_id ?? null,
      api_description: body.api_description,
      flow_definition: body.flow_definition,
      assertions: body.assertions ?? [],
      assertions_count: (body.assertions ?? []).length,
      endpoint_ids: body.endpoint_ids ?? [],
      tags: body.tags ?? [],
      is_active: true,
      created_at: STAMP,
      updated_at: STAMP,
      created_by: null,
    };
    put(store, 'templates', [...templates(store), created]);
    return { status: 201, body: created };
  });

  fake.route('PUT', '/api/v1/test-templates/{template_id}', (req, store) => {
    const all = templates(store);
    const index = all.findIndex((template) => template.id === req.params.template_id);
    const current = all[index];
    if (current === undefined) throw new FakeHttpError(404, { detail: 'Test template not found' });
    const changes = given(req.body as TemplateUpdate);
    const updated = {
      ...current,
      ...changes,
      assertions_count: (changes.assertions ?? current.assertions ?? []).length,
      updated_at: STAMP,
    } as TemplateDetailBody;
    all[index] = updated;
    put(store, 'templates', all);
    return { status: 200, body: updated };
  });
}
