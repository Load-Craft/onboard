// The accounts of the gate from a CSV file (`accounts: { "file": "<path>" }`): what the gate refuses
// before it starts, the copy it makes for its workspace (mode 0600), and the whole of run 1 against
// the fake backend: the data step loads the copy with `data_create_dataset` (`file`, its consent card
// confirmed) and pins it with `data_set_bindings`, never calls `data_create_accounts`, and no
// password of the file reaches the report, stdout or stderr.

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ACCOUNTS_COPY_PATH,
  accountsFileCopy,
  accountsFileOf,
  checkLaunch,
  readConfig,
  writeWorkspaceFiles,
  type GateConfig,
} from '../scripts/live-gate.js';
import { FILE_CANARY } from './helpers/canary.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

// Removed once the file is done: its gates run side by side, so no test may clean up for the others.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-accounts-'));
  dirs.push(dir);
  return dir;
}

const password = (index: number): string => `Pw-${FILE_CANARY}-${String(index)}`;

/** An accounts file of `count` rows whose passwords all carry the sentinel. */
function accountsCsv(count: number, header = 'email,password'): string {
  const rows = Array.from(
    { length: count },
    (_, index) => `user${String(index)}@example.com,${password(index)}`,
  );
  return `${header}\n${rows.join('\n')}\n`;
}

const MACHINE = ['10.0.0.5'];
const ENV = { LIVE_GATE_API_TOKEN: 't', LANGFUSE_PUBLIC_KEY: 'p', LANGFUSE_SECRET_KEY: 's' };

function config(accounts: GateConfig['accounts']): GateConfig {
  return {
    backend: { url: 'http://127.0.0.1:8123' },
    workspace: { openapi: 'loadcraft/openapi.json' },
    projectPrefix: 'live-gate',
    composition: 'gate-mix',
    environments: {
      main: { name: 'gate', api: 'https://api.example.com', frontend: 'https://example.com' },
      capped: { name: 'gate-capped', api: 'https://api.example.com', limit: [5, 5] },
    },
    journeys: 2,
    accounts,
    profile: { type: 'ramp_concurrency', vusers: 20, ramp: 60 },
    costLimitUsd: 3,
    langfuse: { url: 'https://cloud.langfuse.com', api: 'v2', environment: 'mcp-live-gate' },
    timeoutMin: 45,
    forbiddenBackends: [],
  };
}

const launch = (accounts: GateConfig['accounts']): string =>
  checkLaunch(config(accounts), ENV, { fake: true, machine: MACHINE }).join('\n');

describe('the configuration: accounts from a file', () => {
  it('takes a file instead of a number', () => {
    expect(launch({ file: '/data/accounts.csv' })).not.toMatch(/accounts/u);
    expect(accountsFileOf({ file: '/data/accounts.csv' })).toBe('/data/accounts.csv');
    expect(accountsFileOf(30)).toBeUndefined();
  });

  it('still checks the number as before', () => {
    expect(launch(30)).not.toMatch(/accounts/u);
    expect(launch(5)).toContain('accounts must be a whole number from profile.vusers to 200');
    expect(launch(201)).toContain('accounts must be a whole number from profile.vusers to 200');
  });

  it('refuses a file without a path', () => {
    expect(launch({ file: '' })).toContain('accounts.file must name the CSV file');
  });

  it('resolves the path against the configuration file', async () => {
    const dir = await tempDir();
    const example = JSON.parse(
      await readFile(join(ROOT, 'scripts', 'live-gate.config.example.json'), 'utf8'),
    ) as Record<string, unknown>;
    await mkdir(join(dir, 'secrets'));
    const path = join(dir, 'gate.json');
    await writeFile(
      path,
      JSON.stringify({ ...example, accounts: { file: 'secrets/accounts.csv' } }),
    );
    expect(accountsFileOf(readConfig(path).accounts)).toBe(join(dir, 'secrets', 'accounts.csv'));
  });

  it('refuses a configuration whose accounts is neither a number nor a file', async () => {
    const dir = await tempDir();
    const example = JSON.parse(
      await readFile(join(ROOT, 'scripts', 'live-gate.config.example.json'), 'utf8'),
    ) as Record<string, unknown>;
    const path = join(dir, 'gate.json');
    await writeFile(path, JSON.stringify({ ...example, accounts: { path: 'x.csv' } }));
    expect(() => readConfig(path)).toThrow(/accounts must be a number or \{ "file": "<path>" \}/u);
  });
});

describe('the copy of the accounts file', () => {
  it('keeps the file as it is and watches every password of it', () => {
    const copy = accountsFileCopy(accountsCsv(3));
    if ('refusal' in copy) throw new Error(copy.refusal);
    expect(copy.files[ACCOUNTS_COPY_PATH]).toBe(accountsCsv(3));
    expect(copy.watched).toEqual([password(0), password(1), password(2)]);
    expect(copy.rows).toBe(3);
  });

  it('finds the password column by its name, in a quoted, semicolon separated file', () => {
    const text = `"Login";"Hasło"\nanna@example.com;${password(1)}\n`;
    const copy = accountsFileCopy(text);
    if ('refusal' in copy) throw new Error(copy.refusal);
    expect(copy.watched).toEqual([password(1)]);
  });

  it('refuses a file the search for passwords would prove nothing on, without quoting it', () => {
    const cases: [string, RegExp][] = [
      ['', /is empty/u],
      ['email,password\n', /no row/u],
      [`email,name\na@example.com,${password(1)}\n`, /no column with a password/u],
      ['email,password\na@example.com,Zq7!x\n', /shorter than 8 characters/u],
    ];
    for (const [text, expected] of cases) {
      const copy = accountsFileCopy(text);
      expect('refusal' in copy ? copy.refusal : '').toMatch(expected);
      if ('refusal' in copy) {
        expect(copy.refusal).not.toContain('Zq7!x');
        expect(copy.refusal).not.toContain(FILE_CANARY);
      }
    }
  });

  it('writes the copy with the mode 0600', async () => {
    const dir = await tempDir();
    writeWorkspaceFiles(dir, {
      'loadcraft/openapi.json': '{}',
      [ACCOUNTS_COPY_PATH]: accountsCsv(2),
    });
    expect(await readFile(join(dir, ACCOUNTS_COPY_PATH), 'utf8')).toBe(accountsCsv(2));
    expect((await stat(join(dir, ACCOUNTS_COPY_PATH))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, 'loadcraft/openapi.json'), 'utf8')).toBe('{}');
  });
});

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

async function gate(file: string): Promise<Finished & { report: string; dir: string }> {
  const dir = await tempDir();
  const run = await runGate(['--fake', '--fake-accounts-file', file, '--report-dir', dir]);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files, `${run.stdout}${run.stderr}`).toHaveLength(1);
  return { ...run, dir, report: await readFile(join(dir, files[0] ?? ''), 'utf8') };
}

describe.concurrent('the gate against the fake backend with an accounts file', () => {
  it('loads the copy as a file of the slot, creates nothing and leaks no password', async () => {
    const dir = await tempDir();
    const file = join(dir, 'accounts.csv');
    await writeFile(file, accountsCsv(30), { mode: 0o600 });
    const run = await gate(file);
    const out = `${run.stdout}\n${run.stderr}`;
    expect(run.code, out).toBe(0);

    // The data step calls data_create_dataset with the copy inside the workspace, not the original
    // path: first for the card, then with its token; the result's pin is made.
    const fileCall = (confirmed: string): RegExp =>
      new RegExp(
        '`data_create_dataset` \\{[^\\n]*"slot":"accounts","file":"' +
          ACCOUNTS_COPY_PATH.replace('.', '\\.') +
          '"' +
          confirmed,
        'u',
      );
    expect(run.report).toMatch(fileCall('\\}'));
    expect(run.report).toMatch(fileCall(',"confirm":"[^"]+"\\}'));
    expect(run.report).toMatch(/`data_set_bindings` \{[^\n]*"bindings":\{[^\n]*"accounts":/u);
    expect(run.report).not.toContain(file);
    expect(run.report).not.toMatch(/`data_create_accounts` \{/u);
    expect(run.report).not.toMatch(/accounts created/u);
    expect(run.report).toMatch(/accounts loaded from the file: 30/u);
    expect(run.report).toMatch(/the preflight finds the data ready for the profile/u);

    // The sentinel was looked for (the file's passwords are among the watched values) and not found.
    expect(run.report).toMatch(/found in 0 answer\(s\) and 0 log line\(s\)/u);
    for (const text of [run.report, run.stdout, run.stderr]) {
      expect(text).not.toContain(FILE_CANARY);
    }
  }, 300_000);

  it('refuses at the start a file with a password the gate could not look for', async () => {
    const dir = await tempDir();
    const file = join(dir, 'accounts.csv');
    await writeFile(file, 'email,password\na@example.com,Zq7!x\n');
    const reports = await tempDir();
    const run = await runGate(['--fake', '--fake-accounts-file', file, '--report-dir', reports]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/shorter than 8 characters/u);
    expect((await readdir(reports)).filter((name) => name.endsWith('.md'))).toHaveLength(0);
  }, 60_000);
});
