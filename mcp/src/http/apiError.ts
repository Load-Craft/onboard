// One error shape for every refusal of the LoadCraft API, whether it came over HTTP or as the
// close code of a WebSocket channel. `apiErrorInit` reads an HTTP error body into this shape.

import { ToolError } from '../errors.js';
import { hideSecretFields, secretFieldMasker } from '../security/secretFields.js';

export interface LoadcraftApiErrorInit {
  /** HTTP status, or the status a WebSocket close code stands for (4001 → 401, 4003 → 403, 4404 → 404). */
  status: number;
  /** Stable machine code: `unauthorized`, `forbidden`, `not_found`, … */
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  /** Next step for the model; shown on its own line after the message. */
  hint?: string;
  /**
   * The text of the body the model is not shown (5xx, 401), masked and cut short, for the log
   * only. The registry writes it to the log of the call, which also knows the secrets of the call.
   */
  logText?: string;
  cause?: unknown;
}

export class LoadcraftApiError extends ToolError {
  readonly status: number;
  readonly retryable: boolean;
  readonly logText?: string;

  constructor(init: LoadcraftApiErrorInit) {
    super(init.code, {
      message: init.message,
      ...(init.details === undefined ? {} : { details: init.details }),
      ...(init.hint === undefined ? {} : { hint: init.hint }),
      ...(init.cause === undefined ? {} : { cause: init.cause }),
    });
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    if (init.logText !== undefined) this.logText = init.logText;
  }
}

/** Machine code for a body that names none: `{detail: "text"}`, an empty body, a validation list. */
const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'invalid',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  422: 'invalid',
  429: 'rate_limited',
  500: 'server_error',
  502: 'bad_gateway',
  503: 'unavailable',
  504: 'gateway_timeout',
};
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
const SNIPPET_LENGTH = 200;
/** Fields that become `code`, `message` and `retryable`; everything else of the body goes to `details`. */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['error', 'code', 'message', 'retryable']);

export function codeForStatus(status: number): string {
  return STATUS_CODES[status] ?? `http_${String(status)}`;
}

/**
 * Whether the text of a backend answer with this status may be quoted to the model. A server
 * failure (5xx) and a refused token (401) carry text the plugin cannot vouch for - a stack trace,
 * a connection string, the token echoed back - so the model gets the code, the status and a hint,
 * and the text goes to the log, masked and cut short. A refusal of the input (400, 403, 404, 409,
 * 422, 429, ...) stays quoted: it names the cause the model has to fix. A failure that reports
 * no status (an `error` frame of a WebSocket channel) is treated as a server failure.
 */
export function quotesBackendText(status: number | undefined): boolean {
  return status !== undefined && status < 500 && status !== 401;
}

/** A machine code a body names that is safe to show: a lower-case identifier, not free text. */
const PLAIN_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

/** The logged text of a body the model is not shown, in characters. */
const LOG_TEXT_LIMIT = 500;

/**
 * A text the model is not shown, on one line and cut short, for the log of the call. The log masks
 * the secrets the call registered; this only bounds the length.
 */
export function cutForLog(text: string): string {
  const line = text.replace(/\s+/gu, ' ').trim();
  return line.length > LOG_TEXT_LIMIT ? `${line.slice(0, LOG_TEXT_LIMIT)}…` : line;
}

/** The body on one line, a value of a field of a secret name masked, cut short; for the log only. */
function logTextOf(text: string, parsed: unknown): string | undefined {
  const cut = cutForLog(secretFieldMasker(parsed)?.text(text) ?? text);
  return cut === '' ? undefined : cut;
}

/** The error without any text of the body: what the model may see of a 5xx or a 401. */
function withoutText(
  status: number,
  named: string | undefined,
  retryable: boolean | undefined,
  logText: string | undefined,
): LoadcraftApiErrorInit {
  const code =
    status === 401
      ? 'unauthorized'
      : named !== undefined && PLAIN_CODE.test(named)
        ? named
        : codeForStatus(status);
  return {
    status,
    code,
    message: genericMessage(status),
    retryable: retryable ?? RETRYABLE_STATUSES.has(status),
    ...(logText === undefined ? {} : { logText }),
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The error as a server failure would have been reported: the status and a plain machine code, no
 * text, no body. For a call that could not register every secret it read: the backend's text may
 * quote one it does not know, so the text is treated like that of a 5xx. A status whose text is not
 * shown anyway is returned as it is.
 */
export function withheldCopy(error: LoadcraftApiError): LoadcraftApiError {
  if (!quotesBackendText(error.status)) return error;
  return new LoadcraftApiError({
    status: error.status,
    code: codeForStatus(error.status),
    message: genericMessage(error.status),
    retryable: error.retryable,
  });
}

function genericMessage(status: number): string {
  return `LoadCraft API answered HTTP ${String(status)}.`;
}

function rest(body: JsonObject): JsonObject | undefined {
  const entries = Object.entries(body).filter(([key]) => !ENVELOPE_KEYS.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** `{error|code, message?, retryable?, ...}` → one init; `undefined` when the object names no code. */
function fromEnvelope(status: number, body: JsonObject): LoadcraftApiErrorInit | undefined {
  const code = nonEmpty(body.error) ?? nonEmpty(body.code);
  if (code === undefined) return undefined;
  const details = rest(body);
  const retryable = typeof body.retryable === 'boolean' ? body.retryable : undefined;
  return {
    status,
    code,
    message: nonEmpty(body.message) ?? nonEmpty(body.detail) ?? genericMessage(status),
    ...(details === undefined ? {} : { details }),
    retryable: retryable ?? RETRYABLE_STATUSES.has(status),
  };
}

/** FastAPI request validation: `{detail: [{loc: [...], msg, type}, ...]}`. */
function validationMessage(errors: readonly unknown[]): string {
  const parts = errors.slice(0, 5).map((item) => {
    if (!isObject(item)) return String(item);
    const loc = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
    const msg = nonEmpty(item.msg) ?? 'invalid value';
    return loc === '' ? msg : `${loc}: ${msg}`;
  });
  const more = errors.length > 5 ? ` (+${String(errors.length - 5)} more)` : '';
  return `${parts.join('; ')}${more}`;
}

/** The fields of the error a parsed JSON body describes. */
function initOfBody(status: number, body: unknown): LoadcraftApiErrorInit {
  const statusRetryable = RETRYABLE_STATUSES.has(status);
  const plain = { status, code: codeForStatus(status), retryable: statusRetryable };
  if (!isObject(body)) return { ...plain, message: genericMessage(status), details: body };
  const outer = fromEnvelope(status, body);
  if (outer !== undefined) return outer;

  const { detail } = body;
  if (typeof detail === 'string') return { ...plain, message: detail };
  if (Array.isArray(detail)) {
    return { ...plain, message: validationMessage(detail), details: { errors: detail } };
  }
  if (isObject(detail)) {
    const inner = fromEnvelope(status, detail);
    if (inner !== undefined) return inner;
    return {
      ...plain,
      message: nonEmpty(detail.message) ?? genericMessage(status),
      details: detail,
    };
  }
  return { ...plain, message: nonEmpty(body.message) ?? genericMessage(status), details: body };
}

/**
 * Turns an error response of the LoadCraft API into the fields of `LoadcraftApiError`. The backend
 * answers in three shapes - `{detail: "text"}`, `{detail: {error|code, message?, ...}}` and
 * `{error, message, ...}` - plus FastAPI's validation list; anything that is not JSON did not come
 * from the API (a proxy page, a wrong URL) and becomes `bad_gateway` quoting its start.
 * A value the body holds in a field of a secret name (`password`, `password_url`, the input of a
 * validation error about `api_key`) is masked in the message and the details here, before anything
 * quotes or cuts the message. An answer with a status the model is not shown the text of
 * (`quotesBackendText`: 5xx and 401) keeps its status, a plain machine code and the retry flag; its
 * text goes to `logText`, and a 5xx keeps the rest of the body in `details` for code that parses
 * it (`toToolError` leaves `details` out of the error the model sees).
 */
export function apiErrorInit(status: number, text: string): LoadcraftApiErrorInit {
  const statusRetryable = RETRYABLE_STATUSES.has(status);
  if (text.trim() === '') {
    return {
      status,
      code: codeForStatus(status),
      retryable: statusRetryable,
      message: genericMessage(status),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (!quotesBackendText(status)) {
      return withoutText(status, 'bad_gateway', statusRetryable, logTextOf(text, undefined));
    }
    return {
      status,
      code: 'bad_gateway',
      message: `LoadCraft API answered HTTP ${String(status)} with a non-JSON body: ${text.slice(0, SNIPPET_LENGTH)}`,
      retryable: statusRetryable,
    };
  }
  const read = initOfBody(status, body);
  const masker = secretFieldMasker(body);
  const init =
    masker === undefined
      ? read
      : {
          ...read,
          message: masker.text(read.message),
          ...(read.details === undefined
            ? {}
            : { details: hideSecretFields(read.details, masker) }),
        };
  if (quotesBackendText(status)) return init;
  // A server failure keeps the body as data for the code that parses it (the report a 502 of the
  // provisioning carries); `toToolError` drops it, so it never reaches the model. A 401 keeps nothing.
  return {
    ...withoutText(status, init.code, init.retryable, logTextOf(text, body)),
    ...(status === 401 || init.details === undefined ? {} : { details: init.details }),
  };
}

/**
 * Whether `error` is the backend's 404 for a run the project does not have: unknown, deleted, or a
 * run of another project. A result route answers it before reading any store, so it never means
 * "this run has no such data"; a reader that takes a 404 as an absence asks this first.
 */
export function isRunNotFound(error: unknown, executionId: string): boolean {
  return (
    error instanceof LoadcraftApiError &&
    error.status === 404 &&
    error.message === `Execution ${executionId} not found`
  );
}
