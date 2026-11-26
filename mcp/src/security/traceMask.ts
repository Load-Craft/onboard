// What a recorded request may show of itself. A trace of a request holds what the test sent and
// what the target answered: passwords in bodies, tokens in headers and addresses, cookies, keys. None
// of it was registered with the plugin, so a secret is told by the name of the field it comes in
// (`isSecretField`, `isSecretParameter`) or by its shape (a provider key, a key block, a token of
// high entropy). The mask fails closed:
// - header values are never shown, only their names;
// - a body is shown only in a format the mask reads (JSON, also cut short; a form; a multipart form;
//   XML or HTML; plain text); any other body is hidden whole, only its type and size are shown;
// - every string value is read again after decoding (JSON in a string, a form, an address, percent
//   and base64 encoding), so a secret one level down is found as well;
// - in a JSON body cut short by the length limit of the record, everything from the first secret
//   name to the end is hidden.
// Every value replaced is returned as well, so the caller registers it with the secret scope of the
// call and the same value is masked wherever else it appears.

import { REDACTED } from '../secret.js';
import { isSecretField, isSecretParameter } from './secretFields.js';

export interface Masked {
  readonly text: string;
  /** The values that were replaced, each once, to register with the secret scope. */
  readonly secrets: readonly string[];
}

/** A body as the mask lets it out: shown masked, or hidden whole with only its type and size. */
export type MaskedBody =
  | { readonly kind: 'shown'; readonly text: string; readonly secrets: readonly string[] }
  | { readonly kind: 'hidden'; readonly type: string | null; readonly bytes: number };

/** What the backend puts in place of a header value it already masked; nothing to register. */
const BACKEND_MASK = '<redacted>';
/** Headers whose value is a credential whatever their name says to `isSecretField`. */
const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
]);
/** A header or cookie value shorter than this is not registered: `true` or `1234` would go everywhere. */
const LONG_VALUE = 8;
/** How many times a value is decoded and read again. */
const MAX_DEPTH = 3;

class Found {
  readonly #values = new Set<string>();

  add(value: string): void {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === REDACTED || trimmed.includes(BACKEND_MASK)) return;
    this.#values.add(trimmed);
  }

  get size(): number {
    return this.#values.size;
  }

  done(text: string): Masked {
    return { text, secrets: [...this.#values] };
  }
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return text;
  }
}

// ---- headers ------------------------------------------------------------------------------------

interface HeaderLine {
  readonly name: string;
  readonly value: string;
}

/**
 * `Name: value` lines of a recorded request or answer. A line without `: ` was cut inside its name
 * by the length limit of the record and carries no value.
 */
function headerLines(text: string): HeaderLine[] {
  return text
    .split(/\r?\n/u)
    .map((line) => {
      const at = line.indexOf(': ');
      return at <= 0 ? null : { name: line.slice(0, at).trim(), value: line.slice(at + 2) };
    })
    .filter((line): line is HeaderLine => line !== null && line.name !== '');
}

/** The names of the headers, in the order they came, each once whatever its case. */
export function headerNames(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { name } of headerLines(text)) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The media type of a body (`application/json`), from its `Content-Type` line; `null` without one. */
export function contentType(headers: string): string | null {
  const line = headerLines(headers).find(({ name }) => name.toLowerCase() === 'content-type');
  const type = line?.value.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(type) ? type : null;
}

/** `a=1; session=xyz; Path=/` → the values of the pairs that look like credentials. */
function cookieSecrets(value: string, found: Found): void {
  for (const pair of value.split(/[;,]/u)) {
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const item = pair.slice(at + 1).trim();
    if (isSecretField(name) || item.length >= LONG_VALUE) {
      found.add(item);
      found.add(decoded(item));
    }
  }
}

/**
 * The values of the headers that carry a credential (`Authorization` without its scheme, every
 * cookie that looks like a session, any header whose name says it holds a secret). They are never
 * shown; they are returned to be masked wherever else the trace repeats them.
 */
export function headerSecrets(text: string): string[] {
  const found = new Found();
  for (const { name, value } of headerLines(text)) {
    const key = name.toLowerCase();
    if (key === 'cookie' || key === 'set-cookie') {
      found.add(value);
      cookieSecrets(value, found);
    } else if (CREDENTIAL_HEADERS.has(key) || isSecretField(name)) {
      const [scheme, ...rest] = value.trim().split(/\s+/u);
      if (value.trim().length >= LONG_VALUE) found.add(value);
      if (scheme !== undefined && rest.length > 0) found.add(rest.join(' '));
    }
  }
  return [...found.done('').secrets];
}

// ---- values that are a secret by their shape ----------------------------------------------------

/** A block of a key or a certificate, also one cut short before its end line. */
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/gu;
/** Keys of known providers: the prefix says what they are. */
const PROVIDER_KEY =
  /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[abposr]-[A-Za-z0-9-]{8,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,})/gu;
/** Three base64url parts: the shape of a JSON Web Token, wherever it stands. */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/gu;
/** A run of token characters long enough to be a generated secret. */
const TOKEN_RUN = /[A-Za-z0-9_+/=-]{32,}/gu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX = /^[0-9a-f]+$/iu;

/** Shannon entropy of the text, in bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Whether a run of token characters looks generated: letters of both cases and digits, spread
 * evenly, or hex longer than an identifier. A UUID, a number, a hex id of up to 32 digits and a
 * word stay.
 */
function looksGenerated(run: string, minLength: number): boolean {
  if (run.length < minLength || UUID.test(run) || /^\d+$/u.test(run)) return false;
  if (HEX.test(run)) return run.length > 32;
  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u].filter((re) => re.test(run)).length;
  return classes === 3 && entropy(run) >= 3.5;
}

function hasProviderKey(text: string): boolean {
  PROVIDER_KEY.lastIndex = 0;
  const found = PROVIDER_KEY.test(text);
  PROVIDER_KEY.lastIndex = 0;
  return found;
}

/** 13 to 19 digits standing alone: the length of a card number. */
const DIGIT_RUN = /(?<!\d)\d{13,19}(?!\d)/gu;

/** The check digit of a card number (Luhn): a random number of that length passes it one time in ten. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((ch, index) => {
    let digit = Number(ch);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  });
  return sum % 10 === 0;
}

/** Key blocks, provider keys, tokens, long generated runs and card numbers replaced, wherever they stand. */
function maskShapes(text: string, found: Found): string {
  const replace = (value: string): string => {
    found.add(value);
    return REDACTED;
  };
  return text
    .replace(PEM_BLOCK, replace)
    .replace(PROVIDER_KEY, replace)
    .replace(JWT, replace)
    .replace(TOKEN_RUN, (run) => (looksGenerated(run, 32) ? replace(run) : run))
    .replace(DIGIT_RUN, (digits) => (passesLuhn(digits) ? replace(digits) : digits));
}

// ---- pairs in a text ----------------------------------------------------------------------------

/** `"name": "value"` (also cut at the end of the text) and `"name": 123` of a JSON text. */
const JSON_PAIR = /"((?:[^"\\]|\\.)*)"(\s*:\s*)("(?:[^"\\]|\\.)*(?:"|$)|-?\d[\d.eE+-]*)/gu;
/** A quoted value, or a bare one up to the end of the line (a password may hold commas and spaces). */
const QUOTED = String.raw`"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?`;
/** `name=value` and `name = value` in a query, a form or a line; a bare value ends at `&` or `;`. */
const EQUALS_PAIR = new RegExp(
  String.raw`(^|[\s?&;,("'#{[])([\w.[\]-]+)(\s*=\s*)(${QUOTED}|[^\s&;"'][^\n\r&;]*)`,
  'gu',
);
/** `name: value` in a log line, YAML or a header written into a text. */
const COLON_PAIR = new RegExp(
  String.raw`(^|[\s,{([])([\w.-]+)(\s*:\s*)(${QUOTED}|[^\s"'][^\n\r]*)`,
  'gu',
);
/** The scheme of an `Authorization` value: what follows it is the credential. */
const AUTH_SCHEME =
  /^(?:Bearer|Basic|Token|ApiKey|Api-Key|Digest|Negotiate|NTLM|HMAC|MAC|AWS4-HMAC-SHA256)$/iu;
/** Bearer, Basic, Token and ApiKey take one word as the credential. */
const WORD_CREDENTIAL = /\b(Bearer|Basic|Token|ApiKey|Api-Key)\s+([^\s"',;)]{4,})/gu;
/** Digest, Negotiate, NTLM and the signed schemes take the rest of the line. */
const LINE_CREDENTIAL = /\b(Digest|Negotiate|NTLM|HMAC|MAC|AWS4-HMAC-SHA256)\s+([^\n\r]+)/gu;
/** The password of an address (`scheme://user:password@host`). */
const USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)([^\s/@]+)(@)/giu;
/** An address inside a text, read as an address. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>\\]+/giu;

function unquoted(value: string): string {
  const quote = value.startsWith('"') || value.startsWith("'") ? value.charAt(0) : '';
  if (quote === '') return value.trim();
  const body = value.slice(1);
  return body.endsWith(quote) ? body.slice(0, -1) : body;
}

/** The value replaced, its quotes kept, so the reader sees that a value was there. */
function redactedValue(value: string): string {
  const quote = value.startsWith('"') || value.startsWith("'") ? value.charAt(0) : '';
  return quote === '' ? REDACTED : `${quote}${REDACTED}${quote}`;
}

/** A word that says the next one is a secret: `code 493021`, `password is X`, `hasło: X`. */
const KEYWORD =
  /(?<![\p{L}\p{N}_])(?:code|pin|otp|password|passcode|passwd|hasło|haslo|kod|token|key|secret)(?![\p{L}\p{N}_])/giu;
/** Words between a keyword and its value that are not the value (`is`, `your`, `jest`, …). */
const FILLER = new Set([
  'is',
  'was',
  'are',
  'be',
  'been',
  'has',
  'have',
  'for',
  'your',
  'the',
  'a',
  'an',
  'to',
  'of',
  'new',
  'jest',
  'to',
  'twój',
  'twoj',
  'nowy',
  'must',
  'not',
  'required',
  'invalid',
  'incorrect',
  'wrong',
  'expired',
  'missing',
  'too',
  'should',
  'cannot',
  'can',
  'will',
  'did',
  'does',
  'and',
  'or',
  'with',
  'nieprawidłowy',
  'nieprawidłowe',
  'błędny',
  'wymagany',
  'wygasł',
]);
/** How many filler words may stand between a keyword and its value. */
const FILLER_WORDS = 3;
const WORD = /[\p{L}\p{N}_+/=.-]+/gu;

/**
 * The first word after a keyword that is not a filler word (up to FILLER_WORDS of them), four
 * characters or more, replaced: a value a text names without a pattern (`Your code is 493021`).
 */
function maskNearKeywords(text: string, found: Found): string {
  const hits: [number, number][] = [];
  for (const keyword of text.matchAll(KEYWORD)) {
    const from = (keyword.index ?? 0) + keyword[0].length;
    WORD.lastIndex = from;
    for (let words = 0; words <= FILLER_WORDS; words += 1) {
      const word = WORD.exec(text);
      if (word === null) break;
      // Only spaces and punctuation of a sentence may stand between the words.
      if (
        !/^[\s:=,'"()]*$/u.test(text.slice(from, word.index).replace(/[\p{L}\p{N}_+/=.-]+/gu, ' '))
      )
        break;
      const value = word[0].replace(/[.,]+$/u, '');
      if (FILLER.has(value.toLowerCase())) continue;
      if (value.length >= 4 && !AUTH_SCHEME.test(value) && !value.includes(REDACTED.slice(1, -1))) {
        hits.push([word.index, word.index + value.length]);
      }
      break;
    }
  }
  if (hits.length === 0) return text;
  let out = '';
  let at = 0;
  for (const [start, end] of hits.sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    found.add(text.slice(start, end));
    out += `${text.slice(at, start)}${REDACTED}`;
    at = end;
  }
  return out + text.slice(at);
}

function maskPairs(text: string, found: Found, depth: number): string {
  const credential = (_all: string, scheme: string, value: string): string => {
    found.add(value);
    return `${scheme} ${REDACTED}`;
  };
  return text
    .replace(URL_IN_TEXT, (url) => maskAddress(url, found, depth + 1))
    .replace(JSON_PAIR, (all, key: string, colon: string, value: string) => {
      if (!isSecretField(key)) return all;
      found.add(unquoted(value));
      return `"${key}"${colon}"${REDACTED}"`;
    })
    .replace(WORD_CREDENTIAL, (all, scheme: string, value: string) =>
      value === REDACTED ? all : credential(all, scheme, value),
    )
    .replace(LINE_CREDENTIAL, (all, scheme: string, value: string) =>
      value === REDACTED ? all : credential(all, scheme, value),
    )
    .replace(EQUALS_PAIR, (all, before: string, key: string, eq: string, value: string) => {
      const bare = unquoted(value);
      if (!isSecretParameter(decoded(key)) || bare === REDACTED) return all;
      found.add(bare);
      found.add(decoded(bare));
      return `${before}${key}${eq}${redactedValue(value)}`;
    })
    .replace(COLON_PAIR, (all, before: string, key: string, colon: string, value: string) => {
      const bare = unquoted(value);
      const first = bare.split(/\s+/u)[0] ?? '';
      if (!isSecretField(key) || bare === REDACTED || bare === `"${REDACTED}"`) return all;
      // `Authorization: Bearer [redacted]`: the scheme stays, its credential is already hidden.
      if (AUTH_SCHEME.test(first) && bare.endsWith(REDACTED)) return all;
      found.add(bare);
      return `${before}${key}${colon}${redactedValue(value)}`;
    });
}

/**
 * A text with the values of secret fields replaced by the marker: JSON pairs, `name=value`,
 * `name: value` (quoted, or up to the end of the line), a credential after its scheme, the secrets
 * of an address inside the text, values that decode to a secret and values of a secret shape.
 */
export function maskText(text: string): Masked {
  const found = new Found();
  return found.done(maskString(text, found, 0));
}

// ---- strings read again after decoding ----------------------------------------------------------

/** `a=1&b=2`: a form sent as `application/x-www-form-urlencoded`. */
const FORM = /^[^\s=&]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/u;
const BASE64 = /^[A-Za-z0-9+/_-]{12,}={0,2}$/u;
/** `user:password`, as a Basic credential holds it. */
const CREDENTIAL_PAIR = /^[^\s:]{1,64}:\S{3,}$/u;
const PRINTABLE = /^[\x20-\x7e\t\r\n]+$/u;

function decodedBase64(value: string): string | null {
  if (!BASE64.test(value) || value.length % 4 === 1) return null;
  const text = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString(
    'utf8',
  );
  return text.length >= 4 && PRINTABLE.test(text) ? text : null;
}

/** A base64 value that holds a credential or a secret field: hidden whole; `null` when it holds none. */
function maskBase64(value: string, found: Found, depth: number): string | null {
  const plain = decodedBase64(value);
  if (plain === null) return null;
  if (CREDENTIAL_PAIR.test(plain)) {
    found.add(value);
    found.add(plain);
    return REDACTED;
  }
  const inner = new Found();
  if (maskString(plain, inner, depth) !== plain || inner.size > 0) {
    found.add(value);
    return REDACTED;
  }
  return null;
}

/**
 * A string value read as what it may hold: JSON, an address, a form, percent or base64 encoding,
 * each masked again (up to MAX_DEPTH levels), then its pairs and shapes. A value whose decoded form
 * held a secret is shown decoded and masked; a base64 value that held one is hidden whole.
 */
function maskString(value: string, found: Found, depth: number): string {
  const trimmed = value.trim();
  if (depth < MAX_DEPTH && trimmed !== '') {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const json = parsedJson(trimmed);
      if (json !== undefined) return JSON.stringify(hideInJson(json, found, depth + 1));
    }
    if (/^https?:\/\/\S+$/iu.test(trimmed)) return maskAddress(trimmed, found, depth + 1);
    // base64 before a form: its padding (`…==`) reads as an empty form field.
    const base64 = maskBase64(trimmed, found, depth + 1);
    if (base64 !== null) return base64;
    if (FORM.test(trimmed)) return maskParams(trimmed, found, depth + 1);
    if (/%[0-9A-Fa-f]{2}/u.test(trimmed)) {
      const plain = decoded(trimmed);
      const before = found.size;
      const masked = maskString(plain, found, depth + 1);
      if (plain !== trimmed && (found.size > before || masked !== plain)) return masked;
    }
  }
  return maskShapes(maskNearKeywords(maskPairs(value, found, depth), found), found);
}

// ---- addresses ----------------------------------------------------------------------------------

/** A path segment that looks like a token: a generated run of 20 characters or more, a key, a JWT. */
function tokenSegment(segment: string): boolean {
  const plain = decoded(segment);
  return looksGenerated(plain, 20) || hasProviderKey(plain) || /^eyJ/u.test(plain);
}

/** `a=1&b=2` of a query, a fragment or a form: parameters of a secret name, and secrets one level down. */
function maskParams(params: string, found: Found, depth: number): string {
  return params
    .split('&')
    .map((pair) => {
      const at = pair.indexOf('=');
      if (at < 0) return pair;
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (isSecretParameter(decoded(name))) {
        found.add(value);
        found.add(decoded(value));
        return `${name}=${REDACTED}`;
      }
      const plain = decoded(value);
      const masked = depth < MAX_DEPTH ? maskString(plain, found, depth) : maskShapes(plain, found);
      return masked === plain ? pair : `${name}=${masked}`;
    })
    .join('&');
}

/**
 * An address with its password, the secret parameters of its query and fragment, every parameter
 * that holds a secret one level down, and the segments of its path that look like tokens replaced.
 * A fragment that is not a list of parameters is kept only as a short plain anchor.
 */
function maskAddress(url: string, found: Found, depth: number): string {
  const hashAt = url.indexOf('#');
  const head = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? null : url.slice(hashAt + 1);
  const queryAt = head.indexOf('?');
  const base = queryAt < 0 ? head : head.slice(0, queryAt);
  const query = queryAt < 0 ? null : head.slice(queryAt + 1);
  const userless = base.replace(USERINFO, (_all, start: string, password: string, at: string) => {
    found.add(password);
    found.add(decoded(password));
    return `${start}${REDACTED}${at}`;
  });
  const path = userless.replace(/\/([^/]+)/gu, (all, segment: string) => {
    if (!tokenSegment(segment)) return all;
    found.add(segment);
    return `/${REDACTED}`;
  });
  const shownQuery = query === null ? '' : `?${maskParams(query, found, depth)}`;
  let shownFragment = '';
  if (fragment !== null) {
    if (fragment.includes('=')) shownFragment = `#${maskParams(fragment, found, depth)}`;
    else if (/^[A-Za-z][\w-]{0,39}$/u.test(fragment) && !looksGenerated(fragment, 12)) {
      shownFragment = `#${fragment}`;
    } else {
      found.add(fragment);
      shownFragment = `#${REDACTED}`;
    }
  }
  return `${path}${shownQuery}${shownFragment}`;
}

/** An address with its secrets replaced (see `maskAddress`). */
export function maskUrl(url: string): Masked {
  const found = new Found();
  return found.done(maskAddress(url, found, 0));
}

// ---- bodies -------------------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every number and string under a secret field, replaced; a flag and a `null` say nothing. */
function redactAll(value: Json, found: Found): Json {
  if (typeof value === 'string' || typeof value === 'number') {
    found.add(String(value));
    return REDACTED;
  }
  if (Array.isArray(value)) return value.map((item) => redactAll(item, found));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactAll(item, found)]),
    );
  }
  return value;
}

/** Keys of a login exchange: beside one of them, `code` is the authorization code. */
const OAUTH_KEYS = /^(?:grant_type|redirect_uri|code_verifier|client_id)$/iu;
/** Keys of a payment card: beside one of them, the number of the card is a secret. */
const CARD_KEYS = /^(?:cvv2?|cvc2?|expiry|expiration|exp_month|exp_year|expiry_date)$/iu;
const CARD_NUMBER = /^(?:card[_-]?number|number|pan|card)$/iu;

/** Whether a key holds a secret in this object: by its name, or by the keys beside it. */
function secretIn(record: { readonly [key: string]: Json }, key: string): boolean {
  if (isSecretField(key)) return true;
  const keys = Object.keys(record);
  if (key.toLowerCase() === 'code' && keys.some((other) => OAUTH_KEYS.test(other))) return true;
  return CARD_NUMBER.test(key) && keys.some((other) => CARD_KEYS.test(other));
}

function hideInJson(value: Json, found: Found, depth: number): Json {
  if (typeof value === 'string') return maskString(value, found, depth);
  if (typeof value === 'number') {
    const digits = String(value);
    if (/^\d{13,19}$/u.test(digits) && passesLuhn(digits)) {
      found.add(digits);
      return REDACTED;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => hideInJson(item, found, depth));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretIn(value, key) ? redactAll(item, found) : hideInJson(item, found, depth),
    ]),
  );
}

function parsedJson(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

/** A key of a JSON text, also inside a string of it (`\"password\":`). */
const JSON_KEY = /\\*"((?:[^"\\]|\\.){1,100}?)\\*"\s*:/gu;

/**
 * A JSON text that no longer parses (cut by the length limit of the record): from the first key of
 * a secret name to the end everything is hidden, as the extent of its value is not known; the part
 * before it is masked as a text.
 */
function maskCutJson(text: string, found: Found): string {
  for (const match of text.matchAll(JSON_KEY)) {
    if (!isSecretField(match[1] ?? '')) continue;
    const end = (match.index ?? 0) + match[0].length;
    return `${maskString(text.slice(0, end), found, MAX_DEPTH)}"${REDACTED}"…`;
  }
  return maskString(text, found, MAX_DEPTH);
}

/** A part of a multipart form: its head (with the field name) and its content up to the next boundary. */
const MULTIPART_PART =
  /(Content-Disposition:[^\r\n]*\bname="([^"]*)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n)([\s\S]*?)(?=\r?\n--|$)/giu;

function maskMultipart(text: string, found: Found): string {
  return text.replace(MULTIPART_PART, (_all, head: string, name: string, content: string) => {
    if (isSecretParameter(name)) {
      found.add(content);
      return `${head}${REDACTED}`;
    }
    return `${head}${maskString(content, found, 1)}`;
  });
}

/** An element with text content and its closing tag, or one cut at the end of the body. */
const ELEMENT = /<((?:[\w.-]+:)?([\w.-]+))(\s[^<>]*)?>([^<]*)(<\/\1\s*>|$)/gu;
/** An attribute with a quoted value. */
const ATTRIBUTE = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*')/gu;
/** A tag with its attributes. */
const TAG = /<[\w:.-]+\s[^<>]*>/gu;

function maskTag(tag: string, found: Found): string {
  // A form field or a meta tag names its value by `name` or `id`: `<input name="csrf" value="…">`.
  const named = [...tag.matchAll(ATTRIBUTE)].some(
    ([, attribute = '', , value = '']) =>
      ['name', 'id', 'property'].includes(attribute.toLowerCase()) &&
      isSecretParameter(value.slice(1, -1)),
  );
  return tag.replace(ATTRIBUTE, (all, attribute: string, eq: string, value: string) => {
    const valued = ['value', 'content'].includes(attribute.toLowerCase());
    if (!isSecretField(attribute) && !(named && valued)) return all;
    found.add(value.slice(1, -1));
    return `${attribute}${eq}${value.charAt(0)}${REDACTED}${value.charAt(0)}`;
  });
}

/** XML or HTML: elements and attributes of a secret name, form fields and meta tags, then the text. */
function maskMarkup(text: string, found: Found): string {
  const elements = text.replace(
    ELEMENT,
    (
      all,
      tag: string,
      local: string,
      attributes: string | undefined,
      content: string,
      close: string,
    ) => {
      if (!isSecretField(local) || content.trim() === '') return all;
      found.add(content);
      return `<${tag}${attributes ?? ''}>${REDACTED}${close}`;
    },
  );
  return maskString(
    elements.replace(TAG, (tag) => maskTag(tag, found)),
    found,
    MAX_DEPTH,
  );
}

/**
 * A body as the trace recorded it, shown with the values of secret fields replaced, or hidden whole
 * when its format is not one the mask reads. `type` is the media type of its `Content-Type` line;
 * a plain text body is shown only when that line says `text/plain`.
 */
/** One word of eight characters or more: a body that is nothing but a value, a token most often. */
const SINGLE_TOKEN = /^\S{8,}$/u;

export function maskBody(
  text: string,
  type: string | null = null,
  side: 'request' | 'response' = 'response',
): MaskedBody {
  const found = new Found();
  const trimmed = text.trim();
  const hidden = (): MaskedBody => ({
    kind: 'hidden',
    type,
    bytes: Buffer.byteLength(text, 'utf8'),
  });
  const shown = (masked: string): MaskedBody => ({ kind: 'shown', ...found.done(masked) });
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    const json = parsedJson(trimmed);
    if (json === undefined) return shown(maskCutJson(trimmed, found));
    // A bare string is a text: one word of it is a value, not a message.
    if (typeof json === 'string' && SINGLE_TOKEN.test(json.trim())) return hidden();
    return shown(JSON.stringify(hideInJson(json, found, 1)));
  }
  if (FORM.test(trimmed)) return shown(maskParams(trimmed, found, 1));
  if (/Content-Disposition:\s*form-data/iu.test(text)) return shown(maskMultipart(text, found));
  if (trimmed.startsWith('<')) return shown(maskMarkup(text, found));
  // Plain text the test sent has no shape to mask by and tells the diagnosis nothing the answer
  // does not; an answer that is one word is a value.
  if (type === 'text/plain' && side === 'response' && !SINGLE_TOKEN.test(trimmed)) {
    return shown(maskString(text, found, 0));
  }
  return hidden();
}
