// The clock given to the server reaches the pauses between retries of the shared HTTP client, so a
// test with a controlled clock does not wait for them in real time. The time limit of a request
// stays on the system clock (see test/http.client.test.ts).

import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { defineTool } from '../src/registry.js';
import { createServices } from '../src/server.js';
import { startFake } from './fake-backend/server.js';
import { createTestClock } from './helpers/clock.js';
import { toolRig } from './helpers/rig.js';

/** Probe: one GET through the services the server gave the call. */
const metaProbe = defineTool({
  name: 'meta_probe',
  title: 'Meta probe',
  description: 'Probe: reads the backend meta once.',
  input: z.object({}),
  annotations: { readOnlyHint: true },
  async run(ctx) {
    const { data } = await ctx.services.http.GET('/api/v1/meta');
    return { status: 'done', data: { version: data?.version ?? '' } };
  },
  render: (data) => data.version,
});

/** Waits in real time until `predicate` holds. */
async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('createServices', () => {
  it('a GET answered 502 waits for its retry on the given clock', async () => {
    const clock = createTestClock(1_000_000);
    const fake = await startFake({ clock, scope: 'manual' });
    try {
      const config = loadConfig(
        { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: fake.token },
        '/tmp',
      );
      const log = createLogger({ level: 'error', sink: () => undefined });
      fake.faults.next(
        'GET',
        '/api/v1/meta',
        { status: 502, body: { detail: 'Bad gateway' } },
        { outsideContract: true },
      );
      const call = createServices(config, log, clock).http.GET('/api/v1/meta');

      await until(() => clock.nextWakeAt() === clock.now() + 250, 'the retry pause on the clock');
      await clock.advance(250);

      await expect(call).resolves.toMatchObject({ data: { version: '0.0.0-fake' } });
      expect(fake.calls.filter((entry) => entry.path === '/api/v1/meta')).toHaveLength(2);
    } finally {
      await fake.close();
    }
  });

  it('createServer hands its clock to the services it creates', async () => {
    const r = await toolRig({ tools: [metaProbe] });
    r.fake.faults.next(
      'GET',
      '/api/v1/meta',
      { status: 502, body: { detail: 'Bad gateway' } },
      { outsideContract: true },
    );
    const call = r.call('meta_probe', {});

    await until(() => r.clock.nextWakeAt() === r.clock.now() + 250, 'the retry pause on the clock');
    await r.clock.advance(250);

    expect((await call).text).toBe('0.0.0-fake');
  });
});
