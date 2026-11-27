import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { format, inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { toToolError } from '../src/http/errors.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { createLogger, type Logger } from '../src/log.js';
import { readAccountFromEnv, readEnvValues } from '../src/workspace/envFile.js';
import { Secret, type SecretScope } from '../src/secret.js';
import { CallSecretScope } from '../src/workspace/secrets.js';
import { assertNoCanary, CANARY } from './helpers/canary.js';

const REDACTED = '[redacted]';

function capturingLogger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  return { log: createLogger({ level: 'debug', sink: (line) => lines.push(line) }), lines };
}

describe('Secret', () => {
  const secret = new Secret(CANARY);

  it('reveal is the only way to read the value', () => {
    expect(secret.reveal()).toBe(CANARY);
  });

  it('does not leak through string conversion', () => {
    expect(String(secret)).toBe(REDACTED);
    const template = (value: unknown): string => `password: ${value as string}`;
    expect(template(secret)).toBe(`password: ${REDACTED}`);
    expect(secret.toString()).toBe(REDACTED);
    expect('' + String(secret)).toBe(REDACTED);
  });

  it('does not leak through JSON', () => {
    expect(JSON.stringify(secret)).toBe(JSON.stringify(REDACTED));
    const nested = JSON.stringify({ account: { password: secret }, list: [secret] });
    expect(nested).not.toContain(CANARY);
    expect(nested).toContain(REDACTED);
  });

  it('does not leak through util.inspect and format', () => {
    expect(inspect(secret)).toBe(REDACTED);
    expect(inspect({ password: secret }, { depth: 5 })).not.toContain(CANARY);
    expect(inspect(secret, { customInspect: false, showHidden: true, depth: 5 })).not.toContain(
      CANARY,
    );
    expect(format('%s %o %O %j', secret, secret, secret, secret)).not.toContain(CANARY);
  });

  it('does not leak through structuredClone or enumeration', () => {
    const clone: unknown = structuredClone(secret);
    assertNoCanary(clone);
    expect(inspect(clone, { showHidden: true })).not.toContain(CANARY);
    expect(Object.keys(secret)).toEqual([]);
    expect(Object.getOwnPropertyNames(secret)).toEqual([]);
    expect({ ...secret }).toEqual({});
  });

  it('keeps short values hidden too', () => {
    const short = new Secret('abc');
    expect(String(short)).toBe(REDACTED);
    expect(JSON.stringify(short)).toBe(JSON.stringify(REDACTED));
    expect(inspect(short)).toBe(REDACTED);
    expect(short.reveal()).toBe('abc');
  });
});

describe('CallSecretScope', () => {
  it('fulfils the ToolContext contract', () => {
    const scope: SecretScope = new CallSecretScope(capturingLogger().log);
    expect(scope.add(CANARY).reveal()).toBe(CANARY);
  });

  it('add returns a Secret', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    expect(scope.add(CANARY)).toBeInstanceOf(Secret);
  });

  it('add registers the value in the logger', () => {
    const { log, lines } = capturingLogger();
    const scope = new CallSecretScope(log);
    const secret = scope.add(CANARY);
    log.info(`login with ${secret.reveal()}`, { password: secret.reveal() });
    expect(lines).toHaveLength(1);
    assertNoCanary(lines);
  });

  it('scrubs the literal value', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add(CANARY);
    expect(scope.scrub(`a ${CANARY} b ${CANARY}`)).toBe(`a ${REDACTED} b ${REDACTED}`);
  });

  it('scrubs URL-encoded forms', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    const value = 'p@ss w0rd/!x';
    scope.add(value);
    const text = [
      `?p=${encodeURIComponent(value)}`,
      `?${new URLSearchParams({ p: value }).toString()}`,
      encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    ].join(' ');
    const out = scope.scrub(text);
    expect(out).not.toContain(encodeURIComponent(value));
    expect(out).not.toContain(new URLSearchParams({ p: value }).toString().slice(2));
    expect(out).not.toContain('p%40ss');
    expect(out).toContain(REDACTED);
  });

  it('scrubs base64 forms, standalone and inside a larger encoded text', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add(CANARY);
    const standalone = Buffer.from(CANARY).toString('base64');
    const basic = Buffer.from(`user@example.com:${CANARY}`).toString('base64');
    const url = Buffer.from(`x${CANARY}`).toString('base64url');
    const out = scope.scrub(`a ${standalone} b Basic ${basic} c ${url}`);
    assertNoCanary(out);
    expect(out).toContain(REDACTED);
  });

  it('scrubs JSON-escaped values', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    const value = 'pa"ss\\word';
    scope.add(value);
    const out = scope.scrub(JSON.stringify({ password: value }));
    expect(out).not.toContain(JSON.stringify(value).slice(1, -1));
    expect(out).toContain(REDACTED);
  });

  it('scrubs JSON with \\u escapes for non-ASCII characters, in either hex case', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    const value = 'café-€-pass';
    scope.add(value);
    const lower = 'caf\\u00e9-\\u20ac-pass';
    const upper = 'caf\\u00E9-\\u20AC-pass';
    const out = scope.scrub(`{"password": "${lower}"} {"password": "${upper}"}`);
    expect(out).not.toContain(lower);
    expect(out).not.toContain(upper);
    expect(out).toBe(`{"password": "${REDACTED}"} {"password": "${REDACTED}"}`);
    expect(scope.containsSecret(lower)).toBe(true);
  });

  it('masks a secret that contains another one as a whole', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add('abcd');
    scope.add(`${CANARY}abcd`);
    expect(scope.scrub(`x${CANARY}abcdx`)).toBe(`x${REDACTED}x`);
  });

  it('does not mask values shorter than 4 characters in text', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    const short = scope.add('abc');
    expect(scope.scrub('abc abcabc')).toBe('abc abcabc');
    expect(scope.containsSecret('abc')).toBe(false);
    expect(String(short)).toBe(REDACTED);
    scope.add('abcd');
    expect(scope.scrub('abcd')).toBe(REDACTED);
  });

  it('scrubDeep walks objects and arrays without mutating them', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add(CANARY);
    const input = {
      text: `token ${CANARY}`,
      [`key-${CANARY}`]: 1,
      list: ['ok', [`deep ${CANARY}`], { inner: CANARY }],
      count: 3,
      flag: true,
      none: null,
    };
    const out = scope.scrubDeep(input);
    assertNoCanary(out);
    expect(out.count).toBe(3);
    expect(out.flag).toBe(true);
    expect(out.none).toBeNull();
    expect(out.list[0]).toBe('ok');
    expect(out.text).toBe(`token ${REDACTED}`);
    expect(input.text).toBe(`token ${CANARY}`);
  });

  it('scrubDeep handles cycles, maps, sets and errors', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add(CANARY);
    const cyclic: Record<string, unknown> = { value: CANARY };
    cyclic.self = cyclic;
    const error = new ToolError('boom', {
      message: `failed with ${CANARY}`,
      hint: `retry ${CANARY}`,
      details: { echo: CANARY },
    });
    const out = scope.scrubDeep({
      cyclic,
      map: new Map([[CANARY, CANARY]]),
      set: new Set([CANARY]),
      error,
    });
    assertNoCanary(out);
    expect(out.cyclic.self).toBe(out.cyclic);
    expect(out.error).toBeInstanceOf(ToolError);
    expect(out.error.code).toBe('boom');
    expect(out.error.message).toBe(`failed with ${REDACTED}`);
    expect(error.message).toBe(`failed with ${CANARY}`);
  });

  it('containsSecret finds values in text, encodings and nested structures', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    scope.add(CANARY);
    expect(scope.containsSecret('clean')).toBe(false);
    expect(scope.containsSecret({ a: ['clean', 1, null] })).toBe(false);
    expect(scope.containsSecret(`x${CANARY}`)).toBe(true);
    expect(scope.containsSecret(encodeURIComponent(CANARY))).toBe(true);
    expect(scope.containsSecret(Buffer.from(CANARY).toString('base64'))).toBe(true);
    expect(scope.containsSecret({ a: [{ b: `deep ${CANARY}` }] })).toBe(true);
    expect(scope.containsSecret({ [CANARY]: 1 })).toBe(true);
    expect(scope.containsSecret(new Map([['k', CANARY]]))).toBe(true);
  });

  it('containsSecret treats a Secret object as a secret', () => {
    const scope = new CallSecretScope(capturingLogger().log);
    expect(scope.containsSecret({ password: new Secret('xyz') })).toBe(true);
  });
});

describe('readAccountFromEnv', () => {
  let base: string;
  let root: string;
  let outside: string;
  let scope: CallSecretScope;
  let log: Logger;
  let lines: string[];

  beforeEach(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'lc-env-')));
    root = join(base, 'project');
    outside = join(base, 'outside');
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(outside);
    ({ log, lines } = capturingLogger());
    scope = new CallSecretScope(log);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function write(name: string, content: string): void {
    writeFileSync(join(root, name), content);
  }

  async function failure(promise: Promise<unknown>): Promise<ToolError> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      return error as ToolError;
    }
    throw new Error('expected ToolError');
  }

  function expectClean(error: ToolError): void {
    assertNoCanary(error, error.message, error.hint, error.details, error.stack, lines);
    expect(JSON.stringify([error.message, error.hint, error.details])).not.toContain(base);
  }

  it('reads the default keys', async () => {
    write('.env', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`);
    const asContract: SecretScope = scope;
    const account = await readAccountFromEnv(root, '.env', asContract);
    expect(account.email).toBe('user@example.com');
    expect(account.password).toBeInstanceOf(Secret);
    expect(account.password.reveal()).toBe(CANARY);
    expect(account.keys).toEqual({ email: 'TEST_USER_EMAIL', password: 'TEST_USER_PASSWORD' });
    assertNoCanary(JSON.stringify(account), inspect(account, { depth: 5 }), lines);
    expect(scope.containsSecret(CANARY)).toBe(true);
    log.info(`password ${account.password.reveal()}`);
    assertNoCanary(lines);
  });

  it('reads explicitly named keys only', async () => {
    write(
      '.env.perf',
      [
        'TEST_USER_EMAIL=default@example.com',
        'TEST_USER_PASSWORD=default-password',
        'PERF_LOGIN=perf@example.com',
        `PERF_PASS=${CANARY}`,
      ].join('\n'),
    );
    const account = await readAccountFromEnv(root, '.env.perf', scope, {
      emailKey: 'PERF_LOGIN',
      passwordKey: 'PERF_PASS',
    });
    expect(account.email).toBe('perf@example.com');
    expect(account.password.reveal()).toBe(CANARY);
    expect(account.keys).toEqual({ email: 'PERF_LOGIN', password: 'PERF_PASS' });
  });

  it('parses every supported syntax variant', async () => {
    write(
      'config/staging.env',
      [
        '﻿# full-line comment',
        '',
        '   # indented comment',
        'PLAIN=value',
        'export EXPORTED=exported-value',
        'SPACED = spaced value  ',
        'INLINE=before # trailing comment',
        'HASH_IN_VALUE=pa#ss',
        "SINGLE='single # not a comment \\n kept'",
        'DOUBLE="line1\\nline2 \\"quoted\\" back\\\\slash" # comment',
        'MULTI="first',
        'second"',
        'EMPTY=',
        'COMMENT_ONLY=   # nothing here',
        'HASH_START=#value',
        'NO_INTERPOLATION=${PLAIN}-$PLAIN',
        'CRLF=windows\r',
        'DUP=first',
        'DUP=second',
        'not a valid line',
        'BROKEN="unclosed quote',
        'AFTER_BROKEN=still parsed',
        'TEST_USER_EMAIL=user@example.com',
        `TEST_USER_PASSWORD="${CANARY}"`,
      ].join('\n'),
    );
    const read = async (passwordKey: string): Promise<string> =>
      (
        await readAccountFromEnv(root, 'config/staging.env', scope, { passwordKey })
      ).password.reveal();

    expect(await read('PLAIN')).toBe('value');
    expect(await read('EXPORTED')).toBe('exported-value');
    expect(await read('SPACED')).toBe('spaced value');
    expect(await read('INLINE')).toBe('before');
    expect(await read('HASH_IN_VALUE')).toBe('pa#ss');
    expect(await read('SINGLE')).toBe('single # not a comment \\n kept');
    expect(await read('DOUBLE')).toBe('line1\nline2 "quoted" back\\slash');
    expect((await failure(read('MULTI'))).code).toBe('env_key_missing');
    expect(await read('HASH_START')).toBe('#value');
    expect((await failure(read('COMMENT_ONLY'))).code).toBe('env_key_missing');
    expect((await failure(read('EMPTY'))).code).toBe('env_key_missing');
    expect(await read('NO_INTERPOLATION')).toBe('${PLAIN}-$PLAIN');
    expect(await read('CRLF')).toBe('windows');
    expect(await read('DUP')).toBe('second');
    expect(await read('AFTER_BROKEN')).toBe('still parsed');
    expect((await failure(read('BROKEN'))).code).toBe('env_key_missing');
    expect(await read('TEST_USER_PASSWORD')).toBe(CANARY);
  });

  it('reports a missing key by key and file name, without values or other keys', async () => {
    write('.env.local', `TEST_USER_EMAIL=user@example.com\nOTHER_SECRET_KEY=${CANARY}\n`);
    const error = await failure(readAccountFromEnv(root, '.env.local', scope));
    expect(error.code).toBe('env_key_missing');
    expect(error.params).toEqual({ file: '.env.local', names: 'TEST_USER_PASSWORD' });
    const shown = toToolError(error, createTranslator('en'));
    expect(shown.message).toBe('Missing or empty in .env.local: TEST_USER_PASSWORD.');
    expect(JSON.stringify([error.message, error.hint, error.details])).not.toContain(
      'OTHER_SECRET_KEY',
    );
    expect(JSON.stringify([error.message, error.hint, error.details])).not.toContain(
      'user@example.com',
    );
    expectClean(error);
  });

  it('reports an empty explicit key as missing', async () => {
    write('.env', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\nEMPTY_PASS=\n`);
    const error = await failure(
      readAccountFromEnv(root, '.env', scope, { passwordKey: 'EMPTY_PASS' }),
    );
    expect(error.code).toBe('env_key_missing');
    expect(error.params).toMatchObject({ names: 'EMPTY_PASS' });
    expectClean(error);
  });

  it('rejects a file that is not an env file', async () => {
    write('secrets.txt', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`);
    const error = await failure(readAccountFromEnv(root, 'secrets.txt', scope));
    expect(error.code).toBe('env_file_not_allowed');
    expectClean(error);
  });

  it('rejects an env-named symlink pointing to a non-env file', async () => {
    write('secrets.txt', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`);
    symlinkSync(join(root, 'secrets.txt'), join(root, '.env'));
    const error = await failure(readAccountFromEnv(root, '.env', scope));
    expect(error.code).toBe('env_file_not_allowed');
    expectClean(error);
  });

  it('rejects a file outside the project directory', async () => {
    writeFileSync(
      join(outside, '.env'),
      `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`,
    );
    const relative = await failure(readAccountFromEnv(root, '../outside/.env', scope));
    expect(relative.code).toBe('path_outside_workspace');
    expectClean(relative);
    const absolute = await failure(readAccountFromEnv(root, join(outside, '.env'), scope));
    expect(absolute.code).toBe('path_outside_workspace');
    expectClean(absolute);
    symlinkSync(join(outside, '.env'), join(root, '.env'));
    const linked = await failure(readAccountFromEnv(root, '.env', scope));
    expect(linked.code).toBe('path_outside_workspace');
    expectClean(linked);
  });

  it('rejects a directory named like an env file', async () => {
    mkdirSync(join(root, '.env'));
    const error = await failure(readAccountFromEnv(root, '.env', scope));
    expect(error.code).toBe('not_a_file');
    expectClean(error);
  });

  it('rejects an invalid key name without echoing file content', async () => {
    write('.env', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`);
    const error = await failure(
      readAccountFromEnv(root, '.env', scope, { passwordKey: 'BAD KEY=' }),
    );
    expect(error.code).toBe('env_key_invalid');
    expectClean(error);
  });

  it('rejects a file that is not valid UTF-8 without echoing it', async () => {
    writeFileSync(
      join(root, '.env'),
      Buffer.concat([Buffer.from(`TEST_USER_PASSWORD=${CANARY}`), Buffer.from([0xff, 0xfe])]),
    );
    const error = await failure(readAccountFromEnv(root, '.env', scope));
    expect(error.code).toBe('file_encoding_invalid');
    expectClean(error);
  });

  it('never logs the file content', async () => {
    write('.env', `TEST_USER_EMAIL=user@example.com\nTEST_USER_PASSWORD=${CANARY}\n`);
    await readAccountFromEnv(root, '.env', scope);
    for (const line of lines) expect(line).not.toContain('user@example.com');
    assertNoCanary(lines);
  });
});

describe('readEnvValues', () => {
  let root: string;
  let scope: CallSecretScope;
  let log: Logger;
  let lines: string[];

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lc-env-values-')));
    ({ log, lines } = capturingLogger());
    scope = new CallSecretScope(log);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the named variables, leaves out an absent or empty one, and masks each value from then on', async () => {
    writeFileSync(join(root, '.env'), `KEY_A=${CANARY}\nKEY_B=\nOTHER=not-asked\n`);
    const { values, shown } = await readEnvValues(root, '.env', ['KEY_A', 'KEY_B', 'KEY_C'], scope);
    expect(shown).toBe('.env');
    expect([...values.keys()]).toEqual(['KEY_A']);
    expect(values.get('KEY_A')).toBeInstanceOf(Secret);
    expect(values.get('KEY_A')?.reveal()).toBe(CANARY);
    // The value is registered with the scope: it is scrubbed from text, data and the log.
    expect(scope.containsSecret(CANARY)).toBe(true);
    expect(scope.scrub(`echo ${CANARY} end`)).not.toContain(CANARY);
    log.info(`value ${CANARY}`);
    assertNoCanary(lines);
    expect(scope.containsSecret('not-asked')).toBe(false);
  });

  it('refuses a file that is not an env file and a key that is not a name', async () => {
    writeFileSync(join(root, 'notes.txt'), `KEY_A=${CANARY}\n`);
    await expect(readEnvValues(root, 'notes.txt', ['KEY_A'], scope)).rejects.toBeInstanceOf(
      ToolError,
    );
    writeFileSync(join(root, '.env'), `KEY_A=${CANARY}\n`);
    await expect(readEnvValues(root, '.env', ['bad key'], scope)).rejects.toBeInstanceOf(ToolError);
    expect(scope.containsSecret(CANARY)).toBe(false);
  });
});
