import { mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { flowsImportHar } from '../src/tools/flowsImportHar.js';
import { goldenText, SKLEP_IDS } from './golden/index.js';
import { FakeHttpError, type Fake } from './fake-backend/server.js';
import { registerHarRoutes, type HarRouteOptions } from './fake-backend/routes/har.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { createTestClock } from './helpers/clock.js';
import { CANARY, toolRig, type ToolRig } from './helpers/rig.js';

const START = Date.parse('2026-11-22T09:00:00Z');
const MINUTE = 60_000;
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};
/** A token that lives in the recording only; unlike the API token the scope does not mask it. */
const RECORDED_SECRET = 'TOKEN-IN-HAR-9c1d4e7b';
const UPLOAD_PATH = `/api/v1/projects/${SKLEP_IDS.project}/har/upload`;
const POSTS = (r: ToolRig): string[] =>
  r.fake.calls.filter((call) => call.method === 'POST').map((call) => call.path);

interface Entry {
  method?: string;
  url: string;
  status?: number;
  auth?: string;
  /** Response body; undefined means the exporter dropped it but kept the declared size. */
  body?: unknown;
}

function har(entries: readonly Entry[]): string {
  return JSON.stringify({
    log: {
      version: '1.2',
      entries: entries.map((entry) => ({
        request: {
          method: entry.method ?? 'GET',
          url: entry.url,
          headers: entry.auth === undefined ? [] : [{ name: 'Authorization', value: entry.auth }],
        },
        response: {
          status: entry.status ?? 200,
          content:
            entry.body === undefined
              ? { size: 120 }
              : { size: 120, text: JSON.stringify(entry.body) },
        },
      })),
    },
  });
}

const HOST = 'https://perf.example.com';

/** Login, a cart that is read back by id, a static asset and an analytics ping. */
function shop(host = HOST, token = RECORDED_SECRET): string {
  return har([
    { method: 'POST', url: `${host}/auth/login`, body: { token } },
    { url: `${host}/shop`, auth: `Bearer ${token}`, body: { items: [] } },
    { method: 'POST', url: `${host}/cart`, auth: `Bearer ${token}`, body: { cartId: 'cart-7731' } },
    { url: `${host}/cart/cart-7731/items`, auth: `Bearer ${token}`, body: { items: [] } },
    { url: `${host}/static/app.js` },
    { method: 'POST', url: `${host}/analytics/ping` },
  ]);
}

interface HarView {
  readonly reused: boolean;
  readonly sizeBytes: number;
  readonly entries: number;
  readonly filtered: number;
  readonly auth: { detected: string | null; endpoint?: { method: string; path: string } };
  readonly baseUrl: { host: string; environment: string | null };
  readonly paths: string[];
  readonly correlations: {
    accepted: number;
    uncertain: { variable: string; confidence: number }[];
    ambiguous: { variable: string }[];
  };
  readonly warnings: { kind: string; params?: Record<string, string | number> }[];
}

async function rig(
  options: {
    files?: Record<string, string>;
    locale?: 'en' | 'pl';
    har?: HarRouteOptions;
    now?: number;
  } = {},
): Promise<ToolRig> {
  return toolRig({
    tools: [flowsImportHar],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerHarRoutes(fake, options.har);
      seedSklep(fake.store, { stage: 'project' });
    },
    clock: createTestClock(options.now ?? START),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: { ...BOUND, ...options.files },
  });
}

async function send(
  r: ToolRig,
  args: Record<string, unknown> = { file: 'captures/shop.har' },
): Promise<{ text: string; data: HarView }> {
  const result = await r.call('flows_import_har', args);
  if (result.isError) throw new Error(`flows_import_har failed: ${result.text}`);
  const structured = result.outcome as { status: string; data: HarView };
  expect(structured.status).toBe('done');
  return { text: result.text, data: structured.data };
}

describe('flows_import_har', () => {
  it('uploads the recording, analyses it and reports counts, paths and correlations', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    const { data } = await send(r);
    expect(POSTS(r)).toEqual([UPLOAD_PATH, expect.stringMatching(/\/har\/[^/]+\/analyze$/u)]);
    expect(data.reused).toBe(false);
    expect(data.entries).toBe(6);
    // The static asset is dropped by the parser, the analytics ping is noise.
    expect(data.filtered).toBe(2);
    expect(data.auth).toEqual({
      detected: 'bearer_token',
      endpoint: { method: 'POST', path: '/auth/login' },
    });
    expect(data.baseUrl).toEqual({ host: 'perf.example.com', environment: 'perf' });
    expect(data.paths).toEqual(['auth', 'shop', 'cart']);
    expect(data.correlations.accepted).toBe(1);
    expect(data.correlations.uncertain).toEqual([{ variable: 'cartId', confidence: 0.6 }]);
    expect(data.warnings).toEqual([]);
  });

  it('reads the project from the call when the repository is not bound', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    const { data } = await send(r, { file: 'captures/shop.har', project: 'sklep' });
    expect(data.entries).toBe(6);
  });

  it('sends the same file again without a request: the remembered analysis answers', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    const first = await send(r);
    const posts = POSTS(r).length;
    const second = await send(r);
    expect(POSTS(r)).toHaveLength(posts);
    expect(second.data).toEqual({ ...first.data, reused: true });
  });

  it('remembers the recording by content, so a copy under another name is not sent twice', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    await send(r);
    writeFileSync(join(r.workspace, 'captures/copy.har'), shop());
    const posts = POSTS(r).length;
    const { data } = await send(r, { file: 'captures/copy.har' });
    expect(data.reused).toBe(true);
    expect(POSTS(r)).toHaveLength(posts);
  });

  it('sends a changed recording again', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    await send(r);
    writeFileSync(join(r.workspace, 'captures/shop.har'), shop(HOST, 'another-token-5521'));
    const { data } = await send(r);
    expect(data.reused).toBe(false);
    expect(POSTS(r)).toHaveLength(4);
  });

  it('reuses an entry younger than 110 minutes and sends again after that', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    await send(r);
    await r.clock.advance(109 * MINUTE);
    expect((await send(r)).data.reused).toBe(true);
    expect(POSTS(r)).toHaveLength(2);
    await r.clock.advance(2 * MINUTE);
    expect((await send(r)).data.reused).toBe(false);
    expect(POSTS(r)).toHaveLength(4);
  });

  it('keys the remembered answer by project, so another project never gets it', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    const { data } = await send(r);
    const state = JSON.parse(
      readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8'),
    ) as { harSessions: Record<string, unknown> };
    const [cacheKey] = Object.keys(state.harSessions);
    expect(cacheKey).toContain(SKLEP_IDS.project);
    expect(data.reused).toBe(false);
  });

  it('rejects a .json file before any request', async () => {
    const r = await rig({ files: { 'captures/shop.json': shop() } });
    const result = await r.call('flows_import_har', { file: 'captures/shop.json' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('.har');
    expect(POSTS(r)).toEqual([]);
  });

  it('refuses a file outside the workspace', async () => {
    const r = await rig();
    const result = await r.call('flows_import_har', { file: '../shop.har' });
    expect(result.isError).toBe(true);
    expect(POSTS(r)).toEqual([]);
  });

  it('warns that a recording without response bodies will not generate, and how to record again', async () => {
    const without = har([
      { method: 'POST', url: `${HOST}/auth/login` },
      { url: `${HOST}/shop`, auth: 'Bearer x' },
    ]);
    const r = await rig({ files: { 'captures/shop.har': without } });
    const { data, text } = await send(r);
    expect(data.warnings.map((warning) => warning.kind)).toEqual(['sanitized_export']);
    expect(text.replace(/\s+/gu, ' ')).toContain('Allow generating HAR with sensitive data');
  });

  it('warns from the coverage numbers when the backend sent no warning of its own', async () => {
    const fixed = {
      upload: {
        duration_ms: 0,
        total_entries: 2,
        filtered_entries: 2,
        excluded_count: 0,
        base_url: HOST,
        detected_auth_pattern: null,
        warnings: [],
        domain_stats: [],
      },
      analysis: {
        evidence_quality: 'weak_response',
        evidence_coverage: { response_body_ratio: 0, stripped_response_body_ratio: 0.5 },
        warnings: [],
      },
    };
    const r = await rig({ files: { 'captures/shop.har': shop() }, har: { fixed } });
    const { data } = await send(r);
    expect(data.warnings).toEqual([{ kind: 'sanitized_export' }]);
  });

  it('warns when the recorded address is not the default environment', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop('https://shop.other.example') } });
    const { data, text } = await send(r);
    expect(data.baseUrl).toEqual({ host: 'shop.other.example', environment: null });
    expect(data.warnings).toEqual([
      { kind: 'different_host', params: { host: 'shop.other.example', environment: 'perf' } },
    ]);
    expect(text).toContain('shop.other.example');
    expect(text).toContain('perf');
  });

  it('keeps the recorded secrets out of the result, the state file and the log', async () => {
    const r = await rig({
      files: { 'captures/shop.har': shop(HOST, CANARY) },
    });
    const { text } = await send(r);
    const state = readFileSync(join(r.workspace, 'loadcraft/.cache/state.json'), 'utf8');
    const everything = JSON.stringify(r.results) + state + r.lines.join('\n');
    expect(everything).not.toContain(CANARY);
    expect(text).not.toContain('Bearer');

    const second = await rig({ files: { 'captures/shop.har': shop() } });
    await send(second);
    const secondState = readFileSync(join(second.workspace, 'loadcraft/.cache/state.json'), 'utf8');
    const secondAll = JSON.stringify(second.results) + secondState + second.lines.join('\n');
    expect(secondAll).not.toContain(RECORDED_SECRET);
    second.assertClean();
  });

  it('names the proxy when the gateway fails after about a minute', async () => {
    const r = await rig({
      files: { 'captures/shop.har': shop() },
      har: {
        beforeAnalyze: async () => {
          await r.clock.advance(61_000);
          throw new FakeHttpError(504, { detail: 'Gateway Timeout' });
        },
      },
    });
    const result = await r.call('flows_import_har', { file: 'captures/shop.har' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('proxy');
    expect(result.text).toContain('→');
  });

  it('does not blame the proxy for a gateway error that came at once', async () => {
    const r = await rig({
      files: { 'captures/shop.har': shop() },
      har: {
        beforeAnalyze: () => {
          throw new FakeHttpError(504, { detail: 'Gateway Timeout' });
        },
      },
    });
    const result = await r.call('flows_import_har', { file: 'captures/shop.har' });
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('proxy');
    expect(result.text).toContain('timed out');
  });

  it('does not remember a recording whose analysis failed', async () => {
    let fail = true;
    const r = await rig({
      files: { 'captures/shop.har': shop() },
      har: {
        beforeAnalyze: () => {
          if (fail) throw new FakeHttpError(500, { detail: 'boom' });
          return Promise.resolve();
        },
      },
    });
    expect((await r.call('flows_import_har', { file: 'captures/shop.har' })).isError).toBe(true);
    fail = false;
    expect((await send(r)).data.reused).toBe(false);
  });

  it('reports elapsed time while it uploads and analyses', async () => {
    const r = await rig({
      files: { 'captures/shop.har': shop() },
      har: { beforeAnalyze: () => r.clock.advance(4_000) },
    });
    const result = await r.call('flows_import_har', { file: 'captures/shop.har' });
    expect(result.isError).toBe(false);
    const messages = result.progress.map((entry) => entry.message ?? '');
    expect(messages.some((message) => /^analysing… \d+ s$/u.test(message))).toBe(true);
    expect(messages.some((message) => /^uploading… 0 s$/u.test(message))).toBe(true);
  });

  it('turns 401 into the invalid-token error with its hint', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    r.fake.faults.next('POST', UPLOAD_PATH, { status: 401, body: { detail: 'Invalid token' } });
    const result = await r.call('flows_import_har', { file: 'captures/shop.har' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('LoadCraft did not accept the API token');
    expect(result.text).toContain('→ Create a new API token in LoadCraft');
  });

  it('refuses a backend without /meta as too old', async () => {
    const r = await rig({ files: { 'captures/shop.har': shop() } });
    r.fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const result = await r.call('flows_import_har', { file: 'captures/shop.har' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('older than the plugin supports');
  });

  it('lists at most ten paths and counts the rest', async () => {
    const entries: Entry[] = Array.from({ length: 13 }, (_, i) => ({
      url: `${HOST}/area${String(i)}/home`,
      body: { ok: true },
    }));
    const r = await rig({ files: { 'captures/shop.har': har(entries) } });
    const { data, text } = await send(r);
    expect(data.paths).toHaveLength(10);
    expect(text).toContain('13 action groups in the recording');
    expect(text).toContain('and 3 more');
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('shop recording (%s)', async (locale) => {
      const r = await rig({ files: { 'captures/shop.har': shop() }, locale });
      const { text } = await send(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/importHar.shop.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)('warnings (%s)', async (locale) => {
      const without = har([
        { method: 'POST', url: 'https://shop.other.example/auth/login' },
        { url: 'https://shop.other.example/shop', auth: 'Bearer x' },
      ]);
      const r = await rig({ files: { 'captures/shop.har': without }, locale });
      const { text } = await send(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/importHar.warnings.${locale}.txt`);
    });

    it('matches the pattern of run 4 (pl)', async () => {
      const fixed = {
        upload: {
          duration_ms: 0,
          total_entries: 412,
          filtered_entries: 120,
          excluded_count: 69,
          base_url: 'https://perf.example.com',
          detected_auth_pattern: 'bearer_token',
          warnings: [],
          domain_stats: [],
        },
        analysis: {
          action_groups: [
            {
              name: 'zakupy',
              entry_indices: [0, 1, 2],
              start_index: 0,
              end_index: 2,
              entries_summary: [
                { method: 'POST', path: '/auth/login?next=%2Fshop', status: 200 },
                { method: 'GET', path: '/cart', status: 200 },
                { method: 'POST', path: '/orders', status: 201 },
              ],
            },
            {
              name: 'przeglądanie',
              entry_indices: [3],
              start_index: 3,
              end_index: 3,
              entries_summary: [],
            },
            {
              name: 'konto',
              entry_indices: [4],
              start_index: 4,
              end_index: 4,
              entries_summary: [],
            },
          ],
          correlations: [
            ...['authToken', 'csrf', 'userId', 'orderId', 'sessionRef'].map((variable, i) => ({
              source_entry_index: i === 0 ? 0 : 2,
              target_entry_index: i + 1,
              source_json_path: `$.${variable}`,
              target_location: i === 0 ? 'header:Authorization' : 'path:2',
              suggested_session_var: variable,
              confidence: 0.95 - i * 0.01,
            })),
            {
              source_entry_index: 1,
              target_entry_index: 3,
              source_json_path: '$.cartId',
              target_location: 'path:2',
              suggested_session_var: 'cartId',
              confidence: 0.6,
            },
          ],
          evidence_quality: 'full',
          evidence_coverage: { response_body_ratio: 0.9, stripped_response_body_ratio: 0 },
          warnings: [],
        },
      };
      const r = await rig({ files: BOUND, har: { fixed }, locale: 'pl' });
      const path = join(r.workspace, 'captures/big.har');
      mkdirSync(join(r.workspace, 'captures'), { recursive: true });
      writeFileSync(path, '');
      truncateSync(path, 38 * 1024 * 1024);
      const { text } = await send(r, { file: 'captures/big.har' });
      expect(text).toBe(goldenText('run4', '03-flows_import_har').replace(/\n$/u, ''));
    });
  });
});
