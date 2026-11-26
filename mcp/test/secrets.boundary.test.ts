import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { createLogger } from '../src/log.js';
import { defineTool, type Tool } from '../src/registry.js';
import { createServer as createMcpServer } from '../src/server.js';
import { createStateCache } from '../src/workspace/cache.js';
import { assertNoCanary, CANARY } from './helpers/canary.js';
import { connect, type McpSession } from './helpers/mcp.js';

const TOKEN = 'TOKEN-api-91c0d2e7';
const noInput = z.object({});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface Rig {
  session: McpSession;
  lines: string[];
  workspace: string;
}

async function rig(tools: readonly Tool[], env: NodeJS.ProcessEnv = {}): Promise<Rig> {
  const workspace = mkdtempSync(join(tmpdir(), 'lc-secrets-'));
  const lines: string[] = [];
  const config = loadConfig({ LOADCRAFT_API_TOKEN: TOKEN, ...env }, workspace);
  const log = createLogger({ level: 'debug', sink: (line) => lines.push(line) });
  log.registerSecret(TOKEN);
  const session = await connect(() => createMcpServer({ config, log, tools }));
  cleanups.push(async () => {
    await session.close();
    rmSync(workspace, { recursive: true, force: true });
  });
  return { session, lines, workspace };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function leaks(value: unknown, secret: string): boolean {
  return JSON.stringify(value).includes(secret);
}

const leaky = defineTool({
  name: 'leak_six_ways',
  title: 'Leak',
  description: 'Probe: tries to expose a registered secret.',
  input: noInput,
  annotations: { readOnlyHint: true },
  async run(ctx) {
    ctx.secrets.add(CANARY);
    ctx.progress.report(`working with ${CANARY}`, 0.5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      status: 'done',
      data: { view: `view ${CANARY}`, field: CANARY, [`key-${CANARY}`]: 1, token: TOKEN },
      links: [
        { url: `https://app.example.com/x?k=${encodeURIComponent(CANARY)}`, labelKey: 'link.flow' },
      ],
    };
  },
  render: (data) => `text ${data.view} ${data.token}`,
});

/** The unfinished outcome is drawn by the registry: its progress, note and handle pass the scope too. */
const leakyPending = defineTool({
  name: 'leak_while_running',
  title: 'Leak running',
  description: 'Probe: exposes a registered secret in a running outcome.',
  input: noInput,
  annotations: { readOnlyHint: true },
  run(ctx) {
    ctx.secrets.add(CANARY);
    return Promise.resolve({
      status: 'running' as const,
      operation: `op-${CANARY}`,
      data: { message: `progress ${CANARY}`, note: `note ${TOKEN}` },
      links: [ctx.services.links.flow('sklep', CANARY)],
    });
  },
  render: () => '',
});

const failing = defineTool({
  name: 'fail_with_secret',
  title: 'Fail',
  description: 'Probe: throws an error that carries a registered secret.',
  input: noInput,
  annotations: { readOnlyHint: true },
  run(ctx) {
    ctx.secrets.add(CANARY);
    return Promise.reject(
      new ToolError('probe_failed', {
        message: `failed for ${CANARY}`,
        hint: `retry without ${CANARY}`,
        details: { password: CANARY },
      }),
    );
  },
  render: () => '',
});

describe('secret boundary', () => {
  it('masks the secret in text, data, link and progress of a result', async () => {
    const { session, lines } = await rig([leaky]);
    const result = await session.call('leak_six_ways', {});
    assertNoCanary(result, lines);
    expect(leaks(result, TOKEN)).toBe(false);
    expect(leaks(lines, TOKEN)).toBe(false);
    expect(result.text).toContain('[redacted]');
    expect(result.progress.length).toBeGreaterThan(0);
  });

  it('masks the secret in the progress, note, handle and link of a running outcome', async () => {
    const { session, lines } = await rig([leakyPending]);
    const result = await session.call('leak_while_running', {});
    assertNoCanary(result, lines);
    expect(leaks(result, TOKEN)).toBe(false);
    expect(result.text).toContain('progress [redacted]');
    expect(result.text).toContain('op-[redacted]');
  });

  it('masks the secret in the message, hint and details of a tool error', async () => {
    const { session, lines } = await rig([failing]);
    const result = await session.call('fail_with_secret', {});
    expect(result.isError).toBe(true);
    assertNoCanary(result, lines);
    expect(result.text).toContain('failed for [redacted]');
  });

  it('keeps the API token out of an error that quotes it', async () => {
    const quoting = defineTool({
      name: 'quote_token',
      title: 'Quote',
      description: 'Probe: error text quotes the API token.',
      input: noInput,
      annotations: { readOnlyHint: true },
      run: (ctx) =>
        Promise.reject(
          new ToolError('quoted', { message: `bad ${ctx.config.token.reveal()}`, hint: TOKEN }),
        ),
      render: () => '',
    });
    const { session } = await rig([quoting]);
    const result = await session.call('quote_token', {});
    expect(leaks(result, TOKEN)).toBe(false);
  });

  it('reports an unexpected throw generically, without the secret in result or log', async () => {
    const thrower = (name: string, make: (secret: string) => unknown): Tool =>
      defineTool({
        name,
        title: name,
        description: 'Probe: throws something that is not a ToolError.',
        input: noInput,
        annotations: {},
        run(ctx) {
          ctx.secrets.add(CANARY);
          const thrown = make(CANARY);
          return Promise.resolve().then(() => {
            throw thrown;
          });
        },
        render: () => '',
      });
    const tools = [
      thrower('throw_error', (s) => new Error(`boom ${s}`, { cause: new Error(`inner ${s}`) })),
      thrower('throw_string', (s) => `plain ${s}`),
    ];
    const { session, lines } = await rig(tools);
    for (const name of ['throw_error', 'throw_string']) {
      const result = await session.call(name, {});
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Unexpected internal error');
      assertNoCanary(result, lines);
    }
  });

  it('refuses to write a registered secret to the state file', async () => {
    const stored = defineTool({
      name: 'store_secret',
      title: 'Store',
      description: 'Probe: writes a registered secret to the state cache.',
      input: noInput,
      annotations: {},
      async run(ctx) {
        ctx.secrets.add(CANARY);
        const cache = createStateCache(ctx.config.workspaceRoot, {
          logger: ctx.log,
          secrets: ctx.secrets,
        });
        let code = 'stored';
        try {
          await cache.set('drafts', 'd1', { note: `value ${CANARY}` });
        } catch (error) {
          code = error instanceof ToolError ? error.code : 'other';
        }
        return { status: 'done' as const, data: { code } };
      },
      render: (data) => data.code,
    });
    const { session, workspace } = await rig([stored]);
    const result = await session.call('store_secret', {});
    expect(result.text).toBe('internal_secret_in_state');
    for (const file of filesUnder(workspace)) assertNoCanary(readFileSync(file, 'utf8'));
  });

  it('masks a secret that the backend answer carries into a view', async () => {
    const backend: Server = createServer((_req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify([{ id: 'p1', name: `shop ${CANARY}` }]));
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          backend.closeAllConnections();
          backend.close(() => resolve());
        }),
    );
    const origin = `http://127.0.0.1:${String((backend.address() as AddressInfo).port)}`;
    const relay = defineTool({
      name: 'relay_projects',
      title: 'Relay',
      description: 'Probe: renders a backend answer.',
      input: noInput,
      annotations: { readOnlyHint: true },
      async run(ctx) {
        ctx.secrets.add(CANARY);
        const { data } = await ctx.services.http.GET('/api/v1/projects');
        return { status: 'done' as const, data: { raw: JSON.stringify(data) } };
      },
      render: (data) => data.raw,
    });
    const { session, lines } = await rig([relay], { LOADCRAFT_URL: origin });
    const result = await session.call('relay_projects', {});
    expect(result.isError).toBe(false);
    expect(result.text).toContain('shop');
    assertNoCanary(result, lines);
  });
});
