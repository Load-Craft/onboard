// Demonstration mode (`LOADCRAFT_DEMO=1`): the server starts a backend of its own on the loopback
// interface, loaded from `dist/demo-backend.mjs` only when the mode is on, and runs on the world
// "sklep". The tests cover the switch (what turns the mode on and what refuses it), the notice in
// every result, the loading of the backend file, and run 1 over stdio against the built server.

import { execFile, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig, demoConflicts } from '../src/config.js';
import {
  DemoError,
  removeStaleStateFolders,
  startDemo,
  type DemoBackend,
} from '../src/demo/index.js';
import { ALL_TOOLS } from '../src/tools/index.js';
import { CANARY } from './helpers/canary.js';
import { toolRig } from './helpers/rig.js';
import { fixtureFiles } from './e2e/driver.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from './golden/index.js';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SERVER = join(DIST, 'server.mjs');
const DEMO_BACKEND = join(DIST, 'demo-backend.mjs');
const NET_GUARD = join(ROOT, 'scripts', 'net-guard.mjs');

const NOTICE_PL = 'tryb demonstracyjny — dane przykładowe';
const NOTICE_EN = 'demo mode — sample data';

const temporary: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lc-demo-test-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function lastLine(text: string): string {
  return text.trimEnd().split('\n').at(-1) ?? '';
}

// ---- what turns the mode on, what refuses it ------------------------------------------------

describe('the switch', () => {
  it('is exactly LOADCRAFT_DEMO=1, with the clock at x30 unless LOADCRAFT_DEMO_SPEED says otherwise', () => {
    expect(loadConfig({ LOADCRAFT_DEMO: '1' }, '/w')).toMatchObject({ demo: true, demoSpeed: 30 });
    // A boolean plugin option reaches the server as `true`; nothing else counts, and nothing is trimmed.
    expect(loadConfig({ LOADCRAFT_DEMO: 'true' }, '/w').demo).toBe(true);
    for (const off of [
      ' 1 ',
      '1 ',
      'True',
      'TRUE',
      'yes',
      '0',
      'false',
      '',
      '${user_config.demo}',
    ]) {
      expect(loadConfig({ LOADCRAFT_DEMO: off }, '/w').demo, JSON.stringify(off)).toBe(false);
    }
    expect(loadConfig({ LOADCRAFT_DEMO: '1', LOADCRAFT_DEMO_SPEED: '120' }, '/w').demoSpeed).toBe(
      120,
    );
    for (const bad of ['0', '-3', 'fast', '1e9']) {
      const config = loadConfig({ LOADCRAFT_DEMO: '1', LOADCRAFT_DEMO_SPEED: bad }, '/w');
      expect(config.demoSpeed, bad).toBe(30);
      expect(config.problems.join('\n'), bad).toContain('LOADCRAFT_DEMO_SPEED');
    }
  });

  it('keeps the state next to the project unless the mode moves it', () => {
    const config = loadConfig({ LOADCRAFT_WORKSPACE: '/srv/app' }, '/w');
    expect(config.stateRoot).toBe('/srv/app');
  });

  it('turns a refusal of the mode into a configuration problem, with the mode off and no token problem', () => {
    const config = loadConfig(
      {
        LOADCRAFT_DEMO: '1',
        LOADCRAFT_URL: 'https://app.example.com',
        LOADCRAFT_API_TOKEN: CANARY,
      },
      '/w',
    );
    expect(config.demo).toBe(false);
    expect(config.problems).toHaveLength(1);
    const [problem = ''] = config.problems;
    expect(problem).toContain('LOADCRAFT_URL');
    expect(problem).toMatch(/\/plugin[^\n]*turn off the demo option[^\n]*loadcraft_url/u);
    expect(problem).not.toContain(CANARY);
    expect(loadConfig({ LOADCRAFT_DEMO: '1' }, '/w').demo).toBe(true);
  });

  it('refuses an address of a real backend, but ignores a token and unexpanded options', () => {
    expect(demoConflicts({ LOADCRAFT_DEMO: '1' })).toEqual([]);
    expect(
      demoConflicts({
        LOADCRAFT_DEMO: '1',
        LOADCRAFT_URL: '${user_config.loadcraft_url}',
        LOADCRAFT_API_URL: '',
        LOADCRAFT_API_TOKEN: CANARY,
      }),
    ).toEqual([]);
    // The plugin always passes its default address; that is what "not set" looks like from there.
    for (const url of ['https://app.loadcraft.io', 'https://app.loadcraft.io/']) {
      expect(demoConflicts({ LOADCRAFT_DEMO: '1', LOADCRAFT_URL: url }), url).toEqual([]);
    }
    for (const url of [
      'https://app.loadcraft.io.example.com',
      'http://app.loadcraft.io',
      'https://app.example.com',
    ]) {
      expect(demoConflicts({ LOADCRAFT_DEMO: '1', LOADCRAFT_URL: url }), url).toEqual([
        'LOADCRAFT_URL',
      ]);
    }
    expect(
      demoConflicts({ LOADCRAFT_DEMO: '1', LOADCRAFT_API_URL: 'https://app.loadcraft.io' }),
    ).toEqual(['LOADCRAFT_API_URL']);
    expect(
      demoConflicts({
        LOADCRAFT_DEMO: '1',
        LOADCRAFT_URL: 'https://app.example.com',
        LOADCRAFT_API_URL: 'https://api.example.com/api/v1',
      }),
    ).toEqual(['LOADCRAFT_URL', 'LOADCRAFT_API_URL']);
  });
});

function fakeBackend(closed: string[] = []): DemoBackend {
  return {
    url: 'http://127.0.0.1:4321',
    token: 'demo-token-for-tests',
    close: () => {
      closed.push('backend');
      return Promise.resolve();
    },
  };
}

describe('startDemo', () => {
  const baseEnv = { LOADCRAFT_DEMO: '1' };

  it('points the client at the loopback backend with its token and keeps the state in a folder of its own', async () => {
    const closed: string[] = [];
    const started: unknown[] = [];
    const env = { ...baseEnv, LOADCRAFT_API_TOKEN: CANARY, LOADCRAFT_DEMO_SPEED: '60' };
    const config = loadConfig(env, '/w/project');
    const session = await startDemo(config, env, {
      load: () =>
        Promise.resolve({
          startDemoBackend: (options: unknown) => {
            started.push(options);
            return Promise.resolve(fakeBackend(closed));
          },
        }),
    });
    expect(started).toEqual([{ speed: 60 }]);
    expect(session.config).toMatchObject({
      demo: true,
      appUrl: 'http://127.0.0.1:4321',
      apiUrl: 'http://127.0.0.1:4321/api/v1',
      workspaceRoot: '/w/project',
    });
    // The user's own token never goes to the demonstration backend.
    expect(session.config.token.reveal()).toBe('demo-token-for-tests');
    expect(session.config.stateRoot).not.toBe('/w/project');
    expect(existsSync(session.config.stateRoot)).toBe(true);
    expect(readFileSync(join(session.config.stateRoot, 'owner.pid'), 'utf8').trim()).toBe(
      String(process.pid),
    );
    expect(session.config.stateRoot.startsWith(tmpdir())).toBe(true);

    await session.close();
    expect(closed).toEqual(['backend']);
    expect(existsSync(session.config.stateRoot)).toBe(false);
  });

  it('starts with the default address and a token of the user, as the plugin passes them, and sends neither on', async () => {
    const env = {
      LOADCRAFT_DEMO: 'true',
      LOADCRAFT_URL: 'https://app.loadcraft.io',
      LOADCRAFT_API_URL: '',
      LOADCRAFT_API_TOKEN: CANARY,
    };
    const session = await startDemo(loadConfig(env, '/w'), env, {
      load: () => Promise.resolve({ startDemoBackend: () => Promise.resolve(fakeBackend()) }),
    });
    try {
      expect(session.config.appUrl).toBe('http://127.0.0.1:4321');
      expect(session.config.apiUrl).toBe('http://127.0.0.1:4321/api/v1');
      expect(session.config.token.reveal()).not.toContain('CANARY');
    } finally {
      await session.close();
    }
  });

  it('removes state folders of killed sessions older than an hour, and only those', async () => {
    const dir = await scratch();
    const now = Date.now();
    const make = async (name: string, ageMs: number, owner?: number): Promise<string> => {
      const path = join(dir, name);
      mkdirSync(path);
      // Written before the age is set: adding a file changes the mtime of the folder.
      if (owner !== undefined) writeFileSync(join(path, 'owner.pid'), `${String(owner)}\n`);
      const when = new Date(now - ageMs);
      await utimes(path, when, when);
      return path;
    };
    const old = await make('loadcraft-demo-old', 2 * 3_600_000);
    const fresh = await make('loadcraft-demo-fresh', 5 * 60_000);
    const foreign = await make('something-else', 5 * 3_600_000);
    // An old folder of a session that still runs is kept, one of a process that is gone is removed.
    const living = await make('loadcraft-demo-living', 2 * 3_600_000, process.pid);
    const dead = spawnSync(process.execPath, ['-e', '']);
    const gone = await make('loadcraft-demo-gone', 2 * 3_600_000, dead.pid);
    await removeStaleStateFolders(dir, now);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(living)).toBe(true);
    expect(existsSync(gone)).toBe(false);
  });

  it('does not touch the backend file when an address of a real backend is set', async () => {
    const load = vi.fn(() => Promise.resolve({}));
    const env = { ...baseEnv, LOADCRAFT_API_URL: 'https://api.example.com/api/v1' };
    await expect(startDemo(loadConfig(env, '/w'), env, { load })).rejects.toThrow(DemoError);
    await expect(startDemo(loadConfig(env, '/w'), env, { load })).rejects.toThrow(
      /LOADCRAFT_API_URL/,
    );
    expect(load).not.toHaveBeenCalled();
  });

  it('says so when the backend file is missing or is not a demo backend', async () => {
    const config = loadConfig(baseEnv, '/w');
    const missing = Object.assign(new Error('Cannot find module'), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    await expect(
      startDemo(config, baseEnv, { load: () => Promise.reject(missing) }),
    ).rejects.toThrow(/demo-backend\.mjs/);
    await expect(startDemo(config, baseEnv, { load: () => Promise.resolve({}) })).rejects.toThrow(
      DemoError,
    );
  });
});

// ---- the notice -----------------------------------------------------------------------------

describe('the notice in demonstration mode', () => {
  async function rig(demo: boolean, locale: 'pl' | 'en', bound = true) {
    return toolRig({
      tools: ALL_TOOLS,
      world: (fake) => {
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerStatusRoutes(fake);
        seedSklep(fake.store, { stage: 'executed' });
      },
      files: bound
        ? {
            'loadcraft/project.json': JSON.stringify({
              schema: 1,
              url: 'https://app.loadcraft.io',
              project: { id: SKLEP_IDS.project, name: 'sklep' },
            }),
          }
        : {},
      env: { LOADCRAFT_LOCALE: locale, ...(demo ? { LOADCRAFT_DEMO: '1' } : {}) },
    });
  }

  it('ends every result, and process_get_status opens with it as well', async () => {
    const r = await rig(true, 'pl');
    const status = await r.call('process_get_status', {});
    expect(status.isError, status.text).toBe(false);
    expect(status.text.split('\n')[0]).toBe(NOTICE_PL);
    expect(lastLine(status.text)).toBe(NOTICE_PL);

    const flows = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(flows.isError, flows.text).toBe(false);
    expect(flows.text.split('\n')[0]).not.toBe(NOTICE_PL);
    expect(lastLine(flows.text)).toBe(NOTICE_PL);
  });

  it('ends an error result too, in the language of the user', async () => {
    const r = await rig(true, 'en', false);
    const result = await r.call('flows_get', { flow_id: 'zakupy' });
    expect(result.isError).toBe(true);
    expect(lastLine(result.text)).toBe(NOTICE_EN);
  });

  it('is absent when the mode is off', async () => {
    const r = await rig(false, 'pl');
    const status = await r.call('process_get_status', {});
    expect(status.text).not.toContain(NOTICE_PL);
    const missing = await (await rig(false, 'pl', false)).call('flows_get', { flow_id: 'zakupy' });
    expect(missing.text).not.toContain(NOTICE_PL);
  });
});

// ---- the built files ------------------------------------------------------------------------

describe('dist', () => {
  it('server.mjs holds none of the backend, demo-backend.mjs holds it', async () => {
    const server = await readFile(SERVER, 'utf8');
    for (const marker of ['startFake', 'seedSklep', 'registerAllRoutes', 'Sklep API']) {
      expect(server, marker).not.toContain(marker);
    }
    // Only the loader of the file is in the server.
    expect(server).toContain('demo-backend.mjs');
    const backend = await readFile(DEMO_BACKEND, 'utf8');
    for (const marker of ['startFake', 'seedSklep', 'startDemoBackend']) {
      expect(backend, marker).toContain(marker);
    }
    // The contract the backend checks its answers against travels inside the file.
    expect(backend).toContain('/api/v1/projects/{project_id}/gatling/executions');
  });

  it('the sample backend listens on the loopback interface and takes only its own token', async () => {
    const module = (await import(pathToFileURL(DEMO_BACKEND).href)) as {
      startDemoBackend(options: { speed: number }): Promise<{
        url: string;
        token: string;
        close(): Promise<void>;
      }>;
    };
    const backend = await module.startDemoBackend({ speed: 1 });
    try {
      expect(backend.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(backend.token).not.toBe(CANARY);
      const me = (token?: string) =>
        fetch(`${backend.url}/api/v1/auth/me`, {
          headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
        });
      expect((await me()).status).toBe(401);
      expect((await me(CANARY)).status).toBe(401);
      expect((await me(backend.token)).status).toBe(200);
    } finally {
      await backend.close();
    }
  });

  it('demo-backend.mjs is loaded only when the mode is on', async () => {
    const dir = await scratch();
    copyFileSync(SERVER, join(dir, 'server.mjs'));
    // Without the mode the server does not look for the file: it starts and lists its tools.
    const plain = new Client({ name: 'demo-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(dir, 'server.mjs')],
      env: { PATH: process.env.PATH ?? '' },
      stderr: 'ignore',
    });
    try {
      await plain.connect(transport);
      expect((await plain.listTools()).tools.length).toBeGreaterThan(10);
    } finally {
      await plain.close();
    }
  }, 30_000);
});

// ---- the mode on the built server, over stdio -----------------------------------------------

interface Session {
  readonly client: Client;
  readonly workspace: string;
  readonly netLog: string;
  readonly stderr: () => string;
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

/** The most one call to the built server may take: a guard against a hang, not part of any assertion. */
const HANG_GUARD_MS = 170_000;

async function openSession(env: Record<string, string>, files = fixtureFiles()): Promise<Session> {
  const workspace = await scratch();
  for (const [relative, content] of Object.entries(files)) {
    const path = join(workspace, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  const netLog = join(await scratch(), 'net.log');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', pathToFileURL(NET_GUARD).href, SERVER],
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? '',
      LC_NET_GUARD_LOG: netLog,
      LOADCRAFT_LOCALE: 'pl',
      // Fast: 600 s of test take three seconds.
      LOADCRAFT_DEMO_SPEED: '200',
      ...env,
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'demo-test', version: '1.0.0' });
  await client.connect(transport);
  return {
    client,
    workspace,
    netLog,
    stderr: () => stderr,
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args }, { timeout: HANG_GUARD_MS });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((block: { type?: string; text?: string }) =>
          block.type === 'text' ? (block.text ?? '') : '',
        )
        .join('\n');
      return { text, isError: result.isError === true };
    },
    close: () => client.close(),
  };
}

/** The handle of an unfinished operation, read from the text the way a model reads it. */
function waitHandle(text: string): string | undefined {
  return /wait z operation „([^”]+)”/u.exec(text)?.[1];
}

async function callToTheEnd(session: Session, name: string, args: Record<string, unknown>) {
  let result = await session.call(name, args);
  for (let again = 0; again < 60 && !result.isError; again += 1) {
    const handle = waitHandle(result.text);
    if (handle === undefined) break;
    result = await session.call('process_wait', { operation: handle });
  }
  return result;
}

const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

/** One call: its arguments, or how they come out of the text of the call before it. */
interface DemoStep {
  readonly tool: string;
  readonly args: Record<string, unknown> | ((before: string) => Record<string, unknown>);
  readonly contains?: string;
}

/** The handle of the project analysis, read from the text the way a model reads it. */
const analysisFrom = (text: string): Record<string, unknown> => {
  const handle = /setup_analysis:[0-9a-f-]{36}/u.exec(text)?.[0];
  return handle === undefined ? {} : { analysis: handle };
};

/** The setup of the project (step 01): five calls. */
const SETUP: readonly DemoStep[] = [
  {
    tool: 'project_create',
    args: {
      name: 'sklep',
      environment: { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com' },
    },
  },
  { tool: 'project_save_env', args: { environments: ENVIRONMENTS } },
  { tool: 'project_check_env', args: {} },
  { tool: 'project_analyze_setup', args: { openapi: 'loadcraft/openapi.json' } },
  { tool: 'project_apply_setup', args: analysisFrom },
];

/** The calls of run 1, as the run on the fake backend makes them. */
const RUN1: readonly DemoStep[] = [
  ...SETUP,
  {
    tool: 'project_connect_telemetry',
    args: { label: 'sklep-logs', url: 'https://logs-mcp.perf.example.com/mcp' },
  },
  { tool: 'flows_suggest_journeys', args: {} },
  {
    tool: 'flows_generate_from_suggestions',
    args: { suggestions: ['zakupy', 'przeglądanie', 'konto'] },
  },
  {
    tool: 'scenario_suggest_split',
    args: { name: 'checkout', flows: ['przeglądanie', 'zakupy', 'konto'] },
  },
  {
    tool: 'scenario_generate',
    args: {
      name: 'checkout',
      proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
      data_mix: 'realistic',
    },
  },
  { tool: 'data_check_readiness', args: { scenario: 'checkout' } },
  { tool: 'data_create_accounts', args: { scenario: 'checkout', slot: 'accounts', count: 2000 } },
  { tool: 'scenario_check_self', args: { scenarios: ['zakupy', 'konto'] } },
  {
    tool: 'run_plan',
    args: { scenario: 'checkout', environment: 'perf', target_users: 2000 },
  },
  {
    tool: 'run_start',
    args: {
      scenario: 'checkout',
      environment: 'perf',
      profile: { type: 'ramp_concurrency', vusers: 2000, ramp: 600 },
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
    },
    contains: 'test zakończony · wykonanie e-3f9a12c4',
  },
  { tool: 'results_get_report', args: { execution: 'e-3f9a12c4' }, contains: 'SLA FAILED' },
  { tool: 'results_analyze_run', args: { execution: 'e-3f9a12c4', force: true } },
];

/** Run 3: the journeys come from a description of them, recorded by an agent in a browser. */
const RUN3_HEAD = RUN1.slice(0, SETUP.length + 1);
const RUN3: readonly DemoStep[] = [
  ...RUN3_HEAD,
  {
    tool: 'flows_describe_journeys',
    args: {
      description:
        'Klient loguje się, szuka produktu, dodaje go do koszyka i płaci kartą. Część klientów przegląda katalog.',
      environment: 'perf',
      account: { from_env: '.env.perf' },
    },
    contains: `r-${SKLEP_IDS.recordRun.slice(0, 8)}`,
  },
  {
    tool: 'flows_record_journeys',
    args: { plan: `r-${SKLEP_IDS.recordRun.slice(0, 8)}`, paths: 'all' },
    contains: 'flowy zapisane',
  },
];

function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('the built server in demonstration mode', () => {
  it('goes through run 1 without an account, a token or the network', async () => {
    const session = await openSession({ LOADCRAFT_DEMO: '1', LOADCRAFT_API_TOKEN: CANARY });
    const seen: string[] = [];
    try {
      let before = '';
      for (const step of RUN1) {
        const args = typeof step.args === 'function' ? step.args(before) : step.args;
        const result = await callToTheEnd(session, step.tool, args);
        before = result.text;
        seen.push(result.text);
        expect(result.isError, `${step.tool}: ${result.text}`).toBe(false);
        expect(lastLine(result.text), step.tool).toBe(NOTICE_PL);
        if (step.contains !== undefined) expect(result.text, step.tool).toContain(step.contains);
      }
      const status = await session.call('process_get_status', {});
      expect(status.text.split('\n')[0]).toBe(NOTICE_PL);
      expect(status.text).toContain('Projekt „sklep”');
      expect(status.text).toContain('3 flowy · 3 scenariusze · 1 kompozycja');
      seen.push(status.text);
    } finally {
      await session.close();
    }

    // Nothing was written next to the project: the binding and the cache live in a folder of the mode.
    expect(existsSync(join(session.workspace, 'loadcraft', 'project.json'))).toBe(false);
    expect(existsSync(join(session.workspace, 'loadcraft', '.cache'))).toBe(false);
    expect(
      filesBelow(session.workspace)
        .map((file) => file.slice(session.workspace.length + 1))
        .sort(),
    ).toEqual(['.env.perf', '.env.qa', 'loadcraft/openapi.json']);

    // The token of the user is in no result and no log line.
    expect(seen.join('\n')).not.toContain(CANARY);
    expect(session.stderr()).not.toContain(CANARY);
    expect(session.stderr()).toContain('demo');

    // Only the loopback interface was used, and it was used.
    const connections = readFileSync(session.netLog, 'utf8').split('\n').filter(Boolean);
    expect(connections.filter((line) => !line.startsWith('ok 127.0.0.1:'))).toEqual([]);
    expect(connections.length).toBeGreaterThan(5);
  }, 180_000);

  it('goes through run 3 (flows_describe_journeys, flows_record_journeys) the same way', async () => {
    const session = await openSession({ LOADCRAFT_DEMO: '1' });
    try {
      let before = '';
      for (const step of RUN3) {
        const args = typeof step.args === 'function' ? step.args(before) : step.args;
        const result = await callToTheEnd(session, step.tool, args);
        before = result.text;
        expect(result.isError, `${step.tool}: ${result.text}\n${session.stderr()}`).toBe(false);
        expect(lastLine(result.text), step.tool).toBe(NOTICE_PL);
        if (step.contains !== undefined) expect(result.text, step.tool).toContain(step.contains);
      }
    } finally {
      await session.close();
    }
    const connections = readFileSync(session.netLog, 'utf8').split('\n').filter(Boolean);
    expect(connections.filter((line) => !line.startsWith('ok 127.0.0.1:'))).toEqual([]);
  }, 180_000);

  it('starts as the plugin starts it: demo option on, default address, empty override, a token', async () => {
    const session = await openSession({
      LOADCRAFT_DEMO: 'true',
      LOADCRAFT_URL: 'https://app.loadcraft.io',
      LOADCRAFT_API_URL: '',
      LOADCRAFT_API_TOKEN: CANARY,
    });
    try {
      const status = await session.call('process_get_status', {});
      expect(status.isError, status.text).toBe(false);
      expect(status.text.split('\n')[0]).toBe(NOTICE_PL);
      expect(status.text).not.toContain(CANARY);
    } finally {
      await session.close();
    }
    const connections = readFileSync(session.netLog, 'utf8').split('\n').filter(Boolean);
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.filter((line) => !line.startsWith('ok 127.0.0.1:'))).toEqual([]);
  }, 60_000);

  it('beside an address of a real backend the server stays up, lists its tools and refuses with the fix', async () => {
    const session = await openSession({
      LOADCRAFT_DEMO: '1',
      LOADCRAFT_LOCALE: 'en',
      LOADCRAFT_URL: 'https://app.example.com',
      LOADCRAFT_API_TOKEN: CANARY,
    });
    try {
      expect((await session.client.listTools()).tools.length).toBeGreaterThan(10);
      for (const [tool, args] of [
        ['process_get_status', {}],
        ['flows_get', { flow_id: 'zakupy' }],
      ] as const) {
        const result = await session.call(tool, args);
        expect(result.isError, tool).toBe(true);
        expect(result.text, tool).toMatch(/^\[plugin_not_configured\] /u);
        expect(result.text, tool).toContain('LOADCRAFT_URL');
        // What to change, in the words of the plugin settings.
        expect(result.text, tool).toMatch(
          /\/plugin[^\n]*turn off the demo option[^\n]*loadcraft_url/u,
        );
        expect(result.text, tool).not.toContain(CANARY);
        expect(result.text, tool).not.toContain(NOTICE_EN);
      }
      expect(session.stderr()).not.toContain(CANARY);
      expect(session.stderr()).toContain('"problems":1');
    } finally {
      await session.close();
    }
    // No sample backend was started and nothing connected, to a real LoadCraft or to the loopback.
    expect(existsSync(session.netLog) ? readFileSync(session.netLog, 'utf8') : '').toBe('');
  }, 60_000);

  it('names every address that conflicts', async () => {
    const session = await openSession({
      LOADCRAFT_DEMO: 'true',
      LOADCRAFT_URL: 'https://app.example.com',
      LOADCRAFT_API_URL: 'https://api.example.com/api/v1',
    });
    try {
      const result = await session.call('process_get_status', {});
      expect(result.isError).toBe(true);
      expect(result.text).toContain('LOADCRAFT_URL and LOADCRAFT_API_URL');
    } finally {
      await session.close();
    }
  }, 60_000);

  it('without the backend file next to the server it stays up and names the file', async () => {
    const dir = await scratch();
    copyFileSync(SERVER, join(dir, 'server.mjs'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(dir, 'server.mjs')],
      env: { PATH: process.env.PATH ?? '', LOADCRAFT_DEMO: '1', LOADCRAFT_LOCALE: 'en' },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'demo-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.length).toBeGreaterThan(10);
      const result = await client.callTool({ name: 'process_get_status', arguments: {} });
      const text = JSON.stringify(result.content);
      expect(result.isError).toBe(true);
      expect(text).toContain('plugin_not_configured');
      expect(text).toContain('demo-backend.mjs');
      expect(text).toContain('turn off the demo option');
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe('the net guard', () => {
  it('refuses and records a connection outside the loopback interface', async () => {
    const dir = await scratch();
    const log = join(dir, 'net.log');
    const probe =
      "import net from 'node:net';" +
      "const socket = net.connect(80, '93.184.216.34');" +
      "socket.on('error', () => process.exit(0));";
    await run(
      process.execPath,
      ['--import', pathToFileURL(NET_GUARD).href, '--input-type=module', '-e', probe],
      {
        env: { PATH: process.env.PATH ?? '', LC_NET_GUARD_LOG: log },
        timeout: 10_000,
      },
    );
    expect(readFileSync(log, 'utf8')).toBe('blocked 93.184.216.34:80\n');
  });
});
