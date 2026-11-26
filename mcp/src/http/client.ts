// The only way the MCP server talks to the LoadCraft REST API: an openapi-fetch client typed by the
// contract snapshot, with the API token, a time limit, retries for reads and one error shape.
//
// Every non-2xx answer, time limit and network failure is thrown as `LoadcraftApiError`, so a call
// that returns always carries `data`. Per-call options next to `params`/`body`:
//   signal     - the caller's AbortSignal; aborting rejects with an AbortError
//   timeoutMs  - time limit of the whole call (retries included), default DEFAULT_TIMEOUT_MS
//   maxResponseBytes - limit of a successful answer's decoded body, default MAX_RESPONSE_BYTES;
//                the body is read as a stream and the call fails with `response_too_large` as soon
//                as the limit is crossed. An error answer is read up to ERROR_BODY_LIMIT_BYTES.

import createClient, { type Client } from 'openapi-fetch';

import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { abortError, systemClock, type Clock } from '../ops/clock.js';
import { CallSecretScope } from '../workspace/secrets.js';
import { VERSION } from '../version.js';
import {
  apiErrorInit,
  codeForStatus,
  LoadcraftApiError,
  type LoadcraftApiErrorInit,
} from './apiError.js';
import type { paths } from './generated/api.js';

export type HttpClient = Client<paths>;

export interface HttpOptions {
  /** Drives the time limit and the pauses between retries; tests inject a controlled clock. */
  clock?: Clock;
  /**
   * Drives only the pauses between retries (default: `clock`): a server under test waits for them on
   * its controlled clock while the time limit of a request in flight stays on real time.
   */
  pauseClock?: Clock;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Default limit of a successful answer's body (after decompression). */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** An error answer only needs enough of its body to say what went wrong. */
export const ERROR_BODY_LIMIT_BYTES = 64 * 1024;
/** Pauses before the 2nd and 3rd attempt of a GET; writes are never repeated. */
export const RETRY_DELAYS_MS: readonly number[] = [250, 1000];
const RETRY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
/** Answers that send the caller to another address; the client reports them and never follows. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);
const API_PATH = '/api/v1';
const DOCTOR = '/loadcraft:doctor';

/** Snapshot paths start with /api/v1, so the base is the API URL without that suffix. */
function baseUrlOf(apiUrl: string): string {
  const url = new URL(apiUrl);
  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(API_PATH)) return `${url.origin}${path.slice(0, -API_PATH.length)}`;
  return url.origin;
}

function timeoutOf(request: Request): number {
  // openapi-fetch copies unknown init keys onto the Request it builds.
  const value: unknown = Reflect.get(request, 'timeoutMs');
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('timeoutMs must be a positive number of milliseconds');
  }
  return value;
}

function maxResponseBytesOf(request: Request): number {
  const value: unknown = Reflect.get(request, 'maxResponseBytes');
  if (value === undefined) return MAX_RESPONSE_BYTES;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('maxResponseBytes must be a positive whole number of bytes');
  }
  return value;
}

/**
 * Reads the body chunk by chunk and stops (cancelling the transfer) once `limit` bytes were seen.
 * `truncated` tells that more was left on the wire; the bytes returned never exceed the limit.
 */
async function readCapped(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; truncated: boolean }> {
  const stream = response.body;
  if (stream === null) return { bytes: new Uint8Array(0), truncated: false };
  const reader: ReadableStreamDefaultReader<Uint8Array> = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = limit - total;
      if (value.byteLength > room) {
        if (room > 0) chunks.push(value.subarray(0, room));
        total += Math.max(room, 0);
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

/** Fires once `ms` passed on the clock; `stop` drops the pending wait. */
function startTimer(clock: Clock, ms: number): { signal: AbortSignal; stop(): void } {
  const fired = new AbortController();
  const cancel = new AbortController();
  clock.sleep(ms, cancel.signal).then(
    () => fired.abort(),
    () => undefined,
  );
  return { signal: fired.signal, stop: () => cancel.abort() };
}

interface Outcome {
  response: Response;
  body: Uint8Array<ArrayBuffer>;
  /** An error body that was cut at ERROR_BODY_LIMIT_BYTES and so cannot be read as JSON. */
  truncated: boolean;
}

class NetworkFailure extends Error {
  override readonly name = 'NetworkFailure';
}

/** undici wraps the socket error ("connect ECONNREFUSED …") in a generic "fetch failed". */
function innermostMessage(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (!(current.cause instanceof Error)) return current.message;
    current = current.cause;
  }
  return 'connection failed';
}

/** Host (with port) a `Location` points at, nothing else: the query and fragment may hold secrets. */
function redirectHost(location: string | null, base: string): string {
  if (location === null) return '';
  try {
    return new URL(location, base).host;
  } catch {
    return '';
  }
}

export function createHttp(config: Config, log: Logger, options: HttpOptions = {}): HttpClient {
  const clock = options.clock ?? systemClock;
  const pauseClock = options.pauseClock ?? clock;
  const baseUrl = baseUrlOf(config.apiUrl);
  // Registers the token with the shared logger too; error texts from the backend are scrubbed here.
  const secrets = new CallSecretScope(log);
  secrets.add(config.token.reveal());
  const httpLog = log.child({ component: 'http' });

  const fail = (init: LoadcraftApiErrorInit): LoadcraftApiError =>
    new LoadcraftApiError({
      ...init,
      message: secrets.scrub(init.message),
      ...(init.details === undefined ? {} : { details: secrets.scrubDeep(init.details) }),
    });

  const send = async (request: Request): Promise<Response> => {
    const caller = request.signal;
    if (caller.aborted) throw abortError(caller);
    const timeoutMs = timeoutOf(request);
    const maxResponseBytes = maxResponseBytesOf(request);
    const token = config.token.reveal();
    if (token === '') {
      throw new LoadcraftApiError({
        status: 0,
        code: 'unauthorized',
        message: 'No LoadCraft API token is configured (LOADCRAFT_API_TOKEN).',
        hint: `Set the API token in the plugin options, then run ${DOCTOR}.`,
      });
    }

    const { pathname } = new URL(request.url);
    const method = request.method;
    const delays = method === 'GET' ? RETRY_DELAYS_MS : [];
    const timer = startTimer(clock, timeoutMs);
    const signal = AbortSignal.any([caller, timer.signal]);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('User-Agent', `loadcraft-mcp/${VERSION}`);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const started = clock.now();

    const attempt = async (n: number): Promise<Outcome> => {
      try {
        // The signal goes straight into fetch: a throwaway `new Request(request, {signal})` passed to
        // fetch is only weakly linked to it and, once garbage-collected, the abort never arrives.
        // `manual`: a redirect must not carry the token to an address the user did not configure.
        const response = await fetch(request, { headers, signal, redirect: 'manual' });
        const limit = response.ok ? maxResponseBytes : ERROR_BODY_LIMIT_BYTES;
        const { bytes, truncated } = await readCapped(response, limit);
        if (truncated && response.ok) {
          httpLog.warn('http response too large', {
            method,
            path: pathname,
            status: response.status,
            limitBytes: maxResponseBytes,
          });
          throw fail({
            status: response.status,
            code: 'response_too_large',
            message: `LoadCraft API answer to ${method} ${pathname} is larger than ${String(maxResponseBytes)} bytes.`,
            details: { limitBytes: maxResponseBytes },
          });
        }
        return { response, body: bytes, truncated };
      } catch (error) {
        if (error instanceof LoadcraftApiError) throw error;
        if (signal.aborted) throw error;
        throw new NetworkFailure(`attempt ${String(n + 1)} failed`, { cause: error });
      }
    };

    try {
      for (let n = 0; ; n += 1) {
        const delay = delays[n];
        let outcome: Outcome;
        try {
          outcome = await attempt(n);
        } catch (error) {
          if (!(error instanceof NetworkFailure) || delay === undefined) throw error;
          httpLog.warn('http retry', { method, path: pathname, attempt: n + 1, reason: 'network' });
          await pauseClock.sleep(delay, signal);
          continue;
        }
        const { response, body, truncated } = outcome;
        const { status } = response;
        httpLog.debug('http response', {
          method,
          path: pathname,
          status,
          attempt: n + 1,
          ms: clock.now() - started,
        });
        if (REDIRECT_STATUSES.has(status)) {
          const host = redirectHost(response.headers.get('Location'), request.url);
          httpLog.warn('http unexpected redirect', { method, path: pathname, status, host });
          throw fail({
            status,
            code: 'unexpected_redirect',
            message: `LoadCraft API answered ${method} ${pathname} with a redirect (HTTP ${String(status)}) to ${host === '' ? 'an unknown address' : host}; the plugin does not follow redirects.`,
            details: { method, path: pathname, status, host },
            hint: 'Check the LoadCraft address in the plugin options (http or https, a trailing slash).',
          });
        }
        if (RETRY_STATUSES.has(status) && delay !== undefined) {
          httpLog.warn('http retry', { method, path: pathname, attempt: n + 1, status });
          await pauseClock.sleep(delay, signal);
          continue;
        }
        if (!response.ok) {
          throw fail(
            truncated
              ? {
                  status,
                  code: codeForStatus(status),
                  message: `LoadCraft API answered HTTP ${String(status)} with a body too large to read.`,
                  retryable: RETRY_STATUSES.has(status),
                }
              : // Masked before it is read: the quote of a body that is not JSON is cut short.
                apiErrorInit(status, secrets.scrub(new TextDecoder().decode(body))),
          );
        }
        // The body is already decoded and complete; its headers must describe it, not the wire form.
        const out = new Headers(response.headers);
        out.delete('Content-Encoding');
        out.set('Content-Length', String(body.byteLength));
        return new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
          status,
          statusText: response.statusText,
          headers: out,
        });
      }
    } catch (error) {
      if (error instanceof LoadcraftApiError) throw error;
      if (caller.aborted) throw abortError(caller);
      if (timer.signal.aborted) {
        httpLog.warn('http timeout', { method, path: pathname, timeoutMs });
        throw new LoadcraftApiError({
          status: 0,
          code: 'timeout',
          message: `LoadCraft API did not answer ${method} ${pathname} within ${String(timeoutMs / 1000)} s.`,
          retryable: true,
        });
      }
      if (error instanceof NetworkFailure) {
        const reason = innermostMessage(error.cause);
        httpLog.warn('http network error', { method, path: pathname, reason });
        throw fail({
          status: 0,
          code: 'network_error',
          message: `LoadCraft API at ${baseUrl} is unreachable (${method} ${pathname}: ${reason}).`,
          retryable: true,
        });
      }
      throw error;
    } finally {
      timer.stop();
    }
  };

  return createClient<paths>({ baseUrl, fetch: send });
}
