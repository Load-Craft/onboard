// Routes of the tools of module project (src/tools/project/) that no other route file answers. The
// notes the agent learned about a project are kept in their own collection; a test seeds them with
// `seedProjectNotes`. Registration is idempotent per fake (`registerAllRoutes` and a tool test may
// both call it).

import type { components } from '../../../src/http/generated/api.js';
import type { OpOutput } from '../../../src/http/operation.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';
import { operationsOf, type StoredSpec } from './setup.js';

type AgentGuidanceEntry = components['schemas']['AgentGuidanceEntry'];
type ProjectDetail = components['schemas']['ProjectDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type EffectiveEnvironmentResponse = components['schemas']['EffectiveEnvironmentResponse'];
type AsyncAPISpecDetailResponse = components['schemas']['AsyncAPISpecDetailResponse'];
type AsyncAPISpecSummary = components['schemas']['AsyncAPISpecSummary'];
type OpenAPISpecById =
  components['schemas']['backend__api__routes__openapi_specs__GetSpecResponse'];
type AsyncAPISpecById =
  components['schemas']['backend__api__routes__asyncapi_specs__GetSpecResponse'];
type MaskedFieldItem = components['schemas']['MaskedFieldItem'];

const MASKED = '«masked»';

type TeamMember = components['schemas']['TeamMemberResponse'];

/** The team of projects: members as the list route returns them, and which one is the caller. */
export const TEAM_MEMBERS = 'project_team_members';

export interface StoredMember {
  readonly id: string;
  readonly member: TeamMember;
  readonly caller: boolean;
}

/** Adds a member to the team of a project; `caller` marks the one the token belongs to. */
export function seedTeamMember(
  store: Store,
  projectId: string,
  fields: Partial<TeamMember> & Pick<TeamMember, 'id' | 'user_id' | 'role'>,
  caller = false,
): void {
  store.collection<StoredMember>(TEAM_MEMBERS).insert({
    id: fields.id,
    caller,
    member: {
      project_id: projectId,
      added_by: null,
      created_at: '2026-11-20T10:00:00Z',
      ...fields,
    },
  });
}

const ROLE_PERMISSIONS: Readonly<
  Record<string, { canAdmin: boolean; canEdit: boolean; canExecute: boolean }>
> = {
  owner: { canAdmin: true, canEdit: true, canExecute: true },
  editor: { canAdmin: false, canEdit: true, canExecute: true },
  viewer: { canAdmin: false, canEdit: false, canExecute: false },
};

type EndpointDetail =
  OpOutput<'get_endpoint_details_api_v1_openapi_specs__spec_id__endpoints__endpoint_id__get'>;
type EndpointBindings = components['schemas']['EndpointBindingMetadata'];

/** What a test plants for an endpoint beyond the summary the world has: its detail and bindings. */
export const ENDPOINT_EXTRAS = 'project_endpoint_extras';

interface StoredExtras {
  readonly id: string;
  readonly detail?: Partial<EndpointDetail>;
  readonly bindings?: Partial<EndpointBindings>;
}

/** Plants the detail and the binding metadata the routes of one endpoint return (over the defaults); a second call adds to the first. */
export function seedEndpointExtras(
  store: Store,
  endpointId: string,
  extras: {
    readonly detail?: Partial<EndpointDetail>;
    readonly bindings?: Partial<EndpointBindings>;
  },
): void {
  const collection = store.collection<StoredExtras>(ENDPOINT_EXTRAS);
  const before = collection.get(endpointId);
  if (before === undefined) collection.insert({ id: endpointId, ...extras });
  else {
    collection.update(endpointId, {
      detail: { ...before.detail, ...extras.detail },
      bindings: { ...before.bindings, ...extras.bindings },
    });
  }
}

/** The endpoint of the specification, or the 404 the backend answers. */
function endpointOf(store: Store, specId: string, endpointId: string): SklepEndpoint {
  store
    .collection<{ id: string }>(SKLEP_COLLECTIONS.specs)
    .require(specId, `OpenAPI spec not found: ${specId}`);
  const found = store
    .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
    .require(endpointId, `Endpoint not found: ${endpointId}`);
  if (found.spec_id !== specId) {
    throw new FakeHttpError(404, { detail: `Endpoint not found: ${endpointId}` });
  }
  return found;
}

function extrasOf(store: Store, endpointId: string): StoredExtras | undefined {
  return store.collection<StoredExtras>(ENDPOINT_EXTRAS).get(endpointId);
}

function endpointDetail(store: Store, endpoint: SklepEndpoint): EndpointDetail {
  return {
    id: endpoint.id,
    method: endpoint.method.toLowerCase() as EndpointDetail['method'],
    path: endpoint.path,
    operation_id: endpoint.operation_id,
    summary: endpoint.summary,
    description: null,
    tags: endpoint.tags,
    deprecated: false,
    is_crud: endpoint.is_crud,
    crud_operation: null,
    is_paginated: endpoint.is_paginated,
    async_pattern: 'sync',
    parameters: [],
    request_body: null,
    responses: [],
    security: [],
    ...extrasOf(store, endpoint.id)?.detail,
  };
}

/** The AsyncAPI documentation of projects: the version as the detail route returns it, and its flags. */
export const ASYNCAPI_SPECS = 'project_asyncapi_specs';

interface StoredAsyncSpec {
  readonly id: string;
  readonly detail: AsyncAPISpecDetailResponse;
  readonly is_active: boolean;
  readonly is_current: boolean;
}

/** Stores an AsyncAPI version of a project; the current one is what `GET …/asyncapi` returns. */
export function seedAsyncSpec(
  store: Store,
  projectId: string,
  fields: Partial<AsyncAPISpecDetailResponse> &
    Pick<AsyncAPISpecDetailResponse, 'id' | 'title' | 'version'>,
  flags: { readonly is_active?: boolean; readonly is_current?: boolean } = {},
): void {
  store.collection<StoredAsyncSpec>(ASYNCAPI_SPECS).insert({
    id: fields.id,
    detail: { project_id: projectId, uploaded_at: '2026-11-20T10:00:00Z', ...fields },
    is_active: flags.is_active ?? true,
    is_current: flags.is_current ?? true,
  });
}

/**
 * The body of `GET …/asyncapi-specs`: the stored versions of the project, none when none were
 * seeded. The route itself stays in `routes/deletion.ts`, which answered it first.
 */
export function asyncapiSpecList(
  store: Store,
  projectId: string,
): components['schemas']['AsyncAPISpecListResponse'] {
  const entries = store
    .collection<StoredAsyncSpec>(ASYNCAPI_SPECS)
    .list((entry) => entry.detail.project_id === projectId);
  return {
    specs: entries.map(asyncSummary),
    total: entries.length,
    current_spec_id: entries.find((entry) => entry.is_current)?.id ?? null,
  };
}

function asyncSummary(entry: StoredAsyncSpec): AsyncAPISpecSummary {
  const { detail } = entry;
  return {
    id: entry.id,
    title: detail.title,
    version: detail.version,
    description: detail.description ?? null,
    source_url: detail.source_url ?? null,
    created_at: detail.uploaded_at,
    channels_count: detail.channels?.length ?? 0,
    operations_count: detail.operations?.length ?? 0,
    is_active: entry.is_active,
    is_current: entry.is_current,
  };
}

/** `GET /openapi-specs/{id}`: the parsed specification, not the detail of the project's route. */
function openapiById(store: Store, spec: StoredSpec): OpenAPISpecById {
  return {
    id: spec.id,
    title: spec.title,
    version: spec.version,
    description: spec.description ?? null,
    source_url: spec.source_url ?? null,
    created_at: spec.created_at,
    updated_at: spec.created_at,
    openapi_version: '3.0.3',
    base_url: null,
    detected_patterns: [],
    schemas: {},
    security_schemes: {},
    servers: [],
    endpoints: operationsOf(store, spec.id).map((endpoint) => ({
      id: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
      operation_id: endpoint.operation_id,
      summary: endpoint.summary,
      tags: endpoint.tags,
    })),
  };
}

/** `GET /asyncapi-specs/{id}`. */
function asyncById(detail: AsyncAPISpecDetailResponse): AsyncAPISpecById {
  return {
    id: detail.id,
    title: detail.title,
    version: detail.version,
    description: detail.description ?? null,
    source_url: detail.source_url ?? null,
    created_at: detail.uploaded_at,
    updated_at: detail.uploaded_at,
    asyncapi_version: '3.0.0',
    detected_protocols: detail.detected_protocols ?? [],
    channels: detail.channels ?? [],
    operations: detail.operations ?? [],
    servers: [],
    messages: {},
    schemas: {},
  };
}

/** The collection of the notes, by project. */
export const PROJECT_NOTES = 'project_agent_guidance';

interface StoredNote {
  readonly id: string;
  readonly project_id: string;
  readonly entry: AgentGuidanceEntry;
}

/** Adds notes to a project, in the order the backend returns them. */
export function seedProjectNotes(
  store: Store,
  projectId: string,
  notes: readonly AgentGuidanceEntry[],
): void {
  const collection = store.collection<StoredNote>(PROJECT_NOTES);
  for (const note of notes) {
    collection.insert({ id: store.newId(), project_id: projectId, entry: note });
  }
}

/**
 * Adds an environment to the project, as stored: the values of its headers, variables and
 * authentication are kept as given, so a test can put a secret there that the tool must not show
 * (the backend masks the values it returns; the tool must not depend on that).
 */
export function seedEnvironment(
  store: Store,
  projectId: string,
  fields: Partial<EnvironmentResponse> & Pick<EnvironmentResponse, 'id' | 'name'>,
): EnvironmentResponse {
  const record: EnvironmentResponse = {
    project_id: projectId,
    description: null,
    base_url: 'https://api.example.test',
    frontend_url: null,
    proxy_url: null,
    default_headers: {},
    auth_type: 'none',
    auth_config: {},
    variables: {},
    is_active: true,
    is_default: false,
    protected: false,
    workload_caps: null,
    parent_environment_id: null,
    last_probe: null,
    last_conformance: null,
    ...fields,
  };
  return store.collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments).insert(record);
}

function requireStoredProject(store: Store, id: string): void {
  store
    .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
    .require(id, `Project not found: ${id}`);
}

function environmentOf(store: Store, projectId: string, id: string): EnvironmentResponse {
  store
    .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
    .require(projectId, `Project not found: ${projectId}`);
  const found = store
    .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
    .require(id, `Environment not found: ${id}`);
  if (found.project_id !== projectId) {
    throw new FakeHttpError(400, { detail: 'Environment does not belong to this project' });
  }
  return found;
}

function maskedItems(
  own: Readonly<Record<string, unknown>>,
  inherited: Readonly<Record<string, unknown>>,
): MaskedFieldItem[] {
  const items: MaskedFieldItem[] = Object.keys(own).map((name) => ({
    name,
    value: MASKED,
    masked: true,
    inherited: false,
  }));
  for (const name of Object.keys(inherited)) {
    if (!(name in own)) items.push({ name, value: MASKED, masked: true, inherited: true });
  }
  return items;
}

/** `GET …/effective`: the headers and variables of the parent fill in what the child lacks. */
function effectiveOf(store: Store, env: EnvironmentResponse): EffectiveEnvironmentResponse {
  const parent =
    env.parent_environment_id == null
      ? undefined
      : store
          .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
          .get(env.parent_environment_id);
  return {
    environment_id: env.id,
    project_id: env.project_id,
    name: env.name,
    masking_hint: true,
    auth: {
      auth_type: env.auth_type,
      auth_config: Object.fromEntries(Object.keys(env.auth_config).map((key) => [key, MASKED])),
    },
    headers: maskedItems(env.default_headers, parent?.default_headers ?? {}),
    variables: maskedItems(env.variables, parent?.variables ?? {}),
    targets: { api: env.base_url, ui: env.frontend_url ?? null, proxy: env.proxy_url ?? null },
    inheritance: {
      auth: false,
      base_url: false,
      frontend_url: env.frontend_url == null && parent?.frontend_url != null,
      proxy_url: false,
      parent_environment_id: parent?.id ?? null,
    },
    conformance_summary: null,
    probe: null,
  };
}

const registered = new WeakSet<Fake>();

type ActivityEventItem = components['schemas']['ActivityEventItem'];
type ActiveExecutionItem = components['schemas']['ActiveExecutionItem'];

const DASHBOARD = 'project_dashboard_reads';

interface StoredDashboard {
  readonly id: string;
  readonly value: unknown;
}

function putDashboard(store: Store, key: string, value: unknown): void {
  const records = store.collection<StoredDashboard>(DASHBOARD);
  records.delete(key);
  records.insert({ id: key, value });
}

function readDashboard<T>(store: Store, key: string): T | undefined {
  return store.collection<StoredDashboard>(DASHBOARD).get(key)?.value as T | undefined;
}

/** The recent events the activity feed answers, newest first (as given). */
export function seedActivity(store: Store, events: readonly ActivityEventItem[]): void {
  putDashboard(store, 'activity', events);
}

/** The runs in progress. */
export function seedActiveRuns(store: Store, runs: readonly ActiveExecutionItem[]): void {
  putDashboard(store, 'active', runs);
}

/** The hits a search answers (the route of routes/projects.ts reads them when seeded). */
export function seededSearchHits(
  store: Store,
): readonly components['schemas']['SearchResultItem'][] | undefined {
  return readDashboard(store, 'search');
}

export function seedSearchHits(
  store: Store,
  hits: readonly components['schemas']['SearchResultItem'][],
): void {
  putDashboard(store, 'search', hits);
}

export function registerProjectModuleRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // The notes of the project, as stored: an unknown project is a 404.
  fake.route('GET', '/api/v1/projects/{project_id}/agent-guidance', (req, store) => {
    const projectId = req.params.project_id;
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    const notes = store
      .collection<StoredNote>(PROJECT_NOTES)
      .list((note) => note.project_id === projectId)
      .map((note) => note.entry);
    return { status: 200, body: notes };
  });

  // One note changed, as the backend does it: the text is not empty and at most 500 characters; a
  // scope changes only from a step of the plan to a page (the noted page, unless the change names
  // one). Refusals are a 400 with a code; an unknown note is a 404.
  fake.route('PATCH', '/api/v1/projects/{project_id}/agent-guidance/{entry_id}', (req, store) => {
    const projectId = req.params.project_id;
    requireStoredProject(store, projectId);
    const notes = store.collection<StoredNote>(PROJECT_NOTES);
    const found = notes.list(
      (note) => note.project_id === projectId && note.entry.id === req.params.entry_id,
    )[0];
    if (found === undefined) {
      throw new FakeHttpError(404, { detail: `Note not found: ${req.params.entry_id}` });
    }
    const refuse: (code: string, message: string) => never = (code, message) => {
      throw new FakeHttpError(400, { detail: { code, message } });
    };
    const change = req.body as {
      text?: string | null;
      scope?: AgentGuidanceEntry['scope'] | null;
    };
    let entry: AgentGuidanceEntry = found.entry;
    if (change.text !== undefined && change.text !== null) {
      const text = change.text.trim();
      if (text === '') refuse('note_empty', 'The note is empty');
      if (text.length > 500) refuse('note_too_long', 'The note is too long');
      entry = { ...entry, text };
    }
    if (change.scope !== undefined && change.scope !== null) {
      const now = entry.scope ?? { kind: 'url_path' as const };
      const same =
        change.scope.kind === now.kind &&
        (change.scope.plan_step ?? null) === (now.plan_step ?? null) &&
        (change.scope.url_path ?? null) === (now.url_path ?? null);
      if (!same) {
        if (now.kind !== 'plan_step' || change.scope.kind !== 'url_path') {
          refuse('guidance_scope_change_not_allowed', 'The scope of a note cannot change so');
        }
        const urlPath = change.scope.url_path || entry.page_path;
        if (!urlPath) {
          refuse('guidance_scope_change_not_allowed', 'The note names no page');
        }
        entry = { ...entry, scope: { kind: 'url_path', url_path: urlPath } };
      }
    }
    notes.update(found.id, { entry });
    return { status: 200, body: entry };
  });

  // The environment of the project by id, the default one, and its effective view (inheritance
  // resolved); the list of the environments is answered by `routes/lookup.ts`.
  fake.route('GET', '/api/v1/projects/{project_id}/environments/default', (req, store) => {
    const projectId = req.params.project_id;
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    const found = store
      .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
      .list((env) => env.project_id === projectId && env.is_default)[0];
    if (found === undefined) {
      throw new FakeHttpError(404, { detail: 'No default environment for this project' });
    }
    return { status: 200, body: found };
  });

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/environments/{environment_id}',
    (req, store) => ({
      status: 200,
      body: environmentOf(store, req.params.project_id, req.params.environment_id),
    }),
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/environments/{environment_id}/effective',
    (req, store) => ({
      status: 200,
      body: effectiveOf(
        store,
        environmentOf(store, req.params.project_id, req.params.environment_id),
      ),
    }),
  );

  // The documentation of the project: the stored OpenAPI version by id (the active one and the
  // list are answered by `routes/suggestions.ts` and `routes/specMigration.ts`), and the AsyncAPI
  // routes, over the versions `seedAsyncSpec` stores.
  fake.route('GET', '/api/v1/openapi-specs/{spec_id}', (req, store) => {
    const spec = store
      .collection<StoredSpec>(SKLEP_COLLECTIONS.specs)
      .require(req.params.spec_id, `OpenAPI spec not found: ${req.params.spec_id}`);
    return { status: 200, body: openapiById(store, spec) };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/asyncapi', (req, store) => {
    requireStoredProject(store, req.params.project_id);
    const current = store
      .collection<StoredAsyncSpec>(ASYNCAPI_SPECS)
      .list((entry) => entry.detail.project_id === req.params.project_id && entry.is_current)[0];
    return { status: 200, body: current?.detail ?? null };
  });

  fake.route('GET', '/api/v1/asyncapi-specs/{spec_id}', (req, store) => ({
    status: 200,
    body: asyncById(
      store
        .collection<StoredAsyncSpec>(ASYNCAPI_SPECS)
        .require(req.params.spec_id, `AsyncAPI spec not found: ${req.params.spec_id}`).detail,
    ),
  }));

  // Activating a stored version: the project then points at it (`openapi_spec_id`, or the current
  // AsyncAPI version). A version of another project is a 400, an unknown one a 404, as the backend
  // answers; the OpenAPI versions of the world carry a `project_id` only when a test plants one.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/openapi-specs/{spec_id}/activate',
    (req, store) => {
      const projectId = req.params.project_id;
      requireStoredProject(store, projectId);
      const spec = store
        .collection<StoredSpec & { project_id?: string }>(SKLEP_COLLECTIONS.specs)
        .require(req.params.spec_id, `OpenAPI spec not found: ${req.params.spec_id}`);
      if (spec.project_id !== undefined && spec.project_id !== projectId) {
        throw new FakeHttpError(400, {
          detail: 'This OpenAPI spec does not belong to this project',
        });
      }
      const updated = store
        .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
        .update(projectId, { openapi_spec_id: spec.id });
      return { status: 200, body: updated };
    },
  );

  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/asyncapi-specs/{spec_id}/activate',
    (req, store) => {
      const projectId = req.params.project_id;
      requireStoredProject(store, projectId);
      const versions = store.collection<StoredAsyncSpec>(ASYNCAPI_SPECS);
      const spec = versions.require(
        req.params.spec_id,
        `AsyncAPI spec not found: ${req.params.spec_id}`,
      );
      if (spec.detail.project_id !== projectId) {
        throw new FakeHttpError(400, {
          detail: 'This AsyncAPI spec does not belong to this project',
        });
      }
      for (const entry of versions.list((item) => item.detail.project_id === projectId)) {
        versions.update(entry.id, { is_current: entry.id === spec.id });
      }
      const updated = store
        .collection<ProjectDetail>(SKLEP_COLLECTIONS.projects)
        .update(projectId, { asyncapi_spec_id: spec.id });
      return { status: 200, body: updated };
    },
  );

  // The parsed endpoints of a stored OpenAPI version: the list (all of them, no paging, the method
  // in lower case), one with its detail, and its binding metadata (method in upper case).
  fake.route('GET', '/api/v1/openapi-specs/{spec_id}/endpoints', (req, store) => {
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.specs)
      .require(req.params.spec_id, `OpenAPI spec not found: ${req.params.spec_id}`);
    const endpoints = store
      .collection<SklepEndpoint>(SKLEP_COLLECTIONS.endpoints)
      .list((endpoint) => endpoint.spec_id === req.params.spec_id)
      .map((endpoint) => ({
        id: endpoint.id,
        method: endpoint.method.toLowerCase(),
        path: endpoint.path,
        operation_id: endpoint.operation_id,
        summary: endpoint.summary,
        tags: endpoint.tags,
        is_crud: endpoint.is_crud,
        crud_operation: endpoint.crud_operation,
        is_paginated: endpoint.is_paginated,
        async_pattern: endpoint.async_pattern,
        parameters_count: endpoint.parameters_count,
        has_request_body: endpoint.has_request_body,
      }));
    return { status: 200, body: { endpoints, total: endpoints.length } };
  });

  fake.route('GET', '/api/v1/openapi-specs/{spec_id}/endpoints/{endpoint_id}', (req, store) => ({
    status: 200,
    body: endpointDetail(store, endpointOf(store, req.params.spec_id, req.params.endpoint_id)),
  }));

  fake.route(
    'GET',
    '/api/v1/openapi-specs/{spec_id}/endpoints/{endpoint_id}/binding-metadata',
    (req, store) => {
      const endpoint = endpointOf(store, req.params.spec_id, req.params.endpoint_id);
      return {
        status: 200,
        body: {
          endpoint_id: endpoint.id,
          method: endpoint.method.toUpperCase(),
          path: endpoint.path,
          expected_status_codes: [200],
          response_schemas: {},
          suggested_assertions: [],
          ...extrasOf(store, endpoint.id)?.bindings,
        },
      };
    },
  );

  // The team of the project and the role of the caller (404 when the caller is not a member).
  fake.route('GET', '/api/v1/projects/{project_id}/team', (req, store) => {
    requireStoredProject(store, req.params.project_id);
    const members = store
      .collection<StoredMember>(TEAM_MEMBERS)
      .list((entry) => entry.member.project_id === req.params.project_id)
      .map((entry) => entry.member);
    return { status: 200, body: members };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/team/me', (req, store) => {
    requireStoredProject(store, req.params.project_id);
    const me = store
      .collection<StoredMember>(TEAM_MEMBERS)
      .list((entry) => entry.member.project_id === req.params.project_id && entry.caller)[0];
    if (me === undefined) throw new FakeHttpError(404, { detail: 'Not a member of this project' });
    const role = me.member.role as 'owner' | 'editor' | 'viewer';
    return {
      status: 200,
      body: {
        user_id: me.member.user_id,
        role,
        permissions: ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS['viewer']!,
      },
    };
  });

  fake.route('GET', '/api/v1/activity', (req, store) => {
    const limit = Number(req.query['limit'] ?? 20);
    const events = (readDashboard<readonly ActivityEventItem[]>(store, 'activity') ?? []).slice(
      0,
      limit,
    );
    return { status: 200, body: { events: [...events], total: events.length } };
  });

  fake.route('GET', '/api/v1/gatling/executions/active', (_req, store) => ({
    status: 200,
    body: {
      executions: [...(readDashboard<readonly ActiveExecutionItem[]>(store, 'active') ?? [])],
    },
  }));
}
