// `project_check_env`: the connection test of the environments of the bound project from
// LoadCraft's servers, every environment or the one named; a private address (`blocked`) or a host
// that does not answer is a result, not an error.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectCheckEnv } from '../src/tools/projectCheckEnv.js';
import { projectCreate } from '../src/tools/projectCreate.js';
import { projectSaveEnv } from '../src/tools/projectSaveEnv.js';
import {
  registerApiMapRoute,
  registerConformanceRoute,
} from './fake-backend/routes/documentation.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerProjectRoutes } from './fake-backend/routes/projects.js';
import { registerSetupRoutes } from './fake-backend/routes/setup.js';
import { registerOpenapiReadRoute } from './fake-backend/routes/suggestions.js';
import type { Fake, FakeCall } from './fake-backend/server.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { settleClock } from './helpers/clock.js';
import { toolRig, type RigCallResult, type ToolRig } from './helpers/rig.js';

interface Probe {
  readonly status: string;
  readonly ms?: number;
}

interface CheckedView {
  readonly name: string;
  readonly default: boolean;
  readonly protected: boolean;
  readonly api: Probe;
  readonly frontend?: Probe;
}

interface Environment {
  readonly name: string;
  readonly api: string;
  readonly frontend?: string;
  readonly default?: boolean;
  readonly limit?: readonly number[];
}

const SKLEP_ENVIRONMENTS: readonly Environment[] = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

/** A local and a private environment: LoadCraft refuses both addresses. */
const PRIVATE: readonly Environment[] = [
  { name: 'local', api: 'http://localhost:8080', default: true },
  { name: 'vpn', api: 'http://10.1.2.3', frontend: 'https://shop.invalid' },
];

function worldAt(stage: 'empty' | 'project') {
  return (fake: Fake): void => {
    registerLookupRoutes(fake);
    registerProjectRoutes(fake);
    registerSetupRoutes(fake);
    registerOpenapiReadRoute(fake);
    registerApiMapRoute(fake);
    registerConformanceRoute(fake);
    seedSklep(fake.store, { stage });
  };
}

function world(fake: Fake): void {
  registerLookupRoutes(fake);
  registerProjectRoutes(fake);
  registerSetupRoutes(fake);
  registerOpenapiReadRoute(fake);
  registerApiMapRoute(fake);
  registerConformanceRoute(fake);
  seedSklep(fake.store, { stage: 'empty' });
}

const rig = (locale: 'en' | 'pl' = 'en'): Promise<ToolRig> =>
  toolRig({
    tools: [projectCreate, projectSaveEnv, projectCheckEnv],
    world,
    env: { LOADCRAFT_LOCALE: locale },
  });

const settle = (r: ToolRig, call: Promise<RigCallResult>): Promise<RigCallResult> =>
  settleClock(r, call, { limitMs: 120_000 });

/** The project with its environments, as `project_create` and `project_save_env` leave it. */
async function withEnvironments(r: ToolRig, environments: readonly Environment[]): Promise<string> {
  const first = environments.find((item) => item.default === true) ?? environments[0];
  if (first === undefined) throw new Error('no environment');
  const created = await settle(
    r,
    r.call('project_create', {
      name: 'sklep',
      environment: {
        name: first.name,
        api: first.api,
        ...(first.frontend === undefined ? {} : { frontend: first.frontend }),
      },
    }),
  );
  if (created.isError) throw new Error(`project_create failed: ${created.text}`);
  const saved = await settle(r, r.call('project_save_env', { environments }));
  if (saved.isError) throw new Error(`project_save_env failed: ${saved.text}`);
  return (created.outcome as { data: { project: { id: string } } }).data.project.id;
}

async function check(
  r: ToolRig,
  args: Record<string, unknown> = {},
): Promise<{ text: string; environments: readonly CheckedView[] }> {
  const result = await settle(r, r.call('project_check_env', args));
  if (result.isError) throw new Error(`project_check_env failed: ${result.text}`);
  const { data } = result.outcome as { data: { environments: readonly CheckedView[] } };
  return { text: result.text, environments: data.environments };
}

const probes = (calls: readonly FakeCall[]): FakeCall[] =>
  calls.filter((call) => call.path.endsWith('/test-connection'));

const env = (environments: readonly CheckedView[], name: string): CheckedView => {
  const found = environments.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no environment ${name} in the result`);
  return found;
};

function envChecked(r: ToolRig, projectId: string): unknown {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as {
    process: Record<string, { steps: Record<string, { checks: Record<string, unknown> }> }>;
  };
  return state.process[projectId]?.steps['project']?.checks['env_checked'];
}

describe('project_check_env', () => {
  it('probes every environment of the project once, in the order LoadCraft lists them', async () => {
    const r = await rig();
    await withEnvironments(r, SKLEP_ENVIRONMENTS);
    const before = r.fake.calls.length;
    const { environments, text } = await check(r);

    expect(probes(r.fake.calls.slice(before))).toHaveLength(4);
    expect(r.fake.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual(
      probes(r.fake.calls.slice(before)),
    );
    expect(environments.map((item) => [item.name, item.default, item.protected])).toEqual([
      ['perf', true, false],
      ['qa', false, true],
      ['dev', false, false],
      ['prod', false, true],
    ]);
    expect(env(environments, 'perf').api).toEqual({ status: 'ok', ms: 42 });
    expect(env(environments, 'perf').frontend).toEqual({ status: 'ok', ms: 58 });
    expect(text).toContain('connection ok: perf, qa, dev, prod (API and frontend)');
  });

  it('called again probes again and writes nothing', async () => {
    const r = await rig();
    await withEnvironments(r, SKLEP_ENVIRONMENTS);
    await check(r);
    const before = r.fake.calls.length;
    await check(r);
    const again = r.fake.calls.slice(before);
    expect(probes(again)).toHaveLength(4);
    expect(again.filter((call) => call.method !== 'GET')).toEqual(probes(again));
  });

  it('reports a private address as blocked, not as an error', async () => {
    const r = await rig();
    await withEnvironments(r, PRIVATE);
    const { environments, text } = await check(r);
    expect(env(environments, 'local').api).toEqual({ status: 'blocked' });
    expect(env(environments, 'local').frontend).toBeUndefined();
    expect(env(environments, 'vpn').api).toEqual({ status: 'blocked' });
    expect(env(environments, 'vpn').frontend).toEqual({ status: 'unreachable' });
    // an existing environment keeps its address: the hint sends the user to its settings
    expect(text.replace(/\s+/gu, ' ')).toMatch(
      /environment settings in LoadCraft \(project_save_env [^)]*never changes the address[^)]*\) and call project_check_env again/u,
    );
  });

  it('probes only the environment named', async () => {
    const r = await rig();
    await withEnvironments(r, SKLEP_ENVIRONMENTS);
    const before = r.fake.calls.length;
    const { environments } = await check(r, { environment: 'qa' });
    expect(environments.map((item) => item.name)).toEqual(['qa']);
    expect(probes(r.fake.calls.slice(before))).toHaveLength(1);
  });

  it('refuses an environment the project does not have, and probes nothing', async () => {
    const r = await rig();
    await withEnvironments(r, SKLEP_ENVIRONMENTS);
    const before = r.fake.calls.length;
    const result = await settle(r, r.call('project_check_env', { environment: 'stage' }));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('stage');
    expect(result.text).toContain('perf');
    expect(probes(r.fake.calls.slice(before))).toEqual([]);
  });

  it('without a bound project is the no-project error, and probes nothing', async () => {
    const r = await rig();
    const result = await settle(r, r.call('project_check_env', {}));
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no_project');
    expect(probes(r.fake.calls)).toEqual([]);
  });

  it('writes env_checked into the process: true when every API answers, false otherwise', async () => {
    const ok = await rig();
    const answering = await withEnvironments(ok, SKLEP_ENVIRONMENTS);
    await check(ok);
    expect(envChecked(ok, answering)).toMatchObject({ ok: true, by: 'project_check_env' });

    const blocked = await rig();
    const refused = await withEnvironments(blocked, PRIVATE);
    await check(blocked);
    expect(envChecked(blocked, refused)).toMatchObject({ ok: false, by: 'project_check_env' });
  });

  it('a probe where every GET answered 400 leaves env_checked undecided and shows the statuses', async () => {
    const r = await toolRig({
      tools: [projectCreate, projectSaveEnv, projectCheckEnv],
      world: worldAt('project'),
      env: { LOADCRAFT_LOCALE: 'en' },
    });
    const project = await withEnvironments(r, SKLEP_ENVIRONMENTS);
    const bad = (method: string, index: number, status: number | null, reason: string) => ({
      classification: 'inconclusive',
      method,
      path: `/items/${String(index)}`,
      http_status: status,
      reason,
    });
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
      {
        status: 200,
        body: {
          base_url: 'https://api.perf.example.com',
          checked_at: '2026-11-22T10:00:00Z',
          inconclusive: [
            ...Array.from({ length: 10 }, (_, i) => bad('GET', i, 400, 'status_400')),
            ...Array.from({ length: 7 }, (_, i) => bad('POST', i, null, 'method_not_probed')),
          ],
          sampled: { probed: 10, not_probed_methods: 7, skipped_param_paths: 14 },
          status: 'complete',
          totals: { exists: 0, inconclusive: 17, missing: 0 },
        },
      },
    );
    const { text } = await check(r);
    expect(text).toContain('inconclusive 10');
    expect(text).toContain('21 unchecked');
    expect(text).toContain('400 ×10');
    expect(envChecked(r, project)).toMatchObject({ ok: null, by: 'project_check_env' });
  });

  it('names the headers the probe sent, counts paths on another host as unchecked and tunes the hint', async () => {
    // a header value the plugin knows nothing about: no secret scope would mask it
    const LEAKED = 'pk-live-4f1c9e';
    const report = (headers: readonly string[]) => ({
      base_url: 'https://api.perf.example.com',
      checked_at: '2026-11-22T10:00:00Z',
      inconclusive: [
        ...Array.from({ length: 10 }, (_, i) => ({
          classification: 'inconclusive',
          method: 'GET',
          path: `/items/${String(i)}`,
          http_status: 400,
          reason: 'status_400',
        })),
        ...Array.from({ length: 7 }, (_, i) => ({
          classification: 'inconclusive',
          method: 'POST',
          path: `/items/${String(i)}`,
          http_status: null,
          reason: 'method_not_probed',
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          classification: 'inconclusive',
          method: 'GET',
          path: `https://cdn.example.com/a/${String(i)}`,
          http_status: null,
          reason: 'off_host',
        })),
      ],
      sampled: {
        probed: 10,
        not_probed_methods: 7,
        not_probed_off_host: 3,
        skipped_param_paths: 14,
      },
      headers_sent: [...headers],
      status: 'complete',
      totals: { exists: 0, inconclusive: 20, missing: 0 },
    });
    const probe = async (headers: readonly string[]): Promise<string> => {
      const r = await toolRig({
        tools: [projectCreate, projectSaveEnv, projectCheckEnv],
        world: worldAt('project'),
        env: { LOADCRAFT_LOCALE: 'en' },
      });
      await withEnvironments(r, SKLEP_ENVIRONMENTS);
      // the default environment has two fixed headers (the backend shows a secret value masked)
      const environments = r.fake.store.collection<{
        id: string;
        name: string;
        default_headers?: Record<string, unknown>;
      }>('environments');
      const perf = environments.list().find((item) => item.name === 'perf');
      if (perf === undefined) throw new Error('no environment perf');
      environments.update(perf.id, {
        default_headers: { 'x-api-key': '«masked»', Accept: 'application/json' },
      });
      r.fake.faults.next(
        'POST',
        '/api/v1/projects/{project_id}/environments/{environment_id}/conformance',
        { status: 200, body: report(headers) },
      );
      return (await check(r)).text.replace(/\s+/gu, ' ');
    };
    // a value in the list (a backend that got it wrong) is never shown: only known header names are
    const sent = await probe(['x-api-key', 'Accept', LEAKED]);
    expect(sent).not.toContain(LEAKED);
    expect(sent).not.toContain('[redacted]');
    expect(sent).toContain('inconclusive 10');
    expect(sent).toContain('24 unchecked (non-GET, path parameters, another host)');
    expect(sent).toContain('headers sent: x-api-key, Accept');
    expect(sent).toMatch(/although headers x-api-key, Accept were sent/u);
    const none = await probe([]);
    expect(none).not.toContain('headers sent:');
    expect(none).toMatch(/no fixed header was sent[^.]*project_save_env/u);
  });

  it('a test of one named environment leaves env_checked as it is', async () => {
    const r = await rig();
    const project = await withEnvironments(r, SKLEP_ENVIRONMENTS);
    await check(r);
    expect(envChecked(r, project)).toMatchObject({ ok: true, by: 'project_check_env' });
    // qa does not answer now; one probe of it says nothing about the whole project
    r.fake.faults.next(
      'POST',
      '/api/v1/projects/{project_id}/environments/{environment_id}/test-connection',
      {
        status: 200,
        body: {
          checked_at: '2026-11-22T10:00:00Z',
          protected: true,
          results: [
            { kind: 'base_url', target: 'https://api.qa.example.com', status: 'unreachable' },
          ],
        },
      },
    );
    const { environments } = await check(r, { environment: 'qa' });
    expect(env(environments, 'qa').api.status).toBe('unreachable');
    expect(envChecked(r, project)).toMatchObject({ ok: true, by: 'project_check_env' });
  });

  describe('views', () => {
    it.each(['en', 'pl'] as const)('every environment answers (%s)', async (locale) => {
      const r = await rig(locale);
      await withEnvironments(r, SKLEP_ENVIRONMENTS);
      const { text } = await check(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/projectCheckEnv.ok.${locale}.txt`);
    });

    it.each(['en', 'pl'] as const)('a private address (%s)', async (locale) => {
      const r = await rig(locale);
      await withEnvironments(r, [
        ...SKLEP_ENVIRONMENTS,
        { name: 'local', api: 'http://localhost:8080' },
      ]);
      const { text } = await check(r);
      await expect(text).toMatchFileSnapshot(`__snapshots__/projectCheckEnv.blocked.${locale}.txt`);
    });
  });
});
