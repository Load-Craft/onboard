// `--run` of the stand-alone fake as a process (`scripts/fake-backend.mjs`): the flag reaches the
// runs started on it, and a value that is not a mode is refused before anything starts.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SKLEP_WORLD_IDS } from './fake-backend/worlds/sklep.js';

const SCRIPT = join(resolve(import.meta.dirname, '..'), 'scripts', 'fake-backend.mjs');
const TOKEN = 'CANARY-SECRET-7f3a';

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolvePort(port);
      });
    });
  });
}

async function startFake(args: readonly string[]): Promise<{ child: ChildProcess; base: string }> {
  // The port was free a moment ago: another process on a busy machine may take it before the fake
  // binds it, and the fake then exits at once with EADDRINUSE. That is the one failure retried.
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [SCRIPT, '--stage', 'data', '--port', String(port), '--speed', '20000', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    try {
      await new Promise<void>((resolveReady, reject) => {
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
          if (stderr.includes('token')) resolveReady();
        });
        child.once('exit', (code) => {
          reject(new Error(`fake exited with ${String(code)}: ${stderr}`));
        });
      });
    } catch (error) {
      if (attempt < 5 && stderr.includes('EADDRINUSE')) continue;
      throw error;
    }
    return { child, base: `http://127.0.0.1:${String(port)}` };
  }
}

/** Starts a run with these thresholds and returns the SLA verdict it ends with. */
async function verdictOf(args: readonly string[]): Promise<string | undefined> {
  const { child, base } = await startFake(args);
  try {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const path = `${base}/api/v1/projects/${SKLEP_WORLD_IDS.project}/gatling/executions`;
    const started = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scenario_id: SKLEP_WORLD_IDS.scenarios.przegladanie,
        environment_id: SKLEP_WORLD_IDS.environments.perf,
        workload: {
          type: 'ramp_concurrency',
          vusers: 100,
          ramp: 120,
          thresholds: [
            { type: 'responseTime', percentile: 95, max_ms: 400 },
            { type: 'failedRequests', max_percent: 1 },
          ],
        },
      }),
    });
    expect(started.status).toBe(200);
    const { id } = (await started.json()) as { id: string };
    // The run ends on the fake's own clock; the loop waits for that, and the end of the wait is only a guard.
    const giveUp = Date.now() + 25_000;
    while (Date.now() < giveUp) {
      const row = (await (await fetch(`${path}/${id}`, { headers })).json()) as {
        status: string;
        sla_verdict?: { status?: string } | null;
      };
      if (row.status === 'completed') return row.sla_verdict?.status;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error('the run did not complete');
  } finally {
    child.kill('SIGTERM');
  }
}

describe('fake-backend.mjs --run', () => {
  it('pass ends a started run as passed', async () => {
    expect(await verdictOf(['--run', 'pass'])).toBe('passed');
  }, 30_000);

  it('fail ends a started run as failed', async () => {
    expect(await verdictOf(['--run', 'fail'])).toBe('failed');
  }, 30_000);

  it('refuses a value that is not a mode and names the modes', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--run', 'maybe', '--port', '1'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--run must be one of: none, pass, fail');
    expect(result.stderr).toContain('"maybe"');
  }, 30_000);

  it('says the mode on start', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [SCRIPT, '--port', String(port), '--run', 'pass'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const stderr = await new Promise<string>((resolveText, reject) => {
        let text = '';
        child.stderr.on('data', (chunk: Buffer) => {
          text += chunk.toString();
          if (text.includes('token')) resolveText(text);
        });
        child.once('exit', () => {
          reject(new Error(`fake exited: ${text}`));
        });
      });
      expect(stderr).toContain('runs pass');
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
