// Vitest file (see status.spec.ts for the name). The gate every background read goes through.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createGate, READ_STALE_MS } from '../src/state/reader.js';
import { isFromThisMod } from '../src/state/signal.js';
import { INITIAL_STATE } from '../src/state/types.js';

const CALL = { kind: 'tool', tool: 'run_start' } as const;

describe('createGate', () => {
  it('lets one read run at a time', () => {
    const gate = createGate();
    const first = gate.begin(0, true);
    expect(first).toBeDefined();
    expect(gate.busy(1)).toBe(true);
    expect(gate.begin(1, true)).toBeUndefined();
    expect(gate.begin(2, false)).toBeUndefined();
    if (first !== undefined) gate.end(first);
    expect(gate.busy(3)).toBe(false);
    expect(gate.begin(3, true)).toBeDefined();
  });

  it('queues a refused read once, and says so when the running one ends', () => {
    const gate = createGate();
    const first = gate.begin(0, true);
    gate.begin(1, true);
    gate.begin(2, true);
    expect(first && gate.end(first)).toBe(true);
    const next = gate.begin(3, true);
    expect(next && gate.end(next)).toBe(false);
  });

  it('does not queue a read that asked not to be', () => {
    const gate = createGate();
    const first = gate.begin(0, true);
    gate.begin(1, false);
    expect(first && gate.end(first)).toBe(false);
  });

  it('notes the calls on the read in flight and counts all of them', () => {
    const gate = createGate();
    gate.note(CALL, 0);
    const ticket = gate.begin(1, true);
    gate.note(CALL, 2);
    gate.note(CALL, 3);
    expect(ticket?.signals.map((noted) => noted.at)).toEqual([2, 3]);
    expect(gate.calls()).toBe(3);
  });

  it('a read that never came back stops counting, and its answer is no longer the current one', () => {
    const gate = createGate();
    const old = gate.begin(0, true);
    expect(gate.busy(READ_STALE_MS - 1)).toBe(true);
    expect(gate.busy(READ_STALE_MS)).toBe(false);
    const fresh = gate.begin(READ_STALE_MS, true);
    expect(old && gate.isCurrent(old)).toBe(false);
    expect(fresh && gate.isCurrent(fresh)).toBe(true);
    // The old one ending frees nothing and queues nothing for the fresh one.
    expect(old && gate.end(old)).toBe(false);
    expect(gate.busy(READ_STALE_MS + 1)).toBe(true);
  });
});

describe('the listeners of a state change', () => {
  it('every listener hears each change, with the new state', () => {
    const gate = createGate();
    const heard: unknown[] = [];
    gate.onStateChange((state) => heard.push(['a', state.step]));
    gate.onStateChange((state) => heard.push(['b', state.step]));
    gate.changed({ ...INITIAL_STATE, step: 6 });
    expect(heard).toEqual([
      ['a', 6],
      ['b', 6],
    ]);
  });

  it('a listener that throws does not stop the others', () => {
    const gate = createGate();
    const heard: string[] = [];
    gate.onStateChange(() => {
      throw new Error('boom');
    });
    gate.onStateChange(() => heard.push('second'));
    expect(() => gate.changed(INITIAL_STATE)).not.toThrow();
    expect(heard).toEqual(['second']);
  });

  it('the hook, the status read and the poll write the state only through the one function that tells the listeners', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'register.ts'), 'utf8');
    expect(source.match(/\bupdate\(\$, session/g)).toHaveLength(1);
    expect(source).toMatch(/gate\.changed\(next\)/);
    expect(source.match(/\bwrite\(\$, gate,/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the state hook', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'register.ts'), 'utf8');

  it('skips a call raised by a plugin, and only observes: a failure in it passes the tool on', () => {
    expect(source).toMatch(/if \(isFromThisMod\(next\.origin\)\) return result;/);
    expect(source).toMatch(/\}\)\.catch\(\(\$, e, next\) => next\(e\)\);/);
  });
});

describe('isFromThisMod', () => {
  it('is false for the engine (a call of the model) and for anything unknown or malformed', () => {
    expect(isFromThisMod({ plugin: 'engine', tier: 'core' })).toBe(false);
    for (const odd of [undefined, null, 'loadcraft', 5, {}, { plugin: 5 }, { name: 'loadcraft' }]) {
      expect(isFromThisMod(odd)).toBe(false);
    }
  });

  it('is false for another plugin, whatever its name resembles', () => {
    expect(isFromThisMod({ plugin: 'other', tier: 'prepend' })).toBe(false);
    expect(isFromThisMod({ plugin: 'loadcraft-extra', tier: 'user' })).toBe(false);
    expect(isFromThisMod({ plugin: 'myloadcraft', tier: 'user' })).toBe(false);
  });

  it('is true only when the origin names this mod', () => {
    for (const plugin of ['loadcraft', 'loadcraft@inline', 'loadcraft#2']) {
      expect(isFromThisMod({ plugin, tier: 'user' })).toBe(true);
    }
  });
});
