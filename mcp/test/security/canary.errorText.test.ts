// Sentinel suite, part 3 (cases and what is fed in: canaryCases.ts): the text of an error that holds
// a secret nobody registered, a secret in a field of the error and the quote limit inside a secret.

import { describe, expect, it, vi } from 'vitest';

import { BARE_MARKER } from '../fake-backend/faults.js';
import { assertNoCanary, CANARY_PREFIX_LENGTH, TOKEN_CANARY } from '../helpers/canary.js';
import { CASES, CODE_LINE, callUnderTest, runBefore, start } from './canaryCases.js';

vi.setConfig({ testTimeout: 120_000 });

// A secret the plugin never saw and that no field names (a stack trace that prints a connection
// string) cannot be recognised in a text. The text of a 500 and of a 401 is not shown to the model at
// all: the result, its progress and its data carry the code and the status only. The text goes to the
// log, where no one can mask what is unknown (see `the log of a 500`).
describe.each(CASES)('sentinel: $tool ($label), a bare secret in a 5xx or 401', (item) => {
  it.each([500, 502, 401])('keeps the text of an error %i away from the model', async (status) => {
    const { r, proxy, drive } = await start(item);
    const before = await runBefore(item, drive, proxy);
    proxy.failWith(status, { ...item.failOptions, bareSecret: true });
    const calls = await callUnderTest(item, drive, before);
    const last = calls[calls.length - 1];
    if (last?.isError === true) expect(last.text).toMatch(CODE_LINE);
    // What the model receives: text, progress, structured data. The log is judged on its own.
    const received = r.results.map((result) =>
      Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'outcome')),
    );
    assertNoCanary(received, [], []);
    expect(JSON.stringify(received)).not.toContain(BARE_MARKER);
    r.forgetLogs();
  });
});

describe('sentinel: the log of a 500', () => {
  it('holds the text of the error, cut short, and the model does not see it', async () => {
    const item = CASES[0];
    if (item === undefined) throw new Error('no cases');
    const { r, proxy, drive } = await start(item);
    proxy.failWith(500, { ...item.failOptions, bareSecret: true });
    const calls = await callUnderTest(item, drive, {});
    const last = calls[calls.length - 1];
    expect(last?.isError, last?.text).toBe(true);
    expect(last?.text).not.toContain(BARE_MARKER);
    const records = r.logRecords('warn').filter((record) => record.msg === 'backend error text');
    expect(records.length).toBeGreaterThan(0);
    expect(JSON.stringify(records[0])).toContain(BARE_MARKER);
    expect(String(records[0]?.text).length).toBeLessThanOrEqual(501);
    r.forgetLogs();
  });
});

describe.each(CASES)('sentinel: $tool ($label), a secret in a field of the error', (item) => {
  it.each([422, 409])(
    'hides a backend secret an error %i names in a field of a secret name and quotes',
    async (status) => {
      const { r, proxy, drive } = await start(item);
      const before = await runBefore(item, drive, proxy);
      proxy.failWith(status, { ...item.failOptions, secretField: true });
      const calls = await callUnderTest(item, drive, before);
      const last = calls[calls.length - 1];
      if (last?.isError === true) expect(last.text).toMatch(CODE_LINE);
      if (item.quotes === true) {
        // The secret was never registered: only the name of the field it came in can hide it.
        expect(last?.isError, last?.text).toBe(true);
        expect(last?.text).toContain('[redacted]');
      }
      r.assertClean();
    },
  );
});

// The quote of a backend refusal is cut at its limit. The cases whose error reaches the model quote
// a secret written back to back, in no field of a secret name: two shifts nine characters apart put
// the cut at least CANARY_PREFIX_LENGTH characters inside a copy in one of them.
describe.each(CASES.filter((item) => item.quotes === true))(
  'sentinel: $tool ($label), the quote limit inside a secret',
  (item) => {
    it.each([
      [409, 0],
      [409, 9],
      [422, 0],
      [422, 9],
    ])('leaves no head of the secret in front of the cut (%i, shift %i)', async (status, shift) => {
      expect(shift + CANARY_PREFIX_LENGTH).toBeLessThanOrEqual(TOKEN_CANARY.length);
      const { r, proxy, drive } = await start(item);
      const before = await runBefore(item, drive, proxy);
      proxy.failWith(status, { ...item.failOptions, quoteRun: shift });
      const calls = await callUnderTest(item, drive, before);
      const last = calls[calls.length - 1];
      expect(last?.isError, last?.text).toBe(true);
      expect(last?.text).toMatch(CODE_LINE);
      expect(last?.text).toContain('[redacted]');
      expect(last?.text).toContain('…');
      r.assertClean();
    });
  },
);
