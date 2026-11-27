import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { ALL_TOOLS } from '../src/tools/index.js';
import { VERSION } from '../src/version.js';
import { SKLEP_IDS } from './golden/index.js';
import { registerFlowRoutes } from './fake-backend/routes/flows.js';
import { registerLookupRoutes } from './fake-backend/routes/lookup.js';
import { registerStatusRoutes } from './fake-backend/routes/status.js';
import { seedSklep } from './fake-backend/worlds/sklep.js';
import { toolRig } from './helpers/rig.js';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'server.mjs');

function exitOf(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((done) => {
    child.once('exit', (code) => done(code));
  });
}

describe('the real tool set', () => {
  it('declares no output schema and answers without structured content', async () => {
    const rig = await toolRig({
      tools: ALL_TOOLS,
      world: (fake) => {
        registerLookupRoutes(fake);
        registerFlowRoutes(fake);
        registerStatusRoutes(fake);
        seedSklep(fake.store, { stage: 'executed' });
      },
      files: {
        'loadcraft/project.json': JSON.stringify({
          schema: 1,
          url: 'https://app.loadcraft.io',
          project: { id: SKLEP_IDS.project, name: 'sklep' },
        }),
      },
    });
    const tools = await rig.session.listTools();
    expect(tools.length).toBe(ALL_TOOLS.length);
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeUndefined();
    }
    const result = await rig.call('process_get_status', {});
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('Project');
    expect(result.structured).toBeUndefined();
    expect(result.outcome?.status).toBe('done');
  });
});

describe('max_wait_s of the real tool set', () => {
  it('is the same in every tool that has it: default 100, and the description names process_wait and the handle', () => {
    const withWait = ALL_TOOLS.filter(
      (tool) => 'max_wait_s' in z.toJSONSchema(tool.input).properties!,
    );
    expect(withWait.length).toBeGreaterThan(0);
    for (const tool of withWait) {
      const property = (z.toJSONSchema(tool.input).properties ?? {})['max_wait_s'] as {
        default?: number;
        description?: string;
      };
      expect(property.default, tool.name).toBe(100);
      expect(property.description, tool.name).toContain('at most 100');
      expect(property.description, tool.name).toContain('pass it to process_wait');
    }
  });
});

describe('dist/server.mjs', () => {
  it('lists tools over stdio through the SDK client', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      stderr: 'ignore',
    });
    const client = new Client({ name: 'dist-smoke', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(Array.isArray(listed.tools)).toBe(true);
      expect(listed.tools.length).toBeGreaterThan(0);
      // A result with structured content hides the text from the model, so none may declare one.
      for (const tool of listed.tools) expect(tool.outputSchema, tool.name).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 15_000);

  it('reports the package.json version in serverInfo', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST],
      stderr: 'ignore',
    });
    const client = new Client({ name: 'dist-smoke', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe(VERSION);
    } finally {
      await client.close();
    }
  }, 15_000);

  it('contains only the version number of package.json, not its scripts or dependencies', async () => {
    const text = await readFile(DIST, 'utf8');
    for (const marker of [
      'devDependencies',
      '"vitest"',
      '"esbuild"',
      'openapi-typescript',
      'check:dist',
    ]) {
      expect(text).not.toContain(marker);
    }
  });

  it('exits with code 0 within 2 s of stdin closing and writes only protocol frames to stdout', async () => {
    const child = spawn(process.execPath, [DIST], { stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    const exited = exitOf(child);

    const frames = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'dist-smoke-raw', version: '1.0.0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];
    for (const frame of frames) child.stdin.write(JSON.stringify(frame) + '\n');
    await new Promise((done) => setTimeout(done, 1000));

    const closedAt = Date.now();
    child.stdin.end();
    const code = await Promise.race([
      exited,
      new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), 2000)),
    ]);
    if (code === 'timeout') child.kill('SIGKILL');

    expect(code).toBe(0);
    expect(Date.now() - closedAt).toBeLessThan(2000);
    const lines = stdout.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
  }, 15_000);

  it('builds byte for byte the same file twice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lc-mcp-build-'));
    try {
      const a = join(dir, 'a', 'server.mjs');
      const b = join(dir, 'b', 'server.mjs');
      await run(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--out', a], { cwd: ROOT });
      await run(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--out', b], { cwd: ROOT });
      const [first, second] = await Promise.all([readFile(a), readFile(b)]);
      expect(first.length).toBeGreaterThan(1000);
      expect(first.equals(second)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
