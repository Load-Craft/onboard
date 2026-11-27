// The project setting the gate switches on after it created its project (the probes, which a user
// turns on in the frontend), the line of the accounts in the report, and the data step. The fake
// backend creates every project with its probes off, as the real one does.

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { accountsLine, enableProbes, PROBES_NOTE } from '../scripts/live-gate.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'live-gate.ts');

function runGate(args: readonly string[]): Promise<{ code: number | null; out: string }> {
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
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.once('error', fail);
    child.once('exit', (code) => done({ code, out }));
  });
}

// Removed once the file is done: its gates run side by side, so no test may clean up for the others.
const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function gate(
  ...extra: string[]
): Promise<{ code: number | null; report: string; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'live-gate-probes-'));
  dirs.push(dir);
  const run = await runGate(['--fake', '--report-dir', dir, ...extra]);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files, run.out).toHaveLength(1);
  return {
    code: run.code,
    report: await readFile(join(dir, files[0] ?? ''), 'utf8'),
    out: run.out,
  };
}

type Call = { method: string; path: string; json?: unknown };

/** A backend stand-in for `enableProbes`: records the calls, answers like the real project routes. */
function stub(options: { name?: string; keep?: boolean } = {}) {
  const calls: Call[] = [];
  let probes = false;
  return {
    calls,
    api: {
      request: (method: string, path: string, json?: unknown) => {
        calls.push({ method, path, ...(json === undefined ? {} : { json }) });
        if (method === 'GET' && path === '/projects/p-1') {
          return Promise.resolve({ status: 200, body: { name: options.name ?? 'live-gate-1' } });
        }
        if (method === 'PUT') {
          if (options.keep !== true) probes = (json as { probes_enabled: boolean }).probes_enabled;
          return Promise.resolve({ status: 200, body: {} });
        }
        return Promise.resolve({ status: 200, body: { probes_enabled: probes } });
      },
    },
  };
}

describe('enableProbes', () => {
  it('puts probes_enabled for the gate project and reads it back', async () => {
    const backend = stub();
    expect(await enableProbes(backend.api, 'p-1', 'live-gate-1')).toEqual([]);
    expect(backend.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /projects/p-1',
      'PUT /projects/p-1/gatling/project',
      'GET /projects/p-1/gatling/project',
    ]);
    expect(backend.calls[1]?.json).toEqual({ probes_enabled: true });
  });

  it('changes nothing in a project the gate did not create', async () => {
    const backend = stub({ name: 'somebody-elses-project' });
    const problems = await enableProbes(backend.api, 'p-1', 'live-gate-1');
    expect(problems.join()).toMatch(/not the project this run created/u);
    expect(backend.calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('reports a PUT the backend answered but did not apply', async () => {
    const problems = await enableProbes(stub({ keep: true }).api, 'p-1', 'live-gate-1');
    expect(problems.join()).toMatch(/still shows probes_enabled=false/u);
  });
});

describe('accountsLine', () => {
  it('takes the number of accounts from the rows after the call', () => {
    expect(
      accountsLine({ slot: 'User accounts', have: null, need: 30 }, 'accounts', { have: 30 }),
    ).toMatch(/accounts created: 30$/u);
    expect(
      accountsLine({ slot: 'User accounts', have: 5, need: 30 }, 'accounts', { have: 35 }),
    ).toMatch(/accounts created: 30$/u);
  });

  it('claims no accounts when the slot did not grow', () => {
    expect(
      accountsLine({ slot: 'User accounts', have: null, need: 30 }, 'accounts', { have: null }),
    ).toMatch(/no account was added to the slot$/u);
  });
});

describe.concurrent('the gate against a backend whose project has the probes off', () => {
  it('switches them on after step 1, says so, and passes the data step', async () => {
    const { code, report, out } = await gate();
    expect(code, out).toBe(0);
    expect(report).toContain(PROBES_NOTE);
    expect(report).toContain(
      'the probes of the gate project are enabled (read back from the backend)',
    );
    expect(report).toMatch(/accounts created: 30/u);
    // The slot of plain data without rows is filled from its columns by the data_create_dataset
    // call the data plan names (card, then its token) and pinned by the data_set_bindings call its
    // result names; data_create_accounts is called only for the slot of accounts.
    expect(report).toMatch(
      /`data_create_dataset` \{"scenario":"[^"]+","slot":"scenario_auto_data","confirm":"[^"]+"\}/u,
    );
    expect(report).toContain(
      'data_create_dataset says: slot scenario_auto_data: dataset "scenario_auto_data data" made from its columns · rows: 100',
    );
    // Every call of data_create_dataset shows its own card: each one without a token is followed
    // by its repeat with a token (the gate exits 0 only when the check that the card came first passed).
    const calls = [...report.matchAll(/`data_create_dataset` \{[^\n]*\}/gu)].map(([call]) => call);
    const cards = calls.filter((call) => !call.includes('"confirm"'));
    expect(cards.length).toBeGreaterThan(0);
    expect(calls.filter((call) => call.includes('"confirm"'))).toHaveLength(cards.length);
    expect(report).toMatch(
      /`data_set_bindings` \{[^\n]*"scenario_auto_data":"scenario_auto_data data"/u,
    );
    // The self-check of a member scenario reads the member's own picks: the dataset is pinned there.
    expect(report).toMatch(/pinned in member scenarios:\s+1\b/u);
    expect(report).not.toMatch(/`data_create_accounts` \{[^\n]*"slot":"scenario_auto_data"/u);
    expect(report).not.toContain('slot_not_accounts');
  }, 300_000);

  it('fails at step 1 when the backend keeps the probes off', async () => {
    const { code, report } = await gate('--fake-fault', 'probes-ignored');
    expect(code).toBe(1);
    expect(report).toMatch(/Failed at step 1 `project_create`/u);
    expect(report).toMatch(/still shows probes_enabled=false/u);
    expect(report).not.toMatch(/accounts created/u);
  }, 300_000);

  it('stops at the data step on a slot of plain data nothing can fill, sending it to a file, not to a generation', async () => {
    const { code, report } = await gate('--fake-fault', 'data-no-source');
    expect(code).toBe(1);
    expect(report).toMatch(/Failed at step 8 `data_create_accounts`/u);
    // The gate no longer sends the slot of plain data to data_create_accounts (which refuses it):
    // it names the slot as plain data that the data_create_dataset calls of the plan left open.
    expect(report).not.toContain('slot_not_accounts');
    expect(report).not.toMatch(/`data_create_accounts` \{[^\n]*"slot":"scenario_auto_data"/u);
    expect(report).toMatch(/slot "[^"]+" of plain data/u);
    expect(report).toContain('fill it from a file');
  }, 300_000);

  it('writes no accounts line when the creation of accounts failed', async () => {
    const { code, report } = await gate('--fake-fault', 'provision-fails');
    expect(code).toBe(1);
    expect(report).toMatch(/Failed at step \d+ `data_create_accounts`/u);
    expect(report).not.toMatch(/accounts created/u);
  }, 300_000);
});
