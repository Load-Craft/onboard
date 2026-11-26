// The live gate (`scripts/live-gate.ts`): what it refuses before it touches anything, and the
// whole of run 1 against the fake backend in `--fake` mode, as the coordinator would start it on a
// real one. The script runs as its own process with `node`, so these tests cover the file exactly
// as `npm run gate` runs it.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { isIP, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  Backend,
  canonicalAddress,
  checkLaunch,
  checkProfile,
  checkTarget,
  deleteCommand,
  isLocalAddress,
  langfuseCounter,
  normalizeOrigin,
  profileSeconds,
  type Resolve,
  executionFromText,
  isGateProject,
  journeysFromText,
  pendingOperation,
  scrubber,
  type GateConfig,
} from '../scripts/live-gate.js';
import { CANARY, assertNoCanary } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(args: readonly string[], env: Record<string, string> = {}): Promise<Finished> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LIVE_GATE_FAKE_SPEED: '600',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, stdout, stderr }));
  });
}

// Removed once the file is done: its gates run side by side, so no test may clean up for the others.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function reportDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-test-'));
  dirs.push(dir);
  return dir;
}

async function onlyReport(dir: string): Promise<string> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files).toHaveLength(1);
  return readFile(join(dir, files[0] ?? ''), 'utf8');
}

const CONFIG: GateConfig = {
  backend: { url: 'http://127.0.0.1:8123' },
  workspace: { openapi: '/tmp/openapi.json' },
  projectPrefix: 'live-gate',
  composition: 'gate-mix',
  environments: {
    main: { name: 'gate', api: 'http://127.0.0.1:9000' },
    capped: { name: 'gate-capped', api: 'http://127.0.0.1:9000', limit: [5, 5] },
  },
  journeys: 2,
  accounts: 30,
  profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
  thresholds: { p95_ms: 2000, error_rate_pct: 5 },
  costLimitUsd: 3,
  langfuse: { url: 'https://langfuse.example.com', api: 'v2', environment: 'mcp-live-gate' },
  timeoutMin: 45,
  forbiddenBackends: [],
};

const ENV = {
  LIVE_GATE_I_HAVE_APPROVAL: 'http://127.0.0.1:8123',
  LIVE_GATE_TARGET_APPROVAL: 'http://127.0.0.1:9000',
  LIVE_GATE_API_TOKEN: CANARY,
  LANGFUSE_PUBLIC_KEY: 'pk-lf-example',
  LANGFUSE_SECRET_KEY: 'sk-lf-example',
};

/** The configuration with another backend, and the approval given for exactly that backend. */
function at(url: string, extra: Partial<GateConfig> = {}): [GateConfig, typeof ENV] {
  return [
    { ...CONFIG, ...extra, backend: { url } },
    { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: url },
  ];
}

/** Names the tests resolve without DNS; an IP literal resolves to itself. */
const NAMES: Readonly<Record<string, readonly string[]>> = {
  localhost: ['127.0.0.1', '::1'],
  'gate.example.com': ['203.0.113.7'],
  'twin.example.com': ['203.0.113.7'],
  'other.example.com': ['203.0.113.8'],
  'sneaky.example.com': ['203.0.113.9', '127.0.0.5'],
};

const resolveTest: Resolve = (host) => {
  const bare = host.replace(/^\[|\]$/gu, '');
  if (isIP(bare) !== 0) return Promise.resolve([bare]);
  const found = NAMES[bare];
  return found === undefined
    ? Promise.reject(new Error(`unknown name ${bare}`))
    : Promise.resolve([...found]);
};

const DEV_PORT_REFUSAL =
  /reaches this machine on port 8000, the default port of the LoadCraft development backend/u;

describe('one spelling of an origin', () => {
  it.each([
    ['http://127.0.0.1:8123', 'http://127.0.0.1:8123'],
    ['HTTP://LocalHost.:8123/', 'http://localhost:8123'],
    ['http://example.com', 'http://example.com:80'],
    ['https://example.com.', 'https://example.com:443'],
    ['https://example.com:443/', 'https://example.com:443'],
    ['  http://[::1]:8123  ', 'http://[::1]:8123'],
  ])('%s → %s', (raw, origin) => {
    expect(normalizeOrigin(raw)).toMatchObject({ origin });
  });

  it.each([
    ['127.0.0.1:8001', 'no http:// or https://'],
    ['localhost:8001', 'no http:// or https://'],
    ['ftp://example.com', 'not http or https'],
    ['http://user:pw@example.com', 'user name or a password'],
    ['http://example.com/api/v1', 'path, a query or a fragment'],
    ['http://example.com/?a=1', 'path, a query or a fragment'],
    ['http://', 'not an address'],
  ])('%s is not an origin (%s)', (raw, reason) => {
    const parsed = normalizeOrigin(raw);
    expect('error' in parsed && parsed.error).toContain(reason);
  });

  it('reads every address of this machine as one, also mapped into IPv6', () => {
    for (const address of [
      '127.0.0.1',
      '127.0.0.2',
      '127.255.0.9',
      '0.0.0.0',
      '::1',
      '::',
      '[::ffff:127.0.0.1]',
      '::ffff:7f00:1',
      '0:0:0:0:0:0:0:1',
    ]) {
      expect(isLocalAddress(address), address).toBe(true);
    }
    for (const address of ['10.0.0.1', '203.0.113.7', '::2', '2001:db8::1', '::ffff:203.0.113.7']) {
      expect(isLocalAddress(address), address).toBe(false);
    }
    expect(canonicalAddress('[::ffff:7f00:1]')).toBe('127.0.0.1');
    expect(canonicalAddress('::1')).toBe('0:0:0:0:0:0:0:1');
  });
});

describe('what the gate refuses before it starts', () => {
  it('accepts a complete configuration with the approval, the token and the cost counter keys', async () => {
    expect(checkLaunch(CONFIG, ENV)).toEqual([]);
    expect(await checkTarget(CONFIG, ENV, resolveTest)).toEqual([]);
  });

  it('takes as approval only the origin of this backend, in any spelling of it', () => {
    for (const given of [
      '1',
      'yes',
      '',
      'http://127.0.0.1:8124',
      'https://127.0.0.1:8123',
      '127.0.0.1:8123',
      'http://localhost:8123',
    ]) {
      const refusals = checkLaunch(CONFIG, { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: given });
      expect(refusals.join('\n'), given).toContain(
        `set LIVE_GATE_I_HAVE_APPROVAL to exactly that backend's origin: expected http://127.0.0.1:8123, got ${JSON.stringify(given)}`,
      );
    }
    for (const given of ['http://127.0.0.1:8123/', ' HTTP://127.0.0.1:8123 ']) {
      expect(checkLaunch(CONFIG, { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: given }), given).toEqual([]);
    }
  });

  it('refuses a missing backend address instead of using a default', () => {
    const refusals = checkLaunch(...at(''));
    expect(refusals.join('\n')).toContain('backend.url must be the explicit http(s) origin');
  });

  it.each([
    'https://app.loadcraft.io',
    'https://app.loadcraft.io.',
    'https://eu.loadcraft.io/',
    'https://x.loadcraft.io.',
    'https://loadcraft.io',
    'https://LOADCRAFT.IO.',
  ])('refuses the hosted instance %s', (url) => {
    expect(checkLaunch(...at(url)).join('\n')).toContain('is a hosted loadcraft.io instance');
  });

  it.each([
    'http://localhost:8000',
    'http://localhost.:8000',
    'http://127.0.0.1:8000/',
    'http://127.0.0.2:8000',
    'http://0.0.0.0:8000',
    'http://[::]:8000',
    'http://[::1]:8000',
    'http://[::ffff:127.0.0.1]:8000',
    'http://foo.localhost:8000',
    'http://127.1:8000',
  ])('refuses %s, port 8000 of this machine, from the address alone', (url) => {
    expect(checkLaunch(...at(url)).join('\n')).toMatch(DEV_PORT_REFUSAL);
  });

  it('refuses port 8000 of a name that resolves to this machine, by any of its addresses', async () => {
    for (const url of ['http://localhost:8000', 'http://sneaky.example.com:8000']) {
      expect((await checkTarget(...at(url), resolveTest)).join('\n'), url).toMatch(
        DEV_PORT_REFUSAL,
      );
    }
    expect(await checkTarget(...at('http://gate.example.com:8000'), resolveTest)).toEqual([]);
    expect(await checkTarget(...at('http://sneaky.example.com:8001'), resolveTest)).toEqual([]);
  });

  it('refuses a host that does not resolve: it cannot be checked', async () => {
    const refusals = await checkTarget(...at('http://nowhere.example.com:8123'), resolveTest);
    expect(refusals.join('\n')).toContain('the host does not resolve');
  });

  it('refuses a forbidden backend by the address and port it reaches, not by its spelling', async () => {
    const cases: [backend: string, forbidden: string][] = [
      ['http://127.0.0.1:8001', 'http://127.0.0.1:8001'],
      ['http://localhost:8001', 'http://127.0.0.1:8001'],
      ['http://[::1]:8001', 'http://127.0.0.1:8001'],
      ['https://127.0.0.1:8001', 'http://127.0.0.1:8001'],
      ['http://localhost.:8001', 'http://LOCALHOST:8001/'],
      ['http://twin.example.com:8001', 'http://gate.example.com.:8001'],
      ['http://203.0.113.7:8001', 'http://gate.example.com:8001'],
    ];
    for (const [backend, forbidden] of cases) {
      const [config, env] = at(backend);
      const byEnv = await checkTarget(
        config,
        { ...env, LIVE_GATE_FORBIDDEN_BACKENDS: `http://192.0.2.1:9, ${forbidden}` },
        resolveTest,
      );
      expect(byEnv.join('\n'), `${backend} vs ${forbidden}`).toMatch(
        /reaches the same address and port as .* from LIVE_GATE_FORBIDDEN_BACKENDS/u,
      );
      const byConfig = await checkTarget(
        { ...config, forbiddenBackends: [forbidden] },
        env,
        resolveTest,
      );
      expect(byConfig.join('\n'), `${backend} vs ${forbidden}`).toMatch(/from forbiddenBackends/u);
    }
    const [config, env] = at('http://gate.example.com:8001');
    for (const other of [
      'http://gate.example.com:8002',
      'http://other.example.com:8001',
      'http://127.0.0.1:8001',
    ]) {
      expect(
        await checkTarget(config, { ...env, LIVE_GATE_FORBIDDEN_BACKENDS: other }, resolveTest),
        other,
      ).toEqual([]);
    }
  });

  it('refuses a forbidden entry it cannot read instead of ignoring it', () => {
    for (const entry of ['127.0.0.1:8001', 'localhost:8001', 'http://127.0.0.1:8001/api']) {
      const byEnv = checkLaunch(CONFIG, { ...ENV, LIVE_GATE_FORBIDDEN_BACKENDS: entry });
      expect(byEnv.join('\n'), entry).toContain('LIVE_GATE_FORBIDDEN_BACKENDS entry');
      const byConfig = checkLaunch({ ...CONFIG, forbiddenBackends: [entry] }, ENV);
      expect(byConfig.join('\n'), entry).toContain('forbiddenBackends entry');
    }
  });

  it('refuses without the API token or without the keys of the cost counter', () => {
    const noToken = { ...ENV, LIVE_GATE_API_TOKEN: '' };
    expect(checkLaunch(CONFIG, noToken).join('\n')).toContain('LIVE_GATE_API_TOKEN');
    const noKey = { ...ENV, LANGFUSE_SECRET_KEY: undefined };
    expect(checkLaunch(CONFIG, noKey).join('\n')).toContain('LANGFUSE_SECRET_KEY');
    expect(
      checkLaunch({ ...CONFIG, langfuse: { ...CONFIG.langfuse, url: '' } }, ENV).join('\n'),
    ).toContain('langfuse.url');
  });

  it('refuses without the tracing environment of the gate backend in Langfuse', () => {
    for (const environment of ['', '  ']) {
      const refusals = checkLaunch(
        { ...CONFIG, langfuse: { ...CONFIG.langfuse, environment } },
        ENV,
      );
      expect(refusals.join('\n'), JSON.stringify(environment)).toContain('langfuse.environment');
    }
  });

  it('takes 20 users and 60 s, and refuses 21 users or 61 s with the exact reason', () => {
    expect(checkProfile({ type: 'ramp_concurrency', vusers: 20, ramp: 60 })).toEqual([]);
    expect(checkProfile({ type: 'ramp_concurrency', vusers: 21, ramp: 60 })).toEqual([
      'profile.vusers must be a whole number from 2 to 20 (got 21).',
    ]);
    expect(checkProfile({ type: 'ramp_concurrency', vusers: 20, ramp: 61 })).toEqual([
      'the profile lasts 61 s (ramp); the gate runs at most 60 s.',
    ]);
    expect(
      checkLaunch({ ...CONFIG, profile: { type: 'ramp_concurrency', vusers: 21, ramp: 60 } }, ENV),
    ).toContain('profile.vusers must be a whole number from 2 to 20 (got 21).');
  });

  it('refuses a key the profile may not have, and counts every phase into its length', () => {
    const profile = { type: 'ramp_concurrency', vusers: 20, ramp: 30, hold: 40 };
    expect(checkProfile(profile)).toEqual([
      'profile has keys the gate does not take: hold (allowed: type, vusers, ramp).',
      'the profile lasts 70 s (ramp + hold); the gate runs at most 60 s.',
    ]);
    expect(profileSeconds({ ramp: 10, hold: 20, duration: 5, steps: 9 })).toBe(35);
    expect(checkProfile({ type: 'ramp_concurrency', vusers: 20, ramp: 10, steps: 3 })).toEqual([
      'profile has keys the gate does not take: steps (allowed: type, vusers, ramp).',
    ]);
  });

  it('refuses a protected main environment and a cap that clamps nothing', () => {
    const protectedMain = checkLaunch(
      {
        ...CONFIG,
        environments: {
          ...CONFIG.environments,
          main: { ...CONFIG.environments.main, limit: [5, 5] },
        },
      },
      ENV,
    );
    expect(protectedMain.join('\n')).toContain('environments.main');
    const loose = checkLaunch(
      {
        ...CONFIG,
        environments: {
          ...CONFIG.environments,
          capped: { ...CONFIG.environments.capped, limit: [50, 50] },
        },
      },
      ENV,
    );
    expect(loose.join('\n')).toContain('environments.capped');
  });

  it('keeps the cost limit and the time limit within their ceilings', () => {
    expect(checkLaunch({ ...CONFIG, costLimitUsd: 20 }, ENV)).toEqual([]);
    expect(checkLaunch({ ...CONFIG, timeoutMin: 120 }, ENV)).toEqual([]);
    for (const costLimitUsd of [0, -1, 20.01, 1e6, Number.NaN]) {
      expect(checkLaunch({ ...CONFIG, costLimitUsd }, ENV), String(costLimitUsd)).toContain(
        'costLimitUsd must be more than 0 and at most 20 US dollars.',
      );
    }
    for (const timeoutMin of [0, 121, 1e6]) {
      expect(checkLaunch({ ...CONFIG, timeoutMin }, ENV), String(timeoutMin)).toContain(
        'timeoutMin must be more than 0 and at most 120 minutes.',
      );
    }
  });

  it('the script exits with 2 and starts nothing without the approval', async () => {
    const run = await runGate(
      ['--config', join(ROOT, 'scripts', 'live-gate.config.example.json')],
      { ...ENV, LIVE_GATE_I_HAVE_APPROVAL: '1' },
    );
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(
      'set LIVE_GATE_I_HAVE_APPROVAL to exactly that backend\'s origin: expected http://127.0.0.1:8100, got "1"',
    );
    expect(`${run.stdout}${run.stderr}`).not.toContain(CANARY);
  });
});

/** A server that answers every request with a redirect to `target`, and one that counts hits. */
async function redirectPair(): Promise<{
  from: string;
  hits: () => number;
  close: () => Promise<void>;
}> {
  let hits = 0;
  const target = createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"authenticated":true,"data":[]}');
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const targetPort = (target.address() as AddressInfo).port;
  const redirect = createServer((req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${String(targetPort)}${req.url ?? '/'}` });
    res.end();
  });
  redirect.listen(0, '127.0.0.1');
  await once(redirect, 'listening');
  const from = `http://127.0.0.1:${String((redirect.address() as AddressInfo).port)}`;
  const closeOne = (server: Server): Promise<void> =>
    new Promise((done) => {
      server.close(() => done());
    });
  return {
    from,
    hits: () => hits,
    close: async () => {
      await closeOne(redirect);
      await closeOne(target);
    },
  };
}

describe('redirects', () => {
  it('the reads of the backend do not follow a redirect', async () => {
    const pair = await redirectPair();
    try {
      await expect(new Backend(pair.from, CANARY).request('GET', '/auth/me')).rejects.toThrow();
      expect(pair.hits()).toBe(0);
    } finally {
      await pair.close();
    }
  });

  it('the cost counter does not follow a redirect', async () => {
    const pair = await redirectPair();
    try {
      const counter = langfuseCounter(
        { url: pair.from, api: 'v2', environment: 'mcp-live-gate' },
        { publicKey: 'pk-lf-example', secretKey: 'sk-lf-example' },
        new Date(),
      );
      await expect(counter.read()).rejects.toThrow();
      expect(pair.hits()).toBe(0);
    } finally {
      await pair.close();
    }
  });

  it('a backend that redirects is refused before the start (exit 2), the target never reached', async () => {
    const pair = await redirectPair();
    const dir = await reportDir();
    try {
      await writeFile(
        join(dir, 'openapi.json'),
        '{"openapi":"3.0.3","info":{"title":"t","version":"1"},"paths":{}}',
      );
      const config = join(dir, 'gate.json');
      await writeFile(
        config,
        JSON.stringify({
          backend: { url: pair.from },
          workspace: { openapi: 'openapi.json' },
          environments: CONFIG.environments,
          langfuse: CONFIG.langfuse,
        }),
      );
      const run = await runGate(['--config', config, '--report-dir', dir], {
        ...ENV,
        LIVE_GATE_I_HAVE_APPROVAL: pair.from,
      });
      expect(run.code, run.stderr).toBe(2);
      expect(run.stderr).toContain('does not accept the token (GET /api/v1/auth/me → 0)');
      expect(pair.hits()).toBe(0);
    } finally {
      await pair.close();
    }
  });
});

describe('the cost counter', () => {
  it('asks only for the tracing environment of the gate, trimmed', async () => {
    const queries: unknown[] = [];
    const server = createServer((req, res) => {
      queries.push(
        JSON.parse(new URL(req.url ?? '/', 'http://x').searchParams.get('query') ?? 'null'),
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[{"sum_totalCost":0.25}]}');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const counter = langfuseCounter(
        {
          url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
          api: 'v2',
          environment: '  mcp-live-gate ',
        },
        { publicKey: 'pk-lf-example', secretKey: 'sk-lf-example' },
        new Date(),
      );
      expect(await counter.read()).toBe(0.25);
      expect(queries[0]).toMatchObject({
        filters: [{ column: 'environment', operator: '=', value: 'mcp-live-gate', type: 'string' }],
      });
    } finally {
      await new Promise<void>((done) => {
        server.close(() => done());
      });
    }
  });
});

describe('reading the texts the way a model reads them', () => {
  it('finds the handle of an unfinished operation and of an operation waiting for the user', () => {
    expect(
      pendingOperation(
        'building…\nThe operation is still running in LoadCraft: test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42.\n' +
          'Call process_wait with operation "test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42" to keep waiting.',
      ),
    ).toEqual({ kind: 'running', handle: 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42' });
    expect(
      pendingOperation(
        'The operation is waiting for the user: refine:0b5e8d2a-c7f1-4936-b4a0-9d3c6e1f8a52.',
      ),
    ).toEqual({ kind: 'needs_user', handle: 'refine:0b5e8d2a-c7f1-4936-b4a0-9d3c6e1f8a52' });
    expect(
      pendingOperation(
        'The operation is still running in LoadCraft: self_check:sc-6ac5b27a245f.\n' +
          'Call process_wait with operation "self_check:sc-6ac5b27a245f" to keep waiting.',
      ),
    ).toEqual({ kind: 'running', handle: 'self_check:sc-6ac5b27a245f' });
    expect(
      pendingOperation('test finished · run e-3f9a12c4 · next: results_get_report'),
    ).toBeUndefined();
  });

  it('reads the names of the proposed journeys from the list', () => {
    const text = [
      '4 journey proposals from the API description:',
      'zakupy              logowanie → wyszukanie → koszyk → zamówienie',
      'przeglądanie        kategorie → produkt',
      'status zamówienia   zamówienie → odpytywanie o status',
      '8 of 42 operations · 34 outside the journeys',
    ].join('\n');
    expect(journeysFromText(text)).toEqual(['zakupy', 'przeglądanie', 'status zamówienia']);
  });

  it('reads the run from the link of its live page and its short handle', () => {
    const text = [
      'test started · Ramp load (closed) · 0 → 20 at once',
      '↗ https://app.example.com/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/gatling/executions/3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42/live',
      'test finished · run e-3f9a12c4 · next: results_get_report',
    ].join('\n');
    expect(executionFromText(text)).toEqual({
      id: '3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42',
      handle: 'e-3f9a12c4',
    });
  });

  it('knows the names of its own projects and how to delete one without writing the token', () => {
    expect(isGateProject('live-gate-20261123-071811', 'live-gate')).toBe(true);
    expect(isGateProject('live-gate-20261123-071811-copy', 'live-gate')).toBe(false);
    expect(isGateProject('live-gate', 'live-gate')).toBe(false);
    expect(isGateProject('sklep', 'live-gate')).toBe(false);
    expect(isGateProject('a.b-20261123-071811', 'a.b')).toBe(true);
    expect(isGateProject('axb-20261123-071811', 'a.b')).toBe(false);
    expect(deleteCommand('http://127.0.0.1:8100', 'f3c9ebfd-2b30-405c-b071-0a2ebd22e0b2')).toBe(
      'curl -X DELETE -H "Authorization: Bearer $LIVE_GATE_API_TOKEN" ' +
        'http://127.0.0.1:8100/api/v1/projects/f3c9ebfd-2b30-405c-b071-0a2ebd22e0b2',
    );
  });

  it('masks every secret in what it writes', () => {
    const scrub = scrubber([CANARY, 'sk-lf-example']);
    expect(scrub(`token ${CANARY} and sk-lf-example`)).toBe('token [secret] and [secret]');
  });
});

const CANCELLED_RUN =
  /- run [0-9a-f-]{36} was (pending|building|running): cancelled on the backend \(HTTP 200\)/u;

describe.concurrent('npm run gate -- --fake', () => {
  it('walks run 1 on the fake backend, checks every effect and writes the report', async () => {
    const dir = await reportDir();
    // Speed 60 keeps the generation long enough to take several calls: the path the next check reads.
    const run = await runGate(['--fake', '--report-dir', dir], { LIVE_GATE_FAKE_SPEED: '60' });
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const report = await onlyReport(dir);
    expect(report).toContain('# Live gate report');
    expect(report).toContain('Result: **PASSED**');
    for (const step of [
      'project_create',
      'project_save_env',
      'project_check_env',
      'project_analyze_setup',
      'project_apply_setup',
      'flows_suggest_journeys',
      'flows_generate_from_suggestions',
      'scenario_suggest_split',
      'scenario_generate',
      'data_check_readiness',
      'data_create_dataset',
      'data_set_bindings',
      'data_create_accounts',
      'scenario_check_self',
      'run_plan',
      'run_start',
      'results_get_report',
      'results_analyze_run',
    ]) {
      expect(report, step).toContain(`\`${step}\``);
    }
    expect(report).toContain('manifest');
    // The fake generates a scenario per flow in minutes (fake time): each call ends with a handle,
    // `process_wait` ends with "call scenario_generate again with the same arguments to finish", and only the
    // call after the last generation composes.
    const generation = report.slice(
      report.indexOf('. scenario generation — '),
      report.indexOf('. data plan — '),
    );
    const composing = [...generation.matchAll(/^Call \d+: `scenario_generate` /gmu)];
    expect(composing.length).toBeGreaterThanOrEqual(2);
    expect(generation).toMatch(/Call \d+: `process_wait` \{"operation":"scenario_generation:/u);
    expect(generation).toContain(
      'scenario_generate called again with the same arguments to finish',
    );
    expect(report).not.toMatch(/\| FAILED \|/u);
    expect(report).toMatch(/\| Cleanup \| project sklep-\d{8}-\d{6} deleted \|/u);
    expect(report).toContain('- fake backend: 0 cancel request(s) received');
    expect(report).not.toContain('## Stopping');
    assertNoCanary(report);
    assertNoCanary(run.stdout);
    assertNoCanary(run.stderr);
  }, 300_000);

  it('a self-check that fails stops the gate at that step with exit code 1', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--fake-fault', 'self-check-failed', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toContain('Result: **FAILED**');
    expect(report).toMatch(/Failed at step \d+ `scenario_check_self`/u);
    expect(report).toContain('not run');
    expect(report).toMatch(
      /kept \(the gate failed or was stopped; inspect it first\): project sklep-\d{8}-\d{6} \([0-9a-f-]{36}\); delete it with: curl -X DELETE -H "Authorization: Bearer \$LIVE_GATE_API_TOKEN" http:\/\/127\.0\.0\.1:\d+\/api\/v1\/projects\/[0-9a-f-]{36}/u,
    );
    expect(run.stderr).toContain('scenario_check_self');
    assertNoCanary(report);
  }, 300_000);

  it('a run that records more users than the limit of its environment fails the gate', async () => {
    const dir = await reportDir();
    const run = await runGate([
      '--fake',
      '--scenario',
      'docs,protected',
      '--fake-fault',
      'run-over-limit',
      '--report-dir',
      dir,
    ]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(/Failed at step \d+ `run_start` \(clamped test with consent\)/u);
    expect(report).toContain('does not exceed the limit of qa: 6 ≤ 5 users');
  }, 300_000);

  it('the cost counter over the limit stops the gate with exit code 1', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--fake-fault', 'cost-over-limit', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toContain('Result: **FAILED**');
    expect(report).toContain('cost limit');
  }, 300_000);

  it('a project left by an earlier gate run refuses the start, --reuse runs next to it', async () => {
    const dir = await reportDir();
    const refused = await runGate([
      '--fake',
      '--fake-fault',
      'leftover-project',
      '--report-dir',
      dir,
    ]);
    expect(refused.code, `${refused.stdout}\n${refused.stderr}`).toBe(2);
    expect(refused.stderr).toContain('sklep-20261122-100000');
    expect(refused.stderr).toContain('curl -X DELETE');
    expect(refused.stderr).toContain('--reuse');
    expect(await readdir(dir)).toEqual([]);
    const reused = await runGate([
      '--fake',
      '--fake-fault',
      'leftover-project',
      '--reuse',
      '--report-dir',
      dir,
    ]);
    expect(reused.code, `${reused.stdout}\n${reused.stderr}`).toBe(0);
    expect(await onlyReport(dir)).toContain('Result: **PASSED**');
  }, 300_000);

  it('the time limit passed while a test runs: the test is cancelled on the backend, exit 1', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--fake-fault', 'time-over-limit', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(
      /Failed at step \d+ `run_start` \(test on the unprotected environment\): time limit reached: 15 min/u,
    );
    expect(report).toMatch(CANCELLED_RUN);
    expect(report).toMatch(
      /- fake backend: 1 cancel request\(s\) received: \/api\/v1\/projects\/[0-9a-f-]{36}\/gatling\/executions\/[0-9a-f-]{36}\/cancel/u,
    );
  }, 300_000);

  it('the cost limit passed during a test with a handle: the plugin cancels it, exit 1', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--fake-fault', 'cost-during-run', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toMatch(
      /Failed at step \d+ `run_start` \(test on the unprotected environment\): cost limit reached/u,
    );
    expect(report).toMatch(/- cancel test_run:[0-9a-f-]{36} \(plugin\): Stopped test_run:/u);
    expect(report).toMatch(/- fake backend: 1 cancel request\(s\) received: /u);
  }, 300_000);

  it('the cost limit passed in the first call of run_start, before any handle: cancelled by its id, exit 1', async () => {
    const dir = await reportDir();
    const run = await runGate([
      '--fake',
      '--fake-fault',
      'cost-before-handle',
      '--report-dir',
      dir,
    ]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(1);
    const report = await onlyReport(dir);
    expect(report).toContain('- no operation handle was known when the gate stopped');
    expect(report).toMatch(CANCELLED_RUN);
    expect(report).toMatch(/- fake backend: 1 cancel request\(s\) received: /u);
  }, 300_000);

  it('an unreachable cost counter refuses the start with exit code 2', async () => {
    const dir = await reportDir();
    const run = await runGate(['--fake', '--fake-fault', 'langfuse-down', '--report-dir', dir]);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(2);
    expect(run.stderr).toContain('cost counter');
  }, 120_000);
});
