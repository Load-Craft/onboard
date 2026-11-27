// Small async helpers shared by tool tests: the error of a failing call, polling for a condition
// and the address of a port nothing listens on.

import { createServer } from 'node:net';

import { vi } from 'vitest';

/** The error a promise rejects with; fails the test when the promise resolves instead. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

/**
 * Waits until `check` holds, then lets pending continuations (for instance registering the next
 * sleep on a test clock) run. Names `what` in the error when the wait times out.
 */
export async function waitFor(check: () => boolean, what: string, timeout = 3000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!check()) throw new Error(`waiting for ${what}`);
    },
    { timeout, interval: 5 },
  );
  await new Promise<void>((done) => setImmediate(done));
}

/** `http://127.0.0.1:<port>` of a port that was free a moment ago and has no listener now. */
export async function closedPort(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port assigned');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return `http://127.0.0.1:${String(address.port)}`;
}
