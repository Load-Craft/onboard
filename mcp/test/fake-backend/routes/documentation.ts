// Routes that describe the project's documentation as LoadCraft understands it: the API map
// (`project_api_map.py`) and the endpoint-conformance probe of one environment
// (`project_environments.py`). Both read the operations of the stored specification, so they answer
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
 * `POST …/openapi/upload` (`projects.py:1131`): the file becomes the current specification as a new
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

/** `GET …/api-map`: 404 while the project has no specification; areas are the first tags. */
export function registerApiMapRoute(fake: Fake): void {
  if (registeredMap.has(fake)) return;
  registeredMap.add(fake);
  fake.route('GET', '/api/v1/projects/{project_id}/api-map', (req, store) => {
    const projectId = req.params.project_id;
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
    const areaOf = (endpoint: SklepEndpoint): string =>
      endpoint.tags[0] ?? endpoint.path.split('/')[1] ?? '';
    const prefixes = [...new Set(all.map(areaOf))];
    const body: ApiMapResponse = {
      area_rule: 'detected',
      areas: prefixes.map((prefix) => ({
        name: prefix,
        prefix: `/${prefix}`,
        operations: all
          .filter((endpoint) => areaOf(endpoint) === prefix)
          .map((endpoint) => `${endpoint.method} ${endpoint.path}`),
      })),
      budget: {
        budget_chars: 60000,
        description_counted: false,
        fixed_chars: 4000,
        site: 'flow_generation',
        subject: 'selection',
        whole_api_chars: 30000,
      },
      digest: 'sklep-map',
      preview: false,
      title: spec.title,
      total_operations: all.length,
    };
    return { status: 200, body };
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
