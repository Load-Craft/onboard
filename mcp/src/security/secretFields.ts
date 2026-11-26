// Secrets a JSON body names by the field they come in. A value the plugin never registered (a link
// with a key in it, the input of a validation error about a password field) can be told apart only
// by the name of its field, so the values of such fields are masked wherever the error quotes them,
// before any view shows or cuts the quote.

import { REDACTED } from '../secret.js';
import { Masker } from './mask.js';

/**
 * Field names that say the value is a secret. Short words count only as a whole part of the name
 * (between the ends, `_`, `-` or another non-letter): `pass` (`db_pass`, not `passed`), `pin`
 * (`user_pin`, not `shipping`), `otp` (`otp_code`, not `hotpath`), `sid` (`connect.sid`, not
 * `sidebar`). `key` counts as the whole name, as the end of a name after `_` or `-` (`X-Tenant-Key`,
 * not `monkey` or `key_name`) and as a key of a known kind (`api_key`, `private_key`, `access_key`,
 * `secret_key`). `session`, `sessid`, `jwt`, `bearer`, `signature` and `signing` count anywhere.
 * Names like `api_key_name` or `token_id` are matched as well: a wrongly masked identifier in an error
 * costs less than a shown secret. A number or a flag is never masked. Second factors and one-time
 * proofs count too: `auth` and `X-Auth` as the whole name (not `auth_type`, `author` or `oauth`),
 * `totp`, `mfa` and `2fa` (`mfa_code`), `verification_code`, `code_verifier`, `csrf` and `_csrf` as
 * the whole name, also `X-CSRF` (a `csrf_token` is a token; `uses_csrf` is a setting), `nonce`, a
 * SAML or client `assertion` as the whole name (not the `assertions` of a test), `SAMLResponse`, a
 * `device_code` or another code of a login flow, and a card's `cvv` or `cvc`.
 */
const SECRET_FIELD = new RegExp(
  [
    'pass(?:word|wd|phrase)',
    '(?:^|[^a-z])(?:pass|pin|otp)(?:$|[^a-z])',
    'pwd',
    'has[lł]o',
    'secret',
    'token',
    'credential',
    '(?:api|private|access)[_-]?key',
    '^key$',
    'authorization',
    'cookie',
    'session',
    'sessid',
    '(?:^|[^a-z])sid(?:$|[^a-z])',
    'jwt',
    'bearer',
    'signature',
    'signing',
    '[_-]key$',
    '^(?:x[_-])?auth$',
    'totp',
    '(?:^|[^a-z])(?:mfa|2fa)(?:$|[^a-z])',
    'verification[_-]?code',
    'code[_-]?verifier',
    '^(?:x[_-])?_?(?:csrf|xsrf)$',
    'nonce',
    '^(?:saml[_-]?|client[_-])?assertion$',
    '(?:device|auth|authorization|access)[_-]?code',
    'samlresponse',
    '(?:^|[^a-z])(?:cvv|cvc)\\d?(?:$|[^a-z])',
  ].join('|'),
  'iu',
);

/**
 * A field that names where a token is fetched (`token_endpoint`, an identity provider's address the
 * user configured), not a token. Any other address or path in a field of a secret name
 * (`password_url`, `token_path`) can carry the secret, and is masked.
 */
const TOKEN_ENDPOINT_FIELD = /endpoint$/iu;

export function isSecretField(name: string): boolean {
  return SECRET_FIELD.test(name) && !TOKEN_ENDPOINT_FIELD.test(name);
}

/**
 * Names that hold a secret only as a parameter of an address or a form: the authorization `code` of
 * OAuth, a `sig` of a signed address, a `ticket` of a single sign-on. In a JSON body `code` is mostly
 * an error code, so the rule for fields does not take them.
 */
const SECRET_PARAMETER = /^(?:code|sig|ticket|otp_code|SAMLart)$/iu;

/** `isSecretField`, and the names that are a secret as a query, fragment or form parameter. */
export function isSecretParameter(name: string): boolean {
  return isSecretField(name) || SECRET_PARAMETER.test(name.trim());
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringsIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (isObject(value)) for (const item of Object.values(value)) stringsIn(item, out);
}

/** The last name of a FastAPI validation location (`["body", "account", "password"]` → `password`). */
function fieldOfLocation(loc: unknown): string | undefined {
  if (!Array.isArray(loc)) return undefined;
  const names = loc.filter((part): part is string => typeof part === 'string');
  return names[names.length - 1];
}

/** A validation error item whose location is a field of a secret name: its `input` is that value. */
function isSecretInput(item: JsonObject): boolean {
  const field = fieldOfLocation(item.loc);
  return field !== undefined && 'input' in item && isSecretField(field);
}

/**
 * Every string `body` holds under a field of a secret name, at any depth, and the input of every
 * validation error about such a field.
 */
export function secretFieldValues(body: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isObject(value)) return;
    if (isSecretInput(value)) stringsIn(value.input, out);
    for (const [key, item] of Object.entries(value)) {
      if (isSecretField(key)) stringsIn(item, out);
      else walk(item);
    }
  };
  walk(body);
  return [...new Set(out)];
}

/** Every string replaced with the redaction marker; numbers, flags and the shape stay. */
function redactStrings(value: unknown): unknown {
  if (typeof value === 'string') return REDACTED;
  if (Array.isArray(value)) return value.map(redactStrings);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStrings(item)]),
    );
  }
  return value;
}

/**
 * A copy of `value` with the strings under fields of a secret name replaced by the marker and the
 * values of those fields masked in every other string.
 */
function hideIn(value: unknown, masker: Masker): unknown {
  if (typeof value === 'string') return masker.text(value);
  if (Array.isArray(value)) return value.map((item) => hideIn(item, masker));
  if (!isObject(value)) return value;
  const secretInput = isSecretInput(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSecretField(key) || (secretInput && key === 'input')
        ? redactStrings(item)
        : hideIn(item, masker),
    ]),
  );
}

/** A masker that knows the values `body` names in fields of a secret name, or nothing to hide. */
export function secretFieldMasker(body: unknown): Masker | undefined {
  const values = secretFieldValues(body);
  if (values.length === 0) return undefined;
  const masker = new Masker();
  for (const value of values) masker.add(value);
  return masker;
}

/** `value` with what the masker knows hidden and the fields of a secret name redacted. */
export function hideSecretFields<T>(value: T, masker: Masker): T {
  return hideIn(value, masker) as T;
}
