import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { ToolError } from '../src/errors.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { createHttp, type HttpClient } from '../src/http/client.js';
import { getMeta, MIN_API_REVISION, requireCapability } from '../src/http/compat.js';
import { toToolError } from '../src/http/errors.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock } from './helpers/clock.js';
import { startFake, type Fake, type StartFakeOptions } from './fake-backend/server.js';

interface Setup {
  readonly fake: Fake;
  readonly http: HttpClient;
}

async function setup(meta?: StartFakeOptions['meta']): Promise<Setup> {
  const clock = createTestClock();
  const fake = await startFake({ clock, ...(meta === undefined ? {} : { meta }) });
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${fake.url}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
    '/tmp',
  );
  const http = createHttp(config, createLogger({ level: 'error', sink: () => undefined }), {
    clock,
  });
  return { fake, http };
}

const metaCalls = (fake: Fake): number =>
  fake.calls.filter((call) => call.path === '/api/v1/meta').length;

async function rejection(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error('expected the call to fail');
}

describe('getMeta', () => {
  it('asks the backend once for three calls and returns what it said', async () => {
    const { fake, http } = await setup({ version: '9.9.9', capabilities: ['api_tokens', 'meta'] });
    const first = await getMeta(http);
    await getMeta(http);
    await getMeta(http);
    expect(first).toEqual({
      version: '9.9.9',
      api_revision: MIN_API_REVISION,
      capabilities: ['api_tokens', 'meta'],
      public_base_url: null,
    });
    expect(metaCalls(fake)).toBe(1);
  });

  it('does not remember a failure: the next call asks again', async () => {
    const { fake, http } = await setup();
    fake.faults.next('GET', '/api/v1/meta', { status: 500, body: { detail: 'boom' } });
    const failure = await getMeta(http).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LoadcraftApiError);
    expect((await getMeta(http)).version).toBeTruthy();
    expect(metaCalls(fake)).toBe(2);
  });

  it('refuses a backend below MIN_API_REVISION and names both numbers', async () => {
    const { http } = await setup({ api_revision: MIN_API_REVISION - 1 });
    const error = await rejection(getMeta(http));
    expect(error.code).toBe('backend_too_old');
    expect(error.params).toMatchObject({ have: MIN_API_REVISION - 1, need: MIN_API_REVISION });
    const text = toToolError(error, createTranslator('en')).message;
    expect(text).toContain(String(MIN_API_REVISION - 1));
    expect(text).toContain(String(MIN_API_REVISION));
  });

  it('accepts a backend above MIN_API_REVISION', async () => {
    const { http } = await setup({ api_revision: MIN_API_REVISION + 3 });
    expect((await getMeta(http)).api_revision).toBe(MIN_API_REVISION + 3);
  });

  it('turns 404 into backend_too_old saying the backend reports no version', async () => {
    const { fake, http } = await setup();
    fake.faults.next('GET', '/api/v1/meta', { status: 404, body: { detail: 'Not Found' } });
    const error = await rejection(getMeta(http));
    expect(error.code).toBe('backend_too_old');
    const english = toToolError(error, createTranslator('en')).message;
    expect(english).toContain('does not report its version');
    const polish = toToolError(error, createTranslator('pl')).message;
    expect(polish).toContain('nie podaje swojej wersji');
  });

  it('lets other failures through unchanged', async () => {
    const { fake, http } = await setup();
    fake.faults.next('GET', '/api/v1/meta', { status: 500, body: { detail: 'boom' } });
    const error = await rejection(getMeta(http));
    expect(error.code).toBe('server_error');
  });
});

describe('requireCapability', () => {
  it('passes when the backend lists the capability and asks once for three checks', async () => {
    const { fake, http } = await setup({ capabilities: ['api_tokens', 'meta'] });
    await requireCapability(http, 'api_tokens', 'use X');
    await requireCapability(http, 'meta', 'use X');
    await requireCapability(http, 'api_tokens', 'use X');
    expect(metaCalls(fake)).toBe(1);
  });

  it('names the missing capability and carries the caller advice', async () => {
    const { http } = await setup({ capabilities: ['meta'] });
    const error = await rejection(
      requireCapability(http, 'api_tokens', 'update LoadCraft or use the web console'),
    );
    expect(error.code).toBe('backend_too_old');
    const shown = toToolError(error, createTranslator('en'));
    expect(shown.message).toContain('api_tokens');
    expect(shown.hint).toContain('update LoadCraft or use the web console');
    const polish = toToolError(error, createTranslator('pl'));
    expect(polish.message).toContain('api_tokens');
    expect(polish.hint).toContain('update LoadCraft or use the web console');
  });

  it('also reports a too-old revision before looking at capabilities', async () => {
    const { http } = await setup({ api_revision: 0, capabilities: ['meta'] });
    const error = await rejection(requireCapability(http, 'meta', 'x'));
    expect(error.params).toMatchObject({ have: 0 });
  });
});
