// One compatibility check for every tool that talks to the backend (FIX-72): the HTTP client the
// tools share asks `GET /api/v1/meta` before its first request, a backend without it (or with an
// older API revision) is refused with the `backend_too_old` text the old tools gave, and nothing
// else is sent. A tool that refuses its arguments locally still sends nothing at all.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import { defineTool, type Tool } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { SKLEP_IDS } from './golden/index.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig, type ToolRig } from './helpers/rig.js';

const META = '/api/v1/meta';
const NO_META = { status: 404, body: { detail: 'Not Found' } };
const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: SKLEP_IDS.project, name: 'sklep' },
  }),
};

async function rigOf(tools: readonly Tool[], processServices = false): Promise<ToolRig> {
  return toolRig({
    tools,
    clock: createTestClock(0),
    env: { LOADCRAFT_LOCALE: 'en' },
    files: BOUND,
    processServices,
  });
}

const toolsNamed = (...names: string[]): Tool[] =>
  names.map((name) => {
    const tool = ALL_TOOLS.find((one) => one.name === name);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    return tool;
  });

/** Calls `name` against a backend that answers `meta` on `/meta`; the paths it asked, after the call. */
async function refusedBy(
  r: ToolRig,
  name: string,
  args: Record<string, unknown>,
  meta: { status: number; body: unknown } = NO_META,
): Promise<{ text: string; paths: string[] }> {
  const before = r.fake.calls.length;
  r.fake.faults.next('GET', META, meta);
  const result = await r.call(name, args);
  return { text: result.text, paths: r.fake.calls.slice(before).map((call) => call.path) };
}

const RUN = '0d0c7034-0003-4000-8000-000000000001';
const OTHER_RUN = '0d0c7034-0003-4000-8000-000000000002';

/** Module tools of several modules with arguments that pass their schema and reach the backend. */
const MODULE_CALLS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['project_get_envs', {}],
  ['project_list_team', {}],
  ['flows_list', {}],
  ['scenario_list', {}],
  ['results_get_logs', { run_id: RUN }],
  ['results_compare_runs', { run_id: RUN, compare_to: OTHER_RUN }],
];

describe('compatibility check before a backend tool runs', () => {
  it('refuses module tools of several modules with the text of the old tools, sending nothing else', async () => {
    const r = await rigOf(toolsNamed('flows_get', ...MODULE_CALLS.map(([name]) => name)));
    // the reference: flows_get (a module tool since M-FLOWS-01) gives the text of `tooOld`, as the old tools did
    const old = await refusedBy(r, 'flows_get', { flow_id: 'checkout' });
    expect(old.text).toMatch(/^\[backend_too_old\] /u);

    for (const [name, args] of MODULE_CALLS) {
      const { text, paths } = await refusedBy(r, name, args);
      expect({ name, text, paths }).toEqual({ name, text: old.text, paths: [META] });
    }
  });

  it('refuses a backend below the minimum API revision the same way', async () => {
    const r = await rigOf(toolsNamed('flows_get', 'project_get_envs'));
    const meta = { status: 200, body: { version: '0.0.1', api_revision: 0, capabilities: [] } };
    const old = await refusedBy(r, 'flows_get', { flow_id: 'checkout' }, meta);
    const fresh = await refusedBy(r, 'project_get_envs', {}, meta);

    expect(fresh.text).toMatch(/^\[backend_too_old\] /u);
    expect(fresh.text).toBe(old.text);
    expect(fresh.paths).toEqual([META]);
  });

  it('the clients the tools get check before any request: any route, nothing else sent', async () => {
    const r = await rigOf([]);
    const services = createServices(r.config, createLogger({ level: 'error' }));
    r.fake.faults.next('GET', META, NO_META);
    const before = r.fake.calls.length;

    const error = await services.http.GET('/api/v1/projects').then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('backend_too_old');
    expect(r.fake.calls.slice(before).map((call) => call.path)).toEqual([META]);
  });
});

/**
 * The ways out of the plugin besides the checked HTTP client, each with why it needs no check of
 * its own. Anything else that opens a connection is a tool that skips the check.
 */
const OTHER_CONNECTIONS: Readonly<Record<string, string>> = {
  'src/http/client.ts': 'the checked client itself: its `fetch` runs after the check',
  'src/ws/channel.ts':
    'a WebSocket channel follows work an HTTP request of the same call started, so that request ' +
    'already checked the backend',
};

/** Places that build the shared client; each must turn the check on. */
const CLIENT_BUILDERS = ['src/server.ts'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'generated' ? [] : sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('guard: every backend call goes through the checked client', () => {
  const root = join(import.meta.dirname, '..');
  const files = sources(join(root, 'src')).map((path) => ({
    name: relative(root, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('only the listed files open a connection of their own', () => {
    const opening = files
      .filter(({ text }) => /\bfetch\(|new WebSocket\(|node:https?'|from 'undici'/u.test(text))
      .map(({ name }) => name)
      .sort();
    expect(opening).toEqual(Object.keys(OTHER_CONNECTIONS).sort());
  });

  it('every place that builds the shared HTTP client turns the check on', () => {
    const building = files
      .filter(({ name, text }) => name !== 'src/http/client.ts' && /\bcreateHttp\(/u.test(text))
      .map(({ name }) => name);
    expect(building).toEqual(CLIENT_BUILDERS);
    for (const name of building) {
      const text = files.find((file) => file.name === name)?.text ?? '';
      expect(text).toMatch(/createHttp\([^)]*checkCompat: true/su);
    }
  });
});

describe('one answer per server (the lost connection: http.client.test.ts)', () => {
  const probe = (name: string): Tool =>
    defineTool({
      name,
      title: name,
      description: name,
      input: z.strictObject({}),
      annotations: { readOnlyHint: true },
      run: async (ctx) => {
        await ctx.services.http.GET('/api/v1/projects');
        return { status: 'done' as const, data: {} };
      },
      render: () => 'ok',
    });

  const metaCalls = (r: ToolRig): number =>
    r.fake.calls.filter((call) => call.path === META).length;

  it('asks /meta once for many requests of the process', async () => {
    const r = await rigOf([probe('probe_one')], true);
    await r.call('probe_one', {});
    await r.call('probe_one', {});
    expect(metaCalls(r)).toBe(1);
  });

  it('a refusal is not remembered: the next call asks again', async () => {
    const r = await rigOf([probe('probe_one')], true);
    r.fake.faults.next('GET', META, NO_META);
    const refused = await r.call('probe_one', {});
    expect(refused.text).toMatch(/^\[backend_too_old\] /u);

    const next = await r.call('probe_one', {});
    expect(next.text).not.toMatch(/^\[backend_too_old\] /u);
    expect(metaCalls(r)).toBe(2);
  });

  it('a tool that refuses its arguments locally sends nothing, not even /meta', async () => {
    const local = defineTool({
      name: 'probe_local',
      title: 'probe_local',
      description: 'probe_local',
      input: z.strictObject({}),
      annotations: { readOnlyHint: true },
      run: () => Promise.reject(new ToolError('bad_input', { message: 'no' })),
      render: () => 'ok',
    });
    const r = await rigOf([local]);
    const before = r.fake.calls.length;
    await r.call('probe_local', {});
    expect(r.fake.calls.length).toBe(before);
  });
});
