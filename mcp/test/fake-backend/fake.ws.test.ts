import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { LoadcraftApiError } from '../../src/http/apiError.js';
import { createLogger } from '../../src/log.js';
import { Secret } from '../../src/secret.js';
import { ChannelLost, ChannelUnavailable, openChannel } from '../../src/ws/channel.js';
import type { ChannelContext, ChannelHandle } from '../../src/ws/channel.js';
import type { Channel, ParsedFrame } from '../../src/ws/frames.js';
import type { ChannelParams } from '../../src/ws/url.js';
import { createTestClock, type TestClock } from '../helpers/clock.js';
import { startFake, type Fake } from './server.js';

let clock: TestClock;
let fake: Fake;

beforeEach(async () => {
  clock = createTestClock(Date.UTC(2026, 10, 22, 10));
  fake = await startFake({ clock, seed: 3 });
});

function ctx(): ChannelContext {
  return {
    config: { apiUrl: `${fake.url}/api/v1`, token: new Secret(fake.token) },
    log: createLogger({ level: 'error', sink: () => undefined }),
  };
}

function open<C extends Channel>(name: C, params: ChannelParams<C>): Promise<ChannelHandle<C>> {
  return openChannel(ctx(), { channel: name, params });
}

/** Reads frames until `count` arrived or the stream ended; settles on the clock-free event loop. */
async function take<C extends Channel>(
  handle: ChannelHandle<C>,
  count: number,
): Promise<ParsedFrame<C>[]> {
  const out: ParsedFrame<C>[] = [];
  const iterator = handle.frames[Symbol.asyncIterator]();
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done === true) break;
    out.push(next.value);
  }
  return out;
}

/** Whatever frames arrive within a short real-time window. */
async function drain<C extends Channel>(handle: ChannelHandle<C>): Promise<ParsedFrame<C>[]> {
  const out: ParsedFrame<C>[] = [];
  const iterator = handle.frames[Symbol.asyncIterator]();
  const stop = new Promise<'stop'>((resolve) => setTimeout(() => resolve('stop'), 100));
  for (;;) {
    const next = await Promise.race([iterator.next(), stop]);
    if (next === 'stop' || next.done === true) return out;
    out.push(next.value);
  }
}

function types(frames: readonly { type: string }[]): string[] {
  return frames.map((frame) => frame.type);
}

interface RawResult {
  readonly code: number;
  readonly reason: string;
  readonly messages: string[];
}

/** A raw client: lets a test leave out headers the plugin client always sends. */
function rawClient(
  path: string,
  headers: Record<string, string>,
  options: { origin?: string } = {},
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${fake.url.replace('http', 'ws')}${path}`, {
      headers,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    });
    const messages: string[] = [];
    ws.on('message', (data) => messages.push(Buffer.isBuffer(data) ? data.toString('utf8') : ''));
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8'), messages }));
    ws.on('error', reject);
  });
}

/** HTTP status of a handshake the server refuses before accepting (no close code exists then). */
function refusedStatus(
  path: string,
  headers: Record<string, string>,
  options: { origin?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${fake.url.replace('http', 'ws')}${path}`, {
      headers,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    });
    ws.on('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    ws.on('open', () => reject(new Error('the handshake was accepted')));
    ws.on('error', () => undefined);
  });
}

const BEARER = (): Record<string, string> => ({ authorization: `Bearer ${fake.token}` });

const PROPOSAL = {
  type: 'split_proposal',
  proposed_paths: [{ name: 'Checkout', steps: ['GET /api/orders'], depends_on_prior: false }],
} as const;

describe('fake backend WebSocket: refine', () => {
  it('sends the current state right after the connection opens', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    job.emit({
      type: 'flow-suggestions-refine:progress',
      payload: { job_id: 'job-1', status: 'running', progress: 40, step_label: 'Describing' },
    });
    const channel = await open('refine', { job_id: 'job-1' });
    const [first] = await take(channel, 1);
    expect(first).toMatchObject({
      type: 'flow-suggestions-refine:progress',
      data: { job_id: 'job-1', progress: 40 },
    });
    expect(job.connections).toBe(1);
    channel.close();
  });

  it('does not replay history: only the latest state reaches a late socket', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    const progress = (value: number) => ({
      type: 'flow-suggestions-refine:progress',
      payload: { job_id: 'job-1', status: 'running', progress: value },
    });
    job.emit(progress(10));
    job.emit(progress(70));
    const channel = await open('refine', { job_id: 'job-1' });
    const frames = await drain(channel);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ data: { progress: 70 } });
    channel.close();
  });

  it('cancels a job nobody connected to after 45 s of the test clock', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    await clock.advance(44_999);
    expect(job.status).toBe('running');
    await clock.advance(1);
    expect(job.status).toBe('cancelled');

    const channel = await open('refine', { job_id: 'job-1' });
    const [first] = await take(channel, 1);
    expect(first).toMatchObject({
      type: 'flow-suggestions-refine:cancelled',
      data: { job_id: 'job-1' },
    });
    channel.close();
  });

  it('does not cancel a job somebody is connected to', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    const channel = await open('refine', { job_id: 'job-1' });
    await clock.advance(120_000);
    expect(job.status).toBe('running');
    channel.close();
  });

  it('starts the 45 s countdown again when the last socket goes', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    const channel = await open('refine', { job_id: 'job-1' });
    await take(channel, 1);
    await clock.advance(30_000);
    channel.close();
    await vi.waitFor(() => expect(job.connections).toBe(0));
    await clock.advance(44_999);
    expect(job.status).toBe('running');
    await clock.advance(1);
    expect(job.status).toBe('cancelled');
  });

  it('answers an unknown job with an error frame and the close code 4404', async () => {
    const result = await rawClient('/ws/flow-suggestions-refine/nope', {});
    expect(result.code).toBe(4404);
    expect(JSON.parse(result.messages[0] ?? '{}')).toMatchObject({
      type: 'flow-suggestions-refine:error',
      payload: { job_id: 'nope', reason: 'job_not_found' },
    });
  });

  it('forgets a finished job 600 s after the end', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    job.emit({
      type: 'flow-suggestions-refine:complete',
      payload: { job_id: 'job-1', status: 'complete', result: {} },
    });
    expect(job.status).toBe('finished');
    await clock.advance(599_999);
    expect(job.status).toBe('finished');
    await clock.advance(1);
    expect(job.status).toBe('expired');
    const result = await rawClient('/ws/flow-suggestions-refine/job-1', {});
    expect(result.code).toBe(4404);
  });
});

describe('fake backend WebSocket: batch', () => {
  const basketProgress = (basket: string, progress: number) => ({
    type: 'batch-generation:basket-progress',
    payload: { basket_id: basket, progress },
  });

  it('runs without a listener and replays the last event of every basket in order', async () => {
    const run = fake.channel('batch', { run_id: 'run-1' });
    run.emit(basketProgress('b1', 10));
    run.emit(basketProgress('b2', 20));
    run.emit({
      type: 'batch-generation:basket-complete',
      payload: { basket_id: 'b1', flow_id: 'flow-1' },
    });
    expect(run.connections).toBe(0);

    const channel = await open('batch', { run_id: 'run-1' });
    const frames = await drain(channel);
    expect(types(frames)).toEqual([
      'batch-generation:basket-complete',
      'batch-generation:basket-progress',
    ]);
    expect(frames[1]).toMatchObject({ data: { basket_id: 'b2', progress: 20 } });

    run.emit({
      type: 'batch-generation:complete',
      payload: { success_count: 1, failed_count: 1 },
    });
    const late = await open('batch', { run_id: 'run-1' });
    expect(types(await drain(late))).toEqual([
      'batch-generation:basket-complete',
      'batch-generation:basket-progress',
      'batch-generation:complete',
    ]);
    channel.close();
    late.close();
  });

  it('forgets the run 600 s after it ended', async () => {
    const run = fake.channel('batch', { run_id: 'run-1' });
    run.emit({
      type: 'batch-generation:complete',
      payload: { success_count: 2, failed_count: 0 },
    });
    await clock.advance(600_000);
    expect(run.status).toBe('expired');
    const result = await rawClient('/ws/batch-generation/run-1', {});
    expect(result.code).toBe(4404);
    expect(JSON.parse(result.messages[0] ?? '{}')).toMatchObject({
      type: 'batch-generation:error',
      payload: { reason: 'run_not_found' },
    });
  });
});

describe('fake backend WebSocket: scenario and analysis', () => {
  it('scenario has no history: progress is lost, the terminal frame is handed over once', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    run.emit({ type: 'gatling-scenario:progress', payload: { progress: 37 } });
    run.emit({
      type: 'gatling-scenario:complete',
      payload: { run_id: 'run-1', scenario_id: 'sc-1' },
    });

    const first = await open('scenario', { run_id: 'run-1' });
    const frames = await drain(first);
    expect(types(frames)).toEqual(['gatling-scenario:complete']);
    expect(frames[0]).toMatchObject({ data: { scenario_id: 'sc-1' } });

    const second = await open('scenario', { run_id: 'run-1' });
    expect(await drain(second)).toEqual([]);
    first.close();
    second.close();
  });

  it('scenario streams live progress to a connected socket', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    const channel = await open('scenario', { run_id: 'run-1' });
    run.emit({ type: 'gatling-scenario:progress', payload: { progress: 12 } });
    const [frame] = await take(channel, 1);
    expect(frame).toMatchObject({ data: { progress: 12 } });
    channel.close();
  });

  it('analysis has no history at all', async () => {
    const run = fake.channel('analysis', { run_id: 'run-1' });
    run.emit({ type: 'gatling-analysis:progress', payload: { progress: 50 } });
    run.emit({ type: 'gatling-analysis:complete', payload: { run_id: 'run-1', analysis: {} } });
    const channel = await open('analysis', { run_id: 'run-1' });
    expect(await drain(channel)).toEqual([]);
    channel.close();
  });
});

describe('fake backend WebSocket: har', () => {
  it('refuses the handshake without Authorization (HTTP 403, before accept)', async () => {
    expect(await refusedStatus('/ws/projects/p1/har/s1', {})).toBe(403);
  });

  it('refuses the handshake with a wrong token', async () => {
    const status = await refusedStatus('/ws/projects/p1/har/s1', { authorization: 'Bearer other' });
    expect(status).toBe(403);
  });

  it('the plugin client reports a refused handshake as a forbidden LoadcraftApiError', async () => {
    const wrong: ChannelContext = {
      ...ctx(),
      config: { apiUrl: `${fake.url}/api/v1`, token: new Secret('not-the-fake-token') },
    };
    const failure = await openChannel(wrong, {
      channel: 'har',
      params: { project_id: 'p1', session_id: 's1' },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LoadcraftApiError);
    expect(failure).toMatchObject({ code: 'forbidden', status: 403 });
  });

  it('abandons the run when the socket goes while it waits for split_resume', async () => {
    const run = fake.channel('har', { project_id: 'p1', session_id: 's1' });
    const channel = await open('har', { project_id: 'p1', session_id: 's1' });
    run.emit(PROPOSAL);
    const [proposal] = await take(channel, 1);
    expect(proposal).toMatchObject({ type: 'split_proposal' });
    expect(run.status).toBe('running');
    channel.close();
    await vi.waitFor(() => expect(run.status).toBe('abandoned'));
  });

  it('keeps the run when the client answered the proposal before leaving', async () => {
    const run = fake.channel('har', { project_id: 'p1', session_id: 's1' });
    const channel = await open('har', { project_id: 'p1', session_id: 's1' });
    run.emit(PROPOSAL);
    await take(channel, 1);
    channel.send({
      type: 'split_resume',
      paths: [{ name: 'Checkout', steps: ['GET /api/orders'] }],
    });
    await vi.waitFor(() => expect(run.received).toHaveLength(1));
    expect(run.received[0]).toMatchObject({ type: 'split_resume' });
    channel.close();
    await vi.waitFor(() => expect(run.connections).toBe(0));
    expect(run.status).toBe('running');
  });

  it('records client messages', async () => {
    const run = fake.channel('har', { project_id: 'p1', session_id: 's1' });
    const channel = await open('har', { project_id: 'p1', session_id: 's1' });
    channel.send({ type: 'har:cancel' });
    await vi.waitFor(() => expect(run.received).toEqual([{ type: 'har:cancel' }]));
    channel.close();
  });
});

describe('fake backend WebSocket: describe', () => {
  const PATH = '/ws/projects/p1/scenario-from-description/runs/r1';

  it('refuses the handshake without Origin even with the token (HTTP 403)', async () => {
    fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    expect(await refusedStatus(PATH, BEARER())).toBe(403);
  });

  it('refuses an Origin of another host (HTTP 403)', async () => {
    fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    const status = await refusedStatus(PATH, BEARER(), { origin: 'http://elsewhere.example.com' });
    expect(status).toBe(403);
  });

  it('refuses the handshake without the token (HTTP 403)', async () => {
    fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    expect(await refusedStatus(PATH, {}, { origin: fake.url })).toBe(403);
  });

  it('refuses the handshake for an unknown run (HTTP 403)', async () => {
    expect(await refusedStatus(PATH, BEARER(), { origin: fake.url })).toBe(403);
  });

  it('accepts the handshake of a known run with the token and a matching Origin', async () => {
    const run = fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    const result = rawClient(PATH, BEARER(), { origin: fake.url });
    await vi.waitFor(() => expect(run.connections).toBe(1));
    run.close();
    expect((await result).code).toBe(1000);
  });

  it('sends the open split proposal and the drive snapshot to a new socket', async () => {
    const run = fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    run.emit(PROPOSAL);
    run.emit({
      type: 'drive_snapshot',
      setup: 'done',
      paths: [{ path_index: 0, name: 'Checkout', state: 'driving' }],
    });
    const channel = await open('describe', { project_id: 'p1', run_id: 'r1' });
    const frames = await take(channel, 2);
    expect(types(frames)).toEqual(['split_proposal', 'drive_snapshot']);
    channel.close();
  });

  it('keeps the pause when the socket goes: the next one is told the proposal again', async () => {
    const run = fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    run.emit(PROPOSAL);
    const first = await open('describe', { project_id: 'p1', run_id: 'r1' });
    await take(first, 1);
    first.close();
    await vi.waitFor(() => expect(run.connections).toBe(0));
    expect(run.status).toBe('running');

    const second = await open('describe', { project_id: 'p1', run_id: 'r1' });
    const [again] = await take(second, 1);
    expect(again).toMatchObject({ type: 'split_proposal' });
    second.close();
  });

  it('hands the terminal frame of a finished run to a late socket', async () => {
    const run = fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    run.emit({ type: 'complete', result: { scenario_ids: ['sc-1'] } });
    const channel = await open('describe', { project_id: 'p1', run_id: 'r1' });
    const [frame] = await take(channel, 1);
    expect(frame).toMatchObject({ type: 'complete' });
    channel.close();
  });
});

describe('fake backend WebSocket: contract of the frames', () => {
  it('records a frame type outside the contract as a violation and does not send it', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    const channel = await open('scenario', { run_id: 'run-1' });
    run.emit({ type: 'gatling-scenario:shiny-new', payload: { progress: 1 } });
    const violations = fake.takeViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('gatling-scenario:shiny-new');
    expect(await drain(channel)).toEqual([]);
    channel.close();
  });

  it('records a missing required key and a wrongly typed key', () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    run.emit({ type: 'gatling-scenario:progress', payload: { step_label: 'x' } });
    run.emit({ type: 'gatling-scenario:progress', payload: { progress: 'half' } });
    const violations = fake.takeViolations();
    expect(violations.map((violation) => violation.problems)).toEqual([
      ['payload.progress: required key is missing'],
      ['payload.progress: expected integer'],
    ]);
  });

  it('records a flat frame sent with an envelope and an enveloped one sent flat', () => {
    const describeRun = fake.channel('describe', { project_id: 'p1', run_id: 'r1' });
    describeRun.emit({ type: 'complete', payload: { result: {} } });
    const refine = fake.channel('refine', { job_id: 'job-1' });
    refine.emit({ type: 'flow-suggestions-refine:cancelled', job_id: 'job-1' });
    const messages = fake.takeViolations().map((violation) => violation.problems.join('; '));
    expect(messages[0]).toContain('payload');
    expect(messages[1]).toContain('payload: missing or not an object');
  });

  it('records a violation inside a nested item', () => {
    const run = fake.channel('har', { project_id: 'p1', session_id: 's1' });
    run.emit({ type: 'split_proposal', proposed_paths: [{ name: 'A' }] });
    expect(fake.takeViolations()[0]?.problems).toEqual([
      'proposed_paths[0].steps: required key is missing',
    ]);
  });

  it('fails the test at its end when a violation is left (close rejects)', async () => {
    const other = await startFake({ clock, scope: 'manual' });
    other.channel('analysis', { run_id: 'r' }).emit({ type: 'nope' });
    await expect(other.close()).rejects.toThrow(/ws analysis nope/);
  });
});

describe('fake backend WebSocket: faults', () => {
  it('blockWebSocket makes the client see ChannelUnavailable', async () => {
    fake.channel('scenario', { run_id: 'run-1' });
    fake.faults.blockWebSocket();
    await expect(open('scenario', { run_id: 'run-1' })).rejects.toBeInstanceOf(ChannelUnavailable);
    fake.faults.allowWebSocket();
    const channel = await open('scenario', { run_id: 'run-1' });
    channel.close();
  });

  it('dropChannel cuts the connection and the client sees ChannelLost', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    const channel = await open('scenario', { run_id: 'run-1' });
    const lost = take(channel, 1);
    fake.faults.dropChannel('scenario');
    await expect(lost).rejects.toBeInstanceOf(ChannelLost);
    await vi.waitFor(() => expect(run.connections).toBe(0));
  });

  it('dropChannel on har while a proposal waits abandons the run', async () => {
    const run = fake.channel('har', { project_id: 'p1', session_id: 's1' });
    const channel = await open('har', { project_id: 'p1', session_id: 's1' });
    run.emit(PROPOSAL);
    await take(channel, 1);
    const lost = take(channel, 1);
    fake.faults.dropChannel('har');
    await expect(lost).rejects.toBeInstanceOf(ChannelLost);
    await vi.waitFor(() => expect(run.status).toBe('abandoned'));
  });

  it('close(code) closes the sockets with that code', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    const channel = await open('scenario', { run_id: 'run-1' });
    run.close(4000);
    await expect(take(channel, 1)).rejects.toBeInstanceOf(ChannelLost);
    expect((await channel.closed).code).toBe(4000);
  });

  it('restart forgets the tasks: the refine job is unknown afterwards', async () => {
    const job = fake.channel('refine', { job_id: 'job-1' });
    fake.faults.restart();
    expect(job.status).toBe('expired');
    const result = await rawClient('/ws/flow-suggestions-refine/job-1', {});
    expect(result.code).toBe(4404);
  });

  it('rejects an upgrade to a path that is not a channel', async () => {
    await expect(rawClient('/ws/unknown/x', {})).rejects.toThrow(/404/);
  });
});

describe('fake backend WebSocket: jobs', () => {
  it('emits a frame when the test clock reaches the job step', async () => {
    const run = fake.channel('scenario', { run_id: 'run-1' });
    const job = fake.jobs.start('generate', {
      steps: [
        { afterMs: 0, state: 'running' },
        { afterMs: 5_000, state: 'done' },
      ],
    });
    run.attach(job, [
      { afterMs: 1_000, frame: { type: 'gatling-scenario:progress', payload: { progress: 25 } } },
      {
        afterMs: 5_000,
        frame: {
          type: 'gatling-scenario:complete',
          payload: { run_id: 'run-1', scenario_id: 'sc-1' },
        },
      },
    ]);
    const channel = await open('scenario', { run_id: 'run-1' });
    const received: ParsedFrame<'scenario'>[] = [];
    const reading = (async () => {
      for await (const frame of channel.frames) received.push(frame);
    })();
    await clock.advance(999);
    expect(received).toHaveLength(0);
    await clock.advance(1);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await clock.advance(4_000);
    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(types(received)).toEqual(['gatling-scenario:progress', 'gatling-scenario:complete']);
    channel.close();
    await reading;
  });

  it('does not emit once the job is forgotten by a backend restart', async () => {
    const run = fake.channel('analysis', { run_id: 'run-1' });
    const job = fake.jobs.start('analyze', {
      steps: [
        { afterMs: 0, state: 'running' },
        { afterMs: 2_000, state: 'done' },
      ],
    });
    run.attach(job, [
      { afterMs: 1_000, frame: { type: 'gatling-analysis:progress', payload: { progress: 10 } } },
    ]);
    const channel = await open('analysis', { run_id: 'run-1' });
    fake.jobs.clear();
    await clock.advance(2_000);
    expect(await drain(channel)).toEqual([]);
    channel.close();
  });
});
