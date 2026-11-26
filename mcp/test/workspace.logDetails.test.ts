// The detail of a log entry (the request and the response after the secret mask) lives in the cache
// section `logDetails`: valid 24 hours, at most 8 KB an entry and 2 MB together, the oldest dropped first.
// Every test runs on a real state file in a temporary workspace.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as z from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import { createLogger } from '../src/log.js';
import { detailOf, readDetail, storesDetail, type LogDetail } from '../src/workspace/logDetails.js';
import { LIMITS, NEW_KEY, recordCall } from '../src/workspace/processState.js';
import { createProcessStore, type ProcessStore } from '../src/workspace/reducer.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { CANARY, HEADER_CANARY } from './helpers/canary.js';

const START = Date.parse('2026-11-26T10:00:00Z');
const HOUR = 3_600_000;
const KB = 1024;

interface Bench {
  readonly secrets: CallSecretScope;
  readonly store: ProcessStore;
  now: number;
  stateText(): string;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function bench(): Bench {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-log-details-')));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const secrets = new CallSecretScope(createLogger({ level: 'error', sink: () => undefined }));
  const state: Bench = {
    secrets,
    now: START,
    store: createProcessStore(dir, { secrets, clock: { now: () => state.now } }),
    stateText: () => readFileSync(join(dir, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  };
  return state;
}

const entry = (id: string, at: number, effect: 'read' | 'write' = 'write') => ({
  id,
  at: new Date(at).toISOString(),
  ms: 3,
  module: 'project' as const,
  tool: 'project_create',
  level: 2 as const,
  effect,
  origin: 'model' as const,
  args: 'name=shop',
  result: 'ok',
  status: 'ok' as const,
  has_detail: true,
});

/** The way the registration layer does it: the entry and its detail in one write. */
async function call(b: Bench, id: string, args: unknown, data: unknown): Promise<void> {
  const detail = detailOf({ args, end: { kind: 'done', data }, secrets: b.secrets }, b.now);
  await b.store.applyUpdate(
    NEW_KEY,
    {},
    {
      tool: 'project_create',
      then: (p, now) => recordCall(p, { entry: entry(id, b.now) }, now),
      detail: { id, entry: detail },
    },
  );
}

/** The request and the response of a detail the state holds (its value is whatever the section accepts). */
const texts = (detail: { value?: unknown } | undefined): { request: string; response: string } =>
  z.object({ request: z.string(), response: z.string() }).parse(detail?.value);

const stored = (b: Bench): Record<string, unknown> => b.store.readState().logDetails;
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

describe('the limits are the owner decision', () => {
  it('24 hours, 8 KB an entry, 2 MB together', () => {
    expect(LIMITS.log_details).toEqual({ hours: 24, entry_kb: 8, total_mb: 2 });
  });
});

describe('300 calls with large responses', () => {
  it('keep the section within 2 MB and every entry within 8 KB, the oldest dropped', async () => {
    const b = bench();
    const big = 'x'.repeat(20 * KB);
    for (let i = 0; i < 300; i += 1) {
      b.now += 1000;
      await call(
        b,
        `l-${String(i).padStart(8, '0')}`,
        { name: `shop-${String(i)}` },
        { body: big },
      );
    }
    const process = b.store.read(NEW_KEY);
    expect(process?.log.length).toBeLessThanOrEqual(300);
    const section = stored(b);
    const ids = Object.keys(section);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids)
      expect(bytes((section[id] as { value: unknown }).value)).toBeLessThanOrEqual(8 * KB);
    // the limit counts the values of the details, as the state schema does (the keys and savedAt come on top)
    const total = ids.reduce(
      (sum, id) => sum + bytes((section[id] as { value: unknown }).value),
      0,
    );
    expect(total).toBeLessThanOrEqual(2 * 1024 * KB);
    // the newest survive, the oldest are gone
    expect(ids).toContain('l-00000299');
    expect(ids).not.toContain('l-00000000');
    // what the oldest kept entry and the newest one hold is a valid detail of a cut response
    const newest = readDetail(b.store.readState(), 'l-00000299', b.now);
    expect(newest?.truncated).toBe(true);
    expect(texts(newest).response).toContain('[truncated]');
    expect(texts(newest).request).toContain('shop-299');
  });

  it('keeps a detail of an entry that is still in the log, and none of one that left it', async () => {
    const b = bench();
    for (let i = 0; i < LIMITS.log + 5; i += 1) {
      b.now += 1000;
      await call(b, `l-${String(i).padStart(8, '0')}`, { n: i }, { ok: true });
    }
    const process = b.store.read(NEW_KEY);
    expect(process?.log).toHaveLength(LIMITS.log);
    const logged = new Set(process?.log.map((e) => e.id));
    expect(new Set(Object.keys(stored(b)))).toEqual(logged);
  });
});

describe('one write', () => {
  it('the entry and its detail appear together and raise rev once', async () => {
    const b = bench();
    await call(b, 'l-00000001', { a: 1 }, { b: 2 });
    const before = b.store.read(NEW_KEY)?.rev ?? -1;
    b.now += 1000;
    await call(b, 'l-00000002', { a: 1 }, { b: 2 });
    const process = b.store.read(NEW_KEY);
    expect(process?.rev).toBe(before + 1);
    expect(process?.log.map((e) => e.id)).toEqual(['l-00000001', 'l-00000002']);
    expect(Object.keys(stored(b)).sort()).toEqual(['l-00000001', 'l-00000002']);
  });

  it('a detail whose entry is not recorded is not kept', async () => {
    const b = bench();
    const detail = detailOf(
      { args: {}, end: { kind: 'done', data: {} }, secrets: b.secrets },
      b.now,
    );
    await b.store.applyUpdate(
      NEW_KEY,
      {},
      {
        tool: 'project_create',
        then: (p) => p,
        detail: { id: 'l-00000009', entry: detail },
      },
    );
    expect(stored(b)).toEqual({});
  });
});

describe('the time to live', () => {
  it('drops a detail 24 hours after it was saved, on the next write, by the clock of the test', async () => {
    const b = bench();
    await call(b, 'l-00000001', { a: 1 }, { b: 2 });
    expect(Object.keys(stored(b))).toEqual(['l-00000001']);
    b.now += 24 * HOUR - 1;
    expect(readDetail(b.store.readState(), 'l-00000001', b.now)).toBeDefined();
    b.now += 2;
    // not read any more even before something prunes it
    expect(readDetail(b.store.readState(), 'l-00000001', b.now)).toBeUndefined();
    await call(b, 'l-00000002', { a: 1 }, { b: 2 });
    expect(Object.keys(stored(b))).toEqual(['l-00000002']);
  });
});

describe('the mask', () => {
  it('never writes a registered secret, a header of authorization or a credential field', async () => {
    const b = bench();
    b.secrets.add(CANARY);
    await call(
      b,
      'l-00000001',
      {
        name: `shop ${CANARY}`,
        headers: { Authorization: `Bearer ${HEADER_CANARY}`, accept: 'json' },
      },
      {
        note: `echo ${CANARY}`,
        headers: { 'Set-Cookie': `sid=${HEADER_CANARY}`, 'x-api-key': HEADER_CANARY },
        user: { password: HEADER_CANARY, name: 'ann' },
        line: `Authorization: Bearer ${HEADER_CANARY}`,
      },
    );
    const text = b.stateText();
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(HEADER_CANARY);
    const detail = readDetail(b.store.readState(), 'l-00000001', b.now);
    expect(texts(detail).request).toContain('"accept":"json"');
    expect(texts(detail).response).toContain('"name":"ann"');
    expect(texts(detail).response).toContain('[redacted]');
  });

  it('masks a secret registered after the entry was built, when the detail is built', async () => {
    const b = bench();
    const data = { token: 'late', echo: `value ${CANARY}` };
    b.secrets.add(CANARY);
    await call(b, 'l-00000001', {}, data);
    expect(b.stateText()).not.toContain(CANARY);
  });
});

describe('the fallback mask', () => {
  const S = 'FALLBACK-SECRET-51d0';
  const responseOf = (args: unknown, data: unknown): string => {
    const b = bench();
    return detailOf({ args, end: { kind: 'done', data }, secrets: b.secrets }, b.now).value
      .response;
  };

  it.each([
    ['user_password', { user_password: S }],
    ['new_password', { new_password: S }],
    ['csrf_token', { csrf_token: S }],
    ['private_key', { private_key: S }],
    ['jwt', { jwt: S }],
  ])('masks the field %s', (_name, data) => {
    const text = responseOf({}, data);
    expect(text).not.toContain(S);
    expect(text).toContain('[redacted]');
  });

  it.each([
    ['credential', { credential: S }],
    ['user_credentials', { user_credentials: { login: 'ann', key: S } }],
    ['passphrase', { passphrase: S }],
    ['pin', { pin: S }],
    ['card_pin (a number)', { card_pin: 4321 }],
    ['userPin', { userPin: S }],
    ['otp', { otp: S }],
    ['OTPCode', { OTPCode: S }],
    ['session', { session: S }],
    ['sessionId', { sessionId: S }],
    ['sid', { sid: S }],
    ['PHPSESSID', { PHPSESSID: S }],
  ])('masks the field %s', (_name, data) => {
    const text = responseOf({}, data);
    expect(text).not.toContain(S);
    expect(text).not.toContain('4321');
    expect(text).toContain('[redacted]');
  });

  it.each(['pin', 'otp', 'sid', 'session_id', 'passphrase'])(
    'masks the parameter %s in an address and in text',
    (param) => {
      const text = responseOf(
        {},
        { url: `https://example.com/a?x=1&${param}=${S}&y=2`, note: `sent ${param}=${S} twice` },
      );
      expect(text).not.toContain(S);
      expect(text).toContain('x=1');
      expect(text).toContain('y=2');
    },
  );

  it('keeps fields that only hold a short credential word inside another word', () => {
    const data = { shipping: 'fast', mapping: 'm1', inside: 'yes', spinner: 'on', otpx: 'kept' };
    expect(JSON.parse(responseOf({}, data))).toEqual(data);
  });

  it('keeps a count of tokens: total_tokens, max_tokens and inputTokens as numbers', () => {
    const data = { usage: { total_tokens: 1234, max_tokens: 4096, inputTokens: 77 } };
    expect(JSON.parse(responseOf({}, data))).toEqual(data);
    const text = responseOf({}, { url: 'https://example.com/a?max_tokens=4096&x=1' });
    expect(text).toContain('max_tokens=4096');
  });

  it('keeps flags and counts under the long credential words: has_credentials, session_count', () => {
    const data = {
      has_credentials: false,
      session_count: 3,
      sessions: 2,
      credential_required: true,
      api_key_set: true,
      pin_required: false,
    };
    expect(JSON.parse(responseOf({}, data))).toEqual(data);
  });

  it.each([
    ['pin', { pin: 4321 }],
    ['card_pin', { card_pin: 4321 }],
    ['otp', { otp: 4321 }],
    ['sid', { sid: 4321 }],
  ])('still masks a number under the short word %s', (_name, data) => {
    const text = responseOf({}, data);
    expect(text).not.toContain('4321');
    expect(text).toContain('[redacted]');
  });

  it('still masks a text or a list under the long credential words', () => {
    const text = responseOf({}, { session: S, credentials: [S], session_count: S });
    expect(text).not.toContain(S);
  });

  it('still masks a field of tokens that is not a number', () => {
    const text = responseOf({}, { refresh_tokens: [S], total_tokens: S });
    expect(text).not.toContain(S);
  });

  it.each([
    ['Cookie', 'Cookie'],
    ['Authorization', 'Token'],
    ['x-api-key', 'x-api-key'],
    ['X-Api-Key', 'X-Api-Key'],
  ])('masks the value of a header listed as {name, value}: %s', (name) => {
    const text = responseOf(
      {},
      {
        headers: [
          { name, value: `Token ${S}` },
          { name: 'accept', value: 'json' },
        ],
      },
    );
    expect(text).not.toContain(S);
    expect(text).toContain('"value":"json"');
  });

  it('masks a Token scheme header and a Cookie header given as text lines', () => {
    const text = responseOf(
      {},
      { raw: `Authorization: Token ${S}\nCookie: sid=${S}\nAccept: json` },
    );
    expect(text).not.toContain(S);
    expect(text).toContain('Accept: json');
  });

  it('masks a Digest header with several quoted fields to the end of its line', () => {
    const text = responseOf(
      {},
      {
        raw: `Authorization: Digest username="${S}", realm="r", nonce="${S}2", response="${S}3"\nAccept: json`,
      },
    );
    expect(text).not.toContain(S);
    expect(text).toContain('Accept: json');
  });

  it('masks a header line of a plain text to the end of its line', () => {
    const text = responseOf(
      `Authorization: Digest username="${S}", nonce="${S}2"\nAccept: json`,
      {},
    );
    expect(text).toBeDefined();
    const b = bench();
    const request = detailOf(
      {
        args: `Authorization: Digest username="${S}", nonce="${S}2"\nAccept: json`,
        end: { kind: 'cancelled' },
        secrets: b.secrets,
      },
      b.now,
    ).value.request;
    expect(request).not.toContain(S);
    expect(request).toContain('Accept: json');
  });

  it('masks a password in a URL, with or without one', () => {
    const text = responseOf(
      {},
      { a: `https://ann:${S}@example.com/x`, b: `https://${S}@example.com/y` },
    );
    expect(text).not.toContain(S);
    expect(text).toContain('example.com/x');
  });

  it.each(['access_token', 'token', 'password', 'client_secret'])(
    'masks the query parameter %s in an address and in text',
    (param) => {
      const text = responseOf(
        {},
        { url: `https://example.com/a?x=1&${param}=${S}&y=2`, note: `sent ${param}=${S} twice` },
      );
      expect(text).not.toContain(S);
      expect(text).toContain('x=1');
      expect(text).toContain('y=2');
    },
  );
});

describe('what gets a detail', () => {
  it.each([
    [{ effect: 'write', status: 'ok', origin: 'model' }, undefined, true],
    [{ effect: 'costly', status: 'queued', origin: 'model' }, undefined, true],
    [{ effect: 'read', status: 'error', origin: 'model' }, undefined, true],
    [{ effect: 'read', status: 'ok', origin: 'model' }, undefined, false],
    [{ effect: 'write', status: 'ok', origin: 'panel' }, undefined, true],
    [{ effect: 'read', status: 'ok', origin: 'panel' }, undefined, false],
    [{ effect: 'write', status: 'ok', origin: 'model' }, 'data', false],
    [{ effect: 'write', status: 'error', origin: 'model' }, 'data', true],
  ] as const)('%j with format %s → %s', (entryShape, format, expected) => {
    expect(storesDetail(entryShape, format)).toBe(expected);
  });

  it('a failure keeps the text of the error as the response', () => {
    const b = bench();
    const detail: LogDetail = detailOf(
      {
        args: { a: 1 },
        end: { kind: 'error', code: 'not_found', message: 'No such flow' },
        secrets: b.secrets,
      },
      b.now,
    );
    expect(texts(detail).response).toContain('No such flow');
    expect(texts(detail).response).toContain('not_found');
  });
});
