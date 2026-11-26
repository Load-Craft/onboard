// Validate the single-file AsyncAPI 3.0 contract consumed reliably by LoadCraft.
// Run it as `node validate_asyncapi.mjs <asyncapi.json>`; the .mjs is built from this file.

import {
  JSONDecodeError,
  PyCrash,
  PyOSError,
  PyPath,
  PyRecursionError,
  UnicodeDecodeError,
  casefold,
  compareStr,
  compile,
  compileGlobal,
  intOfDigits,
  loads,
  parseArgs,
  readText,
  reprStr,
  runMain,
  sortedUniquePointers,
  strip,
  stripChars,
  type ParserSpec,
  type PointerIssue,
  type PyValue,
} from './py/index.ts';

const ASYNCAPI_VERSION = '3.0.0';
const OPERATION_ACTIONS = new Set(['send', 'receive']);
const UNRESOLVED_KEYS = new Set(['x-todo', 'x-loadcraft-blocker']);
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const MESSAGE_REF_PREFIX = '#/components/messages/';
const CHANNEL_REF_PREFIX = '#/channels/';
const MAX_REF_CHAIN_DEPTH = 20;
const I = { ignoreCase: true };
const SECRET_PATTERNS = [
  compile('-----BEGIN [A-Z ]*PRIVATE KEY-----'),
  compile(String.raw`\bBearer\s+[A-Za-z0-9._~-]{20,}\b`, I),
  compile(String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b`),
  compile(String.raw`\bAKIA[0-9A-Z]{16}\b`),
  compile(String.raw`\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b`),
];
const SENSITIVE_PROPERTY_NAMES = new Set([
  'api_key',
  'authorization',
  'password',
  'passwd',
  'secret',
  'token',
]);
const CAMEL_BOUNDARY = compileGlobal(String.raw`(?<=[a-z0-9])(?=[A-Z])`);
const NON_ALNUM_RUN = compileGlobal(String.raw`[^a-z0-9]+`);
const TODO_MARKER = compile(String.raw`\[\s*TODO\b`, I);

const PROVENANCE_KEY = 'x-loadcraft-source';
const PROVENANCE_METHODS = new Set(['native-export', 'static-trace']);
const COMMIT_PATTERN = compile('^[0-9a-f]{7,64}$', {}, 'match');

// Python's recursion limit is 1000 frames; the generator chain of `_walk` (one frame per JSON level)
// is what runs out first on a deeply nested document. The schema descent needs at least one JSON
// level per schema level, so it can never be the first to fail. A document nested deeper than the
// walk allows is reported as Python reports it (the threshold was measured on CPython 3.14).
const MAX_WALK_DEPTH = 990;

// Characters Python's `str.isdigit()` accepts besides the decimal digits (`\p{Nd}`): `int()` rejects them.
const EXTRA_DIGITS =
  '\\u00b2\\u00b3\\u00b9\\u1369-\\u1371\\u19da\\u2070\\u2074-\\u2079\\u2080-\\u2089\\u2460-\\u2468' +
  '\\u2474-\\u247c\\u2488-\\u2490\\u24ea\\u24f5-\\u24fd\\u24ff\\u2776-\\u277e\\u2780-\\u2788' +
  '\\u278a-\\u2792\\u{10a40}-\\u{10a43}\\u{10e60}-\\u{10e68}\\u{11052}-\\u{1105a}\\u{1f100}-\\u{1f10a}';
const PY_ISDIGIT = new RegExp(`^[\\p{Nd}${EXTRA_DIGITS}]+$`, 'u');
const DECIMAL_ONLY = /^\p{Nd}+$/u;
const INT_MAX_STR_DIGITS = 4300;

type Issue = PointerIssue;
type Mapping = Map<string, PyValue>;

function pointerOf(parent: string, child: string): string {
  const escaped = child.replace(/~/g, '~0').replace(/\//g, '~1');
  return parent !== '' ? `${parent}/${escaped}` : `/${escaped}`;
}

/** `mapping.get(key)`: a missing key reads as `None`, the same as a JSON null. */
function get(mapping: Mapping, key: string): PyValue {
  const value = mapping.get(key);
  return value === undefined ? null : value;
}

/** `value in {set of str}` for a value of any JSON type: a list or an object is not hashable (CPython 3.14 wording). */
function inStringSet(value: PyValue, set: ReadonlySet<string>): boolean {
  if (Array.isArray(value))
    throw new PyCrash('TypeError', "cannot use 'list' as a set element (unhashable type: 'list')");
  if (value instanceof Map)
    throw new PyCrash('TypeError', "cannot use 'dict' as a set element (unhashable type: 'dict')");
  return typeof value === 'string' && set.has(value);
}

function isSensitiveProperty(name: string): boolean {
  const split = name.replace(CAMEL_BOUNDARY, '_');
  const normalized = stripChars(casefold(split).replace(NON_ALNUM_RUN, '_'), '_');
  if (SENSITIVE_PROPERTY_NAMES.has(normalized)) return true;
  return [...SENSITIVE_PROPERTY_NAMES].some((suffix) => normalized.endsWith(`_${suffix}`));
}

/** `_walk`: every value of the document with its JSON pointer, parents before children. */
function walk(
  value: PyValue,
  pointer: string,
  visit: (pointer: string, value: PyValue) => void,
  depth = 0,
): void {
  if (depth > MAX_WALK_DEPTH) throw new PyRecursionError();
  visit(pointer === '' ? '/' : pointer, value);
  if (value instanceof Map) {
    for (const [key, child] of value) walk(child, pointerOf(pointer, key), visit, depth + 1);
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => {
      walk(child, pointerOf(pointer, String(index)), visit, depth + 1);
    });
  }
}

/** `int(text)` on a string `str.isdigit()` accepted, with CPython's failures. */
function intOfDigitString(part: string): bigint {
  if (!DECIMAL_ONLY.test(part)) {
    throw new PyCrash(
      'ValueError',
      `invalid literal for int() with base 10: ${Array.from(reprStr(part)).slice(0, 200).join('')}`,
    );
  }
  const digits = Array.from(part).length;
  if (digits > INT_MAX_STR_DIGITS) {
    throw new PyCrash(
      'ValueError',
      `Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  }
  return intOfDigits(part);
}

function resolveRef(document: Mapping, ref: string): PyValue | undefined {
  if (!ref.startsWith('#/')) return undefined;
  let current: PyValue = document;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current instanceof Map && current.has(part)) {
      current = current.get(part) as PyValue;
      continue;
    }
    if (
      Array.isArray(current) &&
      PY_ISDIGIT.test(part) &&
      intOfDigitString(part) < BigInt(current.length)
    ) {
      current = current[Number(intOfDigitString(part))] as PyValue;
      continue;
    }
    return undefined;
  }
  return current;
}

function requireText(
  mapping: Mapping,
  key: string,
  pointer: string,
  issues: Issue[],
): string | null {
  const value = get(mapping, key);
  if (typeof value !== 'string' || strip(value) === '') {
    issues.push({ pointer: pointerOf(pointer, key), message: 'must be a non-empty string' });
    return null;
  }
  return strip(value);
}

function validateProvenance(info: Mapping, issues: Issue[]): void {
  const stamp = get(info, PROVENANCE_KEY);
  if (stamp === null) return;
  const pointer = pointerOf('/info', PROVENANCE_KEY);
  if (!(stamp instanceof Map)) {
    issues.push({ pointer, message: 'x-loadcraft-source must be an object' });
    return;
  }
  const commit = get(stamp, 'commit');
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    issues.push({
      pointer: pointerOf(pointer, 'commit'),
      message: 'x-loadcraft-source commit must be a git object hash',
    });
  }
  if (typeof get(stamp, 'dirty') !== 'boolean') {
    issues.push({
      pointer: pointerOf(pointer, 'dirty'),
      message: 'x-loadcraft-source dirty must be a boolean',
    });
  }
  if (!inStringSet(get(stamp, 'method'), PROVENANCE_METHODS)) {
    issues.push({
      pointer: pointerOf(pointer, 'method'),
      message: "x-loadcraft-source method must be 'native-export' or 'static-trace'",
    });
  }
  const unknown = [...stamp.keys()].filter(
    (key) => key !== 'commit' && key !== 'dirty' && key !== 'method',
  );
  if (unknown.length > 0) {
    issues.push({
      pointer,
      message: `x-loadcraft-source has unsupported keys: ${unknown.sort(compareStr).join(', ')}`,
    });
  }
}

function validateGlobalMarkers(document: Mapping, issues: Issue[]): void {
  walk(document, '', (pointer, value) => {
    if (value instanceof Map) {
      for (const [key, child] of value) {
        const base = pointer === '/' ? '' : pointer;
        if (UNRESOLVED_KEYS.has(key.toLowerCase())) {
          issues.push({
            pointer: pointerOf(base, key),
            message: 'unresolved marker is not allowed in a deliverable',
          });
        }
        if (isSensitiveProperty(key) && !(child instanceof Map)) {
          issues.push({
            pointer: pointerOf(base, key),
            message: 'secret-bearing field must not embed a literal value',
          });
        }
      }
    }
    if (typeof value !== 'string') return;
    if (TODO_MARKER.test(value)) {
      issues.push({ pointer, message: 'unresolved marker is not allowed in a deliverable' });
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      issues.push({
        pointer,
        message: 'secret-like value must not be embedded in the specification',
      });
    }
  });
}

function validateRefs(document: Mapping, issues: Issue[]): void {
  walk(document, '', (pointer, value) => {
    if (!(value instanceof Map) || !value.has('$ref')) return;
    const ref = get(value, '$ref');
    const refPointer = pointerOf(pointer === '/' ? '' : pointer, '$ref');
    if (typeof ref !== 'string' || ref === '') {
      issues.push({ pointer: refPointer, message: '$ref must be a non-empty string' });
      return;
    }
    if (!ref.startsWith('#/')) {
      issues.push({ pointer: refPointer, message: `external $ref is not allowed: ${ref}` });
      return;
    }
    validateRefChain(document, ref, refPointer, issues);
  });
}

/** Follow a chain of internal $refs, rejecting cycles and over-deep chains. */
function validateRefChain(
  document: Mapping,
  ref: string,
  refPointer: string,
  issues: Issue[],
): void {
  const seen = new Set<string>();
  let current = ref;
  let depth = 0;
  for (;;) {
    if (seen.has(current)) {
      issues.push({ pointer: refPointer, message: `cyclic $ref chain detected at: ${current}` });
      return;
    }
    seen.add(current);
    depth += 1;
    if (depth > MAX_REF_CHAIN_DEPTH) {
      issues.push({
        pointer: refPointer,
        message: `reference chain exceeds the supported depth of ${MAX_REF_CHAIN_DEPTH}`,
      });
      return;
    }
    const resolved = resolveRef(document, current);
    if (resolved === undefined || resolved === null) {
      issues.push({ pointer: refPointer, message: `unresolved $ref: ${current}` });
      return;
    }
    if (resolved instanceof Map) {
      const nested = get(resolved, '$ref');
      if (typeof nested === 'string') {
        if (!nested.startsWith('#/')) {
          issues.push({ pointer: refPointer, message: `external $ref is not allowed: ${nested}` });
          return;
        }
        current = nested;
        continue;
      }
    }
    return;
  }
}

/** Validate one Schema Object and its schema-bearing children. */
function validateSchemaObject(value: PyValue, pointer: string, issues: Issue[]): void {
  if (typeof value === 'boolean') {
    issues.push({
      pointer,
      message: 'boolean schemas are not supported in the LoadCraft compatibility profile',
    });
    return;
  }
  if (!(value instanceof Map)) {
    issues.push({ pointer, message: 'schema must be an object' });
    return;
  }

  const schemaType = get(value, 'type');
  if (schemaType !== null) {
    if (typeof schemaType !== 'string') {
      issues.push({
        pointer: pointerOf(pointer, 'type'),
        message: 'schema type must be a single string in the LoadCraft compatibility profile',
      });
    } else if (!SCHEMA_TYPES.has(schemaType)) {
      issues.push({
        pointer: pointerOf(pointer, 'type'),
        message: `unsupported schema type: ${schemaType}`,
      });
    }
  }

  for (const keyword of ['oneOf', 'anyOf']) {
    if (value.has(keyword)) {
      issues.push({
        pointer: pointerOf(pointer, keyword),
        message: 'oneOf/anyOf is lossy in LoadCraft; model one unambiguous schema instead',
      });
    }
  }

  const properties = get(value, 'properties');
  if (properties !== null && !(properties instanceof Map)) {
    issues.push({
      pointer: pointerOf(pointer, 'properties'),
      message: 'properties must be an object',
    });
  }
  const required = get(value, 'required');
  if (required !== null && !Array.isArray(required)) {
    issues.push({ pointer: pointerOf(pointer, 'required'), message: 'required must be an array' });
  } else if (Array.isArray(required)) {
    if (!(properties instanceof Map)) {
      issues.push({
        pointer: pointerOf(pointer, 'required'),
        message: 'schema with required fields must declare properties',
      });
    } else {
      for (const requiredName of required) {
        if (typeof requiredName !== 'string') {
          issues.push({
            pointer: pointerOf(pointer, 'required'),
            message: 'required entries must be strings',
          });
        } else if (!properties.has(requiredName)) {
          issues.push({
            pointer: pointerOf(pointer, 'required'),
            message: `required property ${reprStr(requiredName)} is not declared in properties`,
          });
        }
      }
    }
  }

  if (properties instanceof Map) {
    for (const [propertyName, propertySchema] of properties) {
      if (isSensitiveProperty(propertyName) && propertySchema instanceof Map) {
        for (const keyword of ['default', 'enum', 'example']) {
          if (propertySchema.has(keyword)) {
            issues.push({
              pointer: pointerOf(
                pointerOf(pointerOf(pointer, 'properties'), propertyName),
                keyword,
              ),
              message: 'secret-bearing property must not embed a literal value',
            });
          }
        }
      }
      validateSchemaObject(
        propertySchema,
        pointerOf(pointerOf(pointer, 'properties'), propertyName),
        issues,
      );
    }
  }

  if (value.has('items')) {
    validateSchemaObject(get(value, 'items'), pointerOf(pointer, 'items'), issues);
  }

  const additionalProperties = get(value, 'additionalProperties');
  if (additionalProperties instanceof Map) {
    validateSchemaObject(additionalProperties, pointerOf(pointer, 'additionalProperties'), issues);
  }

  const allOf = get(value, 'allOf');
  if (Array.isArray(allOf)) {
    allOf.forEach((member, index) => {
      validateSchemaObject(member, pointerOf(pointerOf(pointer, 'allOf'), String(index)), issues);
    });
  }
}

/** Reject schema constructs that LoadCraft currently parses lossily. */
function validateSchemaSubset(document: Mapping, issues: Issue[]): void {
  const roots = new Map<string, PyValue>();
  const components = get(document, 'components');
  if (components instanceof Map) {
    const schemas = get(components, 'schemas');
    if (schemas instanceof Map) {
      for (const [name, schema] of schemas)
        roots.set(pointerOf('/components/schemas', name), schema);
    }
    const messages = get(components, 'messages');
    if (messages instanceof Map) {
      for (const [name, message] of messages) {
        if (!(message instanceof Map)) continue;
        const base = pointerOf('/components/messages', name);
        const payload = message.get('payload');
        if (payload instanceof Map) roots.set(pointerOf(base, 'payload'), payload);
        const headers = message.get('headers');
        if (headers instanceof Map) roots.set(pointerOf(base, 'headers'), headers);
      }
    }
  }

  const ordered = [...roots.entries()].sort((a, b) => compareStr(a[0], b[0]));
  for (const [pointer, schema] of ordered) validateSchemaObject(schema, pointer, issues);
}

function isMessageRef(value: PyValue): boolean {
  if (!(value instanceof Map)) return false;
  const ref = get(value, '$ref');
  return typeof ref === 'string' && ref.startsWith(MESSAGE_REF_PREFIX);
}

function hasContentType(message: PyValue): boolean {
  if (!(message instanceof Map)) return false;
  const contentType = get(message, 'contentType');
  return typeof contentType === 'string' && strip(contentType) !== '';
}

function validateContentType(document: Mapping, issues: Issue[]): void {
  const defaultContentType = get(document, 'defaultContentType');
  if (typeof defaultContentType === 'string' && strip(defaultContentType) !== '') return;
  const components = get(document, 'components');
  const messages = components instanceof Map ? get(components, 'messages') : null;
  if (!(messages instanceof Map)) return;
  for (const [name, message] of messages) {
    if (!hasContentType(message)) {
      issues.push({
        pointer: pointerOf(pointerOf('/components/messages', name), 'contentType'),
        message:
          'defaultContentType is unset, so every message must declare a non-empty contentType',
      });
    }
  }
}

const SERVER_KEYS = new Set([
  'host',
  'protocol',
  'protocolVersion',
  'pathname',
  'description',
  'title',
  'summary',
  'variables',
  'security',
  'tags',
  'externalDocs',
  'bindings',
]);
const OPERATION_KEYS = new Set([
  'action',
  'channel',
  'title',
  'summary',
  'description',
  'security',
  'tags',
  'externalDocs',
  'bindings',
  'traits',
  'messages',
  'reply',
]);

/** The official parser rejects a field the 3.0 object does not define (`x-` extensions are free). */
function unknownKeys(
  object: Mapping,
  allowed: ReadonlySet<string>,
  pointer: string,
  issues: Issue[],
): void {
  for (const key of object.keys()) {
    if (allowed.has(key) || key.startsWith('x-') || key === 'url') continue;
    issues.push({
      pointer: pointerOf(pointer, key),
      message: `${key} is not a field of this AsyncAPI 3.0 object`,
    });
  }
}

function validateServers(document: Mapping, issues: Issue[]): void {
  const servers = get(document, 'servers');
  if (!(servers instanceof Map) || servers.size === 0) {
    issues.push({ pointer: '/servers', message: 'must be a non-empty object' });
    return;
  }
  for (const [name, server] of servers) {
    const pointer = pointerOf('/servers', name);
    if (!(server instanceof Map)) {
      issues.push({ pointer, message: 'must be an object' });
      continue;
    }
    // AsyncAPI 3.0 has host + protocol (+ pathname); `url` is the 2.x field and the official parser
    // rejects it (the importer only keeps it as an alias for old documents).
    if (server.has('url')) {
      issues.push({
        pointer: pointerOf(pointer, 'url'),
        message:
          'server url does not exist in AsyncAPI 3.0; declare host, protocol and optional pathname',
      });
    }
    unknownKeys(server, SERVER_KEYS, pointer, issues);
    const host = get(server, 'host');
    if (typeof host !== 'string' || strip(host) === '') {
      issues.push({
        pointer: pointerOf(pointer, 'host'),
        message: 'server host is required (AsyncAPI 3.0); the importer drops a server without it',
      });
    }
    const pathname = get(server, 'pathname');
    if (pathname !== null && typeof pathname !== 'string') {
      issues.push({
        pointer: pointerOf(pointer, 'pathname'),
        message: 'server pathname must be a string',
      });
    }
    const protocol = get(server, 'protocol');
    if (typeof protocol !== 'string' || strip(protocol) === '') {
      issues.push({
        pointer: pointerOf(pointer, 'protocol'),
        message:
          'server protocol is required; the importer never relies on address heuristics for a declared server',
      });
    }
  }
}

function validateChannels(document: Mapping, issues: Issue[]): void {
  const channels = get(document, 'channels');
  if (!(channels instanceof Map) || channels.size === 0) {
    issues.push({ pointer: '/channels', message: 'must be a non-empty object' });
    return;
  }
  for (const [name, channel] of channels) {
    const pointer = pointerOf('/channels', name);
    if (!(channel instanceof Map)) {
      issues.push({ pointer, message: 'must be an object' });
      continue;
    }
    const address = get(channel, 'address');
    if (typeof address !== 'string' || strip(address) === '') {
      issues.push({
        pointer: pointerOf(pointer, 'address'),
        message:
          'channel address is required; address-less channels are silently dropped by the importer',
      });
    }
    const channelMessages = get(channel, 'messages');
    if (channelMessages === null) continue;
    if (!(channelMessages instanceof Map)) {
      issues.push({
        pointer: pointerOf(pointer, 'messages'),
        message: 'channel messages must be an object',
      });
      continue;
    }
    for (const [messageKey, messageRef] of channelMessages) {
      const messagePointer = pointerOf(pointerOf(pointer, 'messages'), messageKey);
      if (!isMessageRef(messageRef)) {
        issues.push({
          pointer: messagePointer,
          message: `channel message must reference ${MESSAGE_REF_PREFIX}<name>`,
        });
      }
    }
  }
}

function channelMessageSet(document: Mapping, channelId: string): Mapping | null {
  const channels = get(document, 'channels');
  if (!(channels instanceof Map)) return null;
  const channel = get(channels, channelId);
  if (!(channel instanceof Map)) return null;
  const messages = get(channel, 'messages');
  return messages instanceof Map ? messages : null;
}

function validateOperations(document: Mapping, issues: Issue[]): number {
  const operations = get(document, 'operations');
  if (!(operations instanceof Map) || operations.size === 0) {
    issues.push({ pointer: '/operations', message: 'must be a non-empty object' });
    return 0;
  }

  let validOperations = 0;
  for (const [name, operation] of operations) {
    const pointer = pointerOf('/operations', name);
    const before = issues.length;
    if (!(operation instanceof Map)) {
      issues.push({ pointer, message: 'must be an object' });
      continue;
    }

    unknownKeys(operation, OPERATION_KEYS, pointer, issues);
    const action = get(operation, 'action');
    if (!inStringSet(action, OPERATION_ACTIONS)) {
      issues.push({
        pointer: pointerOf(pointer, 'action'),
        message: "operation action must be exactly 'send' or 'receive'",
      });
    }

    const channel = get(operation, 'channel');
    let channelId: string | null = null;
    const channelRef = channel instanceof Map ? get(channel, '$ref') : null;
    if (
      channel instanceof Map &&
      typeof channelRef === 'string' &&
      channelRef.startsWith(CHANNEL_REF_PREFIX)
    ) {
      const candidate = channelRef.slice(CHANNEL_REF_PREFIX.length);
      const channels = get(document, 'channels');
      if (
        channelMessageSet(document, candidate) !== null ||
        (channels instanceof Map && channels.has(candidate))
      ) {
        channelId = candidate;
      } else {
        issues.push({
          pointer: pointerOf(pointerOf(pointer, 'channel'), '$ref'),
          message: `operation channel ${candidate} does not exist in channels`,
        });
      }
    } else {
      issues.push({
        pointer: pointerOf(pointer, 'channel'),
        message: `operation channel must be a $ref to ${CHANNEL_REF_PREFIX}<id>`,
      });
    }

    let explicitMessages = get(operation, 'messages');
    if (Array.isArray(explicitMessages) && explicitMessages.length === 0) {
      // The importer treats an empty list exactly like an absent field:
      // it falls back to the channel's messages and keeps the operation.
      explicitMessages = null;
    }
    let effectiveMessageCount = 0;
    if (explicitMessages !== null) {
      if (!Array.isArray(explicitMessages)) {
        issues.push({
          pointer: pointerOf(pointer, 'messages'),
          message: 'operation messages must be an array',
        });
      } else {
        for (const [index, messageRef] of explicitMessages.entries()) {
          const messagePointer = pointerOf(pointerOf(pointer, 'messages'), String(index));
          const ownPrefix =
            channelId === null ? null : `${CHANNEL_REF_PREFIX}${channelId}/messages/`;
          const messageRefValue = messageRef instanceof Map ? get(messageRef, '$ref') : null;
          if (
            typeof messageRefValue !== 'string' ||
            ownPrefix === null ||
            !messageRefValue.startsWith(ownPrefix)
          ) {
            // AsyncAPI 3.0: an operation lists messages of its own channel, `#/channels/<id>/messages/<key>`.
            issues.push({
              pointer: messagePointer,
              message: `operation message must reference a message of its own channel (${CHANNEL_REF_PREFIX}<channel>/messages/<key>)`,
            });
          } else {
            const key = messageRefValue.slice(ownPrefix.length);
            const channelMessages = channelMessageSet(document, channelId as string);
            if (channelMessages instanceof Map && channelMessages.has(key)) {
              effectiveMessageCount += 1;
            } else {
              issues.push({
                pointer: messagePointer,
                message: `operation message ${key} is not a message of channel ${channelId as string}`,
              });
            }
          }
        }
      }
    } else if (channelId !== null) {
      const channelMessages = channelMessageSet(document, channelId);
      if (channelMessages instanceof Map) effectiveMessageCount = channelMessages.size;
    }

    if (effectiveMessageCount === 0) {
      issues.push({
        pointer,
        message:
          "operation has no resolvable message; explicit refs or its channel's messages must supply at least one",
      });
    }

    if (issues.length === before) validOperations += 1;
  }

  return validOperations;
}

function validateMessages(document: Mapping, issues: Issue[]): void {
  const components = get(document, 'components');
  const messages = components instanceof Map ? get(components, 'messages') : null;
  if (!(messages instanceof Map)) return;
  for (const [name, message] of messages) {
    const pointer = pointerOf('/components/messages', name);
    if (!(message instanceof Map)) {
      issues.push({ pointer, message: 'must be an object' });
      continue;
    }
    const payload = get(message, 'payload');
    if (!(payload instanceof Map)) {
      issues.push({
        pointer: pointerOf(pointer, 'payload'),
        message: 'message payload must be an object schema',
      });
    }
    const examples = get(message, 'examples');
    const firstExample =
      Array.isArray(examples) && examples.length > 0 ? (examples[0] as PyValue) : null;
    const firstPayload = firstExample instanceof Map ? get(firstExample, 'payload') : null;
    if (firstPayload === null) {
      issues.push({
        pointer: pointerOf(pointer, 'examples'),
        message:
          "message's first example must carry a non-null payload; the importer uses the first example verbatim",
      });
    }
  }
}

type FieldKind = 'string' | 'array' | 'object' | 'boolean';
type FieldSpec = Record<string, FieldKind | null>;

// Fields of the AsyncAPI 3.0 objects the official parser checks (`x-` extensions are free; null = any value).
const CHANNEL_FIELDS: FieldSpec = {
  address: null,
  messages: 'object',
  title: 'string',
  summary: 'string',
  description: 'string',
  servers: 'array',
  parameters: 'object',
  tags: 'array',
  externalDocs: 'object',
  bindings: 'object',
};
const MESSAGE_FIELDS: FieldSpec = {
  headers: null,
  payload: null,
  correlationId: null,
  contentType: 'string',
  name: 'string',
  title: 'string',
  summary: 'string',
  description: 'string',
  tags: 'array',
  externalDocs: 'object',
  bindings: 'object',
  examples: 'array',
  traits: 'array',
};
const EXAMPLE_FIELDS: FieldSpec = {
  headers: 'object',
  payload: null,
  name: 'string',
  summary: 'string',
};
const PARAMETER_FIELDS: FieldSpec = {
  enum: 'array',
  default: 'string',
  description: 'string',
  examples: 'array',
  location: 'string',
};
const OPERATION_TYPES: FieldSpec = {
  title: 'string',
  summary: 'string',
  description: 'string',
  security: 'array',
  tags: 'array',
  externalDocs: 'object',
  bindings: 'object',
  traits: 'array',
  messages: 'array',
  reply: 'object',
  channel: 'object',
};
const KIND_TEST: Record<FieldKind, (value: PyValue) => boolean> = {
  string: (value) => typeof value === 'string',
  array: (value) => Array.isArray(value),
  object: (value) => value instanceof Map,
  boolean: (value) => typeof value === 'boolean',
};

/** Unknown fields and fields of the wrong type, as the official parser reports them. */
function checkFields(
  object: Mapping,
  spec: FieldSpec,
  pointer: string,
  issues: Issue[],
  onlyTypes = false,
): void {
  for (const [key, value] of object) {
    const fieldPointer = pointerOf(pointer, key);
    if (!Object.hasOwn(spec, key)) {
      if (!onlyTypes && !key.startsWith('x-')) {
        issues.push({
          pointer: fieldPointer,
          message: `${key} is not a field of this AsyncAPI 3.0 object`,
        });
      }
      continue;
    }
    const kind = spec[key];
    if (kind && !KIND_TEST[kind](value)) {
      issues.push({
        pointer: fieldPointer,
        message: `${key} must be of type ${kind} (AsyncAPI 3.0)`,
      });
    }
  }
}

function validateStructure(document: Mapping, issues: Issue[]): void {
  const channels = get(document, 'channels');
  if (channels instanceof Map) {
    for (const [id, channel] of channels) {
      if (!(channel instanceof Map)) continue;
      const pointer = pointerOf('/channels', id);
      checkFields(channel, CHANNEL_FIELDS, pointer, issues);
      const address = get(channel, 'address');
      const parameters = get(channel, 'parameters');
      const named = new Set(
        typeof address === 'string'
          ? [...address.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] as string)
          : [],
      );
      if (parameters instanceof Map) {
        for (const [name, parameter] of parameters) {
          if (!named.has(name)) {
            issues.push({
              pointer: pointerOf(pointerOf(pointer, 'parameters'), name),
              message: `channel parameter ${name} does not appear in the address`,
            });
          }
          if (parameter instanceof Map && typeof get(parameter, '$ref') !== 'string') {
            checkFields(
              parameter,
              PARAMETER_FIELDS,
              pointerOf(pointerOf(pointer, 'parameters'), name),
              issues,
            );
          }
        }
      }
      for (const name of named) {
        if (!(parameters instanceof Map && parameters.has(name))) {
          issues.push({
            pointer: pointerOf(pointer, 'parameters'),
            message: `address parameter ${name} is not described under parameters`,
          });
        }
      }
    }
  }
  const components = get(document, 'components');
  const messages = components instanceof Map ? get(components, 'messages') : null;
  if (messages instanceof Map) {
    for (const [name, message] of messages) {
      if (!(message instanceof Map)) continue;
      const pointer = pointerOf('/components/messages', name);
      checkFields(message, MESSAGE_FIELDS, pointer, issues);
      const examples = get(message, 'examples');
      if (Array.isArray(examples)) {
        examples.forEach((example, index) => {
          if (example instanceof Map) {
            checkFields(
              example,
              EXAMPLE_FIELDS,
              pointerOf(pointerOf(pointer, 'examples'), String(index)),
              issues,
            );
          }
        });
      }
    }
  }
  const operations = get(document, 'operations');
  if (operations instanceof Map) {
    for (const [name, operation] of operations) {
      if (operation instanceof Map)
        checkFields(operation, OPERATION_TYPES, pointerOf('/operations', name), issues, true);
    }
  }
}

export function validateDocument(document: PyValue): [Issue[], number] {
  const issues: Issue[] = [];
  if (!(document instanceof Map))
    return [[{ pointer: '/', message: 'document must be a JSON object' }], 0];

  validateGlobalMarkers(document, issues);
  validateRefs(document, issues);
  validateSchemaSubset(document, issues);

  const version = get(document, 'asyncapi');
  if (version !== ASYNCAPI_VERSION) {
    issues.push({
      pointer: '/asyncapi',
      message:
        'must be AsyncAPI 3.0.0; a 2.x document imports as zero channels and zero operations in LoadCraft',
    });
  }

  const info = get(document, 'info');
  if (!(info instanceof Map)) {
    issues.push({ pointer: '/info', message: 'must be an object' });
  } else {
    requireText(info, 'title', '/info', issues);
    requireText(info, 'version', '/info', issues);
    validateProvenance(info, issues);
  }

  validateContentType(document, issues);
  validateServers(document, issues);
  validateChannels(document, issues);
  validateMessages(document, issues);
  validateStructure(document, issues);
  const operationCount = validateOperations(document, issues);

  return [sortedUniquePointers(issues), operationCount];
}

/** Python writes stderr with `backslashreplace`: a lone surrogate prints as `\udXXX`. */
function stderrSafe(text: string): string {
  return text.replace(
    /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16)}`,
  );
}

const SPEC: ParserSpec = {
  usage: 'usage: validate_asyncapi.mjs [-h] spec\n',
  help: `Validate a self-contained AsyncAPI 3.0 JSON file for LoadCraft.

positional arguments:
  spec        Path to the canonical asyncapi.json

options:
  -h, --help  show this help message and exit
`,
  positionals: [{ dest: 'spec', many: false }],
  options: [],
};

export function main(
  out: { print(text: string): void; eprint(text: string): void },
  argv: string[],
  prog: string,
): number {
  const args = parseArgs(SPEC, prog, argv);
  const path = new PyPath(args.spec as string);
  if (path.suffix.toLowerCase() !== '.json') {
    out.eprint('ERROR /: canonical LoadCraft artifact must be a .json file');
    return 1;
  }
  let document: PyValue;
  try {
    document = loads(readText(path.text), 3000);
  } catch (error) {
    if (error instanceof PyOSError && error.kind === 'FileNotFoundError') {
      out.eprint(stderrSafe(`ERROR /: file not found: ${path.display}`));
      return 1;
    }
    if (error instanceof UnicodeDecodeError) {
      out.eprint(`ERROR /: file must be UTF-8: ${error.message}`);
      return 1;
    }
    if (error instanceof JSONDecodeError) {
      out.eprint(
        `ERROR /: invalid JSON at line ${error.lineno}, column ${error.colno}: ${error.msg}`,
      );
      return 1;
    }
    if (error instanceof PyRecursionError) {
      out.eprint('ERROR /: document nesting exceeds the supported depth');
      return 1;
    }
    throw error;
  }

  let issues: Issue[];
  let operationCount: number;
  try {
    [issues, operationCount] = validateDocument(document);
  } catch (error) {
    if (error instanceof PyRecursionError) {
      out.eprint('ERROR /: document nesting exceeds the supported depth');
      return 1;
    }
    throw error;
  }
  if (issues.length > 0) {
    for (const issue of issues) out.eprint(stderrSafe(`ERROR ${issue.pointer}: ${issue.message}`));
    return 1;
  }
  const noun = operationCount === 1 ? 'operation' : 'operations';
  out.print(
    `PASS: ${path.display} passes LoadCraft structural preflight (${operationCount} ${noun}).`,
  );
  return 0;
}

runMain(main);
