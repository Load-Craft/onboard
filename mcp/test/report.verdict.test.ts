import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runVerdict, type VerdictInput, type VerdictState } from '../src/report/verdict.js';

interface Case {
  name: string;
  execution: VerdictInput;
  expect: { state: VerdictState; reasons: string[] };
}

const table = JSON.parse(
  readFileSync(new URL('./fixtures/verdict-cases.json', import.meta.url), 'utf8'),
) as { _source: { commit: string }; cases: Case[] };

const ALL_STATES: VerdictState[] = [
  'sla_passed',
  'sla_failed',
  'sla_not_judged',
  'invariants_violated',
  'completed_with_errors',
  'run_failed',
  'cancelled',
  'in_progress',
];

describe('runVerdict (table copied from the frontend rule)', () => {
  it('names the frontend commit the table comes from', () => {
    expect(table._source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(table.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(runVerdict(c.execution)).toEqual(c.expect);
  });

  it.each(ALL_STATES)('the table covers state %s', (state) => {
    expect(table.cases.some((c) => c.expect.state === state)).toBe(true);
  });
});

describe('runVerdict precedence', () => {
  const failedInvariant = {
    state: 'evaluated' as const,
    results: [{ name: 'x', status: 'evaluated' as const, passed: false }],
  };

  it('cancelled > run_failed > everything else is decided by status first', () => {
    expect(runVerdict({ status: 'cancelled', sla_verdict: { status: 'failed' } }).state).toBe(
      'cancelled',
    );
    expect(runVerdict({ status: 'failed', invariant_summary: failedInvariant }).state).toBe(
      'run_failed',
    );
  });

  it('sla_failed > invariants_violated > completed_with_errors > sla_passed', () => {
    const base = { status: 'completed' as const, result_has_errors: true };
    expect(runVerdict({ ...base, sla_verdict: { status: 'passed' } }).state).toBe(
      'completed_with_errors',
    );
    expect(
      runVerdict({ ...base, sla_verdict: { status: 'passed' }, invariant_summary: failedInvariant })
        .state,
    ).toBe('invariants_violated');
    expect(
      runVerdict({ ...base, sla_verdict: { status: 'failed' }, invariant_summary: failedInvariant })
        .state,
    ).toBe('sla_failed');
  });

  it('treats absent and null facts alike', () => {
    expect(runVerdict({ status: 'completed' })).toEqual(
      runVerdict({
        status: 'completed',
        run_exit_code: null,
        sla_verdict: null,
        invariant_summary: null,
        result_has_errors: null,
      }),
    );
  });
});
