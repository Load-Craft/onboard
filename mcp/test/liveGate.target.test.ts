// The live gate also checks where the load goes: the environments of the target the gate creates
// (`environments.*.api` and `frontend`), not only the address of the backend. The configuration
// shape, the ceiling of the accounts, the profile sent to `run_start`, an interrupted run.

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_ACCOUNTS,
  accountCount,
  checkLaunch,
  checkTarget,
  isLocalAddress,
  profileArgs,
  readConfig,
  type GateConfig,
  type GateProfile,
  type Resolve,
} from '../scripts/live-gate.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

const BACKEND = 'http://127.0.0.1:8137';
const MAIN = 'https://main.example.com';
const CAPPED = 'https://capped.example.com';

const ENV = {
  LIVE_GATE_I_HAVE_APPROVAL: BACKEND,
  LIVE_GATE_TARGET_APPROVAL: `${MAIN}, ${CAPPED}`,
  LIVE_GATE_API_TOKEN: CANARY,
  LANGFUSE_PUBLIC_KEY: 'pk-lf-example',
  LANGFUSE_SECRET_KEY: 'sk-lf-example',
};

function config(mainApi = MAIN, cappedApi = CAPPED, extra: Partial<GateConfig> = {}): GateConfig {
  return {
    backend: { url: BACKEND },
    workspace: { openapi: '/tmp/openapi.json' },
    projectPrefix: 'live-gate',
    composition: 'gate-mix',
    environments: {
      main: { name: 'gate', api: mainApi },
      capped: { name: 'gate-capped', api: cappedApi, limit: [5, 5] },
    },
    journeys: 2,
    accounts: 30,
    profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
    costLimitUsd: 3,
    langfuse: { url: 'https://langfuse.example.com', api: 'v2', environment: 'mcp-live-gate' },
    timeoutMin: 45,
    forbiddenBackends: [],
    ...extra,
  };
}

/** Both targets and the approval for exactly them. */
function targets(mainApi: string, cappedApi: string): [GateConfig, typeof ENV] {
  return [
    config(mainApi, cappedApi),
    { ...ENV, LIVE_GATE_TARGET_APPROVAL: `${mainApi}, ${cappedApi}` },
  ];
}

const NAMES: Readonly<Record<string, readonly string[]>> = {
  localhost: ['127.0.0.1', '::1'],
  'main.example.com': ['203.0.113.10'],
  'capped.example.com': ['203.0.113.11'],
  'sneaky.example.com': ['203.0.113.9', '127.0.0.5'],
  'lan.example.com': ['192.168.77.5'],
  'twin.example.com': ['203.0.113.10'],
};

const resolveTest: Resolve = (host) => {
  const bare = host.replace(/^\[|\]$/gu, '');
  if (isIP(bare) !== 0) return Promise.resolve([bare]);
  const found = NAMES[bare];
  return found === undefined
    ? Promise.reject(new Error(`unknown name ${bare}`))
    : Promise.resolve([...found]);
};

/** The addresses of "this machine" in the tests: a LAN address and an IPv6 one, besides loopback. */
const MACHINE = ['192.168.77.5', 'fd00:0:0:0:0:0:0:5'];

const DEV_PORT = /reaches this machine on port 8000/u;

describe('QA-08 W7: the target of the load is checked like the backend', () => {
  it('accepts targets named in the approval, and nothing else', async () => {
    expect(checkLaunch(config(), ENV, { machine: MACHINE })).toEqual([]);
    expect(await checkTarget(config(), ENV, resolveTest, MACHINE)).toEqual([]);
  });

  it('refuses a hosted loadcraft.io address as the target, approved or not', () => {
    for (const api of [
      'https://app.loadcraft.io',
      'https://app.loadcraft.io.',
      'https://LOADCRAFT.IO',
      'https://x.loadcraft.io:8443',
    ]) {
      const [c, env] = targets(api, CAPPED);
      const refusals = checkLaunch(c, env, { machine: MACHINE });
      expect(refusals.join('\n'), api).toMatch(
        /environments\.main\.api https:\/\/.*loadcraft\.io.* is a hosted loadcraft\.io instance/iu,
      );
    }
    const [c, env] = targets(MAIN, 'https://eu.loadcraft.io');
    expect(checkLaunch(c, env, { machine: MACHINE }).join('\n')).toContain(
      'environments.capped.api',
    );
  });

  it('refuses a target that is not an origin, also when it is approved', () => {
    for (const api of ['not a url at all', 'api.perf.example.com', 'ftp://main.example.com', '']) {
      const [c, env] = targets(api, CAPPED);
      const refusals = checkLaunch(c, env, { machine: MACHINE }).join('\n');
      expect(refusals, api).toContain('environments.main.api');
      expect(refusals, api).toMatch(/environments\.main\.api "[^"]*" /u);
    }
    for (const api of ['https://main.example.com/api', 'https://user:pw@main.example.com']) {
      const refusals = checkLaunch(config(api), ENV, { machine: MACHINE }).join('\n');
      expect(refusals, api).toContain('environments.main.api');
    }
  });

  it('needs the origin of every environment in LIVE_GATE_TARGET_APPROVAL, spelled as the origin', () => {
    const refused = (given: string | undefined): string =>
      checkLaunch(
        config(),
        { ...ENV, LIVE_GATE_TARGET_APPROVAL: given },
        { machine: MACHINE },
      ).join('\n');
    const needs = 'set LIVE_GATE_TARGET_APPROVAL to the exact origins of every target';
    for (const given of [
      undefined,
      '',
      '1',
      'yes',
      MAIN,
      CAPPED,
      `${MAIN}, https://capped.example.com:8443`,
      `${MAIN}, http://capped.example.com`,
      `${MAIN}, capped.example.com`,
      `${MAIN}, ${CAPPED}/api`,
      'https://other.example.com, https://capped.example.com',
    ]) {
      expect(refused(given), String(given)).toContain(needs);
    }
    for (const given of [
      `${MAIN},${CAPPED}`,
      ` ${CAPPED}/ , HTTPS://MAIN.example.com:443 `,
      `${MAIN}, ${CAPPED}, https://more.example.com`,
    ]) {
      expect(refused(given), given).toBe('');
    }
    expect(refused(`${MAIN}, ${CAPPED}`)).not.toContain('LIVE_GATE_TARGET_APPROVAL');
    expect(refused(MAIN)).toContain(CAPPED);
  });

  it('refuses an unreadable entry of the approval instead of ignoring it', () => {
    const refusals = checkLaunch(
      config(),
      { ...ENV, LIVE_GATE_TARGET_APPROVAL: `${MAIN}, ${CAPPED}, capped.example.com:9` },
      { machine: MACHINE },
    ).join('\n');
    expect(refusals).toContain('LIVE_GATE_TARGET_APPROVAL entry');
  });

  it('the approval of the backend does not stand for the approval of the target', () => {
    const [c, env] = targets(BACKEND, 'http://127.0.0.1:9000');
    const without = { ...env, LIVE_GATE_TARGET_APPROVAL: undefined };
    expect(checkLaunch(c, without, { machine: MACHINE }).join('\n')).toContain(
      'LIVE_GATE_TARGET_APPROVAL',
    );
    expect(checkLaunch(c, env, { machine: MACHINE })).toEqual([]);
  });

  it('asks for the frontend of an environment too, when the configuration has one', () => {
    const c = config();
    const withFrontend: GateConfig = {
      ...c,
      environments: {
        main: { ...c.environments.main, frontend: 'https://app.main.example.com' },
        capped: c.environments.capped,
      },
    };
    const refusals = checkLaunch(withFrontend, ENV, { machine: MACHINE }).join('\n');
    expect(refusals).toContain('environments.main.frontend');
    expect(refusals).toContain('https://app.main.example.com:443');
    expect(
      checkLaunch(
        withFrontend,
        { ...ENV, LIVE_GATE_TARGET_APPROVAL: `${MAIN}, ${CAPPED}, https://app.main.example.com` },
        { machine: MACHINE },
      ),
    ).toEqual([]);
    const loadcraft = {
      ...c,
      environments: {
        ...c.environments,
        capped: { ...c.environments.capped, frontend: 'https://app.loadcraft.io' },
      },
    };
    expect(checkLaunch(loadcraft, ENV, { machine: MACHINE }).join('\n')).toContain(
      'environments.capped.frontend',
    );
  });

  it.each([
    'http://localhost:8000',
    'http://localhost.:8000',
    'http://127.0.0.1:8000',
    'http://127.0.0.2:8000/',
    'http://0.0.0.0:8000',
    'http://[::1]:8000',
    'http://[::ffff:127.0.0.1]:8000',
    'http://foo.localhost:8000',
    'http://192.168.77.5:8000',
    'http://[fd00::5]:8000',
  ])('refuses %s, port 8000 of this machine, as the target from the address alone', (api) => {
    const [c, env] = targets(api, CAPPED);
    expect(checkLaunch(c, env, { machine: MACHINE }).join('\n')).toMatch(
      /environments\.main\.api http:\/\/.* reaches this machine on port 8000/u,
    );
  });

  it('refuses a target name that resolves to this machine on port 8000, by any address', async () => {
    for (const api of [
      'http://localhost:8000',
      'http://sneaky.example.com:8000',
      'http://lan.example.com:8000',
    ]) {
      const [c, env] = targets(api, CAPPED);
      expect((await checkTarget(c, env, resolveTest, MACHINE)).join('\n'), api).toMatch(DEV_PORT);
    }
    const ok = targets('http://main.example.com:8000', 'http://sneaky.example.com:8001');
    expect(await checkTarget(...ok, resolveTest, MACHINE)).toEqual([]);
  });

  it('refuses a target that does not resolve: it cannot be checked', async () => {
    const [c, env] = targets('https://nowhere.example.com', CAPPED);
    const refusals = await checkTarget(c, env, resolveTest, MACHINE);
    expect(refusals.join('\n')).toContain(
      'environments.main.api https://nowhere.example.com:443: the host does not resolve',
    );
  });

  it('refuses a forbidden backend as the target, by the address and port it reaches', async () => {
    const cases: [target: string, forbidden: string][] = [
      ['http://127.0.0.1:8001', 'http://127.0.0.1:8001'],
      ['http://localhost:8001', 'http://127.0.0.1:8001'],
      ['http://[::1]:8001', 'http://127.0.0.1:8001'],
      ['https://127.0.0.1:8001', 'http://127.0.0.1:8001'],
      ['http://twin.example.com:8001', 'http://main.example.com.:8001'],
      ['http://203.0.113.10:8001', 'http://main.example.com:8001'],
    ];
    for (const [api, forbidden] of cases) {
      const [c, env] = targets(api, CAPPED);
      const byEnv = await checkTarget(
        c,
        { ...env, LIVE_GATE_FORBIDDEN_BACKENDS: `http://192.0.2.1:9, ${forbidden}` },
        resolveTest,
        MACHINE,
      );
      expect(byEnv.join('\n'), `${api} vs ${forbidden}`).toMatch(
        /environments\.main\.api .* reaches the same address and port as .* from LIVE_GATE_FORBIDDEN_BACKENDS/u,
      );
      const byConfig = await checkTarget(
        { ...c, forbiddenBackends: [forbidden] },
        env,
        resolveTest,
        MACHINE,
      );
      expect(byConfig.join('\n'), `${api} vs ${forbidden}`).toMatch(/from forbiddenBackends/u);
    }
    const [c, env] = targets('http://main.example.com:8001', CAPPED);
    for (const other of [
      'http://main.example.com:8002',
      'http://capped.example.com:8001',
      'http://127.0.0.1:8001',
    ]) {
      expect(
        await checkTarget(c, { ...env, LIVE_GATE_FORBIDDEN_BACKENDS: other }, resolveTest, MACHINE),
        other,
      ).toEqual([]);
    }
  });

  it('takes the LAN address of this machine for this machine, also against a forbidden 127.0.0.1', async () => {
    expect(isLocalAddress('192.168.77.5', MACHINE)).toBe(true);
    expect(isLocalAddress('[fd00::5]', MACHINE)).toBe(true);
    expect(isLocalAddress('192.168.77.6', MACHINE)).toBe(false);
    expect(isLocalAddress('203.0.113.10', MACHINE)).toBe(false);
    expect(isLocalAddress('192.168.77.5', [])).toBe(false);
    const forbidden = { ...ENV, LIVE_GATE_FORBIDDEN_BACKENDS: 'http://127.0.0.1:8001' };
    // the backend of the gate under the LAN address of the machine, the forbidden one under 127.0.0.1
    const lanBackend: GateConfig = { ...config(), backend: { url: 'http://192.168.77.5:8001' } };
    const approved = { ...forbidden, LIVE_GATE_I_HAVE_APPROVAL: 'http://192.168.77.5:8001' };
    expect((await checkTarget(lanBackend, approved, resolveTest, MACHINE)).join('\n')).toMatch(
      /backend\.url http:\/\/192\.168\.77\.5:8001 reaches the same address and port as http:\/\/127\.0\.0\.1:8001/u,
    );
    expect(await checkTarget(lanBackend, approved, resolveTest, [])).toEqual([]);
    // the same through a target
    const [c, env] = targets('http://lan.example.com:8001', CAPPED);
    expect(
      (
        await checkTarget(
          c,
          { ...env, LIVE_GATE_FORBIDDEN_BACKENDS: 'http://127.0.0.1:8001' },
          resolveTest,
          MACHINE,
        )
      ).join('\n'),
    ).toMatch(/environments\.main\.api .* reaches the same address and port as/u);
    // and port 8000 of the backend under the LAN address
    const dev: GateConfig = { ...config(), backend: { url: 'http://192.168.77.5:8000' } };
    const devEnv = { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: 'http://192.168.77.5:8000' };
    expect(checkLaunch(dev, devEnv, { machine: MACHINE }).join('\n')).toMatch(DEV_PORT);
    expect((await checkTarget(dev, devEnv, resolveTest, MACHINE)).join('\n')).toMatch(DEV_PORT);
    expect(checkLaunch(dev, devEnv, { machine: [] }).join('\n')).not.toMatch(DEV_PORT);
  });

  it('--fake needs no approval of the targets but keeps every refusal about where they lead', () => {
    const fakeEnv = { ...ENV, LIVE_GATE_TARGET_APPROVAL: undefined };
    expect(checkLaunch(config(), fakeEnv, { fake: true, machine: MACHINE })).toEqual([]);
    expect(
      checkLaunch(config('https://app.loadcraft.io'), fakeEnv, { fake: true, machine: MACHINE }),
    ).not.toEqual([]);
    expect(
      checkLaunch(config('http://localhost:8000'), fakeEnv, { fake: true, machine: MACHINE }).join(
        '\n',
      ),
    ).toMatch(DEV_PORT);
    expect(
      checkLaunch(config('not a url'), fakeEnv, { fake: true, machine: MACHINE }).join('\n'),
    ).toContain('environments.main.api');
  });

  it('checks the address of the telemetry source by its spelling: no loadcraft.io, not this machine on 8000', () => {
    const withUrl = (url: string): GateConfig =>
      config(MAIN, CAPPED, { telemetry: { label: 'l', url } });
    expect(checkLaunch(withUrl('https://logs.example.com/mcp'), ENV, { machine: MACHINE })).toEqual(
      [],
    );
    for (const url of [
      'https://logs.loadcraft.io/mcp',
      'http://localhost:8000/mcp',
      'logs.example.com/mcp',
      'not a url',
      'ftp://logs.example.com/mcp',
    ]) {
      expect(checkLaunch(withUrl(url), ENV, { machine: MACHINE }).join('\n'), url).toContain(
        'telemetry.url',
      );
    }
  });
});

describe('QA-08 D12: the accounts the gate creates have a ceiling', () => {
  it('refuses a configuration above it, takes the ceiling itself', () => {
    expect(MAX_ACCOUNTS).toBe(200);
    expect(checkLaunch(config(MAIN, CAPPED, { accounts: 200 }), ENV, { machine: MACHINE })).toEqual(
      [],
    );
    expect(
      checkLaunch(config(MAIN, CAPPED, { accounts: 201 }), ENV, { machine: MACHINE }).join('\n'),
    ).toContain('accounts must be a whole number from profile.vusers to 200');
    expect(
      checkLaunch(config(MAIN, CAPPED, { accounts: 5 }), ENV, { machine: MACHINE }).join('\n'),
    ).toContain('accounts must be a whole number from profile.vusers to 200');
  });

  it('stops before creating more than the ceiling, however many the backend asks for', () => {
    expect(accountCount(30, 12)).toBe(30);
    expect(accountCount(30, null)).toBe(30);
    expect(accountCount(30, 80)).toBe(80);
    expect(accountCount(30, 200)).toBe(200);
    expect(() => accountCount(30, 201)).toThrow(/needs 201 accounts, above the ceiling of 200/u);
    expect(() => accountCount(30, 1e9)).toThrow(/above the ceiling of 200/u);
  });
});

describe('QA-08 D13: a configuration of the wrong shape is a refusal, not a crash', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function file(content: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'live-gate-config-'));
    dirs.push(dir);
    const path = join(dir, 'gate.json');
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  const complete = {
    backend: { url: BACKEND },
    workspace: { openapi: 'openapi.json' },
    environments: {
      main: { name: 'gate', api: MAIN },
      capped: { name: 'gate-capped', api: CAPPED, limit: [5, 5] },
    },
    langfuse: { url: 'https://langfuse.example.com', api: 'v2', environment: 'mcp-live-gate' },
  };

  it('reads a complete configuration and fills in the defaults', async () => {
    const read = readConfig(await file(complete));
    expect(read.journeys).toBe(2);
    expect(read.environments.capped.limit).toEqual([5, 5]);
    expect(checkLaunch(read, ENV, { machine: MACHINE })).toEqual([]);
  });

  it.each([
    ['langfuse', { ...complete, langfuse: undefined }, 'langfuse must be an object'],
    ['environments', { ...complete, environments: undefined }, 'environments must be an object'],
    [
      'environments.capped',
      { ...complete, environments: { main: complete.environments.main } },
      'environments.capped must be an object',
    ],
    [
      'environments.main.api',
      { ...complete, environments: { ...complete.environments, main: { name: 'gate' } } },
      'environments.main.api must be a string',
    ],
    ['backend', { ...complete, backend: 'http://x' }, 'backend must be an object'],
    ['workspace', { ...complete, workspace: undefined }, 'workspace must be an object'],
    ['profile', { ...complete, profile: 'ramp' }, 'profile must be an object'],
    ['accounts', { ...complete, accounts: '30' }, 'accounts must be a number'],
    [
      'forbiddenBackends',
      { ...complete, forbiddenBackends: 'http://x:1' },
      'forbiddenBackends must be a list of strings',
    ],
    ['telemetry', { ...complete, telemetry: { label: 'l' } }, 'telemetry.url must be a string'],
    [
      'langfuse.url',
      { ...complete, langfuse: { ...complete.langfuse, url: 5 } },
      'langfuse.url must be a string',
    ],
  ])('names the missing or wrong part: %s', async (_name, content, message) => {
    const path = await file(content);
    expect(() => readConfig(path)).toThrow(message);
  });

  it('lists every problem at once', async () => {
    const path = await file({ backend: { url: BACKEND } });
    let text = '';
    try {
      readConfig(path);
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    for (const part of ['workspace', 'environments', 'langfuse']) expect(text).toContain(part);
  });

  async function runScript(args: readonly string[]): Promise<{ code: number | null; err: string }> {
    return new Promise((done, fail) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...ENV },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
      child.once('error', fail);
      child.once('exit', (code) => done({ code, err }));
    });
  }

  it('the script exits with 2 and a list, not with 1 and a TypeError', async () => {
    const path = await file({ backend: { url: BACKEND } });
    const run = await runScript(['--config', path]);
    expect(run.code, run.err).toBe(2);
    expect(run.err).toContain('refused');
    expect(run.err).toContain('environments must be an object');
    expect(run.err).not.toContain('TypeError');
    expect(run.err).not.toContain('crashed');
    assertNoCanary(run.err);
  });
});

describe('QA-04 verification: the profile sent to run_start', () => {
  it('has exactly the three checked fields, never the object of the file', () => {
    const profile: GateProfile = { type: 'ramp_concurrency', vusers: 20, ramp: 60 };
    const loaded = Object.assign({}, profile, { hold: 600, duration: 3600, steps: [1, 2] });
    const sent = profileArgs(loaded);
    expect(Object.keys(sent)).toEqual(['type', 'vusers', 'ramp']);
    expect(sent).toEqual(profile);
    expect(sent).not.toBe(loaded);
    expect(profileArgs(profile)).not.toBe(profile);
  });
});

describe('QA-08 D11: an interrupted gate stops the way a limit does', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function interrupted(
    signal: NodeJS.Signals,
  ): Promise<{ code: number | null; stderr: string; report: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'live-gate-signal-'));
    dirs.push(dir);
    const child = spawn(process.execPath, [SCRIPT, '--fake', '--report-dir', dir], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LIVE_GATE_FAKE_SPEED: '600',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let sent = false;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!sent && /\[gate\] 0[3-9] \w+ — .* …/u.test(stderr)) {
        sent = true;
        child.kill(signal);
      }
    });
    const code = await new Promise<number | null>((done, fail) => {
      child.once('error', fail);
      child.once('exit', (exitCode) => done(exitCode));
    });
    const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
    const report = files[0] === undefined ? '' : await readFile(join(dir, files[0]), 'utf8');
    return { code, stderr, report };
  }

  it.each(['SIGINT', 'SIGTERM'] as const)(
    '%s: the run is stopped, reported and its project is kept, exit 1',
    async (signal) => {
      const run = await interrupted(signal);
      expect(run.code, run.stderr).toBe(1);
      expect(run.report).toContain('Result: **FAILED**');
      expect(run.report).toContain(`interrupted by ${signal}`);
      expect(run.report).toMatch(/kept \(the gate failed or was stopped; inspect it first\)/u);
      expect(run.report).toContain('delete it with: curl -X DELETE');
      assertNoCanary(run.report);
      assertNoCanary(run.stderr);
    },
    300_000,
  );
});
