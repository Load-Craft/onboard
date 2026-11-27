import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createProgress, type ProgressRequest } from '../src/ops/progress.js';
import { defineTool } from '../src/registry.js';
import { connect } from './helpers/mcp.js';
import { createTestClock } from './helpers/clock.js';

interface Sent {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

function fakeRequest(token: string | number | undefined): { req: ProgressRequest; sent: Sent[] } {
  const sent: Sent[] = [];
  const req: ProgressRequest = {
    ...(token === undefined ? {} : { _meta: { progressToken: token } }),
    notify(notification) {
      sent.push(notification.params);
      return Promise.resolve();
    },
  };
  return { req, sent };
}

describe('createProgress', () => {
  it('sends nothing without a progress token from the client', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(undefined);
    const progress = createProgress(req, clock);
    progress.report('one');
    await clock.advance(20_000);
    progress.stop();
    expect(sent).toEqual([]);
  });

  it('counts up by one per send and carries the message and token', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest('tok');
    const progress = createProgress(req, clock);
    progress.report('a');
    await clock.advance(1000);
    progress.report('b');
    await clock.advance(1000);
    progress.report('c');
    progress.stop();
    expect(sent).toEqual([
      { progressToken: 'tok', progress: 1, message: 'a' },
      { progressToken: 'tok', progress: 2, message: 'b' },
      { progressToken: 'tok', progress: 3, message: 'c' },
    ]);
  });

  it('maps fraction to a fine scale with total 1000000 and never goes backwards', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('x', 0.5);
    await clock.advance(1000);
    progress.report('y', 0.2);
    await clock.advance(1000);
    progress.report('z', 0.9);
    progress.stop();
    expect(sent.map((s) => s.progress)).toEqual([500_000, 500_001, 900_000]);
    expect(sent.map((s) => s.total)).toEqual([1_000_000, 1_000_000, 1_000_000]);
  });

  it('keeps strictly increasing progress when the next message has no fraction', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('x', 0.7);
    await clock.advance(1000);
    progress.report('y');
    progress.stop();
    expect(sent.map((s) => s.progress)).toEqual([700_000, 700_001]);
  });

  it('sends the first message at once and throttles ten calls within a second to at most two sends', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    for (let i = 0; i < 10; i += 1) {
      progress.report(`m${i}`);
      await clock.advance(90);
    }
    await clock.advance(1000);
    progress.stop();
    const first = sent[0];
    expect(first?.message).toBe('m0');
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.length).toBeLessThanOrEqual(2);
  });

  it('lets a skipped message be replaced: the latest pending one is the one sent', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('first');
    await clock.advance(100);
    progress.report('second');
    await clock.advance(100);
    progress.report('third');
    await clock.advance(1000);
    progress.stop();
    expect(sent.map((s) => s.message)).toEqual(['first', 'third']);
  });

  it('repeats the last message after 5 seconds of silence, again every 5 seconds', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('working');
    await clock.advance(4999);
    expect(sent).toHaveLength(1);
    await clock.advance(1);
    expect(sent).toHaveLength(2);
    await clock.advance(5000);
    expect(sent).toHaveLength(3);
    expect(sent.map((s) => s.message)).toEqual(['working', 'working', 'working']);
    expect(sent.map((s) => s.progress)).toEqual([1, 2, 3]);
    progress.stop();
  });

  it('keeps total and a strictly increasing progress below it over 200 keep-alives', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('long', 0.5);
    await clock.advance(200 * 5000);
    progress.stop();
    expect(sent).toHaveLength(201);
    for (const [i, entry] of sent.entries()) {
      expect(entry.total).toBe(1_000_000);
      expect(entry.progress).toBeLessThan(1_000_000);
      if (i > 0) expect(entry.progress).toBeGreaterThan(sent[i - 1]?.progress ?? Infinity);
    }
  });

  it('does not keep alive before the first report', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    await clock.advance(30_000);
    progress.stop();
    expect(sent).toEqual([]);
  });

  it('sends nothing after stop, neither pending messages nor keep-alives', async () => {
    const clock = createTestClock();
    const { req, sent } = fakeRequest(1);
    const progress = createProgress(req, clock);
    progress.report('a');
    progress.report('pending');
    progress.stop();
    await clock.advance(30_000);
    progress.report('late');
    await clock.advance(30_000);
    expect(sent.map((s) => s.message)).toEqual(['a']);
  });

  it('survives a failing notify', async () => {
    const clock = createTestClock();
    const req: ProgressRequest = {
      _meta: { progressToken: 1 },
      notify: () => Promise.reject(new Error('transport closed')),
    };
    const progress = createProgress(req, clock);
    progress.report('a');
    await clock.advance(6000);
    progress.stop();
  });
});

describe('progress through the registry and a real client', () => {
  async function run(era: 'current' | 'legacy'): Promise<void> {
    const clock = createTestClock();
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tool = defineTool({
      name: 'slow',
      title: 'Slow',
      description: 'Slow: reports progress.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      async run(ctx) {
        ctx.progress.report('start', 0.1);
        started();
        await gate;
        ctx.progress.report('too late');
        return { status: 'done' as const, data: {} };
      },
      render: () => 'ok',
    });
    const config = loadConfig({ LOADCRAFT_API_TOKEN: 'CANARY-SECRET-7f3a' }, '/work/sklep');
    const session = await connect(
      {
        config,
        log: createLogger({ level: 'error', sink: () => undefined }),
        tools: [tool],
        clock,
      },
      { era },
    );
    const pending = session.call('slow', {});
    await running;
    await clock.advance(5000);
    release();
    const result = await pending;
    await clock.advance(20_000);
    await session.close();
    expect(result.isError).toBe(false);
    expect(result.progress.map((p) => p.message)).toEqual(['start', 'start']);
    expect(result.progress[0]).toMatchObject({ progress: 100_000, total: 1_000_000 });
    expect(result.progress[1]?.progress).toBe(100_001);
  }

  it('delivers progress and keep-alive on the current revision', () => run('current'));
  it('delivers progress and keep-alive on the legacy revision', () => run('legacy'));
});
