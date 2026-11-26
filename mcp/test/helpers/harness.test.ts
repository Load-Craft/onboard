import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/log.js';
import { defineTool } from '../../src/registry.js';
import { assertNoCanary, CANARY } from './canary.js';
import { createTestClock } from './clock.js';
import { connect, CURRENT_REVISION, type Era } from './mcp.js';

const config = loadConfig({ LOADCRAFT_API_TOKEN: CANARY }, '/work/sklep');
const log = createLogger({ level: 'error', sink: () => undefined });

/** Probe server: one tool that emits three progress notifications, then returns. */
function progressServer(): McpServer {
  const server = new McpServer(
    { name: 'probe', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.registerTool(
    'probe_progress',
    { description: 'Emits three progress notifications.', inputSchema: z.object({}) },
    async (_args, ctx) => {
      const progressToken = ctx.mcpReq._meta?.progressToken;
      for (let i = 1; i <= 3; i += 1) {
        if (progressToken !== undefined) {
          await ctx.mcpReq.notify({
            method: 'notifications/progress',
            params: { progressToken, progress: i, total: 3, message: `step ${String(i)}` },
          });
        }
      }
      return { content: [{ type: 'text', text: 'finished' }] };
    },
  );
  return server;
}

describe.each<Era>(['current', 'legacy'])('connect (%s era)', (era) => {
  it('negotiates the revision that belongs to the era', async () => {
    const session = await connect(progressServer, { era });
    try {
      if (era === 'current') expect(session.protocolVersion).toBe(CURRENT_REVISION);
      else expect(session.protocolVersion < CURRENT_REVISION).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('returns the result and three progress entries in rising order', async () => {
    const session = await connect(progressServer, { era });
    try {
      const result = await session.call('probe_progress', {});
      expect(result.isError).toBe(false);
      expect(result.text).toBe('finished');
      expect(result.progress).toHaveLength(3);
      expect(result.progress.map((p) => p.progress)).toEqual([1, 2, 3]);
      expect(result.progress.map((p) => p.message)).toEqual(['step 1', 'step 2', 'step 3']);
      expect(result.progress[0]?.total).toBe(3);
      expect((await session.listTools()).map((t) => t.name)).toEqual(['probe_progress']);
    } finally {
      await session.close();
    }
  });

  it('returns the text without structured content, and the error flag of a registry tool', async () => {
    const tool = defineTool({
      name: 'echo_shop',
      title: 'Echo shop',
      description: 'Shop: echoes the shop name.',
      input: z.object({ shop: z.string() }),
      annotations: { readOnlyHint: true },
      run: (_ctx, args) => Promise.resolve({ status: 'done' as const, data: { shop: args.shop } }),
      render: (data) => `shop ${data.shop}`,
    });
    const session = await connect({ config, log, tools: [tool] }, { era });
    try {
      const ok = await session.call('echo_shop', { shop: 'sklep' });
      expect(ok.text).toBe('shop sklep');
      expect(ok.structured).toBeUndefined();
      const bad = await session.call('echo_shop', {});
      expect(bad.isError).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('lets the handler see an aborted signal when the caller aborts', async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    let seenAborted: boolean | undefined;
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    const waiting = defineTool({
      name: 'wait_for_abort',
      title: 'Wait for abort',
      description: 'Waits: blocks until the call is aborted.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      async run(ctx) {
        started();
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) resolve();
          else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        seenAborted = ctx.signal.aborted;
        settle();
        return { status: 'done' as const, data: {} };
      },
      render: () => 'aborted',
    });
    const session = await connect({ config, log, tools: [waiting] }, { era });
    try {
      const controller = new AbortController();
      const pending = session.call('wait_for_abort', {}, { signal: controller.signal });
      const outcome = pending.then(
        () => 'resolved',
        () => 'rejected',
      );
      await startedPromise;
      controller.abort();
      await settled;
      expect(seenAborted).toBe(true);
      expect(await outcome).toBe('rejected');
    } finally {
      await session.close();
    }
  });
});

describe('createTestClock', () => {
  it('lets a long continuation chain finish before the next sleeper wakes', async () => {
    const clock = createTestClock();
    const order: string[] = [];
    const first = (async () => {
      await clock.sleep(10);
      for (let i = 0; i < 50; i += 1) await Promise.resolve();
      order.push('first chain done');
      await clock.sleep(5);
      order.push('first second sleep');
    })();
    const second = clock.sleep(12).then(() => order.push('second woke'));
    await clock.advance(20);
    await Promise.all([first, second]);
    expect(order).toEqual(['first chain done', 'second woke', 'first second sleep']);
  });

  it('wakes sleeping promises in time order', async () => {
    const clock = createTestClock(1000);
    const woken: string[] = [];
    const slow = clock.sleep(200).then(() => woken.push('slow'));
    const fast = clock.sleep(50).then(() => woken.push('fast'));
    expect(clock.now()).toBe(1000);
    await clock.advance(300);
    await Promise.all([slow, fast]);
    expect(woken).toEqual(['fast', 'slow']);
    expect(clock.now()).toBe(1300);
  });

  it('does not wake a sleeper before its time', async () => {
    const clock = createTestClock();
    let done = false;
    void clock.sleep(100).then(() => (done = true));
    await clock.advance(99);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
  });
});

describe('assertNoCanary', () => {
  it('passes for clean values', () => {
    expect(() => assertNoCanary('plain', { a: [1, 'two'] }, Buffer.from('ok'))).not.toThrow();
  });

  it('throws for a canary nested in an object', () => {
    expect(() => assertNoCanary({ a: { b: [`x ${CANARY} y`] } })).toThrow(/canary/i);
  });

  it('throws for a base64-encoded canary', () => {
    const encoded = Buffer.from(CANARY).toString('base64');
    expect(() => assertNoCanary({ header: encoded })).toThrow(/canary/i);
  });

  it('throws for a url-encoded canary and a canary inside a buffer', () => {
    expect(() => assertNoCanary(encodeURIComponent(CANARY))).toThrow(/canary/i);
    expect(() => assertNoCanary(Buffer.from(`token=${CANARY}`))).toThrow(/canary/i);
  });
});
