/**
 * The one place where the MCP server talks to the WebSocket channels of the backend.
 *
 * `openChannel` resolves once the socket is open and returns a single-consumer stream of parsed
 * frames. It gives the same guarantees as the REST client: a time limit on opening, abort through
 * a signal, the API token only in a header and only on channels that require it, and a predictable
 * error. The library is `ws` rather than the global `WebSocket` of Node: the global one does accept
 * custom headers, but reports a handshake refused with HTTP 403 exactly like an unreachable host
 * (an `error` event and close code 1006, no status), and the two need different answers.
 */
import { WebSocket } from 'ws';
import type { RawData } from 'ws';

import type { Config } from '../config.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { Masker } from '../security/mask.js';
import type { Logger } from '../log.js';
import { VERSION } from '../version.js';
import { CLIENT_SCHEMAS, FrameParseError, parseFrame } from './frames.js';
import type { Channel, ParsedFrame } from './frames.js';
import { apiOrigin, channelRequirement, channelUrl, redactUrl } from './url.js';
import type { ChannelParams, ChannelRequirement } from './url.js';

// ---- public types -----------------------------------------------------------------------

export interface ReconnectPolicy {
  /** Reconnect attempts in a row without a frame in between before the channel counts as lost. */
  readonly attempts: number;
  /** Wait before attempt n (the last value repeats). */
  readonly delaysMs: readonly number[];
}

export const DEFAULT_RECONNECT: ReconnectPolicy = Object.freeze({
  attempts: 3,
  delaysMs: Object.freeze([500, 2000, 5000]),
});

/** Time source; structurally the clock of long-running operations, so tests move time by hand. */
export interface ChannelClock {
  now(): number;
  /** Resolves after `ms`; may reject or never settle once `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface ChannelContext {
  readonly config: Pick<Config, 'apiUrl' | 'token'>;
  readonly log: Logger;
  readonly signal?: AbortSignal;
}

export interface OpenChannelOptions<C extends Channel> {
  readonly channel: C;
  readonly params: ChannelParams<C>;
  /** Aborts the channel at once; combined with the signal of the context. */
  readonly signal?: AbortSignal;
  /** Opening handshake limit; default 10 s. */
  readonly openTimeoutMs?: number;
  /** The channel counts as lost after this long without any frame; no limit by default. */
  readonly silenceMs?: number;
  /** Reconnect after the channel is lost and keep the stream going; off by default. */
  readonly reconnect?: ReconnectPolicy;
  readonly clock?: ChannelClock;
}

/** A message the plugin sends: `{type, ...keys}`, flat on every channel. */
export interface ClientMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface CloseInfo {
  /** Close code of the last socket; 1006 when it was dropped without a close frame. */
  readonly code: number;
  readonly reason: string;
  /** Why the stream failed, when it did. */
  readonly error?: Error;
}

export interface ChannelHandle<C extends Channel> {
  /** Known frames of the channel in arrival order; keep-alive and unknown frames are skipped. */
  readonly frames: AsyncIterable<ParsedFrame<C>>;
  send(message: ClientMessage): void;
  /** Closes the socket (code 1000) and ends the stream. */
  close(): void;
  /** Settles once the stream ended and no socket is left open. Never rejects. */
  readonly closed: Promise<CloseInfo>;
}

export type ChannelLostReason = 'closed' | 'silence';

/** The connection ended unexpectedly. Not a tool error: the caller decides (e.g. falls back to REST). */
export class ChannelLost extends Error {
  override readonly name = 'ChannelLost';
  readonly closeCode?: number;

  constructor(
    readonly channel: Channel,
    readonly reason: ChannelLostReason,
    closeCode: number | undefined,
    /** Reconnect attempts made before giving up. */
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    const why =
      reason === 'silence'
        ? 'no frame arrived within the silence limit'
        : `close code ${String(closeCode ?? 1006)}`;
    const tried = attempts > 0 ? `, ${String(attempts)} reconnect attempts failed` : '';
    super(`The "${channel}" channel was lost (${why}${tried}).`, options);
    if (closeCode !== undefined) this.closeCode = closeCode;
  }
}

/** The socket could not be opened (network, proxy, TLS, time limit). The tool can offer a way without the channel. */
export class ChannelUnavailable extends Error {
  override readonly name = 'ChannelUnavailable';

  constructor(
    readonly channel: Channel,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

// ---- internals --------------------------------------------------------------------------

const OPEN_TIMEOUT_MS = 10_000;
const NORMAL_CLOSURE = 1000;
const ABNORMAL_CLOSURE = 1006;
const KEEP_ALIVE_TYPES = new Set(['heartbeat', 'ping']);

/** What the connection presents, derived from the channel's requirement in the frame contract. */
type ChannelAuth = 'none' | 'token' | 'token+origin';

const AUTH_FOR: Record<ChannelRequirement, ChannelAuth> = {
  none: 'none',
  identity: 'token',
  identity_and_origin: 'token+origin',
};

const systemClock: ChannelClock = {
  now: () => Date.now(),
  sleep(ms, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError(signal));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(abortError(signal));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  },
};

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves after `ms` on `clock`; rejects with the abort reason as soon as `signal` aborts. */
function wait(clock: ChannelClock, ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([clock.sleep(ms, signal), aborted]).finally(() => {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  });
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function refusalForClose(
  channel: Channel,
  code: number,
  reason: string,
): LoadcraftApiError | undefined {
  const said = reason === '' ? '' : `: ${reason}`;
  const details = { channel, closeCode: code };
  switch (code) {
    case 4001:
      return new LoadcraftApiError({
        status: 401,
        code: 'unauthorized',
        message: `The "${channel}" channel did not accept the API token (close code 4001${said}).`,
        details,
      });
    case 4003:
      return new LoadcraftApiError({
        status: 403,
        code: 'forbidden',
        message: `The "${channel}" channel refused access (close code 4003${said}).`,
        details,
      });
    case 4404:
      return new LoadcraftApiError({
        status: 404,
        code: 'not_found',
        message: `The "${channel}" channel does not know this job or run: it is unknown or has expired (close code 4404${said}).`,
        details,
      });
    default:
      return undefined;
  }
}

function refusalForStatus(channel: Channel, status: number): LoadcraftApiError | undefined {
  const details = { channel, httpStatus: status };
  switch (status) {
    case 401:
      return new LoadcraftApiError({
        status,
        code: 'unauthorized',
        message: `The "${channel}" channel refused the handshake (HTTP 401): the API token was not accepted.`,
        details,
      });
    case 403:
      return new LoadcraftApiError({
        status,
        code: 'forbidden',
        message:
          `The "${channel}" channel refused the handshake (HTTP 403). The server compares the Origin ` +
          'header with the address it is reached at, so LOADCRAFT_API_URL must be the public address of the API.',
        details,
      });
    case 404:
      return new LoadcraftApiError({
        status,
        code: 'not_found',
        message: `The "${channel}" channel address was not found (HTTP 404).`,
        details,
      });
    default:
      return undefined;
  }
}

function isRefusal(error: unknown): error is LoadcraftApiError {
  return error instanceof LoadcraftApiError;
}

type Terminal = { readonly kind: 'done' } | { readonly kind: 'error'; readonly error: Error };

interface Waiter<C extends Channel> {
  resolve(result: IteratorResult<ParsedFrame<C>>): void;
  reject(error: Error): void;
}

class ChannelSession<C extends Channel> {
  private readonly channel: C;
  private readonly url: URL;
  private readonly safeUrl: string;
  private readonly auth: ChannelAuth;
  private readonly token: string;
  private readonly masker = new Masker();
  private readonly origin: string;
  private readonly log: Logger;
  private readonly clock: ChannelClock;
  private readonly openTimeoutMs: number;
  private readonly silenceMs: number | undefined;
  private readonly reconnect: ReconnectPolicy | undefined;
  /** Aborted by the caller's signals or by `close()`. */
  private readonly stop = new AbortController();
  private readonly signal: AbortSignal;

  private ws: WebSocket | undefined;
  private readonly queue: ParsedFrame<C>[] = [];
  private readonly waiters: Waiter<C>[] = [];
  private terminal: Terminal | undefined;
  private failedAttempts = 0;
  private lastClose: { code: number; reason: string } = { code: ABNORMAL_CLOSURE, reason: '' };
  private silence: AbortController | undefined;
  private resolveClosed: ((info: CloseInfo) => void) | undefined;
  readonly closed: Promise<CloseInfo>;

  constructor(ctx: ChannelContext, options: OpenChannelOptions<C>) {
    this.channel = options.channel;
    this.url = channelUrl(ctx.config.apiUrl, options.channel, options.params);
    this.safeUrl = redactUrl(this.url);
    // The token goes only to channels that require it, and every channel that requires it gets it.
    this.auth = AUTH_FOR[channelRequirement(options.channel)];
    this.token = ctx.config.token.reveal();
    this.origin = apiOrigin(ctx.config.apiUrl);
    this.log = ctx.log.child({ channel: options.channel, url: this.safeUrl });
    this.clock = options.clock ?? systemClock;
    this.openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;
    this.silenceMs = options.silenceMs;
    this.reconnect = options.reconnect;
    const signals = [ctx.signal, options.signal, this.stop.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    this.signal = AbortSignal.any(signals);
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    ctx.log.registerSecret(this.token);
    this.masker.add(this.token);
  }

  async start(): Promise<void> {
    await this.connect();
    // Ended between the 'open' event and this continuation by the stream itself (a frame outside
    // the contract, a close): the frames already read and that failure are delivered by the stream.
    if (this.terminal !== undefined) return;
    if (this.signal.aborted) {
      // Aborted between the 'open' event and this continuation.
      this.onAbort();
      throw abortError(this.signal);
    }
    this.signal.addEventListener('abort', this.onAbort, { once: true });
  }

  handle(): ChannelHandle<C> {
    const frames: AsyncIterable<ParsedFrame<C>> = {
      [Symbol.asyncIterator]: () => ({
        next: () => this.next(),
        return: () => {
          this.close();
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    };
    return {
      frames,
      send: (message) => this.send(message),
      close: () => this.close(),
      closed: this.closed,
    };
  }

  // ---- connecting ----

  /**
   * One opening attempt: binds the socket to the session as it opens and resolves, or rejects with
   * a classified error. Binding happens inside the 'open' event: frames the server sends right
   * after accepting arrive before any promise continuation would run.
   */
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(abortError(this.signal));
        return;
      }
      const headers: Record<string, string> = { 'User-Agent': `loadcraft-mcp/${VERSION}` };
      if (this.auth !== 'none') headers['Authorization'] = `Bearer ${this.token}`;
      this.log.debug('channel opening');
      const ws = new WebSocket(this.url, {
        headers,
        ...(this.auth === 'token+origin' ? { origin: this.origin } : {}),
        followRedirects: false,
        perMessageDeflate: false,
      });

      let settled = false;
      let status: number | undefined;
      const timer = new AbortController();
      const settle = (error?: Error): void => {
        if (settled) return;
        settled = true;
        timer.abort();
        this.signal.removeEventListener('abort', onAbort);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onAbort = (): void => {
        ws.terminate();
        settle(abortError(this.signal));
      };

      // A listener stays for the socket's whole life: `ws` throws an 'error' event nobody hears.
      ws.on('error', (error: Error) => {
        if (settled) {
          this.log.debug('channel socket error', { error });
          return;
        }
        settle(this.openFailure(error, status));
      });
      ws.once('unexpected-response', (_request, response) => {
        status = response.statusCode;
        response.resume();
        ws.terminate();
      });
      ws.once('open', () => {
        this.log.debug('channel open');
        this.bind(ws);
        settle();
      });
      this.signal.addEventListener('abort', onAbort, { once: true });
      wait(this.clock, this.openTimeoutMs, timer.signal).then(
        () => {
          if (settled) return;
          ws.terminate();
          settle(
            new ChannelUnavailable(
              this.channel,
              `The "${this.channel}" channel at ${this.safeUrl} did not open within ${String(this.openTimeoutMs / 1000)} s.`,
            ),
          );
        },
        () => undefined,
      );
    });
  }

  private openFailure(error: Error, status: number | undefined): Error {
    if (status !== undefined) {
      const refusal = refusalForStatus(this.channel, status);
      if (refusal !== undefined) return refusal;
      return new ChannelUnavailable(
        this.channel,
        `The "${this.channel}" channel at ${this.safeUrl} answered the handshake with HTTP ${String(status)}.`,
      );
    }
    return new ChannelUnavailable(
      this.channel,
      `The "${this.channel}" channel at ${this.safeUrl} could not be opened: ${this.scrub(error.message)}`,
      { cause: error },
    );
  }

  // ---- an open socket ----

  private bind(ws: WebSocket): void {
    this.ws = ws;
    ws.on('message', (data: RawData, isBinary: boolean) => this.onMessage(data, isBinary));
    ws.on('ping', () => this.armSilence());
    ws.on('close', (code: number, reason: Buffer) => this.onClose(ws, code, reason));
    this.armSilence();
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.terminal !== undefined) return;
    this.armSilence();
    let parsed: ReturnType<typeof parseFrame<C>>;
    try {
      if (isBinary) {
        throw new FrameParseError(
          this.channel,
          '',
          '',
          'binary frames are not part of the contract',
        );
      }
      parsed = parseFrame(this.channel, textOf(data));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.log.warn('channel frame rejected', { error: failure });
      this.fail(failure);
      return;
    }
    if (parsed.kind === 'unknown') {
      const what = KEEP_ALIVE_TYPES.has(parsed.type) ? 'keep-alive' : 'unknown';
      this.log.debug(`channel skipped ${what} frame`, { type: parsed.type });
      return;
    }
    this.failedAttempts = 0;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) waiter.resolve({ done: false, value: parsed });
    else this.queue.push(parsed);
  }

  private onClose(ws: WebSocket, code: number, reasonBytes: Buffer): void {
    const reason = this.scrub(reasonBytes.toString('utf8'));
    if (ws !== this.ws) return;
    this.ws = undefined;
    this.disarmSilence();
    this.lastClose = { code, reason };
    this.log.debug('channel closed', { code, reason });
    if (this.terminal !== undefined) {
      this.settleClosed();
      return;
    }
    if (code === NORMAL_CLOSURE) {
      this.finish({ kind: 'done' });
      return;
    }
    const refusal = refusalForClose(this.channel, code, reason);
    if (refusal !== undefined) {
      this.fail(refusal);
      return;
    }
    this.lost('closed', code);
  }

  private armSilence(): void {
    if (this.silenceMs === undefined) return;
    this.disarmSilence();
    const timer = new AbortController();
    this.silence = timer;
    const ws = this.ws;
    wait(this.clock, this.silenceMs, timer.signal).then(
      () => {
        if (this.silence !== timer || ws === undefined || ws !== this.ws) return;
        this.ws = undefined;
        this.silence = undefined;
        ws.terminate();
        this.lost('silence', undefined);
      },
      () => undefined,
    );
  }

  private disarmSilence(): void {
    this.silence?.abort();
    this.silence = undefined;
  }

  // ---- losing and reconnecting ----

  private lost(reason: ChannelLostReason, closeCode: number | undefined): void {
    this.log.info('channel lost', { reason, ...(closeCode === undefined ? {} : { closeCode }) });
    const policy = this.reconnect;
    if (policy === undefined || policy.attempts <= 0) {
      this.fail(new ChannelLost(this.channel, reason, closeCode, 0));
      return;
    }
    void this.reconnectLoop(policy, reason, closeCode);
  }

  private async reconnectLoop(
    policy: ReconnectPolicy,
    reason: ChannelLostReason,
    closeCode: number | undefined,
  ): Promise<void> {
    let lastError: unknown;
    while (this.failedAttempts < policy.attempts) {
      const attempt = this.failedAttempts + 1;
      const delayMs = policy.delaysMs[Math.min(attempt, policy.delaysMs.length) - 1] ?? 0;
      this.failedAttempts = attempt;
      this.log.debug('channel reconnect scheduled', { attempt, delayMs });
      try {
        await wait(this.clock, delayMs, this.signal);
        await this.connect();
        this.log.info('channel reconnected', { attempt });
        return;
      } catch (error) {
        if (this.terminal !== undefined) return;
        if (this.signal.aborted || isRefusal(error)) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        lastError = error;
        this.log.info('channel reconnect failed', { attempt, error });
      }
    }
    this.fail(
      new ChannelLost(this.channel, reason, closeCode, policy.attempts, { cause: lastError }),
    );
  }

  // ---- ending ----

  private readonly onAbort = (): void => {
    if (this.terminal !== undefined) return;
    this.queue.length = 0;
    this.ws?.terminate();
    this.fail(abortError(this.signal));
  };

  private fail(error: Error): void {
    if (this.terminal !== undefined) return;
    if (this.ws !== undefined && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(NORMAL_CLOSURE);
    }
    this.finish({ kind: 'error', error });
  }

  private finish(terminal: Terminal): void {
    if (this.terminal !== undefined) return;
    this.terminal = terminal;
    this.disarmSilence();
    this.signal.removeEventListener('abort', this.onAbort);
    if (!this.stop.signal.aborted) this.stop.abort();
    for (const waiter of this.waiters.splice(0)) {
      if (terminal.kind === 'done') waiter.resolve({ done: true, value: undefined });
      else waiter.reject(terminal.error);
    }
    if (this.ws === undefined) this.settleClosed();
  }

  private settleClosed(): void {
    const resolve = this.resolveClosed;
    if (resolve === undefined) return;
    this.resolveClosed = undefined;
    const error = this.terminal?.kind === 'error' ? this.terminal.error : undefined;
    resolve({ ...this.lastClose, ...(error === undefined ? {} : { error }) });
  }

  close(): void {
    if (this.terminal !== undefined) return;
    this.log.debug('channel closing');
    this.queue.length = 0;
    const ws = this.ws;
    this.finish({ kind: 'done' });
    if (ws !== undefined && ws.readyState === WebSocket.OPEN) ws.close(NORMAL_CLOSURE);
  }

  // ---- consumer side ----

  private next(): Promise<IteratorResult<ParsedFrame<C>>> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve({ done: false, value: queued });
    if (this.terminal?.kind === 'done') return Promise.resolve({ done: true, value: undefined });
    if (this.terminal?.kind === 'error') return Promise.reject(this.terminal.error);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private send(message: ClientMessage): void {
    const { type, ...keys } = message;
    const schema = CLIENT_SCHEMAS[this.channel][type];
    if (schema === undefined) {
      throw new Error(`The "${this.channel}" channel takes no client message "${type}".`);
    }
    const checked = schema.safeParse(keys);
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const field = (issue?.path ?? []).map(String).join('.');
      throw new Error(
        `Client message "${type}" on the "${this.channel}" channel: field "${field}" ${issue?.message ?? 'is invalid'}.`,
      );
    }
    const ws = this.ws;
    if (this.terminal !== undefined || ws === undefined || ws.readyState !== WebSocket.OPEN) {
      const state = this.terminal === undefined ? 'reconnecting' : 'closed';
      throw new Error(
        `Cannot send "${type}" on the "${this.channel}" channel: the channel is ${state}.`,
      );
    }
    ws.send(JSON.stringify(message));
  }

  private scrub(text: string): string {
    return this.masker.text(text);
  }
}

/**
 * Opens a channel and resolves once the socket is open. What the connection presents (bearer
 * token, Origin) follows `channelRequirement(channel)`; the caller does not choose it.
 * Rejects with `LoadcraftApiError` (refused: `unauthorized`, `forbidden`, `not_found`),
 * `ChannelUnavailable` (the socket cannot be opened) or the abort reason. Later failures reject the frame stream with the same types or
 * with `ChannelLost`, `FrameParseError`.
 */
export async function openChannel<C extends Channel>(
  ctx: ChannelContext,
  options: OpenChannelOptions<C>,
): Promise<ChannelHandle<C>> {
  const session = new ChannelSession(ctx, options);
  await session.start();
  return session.handle();
}
