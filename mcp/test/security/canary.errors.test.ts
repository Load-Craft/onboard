// Sentinel suite, part 2 (cases and what is fed in: canaryCases.ts): every case answered with an
// error 500, 422, 409 or 401 that quotes the secret.

import { describe, expect, it, vi } from 'vitest';

import { CASES, CODE_LINE, callUnderTest, runBefore, start } from './canaryCases.js';

vi.setConfig({ testTimeout: 120_000 });

describe.each(CASES)('sentinel: $tool ($label)', (item) => {
  it.each([500, 422, 409, 401])(
    'lets no secret out through an error %i that quotes it',
    async (status) => {
      const { r, proxy, drive } = await start(item);
      const before = await runBefore(item, drive, proxy);
      proxy.failWith(status, item.failOptions);
      const calls = await callUnderTest(item, drive, before);
      const last = calls[calls.length - 1];
      if (last?.isError === true) expect(last.text).toMatch(CODE_LINE);
      if (item.quotes === true && (status === 422 || status === 409)) {
        // The backend's own words reached the model, with the secret taken out of them.
        expect(last?.isError, last?.text).toBe(true);
        expect(last?.text).toContain('[redacted]');
      }
      r.assertClean();
    },
  );
});
