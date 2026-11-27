// Telemetry-source routes of the fake backend: read, replace,
// remove and the connection test, over the `telemetry_sources` collection of the sklep world (one
// record per project, keyed by the project id). The connection test answers with the tools the
// test configured for the fake, like the real one lists the tools of the customer's log server.
// Registration is idempotent per fake, so every tool test that needs the routes can call it.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepTelemetrySource } from '../worlds/sklep.js';

type TelemetryTool = components['schemas']['TelemetryTool'];

const registered = new WeakSet<Fake>();

/** What the fake's log server offers by default: two window tools and one that needs a service. */
export const OFFERED_TOOLS: readonly TelemetryTool[] = [
  {
    name: 'logs_summary',
    description: 'Summary of the logs in a time window.',
    input_schema: {
      type: 'object',
      properties: { start: { type: 'string' }, end: { type: 'string' } },
      required: ['start', 'end'],
    },
    window_tool: true,
  },
  {
    name: 'container_events',
    description: 'Container restarts and kills in a time window.',
    input_schema: {
      type: 'object',
      properties: { start: { type: 'string' }, end: { type: 'string' } },
      required: ['start', 'end'],
    },
    window_tool: true,
  },
  {
    name: 'trace_search',
    description: 'Traces of one service in a time window.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string' },
        end: { type: 'string' },
        service: { type: 'string' },
      },
      required: ['start', 'end', 'service'],
    },
    window_tool: false,
  },
];

export interface TelemetryRouteOptions {
  /** Tools the source offers; default `OFFERED_TOOLS`. */
  readonly tools?: readonly TelemetryTool[];
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/u;

/**
 * The SSRF authority's verdict: a private or local host is refused (`validate_target_url`). The
 * real route answers 422 with a plain-text `detail`; the snapshot types 422 only as a validation
 * list, which the fake's contract check enforces, so the refusal is sent in that shape.
 */
function refuseBlockedHost(url: string): void {
  const parsed = new URL(url);
  if (parsed.search !== '' || parsed.hash !== '' || parsed.username !== '') {
    throw new FakeHttpError(422, {
      detail: [
        {
          type: 'value_error',
          loc: ['body', 'url'],
          msg: 'credentials in the URL are not supported',
        },
      ],
    });
  }
  const host = parsed.hostname;
  if (PRIVATE_HOST.test(host)) {
    throw new FakeHttpError(422, {
      detail: [
        {
          type: 'value_error',
          loc: ['body', 'url'],
          msg: `Target host is not allowed: ${host} is a private address`,
        },
      ],
    });
  }
}

function requireProject(store: Store, id: string): void {
  store.collection(SKLEP_COLLECTIONS.projects).require(id, `Project not found: ${id}`);
}

/** Registers the four routes of `…/telemetry-source`, once per fake. */
export function registerTelemetryRoutes(fake: Fake, options: TelemetryRouteOptions = {}): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  const tools = options.tools ?? OFFERED_TOOLS;
  const path = '/api/v1/projects/{project_id}/telemetry-source';

  fake.route('GET', path, (req, store) => {
    requireProject(store, req.params.project_id);
    const stored = store
      .collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry)
      .get(req.params.project_id);
    if (stored === undefined) return { status: 200, body: { telemetry_source: null } };
    const source = {
      kind: stored.kind,
      label: stored.label,
      url: stored.url,
      enabled_tools: stored.enabled_tools ?? [],
    };
    return { status: 200, body: { telemetry_source: source } };
  });

  fake.route('PUT', path, (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as components['schemas']['TelemetrySource'];
    refuseBlockedHost(body.url);
    const collection = store.collection<SklepTelemetrySource>(SKLEP_COLLECTIONS.telemetry);
    collection.delete(req.params.project_id);
    const source = {
      kind: 'mcp' as const,
      label: body.label,
      url: body.url,
      enabled_tools: body.enabled_tools ?? [],
    };
    collection.insert({ id: req.params.project_id, ...source });
    return { status: 200, body: { telemetry_source: source } };
  });

  fake.route('DELETE', path, (req, store) => {
    requireProject(store, req.params.project_id);
    store.collection(SKLEP_COLLECTIONS.telemetry).delete(req.params.project_id);
    return { status: 204 };
  });

  fake.route('POST', `${path}/test`, (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as components['schemas']['TelemetryProbeBody'];
    refuseBlockedHost(body.url);
    return { status: 200, body: { tools: [...tools] } };
  });
}
