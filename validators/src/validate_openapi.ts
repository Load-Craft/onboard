// Validate the single-file OpenAPI contract consumed reliably by LoadCraft.
//
// Errors block a structural import. Warnings do not, but they describe artifacts the importer
// accepts while generating materially worse flows and feeder data; use --strict to fail on them too.
// Run it as `node validate_openapi.mjs <openapi.json>`; the .mjs is built from this file.

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
  dumps,
  groupThousands,
  intOfDigits,
  loads,
  parseArgs,
  pyLen,
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
import { checkOas3Structure } from './oas3-struct.ts';

type Obj = Map<string, PyValue>;
type Issue = PointerIssue;
type Warning = PointerIssue;
type SizeRow = { label: string; size: number; truncated: boolean };

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const UNSUPPORTED_METHODS = ['trace'];
const UNRESOLVED_KEYS = new Set(['x-todo', 'x-loadcraft-blocker']);
const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);
const SECURITY_SCHEME_TYPES = new Set(['apiKey', 'http', 'oauth2', 'openIdConnect']);
const PARAMETER_LOCATIONS = new Set(['path', 'query', 'header', 'cookie']);
// The importer carries a request body with exactly the media type the spec declares, so any
// concrete RFC 6838 `type/subtype` (with optional parameters) is accepted; a wildcard range or a
// malformed key is rejected at import.
const RESTRICTED_NAME = String.raw`[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}`;
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const QUOTED_STRING = String.raw`"(?:[^"\\\r\n{}]|\\[^{}\r\n])*"`;
const REQUEST_MEDIA_TYPE = compile(
  String.raw`${RESTRICTED_NAME}/${RESTRICTED_NAME}(?:[ \t]*;[ \t]*(?:${TOKEN}=(?:${TOKEN}|${QUOTED_STRING}))?)*`,
  {},
  'fullmatch',
);
// A redirect-only operation imports, and the generated client follows the redirect and asserts the
// final response.
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Success statuses that may legitimately carry no body: 202 Accepted for work handed off without a
// representation, 204/205 by definition.
const NO_CONTENT_SUCCESS_STATUSES = new Set([202, 204, 205]);
const EXAMPLE_EXEMPT_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'text/event-stream',
]);
const I = { ignoreCase: true };
const SECRET_PATTERNS = [
  compile('-----BEGIN [A-Z ]*PRIVATE KEY-----'),
  compile(String.raw`\bBearer\s+[A-Za-z0-9._~-]{20,}\b`, I),
  compile(String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b`),
  compile(String.raw`\bAKIA[0-9A-Z]{16}\b`),
  compile(String.raw`\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b`),
];
// A response example may show the SHAPE of a secret-bearing field with an angle-bracket
// placeholder; it is never a value, so a captured credential cannot hide behind it. Nowhere else
// (request bodies, schema properties, parameters).
const PLACEHOLDER_PATTERN = compile(String.raw`<[A-Za-z][A-Za-z0-9 _.-]{0,39}>`, {}, 'fullmatch');
const RESPONSE_EXAMPLE_POINTER = compile(
  String.raw`/responses/[^/]+/content/[^/]+/example(?:/.*)?$`,
);
// A security requirement is `{"schemeName": [scopes...]}`: the key names a scheme and the value is a
// scope list, so a scheme called `storeApiKey` carries no secret.
const SECURITY_REQUIREMENT_POINTER = compile(String.raw`(?:^|/)security/[0-9]+$`);
// The backend packs every operation of one generated path into a single prompt limited to 400,000
// characters (a sum, counted on the expanded operation). A path of about ten operations therefore
// affords roughly 40,000 characters each.
const BACKEND_PATH_BUDGET_CHARS = 400_000;
const EXPANDED_OPERATION_BUDGET_CHARS = 40_000n;
// Stop expanding once this many times the budget is spent: a reference graph can be exponential,
// and "far above the budget" is all the report needs to say.
const EXPANSION_ABORT_FACTOR = 10n;
const SENSITIVE_PROPERTY_NAMES = new Set([
  'api_key',
  'authorization',
  'password',
  'passwd',
  'secret',
  'token',
]);

const PROVENANCE_KEY = 'x-loadcraft-source';
const PROVENANCE_METHODS = new Set(['native-export', 'platform-export', 'static-trace']);
const COMMIT_PATTERN = compile('^[0-9a-f]{7,64}$', {}, 'match');
const STATUS_PATTERN = compile('[1-5][0-9]{2}', {}, 'fullmatch');
const ANY_STATUS_PATTERN = compile('[0-9]{3}', {}, 'fullmatch');
const CAMEL_BOUNDARY = '(?<=[a-z0-9])(?=[A-Z])';
const NON_ALNUM_RUN = '[^a-z0-9]+';
const PATH_VARIABLE = '\\{([^{}]+)\\}';
const TODO_MARKER = compile(String.raw`\[\s*TODO\b`, I);
const TBD_MARKER = compile(String.raw`\[\s*TBD\b|\bTBD\b`);

// Python's recursion limit and the frames the validator already holds when it recurses (module,
// main, validate_document and the function that owns the walk), so the same documents that make
// Python raise RecursionError raise it here. A call made from a frame at depth `d` needs frame
// `d + extra`; `isinstance(x, Mapping)` costs one frame of its own (ABCMeta.__instancecheck__).
const PY_RECURSION_LIMIT = 1000;
const PY_BASE_FRAMES = 4;

function pyDepth(level: number, extra: number): void {
  if (PY_BASE_FRAMES + level + extra > PY_RECURSION_LIMIT) {
    throw new PyRecursionError('maximum recursion depth exceeded');
  }
}

// The one Python-side crash a set lookup can cause: `x in {...}` hashes `x`.
function inSet(value: PyValue, set: ReadonlySet<string>): boolean {
  if (Array.isArray(value))
    throw new PyCrash('TypeError', "cannot use 'list' as a set element (unhashable type: 'list')");
  if (value instanceof Map)
    throw new PyCrash('TypeError', "cannot use 'dict' as a set element (unhashable type: 'dict')");
  return typeof value === 'string' && set.has(value);
}

// `mapping.get(key)`: a missing key and a JSON null are both None.
function get(mapping: Obj, key: string): PyValue {
  return mapping.get(key) ?? null;
}

function pointerOf(parent: string, child: string): string {
  const escaped = child.replaceAll('~', '~0').replaceAll('/', '~1');
  return parent !== '' ? `${parent}/${escaped}` : `/${escaped}`;
}

function isSensitiveProperty(name: string): boolean {
  const split = name.replace(compileGlobal(CAMEL_BOUNDARY), '_');
  const normalized = stripChars(casefold(split).replace(compileGlobal(NON_ALNUM_RUN), '_'), '_');
  return (
    SENSITIVE_PROPERTY_NAMES.has(normalized) ||
    [...SENSITIVE_PROPERTY_NAMES].some((suffix) => normalized.endsWith(`_${suffix}`))
  );
}

function* walk(value: PyValue, pointer = '', level = 1): Generator<[string, PyValue]> {
  yield [pointer === '' ? '/' : pointer, value];
  // The consumer has seen this value; Python's next step is `isinstance(value, Mapping)`.
  pyDepth(level, 1);
  if (value instanceof Map) {
    for (const [key, child] of value) yield* walk(child, pointerOf(pointer, key), level + 1);
  } else if (Array.isArray(value)) {
    for (const [index, child] of value.entries())
      yield* walk(child, pointerOf(pointer, String(index)), level + 1);
  }
}

// `str.isdigit()` is wider than the decimal digits `int()` accepts: it also takes superscripts,
// circled digits and the like (the list below is Python's: isdigit and not isdecimal).
const NON_DECIMAL_DIGIT = new RegExp(
  '^[\\u{b2}-\\u{b3}\\u{b9}\\u{1369}-\\u{1371}\\u{19da}\\u{2070}\\u{2074}-\\u{2079}\\u{2080}-\\u{2089}' +
    '\\u{2460}-\\u{2468}\\u{2474}-\\u{247c}\\u{2488}-\\u{2490}\\u{24ea}\\u{24f5}-\\u{24fd}\\u{24ff}' +
    '\\u{2776}-\\u{277e}\\u{2780}-\\u{2788}\\u{278a}-\\u{2792}\\u{10a40}-\\u{10a43}\\u{10e60}-\\u{10e68}' +
    '\\u{11052}-\\u{1105a}\\u{1f100}-\\u{1f10a}]$',
  'u',
);
const DECIMAL_DIGIT = /^\p{Nd}$/u;

function pyIsDigit(text: string): boolean {
  if (text === '') return false;
  return [...text].every((ch) => DECIMAL_DIGIT.test(ch) || NON_DECIMAL_DIGIT.test(ch));
}

// `int(text)` for a string `isdigit()` accepted: a non-decimal digit makes Python raise ValueError.
function pyInt(text: string): bigint {
  if (![...text].every((ch) => DECIMAL_DIGIT.test(ch))) {
    throw new PyCrash('ValueError', `invalid literal for int() with base 10: ${reprStr(text)}`);
  }
  return intOfDigits(text);
}

// `null` is Python's None: a reference that does not resolve, or resolves to JSON null.
function resolveRef(document: Obj, ref: string): PyValue {
  if (!ref.startsWith('#/')) return null;
  let current: PyValue = document;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current instanceof Map && current.has(part)) {
      current = get(current, part);
      continue;
    }
    if (Array.isArray(current) && pyIsDigit(part) && pyInt(part) < BigInt(current.length)) {
      current = current[Number(pyInt(part))] ?? null;
      continue;
    }
    return null;
  }
  return current;
}

// Follow a chain of `$ref` hops. Returns [target, error_kind].
function followRefs(value: PyValue, document: Obj): [PyValue, string | null] {
  const seen = new Set<string>();
  let current: PyValue = value;
  while (current instanceof Map && typeof current.get('$ref') === 'string') {
    const ref = current.get('$ref') as string;
    if (seen.has(ref)) return [null, 'circular $ref'];
    seen.add(ref);
    if (!ref.startsWith('#/')) return [null, `external $ref is not allowed: ${ref}`];
    const resolved = resolveRef(document, ref);
    if (resolved === null) return [null, `unresolved $ref: ${ref}`];
    current = resolved;
  }
  return [current, null];
}

function resolvedMapping(
  value: PyValue,
  document: Obj,
  pointer: string,
  issues: Issue[],
): Obj | null {
  if (!(value instanceof Map)) {
    issues.push({ pointer, message: 'must be an object' });
    return null;
  }
  if (typeof value.get('$ref') !== 'string') return value;
  const [resolved, error] = followRefs(value, document);
  if (error !== null) {
    issues.push({ pointer: pointerOf(pointer, '$ref'), message: error });
    return null;
  }
  if (!(resolved instanceof Map)) {
    issues.push({ pointer: pointerOf(pointer, '$ref'), message: '$ref must resolve to an object' });
    return null;
  }
  return resolved;
}

function requireText(mapping: Obj, key: string, pointer: string, issues: Issue[]): string | null {
  const value = get(mapping, key);
  if (typeof value !== 'string' || strip(value) === '') {
    issues.push({ pointer: pointerOf(pointer, key), message: 'must be a non-empty string' });
    return null;
  }
  return strip(value);
}

function validateProvenance(info: Obj, issues: Issue[]): void {
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
  if (!inSet(get(stamp, 'method'), PROVENANCE_METHODS)) {
    issues.push({
      pointer: pointerOf(pointer, 'method'),
      message: "x-loadcraft-source method must be 'native-export' or 'static-trace'",
    });
  }
  if (stamp.has('dependencies')) {
    const dependencies = get(stamp, 'dependencies');
    const dependenciesPointer = pointerOf(pointer, 'dependencies');
    if (!(dependencies instanceof Map)) {
      issues.push({
        pointer: dependenciesPointer,
        message:
          'x-loadcraft-source dependencies must be an object mapping package name to version',
      });
    } else {
      for (const [name, version] of dependencies) {
        if (strip(name) === '' || typeof version !== 'string' || strip(version) === '') {
          issues.push({
            pointer: pointerOf(dependenciesPointer, name),
            message:
              'x-loadcraft-source dependencies entries need a package name and a non-empty version string',
          });
        }
      }
    }
  }
  const allowed = new Set(['commit', 'dirty', 'method', 'dependencies']);
  const unknown = [...stamp.keys()].filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    issues.push({
      pointer,
      message: `x-loadcraft-source has unsupported keys: ${unknown.sort(compareStr).join(', ')}`,
    });
  }
}

function isSecurityRequirementEntry(pointer: string, child: PyValue): boolean {
  return Array.isArray(child) && SECURITY_REQUIREMENT_POINTER.test(pointer);
}

function isResponseExamplePlaceholder(pointer: string, child: PyValue): boolean {
  return (
    typeof child === 'string' &&
    PLACEHOLDER_PATTERN.test(child) &&
    RESPONSE_EXAMPLE_POINTER.test(pointer)
  );
}

function validateGlobalMarkers(document: Obj, issues: Issue[]): void {
  for (const [pointer, value] of walk(document)) {
    // An OAuth2 scope name is defined by the identity provider and cannot be renamed or moved into
    // prose, so the secret heuristic must not fire on it.
    const inScopes = pointer.endsWith('/scopes');
    if (value instanceof Map) {
      for (const [key, child] of value) {
        if (UNRESOLVED_KEYS.has(key.toLowerCase())) {
          issues.push({
            pointer: pointerOf(pointer === '/' ? '' : pointer, key),
            message: 'unresolved marker is not allowed in a deliverable',
          });
        }
        if (
          !inScopes &&
          isSensitiveProperty(key) &&
          !(child instanceof Map) &&
          !isSecurityRequirementEntry(pointer, child) &&
          !isResponseExamplePlaceholder(pointer, child)
        ) {
          issues.push({
            pointer: pointerOf(pointer === '/' ? '' : pointer, key),
            message: 'secret-bearing field must not embed a literal value',
          });
        }
      }
    }
    if (typeof value !== 'string') continue;
    if (TODO_MARKER.test(value) || TBD_MARKER.test(value)) {
      issues.push({ pointer, message: 'unresolved marker is not allowed in a deliverable' });
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      issues.push({
        pointer,
        message: 'secret-like value must not be embedded in the specification',
      });
    }
  }
}

function validateRefs(document: Obj, issues: Issue[]): void {
  for (const [pointer, value] of walk(document)) {
    if (!(value instanceof Map) || !value.has('$ref')) continue;
    const ref = get(value, '$ref');
    const refPointer = pointerOf(pointer === '/' ? '' : pointer, '$ref');
    if (typeof ref !== 'string' || ref === '') {
      issues.push({ pointer: refPointer, message: '$ref must be a non-empty string' });
    } else if (!ref.startsWith('#/')) {
      issues.push({ pointer: refPointer, message: `external $ref is not allowed: ${ref}` });
    } else if (resolveRef(document, ref) === null) {
      issues.push({ pointer: refPointer, message: `unresolved $ref: ${ref}` });
    }
  }
}

// Reject an enum that is only reachable through a `$ref`.
//
// LoadCraft's canonical property model does not follow a `$ref` for a leaf schema, so an enum parked
// in `components.schemas` and referenced from a property, an array item, an `additionalProperties`
// schema, an `allOf` member or a parameter disappears on import: the consumer sees an untyped string
// and neither a flow nor a feeder learns the allowed values. Inline the enum at every use site.
//
// Object schemas may still be referenced, and so may the schema of a whole request or response body,
// because those positions are projected as objects and their references are followed. Only leaf enums
// must be inlined.
//
// This checks enums only. Other leaf constraints behind a reference (`pattern`, length and numeric
// bounds) are equally lost, but they are guidance in the compatibility profile rather than a gate,
// because they cannot be told apart from a legitimately shared value object.
function enumBehindRef(
  value: PyValue,
  document: Obj,
  pointer: string,
  issues: Issue[],
  depth = 0,
): void {
  if (depth > 8 || !(value instanceof Map) || !value.has('$ref')) return;
  const [target, error] = followRefs(value, document);
  if (error !== null || !(target instanceof Map)) return; // shape errors are reported elsewhere
  if (target.get('type') === 'object' || target.has('properties')) return;
  if (target.has('enum')) {
    issues.push({
      pointer: pointerOf(pointer, '$ref'),
      message:
        'enum-bearing schema must be inlined here; a $ref to a leaf schema loses its enum on import',
    });
    return;
  }
  const allOf = get(target, 'allOf');
  if (Array.isArray(allOf)) {
    for (const member of allOf) enumBehindRef(member, document, pointer, issues, depth + 1);
  }
  const items = get(target, 'items');
  if (items instanceof Map) {
    if (items.has('enum')) {
      issues.push({
        pointer: pointerOf(pointer, '$ref'),
        message:
          'referenced array schema hides an enum in its items; inline the array and its enum here',
      });
    } else {
      enumBehindRef(items, document, pointer, issues, depth + 1);
    }
  }
}

// Validate one Schema Object and its schema-bearing children.
function validateSchemaObject(
  value: PyValue,
  pointer: string,
  issues: Issue[],
  document: Obj,
): void {
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
      enumBehindRef(
        propertySchema,
        document,
        pointerOf(pointerOf(pointer, 'properties'), propertyName),
        issues,
      );
      validateSchemaObject(
        propertySchema,
        pointerOf(pointerOf(pointer, 'properties'), propertyName),
        issues,
        document,
      );
    }
  }

  if (value.has('items')) {
    const items = get(value, 'items');
    enumBehindRef(items, document, pointerOf(pointer, 'items'), issues);
    validateSchemaObject(items, pointerOf(pointer, 'items'), issues, document);
  }

  const additionalProperties = get(value, 'additionalProperties');
  if (additionalProperties instanceof Map) {
    enumBehindRef(
      additionalProperties,
      document,
      pointerOf(pointer, 'additionalProperties'),
      issues,
    );
    validateSchemaObject(
      additionalProperties,
      pointerOf(pointer, 'additionalProperties'),
      issues,
      document,
    );
  }

  const allOf = get(value, 'allOf');
  if (Array.isArray(allOf)) {
    for (const [index, member] of allOf.entries()) {
      enumBehindRef(
        member,
        document,
        pointerOf(pointerOf(pointer, 'allOf'), String(index)),
        issues,
      );
      validateSchemaObject(
        member,
        pointerOf(pointerOf(pointer, 'allOf'), String(index)),
        issues,
        document,
      );
    }
  }
}

// Reject schema constructs that LoadCraft currently parses lossily.
function validateSchemaSubset(document: Obj, issues: Issue[]): void {
  const roots = new Map<string, PyValue>();
  const components = get(document, 'components');
  if (components instanceof Map) {
    const schemas = get(components, 'schemas');
    if (schemas instanceof Map) {
      for (const [name, schema] of schemas)
        roots.set(pointerOf('/components/schemas', name), schema);
    }
  }

  for (const [rawPointer, value] of walk(document)) {
    if (!(value instanceof Map) || !value.has('schema')) continue;
    const pointer = rawPointer === '/' ? '' : rawPointer;
    if (pointer.split('/').some((segment) => segment === 'example' || segment === 'examples'))
      continue;
    const schemaPointer = pointerOf(pointer, 'schema');
    if (!roots.has(schemaPointer)) roots.set(schemaPointer, get(value, 'schema'));
  }

  const ordered = [...roots.entries()].sort((a, b) => compareStr(a[0], b[0]));
  for (const [pointer, schema] of ordered) validateSchemaObject(schema, pointer, issues, document);
}

type Parameter = { location: string; name: string; parameter: Obj };
type Parameters = Map<string, Parameter>;

function parameterKey(location: string, name: string): string {
  return `${location}\u0000${name}`;
}

function collectParameters(
  pathParameters: PyValue,
  operationParameters: PyValue,
  document: Obj,
  pointer: string,
  issues: Issue[],
): Parameters {
  const collected: Parameters = new Map();
  for (const [label, rawParameters] of [
    ['path', pathParameters],
    ['operation', operationParameters],
  ] as const) {
    if (rawParameters === null) continue;
    if (!Array.isArray(rawParameters)) {
      issues.push({
        pointer: pointerOf(pointer, 'parameters'),
        message: 'parameters must be an array',
      });
      continue;
    }
    for (const [index, rawParameter] of rawParameters.entries()) {
      let parameterPointer = pointerOf(pointerOf(pointer, 'parameters'), `${label}-${index}`);
      const parameter = resolvedMapping(rawParameter, document, parameterPointer, issues);
      if (parameter === null) continue;
      const name = get(parameter, 'name');
      const location = get(parameter, 'in');
      if (typeof name !== 'string' || name === '') {
        issues.push({
          pointer: pointerOf(parameterPointer, 'name'),
          message: 'must be a non-empty string',
        });
        continue;
      }
      if (!inSet(location, PARAMETER_LOCATIONS)) {
        issues.push({
          pointer: pointerOf(parameterPointer, 'in'),
          message: 'must be path, query, header, or cookie',
        });
        continue;
      }
      // Once name and location are known, address the parameter by them, so an error and a warning
      // about the same parameter share one pointer.
      parameterPointer = pointerOf(
        pointerOf(pointer, 'parameters'),
        `${location as string}-${name}`,
      );
      const parameterSchema = get(parameter, 'schema');
      if (!(parameterSchema instanceof Map)) {
        issues.push({
          pointer: pointerOf(parameterPointer, 'schema'),
          message: 'parameter schema is required',
        });
      } else {
        enumBehindRef(parameterSchema, document, pointerOf(parameterPointer, 'schema'), issues);
        const schema = resolvedMapping(
          parameterSchema,
          document,
          pointerOf(parameterPointer, 'schema'),
          issues,
        );
        if (schema !== null) {
          if (typeof get(schema, 'type') !== 'string') {
            issues.push({
              pointer: pointerOf(pointerOf(parameterPointer, 'schema'), 'type'),
              message: 'parameter schema type must be a single string',
            });
          }
          const enumValues = get(schema, 'enum');
          if (Array.isArray(enumValues) && enumValues.some((item) => typeof item !== 'string')) {
            issues.push({
              pointer: pointerOf(pointerOf(parameterPointer, 'schema'), 'enum'),
              message: 'parameter enum values must all be strings for LoadCraft',
            });
          }
        }
      }
      const copy: Obj = new Map(parameter);
      copy.set('x-validator-pointer', parameterPointer);
      collected.set(parameterKey(location as string, name), {
        location: location as string,
        name,
        parameter: copy,
      });
    }
  }
  return collected;
}

// Warn about a parameter a generated caller cannot produce a value for.
//
// Exempt, because for these an example is either meaningless or forbidden:
//
// - an OPTIONS preflight, answered at the edge without reading any value;
// - a parameter whose name trips the secret heuristic, where the compatibility profile forbids a
//   literal;
// - a header that carries a declared security scheme, supplied by the harness rather than by the
//   artifact.
//
// Anything else must offer an `example`, an `enum` or a `default`. The profile wants it on the
// parameter's `schema`; a parameter-level `example` is accepted because OpenAPI 3.0 permits it, and
// both are retained per parameter.
function warnUnusableParameters(
  method: string,
  parameters: Parameters,
  document: Obj,
  securitySchemeHeaders: Set<string>,
  pointer: string,
  warnings: Warning[],
): void {
  if (method === 'options') return;
  const ordered = [...parameters.values()].sort(
    (a, b) => compareStr(a.location, b.location) || compareStr(a.name, b.name),
  );
  for (const { location, name, parameter } of ordered) {
    if (isSensitiveProperty(name)) continue;
    if (location === 'header' && securitySchemeHeaders.has(casefold(name))) continue;
    if (parameter.has('example')) continue;
    const validatorPointer = get(parameter, 'x-validator-pointer');
    const where =
      typeof validatorPointer === 'string' && validatorPointer !== '' ? validatorPointer : pointer;
    if (parameter.has('examples')) {
      warnings.push({
        pointer: pointerOf(where, 'examples'),
        message:
          'a named examples map on a parameter is dropped on import; move the load-relevant value ' +
          'into the single example and name the rest in the description',
      });
    }
    let schema: PyValue = get(parameter, 'schema');
    if (schema instanceof Map && schema.has('$ref')) {
      const [resolved] = followRefs(schema, document);
      schema = resolved instanceof Map ? resolved : new Map();
    }
    if (!(schema instanceof Map)) continue;
    if (['example', 'enum', 'default'].some((key) => schema.has(key))) continue;
    warnings.push({
      pointer: where,
      message:
        'parameter has no example, enum or default, so a generated caller has no value to send; ' +
        'put a synthetic example on its schema',
    });
  }
}

function validateSecurity(
  operation: Obj,
  securitySchemes: Obj,
  pointer: string,
  issues: Issue[],
): void {
  if (!operation.has('security')) {
    issues.push({
      pointer: pointerOf(pointer, 'security'),
      message: 'operation-level security is required; use [] explicitly for a public operation',
    });
    return;
  }
  const security = get(operation, 'security');
  if (!Array.isArray(security)) {
    issues.push({ pointer: pointerOf(pointer, 'security'), message: 'must be an array' });
    return;
  }
  for (const [index, requirement] of security.entries()) {
    const requirementPointer = pointerOf(pointerOf(pointer, 'security'), String(index));
    if (!(requirement instanceof Map)) {
      issues.push({
        pointer: requirementPointer,
        message: 'security requirement must be an object',
      });
      continue;
    }
    for (const schemeName of requirement.keys()) {
      if (!securitySchemes.has(schemeName)) {
        issues.push({
          pointer: pointerOf(requirementPointer, schemeName),
          message: 'references an undefined security scheme',
        });
      }
    }
  }
}

function validateSecuritySchemes(securitySchemes: Obj, document: Obj, issues: Issue[]): void {
  for (const [name, rawScheme] of securitySchemes) {
    const pointer = pointerOf('/components/securitySchemes', name);
    const scheme = resolvedMapping(rawScheme, document, pointer, issues);
    if (scheme === null) continue;
    const schemeType = get(scheme, 'type');
    if (!inSet(schemeType, SECURITY_SCHEME_TYPES)) {
      issues.push({
        pointer: pointerOf(pointer, 'type'),
        message: 'security scheme type must be apiKey, http, oauth2, or openIdConnect',
      });
      continue;
    }
    if (schemeType === 'http') {
      requireText(scheme, 'scheme', pointer, issues);
    } else if (schemeType === 'apiKey') {
      requireText(scheme, 'name', pointer, issues);
      if (get(scheme, 'in') !== 'header') {
        issues.push({
          pointer: pointerOf(pointer, 'in'),
          message: 'LoadCraft-compatible apiKey security must use a header',
        });
      }
    } else if (schemeType === 'oauth2' && !(get(scheme, 'flows') instanceof Map)) {
      issues.push({ pointer: pointerOf(pointer, 'flows'), message: 'oauth2 flows are required' });
    } else if (schemeType === 'openIdConnect') {
      requireText(scheme, 'openIdConnectUrl', pointer, issues);
    }
  }
}

function validateRequestBody(
  rawBody: PyValue,
  document: Obj,
  pointer: string,
  issues: Issue[],
): void {
  const body = resolvedMapping(rawBody, document, pointer, issues);
  if (body === null) return;
  if (typeof get(body, 'required') !== 'boolean') {
    issues.push({
      pointer: pointerOf(pointer, 'required'),
      message: 'requestBody.required must be an explicit boolean',
    });
  }
  const content = get(body, 'content');
  if (!(content instanceof Map) || content.size === 0) {
    issues.push({
      pointer: pointerOf(pointer, 'content'),
      message: 'requestBody content must be a non-empty object',
    });
    return;
  }
  if (content.size !== 1) {
    issues.push({
      pointer: pointerOf(pointer, 'content'),
      message:
        'must declare exactly one request media type because LoadCraft consumes the first one',
    });
  }
  for (const [mediaType, rawMedia] of content) {
    const mediaPointer = pointerOf(pointerOf(pointer, 'content'), mediaType);
    if (!REQUEST_MEDIA_TYPE.test(mediaType) || (mediaType.split(';')[0] as string).includes('*')) {
      issues.push({
        pointer: mediaPointer,
        message:
          `unsupported request media type for LoadCraft: ${mediaType} ` +
          '(declare one concrete type/subtype; wildcards cannot be sent)',
      });
    }
    const media = resolvedMapping(rawMedia, document, mediaPointer, issues);
    if (media !== null && !(get(media, 'schema') instanceof Map)) {
      issues.push({
        pointer: pointerOf(mediaPointer, 'schema'),
        message: 'request schema is required',
      });
    }
  }
}

function validateResponses(
  rawResponses: PyValue,
  document: Obj,
  pointer: string,
  issues: Issue[],
  warnings: Warning[],
): void {
  if (!(rawResponses instanceof Map) || rawResponses.size === 0) {
    issues.push({ pointer, message: 'responses must be a non-empty object' });
    return;
  }
  const successCodes: number[] = [];
  for (const [status, rawResponse] of rawResponses) {
    const responsePointer = pointerOf(pointer, status);
    if (!STATUS_PATTERN.test(status)) {
      issues.push({
        pointer: responsePointer,
        message:
          'response status must be an explicit three-digit code; default/ranges are lossy in LoadCraft',
      });
      continue;
    }
    const statusCode = Number(status);
    if (statusCode >= 200 && statusCode < 300) successCodes.push(statusCode);
    const response = resolvedMapping(rawResponse, document, responsePointer, issues);
    if (response === null) continue;
    requireText(response, 'description', responsePointer, issues);
    const content = get(response, 'content');
    if (content === null) {
      if (statusCode >= 200 && statusCode < 300 && !NO_CONTENT_SUCCESS_STATUSES.has(statusCode)) {
        issues.push({
          pointer: pointerOf(responsePointer, 'content'),
          message: 'successful response content is required except for 202/204/205',
        });
      }
      continue;
    }
    if (!(content instanceof Map) || content.size === 0) {
      issues.push({
        pointer: pointerOf(responsePointer, 'content'),
        message: 'must be a non-empty object',
      });
      continue;
    }
    for (const [mediaType, rawMedia] of content) {
      const mediaPointer = pointerOf(pointerOf(responsePointer, 'content'), mediaType);
      const media = resolvedMapping(rawMedia, document, mediaPointer, issues);
      if (media === null) continue;
      if (!(get(media, 'schema') instanceof Map)) {
        issues.push({
          pointer: pointerOf(mediaPointer, 'schema'),
          message: 'response schema is required',
        });
      }
      const mediaSchema = get(media, 'schema');
      const binarySchema = mediaSchema instanceof Map && get(mediaSchema, 'format') === 'binary';
      if (
        !media.has('example') &&
        !EXAMPLE_EXEMPT_CONTENT_TYPES.has(mediaType) &&
        !mediaType.startsWith('image/') &&
        !binarySchema
      ) {
        warnings.push({
          pointer: mediaPointer,
          message:
            'body-bearing response has no example; LoadCraft retains one example per status and ' +
            'generates weaker assertions without it',
        });
      }
      if (media.has('examples')) {
        warnings.push({
          pointer: pointerOf(mediaPointer, 'examples'),
          message:
            'a named examples map on a response is dropped on import; express the branch through its ' +
            'own status code and a single example',
        });
      }
    }
  }
  if (successCodes.length === 0) {
    const redirects = [...rawResponses.keys()]
      .filter((status) => ANY_STATUS_PATTERN.test(status) && REDIRECT_STATUSES.has(Number(status)))
      .map((status) => Number(status))
      .sort((a, b) => a - b);
    if (redirects.length > 0) {
      warnings.push({
        pointer,
        message:
          `redirect-only operation (${redirects.join(', ')}); the generated client follows the redirect ` +
          'and asserts the final response, so name the target operation in the description',
      });
    } else {
      issues.push({
        pointer,
        message: 'at least one explicit 2xx (or 3xx redirect) response is required',
      });
    }
  }
}

// An example is checked against the schema of its own place. The data generator reads examples as
// value patterns, so one that breaks its declared type, enum, bounds, length, strict format or
// pattern spreads into every row. Only what is decidable without guessing is checked: a schema
// with oneOf/anyOf/not, without a single type, a null value, a key covered only by
// additionalProperties, an unknown format, a pattern written for another regex dialect and a
// placeholder or template value are all left alone, because a warning that must be ignored teaches
// the reader to ignore warnings.
type ExampleContext = 'request' | 'response' | 'parameter' | 'schema';

const EXAMPLE_MISMATCH = 'example does not match its schema';
const READ_ONLY_MESSAGE =
  'request example sets a readOnly property: the server fills it and a client does not send it';
const WRITE_ONLY_MESSAGE =
  'response example shows a writeOnly property: the server accepts it but never returns it';
const TEMPLATE_VALUE = /\{\{[^]*\}\}|\$\{[^]*\}/;
// Constructs that mean something else, or nothing, in an ECMAScript pattern without flags: inline
// flags, Python named groups, atomic groups, comments, anchors and escapes of other engines, POSIX
// classes, possessive quantifiers and Unicode property or code point escapes.
const FOREIGN_PATTERN_SYNTAX =
  /\(\?[a-zA-Z]+[)\-:]|\(\?P|\(\?>|\(\?#|\\[AZzGhHRXKQE]|\[\[:|[*+?}]\+|\\[pP]\{|\\[ux]\{/;
const CLASS_ESCAPES = /\\[dDwWsSbB]/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const INTEGER_TEXT = /^-?[0-9]+$/;
const NUMBER_TEXT = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function validDate(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] as number;
  return d <= days;
}

function matchesFormat(format: string, value: string): boolean {
  if (format === 'date') {
    const found = DATE.exec(value);
    return found !== null && validDate(found[1] as string, found[2] as string, found[3] as string);
  }
  if (format === 'date-time') {
    const found = DATE_TIME.exec(value);
    if (found === null) return false;
    const hour = Number(found[4]);
    const minute = Number(found[5]);
    const second = Number(found[6]);
    const offsetHour = found[7] === undefined ? 0 : Number(found[7]);
    const offsetMinute = found[8] === undefined ? 0 : Number(found[8]);
    return (
      validDate(found[1] as string, found[2] as string, found[3] as string) &&
      hour < 24 &&
      minute < 60 &&
      second <= 60 &&
      offsetHour < 24 &&
      offsetMinute < 60
    );
  }
  if (format === 'uuid') return UUID.test(value);
  if (format === 'email') return EMAIL.test(value);
  return true;
}

// The ECMAScript form of a schema pattern, or null when it may mean something else in the
// language that wrote it (then the example is not judged by it).
function plainPattern(pattern: string, value: string): RegExp | null {
  if (FOREIGN_PATTERN_SYNTAX.test(pattern)) return null;
  // `\d`, `\w`, `\s` and `\b` are ASCII-only here and Unicode-aware in several other engines, and
  // `.` and `$` treat line breaks differently between engines.
  if (/[^\x20-\x7e]/.test(value) && CLASS_ESCAPES.test(pattern)) return null;
  if (/[\r\n]/.test(value)) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function jsonType(value: PyValue): string {
  if (typeof value === 'bigint') return 'integer';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : 'object';
}

function hasType(type: string, value: PyValue): boolean {
  const actual = jsonType(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

function asNumber(value: PyValue): number | null {
  if (typeof value === 'bigint') return Number(value);
  return typeof value === 'number' ? value : null;
}

function sameScalar(a: PyValue, b: PyValue): boolean {
  const left = asNumber(a);
  const right = asNumber(b);
  if (left !== null && right !== null) return left === right;
  return a === b;
}

function shortRepr(value: PyValue): string {
  return typeof value === 'string' ? reprStr(value) : dumps(value);
}

// A parameter travels as text, so the text form of a scalar is the same value: `"20"` for an
// integer, `"true"` for a boolean. Returns the value to judge, or undefined to leave it alone.
function parameterValue(type: string, value: PyValue): PyValue | undefined {
  if (typeof value !== 'string') return value;
  if (type === 'array' || type === 'object') return undefined;
  if (type === 'integer' && INTEGER_TEXT.test(value)) return BigInt(value);
  if (type === 'number' && NUMBER_TEXT.test(value)) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  return value;
}

// A schema and its `allOf` members, every `$ref` followed; null when any part is undecidable.
function schemaParts(node: PyValue, document: Obj, chain: ReadonlySet<string>): Obj[] | null {
  const ref = node instanceof Map ? node.get('$ref') : undefined;
  if (typeof ref === 'string' && chain.has(ref)) return null;
  const [schema, error] = followRefs(node, document);
  if (error !== null || !(schema instanceof Map)) return null;
  if (['oneOf', 'anyOf', 'not'].some((key) => schema.has(key))) return null;
  const parts: Obj[] = [schema];
  const members = get(schema, 'allOf');
  if (members !== null) {
    if (!Array.isArray(members)) return null;
    const next = new Set(chain);
    if (typeof ref === 'string') next.add(ref);
    for (const member of members) {
      const memberParts = schemaParts(member, document, next);
      if (memberParts === null) return null;
      parts.push(...memberParts);
    }
  }
  return parts;
}

function checkExampleValue(
  value: PyValue,
  node: PyValue,
  pointer: string,
  context: ExampleContext,
  document: Obj,
  warnings: Warning[],
): void {
  if (value === null) return;
  if (typeof value === 'string' && (PLACEHOLDER_PATTERN.test(value) || TEMPLATE_VALUE.test(value)))
    return;
  const parts = schemaParts(node, document, new Set());
  if (parts === null) return;
  const types = new Set(parts.map((part) => get(part, 'type')).filter((type) => type !== null));
  if (types.size !== 1) return;
  const type = [...types][0];
  if (typeof type !== 'string') return;
  const judged = context === 'parameter' ? parameterValue(type, value) : value;
  if (judged === undefined) return;
  const mismatch = (detail: string): void => {
    warnings.push({ pointer, message: `${EXAMPLE_MISMATCH}: ${detail}` });
  };
  if (!hasType(type, judged)) {
    mismatch(`expected ${type}, got ${jsonType(judged)}`);
    return;
  }
  for (const part of parts) {
    const enumValues = get(part, 'enum');
    if (
      Array.isArray(enumValues) &&
      enumValues.every((item) => !(item instanceof Map) && !Array.isArray(item)) &&
      !(judged instanceof Map) &&
      !Array.isArray(judged) &&
      !enumValues.some((item) => sameScalar(item, judged))
    ) {
      mismatch(`${shortRepr(judged)} is not one of the enum values`);
    }
    const number = asNumber(judged);
    if (number !== null) {
      const minimum = asNumber(get(part, 'minimum'));
      const maximum = asNumber(get(part, 'maximum'));
      const exclusiveMinimum = get(part, 'exclusiveMinimum') === true;
      const exclusiveMaximum = get(part, 'exclusiveMaximum') === true;
      const shown = shortRepr(judged);
      if (minimum !== null && number < minimum)
        mismatch(`${shown} is below the minimum ${shortRepr(get(part, 'minimum'))}`);
      else if (minimum !== null && exclusiveMinimum && number === minimum)
        mismatch(`${shown} is not above the exclusive minimum ${shortRepr(get(part, 'minimum'))}`);
      if (maximum !== null && number > maximum)
        mismatch(`${shown} is above the maximum ${shortRepr(get(part, 'maximum'))}`);
      else if (maximum !== null && exclusiveMaximum && number === maximum)
        mismatch(`${shown} is not below the exclusive maximum ${shortRepr(get(part, 'maximum'))}`);
    }
    if (typeof judged === 'string') {
      const length = [...judged].length;
      const minLength = asNumber(get(part, 'minLength'));
      const maxLength = asNumber(get(part, 'maxLength'));
      if (minLength !== null && length < minLength) mismatch(`shorter than minLength ${minLength}`);
      if (maxLength !== null && length > maxLength) mismatch(`longer than maxLength ${maxLength}`);
      const format = get(part, 'format');
      if (typeof format === 'string' && !matchesFormat(format, judged))
        mismatch(`${shortRepr(judged)} is not a valid ${format}`);
      const pattern = get(part, 'pattern');
      const compiled: RegExp | null =
        typeof pattern === 'string' ? plainPattern(pattern, judged) : null;
      if (compiled !== null && !compiled.test(judged))
        mismatch(`${shortRepr(judged)} does not match the pattern ${reprStr(pattern as string)}`);
    }
    if (Array.isArray(judged) && part.has('items')) {
      for (const [index, element] of judged.entries()) {
        const inner = context === 'parameter' ? 'schema' : context;
        checkExampleValue(
          element,
          get(part, 'items'),
          pointerOf(pointer, String(index)),
          inner,
          document,
          warnings,
        );
      }
    }
  }
  if (judged instanceof Map)
    checkExampleObject(judged, parts, pointer, context, document, warnings);
}

function checkExampleObject(
  value: Obj,
  parts: Obj[],
  pointer: string,
  context: ExampleContext,
  document: Obj,
  warnings: Warning[],
): void {
  const properties = new Map<string, PyValue[]>();
  const required = new Set<string>();
  for (const part of parts) {
    const own = get(part, 'properties');
    if (own instanceof Map) {
      for (const [name, schema] of own)
        properties.set(name, [...(properties.get(name) ?? []), schema]);
    }
    const names = get(part, 'required');
    if (Array.isArray(names)) {
      for (const name of names) if (typeof name === 'string') required.add(name);
    }
  }
  const flag = (schemas: PyValue[], key: string): boolean =>
    schemas.some((schema) => {
      const [target] = followRefs(schema, document);
      return target instanceof Map && get(target, key) === true;
    });
  for (const [key, child] of value) {
    const schemas = properties.get(key);
    if (schemas === undefined) continue;
    const keyPointer = pointerOf(pointer, key);
    if (context === 'request' && flag(schemas, 'readOnly')) {
      warnings.push({ pointer: keyPointer, message: READ_ONLY_MESSAGE });
      continue;
    }
    if (context === 'response' && flag(schemas, 'writeOnly')) {
      warnings.push({ pointer: keyPointer, message: WRITE_ONLY_MESSAGE });
      continue;
    }
    for (const schema of schemas) {
      checkExampleValue(child, schema, keyPointer, context, document, warnings);
    }
  }
  if (context !== 'request') return;
  // A secret cannot appear in an example at all, and a readOnly property is required only in
  // responses, so neither is asked for in a request example.
  for (const name of required) {
    if (value.has(name) || isSensitiveProperty(name)) continue;
    const schemas = properties.get(name) ?? [];
    if (flag(schemas, 'readOnly')) continue;
    warnings.push({
      pointer,
      message: `${EXAMPLE_MISMATCH}: request example misses required property ${reprStr(name)}`,
    });
  }
}

// The examples written into schemas (on a property, an item, a whole object), each against the
// schema that carries it. Referenced schemas are reached as roots of their own, not through `$ref`.
function checkSchemaExamples(
  node: PyValue,
  pointer: string,
  context: ExampleContext,
  document: Obj,
  warnings: Warning[],
): void {
  if (!(node instanceof Map) || node.has('$ref')) return;
  if (node.has('example')) {
    checkExampleValue(
      get(node, 'example'),
      node,
      pointerOf(pointer, 'example'),
      context,
      document,
      warnings,
    );
  }
  const properties = get(node, 'properties');
  if (properties instanceof Map) {
    for (const [name, child] of properties) {
      const childPointer = pointerOf(pointerOf(pointer, 'properties'), name);
      checkSchemaExamples(child, childPointer, 'schema', document, warnings);
    }
  }
  for (const key of ['items', 'additionalProperties']) {
    checkSchemaExamples(get(node, key), pointerOf(pointer, key), 'schema', document, warnings);
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const members = get(node, key);
    if (!Array.isArray(members)) continue;
    for (const [index, member] of members.entries()) {
      const memberPointer = pointerOf(pointerOf(pointer, key), String(index));
      checkSchemaExamples(member, memberPointer, 'schema', document, warnings);
    }
  }
}

// Every schema of the document outside parameters (those are checked per operation, under the
// pointer of the parameter) and outside examples.
function warnSchemaExamples(document: Obj, warnings: Warning[]): void {
  const roots = new Map<string, PyValue>();
  const components = get(document, 'components');
  const schemas = components instanceof Map ? get(components, 'schemas') : null;
  if (schemas instanceof Map) {
    for (const [name, schema] of schemas) roots.set(pointerOf('/components/schemas', name), schema);
  }
  for (const [rawPointer, value] of walk(document)) {
    if (!(value instanceof Map) || !value.has('schema')) continue;
    const pointer = rawPointer === '/' ? '' : rawPointer;
    const segments = pointer.split('/');
    if (segments.some((part) => ['example', 'examples', 'parameters'].includes(part))) continue;
    roots.set(pointerOf(pointer, 'schema'), get(value, 'schema'));
  }
  const ordered = [...roots.entries()].sort((a, b) => compareStr(a[0], b[0]));
  for (const [pointer, schema] of ordered) {
    checkSchemaExamples(schema, pointer, 'schema', document, warnings);
  }
}

// The single example of one parameter or media type. Named examples are not checked: each shows one
// behaviour branch, and the branch of a validation error is exemplified by an input that breaks the
// schema on purpose.
function checkPlacedExample(
  holder: Obj,
  schema: PyValue,
  pointer: string,
  context: ExampleContext,
  document: Obj,
  warnings: Warning[],
): void {
  if (!holder.has('example')) return;
  const examplePointer = pointerOf(pointer, 'example');
  checkExampleValue(get(holder, 'example'), schema, examplePointer, context, document, warnings);
}

function warnParameterExamples(parameters: Parameters, document: Obj, warnings: Warning[]): void {
  for (const { parameter } of parameters.values()) {
    const where = get(parameter, 'x-validator-pointer');
    if (typeof where !== 'string') continue;
    const schema = get(parameter, 'schema');
    checkPlacedExample(parameter, schema, where, 'parameter', document, warnings);
    checkSchemaExamples(schema, pointerOf(where, 'schema'), 'parameter', document, warnings);
  }
}

function warnMediaExamples(
  rawContent: PyValue,
  pointer: string,
  context: ExampleContext,
  document: Obj,
  warnings: Warning[],
): void {
  if (!(rawContent instanceof Map)) return;
  for (const [mediaType, rawMedia] of rawContent) {
    const [media] = followRefs(rawMedia, document);
    if (!(media instanceof Map)) continue;
    const mediaPointer = pointerOf(pointerOf(pointer, 'content'), mediaType);
    checkPlacedExample(media, get(media, 'schema'), mediaPointer, context, document, warnings);
  }
}

function warnOperationExamples(
  operation: Obj,
  pointer: string,
  document: Obj,
  warnings: Warning[],
): void {
  const [body] = followRefs(get(operation, 'requestBody'), document);
  if (body instanceof Map) {
    const bodyPointer = pointerOf(pointer, 'requestBody');
    warnMediaExamples(get(body, 'content'), bodyPointer, 'request', document, warnings);
  }
  const responses = get(operation, 'responses');
  if (!(responses instanceof Map)) return;
  for (const [status, rawResponse] of responses) {
    const [response] = followRefs(rawResponse, document);
    if (!(response instanceof Map)) continue;
    const responsePointer = pointerOf(pointerOf(pointer, 'responses'), status);
    warnMediaExamples(get(response, 'content'), responsePointer, 'response', document, warnings);
  }
}

class Over extends Error {}

function asList(value: PyValue): PyValue[] {
  return Array.isArray(value) ? value : [];
}

// Characters of one operation the way the backend prompt counts it.
//
// Mirrors how the importer and the flow generator cost an operation: the compact JSON of the record,
// where every `$ref` in a parameter, request body or response schema is expanded in full at EVERY use
// (a cycle is cut only along the current path) and the success schema is carried a second time as the
// operation's response schema. Returns [characters, truncated]. When the expansion alone exceeds
// `abortAfter` the walk stops and `truncated` is true: the figure is then a lower bound.
function expandedOperationSize(
  document: Obj,
  pathItem: Obj,
  operation: Obj,
  path: string,
  method: string,
  abortAfter: bigint,
): [number, boolean] {
  let spent = 0;

  const resolve = (start: PyValue): PyValue => {
    let node = start;
    let hops = 0;
    while (node instanceof Map && typeof node.get('$ref') === 'string' && hops < 32) {
      const target = resolveRef(document, node.get('$ref') as string);
      if (target === null) return new Map();
      node = target;
      hops += 1;
    }
    return node;
  };

  // `level` is the number of `expand` frames Python would hold at this call, outermost first.
  const expand = (node: PyValue, visited: ReadonlySet<string>, level: number): PyValue => {
    pyDepth(level, 1);
    if (!(node instanceof Map)) return node;
    const reference = node.get('$ref');
    if (typeof reference === 'string') {
      if (visited.has(reference)) {
        return new Map<string, PyValue>([
          ['type', 'object'],
          ['description', `Circular ref: ${reference}`],
        ]);
      }
      pyDepth(level, 2);
      const target = resolveRef(document, reference);
      if (target === null) return new Map();
      return expand(target, new Set([...visited, reference]), level + 1);
    }
    const out: Obj = new Map();
    for (const [key, value] of node) {
      if (key === 'properties' && value instanceof Map) {
        const expanded: Obj = new Map();
        for (const [name, prop] of value) expanded.set(name, expand(prop, visited, level + 1));
        out.set(key, expanded);
      } else if ((key === 'items' || key === 'additionalProperties') && value instanceof Map) {
        out.set(key, expand(value, visited, level + 1));
      } else if ((key === 'allOf' || key === 'oneOf' || key === 'anyOf') && Array.isArray(value)) {
        out.set(
          key,
          value.map((item) => expand(item, visited, level + 1)),
        );
      } else {
        out.set(key, value);
      }
      spent += pyLen(key) + 4;
      if (!(value instanceof Map) && !Array.isArray(value)) {
        // `json.dumps(value)` is two frames deep for a string and three for any other scalar.
        pyDepth(level, typeof value === 'string' ? 2 : 3);
        spent += pyLen(dumps(value));
      }
    }
    if (BigInt(spent) > abortAfter) throw new Over();
    return out;
  };

  let record: Obj;
  try {
    const parameters: PyValue[] = [];
    for (const raw of [
      ...asList(get(pathItem, 'parameters')),
      ...asList(get(operation, 'parameters')),
    ]) {
      const parameter = resolve(raw);
      if (parameter instanceof Map) {
        const item: Obj = new Map(parameter);
        if (item.has('schema'))
          item.set('schema', expand(resolve(get(item, 'schema')), new Set(), 1));
        parameters.push(item);
      }
    }

    let requestBody: PyValue = null;
    if (operation.has('requestBody')) {
      const body = resolve(get(operation, 'requestBody'));
      const mediaMap = body instanceof Map ? get(body, 'content') : null;
      if (body instanceof Map && mediaMap instanceof Map) {
        for (const [contentType, rawMedia] of mediaMap) {
          const media = resolve(rawMedia);
          if (!(media instanceof Map)) continue;
          requestBody = new Map<string, PyValue>([
            ['content_type', contentType],
            [
              'schema_def',
              expand(resolve(media.has('schema') ? get(media, 'schema') : new Map()), new Set(), 1),
            ],
            ['required', body.has('required') ? get(body, 'required') : false],
            ['example', get(media, 'example')],
            ['examples', get(media, 'examples')],
            ['description', get(body, 'description')],
          ]);
          break;
        }
      }
    }

    const responses: { code: string; entry: Obj }[] = [];
    const rawResponses = get(operation, 'responses');
    for (const [code, rawResponse] of rawResponses instanceof Map
      ? rawResponses
      : new Map<string, PyValue>()) {
      const response = resolve(rawResponse);
      if (!(response instanceof Map)) continue;
      const content = get(response, 'content');
      const medias: [string, PyValue][] =
        content instanceof Map && content.size > 0
          ? [...content.entries()]
          : [['', new Map<string, PyValue>()]];
      for (const [contentType, rawMedia] of medias) {
        const resolvedMedia = resolve(rawMedia);
        const media: Obj =
          resolvedMedia instanceof Map ? resolvedMedia : new Map<string, PyValue>();
        responses.push({
          code,
          entry: new Map<string, PyValue>([
            ['status_code', code],
            ['content_type', contentType],
            [
              'schema_def',
              expand(resolve(media.has('schema') ? get(media, 'schema') : new Map()), new Set(), 1),
            ],
            ['example', get(media, 'example')],
            ['description', get(response, 'description')],
          ]),
        });
      }
    }

    let success: Obj | null = null;
    for (const code of ['200', '201', '202']) {
      const found = responses.find((candidate) => candidate.code === code);
      if (found !== undefined) {
        success = found.entry;
        break;
      }
    }
    record = new Map<string, PyValue>([
      ['response_schema', success !== null ? get(success, 'schema_def') : new Map()],
      ['method', method.toUpperCase()],
      ['path', path],
      ['operation_id', get(operation, 'operationId')],
      ['summary', get(operation, 'summary')],
      ['description', get(operation, 'description')],
      ['parameters', parameters],
      ['request_body', requestBody],
      ['responses', responses.map((candidate) => candidate.entry)],
    ]);
  } catch (error) {
    if (error instanceof Over) return [spent, true];
    throw error;
  }

  return [pyLen(dumps(record, { compact: true })) + 1, false];
}

function validateDocument(
  document: PyValue,
  budgetChars: bigint = EXPANDED_OPERATION_BUDGET_CHARS,
  sizes: SizeRow[] | null = null,
): { issues: Issue[]; warnings: Warning[]; operationCount: number } {
  const issues: Issue[] = [];
  const warnings: Warning[] = [];
  if (!(document instanceof Map)) {
    return {
      issues: [{ pointer: '/', message: 'document must be a JSON object' }],
      warnings,
      operationCount: 0,
    };
  }

  validateGlobalMarkers(document, issues);
  validateRefs(document, issues);
  validateSchemaSubset(document, issues);
  warnSchemaExamples(document, warnings);
  for (const found of checkOas3Structure(document)) {
    issues.push({ pointer: found.pointer, message: `not valid OpenAPI 3.0: ${found.message}` });
  }

  if (get(document, 'openapi') !== '3.0.3') {
    issues.push({
      pointer: '/openapi',
      message: 'must use the OpenAPI 3.0.3 compatibility profile for current LoadCraft',
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

  const servers = get(document, 'servers');
  if (!Array.isArray(servers) || servers.length === 0) {
    issues.push({ pointer: '/servers', message: 'must contain at least one server URL' });
  } else {
    const firstServer = servers[0] as PyValue;
    if (!(firstServer instanceof Map)) {
      issues.push({ pointer: '/servers/0', message: 'must be an object' });
    } else {
      requireText(firstServer, 'url', '/servers/0', issues);
    }
  }

  const components = get(document, 'components');
  const componentsMapping: Obj =
    components instanceof Map ? components : new Map<string, PyValue>();
  const rawSecuritySchemes = componentsMapping.has('securitySchemes')
    ? get(componentsMapping, 'securitySchemes')
    : new Map<string, PyValue>();
  let securitySchemes: Obj;
  if (!(rawSecuritySchemes instanceof Map)) {
    issues.push({ pointer: '/components/securitySchemes', message: 'must be an object' });
    securitySchemes = new Map<string, PyValue>();
  } else {
    securitySchemes = rawSecuritySchemes;
  }
  validateSecuritySchemes(securitySchemes, document, issues);
  const securitySchemeHeaders = new Set<string>();
  for (const scheme of securitySchemes.values()) {
    if (scheme instanceof Map && get(scheme, 'in') === 'header') {
      const schemeName = get(scheme, 'name');
      if (typeof schemeName === 'string') securitySchemeHeaders.add(casefold(schemeName));
    }
  }

  const paths = get(document, 'paths');
  if (!(paths instanceof Map) || paths.size === 0) {
    issues.push({ pointer: '/paths', message: 'must be a non-empty object' });
    return {
      issues: sortedUniquePointers(issues),
      warnings: sortedUniquePointers(warnings),
      operationCount: 0,
    };
  }

  const seenOperationIds = new Map<string, string>();
  let operationCount = 0;
  for (const [path, rawPathItem] of paths) {
    const pathPointer = pointerOf('/paths', path);
    if (!path.startsWith('/'))
      issues.push({ pointer: pathPointer, message: 'path key must start with /' });
    const pathItem = resolvedMapping(rawPathItem, document, pathPointer, issues);
    if (pathItem === null) continue;
    for (const method of UNSUPPORTED_METHODS) {
      if (pathItem.has(method)) {
        issues.push({
          pointer: pointerOf(pathPointer, method),
          message: 'HTTP method is not consumed by LoadCraft',
        });
      }
    }
    for (const method of HTTP_METHODS) {
      if (!pathItem.has(method)) continue;
      operationCount += 1;
      const operationPointer = pointerOf(pathPointer, method);
      const operation = resolvedMapping(get(pathItem, method), document, operationPointer, issues);
      if (operation === null) continue;
      const operationId = requireText(operation, 'operationId', operationPointer, issues);
      if (operationId !== null && operationId !== '') {
        const previous = seenOperationIds.get(operationId);
        if (previous !== undefined && previous !== '') {
          issues.push({
            pointer: pointerOf(operationPointer, 'operationId'),
            message: `duplicate operationId ${reprStr(operationId)}; first used at ${previous}`,
          });
        } else {
          seenOperationIds.set(operationId, operationPointer);
        }
      }
      if (
        !['summary', 'description'].some((key) => {
          const text = get(operation, key);
          return typeof text === 'string' && strip(text) !== '';
        })
      ) {
        issues.push({ pointer: operationPointer, message: 'summary or description is required' });
      }
      validateSecurity(operation, securitySchemes, operationPointer, issues);

      const parameters = collectParameters(
        get(pathItem, 'parameters'),
        get(operation, 'parameters'),
        document,
        operationPointer,
        issues,
      );
      warnUnusableParameters(
        method,
        parameters,
        document,
        securitySchemeHeaders,
        operationPointer,
        warnings,
      );
      warnParameterExamples(parameters, document, warnings);
      warnOperationExamples(operation, operationPointer, document, warnings);

      for (const found of path.matchAll(compileGlobal(PATH_VARIABLE))) {
        const variable = found[1] as string;
        const parameter = parameters.get(parameterKey('path', variable));
        if (parameter === undefined) {
          issues.push({
            pointer: pointerOf(operationPointer, 'parameters'),
            message: `path variable ${reprStr(variable)} has no path parameter`,
          });
        } else if (get(parameter.parameter, 'required') !== true) {
          issues.push({
            pointer: pointerOf(operationPointer, 'parameters'),
            message: `path parameter ${reprStr(variable)} must set required=true`,
          });
        }
      }

      if (operation.has('requestBody')) {
        if (method === 'get' || method === 'delete' || method === 'head') {
          issues.push({
            pointer: pointerOf(operationPointer, 'requestBody'),
            message: 'GET/HEAD/DELETE request bodies are rejected by LoadCraft flow validation',
          });
        }
        validateRequestBody(
          get(operation, 'requestBody'),
          document,
          pointerOf(operationPointer, 'requestBody'),
          issues,
        );
      }
      validateResponses(
        get(operation, 'responses'),
        document,
        pointerOf(operationPointer, 'responses'),
        issues,
        warnings,
      );

      const [size, truncated] = expandedOperationSize(
        document,
        pathItem,
        operation,
        path,
        method,
        budgetChars * EXPANSION_ABORT_FACTOR,
      );
      if (sizes !== null) sizes.push({ label: `${method.toUpperCase()} ${path}`, size, truncated });
      if (BigInt(size) > budgetChars) {
        warnings.push({
          pointer: operationPointer,
          message:
            `expanded operation is ${truncated ? 'at least ' : ''}${groupThousands(size)} characters, ` +
            `above the ${groupThousands(budgetChars)} budget: the backend expands every $ref at every ` +
            'use and counts the success schema twice, and all operations of one generated ' +
            `path share ${groupThousands(BACKEND_PATH_BUDGET_CHARS)} characters. Trim large objects to ` +
            'the fields a journey correlates or asserts on, and describe deeper nesting ' +
            'as `type: object` with a description',
        });
      }
    }
  }

  if (operationCount === 0) {
    issues.push({ pointer: '/paths', message: 'contains no supported HTTP operations' });
  }
  return {
    issues: sortedUniquePointers(issues),
    warnings: sortedUniquePointers(warnings),
    operationCount,
  };
}

const SPEC: ParserSpec = {
  usage: `usage: validate_openapi.mjs [-h] [--budget-chars BUDGET_CHARS] [--measure]
                            [--strict]
                            spec
`,
  help: `Validate a self-contained OpenAPI JSON file for LoadCraft.

positional arguments:
  spec                  Path to the canonical openapi.json

options:
  -h, --help            show this help message and exit
  --budget-chars BUDGET_CHARS
                        Warn when one operation, with every $ref expanded at
                        every use, exceeds this many characters (default
                        40,000).
  --measure             Print the expanded size of every operation, largest
                        first, then validate as usual.
  --strict              Treat LoadCraft-degrading warnings (missing response
                        example, unusable parameter, dropped examples map) as
                        errors.
`,
  positionals: [{ dest: 'spec', many: false }],
  options: [
    { flag: '--budget-chars', kind: 'int', dest: 'budget_chars', metavar: 'BUDGET_CHARS' },
    { flag: '--measure', kind: 'bool', dest: 'measure' },
    { flag: '--strict', kind: 'bool', dest: 'strict' },
  ],
};

const NESTING_MESSAGE = 'ERROR /: document nesting exceeds the supported depth';

export function main(
  out: { print(text: string): void; eprint(text: string): void },
  argv: string[],
  prog: string,
): number {
  const args = parseArgs(SPEC, prog, argv);
  const path = new PyPath(args.spec as string);
  const budget =
    typeof args.budget_chars === 'bigint' ? args.budget_chars : EXPANDED_OPERATION_BUDGET_CHARS;
  if (path.suffix.toLowerCase() !== '.json') {
    out.eprint('ERROR /: canonical LoadCraft artifact must be a .json file');
    return 1;
  }
  let document: PyValue;
  try {
    // Python 3.14 parses far deeper than the validator can walk; a document nested past the walk's
    // limit fails there, so the parser only has to get that far.
    document = loads(readText(path.text), 3000);
  } catch (error) {
    if (error instanceof PyOSError) {
      if (error.kind === 'FileNotFoundError')
        out.eprint(`ERROR /: file not found: ${path.display}`);
      else if (error.kind === 'IsADirectoryError') {
        out.eprint(`ERROR /: path is a directory, not a file: ${path.display}`);
      } else out.eprint(`ERROR /: cannot read ${path.display}: ${error.message}`);
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
      out.eprint(NESTING_MESSAGE);
      return 1;
    }
    throw error;
  }

  const sizes: SizeRow[] = [];
  let result: { issues: Issue[]; warnings: Warning[]; operationCount: number };
  try {
    result = validateDocument(document, budget, sizes);
  } catch (error) {
    if (error instanceof PyRecursionError) {
      out.eprint(NESTING_MESSAGE);
      return 1;
    }
    throw error;
  }
  let { issues, warnings } = result;
  const { operationCount } = result;

  if (args.measure === true) {
    for (const row of [...sizes].sort((a, b) => b.size - a.size)) {
      out.print(
        `${groupThousands(row.size).padStart(10)}${row.truncated ? '+' : ' '} ${row.label}`,
      );
    }
    const total = sizes.reduce((sum, row) => sum + row.size, 0);
    out.print(`${groupThousands(total).padStart(10)}  TOTAL (${sizes.length} operations)`);
  }

  if (args.strict === true) {
    issues = sortedUniquePointers([
      ...issues,
      ...warnings.map((w) => ({ pointer: w.pointer, message: w.message })),
    ]);
    warnings = [];
  }

  for (const warning of warnings) out.eprint(`WARN ${warning.pointer}: ${warning.message}`);

  if (issues.length > 0) {
    for (const issue of issues) out.eprint(`ERROR ${issue.pointer}: ${issue.message}`);
    return 1;
  }

  const noun = operationCount === 1 ? 'operation' : 'operations';
  let summary = `PASS: ${path.display} passes LoadCraft structural preflight (${operationCount} ${noun}).`;
  if (warnings.length > 0) {
    const plural = warnings.length === 1 ? 'warning' : 'warnings';
    summary +=
      ` ${warnings.length} ${plural} above degrade flow and feeder quality:` +
      ' resolve them, or name the ones you accept in the delivery report.';
  }
  out.print(summary);
  return 0;
}

runMain(main);
