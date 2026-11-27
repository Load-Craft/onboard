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

/**
 * A field that names the kind of a value (`type`, `auth_type`, `token_type`, `kind`, `scheme`): it
 * holds a word like `none`, `bearer` or `basic`, not a secret, also inside an object of a secret
 * name. Registered, that word would be masked in every text of the call.
 */
const KIND_FIELD = /(?:^|[_-])(?:type|kind|scheme)$/iu;

function isKindField(name: string): boolean {
  return KIND_FIELD.test(name);
}

/**
 * A kind field holding a word. An object or a list under such a name is read like any other value of
 * a secret field: what it holds may be the credential itself.
 */
function isKindWord(name: string, value: unknown): boolean {
  return typeof value === 'string' && isKindField(name);
}

export function isSecretField(name: string): boolean {
  return SECRET_FIELD.test(name) && !TOKEN_ENDPOINT_FIELD.test(name) && !isKindField(name);
}

/**
 * A field of a secret name that holds names, not values: the operations a token covers
 * (`token_operations`, `METHOD /path` each), the reasons of a session estimate (`session_reasons`),
 * the names of variables (`session_vars`, `auth_credentials_without_consumer`) and the id of an
 * endpoint (`token_endpoint_id`). Only when it holds plain strings, one or a list of them: an object
 * under such a name may hold the credential itself and is read as any field of a secret name. The
 * name rule (`isSecretField`) is not changed: the secret-name paths of the contract, a HAR's
 * headers and a dataset's columns still take these names for secrets.
 */
const NAMES_FIELD =
  /(?:^|[_-])(?:operations|reasons|vars?|variables|without[_-][a-z]+|endpoint[_-]ids?)$/iu;

/**
 * Objects whose keys are names and whose values describe them: the `properties` of a JSON schema,
 * the `shape` of a recorded answer, the `session_variables` of a scenario plan (name → what it
 * holds), the `modular_files` of a generated artifact (file name → its code). `properties.password`
 * is the description of a field called password, and `…/SessionStep.scala` a file, not secrets.
 */
export const SCHEMA_CONTAINERS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'shape',
  '$defs',
  'definitions',
  'session_variables',
  'modular_files',
  'schema',
  'schema_def',
  'required',
  'locals',
  'contract',
]);

/**
 * A field that holds one credential by its very name (`password`, `client_secret`, `api_key`,
 * `access_token`, …). Its scalar value in an answer of LoadCraft's own contract is registered even
 * when it looks like a word (`hunter`, `abcdefgh`): the contract may not mark every such field, and
 * outside a schema or a list of names the value is the credential. Defence in depth behind x-secret.
 */
const CREDENTIAL_LEAF =
  /^(?:x[_-])?(?:pass(?:word|wd|phrase)?|pwd|secret|client[_-]?secret|secret[_-]?key|api[_-]?key|apikey|private[_-]?key|access[_-]?key|(?:access|refresh|id|auth|bearer|session)?[_-]?token)$/iu;

/** A value that only refers to a variable (`#{token}`, `{{token}}`, `Bearer #{token}`, a shell `$UPPER_NAME`): a name. */
export const VARIABLE_REFERENCE =
  /^\s*(?:(?:Bearer|Basic|Token)\s+)?(?:#\{[^{}]+\}|\{\{[^{}]+\}\}|\$\{[^{}]+\}|\$[A-Z][A-Z0-9_]{2,}|<[A-Za-z_ -]+>)\s*$/u;

/** An operation as LoadCraft names one: `POST /auth/customer/login`. */
const OPERATION_KEY = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) \/\S*$/u;

/**
 * A name as LoadCraft's own answers carry them under fields of a secret name (the `key` of an area,
 * a session variable, an auth scheme's word): a few words, each lowercase or capitalised, joined by
 * `_`, `.`, `-`, a space or nothing, at most two digits. A
 * generated secret is longer or carries more digits; one the contract marks as secret is registered
 * by its path (`callOperation`), not by this guess.
 */
function looksLikeName(value: string): boolean {
  return (
    value.length <= 32 &&
    /^[A-Za-z][a-z0-9]*(?:[ _.-]?[A-Za-z][a-z0-9]*)*$/u.test(value) &&
    (value.match(/\d/gu)?.length ?? 0) <= 2
  );
}

export interface SecretFieldOptions {
  /**
   * The body is an answer of LoadCraft's own contract: a value that looks like a name or an
   * operation is not taken for a secret. Third-party text (a recorded request, an error that quotes
   * the input) is read without this.
   */
  readonly ownContract?: boolean;
}

/** Whether a string found under a field of a secret name is worth registering as a secret. */
function isSecretValue(value: string, options: SecretFieldOptions): boolean {
  if (VARIABLE_REFERENCE.test(value)) return false;
  if (options.ownContract === true && (OPERATION_KEY.test(value) || looksLikeName(value))) {
    return false;
  }
  return true;
}

function holdsNames(name: string, value: unknown): boolean {
  if (!NAMES_FIELD.test(name)) return false;
  return (
    typeof value === 'string' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

/** A field whose value is read as a secret: of a secret name, and not one of names. */
function holdsSecret(name: string, value: unknown): boolean {
  return isSecretField(name) && !holdsNames(name, value);
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

/** Every string of a value of a secret field, but the words of a field naming a kind. */
function stringsIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (isObject(value)) {
    for (const [key, item] of Object.entries(value))
      if (!isKindWord(key, item)) stringsIn(item, out);
  }
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
export function secretFieldValues(body: unknown, options: SecretFieldOptions = {}): string[] {
  const out: string[] = [];
  const credentials: string[] = [];
  // Every string under a field of a secret name; a credential's own field inside it is taken whole.
  // `inside`: the string sits in an object under that field, not in the field itself.
  const collect = (key: string, item: unknown, inside = false): void => {
    if (isCredentialLeaf(key, item, options)) credentials.push(item);
    else if (typeof item === 'string') {
      if (!(inside && isOwnMetadata(key, item, options))) out.push(item);
    } else if (Array.isArray(item)) for (const inner of item) collect('', inner, inside);
    else if (isObject(item)) {
      for (const [inner, value] of Object.entries(item)) {
        if (SCHEMA_CONTAINERS.has(inner)) walk(value, true);
        else if (!isKindWord(inner, value)) collect(inner, value, true);
      }
    }
  };
  const walk = (value: unknown, namesFields: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, false);
      return;
    }
    if (!isObject(value)) return;
    if (isSecretInput(value)) stringsIn(value.input, out);
    for (const [key, item] of Object.entries(value)) {
      // the keys of a schema container are names, its values what they describe
      if (SCHEMA_CONTAINERS.has(key)) walk(item, true);
      else if (!namesFields && holdsSecret(key, item)) collect(key, item);
      else walk(item, false);
    }
  };
  walk(body, false);
  return [...new Set([...credentials, ...out.filter((value) => isSecretValue(value, options))])];
}

/**
 * Keys of the metadata of an item that a list of a secret name holds in LoadCraft's own answer (a
 * push token's `id`, `created_at`, `created_by`, `last_outcome`, `last_refusal_codes`, its `label`):
 * they say which item it is and what became of it, never its secret. The label is shown through
 * `content()`, whose mask by shape still takes one that looks like a secret.
 */
const OWN_METADATA_KEY = /^(?:id|label|created_by|last_outcome|[a-z0-9_]+_(?:id|at|codes))$/iu;

/** A whole ISO 8601 moment (`2026-11-01T08:00:00Z`, `…T03:00:00.123456+00:00`): a time is no secret. */
const ISO_MOMENT =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;

/**
 * Inside an item under a field of a secret name, in LoadCraft's own answer only: a moment, or a
 * value under a key of metadata, is not registered. The field's own value, a credential's own
 * field (`token`, `secret`) beside them, and every value of a third party's text still are.
 */
function isOwnMetadata(key: string, item: string, options: SecretFieldOptions): boolean {
  return options.ownContract === true && (OWN_METADATA_KEY.test(key) || ISO_MOMENT.test(item));
}

/** A scalar under a credential's own name in LoadCraft's answer: registered whatever it looks like. */
function isCredentialLeaf(key: string, item: unknown, options: SecretFieldOptions): item is string {
  return (
    options.ownContract === true &&
    typeof item === 'string' &&
    item.trim() !== '' &&
    CREDENTIAL_LEAF.test(key) &&
    !VARIABLE_REFERENCE.test(item) &&
    !OPERATION_KEY.test(item)
  );
}

/**
 * Every string replaced with the redaction marker; numbers, flags, the shape and the words of the
 * fields naming a kind (masked as any other text) stay.
 */
function redactStrings(value: unknown, masker: Masker): unknown {
  if (typeof value === 'string') return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactStrings(item, masker));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isKindWord(key, item) ? hideIn(item, masker) : redactStrings(item, masker),
      ]),
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
      holdsSecret(key, item) || (secretInput && key === 'input')
        ? redactStrings(item, masker)
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

/**
 * Whether a field of LoadCraft's own documentation (a generated artifact, the stored contract) holds
 * a secret: a credential's own field with a scalar value, or a field of a secret name with a value
 * that is not a name, a reference to a variable or an operation. `session_vars: ["city", …]` holds
 * names, `password: "hunter"` a password.
 */
export function holdsOwnSecret(key: string, item: unknown): boolean {
  if (!holdsSecret(key, item)) return false;
  if (isCredentialLeaf(key, item, { ownContract: true })) return true;
  return secretFieldValues({ [key]: item }, { ownContract: true }).length > 0;
}
