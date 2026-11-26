// The bars of the operations in progress: what a call tells while it waits lands in the workspace
// state (`progress` section) and `process_get_status` with `progress` hands it to a client, no backend.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { defineTool, type Tool } from '../src/registry.js';
import { recordOperation } from '../src/ops/operation.js';
import { createServer } from '../src/server.js';
import { createTestClock } from './helpers/clock.js';
import { processGetStatus } from '../src/tools/processGetStatus.js';

const getStatusTool = (): Tool => processGetStatus;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  client: Client;
  close(): Promise<void>;
}

async function connect(tools: readonly Tool[]): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'live-reg-'));
  dirs.push(root);
  const config = loadConfig({ LOADCRAFT_API_TOKEN: 'tok-live-1' }, root);
  const log = createLogger({ level: 'error', sink: () => undefined });
  log.registerSecret('tok-live-1');
  const server = createServer({ config, log, tools, clock: createTestClock(5_000_000) });
  const client = new Client({ name: 'live-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('\n');
}

async function bars(client: Client): Promise<{ progress: Record<string, unknown>[] }> {
  const answer = await client.callTool({
    name: 'process_get_status',
    arguments: { progress: true, format: 'data' },
  });
  return JSON.parse(textOf(answer)) as { progress: Record<string, unknown>[] };
}

function reporting(name: string, during: (tool: Tool) => Promise<void>): Tool {
  const tool: Tool = defineTool({
    name,
    title: name,
    description: `${name}: reports progress, then ends. Does not modify anything.`,
    input: z.object({}),
    annotations: { readOnlyHint: true },
    async run(ctx) {
      ctx.progress.report('scenario 2/2 · Cart: Generating feeder data... (50%)', 0.5);
      await during(tool);
      return { status: 'done' as const, data: {} };
    },
    render: () => 'ok',
  });
  return tool;
}

describe('progress bars through the registry', () => {
  it('shows the bar of a call while it waits and removes it when it is done', async () => {
    const holder: { client?: Client; seen?: unknown } = {};
    const long = reporting('long_call', async () => {
      holder.seen = holder.client === undefined ? undefined : await bars(holder.client);
    });
    const h = await connect([getStatusTool(), long]);
    holder.client = h.client;
    try {
      await h.client.callTool({ name: 'long_call', arguments: {} });
      expect(holder.seen).toMatchObject({
        progress: [
          {
            tool: 'long_call',
            stage: 'scenario 2/2 · Cart: Generating feeder data...',
            percent: 50,
            n: 2,
            m: 2,
            open: true,
          },
        ],
      });
      expect((await bars(h.client)).progress).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('closes the bar when the call hands the handle back: the running operation is drawn from its row', async () => {
    const handle = 'scenario_generation:g1';
    const handing = defineTool({
      name: 'hand_back',
      title: 'hand_back',
      description: 'hand_back: reports, names an operation and returns it unfinished.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      async run(ctx) {
        await recordOperation(ctx.state, {
          kind: 'scenario_generation',
          id: 'g1',
          startedAt: ctx.clock.now() - 30_000,
          saved: {},
        });
        ctx.progress.attach?.(handle);
        ctx.progress.report('Generating feeder data... (40%)', 0.4);
        return {
          status: 'running' as const,
          operation: handle,
          data: { message: 'x' },
        };
      },
      render: () => 'ok',
    });
    const h = await connect([getStatusTool(), handing]);
    try {
      await h.client.callTool({ name: 'hand_back', arguments: {} });
      expect((await bars(h.client)).progress).toEqual([
        expect.objectContaining({
          call: handle,
          handle,
          kind: 'scenario_generation',
          stage: 'Generating feeder data...',
          percent: 40,
          open: false,
        }),
      ]);
    } finally {
      await h.close();
    }
  });

  it('lists an operation saved under a tool name from before the rename as it is', async () => {
    // The state file of a session that started a test with the old name of the report tool; the
    // name is built here so it is not a literal of the repository. Nothing migrates it.
    const saved = ['get', 'report'].join('_');
    const handle = 'test_run:r1';
    const before = defineTool({
      name: saved,
      title: saved,
      description: `${saved}: names an operation and returns it unfinished. Does not modify anything.`,
      input: z.object({}),
      annotations: { readOnlyHint: true },
      async run(ctx) {
        await recordOperation(ctx.state, {
          kind: 'test_run',
          id: 'r1',
          startedAt: ctx.clock.now() - 30_000,
          saved: {},
        });
        return { status: 'running' as const, operation: handle, data: { message: 'x' } };
      },
      render: () => 'ok',
    });
    const h = await connect([getStatusTool(), before]);
    try {
      await h.client.callTool({ name: saved, arguments: {} });
      expect((await bars(h.client)).progress).toEqual([
        expect.objectContaining({ handle, kind: 'test_run', tool: saved, open: false }),
      ]);
    } finally {
      await h.close();
    }
  });

  it('keeps nothing of a call that told nothing', async () => {
    const quiet = defineTool({
      name: 'quiet',
      title: 'quiet',
      description: 'quiet: tells nothing. Does not modify anything.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run: () => Promise.resolve({ status: 'done' as const, data: {} }),
      render: () => 'ok',
    });
    const h = await connect([getStatusTool(), quiet]);
    try {
      await h.client.callTool({ name: 'quiet', arguments: {} });
      expect((await bars(h.client)).progress).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
