// The fixed headers of the live gate: `environments.<x>.headers: [{ name, from_env }]` with the
// `envFile` that holds the values. What the configuration refuses, what is copied into the gate's
// workspace, and the whole run on the fake backend: the header reaches project_save_env, the step reads
// it back, and the value is in no report, no stdout and no stderr.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  checkLaunch,
  HEADER_VALUES_PATH,
  headerCopy,
  readConfig,
  type GateConfig,
} from '../scripts/live-gate.js';
import { ALL_CANARIES, assertNoCanary, CANARY, HEADER_CANARY } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

const VALUE = `pk_${HEADER_CANARY}`;
const HEADER = { name: 'x-api-key', from_env: 'SHOP_API_KEY' };

const BASE: GateConfig = {
  backend: { url: 'http://127.0.0.1:8123' },
  workspace: { openapi: '/tmp/openapi.json' },
  projectPrefix: 'live-gate',
  composition: 'gate-mix',
  environments: {
    main: {
      name: 'gate',
      api: 'http://127.0.0.1:9000',
      headers: [HEADER],
      envFile: '/srv/shop/.env',
    },
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

const withMain = (main: Record<string, unknown>): GateConfig => ({
  ...BASE,
  environments: { ...BASE.environments, main: { ...BASE.environments.main, ...main } },
});

const refusals = (config: GateConfig): string => checkLaunch(config, ENV).join('\n');

describe('the fixed headers: what the gate refuses before it starts', () => {
  it('takes a configuration with a header and its env file', () => {
    expect(refusals(BASE)).not.toMatch(/header/u);
  });

  it('wants the env file that holds the values', () => {
    expect(refusals(withMain({ envFile: undefined }))).toMatch(
      /environments\.main\.headers needs environments\.main\.envFile/u,
    );
  });

  it.each([
    ['Host', 'Host'],
    ['Authorization', 'authorization'],
    ['Content-Length', 'Content-Length'],
    ['a space', 'x api key'],
    ['an underscore', 'x_api_key'],
  ])('refuses the name %s', (_label, name) => {
    expect(refusals(withMain({ headers: [{ name, from_env: 'KEY_1' }] }))).toMatch(
      /is not a header name the plugin accepts/u,
    );
  });

  it('refuses a header twice and a variable that is not a key', () => {
    const twice = withMain({ headers: [HEADER, { ...HEADER, name: 'X-Api-Key' }] });
    expect(refusals(twice)).toMatch(/is listed twice/u);
    expect(refusals(withMain({ headers: [{ name: 'x-key', from_env: 'bad name' }] }))).toMatch(
      /is not a key an env file can hold/u,
    );
  });
});

describe('the configuration file', () => {
  function configFile(environment: Record<string, unknown>): { dir: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'gate-headers-'));
    const file = join(dir, 'gate.json');
    writeFileSync(
      file,
      JSON.stringify({
        backend: { url: 'http://127.0.0.1:8100' },
        workspace: { openapi: 'openapi.json' },
        environments: {
          main: { name: 'a', api: 'https://a.example.com', ...environment },
          capped: { name: 'b', api: 'https://a.example.com', limit: [5, 5] },
        },
        langfuse: { url: 'https://lf.example.com', environment: 'x' },
      }),
    );
    return { dir, file };
  }

  it('reads the env file relative to the configuration file', () => {
    const { dir, file } = configFile({ headers: [HEADER], envFile: '../secrets/shop.env' });
    try {
      const config = readConfig(file);
      expect(config.environments.main.envFile).toBe(resolve(dir, '../secrets/shop.env'));
      expect(config.environments.main.headers).toEqual([HEADER]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a literal value written in the configuration', () => {
    const { dir, file } = configFile({
      headers: [{ name: 'x-api-key', value: 'pk_literal-0001' }],
      envFile: 'shop.env',
    });
    try {
      expect(() => readConfig(file)).toThrow(/value is never written in the configuration/u);
      expect(() => readConfig(file)).not.toThrow(/pk_literal/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the copy of the values into the workspace of the gate', () => {
  const file = (text: string) => () => text;

  it('copies only the variables the headers name, in single quotes', () => {
    const copy = headerCopy(
      BASE,
      file(`OTHER=do-not-copy-this\nSHOP_API_KEY=${VALUE}\nDB_PASSWORD=also-not\n`),
    );
    if ('refusals' in copy) throw new Error(copy.refusals.join('; '));
    expect(Object.keys(copy.files)).toEqual([HEADER_VALUES_PATH]);
    const text = copy.files[HEADER_VALUES_PATH] ?? '';
    expect(text).toContain(`SHOP_API_KEY='${VALUE}'`);
    expect(text).not.toContain('do-not-copy-this');
    expect(text).not.toContain('DB_PASSWORD');
    expect(copy.watched).toEqual([VALUE]);
    expect(copy.values.get('SHOP_API_KEY')).toBe(VALUE);
  });

  it('copies nothing when no environment has headers', () => {
    const copy = headerCopy(
      {
        ...BASE,
        environments: { ...BASE.environments, main: { name: 'gate', api: 'http://a.example.com' } },
      },
      () => {
        throw new Error('the file must not be read');
      },
    );
    expect(copy).toMatchObject({ files: {}, watched: [] });
  });

  it.each([
    ['a missing variable', 'OTHER=1\n', /SHOP_API_KEY is not in the env file/u],
    ['an empty variable', 'SHOP_API_KEY=\n', /is empty in the env file/u],
    ['a value of a single quote', `SHOP_API_KEY="pk_it's-a-long-value"\n`, /single quote/u],
    ['a value with a line break', `SHOP_API_KEY="pk_long-value\\nsecond"\n`, /control character/u],
    ['a short value', 'SHOP_API_KEY=pk_1\n', /at least 8 characters/u],
  ])('refuses %s and never writes a value', (_label, text, expected) => {
    const copy = headerCopy(BASE, file(text));
    if (!('refusals' in copy)) throw new Error('expected a refusal');
    const joined = copy.refusals.join('\n');
    expect(joined).toMatch(expected);
    expect(joined).not.toContain('long-value');
    expect(joined).not.toContain("it's");
  });

  it('refuses a variable with another value in the env file of the other environment', () => {
    const config: GateConfig = {
      ...BASE,
      environments: {
        main: BASE.environments.main,
        capped: {
          name: 'gate-capped',
          api: 'http://127.0.0.1:9000',
          limit: [5, 5],
          headers: [HEADER],
          envFile: '/srv/other/.env',
        },
      },
    };
    const copy = headerCopy(config, (path) =>
      path.includes('other') ? 'SHOP_API_KEY=pk_another-value-9999\n' : `SHOP_API_KEY=${VALUE}\n`,
    );
    if (!('refusals' in copy)) throw new Error('expected a refusal');
    expect(copy.refusals.join('\n')).toMatch(/another value in another environment/u);
  });
});

// ---- the whole run on the fake backend -------------------------------------------------------

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(args: readonly string[]): Promise<Finished> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LIVE_GATE_FAKE_SPEED: '600',
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

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-headers-'));
  dirs.push(dir);
  return dir;
}

async function fakeRun(extra: readonly string[] = []): Promise<{ run: Finished; report: string }> {
  const dir = await scratch();
  const run = await runGate(['--fake', '--report-dir', dir, ...extra]);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files, `${run.stdout}\n${run.stderr}`).toHaveLength(1);
  return { run, report: await readFile(join(dir, files[0] ?? ''), 'utf8') };
}

/** The value of the header never leaves the gate: not in the report, not in what it prints. */
function expectNoValue(run: Finished, report: string): void {
  for (const text of [report, run.stdout, run.stderr]) {
    assertNoCanary(text);
    for (const canary of ALL_CANARIES) expect(text).not.toContain(canary);
    expect(text).not.toContain(HEADER_CANARY);
  }
}

/** A copy of the built server with one rule of the plugin changed. */
async function changedServer(from: string, to: string): Promise<string> {
  const source = await readFile(join(ROOT, 'dist', 'server.mjs'), 'utf8');
  expect(source.split(from).length - 1, `the built server holds ${from} once`).toBe(1);
  const dir = await scratch();
  const file = join(dir, 'server.mjs');
  await writeFile(file, source.replace(from, to));
  return file;
}

describe.concurrent('npm run gate -- --fake (a fixed header of the main environment)', () => {
  it('sends the header, reads it back, and shows the value nowhere', async () => {
    const { run, report } = await fakeRun();
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(report).toContain('Result: **PASSED**');
    expect(report).toContain('environment perf has the header x-api-key');
    expect(report).toMatch(/header x-api-key, its value masked by the backend/u);
    expect(report).toContain('no header value is in any answer of a tool');
    expect(report).toContain('"headers":[{"name":"x-api-key","from_env":"SHOP_API_KEY"}]');
    expectNoValue(run, report);
  }, 300_000);

  it('a plugin that puts the value into its result shows it nowhere: the secret scope of the call masks it', async () => {
    const server = await changedServer(
      'planned[index]?.headerRefs ?? []',
      '(planned[index]?.headers ?? []).map((h) => ({ name: h.name, variable: h.value.reveal() }))',
    );
    const { run, report } = await fakeRun(['--fake-server', server]);
    // The result of project_save_env keeps nothing in the state, so the value only reaches the
    // text of the call, and the scope of the call has replaced it before the gate reads it.
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(report).toContain('headers: x-api-key from [redacted]');
    expect(report).toContain('no header value is in any answer of a tool');
    expectNoValue(run, report);
  }, 300_000);
});
