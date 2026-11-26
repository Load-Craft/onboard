// Logger for the MCP server. stdout belongs to the MCP protocol, so every line goes to stderr
// (or to an injected sink) and every registered secret is masked before serialization.

import { Masker, MIN_SECRET_LENGTH } from './security/mask.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Mask every later occurrence of `value` in all its encodings (see `security/mask.ts`). Values under MIN_SECRET_LENGTH chars are ignored. */
  registerSecret(value: string): void;
  /** Logger that adds `fields` to every record; shares the level, sink and secret registry. */
  child(fields: LogFields): Logger;
  /**
   * Like `child`, but with its own secret registry: it masks everything this logger masks (also what
   * is registered here later), while values registered on the scope never reach this logger.
   */
  scope(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  /** Receives one JSON line (without trailing newline). Default: process.stderr. */
  sink?: (line: string) => void;
}

/** Shape the MCP SDK / Ajv expect from a custom logger; all methods accept arbitrary arguments. */
export interface SdkLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export { MIN_SECRET_LENGTH };
const MAX_CAUSE_DEPTH = 5;
const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Walks a log record and masks every string in it; bytes are never decoded or enumerated. */
class RecordMasker {
  constructor(private readonly masker: Masker) {}

  private text(input: string): string {
    return this.masker.text(input);
  }

  private error(input: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
    seen.add(input);
    const out: Record<string, unknown> = {
      name: this.text(input.name),
      message: this.text(input.message),
      stack: this.text(input.stack ?? ''),
    };
    if (input.cause !== undefined) {
      const cause: unknown = input.cause;
      if (depth >= MAX_CAUSE_DEPTH) out.cause = '[max depth]';
      else if (cause instanceof Error) {
        out.cause = seen.has(cause) ? '[circular]' : this.error(cause, seen, depth + 1);
      } else out.cause = this.value(cause, seen);
    }
    return out;
  }

  value(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof input === 'string') return this.text(input);
    if (input instanceof Error) return this.error(input, seen, 0);
    if (typeof input === 'bigint') return this.text(input.toString());
    if (typeof input !== 'object' || input === null) return input;
    // Bytes are never decoded or enumerated: a secret could be rebuilt from them.
    if (ArrayBuffer.isView(input)) return `[binary ${input.byteLength} bytes]`;
    if (input instanceof ArrayBuffer || input instanceof SharedArrayBuffer) {
      return `[binary ${input.byteLength} bytes]`;
    }
    if (input instanceof Date) {
      return Number.isNaN(input.getTime()) ? '[invalid date]' : input.toISOString();
    }
    if (seen.has(input)) return '[circular]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => this.value(item, seen));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) out[this.text(key)] = this.value(item, seen);
    return out;
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? defaultSink;
  return build(options.level, sink, new Masker(), {});
}

function build(
  level: LogLevel,
  sink: (line: string) => void,
  masker: Masker,
  base: LogFields,
): Logger {
  const emit = (at: LogLevel, msg: string, fields?: LogFields): void => {
    if (RANK[at] < RANK[level]) return;
    const record = new RecordMasker(masker).value({
      ts: new Date().toISOString(),
      level: at,
      msg,
      ...base,
      ...fields,
    });
    sink(JSON.stringify(record));
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    registerSecret: (value) => masker.add(value),
    child: (fields) => build(level, sink, masker, { ...base, ...fields }),
    scope: (fields) => build(level, sink, masker.fork(), { ...base, ...fields }),
  };
}

/** Adapter for SDKs whose default logger is `console` (console.debug would hit stdout). */
export function sdkLogger(logger: Logger): SdkLogger {
  const route =
    (at: LogLevel) =>
    (...args: unknown[]): void => {
      const [first, ...rest] = args;
      const msg = typeof first === 'string' ? first : 'sdk';
      const extra = typeof first === 'string' ? rest : args;
      logger[at](msg, extra.length > 0 ? { args: extra } : undefined);
    };
  return {
    debug: route('debug'),
    info: route('info'),
    log: route('debug'),
    warn: route('warn'),
    error: route('error'),
  };
}
