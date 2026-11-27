// The checks of the live gate: a check that fails tells what the backend has, not only what was
// expected, so a failed self-check never reads like a passed one.

import { describe, expect, it } from 'vitest';

import { check, checkBackend, checkStatus, type StepRecord } from '../scripts/live-gate.js';

function step(): StepRecord {
  return {
    number: 1,
    name: 'n',
    tool: 't',
    status: 'passed',
    ms: 0,
    costUsd: null,
    calls: [],
    checks: [],
    differences: [],
  };
}

function failureOf(run: (record: StepRecord) => void): { message: string; shown: string } {
  const record = step();
  let message = '';
  try {
    run(record);
  } catch (error) {
    message = (error as Error).message;
  }
  return { message, shown: record.checks.at(-1)?.what ?? '' };
}

describe('the text of a failed check', () => {
  it('names the failed status of a self-check and not "passed" as its state', () => {
    const { message, shown } = failureOf((record) => {
      checkStatus(record, 'self-check of "Customer Registration Journey"', 'failed', 'passed');
    });
    expect(shown).toBe(message);
    expect(message).toContain('backend status is failed');
    expect(message).toContain('expected passed');
    expect(message).not.toMatch(/\bpassed \(backend/u);
  });

  it('keeps the text of a self-check that passed', () => {
    const record = step();
    checkStatus(record, 'self-check of "X"', 'passed', 'passed');
    expect(record.checks).toEqual([
      { ok: true, what: 'self-check of "X" passed (backend: passed)' },
    ]);
  });

  it('says that a run did not complete, with the status it has', () => {
    const { message } = failureOf((record) => {
      checkStatus(record, 'run r-1', 'running', 'completed');
    });
    expect(message).toBe('run r-1: backend status is running; expected completed');
    expect(message).not.toContain('completed (backend');
  });

  it('puts the backend value after the expectation in a failed backend check', () => {
    const { message } = failureOf((record) => {
      checkBackend(record, false, 'the run has an SLA verdict', 'null');
    });
    expect(message).toBe('expected the run has an SLA verdict; the backend has null');
  });

  it('keeps the expectation and the value of a backend check that passed', () => {
    const record = step();
    checkBackend(record, true, 'the run has an SLA verdict', '{"status":"passed"}');
    expect(record.checks[0]).toEqual({
      ok: true,
      what: 'the run has an SLA verdict (backend: {"status":"passed"})',
    });
  });

  it('a plain check still reports its one text', () => {
    const { message } = failureOf((record) => {
      check(record, false, 'the result names the plan');
    });
    expect(message).toBe('the result names the plan');
  });
});
