// Writes behind `project_create`, `project_save_env` and `project_check_env`, over the project and
// environment collections of the sklep world: the search box, project creation (with its first, default environment), environment creation,
// the default switch and the connection test. The reads of the same records (project list and
// detail, environment list) are `registerLookupRoutes` (`routes/lookup.ts`); a test of
// the project setup registers both groups. Registration is idempotent per fake.

import { isIP } from 'node:net';

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];
type CreateProjectRequest = components['schemas']['CreateProjectRequest'];
type CreateEnvironmentRequest = components['schemas']['CreateEnvironmentRequest'];
type UpdateEnvironmentRequest = components['schemas']['UpdateEnvironmentRequest'];
type ConnectionProbeResult = components['schemas']['ConnectionProbeResult'];

/** Time stamp of the records this group writes (the handlers have no clock). */
const WRITTEN_AT = '2026-11-22T10:00:00Z';
/** Answer time of a reachable target, by probe kind. */
const LATENCY_MS = { base_url: 42, frontend_url: 58 } as const;
const MASK = '«masked»';
const SEARCH_DEFAULT_LIMIT = 20;
/** `q: str = Query(min_length=1, max_length=100)`, `limit` 1–50 (`dashboard.py:426-430`). */
const SEARCH_QUERY_MAX = 100;

const registered = new WeakSet<Fake>();

/**
 * What each environment was sent as `default_headers`, in clear: the records the fake serves carry
 * the mask (the backend masks every sensitive-looking header on read), so a test that checks what
 * reached the backend reads the clear values here. Keyed by fake, then by environment id.
 */
const headerValues = new WeakMap<Fake, Map<string, Record<string, string>>>();

export function storedHeaderValues(fake: Fake, environmentId: string): Record<string, string> {
  return headerValues.get(fake)?.get(environmentId) ?? {};
}

/** Replaces the headers of an environment (`repo.update` writes the dict it is given as it is). */
function writeHeaders(
  fake: Fake,
  environmentId: string,
  headers: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (headers == null) return undefined;
  const clear = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)]));
  const byEnvironment = headerValues.get(fake) ?? new Map<string, Record<string, string>>();
  byEnvironment.set(environmentId, clear);
  headerValues.set(fake, byEnvironment);
  return Object.fromEntries(Object.keys(clear).map((name) => [name, MASK]));
}

function projects(store: Store) {
  return store.collection<ProjectDetail>(SKLEP_COLLECTIONS.projects);
}

function environments(store: Store) {
  return store.collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments);
}

function requireProject(store: Store, id: string): ProjectDetail {
  return projects(store).require(id, `Project not found: ${id}`);
}

/** The environment of this project (`project_environments.py:846-870`: 404, then 400). */
function requireEnvironment(store: Store, projectId: string, id: string): EnvironmentResponse {
  requireProject(store, projectId);
  const found = environments(store).require(id, `Environment not found: ${id}`);
  if (found.project_id !== projectId) {
    throw new FakeHttpError(400, { detail: 'Environment does not belong to this project' });
  }
  return found;
}

/** A masked value sent back is refused before any write (`api/masking.py:46-88`). */
function refuseMask(body: unknown): void {
  if (JSON.stringify(body ?? null).includes(MASK)) {
    throw new FakeHttpError(422, { detail: 'A masked value cannot be saved; send the real value' });
  }
}

/** Only one default per project: setting one clears the rest (`project_environment_repository.py:47-49`). */
function makeDefault(store: Store, projectId: string, id: string): void {
  const collection = environments(store);
  for (const item of collection.list((e) => e.project_id === projectId)) {
    collection.update(item.id, { is_default: item.id === id });
  }
}

function environmentRecord(
  store: Store,
  projectId: string,
  fields: {
    name: string;
    base_url: string;
    frontend_url?: string | null | undefined;
    is_default: boolean;
    protected?: boolean | undefined;
    workload_caps?: Record<string, unknown> | null | undefined;
  },
): EnvironmentResponse {
  return {
    id: store.newId(),
    project_id: projectId,
    name: fields.name,
    description: null,
    base_url: fields.base_url,
    frontend_url: fields.frontend_url ?? null,
    proxy_url: null,
    default_headers: {},
    auth_type: 'none',
    auth_config: {},
    variables: {},
    is_active: true,
    is_default: fields.is_default,
    protected: fields.protected ?? false,
    workload_caps: fields.workload_caps ?? null,
    parent_environment_id: null,
    last_probe: null,
    last_conformance: null,
  };
}

/**
 * What `validate_target_url` refuses (`domain/utils/ssrf.py:95-175`): the name `localhost` and IP
 * literals that are loopback, private, unspecified or link-local. Host names are not resolved.
 */
function privateTarget(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  if (isIP(bare) === 4) {
    const [a = 0, b = 0] = bare.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(bare) === 6) {
    return bare === '::' || bare === '::1' || /^f[cd]/.test(bare) || /^fe[89ab]/.test(bare);
  }
  return false;
}

/**
 * One probe (`project_environments.py:1178-1323`). A private target is `blocked`; a host under the
 * reserved `.invalid` domain never resolves, so it is `unreachable`; anything else answers 200.
 */
function probe(kind: 'base_url' | 'frontend_url', target: string): ConnectionProbeResult {
  const host = new URL(target).hostname;
  if (privateTarget(host)) {
    return {
      kind,
      target,
      status: 'blocked',
      detail: 'Target resolves to a private or loopback address',
    };
  }
  if (host.endsWith('.invalid')) {
    return { kind, target, status: 'unreachable', detail: 'Name or service not known' };
  }
  return { kind, target, status: 'ok', http_status: 200, latency_ms: LATENCY_MS[kind] };
}

/** Registers the write routes of the project setup and the search box; idempotent per fake. */
export function registerProjectRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // `dashboard.py:426-500`: case-insensitive substring of name or description, newest first.
  fake.route(
    'GET',
    '/api/v1/search',
    (req, store) => {
      const raw = req.query['q'] ?? '';
      const limit = Number(req.query['limit'] ?? SEARCH_DEFAULT_LIMIT);
      if (raw.length < 1 || raw.length > SEARCH_QUERY_MAX || !(limit >= 1 && limit <= 50)) {
        throw new FakeHttpError(422, {
          detail: [{ type: 'string_too_long', loc: ['query', 'q'], msg: 'Invalid query' }],
        });
      }
      const q = raw.trim().toLowerCase();
      const results = projects(store)
        .list(
          (project) =>
            project.name.toLowerCase().includes(q) ||
            (project.description ?? '').toLowerCase().includes(q),
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map((project) => ({
          id: project.id,
          type: 'project',
          title: project.name,
          subtitle: `${project.project_type} project`,
          href: `/projects/${project.id}`,
        }));
      return { status: 200, body: { results, total: results.length } };
    },
    { auth: 'none' },
  );

  // `projects.py:290-402`: refusals first, then the project, its first environment and the owner.
  fake.route(
    'POST',
    '/api/v1/projects',
    (req, store) => {
      const body = req.body as CreateProjectRequest;
      refuseMask(body);
      if (projects(store).list((project) => project.name === body.name).length > 0) {
        throw new FakeHttpError(400, {
          detail: `Project with name "${body.name}" already exists`,
        });
      }
      const project: ProjectDetail = {
        id: store.newId(),
        name: body.name,
        description: body.description ?? null,
        project_type: body.project_type,
        base_url: body.base_url,
        openapi_spec_id: null,
        default_headers: {},
        auth_config: {},
        variables: {},
        is_active: true,
        created_at: WRITTEN_AT,
        updated_at: WRITTEN_AT,
        created_by: req.userId ?? null,
      };
      projects(store).insert(project);
      if (body.base_url.trim() !== '') {
        environments(store).insert(
          environmentRecord(store, project.id, {
            name: body.environment_name,
            base_url: body.base_url,
            frontend_url: body.frontend_url,
            is_default: true,
          }),
        );
      }
      return { status: 200, body: project };
    },
    { auth: 'optional' },
  );

  // `PUT /api/v1/projects/{project_id}`: a field left out or null stays as it is; the profile sent
  // replaces the stored one whole, except the agent guidance, which the backend keeps.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}',
    (req, store) => {
      const id = req.params.project_id;
      const found = requireProject(store, id);
      const body = req.body as components['schemas']['UpdateProjectRequest'];
      refuseMask(body);
      const profile = body.project_profile;
      const updated = projects(store).update(found.id, {
        ...(body.name == null ? {} : { name: body.name }),
        ...(body.description == null ? {} : { description: body.description }),
        ...(profile == null
          ? {}
          : {
              project_profile: {
                ...profile,
                agent_guidance:
                  found.project_profile?.agent_guidance ?? profile.agent_guidance ?? [],
              },
            }),
        updated_at: WRITTEN_AT,
      });
      return { status: 200, body: updated };
    },
    { auth: 'none' },
  );

  // `project_environments.py:772-823`.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/environments',
    (req, store) => {
      const projectId = req.params.project_id;
      requireProject(store, projectId);
      const body = req.body as CreateEnvironmentRequest;
      refuseMask(body);
      const taken = environments(store).list(
        (item) => item.project_id === projectId && item.name === body.name,
      );
      if (taken.length > 0) {
        throw new FakeHttpError(400, {
          detail: `Environment with name "${body.name}" already exists`,
        });
      }
      const created = environments(store).insert(
        environmentRecord(store, projectId, {
          name: body.name,
          base_url: body.base_url,
          frontend_url: body.frontend_url,
          is_default: body.is_default,
          protected: body.protected,
          workload_caps: body.workload_caps,
        }),
      );
      if (body.is_default) makeDefault(store, projectId, created.id);
      const masked = writeHeaders(fake, created.id, body.default_headers);
      const stored =
        masked === undefined
          ? environments(store).require(created.id)
          : environments(store).update(created.id, { default_headers: masked });
      return { status: 200, body: stored };
    },
    { auth: 'none' },
  );

  // `project_environments.py:1017-1090`: only the fields the request carries change; the fake
  // models the two this client sends, the protection flag and the workload caps.
  fake.route(
    'PUT',
    '/api/v1/projects/{project_id}/environments/{environment_id}',
    (req, store) => {
      const { project_id: projectId, environment_id: id } = req.params;
      const body = req.body as UpdateEnvironmentRequest;
      refuseMask(body);
      const found = requireEnvironment(store, projectId, id);
      const updated = environments(store).update(found.id, {
        ...(body.protected == null ? {} : { protected: body.protected }),
        ...(body.workload_caps == null ? {} : { workload_caps: body.workload_caps }),
        ...(body.default_headers == null
          ? {}
          : { default_headers: writeHeaders(fake, found.id, body.default_headers) ?? {} }),
      });
      return { status: 200, body: updated };
    },
    { auth: 'none' },
  );

  // `project_environments.py:1094-1121`.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/environments/{environment_id}/set-default',
    (req, store) => {
      const { project_id: projectId, environment_id: id } = req.params;
      const found = requireEnvironment(store, projectId, id);
      makeDefault(store, projectId, found.id);
      return {
        status: 200,
        body: {
          success: true,
          message: `Environment "${found.name}" set as default`,
          environment_id: found.id,
        },
      };
    },
    { auth: 'none' },
  );

  // `project_environments.py:1330-1396`: the API address, then the frontend when set.
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/environments/{environment_id}/test-connection',
    (req, store) => {
      const { project_id: projectId, environment_id: id } = req.params;
      const found = requireEnvironment(store, projectId, id);
      const results = [probe('base_url', found.base_url)];
      if (found.frontend_url != null && found.frontend_url !== '') {
        results.push(probe('frontend_url', found.frontend_url));
      }
      const report = { checked_at: WRITTEN_AT, results, protected: found.protected };
      environments(store).update(found.id, { last_probe: report });
      return { status: 200, body: report };
    },
    { auth: 'none' },
  );
}
