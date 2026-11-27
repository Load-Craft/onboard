// Routes of the module traffic: what a sender needs to push production traffic (the recipe, the push
// tokens) and the snapshots it pushed (the list, one with its report and series, the format sample).
// Shapes are the contract's; a test puts its own answer in with the seeding functions.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake } from '../server.js';
import type { Store } from '../store.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

type Recipe = components['schemas']['IngestRecipe'];
type TokenList = components['schemas']['IngestTokenList'];
type TokenSummary = components['schemas']['IngestTokenSummary'];
type Limits = components['schemas']['ProductionTrafficLimits'];
type SnapshotDetail = components['schemas']['SnapshotDetail'];
type SnapshotSummary = components['schemas']['SnapshotSummary'];
type Samples = components['schemas']['TrafficSamples'];

export const TRAFFIC_RECIPES = 'traffic_recipes';
export const TRAFFIC_TOKENS = 'traffic_tokens';
export const TRAFFIC_SNAPSHOTS = 'traffic_snapshots';

export const TRAFFIC_LIMITS: Limits = {
  max_bucket_seconds: 3600,
  max_packet_bytes: 20_971_520,
  max_routes: 500,
  max_rows: 250_000,
  max_window_days: 31,
  min_bucket_seconds: 1,
  packets_per_token_per_hour: 60,
  profile_horizon_days: 28,
  profile_k: 10,
  snapshots_kept_per_sender: 14,
};

/** The recipe of a project whose public address is configured. */
export const SAMPLE_RECIPE: Recipe = {
  curl:
    'curl -X POST https://lc.example.test/api/v1/production-traffic/push ' +
    '-H "Authorization: Bearer $LOADCRAFT_INGEST_TOKEN" -H "Content-Type: application/json" --data @packet.json',
  excluded_windows: [
    {
      start: '2026-11-20T10:00:00Z',
      end: '2026-11-20T10:30:00Z',
      reason: 'LoadCraft run e-1a2b3c4d',
    },
  ],
  limits: TRAFFIC_LIMITS,
  public_base_url: 'https://lc.example.test',
  runs_without_window: [],
  runs_without_window_note: null,
  scripts: [
    {
      name: 'push-from-logs.sh',
      purpose: 'Counts requests per route from access logs and writes a packet.',
      script: 'import sys\n# reads access logs\n',
      command: '',
    },
    {
      name: 'push-from-prometheus.sh',
      purpose: 'Reads request rates from Prometheus and pushes a packet.',
      script: 'import json\n# queries Prometheus\n',
      command: 'sh push-from-prometheus.sh --url http://prometheus:9090',
    },
  ],
  warning: null,
};

interface StoredRecipe {
  readonly id: string;
  readonly recipe: Recipe;
}

interface StoredToken {
  readonly id: string;
  readonly project_id: string;
  readonly token: TokenSummary;
}

/** The recipe the project answers with; without one, `SAMPLE_RECIPE`. */
export function seedTrafficRecipe(store: Store, projectId: string, recipe: Recipe): void {
  const recipes = store.collection<StoredRecipe>(TRAFFIC_RECIPES);
  if (recipes.get(projectId) !== undefined) recipes.update(projectId, { recipe });
  else recipes.insert({ id: projectId, recipe });
}

/** Push tokens of the project, newest first as given. */
export function seedTrafficTokens(
  store: Store,
  projectId: string,
  tokens: readonly TokenSummary[],
): void {
  const collection = store.collection<StoredToken>(TRAFFIC_TOKENS);
  for (const token of tokens) collection.insert({ id: token.id, project_id: projectId, token });
}

/** A snapshot of a day of production traffic, pushed by a token, two routes, hourly buckets. */
export function sampleSnapshot(overrides: Partial<SnapshotDetail> = {}): SnapshotDetail {
  return {
    id: '0d0c7034-0006-4000-8000-000000000001',
    created_at: '2026-11-27T01:00:00Z',
    created_by: null,
    channel: 'push',
    token_id: '0d0c7034-0005-4000-8000-000000000001',
    token_label: 'nightly-sender',
    packet_id: 'pkt-20261127',
    content_sha256: 'a'.repeat(64),
    window_start: '2026-11-26T00:00:00Z',
    window_end: '2026-11-27T00:00:00Z',
    bucket_seconds: 3600,
    unit: 'requests',
    timezone: 'Europe/Warsaw',
    entry_route: 'GET /',
    routes_count: 2,
    rows_count: 48,
    source: { kind: 'prometheus', query: 'sum by (route) (rate(http_requests_total[1h]))' },
    quality: {
      buckets: 24,
      gaps: 1,
      partials: 0,
      resets: 0,
      routes: 2,
      rows: 48,
      session_profile: null,
      total_count: 12_400,
      unusable: 0,
    },
    report: {
      buckets: 24,
      gaps: [{ start: '2026-11-26T03:00:00Z', end: '2026-11-26T04:00:00Z' }],
      partials: 0,
      resets: 0,
      routes: ['GET /', 'POST /cart'],
      rows: 48,
      session_profile: null,
      total_count: 12_400,
      unusable: [],
    },
    excluded_windows: [],
    series: [
      {
        route: 'GET /',
        points: [
          { bucket_start: '2026-11-26T00:00:00Z', count: 300, quality: 'ok' },
          { bucket_start: '2026-11-26T01:00:00Z', count: 500, quality: 'ok' },
        ],
      },
      {
        route: 'POST /cart',
        points: [{ bucket_start: '2026-11-26T00:00:00Z', count: 40, quality: 'ok' }],
      },
    ],
    ...overrides,
  };
}

/** What the list shows of a stored snapshot. */
export function summaryOf(detail: SnapshotDetail): SnapshotSummary {
  const summary: Partial<SnapshotDetail> = { ...detail };
  delete summary.report;
  delete summary.excluded_windows;
  delete summary.series;
  return summary as SnapshotSummary;
}

interface StoredSnapshot {
  readonly id: string;
  readonly project_id: string;
  readonly detail: SnapshotDetail;
}

/** Snapshots of the project, newest first as given. */
export function seedTrafficSnapshots(
  store: Store,
  projectId: string,
  snapshots: readonly SnapshotDetail[],
): void {
  const collection = store.collection<StoredSnapshot>(TRAFFIC_SNAPSHOTS);
  for (const detail of snapshots) {
    collection.insert({ id: detail.id, project_id: projectId, detail });
  }
}

/** The format sample: a CSV of rows and the same rows as a packet, with its schema. */
export const SAMPLE_PACKET: Samples = {
  csv: 'bucket_start,route,count\n2026-11-26T00:00:00Z,GET /,300\n',
  packet: {
    version: 1,
    window: { start: '2026-11-26T00:00:00Z', end: '2026-11-27T00:00:00Z' },
    bucket_seconds: 3600,
    unit: 'requests',
    rows: [{ bucket_start: '2026-11-26T00:00:00Z', route: 'GET /', count: 300 }],
  },
  packet_schema: { title: 'TrafficPacketV1', type: 'object' },
};

const registered = new WeakSet<Fake>();

export function registerTrafficRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  const project = (store: Store, projectId: string): void => {
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
  };
  fake.route('GET', '/api/v1/projects/{project_id}/production-traffic/recipe', (req, store) => {
    const projectId = req.params.project_id;
    project(store, projectId);
    const stored = store.collection<StoredRecipe>(TRAFFIC_RECIPES).get(projectId);
    return { status: 200, body: stored?.recipe ?? SAMPLE_RECIPE };
  });
  const snapshots = (store: Store, projectId: string): StoredSnapshot[] =>
    store
      .collection<StoredSnapshot>(TRAFFIC_SNAPSHOTS)
      .list((snapshot) => snapshot.project_id === projectId);
  fake.route('GET', '/api/v1/projects/{project_id}/production-traffic/snapshots', (req, store) => {
    const projectId = req.params.project_id;
    project(store, projectId);
    const body = {
      limits: TRAFFIC_LIMITS,
      snapshots: snapshots(store, projectId).map((snapshot) => summaryOf(snapshot.detail)),
    };
    return { status: 200, body };
  });
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/production-traffic/snapshots/{snapshot_id}',
    (req, store) => {
      const projectId = req.params.project_id;
      project(store, projectId);
      const found = store
        .collection<StoredSnapshot>(TRAFFIC_SNAPSHOTS)
        .require(req.params.snapshot_id, `Snapshot not found: ${req.params.snapshot_id}`);
      return { status: 200, body: found.detail };
    },
  );
  fake.route('GET', '/api/v1/projects/{project_id}/production-traffic/samples', (req, store) => {
    project(store, req.params.project_id);
    return { status: 200, body: SAMPLE_PACKET };
  });
  fake.route('GET', '/api/v1/projects/{project_id}/production-traffic/tokens', (req, store) => {
    const projectId = req.params.project_id;
    project(store, projectId);
    const tokens = store
      .collection<StoredToken>(TRAFFIC_TOKENS)
      .list((token) => token.project_id === projectId)
      .map((token) => token.token);
    const body: TokenList = { limits: TRAFFIC_LIMITS, tokens };
    return { status: 200, body };
  });
  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/production-traffic/snapshots/{snapshot_id}',
    (req, store) => {
      project(store, req.params.project_id);
      const all = store.collection<StoredSnapshot>(TRAFFIC_SNAPSHOTS);
      const found = all.require(req.params.snapshot_id, 'Snapshot not found');
      all.delete(found.id);
      return { status: 200, body: { id: found.id, reopened_window: null } };
    },
  );
  // Revoking is idempotent: a token revoked already is answered as one revoked now.
  fake.route(
    'DELETE',
    '/api/v1/projects/{project_id}/production-traffic/tokens/{token_id}',
    (req, store) => {
      project(store, req.params.project_id);
      const all = store.collection<StoredToken>(TRAFFIC_TOKENS);
      const found = all.require(req.params.token_id, 'Token not found');
      if (found.token.revoked_at == null) {
        all.update(found.id, { token: { ...found.token, revoked_at: '2026-11-27T12:00:00Z' } });
      }
      return { status: 204 };
    },
  );
}
