// Routes that describe the project's documentation as LoadCraft understands it: the API map
// and the endpoint-conformance probe of one environment
//. Both read the operations of the stored specification, so they answer
// from the same records as `GET …/openapi`. Registration is idempotent per fake.
//
// The conformance probe of the sklep world finds every GET operation on the target and leaves the
// other methods unprobed, which is the report the perf environment of the sklep world carries.
// A test that needs another report queues it with `fake.faults.next`.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepEndpoint } from '../worlds/sklep.js';
import { currentSpec, operationsOf, saveSpecification } from './setup.js';

type ApiMapResponse = components['schemas']['ApiMapResponse'];
type ConformanceReport = components['schemas']['ConformanceReport'];
type EnvironmentResponse = components['schemas']['EnvironmentResponse'];

/** Time stamp of the reports (the handlers have no clock). */
const CHECKED_AT = '2026-11-22T10:00:00Z';
/** Methods the map leaves out (`total_operations` counts neither). */
const NOT_OPERATIONS = new Set(['OPTIONS', 'HEAD']);

const registeredMap = new WeakSet<Fake>();
const registeredConformance = new WeakSet<Fake>();
const registeredUpload = new WeakSet<Fake>();

type ProjectDetail = components['schemas']['ProjectDetail'];

/**
 * `POST …/openapi/upload`: the file becomes the current specification as a new
 * row; the previous one stays in the history. 400 for a file that is not a JSON object.
 */
export function registerOpenapiUploadRoute(fake: Fake): void {
  if (registeredUpload.has(fake)) return;
  registeredUpload.add(fake);
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/openapi/upload',
    (req, store) => {
      const projectId = req.params.project_id;
      const projects = store.collection<ProjectDetail>(SKLEP_COLLECTIONS.projects);
      projects.require(projectId, `Project not found: ${projectId}`);
      const file = req.files.find((item) => item.field === 'file');
      if (file === undefined) throw new FakeHttpError(400, { detail: 'No file provided' });
      let document: unknown;
      try {
        document = JSON.parse(file.content.toString());
      } catch {
        throw new FakeHttpError(400, { detail: 'The file is not valid JSON' });
      }
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new FakeHttpError(400, { detail: 'The document is not a JSON object' });
      }
      saveSpecification(store, projectId, document as Record<string, unknown>);
      return { status: 200, body: projects.require(projectId, `Project not found: ${projectId}`) };
    },
    { auth: 'none' },
  );
}

/** Operations of the project's current specification, without the methods the map leaves out. */
function operations(store: Store, specId: string): SklepEndpoint[] {
  return operationsOf(store, specId).filter((endpoint) => !NOT_OPERATIONS.has(endpoint.method));
}

/** The area prefixes saved by hand, per project (what the profile of the real backend holds). */
export const SAVED_AREA_PREFIXES = 'project_saved_area_prefixes';

interface SavedPrefixes {
  readonly id: string;
  readonly prefixes: readonly string[];
}

/** The prefixes saved for the project, sorted; null while the areas are the detected ones. */
export function savedAreaPrefixes(store: Store, projectId: string): readonly string[] | null {
  return store.collection<SavedPrefixes>(SAVED_AREA_PREFIXES).get(projectId)?.prefixes ?? null;
}

/** Plants the prefixes saved for the project (a test's start state), as the backend keeps them. */
export function seedAreaPrefixes(
  store: Store,
  projectId: string,
  prefixes: readonly string[],
): void {
  const collection = store.collection<SavedPrefixes>(SAVED_AREA_PREFIXES);
  collection.delete(projectId);
  collection.insert({ id: projectId, prefixes: [...prefixes].sort() });
}

const whole = (endpoint: SklepEndpoint): string => `${endpoint.method} ${endpoint.path}`;

/** The map of the project: the saved prefixes make the areas, else the first tags do. */
function apiMapOf(store: Store, projectId: string): ApiMapResponse {
  store
    .collection(SKLEP_COLLECTIONS.projects)
    .require(projectId, `Project not found: ${projectId}`);
  const spec = currentSpec(store, projectId);
  if (spec === undefined) {
    throw new FakeHttpError(404, {
      detail: `Project ${projectId} has no OpenAPI specification to map`,
    });
  }
  const all = operations(store, spec.id);
  const saved = savedAreaPrefixes(store, projectId);
  const areaOf = (endpoint: SklepEndpoint): string =>
    endpoint.tags[0] ?? endpoint.path.split('/')[1] ?? '';
  const detected = [...new Set(all.map(areaOf))];
  const base = {
    budget: {
      budget_chars: 60000,
      description_counted: false,
      fixed_chars: 4000,
      site: 'flow_generation' as const,
      subject: 'selection' as const,
      whole_api_chars: 30000,
    },
    digest: 'sklep-map',
    preview: false,
    title: spec.title,
    total_operations: all.length,
  };
  if (saved === null) {
    return {
      ...base,
      area_rule: 'detected',
      areas: detected.map((prefix) => ({
        name: prefix,
        prefix: `/${prefix}`,
        operations: all.filter((endpoint) => areaOf(endpoint) === prefix).map(whole),
      })),
    };
  }
  const longest = (path: string): string | undefined =>
    [...saved]
      .filter((prefix) => path === prefix || path.startsWith(`${prefix}/`))
      .sort((a, b) => b.length - a.length)[0];
  const areas = saved
    .map((prefix) => ({
      name: prefix.slice(1),
      prefix,
      operations: all.filter((endpoint) => longest(endpoint.path) === prefix).map(whole),
    }))
    .filter((area) => area.operations.length > 0);
  return {
    ...base,
    area_rule: 'manual',
    areas,
    saved_area_prefixes: [...saved],
    empty_area_prefixes: saved.filter((prefix) => !areas.some((area) => area.prefix === prefix)),
    outside_area: all.filter((endpoint) => longest(endpoint.path) === undefined).map(whole),
    detected_area_prefixes: detected.map((prefix) => `/${prefix}`),
  };
}

/** What the backend refuses of a list of prefixes (422), else the list as it keeps it. */
function normalized(prefixes: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of prefixes) {
    const prefix = raw.trim();
    if (!prefix.startsWith('/')) {
      throw new FakeHttpError(422, { detail: `area prefix '${prefix}' must start with /` });
    }
    if (/\s/u.test(prefix)) {
      throw new FakeHttpError(422, { detail: `area prefix '${prefix}' has whitespace in it` });
    }
    if (prefix.replace(/\/+$/u, '') === '') {
      throw new FakeHttpError(422, {
        detail: `area prefix '${prefix}' is the whole API, not an area of it`,
      });
    }
    const kept = prefix.replace(/\/+$/u, '');
    if (seen.has(kept)) {
      throw new FakeHttpError(422, { detail: `area prefix '${kept}' is given twice` });
    }
    seen.add(kept);
  }
  if (seen.size === 0) throw new FakeHttpError(422, { detail: 'set at least one area prefix' });
  return [...seen].sort();
}

/**
 * `GET …/api-map` (404 while the project has no specification; the areas are the saved prefixes,
 * else the first tags) and `PUT …/api-map/area-prefixes` (saves them; null: the detected areas).
 */
export function registerApiMapRoute(fake: Fake): void {
  if (registeredMap.has(fake)) return;
  registeredMap.add(fake);
  fake.route('GET', '/api/v1/projects/{project_id}/api-map', (req, store) => ({
    status: 200,
    body: apiMapOf(store, req.params.project_id),
  }));
  fake.route('PUT', '/api/v1/projects/{project_id}/api-map/area-prefixes', (req, store) => {
    const projectId = req.params.project_id;
    apiMapOf(store, projectId);
    const { area_prefixes: wanted } = req.body as { area_prefixes: string[] | null };
    const collection = store.collection<SavedPrefixes>(SAVED_AREA_PREFIXES);
    if (wanted === null) collection.delete(projectId);
    else {
      const prefixes = normalized(wanted);
      collection.delete(projectId);
      collection.insert({ id: projectId, prefixes });
    }
    return { status: 200, body: apiMapOf(store, projectId) };
  });
}

/** `POST …/environments/{id}/conformance`: GET operations exist, the rest is left unprobed. */
export function registerConformanceRoute(fake: Fake): void {
  if (registeredConformance.has(fake)) return;
  registeredConformance.add(fake);
  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
    (req, store) => {
      const { project_id: projectId, environment_id: id } = req.params;
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(projectId, `Project not found: ${projectId}`);
      const environment = store
        .collection<EnvironmentResponse>(SKLEP_COLLECTIONS.environments)
        .require(id, `Environment not found: ${id}`);
      const spec = currentSpec(store, projectId);
      const all = spec === undefined ? [] : operations(store, spec.id);
      const checked = all.filter((endpoint) => endpoint.method === 'GET');
      const body: ConformanceReport = {
        base_url: environment.base_url,
        checked_at: CHECKED_AT,
        exists: checked.map((endpoint) => ({
          classification: 'exists',
          method: endpoint.method,
          path: endpoint.path,
          http_status: 200,
        })),
        sampled: {
          probed: checked.length,
          not_probed_methods: all.length - checked.length,
          not_probed_off_host: 0,
          skipped_param_paths: 0,
        },
        headers_sent: [],
        status: 'complete',
        totals: { exists: checked.length, inconclusive: 0, missing: 0 },
      };
      return { status: 200, body };
    },
    { auth: 'none' },
  );
}
