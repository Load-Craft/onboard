// The secret fields of every operation of the REST contract, for `src/http/generated/secrets.ts`.
// A field is secret when its schema (or a `$ref` sibling of it, or a parameter) says `writeOnly: true`,
// `format: password` or `x-secret: true`. `x-secret: "by-name"` marks a map, or a list of
// `{name, value}`, whose values are secret only under a name that names a secret; which names those are
// is the plugin's rule (`isSecretField`), so the mark becomes `*secret` or `[secret].value`. Any other
// value of `x-secret` is refused. `contracts/secret-fields.json` adds fields the snapshot does not mark
// yet, each operation with the reason, and names the operations that have no field to mark; an
// exception that a mark of the snapshot already covers (the same field or one above it), or that names
// a field the snapshot does not have, is refused, so the file never drifts from the contract.
//
// A path names a property by `.`, every item of a list by `[]` and every value of a map by `*`
// (`items[].headers.*`); `[secret]` is an item whose `name` names a secret and `*secret` a value under
// a key that names one (header and variable values: only the secret ones are masked). A path that goes
// on through a part the snapshot leaves without a shape names the schema that describes it (`shape`),
// so a misspelt field is refused instead of passing unchecked. Paths of the request start at the input of `callOperation`: `body.…`,
// `query.<name>`, `header.<name>`, `path.<name>`. Paths of the answer start at the body of the
// answers of success (2xx); an error answer is masked by the HTTP client on its own.

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  readonly paths?: Readonly<Record<string, unknown>>;
  readonly components?: { readonly schemas?: Readonly<Record<string, unknown>> };
}

export interface SecretPathRow {
  readonly request: string[];
  readonly response: string[];
  /** Why the exception file marks the row; absent when the snapshot marks every path of it. */
  readonly reason?: string;
}

export type SecretPathTable = Map<string, SecretPathRow>;

/** `contracts/secret-fields.json`. */
export interface SecretFieldsFile {
  description?: string;
  /** Fields the snapshot does not mark yet, per operation, with the reason. */
  fields: Record<
    string,
    {
      reason: string;
      request?: string[];
      response?: string[];
      /** The schema of the contract that describes a part of no declared shape a path goes through. */
      shape?: Record<string, string | { undescribed: string }>;
      /** Fields of the answer shown on purpose though they look like part of a secret, with the reason. */
      public?: Record<string, string>;
    }
  >;
  /** Operations of tools that handle secrets that have no field to mark, with the reason. */
  without_fields: Record<string, string>;
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;
const REQUEST_ROOTS = ['body', 'query', 'header', 'path'] as const;
const JSON_MEDIA = /(\/|\+)json$/;
const FORM_MEDIA = /^(multipart\/form-data|application\/x-www-form-urlencoded)$/;
const MAX_DEPTH = 64;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `x-secret: "by-name"`: the values of a map or a list of `{name, value}` under secret names. */
const BY_NAME = 'by-name';

type Mark = 'whole' | 'by-name';

/** Where a prefix of a path is, for a message. */
const placeOf = (prefix: string): string => (prefix === '' ? 'the body' : prefix);

/** The `x-secret` of a schema or a parameter; a value other than `true` and `"by-name"` is refused. */
function secretMark(node: Json, prefix: string, where: string): Mark | undefined {
  if (!Object.hasOwn(node, 'x-secret')) return undefined;
  const value = node['x-secret'];
  if (value === true) return 'whole';
  if (value === BY_NAME) return 'by-name';
  throw new Error(
    `${where}: ${placeOf(prefix)} has x-secret ${JSON.stringify(value)}; the known values are true and "${BY_NAME}"`,
  );
}

function isMarked(schema: Json, prefix: string, where: string): Mark | undefined {
  const mark = secretMark(schema, prefix, where);
  if (schema.writeOnly === true || schema.format === 'password') return 'whole';
  return mark;
}

type ByNameShape = 'map' | 'list' | 'null' | 'other';

/** Whether the objects of `schema` declare the property `key` (through `$ref` and compositions). */
function declares(document: OpenApiDocument, schema: unknown, key: string, depth = 0): boolean {
  const s = deref(document, schema);
  if (!isObject(s) || depth > MAX_DEPTH) return false;
  if (isObject(s.properties) && Object.hasOwn(s.properties, key)) return true;
  return ['allOf', 'anyOf', 'oneOf'].some(
    (k) =>
      Array.isArray(s[k]) &&
      (s[k] as unknown[]).some((part) => declares(document, part, key, depth + 1)),
  );
}

/** What a value of `schema` can be, for `"by-name"`: a map, a list of `{name, value}`, null, other. */
function byNameShapes(document: OpenApiDocument, schema: unknown, depth = 0): Set<ByNameShape> {
  if (!isObject(schema) || depth > MAX_DEPTH) return new Set(['other']);
  const union = (parts: readonly unknown[]): Set<ByNameShape> =>
    new Set(parts.flatMap((part) => [...byNameShapes(document, part, depth + 1)]));
  const parts = ['anyOf', 'oneOf'].flatMap((key) =>
    Array.isArray(schema[key]) ? (schema[key] as unknown[]) : [],
  );
  if (parts.length > 0) return union(parts);
  if (typeof schema.$ref === 'string') return union([target(document, schema.$ref)]);
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.length === 1 ? union(schema.allOf) : new Set(['other']);
  }
  const out = new Set<ByNameShape>();
  const types = typesOf(schema);
  if (types.length === 0) out.add('other');
  for (const type of types) {
    if (type === 'null') out.add('null');
    else if (type === 'object') {
      const extra = schema.additionalProperties;
      const declared = isObject(schema.properties) && Object.keys(schema.properties).length > 0;
      const map = extra === true || isObject(extra) || (extra === undefined && !declared);
      out.add(map ? 'map' : 'other');
    } else if (type === 'array') {
      const pairs =
        declares(document, schema.items, 'name') && declares(document, schema.items, 'value');
      out.add(pairs ? 'list' : 'other');
    } else out.add('other');
  }
  return out;
}

/**
 * The path of a field marked `"by-name"`: `prefix.*secret` for a map, `prefix[secret].value` for a
 * list of `{name, value}` (the name says whether the value is a secret; the name itself is not one).
 * A null beside the shape is allowed; any other shape is refused.
 */
function byNamePath(
  document: OpenApiDocument,
  schema: unknown,
  prefix: string,
  where: string,
): string {
  const shapes = byNameShapes(document, schema);
  shapes.delete('null');
  if (shapes.size === 1 && shapes.has('map')) return join(prefix, '*secret');
  if (shapes.size === 1 && shapes.has('list')) return `${prefix}[secret].value`;
  throw new Error(
    `${where}: ${placeOf(prefix)} is marked x-secret "${BY_NAME}" but is neither a map nor a list of {name, value}`,
  );
}

function target(document: OpenApiDocument, ref: string): unknown {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>(
      (node, key) =>
        isObject(node) ? node[key.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined,
      document,
    );
}

/** A property name a path can carry: no `.`, `[`, `]`, and not `*`. */
function segment(name: string, where: string): string {
  if (name === '' || name === '*' || /[.[\]]/.test(name)) {
    throw new Error(`${where}: the property "${name}" cannot be written as a field path`);
  }
  return name;
}

/** Paths under `schema` whose schema is marked; a marked schema is one path, its inside is not read. */
function collect(
  document: OpenApiDocument,
  schema: unknown,
  prefix: string,
  refs: readonly string[],
  out: Set<string>,
  where: string,
): void {
  if (!isObject(schema) || refs.length > MAX_DEPTH) return;
  const mark = isMarked(schema, prefix, where);
  if (mark === 'whole') {
    out.add(prefix);
    return;
  }
  if (mark === 'by-name') {
    out.add(byNamePath(document, schema, prefix, where));
    return;
  }
  if (typeof schema.$ref === 'string') {
    // a schema that refers to itself through its properties has nothing new to say the second time
    if (refs.includes(schema.$ref)) return;
    collect(document, target(document, schema.$ref), prefix, [...refs, schema.$ref], out, where);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const parts = schema[key];
    if (Array.isArray(parts))
      for (const part of parts) collect(document, part, prefix, refs, out, where);
  }
  if (isObject(schema.properties)) {
    for (const [name, inner] of Object.entries(schema.properties)) {
      if (name === '' || name === '*' || /[.[\]]/.test(name)) {
        // a name a path cannot carry matters only when a secret sits at or under it
        if (hasMark(document, inner, refs, where)) segment(name, where);
        continue;
      }
      collect(document, inner, join(prefix, name), refs, out, where);
    }
  }
  if (schema.items !== undefined) collect(document, schema.items, `${prefix}[]`, refs, out, where);
  if (isObject(schema.additionalProperties)) {
    collect(document, schema.additionalProperties, join(prefix, '*'), refs, out, where);
  }
}

/** Whether anything at or under `schema` is marked (a name that cannot be a path matters only then). */
function hasMark(
  document: OpenApiDocument,
  schema: unknown,
  refs: readonly string[],
  where: string,
): boolean {
  const found = new Set<string>();
  collect(document, schema, 'x', refs, found, where);
  return found.size > 0;
}

const join = (prefix: string, name: string): string => (prefix === '' ? name : `${prefix}.${name}`);

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

interface Parameter {
  readonly name: string;
  readonly in: string;
  readonly schema?: unknown;
  readonly [key: string]: unknown;
}

interface OperationEntry {
  readonly id: string;
  readonly operation: Json;
  readonly parameters: readonly Parameter[];
}

function deref(document: OpenApiDocument, value: unknown): unknown {
  let current = value;
  for (
    let depth = 0;
    depth < 10 && isObject(current) && typeof current.$ref === 'string';
    depth += 1
  ) {
    current = target(document, current.$ref);
  }
  return current;
}

function operationsOf(document: OpenApiDocument): OperationEntry[] {
  const out: OperationEntry[] = [];
  for (const item of Object.values(document.paths ?? {})) {
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation) || typeof operation.operationId !== 'string') continue;
      const own = Array.isArray(operation.parameters) ? operation.parameters : [];
      // an operation's own parameter replaces a shared one of the same name and place
      const byKey = new Map<string, Parameter>();
      for (const raw of [...shared, ...own]) {
        const parameter = deref(document, raw);
        if (
          isObject(parameter) &&
          typeof parameter.name === 'string' &&
          typeof parameter.in === 'string'
        ) {
          byKey.set(`${parameter.in}:${parameter.name}`, parameter as Parameter);
        }
      }
      out.push({ id: operation.operationId, operation, parameters: [...byKey.values()] });
    }
  }
  return out;
}

function bodySchemas(document: OpenApiDocument, operation: Json): unknown[] {
  const body = deref(document, operation.requestBody);
  if (!isObject(body) || !isObject(body.content)) return [];
  return Object.entries(body.content)
    .filter(([media]) => JSON_MEDIA.test(media) || FORM_MEDIA.test(media))
    .map(([, content]) => (isObject(content) ? content.schema : undefined));
}

function answerSchemas(document: OpenApiDocument, operation: Json): unknown[] {
  const responses = isObject(operation.responses) ? operation.responses : {};
  return Object.entries(responses)
    .filter(([status]) => /^2\d\d$/.test(status))
    .flatMap(([, raw]) => {
      const response = deref(document, raw);
      if (!isObject(response) || !isObject(response.content)) return [];
      return Object.entries(response.content)
        .filter(([media]) => JSON_MEDIA.test(media))
        .map(([, content]) => (isObject(content) ? content.schema : undefined));
    });
}

/** The paths of the fields the document marks secret, for every operation that has one. */
export function markedPaths(document: OpenApiDocument): SecretPathTable {
  const table: SecretPathTable = new Map();
  for (const { id, operation, parameters } of operationsOf(document)) {
    const request = new Set<string>();
    const response = new Set<string>();
    for (const parameter of parameters) {
      if (!(REQUEST_ROOTS as readonly string[]).includes(parameter.in)) continue;
      const place = `${parameter.in}.${segment(parameter.name, id)}`;
      const mark = secretMark(parameter, place, id);
      if (mark === 'whole') request.add(place);
      else if (mark === 'by-name') request.add(byNamePath(document, parameter.schema, place, id));
      else collect(document, parameter.schema, place, [], request, id);
    }
    for (const schema of bodySchemas(document, operation)) {
      collect(document, schema, 'body', [], request, id);
    }
    for (const schema of answerSchemas(document, operation)) {
      collect(document, schema, '', [], response, id);
    }
    if (request.size + response.size > 0) {
      table.set(id, { request: sorted(request), response: sorted(response) });
    }
  }
  return new Map([...table].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * `items[].headers.*` → `['items', '[]', 'headers', '*']`; `[]` alone is an item of a root list.
 * `[secret]` (an item whose `name` names a secret) and `*secret` (a value under a key that names a
 * secret) are segments of their own.
 */
export function pathSegments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split('.')) {
    const name = part.replace(/(\[\]|\[secret\])+$/, '');
    if (name !== '') out.push(name);
    for (const item of part.slice(name.length).match(/\[\]|\[secret\]/g) ?? []) out.push(item);
  }
  return out;
}

const isItem = (segment: string | undefined): boolean => segment === '[]' || segment === '[secret]';
const isMapValue = (segment: string | undefined): boolean =>
  segment === '*' || segment === '*secret';

/** The path of `prefix` followed by `segment`. */
const step = (prefix: string, segment: string): string =>
  isItem(segment) ? `${prefix}${segment}` : prefix === '' ? segment : `${prefix}.${segment}`;

function typesOf(schema: Json): string[] {
  const { type } = schema;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  if (isObject(schema.properties) || schema.additionalProperties !== undefined) return ['object'];
  if (schema.items !== undefined) return ['array'];
  return [];
}

/** What a part of no declared shape is, as an entry of secret-fields.json says (`shape`). */
export type Shape = string | { readonly undescribed: string };

/** A path that goes on through a part of no declared shape, which no `shape` describes. */
class ShapeNeeded extends Error {}

interface Walk {
  readonly document: OpenApiDocument;
  readonly shapes: Readonly<Record<string, Shape>>;
  /** The keys of `shapes` some path went through. */
  readonly used: Set<string>;
  readonly where: string;
}

/**
 * A path goes on through the part at `prefix`, which declares no shape. It may end at any value of an
 * undescribed list or map (`[]`, `*`); past that, the part needs a schema of the contract that
 * describes it (`shape`), or `{undescribed: reason}` when the contract has none.
 */
function throughFreePart(
  walk: Walk,
  prefix: string,
  segments: readonly string[],
  depth: number,
): boolean {
  if (segments.length === 0) return true;
  if (segments.length === 1 && (isItem(segments[0]) || isMapValue(segments[0]))) return true;
  if (!Object.hasOwn(walk.shapes, prefix)) {
    throw new ShapeNeeded(
      `${walk.where}: ${step(prefix, segments.join('.'))} passes through ${prefix === '' ? 'the body' : prefix}, a part of no declared shape: name the schema that describes it under shape`,
    );
  }
  const shape = walk.shapes[prefix];
  walk.used.add(prefix);
  if (typeof shape !== 'string') {
    if (typeof shape?.undescribed !== 'string' || shape.undescribed.trim() === '') {
      throw new Error(`${walk.where}: the undescribed part ${prefix} needs a reason`);
    }
    return true;
  }
  if (walk.document.components?.schemas?.[shape] === undefined) {
    throw new Error(`${walk.where}: shape ${prefix} names ${shape}, not a schema of the contract`);
  }
  return reaches(walk, { $ref: `#/components/schemas/${shape}` }, segments, prefix, depth + 1);
}

/**
 * Whether a value of `schema` (at the path `prefix`) can hold a field at `segments`. A part of no
 * declared shape is handled by `throughFreePart`.
 */
function reaches(
  walk: Walk,
  schema: unknown,
  segments: readonly string[],
  prefix: string,
  depth = 0,
): boolean {
  if (segments.length === 0) return true;
  if (schema === true || schema === undefined) {
    return throughFreePart(walk, prefix, segments, depth);
  }
  if (!isObject(schema) || depth > MAX_DEPTH) return false;
  // the target of a `$ref` and the keys beside it both describe the value
  if (typeof schema.$ref === 'string') {
    const beside: Json = { ...schema };
    delete beside.$ref;
    const views = [
      target(walk.document, schema.$ref),
      ...(Object.keys(beside).length > 0 ? [beside] : []),
    ];
    return anyReaches(walk, views, segments, prefix, depth);
  }
  const parts = ['allOf', 'anyOf', 'oneOf'].flatMap((key) =>
    Array.isArray(schema[key]) ? (schema[key] as unknown[]) : [],
  );
  const types = typesOf(schema);
  if (types.length === 0) {
    return parts.length === 0
      ? throughFreePart(walk, prefix, segments, depth)
      : anyReaches(walk, parts, segments, prefix, depth);
  }
  if (parts.length > 0 && anyReaches(walk, parts, segments, prefix, depth)) return true;
  const [head = '', ...rest] = segments;
  if (isItem(head)) {
    if (!types.includes('array')) return false;
    if (schema.items === undefined) return throughFreePart(walk, prefix, segments, depth);
    if (head === '[secret]' && !declares(walk.document, schema.items, 'name')) return false;
    return reaches(walk, schema.items, rest, step(prefix, head), depth + 1);
  }
  if (!types.includes('object')) return false;
  const properties = isObject(schema.properties) ? schema.properties : {};
  if (!isMapValue(head) && Object.hasOwn(properties, head)) {
    return reaches(walk, properties[head], rest, step(prefix, head), depth + 1);
  }
  const extra = schema.additionalProperties;
  if (extra === false) return false;
  if (isObject(extra)) return reaches(walk, extra, rest, step(prefix, head), depth + 1);
  if (extra === undefined && Object.keys(properties).length > 0) return false;
  return throughFreePart(walk, prefix, segments, depth);
}

/** Whether one of `views` reaches; a part that needs a shape counts only when none reaches. */
function anyReaches(
  walk: Walk,
  views: readonly unknown[],
  segments: readonly string[],
  prefix: string,
  depth: number,
): boolean {
  let needed: ShapeNeeded | undefined;
  for (const view of views) {
    try {
      if (reaches(walk, view, segments, prefix, depth + 1)) return true;
    } catch (error) {
      if (!(error instanceof ShapeNeeded)) throw error;
      needed ??= error;
    }
  }
  if (needed !== undefined) throw needed;
  return false;
}

function requestReaches(walk: Walk, entry: OperationEntry, path: string): boolean {
  const [root, ...rest] = pathSegments(path);
  if (root === 'body') {
    return anyReaches(walk, bodySchemas(walk.document, entry.operation), rest, 'body', 0);
  }
  if (!(REQUEST_ROOTS as readonly string[]).includes(root ?? '')) return false;
  const [name, ...inner] = rest;
  const parameter = entry.parameters.find((p) => p.in === root && p.name === name);
  return (
    parameter !== undefined &&
    reaches(walk, parameter.schema ?? true, inner, `${root ?? ''}.${name ?? ''}`)
  );
}

function answerReaches(walk: Walk, entry: OperationEntry, path: string): boolean {
  return anyReaches(walk, answerSchemas(walk.document, entry.operation), pathSegments(path), '', 0);
}

/**
 * Whether a mark of the contract at `marked` covers the field at `path`: the same field or one under
 * it. Every value (`*`) covers the secret-named ones (`*secret`), every item (`[]`) the secret-named
 * ones (`[secret]`); not the other way round.
 */
function covers(marked: string, path: string): boolean {
  const above = pathSegments(marked);
  const below = pathSegments(path);
  return (
    above.length <= below.length &&
    above.every(
      (part, n) =>
        part === below[n] ||
        (part === '*' && below[n] === '*secret') ||
        (part === '[]' && below[n] === '[secret]'),
    )
  );
}

const FILE_KEYS = new Set(['description', 'fields', 'without_fields']);
const ENTRY_KEYS = new Set(['reason', 'request', 'response', 'shape', 'public']);

/** Refuses a key the file does not know (a misspelt `reponse` would leave a field unmasked). */
function checkKeys(fields: SecretFieldsFile): void {
  const where = 'secret-fields.json';
  for (const key of Object.keys(fields)) {
    if (!FILE_KEYS.has(key)) throw new Error(`${where}: unknown key ${key}`);
  }
  if (!isObject(fields.fields) || !isObject(fields.without_fields)) {
    throw new Error(`${where}: fields and without_fields must be objects`);
  }
  for (const [id, entry] of Object.entries(fields.fields)) {
    if (!isObject(entry)) throw new Error(`${where} fields: ${id} must be an object`);
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.has(key)) throw new Error(`${where} fields: ${id} has an unknown key ${key}`);
    }
  }
  for (const [id, reason] of Object.entries(fields.without_fields)) {
    if (typeof reason !== 'string')
      throw new Error(`${where} without_fields: ${id} needs a reason`);
  }
}

interface CheckedEntry {
  readonly request: string[];
  readonly response: string[];
  readonly publics: string[];
}

/** One entry of `fields`, checked against the document and the marks it already has. */
function checkEntry(
  document: OpenApiDocument,
  entry: OperationEntry,
  exception: SecretFieldsFile['fields'][string],
  marked: SecretPathRow,
): CheckedEntry {
  const id = entry.id;
  const where = `secret-fields.json fields: ${id}`;
  if (typeof exception.reason !== 'string' || exception.reason.trim() === '') {
    throw new Error(`${where} needs a reason`);
  }
  const request = exception.request ?? [];
  const response = exception.response ?? [];
  const publicFields = exception.public ?? {};
  const publics = Object.keys(publicFields);
  if (request.length + response.length + publics.length === 0) {
    throw new Error(`${where} names no field`);
  }
  const walk: Walk = { document, shapes: exception.shape ?? {}, used: new Set(), where };
  for (const [side, paths, fits] of [
    ['request', request, requestReaches],
    ['response', response, answerReaches],
  ] as const) {
    for (const path of paths) {
      if (!fits(walk, entry, path)) throw new Error(`${where} has no ${side} field ${path}`);
      const by = marked[side].find((mark) => covers(mark, path));
      if (by !== undefined) {
        const field = by === path ? path : `${by}, which holds ${path}`;
        throw new Error(
          `${where}: the contract already marks the ${side} field ${field}; remove the exception`,
        );
      }
    }
  }
  for (const [path, reason] of Object.entries(publicFields)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`${where}: the public field ${path} needs a reason`);
    }
    if (!answerReaches(walk, entry, path))
      throw new Error(`${where} has no response field ${path}`);
    if ([...response, ...marked.response].some((mark) => covers(mark, path))) {
      throw new Error(`${where}: ${path} cannot be both a public and a secret field`);
    }
  }
  for (const prefix of Object.keys(walk.shapes)) {
    if (!walk.used.has(prefix))
      throw new Error(`${where}: no path goes through the shape ${prefix}`);
  }
  return { request, response, publics };
}

function checkedFields(
  document: OpenApiDocument,
  fields: SecretFieldsFile,
): { table: SecretPathTable; publics: Map<string, string[]> } {
  checkKeys(fields);
  const table = markedPaths(document);
  const publics = new Map<string, string[]>();
  const entries = new Map(operationsOf(document).map((entry) => [entry.id, entry]));
  const known = (id: string, where: string): OperationEntry => {
    const entry = entries.get(id);
    if (entry === undefined) throw new Error(`${where}: ${id} is not an operation of the contract`);
    return entry;
  };
  for (const [id, exception] of Object.entries(fields.fields)) {
    const where = 'secret-fields.json fields';
    const entry = known(id, where);
    if (Object.hasOwn(fields.without_fields, id)) {
      throw new Error(`${where}: ${id} is also listed under without_fields`);
    }
    const marked = table.get(id) ?? { request: [], response: [] };
    const checked = checkEntry(document, entry, exception, marked);
    if (checked.publics.length > 0) publics.set(id, sorted(checked.publics));
    if (checked.request.length + checked.response.length === 0) continue;
    table.set(id, {
      request: sorted([...marked.request, ...checked.request]),
      response: sorted([...marked.response, ...checked.response]),
      reason: exception.reason,
    });
  }
  for (const [id, reason] of Object.entries(fields.without_fields)) {
    const where = 'secret-fields.json without_fields';
    known(id, where);
    if (reason.trim() === '') throw new Error(`${where}: ${id} needs a reason`);
    if (table.has(id)) {
      throw new Error(
        `${where}: the contract marks secret fields of ${id}; remove it from the list`,
      );
    }
  }
  return { table: new Map([...table].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), publics };
}

/**
 * The table of `src/http/generated/secrets.ts`: the fields the document marks, and the exceptions of
 * `fields` added to them. Throws when the file has a key it does not know, an exception names an
 * operation or a field the document does not have (a part of no declared shape needs the schema that
 * describes it), repeats a field the document marks, or comes without a reason.
 */
export function secretPathsOf(
  document: OpenApiDocument,
  fields: SecretFieldsFile = { fields: {}, without_fields: {} },
): SecretPathTable {
  return checkedFields(document, fields).table;
}

/**
 * The public fields of the answers (`public` of an entry): values that look like part of a secret by
 * design (the prefix of a token) and are shown; checked like the secret fields.
 */
export function publicPathsOf(
  document: OpenApiDocument,
  fields: SecretFieldsFile,
): Map<string, string[]> {
  return checkedFields(document, fields).publics;
}

const HEADER = `/**
 * Generated file - do not edit.
 * Source: contracts/loadcraft-openapi.json and contracts/secret-fields.json. Regenerate with
 * "npm run gen:api" (from mcp/).
 */
`;

const list = (paths: readonly string[]): string => `[${paths.map((p) => `'${p}'`).join(', ')}]`;

/** The text of `src/http/generated/secrets.ts`. */
export function emitSecrets(table: SecretPathTable): string {
  const rows = [...table].map(([id, row]) => {
    const note = row.reason === undefined ? '' : `  // not marked in the contract: ${row.reason}\n`;
    return `${note}  ${id}: { request: ${list(row.request)}, response: ${list(row.response)} },\n`;
  });
  return (
    HEADER +
    `
import type { OperationId } from './operations.js';

/**
 * Where the secret fields of an operation sit: in its input (\`body.…\`, \`query.<name>\`,
 * \`header.<name>\`, \`path.<name>\`) and in the body of its answer of success. A path names a property
 * by \`.\`, every item of a list by \`[]\` and every value of a map by \`*\`; \`[secret]\` is an item whose
 * \`name\` names a secret and \`*secret\` a value under a key that names one.
 */
export interface SecretPaths {
  readonly request: readonly string[];
  readonly response: readonly string[];
}

/** The secret fields of every operation that has one; \`callOperation\` masks what they hold. */
export const SECRET_PATHS: { readonly [Id in OperationId]?: SecretPaths } = {
${rows.join('')}};
`
  );
}
