// `traffic_list_snapshots` (module traffic): the snapshots of production traffic the project holds,
// read from the fake backend over HTTP (docs/tools/traffic/list-snapshots.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { trafficListSnapshots } from '../../../src/tools/traffic/listSnapshots.js';
import { registerLookupRoutes } from '../../fake-backend/routes/lookup.js';
import {
  registerTrafficRoutes,
  sampleSnapshot,
  seedTrafficSnapshots,
} from '../../fake-backend/routes/traffic.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';
import { createTestClock } from '../../helpers/clock.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

const PROJECT = SKLEP_IDS.project;
const BASE = `/api/v1/projects/${PROJECT}/production-traffic`;
const FIRST = '0d0c7034-0006-4000-8000-000000000001';
const SECOND = '0d0c7034-0006-4000-8000-000000000002';

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

const TWO = (fake: Fake): void =>
  seedTrafficSnapshots(fake.store, PROJECT, [
    sampleSnapshot(),
    sampleSnapshot({
      id: SECOND,
      created_at: '2026-11-20T09:00:00Z',
      channel: 'file',
      token_id: null,
      token_label: null,
      window_start: '2026-11-19T00:00:00Z',
      window_end: '2026-11-19T12:00:00Z',
      bucket_seconds: 300,
      unit: 'sessions',
      routes_count: 5,
      rows_count: 720,
      source: { kind: 'access_log', query: null },
      quality: {
        buckets: 144,
        gaps: 0,
        partials: 2,
        resets: 0,
        routes: 5,
        rows: 720,
        session_profile: null,
        total_count: 3_100,
        unusable: 3,
      },
    }),
  ]);

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly seed?: (fake: Fake) => void;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [trafficListSnapshots],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerTrafficRoutes(fake);
      seedSklep(fake.store, { stage: 'project' });
      (options.seed ?? TWO)(fake);
    },
    clock: createTestClock(Date.parse('2026-11-27T12:00:00Z')),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: BOUND,
  });
}

const trafficCalls = (r: ToolRig) => r.fake.calls.filter((call) => call.path.startsWith(BASE));

interface LogRead {
  readonly tool: string;
  readonly result: string;
}
const reads = (r: ToolRig): LogRead[] => {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as { process: Record<string, { reads: LogRead[] }> };
  return Object.values(state.process).flatMap((process) => process.reads);
};

const VIEW = [
  'Traffic snapshots (2, newest first):',
  '1. 2026-11-26 00:00 – 2026-11-27 00:00 UTC, pushed by nightly-sender: requests per 1 h, 2 routes, 48 rows, 12,400 in total',
  `   id ${FIRST}; quality: 24 buckets, 1 gap, 0 unusable`,
  '2. 2026-11-19 00:00–12:00 UTC, uploaded as a file: sessions per 5 min, 5 routes, 720 rows, 3,100 in total',
  `   id ${SECOND}; quality: 144 buckets, 0 gaps, 2 partial, 3 unusable`,
  'limits: up to 14 snapshots kept per sender, a window up to 31 days',
];

describe('traffic_list_snapshots', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(trafficListSnapshots);
    expect(trafficListSnapshots.implemented).toBe(true);
  });

  it('lists the snapshots newest first with what they cover and their quality, in one request', async () => {
    const r = await rig();
    const result = await r.call('traffic_list_snapshots', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(VIEW.join('\n'));
    expect(trafficCalls(r).map((call) => call.path)).toEqual([`${BASE}/snapshots`]);
    expect(reads(r).at(-1)).toMatchObject({
      tool: 'traffic_list_snapshots',
      result: '2 snapshots',
    });
  });

  it('gives the data, without the source query, the entry route and the checksum', async () => {
    const r = await rig();
    const result = await r.call('traffic_list_snapshots', { format: 'data' });
    const data = JSON.parse(result.text) as {
      count: number;
      shown: number;
      snapshots: Record<string, unknown>[];
      format_state: string;
      format_sample: unknown;
    };
    expect(data).toMatchObject({ count: 2, shown: 2, format_state: 'none', format_sample: null });
    expect(data.snapshots[0]).toEqual({
      id: FIRST,
      created_at: '2026-11-27T01:00:00Z',
      channel: 'push',
      token_label: 'nightly-sender',
      window_start: '2026-11-26T00:00:00Z',
      window_end: '2026-11-27T00:00:00Z',
      bucket_seconds: 3600,
      unit: 'requests',
      timezone: 'Europe/Warsaw',
      routes: 2,
      rows: 48,
      total_count: 12400,
      source_kind: 'prometheus',
      quality: {
        buckets: 24,
        gaps: 1,
        partials: 0,
        resets: 0,
        unusable: 0,
        session_profile: false,
      },
    });
    expect(result.text).not.toContain('http_requests_total');
    expect(result.text).not.toContain('a'.repeat(64));
  });

  it('says it in Polish', async () => {
    const r = await rig({ locale: 'pl' });
    const text = (await r.call('traffic_list_snapshots', {})).text;
    expect(text.split('\n')).toEqual([
      'Migawki ruchu (2, od najnowszej):',
      '1. 2026-11-26 00:00 – 2026-11-27 00:00 UTC, wysłana przez nightly-sender: żądania co 1 h, tras 2, wierszy 48, łącznie 12\u202f400',
      `   id ${FIRST}; jakość: kubełków 24, luk 1, nieużytecznych 0`,
      '2. 2026-11-19 00:00–12:00 UTC, wgrana z pliku: sesje co 5 min, tras 5, wierszy 720, łącznie 3\u202f100',
      `   id ${SECOND}; jakość: kubełków 144, luk 0, częściowych 2, nieużytecznych 3`,
      'limity: do 14 migawek na nadawcę, okno do 31 dni',
    ]);
  });

  it('with no snapshot says how a sender pushes one', async () => {
    const r = await rig({ seed: () => undefined });
    const result = await r.call('traffic_list_snapshots', {});
    expect(result.text).toBe(
      'No traffic snapshots yet; traffic_get_push_setup shows how a sender pushes one.',
    );
    expect(reads(r).at(-1)?.result).toBe('0 snapshots');
  });

  it('keeps the first limit snapshots and says how many there are', async () => {
    const r = await rig();
    const result = await r.call('traffic_list_snapshots', { limit: 1 });
    expect(result.text.split('\n')).toHaveLength(5);
    expect(result.text).toContain('showing the first 1 of 2');
    expect(reads(r).at(-1)?.result).toBe('2 snapshots');
  });

  it('names a session profile in the quality line', async () => {
    const r = await rig({
      seed: (fake) =>
        seedTrafficSnapshots(fake.store, PROJECT, [
          sampleSnapshot({
            quality: {
              ...sampleSnapshot().quality,
              session_profile: {
                bounces: null,
                cut_by_exclusion: 0,
                excluded_route_templates: 0,
                navigation_signal: 'sec_fetch',
                negative_gap: 0,
                next_cells: 4,
                poll_route_templates: 0,
                route_keys: 2,
                route_template_missing: 0,
                route_template_source: 'sender',
                session_length_sessions: null,
                suppressed_next_cells: 0,
                suppressed_transition_cells: 0,
                transition_cells: 3,
              },
            },
          }),
        ]),
    });
    const text = (await r.call('traffic_list_snapshots', {})).text;
    expect(text).toContain('0 unusable, with a session profile');
  });

  it('with format_sample adds the field names and types and the CSV columns, never a value', async () => {
    const r = await rig();
    const result = await r.call('traffic_list_snapshots', { include: ['format_sample'] });
    expect(result.isError, result.text).toBe(false);
    expect(
      trafficCalls(r)
        .map((call) => call.path)
        .sort(),
    ).toEqual([`${BASE}/samples`, `${BASE}/snapshots`]);
    const lines = result.text.split('\n');
    expect(lines.slice(-3)).toEqual([
      'packet format (TrafficPacketV1):',
      '  fields: version (number), window.start (string), window.end (string), bucket_seconds (number), unit (string), rows[].bucket_start (string), rows[].route (string), rows[].count (number)',
      '  CSV columns: bucket_start, route, count',
    ]);
    expect(result.text).not.toContain('GET /,300');
    expect(result.text).not.toContain('2026-11-26T00:00:00Z');
  });

  it('a failing sample leaves the list and says the format is unavailable', async () => {
    const r = await rig();
    r.fake.faults.next('GET', `${BASE}/samples`, { status: 500, body: { detail: 'boom' } });
    const result = await r.call('traffic_list_snapshots', { include: ['format_sample'] });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('1. 2026-11-26');
    expect(result.text).toContain('packet format: unavailable');
  });

  it('a project the backend does not know is not_found', async () => {
    const r = await rig();
    r.fake.faults.next('GET', `${BASE}/snapshots`, {
      status: 404,
      body: { detail: 'Project not found' },
    });
    expect((await r.call('traffic_list_snapshots', {})).text).toMatch(/^\[not_found\] /u);
  });

  it('masks a secret in a label, a timezone and a source kind, and reads no query', async () => {
    const r = await rig({
      seed: (fake) =>
        seedTrafficSnapshots(fake.store, PROJECT, [
          sampleSnapshot({
            token_label: `token=${HEADER_CANARY}`,
            timezone: `password=${BACKEND_CANARY}`,
            source: {
              kind: `Bearer ${SHAPE_CANARY}`,
              query: `rate(x{api_key="${HEADER_CANARY}"}[1h])`,
            },
          }),
        ]),
    });
    for (const format of ['text', 'data'] as const) {
      const result = await r.call('traffic_list_snapshots', { format });
      expect(result.isError, result.text).toBe(false);
      for (const canary of [BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY]) {
        expect(result.text).not.toContain(canary);
      }
    }
    r.assertClean();
  });

  it('refuses a limit out of range, an unknown include and an argument outside the catalog, with no request', async () => {
    const r = await rig();
    for (const args of [
      { limit: 0 },
      { limit: 101 },
      { include: ['series'] },
      { include: ['format_sample', 'format_sample'] },
      { project_id: PROJECT },
    ]) {
      expect((await r.call('traffic_list_snapshots', args)).isError, JSON.stringify(args)).toBe(
        true,
      );
    }
    expect(trafficCalls(r)).toEqual([]);
  });
});
