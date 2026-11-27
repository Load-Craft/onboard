// Vitest file (see status.spec.ts for the name). The poller is pure: it decides, the hook acts.
import { describe, expect, it } from 'vitest';

import { createPoller, MAX_FAILURES, POLL_MS } from '../src/poll.js';

const H = 'test_run:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const OTHER = 'test_run:77777777-6b7d-4e21-a8f3-0c5d9e7b1a42';

const running = (elapsed = 400, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  operation: H,
  kind: 'test_run',
  phase: 'running',
  elapsed_s: elapsed + 5,
  load_elapsed_s: elapsed,
  planned_s: 600,
  live: { rps: 690, p95_ms: 910, error_pct: 0.6 },
  ...extra,
});

describe('createPoller', () => {
  it('polls every few seconds, not faster than the numbers move', () => {
    expect(POLL_MS).toBeGreaterThanOrEqual(5000);
    expect(POLL_MS).toBeLessThanOrEqual(10_000);
  });

  it('reads nothing while no operation is in progress', () => {
    const poller = createPoller('pl');
    for (let tick = 0; tick < 20; tick += 1) expect(poller.tick(undefined, false)).toEqual({});
  });

  it('asks for one read of the operation', () => {
    const poller = createPoller('pl');
    expect(poller.tick(H, false)).toEqual({ read: H });
  });

  it('asks for no read while the gate says one is running', () => {
    const poller = createPoller('pl');
    expect(poller.tick(H, true)).toEqual({});
    expect(poller.tick(H, true)).toEqual({});
    expect(poller.tick(H, false).read).toBe(H);
  });

  it('draws the line only when its text changed', () => {
    const poller = createPoller('pl');
    poller.tick(H, false);
    const first = poller.settle(H, running(400), 0);
    expect(first.line).toBe(
      'LoadCraft · test 6:40 / 10:00 · 690 żądań/s · p95≈ 910 ms · błędy 0,6%',
    );
    poller.tick(H, false);
    expect(poller.settle(H, running(400), 0).line).toBeUndefined();
    poller.tick(H, false);
    expect(poller.settle(H, running(405), 0).line).toContain('test 6:45 / 10:00');
  });

  it('hands back the snapshot, for the state to take', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    expect(poller.settle(H, running(), 0).snapshot).toMatchObject({
      operation: H,
      phase: 'running',
    });
  });

  it('notifies once when the test ends, clears the line, and reads no more', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    poller.tick(H, false);
    const end = poller.settle(H, running(600, { phase: 'completed' }), 0);
    expect(end.notice?.kind).toBe('done');
    expect(end.line).toBeNull();
    // The state still names the operation for a while: nothing is read, nothing is said again.
    for (let tick = 0; tick < 10; tick += 1) expect(poller.tick(H, false)).toEqual({});
  });

  it('does not repeat the notice when the same end is read again', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    poller.tick(H, false);
    expect(poller.settle(H, running(600, { phase: 'failed' }), 0).notice?.kind).toBe('failed');
    expect(poller.settle(H, running(600, { phase: 'failed' }), 0).notice).toBeUndefined();
  });

  it('tells a request of the user once per episode, until someone reacts', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    const kinds: (string | undefined)[] = [];
    // 20 reads, the request comes and goes at every read, and no tool is called meanwhile.
    for (let read = 0; read < 20; read += 1) {
      poller.tick(H, false);
      const needs = read % 2 === 0 ? { needs_user: 'Log in' } : {};
      kinds.push(poller.settle(H, running(410, needs), 0).notice?.kind);
    }
    expect(kinds.filter((kind) => kind === 'needs_user')).toHaveLength(1);
  });

  it('tells it again after a call of a LoadCraft tool that came after the notice', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    poller.tick(H, false);
    expect(poller.settle(H, running(410, { needs_user: 'Log in' }), 3).notice?.kind).toBe(
      'needs_user',
    );
    poller.tick(H, false);
    expect(poller.settle(H, running(415), 3).notice).toBeUndefined();
    // The same number of calls: no reaction yet.
    poller.tick(H, false);
    expect(poller.settle(H, running(420, { needs_user: 'Log in' }), 3).notice).toBeUndefined();
    poller.tick(H, false);
    poller.settle(H, running(425), 4);
    poller.tick(H, false);
    expect(poller.settle(H, running(430, { needs_user: 'Solve it' }), 4).notice?.kind).toBe(
      'needs_user',
    );
  });

  it('a read that fails changes nothing and is tried again after a pause that grows', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    const reads: number[] = [];
    for (let tick = 1; tick <= 60 && reads.length < MAX_FAILURES - 1; tick += 1) {
      if (poller.tick(H, false).read !== undefined) {
        reads.push(tick);
        expect(poller.settle(H, undefined, 0)).toEqual({});
      }
    }
    // Each read comes after a longer gap than the one before.
    const gaps = reads.slice(1).map((at, index) => at - (reads[index] ?? 0));
    expect(reads.length).toBeGreaterThan(2);
    for (let i = 1; i < gaps.length; i += 1) expect(gaps[i]).toBeGreaterThan(gaps[i - 1] ?? 0);
  });

  it('a success ends the pause', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, undefined, 0);
    let at = 0;
    while (poller.tick(H, false).read === undefined) {
      at += 1;
      expect(at).toBeLessThan(50);
    }
    poller.settle(H, running(), 0);
    expect(poller.tick(H, false).read).toBe(H);
  });

  it('gives up on an operation whose reads keep failing, and clears the line', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    let failures = 0;
    let reads = 0;
    for (let tick = 0; tick < 500; tick += 1) {
      if (poller.tick(H, false).read === undefined) continue;
      reads += 1;
      const settled = poller.settle(H, undefined, 0);
      failures += 1;
      if (failures >= MAX_FAILURES) {
        expect(settled.line).toBeNull();
        expect(settled.lost).toBe(H);
        expect(settled.notice?.kind).toBe('lost');
        break;
      }
      expect(settled.lost).toBeUndefined();
      expect(settled.notice).toBeUndefined();
    }
    expect(reads).toBe(MAX_FAILURES);
    for (let tick = 0; tick < 500; tick += 1) expect(poller.tick(H, false).read).toBeUndefined();
  });

  it('an answer about another operation is a failed read', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    expect(poller.settle(H, { ...running(), operation: OTHER }, 0)).toEqual({});
  });

  it('clears the line when the operation leaves the state, and says nothing about a test', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(), 0);
    const gone = poller.tick(undefined, false);
    expect(gone.line).toBeNull();
    expect(gone.notice).toBeUndefined();
    expect(poller.tick(undefined, false)).toEqual({});
  });

  it('says that an operation of a kind without phases ended when it leaves the state', () => {
    const poller = createPoller('pl');
    const handle = 'scenario_generation:s1';
    poller.tick(handle, false);
    poller.settle(handle, { operation: handle, kind: 'scenario_generation', elapsed_s: 40 }, 0);
    const gone = poller.tick(undefined, false);
    expect(gone.notice).toEqual({
      kind: 'done',
      text: 'Operacja zakończona: generowanie scenariuszy',
    });
    expect(poller.tick(undefined, false)).toEqual({});
  });

  it('follows the next operation from the start', () => {
    const poller = createPoller('en');
    poller.tick(H, false);
    poller.settle(H, running(600, { phase: 'completed' }), 0);
    expect(poller.tick(OTHER, false).read).toBe(OTHER);
    const next = poller.settle(OTHER, running(10, { operation: OTHER }), 0);
    expect(next.line).toContain('test 0:10');
    expect(next.notice).toBeUndefined();
  });
});
