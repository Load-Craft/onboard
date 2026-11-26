import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, MIN_SECRET_LENGTH, sdkLogger } from '../src/log.js';

const SECRET = 'CANARY-SECRET-7f3a';

function collect() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => void lines.push(line) };
}

function forms(value: string): string[] {
  return [value, encodeURIComponent(value), Buffer.from(value, 'utf8').toString('base64')];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('never writes to stdout, even with the default sink', () => {
    let stdoutWrites = 0;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      stdoutWrites += 1;
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({ level: 'debug' });
    logger.debug('d');
    logger.info('i', { a: 1 });
    logger.warn('w');
    logger.error('e', { err: new Error('boom') });
    logger.child({ tool: 'x' }).info('child');
    sdkLogger(logger).debug('sdk debug');
    expect(stdoutWrites).toBe(0);
    expect(stderr).toHaveBeenCalledTimes(6);
    const first = String(stderr.mock.calls[0]?.[0]);
    expect(first.endsWith('\n')).toBe(true);
    expect(JSON.parse(first)).toMatchObject({ level: 'debug', msg: 'd' });
  });

  it('hides lower levels than the configured one', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'warn', sink });
    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('yes too');
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual(['yes', 'yes too']);
  });

  it('redacts a registered secret in all three forms in message and fields', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'debug', sink });
    logger.registerSecret(SECRET);
    for (const form of forms(SECRET)) {
      logger.info(`token is ${form}`, {
        header: `Bearer ${form}`,
        nested: { list: [form], [form]: 'key' },
      });
    }
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      for (const form of forms(SECRET)) expect(line).not.toContain(form);
      expect(line).toContain('[redacted]');
    }
  });

  it('redacts a secret that contains JSON-special characters', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    const secret = 'pa"ss\\word/ąę';
    logger.registerSecret(secret);
    logger.info(`x ${secret} y`, { v: secret });
    expect(lines[0]).not.toContain('word');
    expect(lines[0]).toContain('[redacted]');
  });

  it('ignores secrets shorter than 4 characters', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.registerSecret('ab1');
    logger.info('plain ab1 text');
    expect(lines[0]).toContain('plain ab1 text');
    expect(lines[0]).not.toContain('[redacted]');
  });

  it('masks secrets of 4 and 5 characters', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.registerSecret('pw12');
    logger.registerSecret('pw345');
    logger.info('login pw12 then pw345', { password: 'pw345' });
    expect(lines[0]).not.toContain('pw12');
    expect(lines[0]).not.toContain('pw345');
    expect(lines[0]).toContain('[redacted]');
  });

  it('shares one masking threshold with the secret scope', () => {
    expect(MIN_SECRET_LENGTH).toBe(4);
  });

  it('logs errors as name, message and stack after redaction', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.registerSecret(SECRET);
    const err = new TypeError(`failed with ${SECRET}`);
    logger.error('request failed', { err });
    const record = JSON.parse(lines[0] ?? '') as {
      err: { name: string; message: string; stack: string };
    };
    expect(record.err.name).toBe('TypeError');
    expect(record.err.message).toBe('failed with [redacted]');
    expect(record.err.stack).toContain('TypeError');
    expect(record.err.stack).not.toContain(SECRET);
  });

  it('child loggers add fields and share the secret registry both ways', () => {
    const { lines, sink } = collect();
    const parent = createLogger({ level: 'info', sink });
    const child = parent.child({ tool: 'run-test' });
    parent.registerSecret(SECRET);
    child.info(`leak ${SECRET}`);
    child.registerSecret('another-secret-value');
    parent.info('leak another-secret-value');
    const first = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(first.tool).toBe('run-test');
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(lines.join('\n')).not.toContain('another-secret-value');
  });

  it('never serializes bytes: Buffer, Uint8Array and ArrayBuffer become a placeholder', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.registerSecret(SECRET);
    const bytes = Buffer.from(SECRET, 'utf8');
    logger.info('bin', {
      buf: bytes,
      u8: new Uint8Array(bytes),
      nested: { list: [new Uint8Array(bytes)], ab: new Uint8Array(bytes).buffer },
    });
    const line = lines[0] ?? '';
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain(Array.from(bytes).join(','));
    expect(line).not.toContain('"0":67');
    const record = JSON.parse(line) as { buf: string; u8: string };
    expect(record.buf).toBe(`[binary ${bytes.length} bytes]`);
    expect(record.u8).toBe(`[binary ${bytes.length} bytes]`);
  });

  it('logs error causes in the same masked shape, with depth limit and cycle guard', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.registerSecret(SECRET);
    const root = new Error(`root ${SECRET}`);
    const top = new Error('top', { cause: root });
    logger.error('failed', { err: top });
    const rec = JSON.parse(lines[0] ?? '') as {
      err: { cause: { name: string; message: string; stack: string } };
    };
    expect(rec.err.cause.name).toBe('Error');
    expect(rec.err.cause.message).toBe('root [redacted]');
    expect(rec.err.cause.stack).not.toContain(SECRET);

    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    logger.error('cyclic', { err: a });
    expect(lines[1]).toContain('[circular]');

    let chain = new Error('leaf');
    for (let i = 0; i < 20; i += 1) chain = new Error(`e${i}`, { cause: chain });
    logger.error('deep', { err: chain });
    expect(lines[2]).toContain('[max depth]');
  });

  it('logs Date as an ISO string', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    logger.info('d', { at: new Date('2026-11-22T10:00:00.000Z'), bad: new Date(NaN) });
    const rec = JSON.parse(lines[0] ?? '') as { at: string; bad: string };
    expect(rec.at).toBe('2026-11-22T10:00:00.000Z');
    expect(rec.bad).toBe('[invalid date]');
  });

  it('survives circular fields', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'info', sink });
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    logger.info('circular', { loop });
    expect(lines).toHaveLength(1);
  });
});

describe('sdkLogger', () => {
  it('routes debug, info, warn, error and log to the logger, masked', () => {
    const { lines, sink } = collect();
    const logger = createLogger({ level: 'debug', sink });
    logger.registerSecret(SECRET);
    const sdk = sdkLogger(logger);
    sdk.debug('a', SECRET);
    sdk.info('b');
    sdk.warn('c', { token: SECRET });
    sdk.error('d', new Error(SECRET));
    sdk.log('e');
    expect(lines).toHaveLength(5);
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
      'debug',
    ]);
    expect(lines.join('\n')).not.toContain(SECRET);
  });
});
