// The synthetic customer repository `evals/fixtures/sklep` and the stand-alone fake backend
// (`scripts/fake-backend.mjs`): what an agent finds in the repository, and a fake that runs as a
// process of its own.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CANARY } from './helpers/canary.js';

const REPO = resolve(import.meta.dirname, '..', '..');
const FIXTURE = join(REPO, 'evals', 'fixtures', 'sklep');
const VALIDATOR = join(REPO, 'skills', 'loadcraft-openapi', 'scripts', 'validate_openapi.mjs');
const FAKE_SCRIPT = join(REPO, 'mcp', 'scripts', 'fake-backend.mjs');

/** Every file of the fixture, relative to its root. */
function files(dir = FIXTURE, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    return statSync(full).isDirectory() ? files(full, rel) : [rel];
  });
}

const read = (rel: string): string => readFileSync(join(FIXTURE, rel), 'utf8');

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

describe('fixture repository sklep', () => {
  it('has a loadcraft/openapi.json that passes the skill validator', () => {
    const result = spawnSync(
      process.execPath,
      [VALIDATOR, '--strict', join(FIXTURE, 'loadcraft', 'openapi.json')],
      {
        encoding: 'utf8',
      },
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const document = JSON.parse(read('loadcraft/openapi.json')) as {
      info: { 'x-loadcraft-source'?: { commit?: string } };
      paths: Record<string, unknown>;
    };
    expect(document.info['x-loadcraft-source']?.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/api/orders', '/api/cart', '/api/checkout']),
    );
  });

  it('serves 6 to 8 routes and keeps the planted bug in src/checkout/pay.ts', () => {
    const routes = [
      ...read('src/server.ts').matchAll(/route\('(GET|POST|PUT|DELETE)', '([^']+)'/g),
    ];
    expect(routes.length).toBeGreaterThanOrEqual(6);
    expect(routes.length).toBeLessThanOrEqual(8);
    const pay = read('src/checkout/pay.ts');
    expect(pay).toMatch(/transaction\([\s\S]*chargeCard\(/);
  });

  it('has env files with the test account and the canary as its password', () => {
    for (const name of ['.env.perf', '.env.qa']) {
      const text = read(name);
      expect(text, name).toMatch(/^TEST_USER_EMAIL=user@example\.com$/m);
      expect(text, name).toMatch(/^TEST_USER_PASSWORD=.+$/m);
      expect(text, name).toContain(`TEST_USER_PASSWORD=${CANARY}`);
      expect(text, name).toMatch(/^API_URL=https:\/\/api\.(perf|qa)\.example\.com$/m);
    }
  });

  it('has address-only env files for dev and prod, all of them ignored by the fixture', () => {
    for (const [name, api] of [
      ['.env.dev', 'api.dev.example.com'],
      ['.env.prod', 'api.example.com'],
    ] as const) {
      const text = read(name);
      expect(text, name).toMatch(
        new RegExp(`^API_URL=https://${api.replaceAll('.', '\\.')}$`, 'm'),
      );
      expect(text, name).not.toMatch(/TEST_USER/u);
    }
    expect(read('.gitignore')).toMatch(/^\.env\.\*$/m);
  });

  it('keeps the canary only in the env files', () => {
    for (const rel of files()) {
      if (rel.startsWith('.env.')) continue;
      expect(read(rel), rel).not.toContain(CANARY);
    }
  });

  it('has a deploy table naming the four environments', () => {
    const text = read('deploy/versions.yaml');
    for (const environment of ['perf', 'qa', 'dev', 'prod']) {
      expect(text).toMatch(new RegExp(`^  ${environment}:`, 'm'));
    }
  });

  it('declares the sklep-logs server in .mcp.json', () => {
    const config = JSON.parse(read('.mcp.json')) as {
      mcpServers: Record<string, { type?: string; url?: string }>;
    };
    const server = config.mcpServers['sklep-logs'];
    expect(server?.type).toBe('http');
    expect(server?.url).toMatch(/^https:\/\/[a-z.-]+\.example\.com\//);
  });

  it('has a HAR that parses and keeps response bodies', () => {
    const har = JSON.parse(read('nagrania/sesja.har')) as {
      log: {
        entries: {
          request: { url: string };
          response: { content: { text?: string } };
        }[];
      };
    };
    expect(har.log.entries.length).toBeGreaterThanOrEqual(4);
    for (const entry of har.log.entries) {
      expect(entry.response.content.text ?? '', entry.request.url).not.toBe('');
    }
  });

  it('contains no domain outside example.com', () => {
    for (const rel of files()) {
      const text = read(rel);
      const hosts = [...text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1] ?? '');
      for (const host of hosts) {
        expect(host, rel).toMatch(/(^|\.)example\.com$/);
      }
      const emails = [...text.matchAll(/[\w.+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1]);
      for (const domain of emails) expect(domain, rel).toBe('example.com');
    }
  });

  it('is not a git repository inside this tree and init-fixture.sh builds the history', () => {
    expect(existsSync(join(FIXTURE, '.git'))).toBe(false);
    const target = mkdtempSync(join(tmpdir(), 'sklep-'));
    try {
      const init = spawnSync('bash', [join(FIXTURE, 'init-fixture.sh'), target], {
        encoding: 'utf8',
      });
      expect(init.stderr).toBe('');
      expect(init.status).toBe(0);
      const git = (...args: string[]): string =>
        spawnSync('git', ['-C', target, ...args], { encoding: 'utf8' }).stdout.trim();
      expect(git('status', '--porcelain')).toBe('');
      // The env files are in the copy, not in its history.
      expect(existsSync(join(target, '.env.prod'))).toBe(true);
      expect(git('ls-files')).not.toMatch(/\.env\./u);
      expect(git('tag', '--list').split('\n')).toEqual(
        expect.arrayContaining(['v2.13.2', 'v2.14.0']),
      );
      expect(git('rev-list', '--count', 'v2.14.0..develop')).toBe('12');
      expect(git('rev-list', '--count', 'v2.14.0..dev')).toBe('31');
      const stamp = (
        JSON.parse(readFileSync(join(target, 'loadcraft', 'openapi.json'), 'utf8')) as {
          info: { 'x-loadcraft-source': { commit: string } };
        }
      ).info['x-loadcraft-source'].commit;
      expect(git('cat-file', '-t', stamp)).toBe('commit');
      expect(git('rev-parse', 'HEAD')).toBe(git('rev-parse', 'v2.14.0'));
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('stand-alone fake backend', () => {
  it('starts on the given port, prints address and token, answers /api/v1/meta', async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [FAKE_SCRIPT, '--stage', 'empty', '--port', String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const ready = new Promise<void>((resolveReady, reject) => {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes('token')) resolveReady();
      });
      child.once('exit', (code) => {
        reject(new Error(`fake exited with ${String(code)}: ${stderr}`));
      });
    });
    try {
      await ready;
      expect(stderr).toContain(`http://127.0.0.1:${String(port)}`);
      expect(stdout).toBe('');
      const response = await fetch(`http://127.0.0.1:${String(port)}/api/v1/meta`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ api_revision: expect.any(Number) as number });
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);

  it('refuses an unknown stage and lists the allowed ones', () => {
    const result = spawnSync(process.execPath, [FAKE_SCRIPT, '--stage', 'nope', '--port', '1'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown --stage "nope"');
    expect(result.stderr).toContain('empty, project, flows, scenario, data, executed');
  }, 30_000);
});
