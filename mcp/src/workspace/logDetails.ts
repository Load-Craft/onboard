// The detail of a log entry: the request and the response of the call, kept apart from the entry in the cache
// section `logDetails` (key: the id of the entry). The log itself holds summaries only, so the state does not grow
// with the size of what tools exchange. This file builds the detail: masked, and cut to LIMITS.log_details.entry_kb
// with `truncated`. Its time to live, the details of entries that left the log and the size of the section are
// the state reducer's (`pruneCache`). Reads that succeed have no detail (they go to the ring `reads`), and neither
// do calls the log does not record. The 2 MB limit counts the values of the details only, as the schema measures
// it; the keys and `savedAt` come on top.
//
// Nothing here is written unmasked: the request and the response pass the secret scope of the call, credential
// fields and authorization headers are replaced by key and by text, and the reducer filters the whole state once more.

import type { SecretScope } from '../secret.js';
import type { CallEnd } from './logEntry.js';
import { LIMITS, type State } from './processState.js';

/** What the section holds under the id of an entry. Both texts are masked JSON or plain text. */
export interface LogDetail {
  /** When the detail was saved (ISO); the time to live counts from it. */
  savedAt: string;
  /** The response or the request was cut to fit the size of one entry. */
  truncated?: true;
  value: { request: string; response: string };
}

const ENTRY_BYTES = LIMITS.log_details.entry_kb * 1024;
const TTL_MS = LIMITS.log_details.hours * 3_600_000;
/** What the request may take of an entry; the rest is the response's. */
const REQUEST_BYTES = ENTRY_BYTES / 4;
const MARK = '… [truncated]';
const REDACTED = '[redacted]';

// A key is a credential when its name holds one of these words anywhere (`user_password`, `csrf_token`, `jwt`):
// a name that only looks like one costs a masked value, a missed one costs a leaked credential.
const CREDENTIAL_WORD =
  '(?:password|passwd|pwd|passphrase|secret|token|credential|api[-_]?key|private[-_]?key|jwt|cookie|authorization|signature|session|sessid)';
const CREDENTIAL_KEY = new RegExp(CREDENTIAL_WORD, 'i');
// Short words count only as a whole part of the name (`pin`, `card_pin`, `userPin`, `OTPCode`), never inside another
// word (`shipping`, `inside`).
const SHORT_WORDS = new Set(['pin', 'otp', 'sid']);
const SHORT_WORD = '(?:pin|otp|sid)';
const NAME_PARTS = /[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;
// A count of tokens in a query or a text (`max_tokens=4096`) is a number, not a credential.
const TOKEN_COUNT = /tokens$/i;
// Words of a secret that may well be a number (a numeric password); under the other long words a number is a count.
const NUMERIC_SECRET = /(?:password|passwd|pwd|passphrase)/i;

const isShortWord = (name: string): boolean =>
  name.split(NAME_PARTS).some((part) => SHORT_WORDS.has(part.toLowerCase()));

/**
 * True for a field whose value is masked. A flag (`has_credentials: false`) never is. A number is masked under a
 * short word (`pin: 4321`) or a word of a password, not under the other long words (`session_count: 3`,
 * `total_tokens: 12`). Anything else is masked under any credential word.
 */
const masks = (name: string, value: unknown): boolean => {
  if (typeof value === 'boolean') return false;
  if (isShortWord(name)) return true;
  if (!CREDENTIAL_KEY.test(name)) return false;
  return typeof value !== 'number' || NUMERIC_SECRET.test(name);
};
// A header line (`Name: value`) runs to the end of its line. In JSON text the line ends at the escape `\n` or `\r`
// and a quote inside the value is the escape `\"`; in plain text only a real line break ends it.
// a name starts a header at a word boundary, or right after the JSON escape of a line break (`\\n` runs into it)
const LINE_START = '(?:\\b|(?<=\\\\[nr]))';
const HEADER_NAMES = '(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)';
const HEADER_LINE_PLAIN = new RegExp(`${LINE_START}${HEADER_NAMES}(\\s*:\\s*)[^\\r\\n]*`, 'gi');
const HEADER_LINE_JSON = new RegExp(
  `${LINE_START}${HEADER_NAMES}(\\s*:\\s*)(?:\\\\(?![nr])[\\s\\S]|[^"\\\\\\r\\n])*`,
  'gi',
);
const CREDENTIAL_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g;
// `scheme://user:password@host`: the whole user part goes
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"\\]+@/gi;
// `access_token=…`, `password=…`, `pin=…` in a query string or in text
const CREDENTIAL_PARAM = new RegExp(
  `\\b([\\w.-]*${CREDENTIAL_WORD}[\\w.-]*|(?:[\\w.-]*[-_.])?${SHORT_WORD}(?:[-_.][\\w.-]*)?)=([^&\\s"'\\\\#]+)`,
  'gi',
);
const DIGITS = /^\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value with every field named like a credential replaced; a copy, the input stays as it is. */
function redactKeys(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactKeys(item, seen));
  if (!isRecord(value)) return value;
  // a header the way a HAR lists it: {name, value}
  if (typeof value.name === 'string' && 'value' in value && masks(value.name, value.value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === 'value' ? REDACTED : redactKeys(item, seen),
      ]),
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      masks(key, item) ? REDACTED : redactKeys(item, seen),
    ]),
  );
}

function maskedText(value: unknown, secrets: Pick<SecretScope, 'scrub' | 'scrubDeep'>): string {
  let text: string;
  let json = true;
  if (typeof value === 'string') {
    text = value;
    json = false;
  } else {
    try {
      text = JSON.stringify(secrets.scrubDeep(redactKeys(value))) ?? '';
    } catch {
      text = '[unserializable]';
    }
  }
  return secrets
    .scrub(text)
    .replace(json ? HEADER_LINE_JSON : HEADER_LINE_PLAIN, `$1$2${REDACTED}`)
    .replace(CREDENTIAL_SCHEME, `$1 ${REDACTED}`)
    .replace(URL_USERINFO, `$1${REDACTED}@`)
    .replace(CREDENTIAL_PARAM, (all, name: string, value: string) =>
      TOKEN_COUNT.test(name) && DIGITS.test(value) ? all : `${name}=${REDACTED}`,
    );
}

const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/** The text cut to `chars` characters, never inside a surrogate pair, with the mark of the cut. */
function cutChars(text: string, chars: number): string {
  let end = Math.max(0, chars);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${MARK}`;
}

/** The longest cut of `text` whose whole detail still fits `limit` bytes (the text itself, when it fits). */
function fitText(text: string, limit: number, sizeWith: (candidate: string) => number): string {
  if (sizeWith(text) <= limit) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizeWith(cutChars(text, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return cutChars(text, low);
}

/**
 * The detail of one call: the arguments and what the call returned (the data of its result, or the code and text
 * of its failure), masked and cut to the size of one entry. The scope is the call's own, so a secret the tool
 * registered while it ran is masked too.
 */
export function detailOf(
  call: {
    readonly args: unknown;
    readonly end: CallEnd;
    readonly secrets: Pick<SecretScope, 'scrub' | 'scrubDeep'>;
  },
  nowMs: number,
): LogDetail {
  const { end, secrets } = call;
  const returned: unknown =
    end.kind === 'error'
      ? { error: end.code, message: end.message }
      : end.kind === 'cancelled'
        ? 'cancelled'
        : end.data;
  const rawRequest = maskedText(call.args, secrets);
  const rawResponse = maskedText(returned, secrets);
  const savedAt = new Date(nowMs).toISOString();
  // the schema measures the value of the detail, not its envelope
  const whole = (request: string, response: string): number => sizeOf({ request, response });
  const request = fitText(rawRequest, REQUEST_BYTES, (text) => whole(text, ''));
  const response = fitText(rawResponse, ENTRY_BYTES, (text) => whole(request, text));
  const cut = request !== rawRequest || response !== rawResponse;
  return { savedAt, ...(cut ? { truncated: true as const } : {}), value: { request, response } };
}

/**
 * Whether the log keeps a detail of this call: the entries that go to `log` (writes, costs, errors, decisions,
 * also the ones a panel button made), not a successful read (the ring `reads`) and not a call that the log skips
 * (a successful read with `format=data`, a read of the panel). A write with `format=data` keeps its entry and detail.
 */
export function storesDetail(
  entry: {
    readonly effect: 'read' | 'write' | 'costly' | 'destructive';
    readonly status: string;
    readonly origin: 'model' | 'panel';
  },
  format?: string,
): boolean {
  if (entry.effect === 'read' && format === 'data' && entry.status === 'ok') return false;
  if (entry.effect === 'read') return entry.status !== 'ok' && entry.origin !== 'panel';
  return true;
}

/** The detail of an entry, or undefined when there is none or its time is over (also before a write pruned it). */
export function readDetail(
  state: State,
  id: string,
  nowMs: number,
): State['logDetails'][string] | undefined {
  if (!Object.hasOwn(state.logDetails, id)) return undefined;
  const detail = state.logDetails[id];
  return detail !== undefined && Date.parse(detail.savedAt) >= nowMs - TTL_MS ? detail : undefined;
}
