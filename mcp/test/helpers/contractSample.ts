// The smallest value a schema of the contract snapshot accepts, with one given value placed at a
// field path. The fake backend checks every answer against the snapshot, so a test that needs a value
// in one field of an answer builds the answer here: required keys get the plainest value their schema
// allows, and the keys on the path are added on top. Paths name properties by `.`, every item of an
// array by `[]` and every value of a map by `*` (`items[].headers.*`); `[secret]` is an item whose
// `name` names a secret and `*secret` a value under a key that names one (the sample names them
// `Authorization` and `secret_key`). This file parses paths on its own, apart from the code under test.

type Json = Record<string, unknown>;

export interface SampleDocument {
  readonly components?: { readonly schemas?: Readonly<Record<string, unknown>> };
}

/** `items[].headers.*` → `['items', '[]', 'headers', '*']`; `[]` alone is an item of a root array. */
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

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A `$ref` with keys beside it is both: the target and the keys (`{$ref, properties}` narrows a shared shape). */
function withSiblings(schema: unknown): unknown {
  if (!isObject(schema) || typeof schema.$ref !== 'string' || Object.keys(schema).length === 1) {
    return schema;
  }
  const beside: Json = { ...schema };
  delete beside.$ref;
  return { allOf: [{ $ref: schema.$ref }], ...beside };
}

function deref(document: SampleDocument, raw: unknown): unknown {
  const schema = withSiblings(raw);
  let current = schema;
  for (
    let depth = 0;
    depth < 20 && isObject(current) && typeof current.$ref === 'string';
    depth += 1
  ) {
    const name = current.$ref.replace('#/components/schemas/', '');
    current = document.components?.schemas?.[name];
  }
  return current;
}

function typesOf(schema: Json): string[] {
  const { type } = schema;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  if (isObject(schema.properties) || schema.additionalProperties !== undefined) return ['object'];
  if (schema.items !== undefined) return ['array'];
  return [];
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

const branchesOf = (schema: Json): unknown[] => [...listOf(schema.anyOf), ...listOf(schema.oneOf)];

/** Whether a value of `schema` can hold something at `segments`. */
export function reaches(
  document: SampleDocument,
  schema: unknown,
  segments: readonly string[],
): boolean {
  const s = deref(document, schema);
  if (segments.length === 0 || s === true || s === undefined) return true;
  if (!isObject(s)) return false;
  if (Array.isArray(s.allOf) && s.allOf.some((part) => reaches(document, part, segments)))
    return true;
  const branches = branchesOf(s);
  if (branches.length > 0) return branches.some((part) => reaches(document, part, segments));
  const [head, ...rest] = segments;
  const types = typesOf(s);
  if (types.length === 0) return true;
  if (isItem(head)) return types.includes('array') && reaches(document, s.items ?? true, rest);
  if (!types.includes('object')) return false;
  const properties = isObject(s.properties) ? s.properties : {};
  if (!isMapValue(head) && head !== undefined && Object.hasOwn(properties, head)) {
    return reaches(document, properties[head], rest);
  }
  const extra = s.additionalProperties;
  if (extra === false) return false;
  if (extra === undefined && Object.keys(properties).length > 0) return false;
  return reaches(document, extra ?? true, rest);
}

function plainString(schema: Json): string {
  const formats: Record<string, string> = {
    uuid: '00000000-0000-4000-8000-000000000001',
    'date-time': '2026-11-26T10:00:00Z',
    date: '2026-11-26',
    email: 'user@example.com',
    uri: 'https://example.com/',
  };
  const format = typeof schema.format === 'string' ? formats[schema.format] : undefined;
  const text = format ?? 'x';
  const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
  return text.padEnd(min, 'x');
}

function plainNumber(schema: Json, integer: boolean): number {
  if (typeof schema.minimum === 'number') return schema.minimum;
  if (typeof schema.exclusiveMinimum === 'number') {
    return integer ? Math.floor(schema.exclusiveMinimum) + 1 : schema.exclusiveMinimum + 0.5;
  }
  if (typeof schema.maximum === 'number' && schema.maximum < 0) return schema.maximum;
  return 0;
}

function merged(document: SampleDocument, schema: Json): Json {
  if (!Array.isArray(schema.allOf)) return schema;
  // Every part and the schema itself apply at once: keys of a later one narrow an earlier one (an enum
  // beside a `$ref`), and a property several of them describe is all of those descriptions.
  const parts: Json[] = [];
  for (const part of schema.allOf) {
    const p = deref(document, part);
    if (isObject(p)) parts.push(merged(document, p));
  }
  const self: Json = { ...schema };
  delete self.allOf;
  parts.push(self);
  const out: Json = {};
  const properties = new Map<string, unknown[]>();
  const required = new Set<string>();
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key !== 'properties' && key !== 'required') out[key] = value;
    }
    for (const [name, inner] of Object.entries(isObject(part.properties) ? part.properties : {})) {
      properties.set(name, [...(properties.get(name) ?? []), inner]);
    }
    for (const name of Array.isArray(part.required) ? (part.required as string[]) : []) {
      required.add(name);
    }
  }
  if (properties.size > 0) out.type ??= 'object';
  out.properties = Object.fromEntries(
    [...properties].map(([name, all]) => [name, all.length === 1 ? all[0] : { allOf: all }]),
  );
  out.required = [...required];
  return out;
}

/**
 * A value `schema` accepts; with `segments`, one that holds `leaf` there (a string leaf where the path
 * ends; an object or a list at the end of the path holds the leaf as its only value).
 */
export function sample(
  document: SampleDocument,
  schema: unknown,
  segments: readonly string[] = [],
  leaf?: string,
  depth = 0,
): unknown {
  if (depth > 60) throw new Error('sample: schema too deep');
  const placing = leaf !== undefined;
  const s0 = deref(document, schema);
  if (s0 === true || s0 === undefined || (isObject(s0) && Object.keys(s0).length === 0)) {
    return placing ? freeForm(segments, leaf) : 'x';
  }
  if (!isObject(s0)) throw new Error('sample: schema refuses every value');
  const s = merged(document, s0);
  if ('const' in s) return s.const;
  const branches = branchesOf(s);
  if (branches.length > 0) {
    const fits = (part: unknown): boolean => {
      const p = deref(document, part);
      const nullOnly = isObject(p) && p.type === 'null';
      if (nullOnly) return false;
      if (!placing) return true;
      if (segments.length > 0) return reaches(document, part, segments);
      return isObject(p) && (typesOf(p).length === 0 || typesOf(p).some((t) => t !== 'null'));
    };
    const chosen = branches.find(fits);
    if (chosen === undefined) throw new Error('sample: no branch holds the path');
    return sample(document, chosen, segments, leaf, depth + 1);
  }
  if (Array.isArray(s.enum)) {
    const first = listOf(s.enum).find((value) => value !== null);
    return first === undefined ? null : first;
  }
  const types = typesOf(s);
  const [head, ...rest] = segments;
  const wanted =
    placing && isItem(head)
      ? 'array'
      : placing && head !== undefined
        ? 'object'
        : placing
          ? (['string', 'object', 'array'].find((t) => types.includes(t)) ?? types[0])
          : (types.find((t) => t !== 'null') ?? 'null');
  if (types.length === 0) return placing ? freeForm(segments, leaf) : 'x';
  switch (wanted) {
    case 'string':
      return placing ? leaf : plainString(s);
    case 'integer':
      return plainNumber(s, true);
    case 'number':
      return plainNumber(s, false);
    case 'boolean':
      return false;
    case 'null':
      return null;
    case 'array': {
      const items = s.items ?? true;
      if (placing) {
        const item = sample(document, items, isItem(head) ? rest : [], leaf, depth + 1);
        if (head === '[secret]' && isObject(item)) item.name = 'Authorization';
        return [item];
      }
      const count = typeof s.minItems === 'number' ? s.minItems : 0;
      return Array.from({ length: count }, () => sample(document, items, [], undefined, depth + 1));
    }
    case 'object': {
      const properties = isObject(s.properties) ? s.properties : {};
      const out: Json = {};
      for (const name of Array.isArray(s.required) ? (s.required as string[]) : []) {
        out[name] = sample(document, properties[name] ?? true, [], undefined, depth + 1);
      }
      if (!placing) return out;
      const extra = s.additionalProperties === undefined ? true : s.additionalProperties;
      if (head === undefined || isMapValue(head)) {
        out.secret_key = sample(document, extra, head === undefined ? [] : rest, leaf, depth + 1);
      } else if (Object.hasOwn(properties, head)) {
        out[head] = sample(document, properties[head], rest, leaf, depth + 1);
      } else {
        out[head] = sample(document, extra, rest, leaf, depth + 1);
      }
      return out;
    }
    default:
      throw new Error(`sample: type ${String(wanted)} is not handled`);
  }
}

/** A value of no declared shape holding the leaf at the path. */
function freeForm(segments: readonly string[], leaf: string): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return leaf;
  if (head === '[]') return [freeForm(rest, leaf)];
  if (head === '[secret]') {
    const item = freeForm(rest, leaf);
    return [
      isObject(item) ? { ...item, name: 'Authorization' } : { name: 'Authorization', value: item },
    ];
  }
  return { [isMapValue(head) ? 'secret_key' : head]: freeForm(rest, leaf) };
}
