// The values a tool gives for the templates of its log entry (`log.values`) are its explicit intent:
// they win over a field of the same name in the data of the result or in the arguments. A tool whose
// `log.values` and data disagree under one name is a mistake the tests make visible
// (`logValueCollisions`, asserted by the registry under tests).

import { describe, expect, it } from 'vitest';

import { buildLogEntry, logValueCollisions } from '../src/workspace/logEntry.js';

const secrets = { scrub: (text: string): string => text, scrubDeep: <T>(value: T): T => value };

function entry(data: Record<string, unknown>, values: Record<string, string | number>) {
  return buildLogEntry({
    tool: 'results_check_production',
    catalogTool: 'results_check_production',
    args: { run_id: 'e-1a2b3c4d' },
    end: { kind: 'done', data },
    startedAt: Date.parse('2026-11-26T10:00:00Z'),
    ms: 5,
    secrets,
    newId: () => '00000001',
    values,
  });
}

describe('log entry: log.values win over the data and the arguments', () => {
  it('a value of log.values fills the slot, not the data field of the same name', () => {
    const built = entry({ achieved: 98.765, verdict: 'raw' }, { achieved: '98.8', verdict: 'ok' });
    expect(built.result).toBe('load achieved: 98.8%; think time: ok');
  });

  it('a value of log.values fills an argument slot, not the argument of the same name', () => {
    const built = entry({ achieved: 1, verdict: 'ok' }, { run_id: 'e-9f8e7d6c' });
    expect(built.args).toBe('e-9f8e7d6c');
  });
});

describe('logValueCollisions: a slot of the result read two ways', () => {
  const TEMPLATE = 'load achieved: {achieved}%; think time: {verdict|state}';

  it('names a slot whose log value differs from the data field of the same name', () => {
    expect(
      logValueCollisions(TEMPLATE, { achieved: '98.8', verdict: 'ok' }, { achieved: 98.765 }),
    ).toEqual(['achieved']);
  });

  it('reads a nested data field and every alternative of a slot', () => {
    expect(logValueCollisions(TEMPLATE, { state: 'late' }, { think: { state: 'read' } })).toEqual([
      'state',
    ]);
  });

  it('a number shown with fewer digits is the same number', () => {
    expect(logValueCollisions('p95 {p95} ms', { p95: 410 }, { p95: 410.237 })).toEqual([]);
    expect(logValueCollisions('{rps} rps', { rps: 20.7 }, { rps: 20.684 })).toEqual([]);
    expect(logValueCollisions('p95 {p95} ms', { p95: 411 }, { p95: 410.237 })).toEqual(['p95']);
  });

  it('is empty for a name outside the template, an empty data value, or agreeing values', () => {
    expect(logValueCollisions('{lines} lines', { run_id: 'e-1' }, { run_id: 'uuid-1' })).toEqual(
      [],
    );
    expect(logValueCollisions('{lines} lines', { lines: 0 }, { lines: [] })).toEqual([]);
    expect(logValueCollisions('{names}', { names: 'a, b' }, { names: ['a', 'b'] })).toEqual([]);
    expect(logValueCollisions('{names}', undefined, { names: 'a' })).toEqual([]);
  });
});
