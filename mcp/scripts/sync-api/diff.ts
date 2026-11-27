// Compares two OpenAPI documents operation by operation (method + path) and says, for each change,
// whether it can break a client (`breaking`) or only adds something (`additive`).
//
// Direction decides the rule. What a client SENDS (parameters, request body) breaks when the server
// asks for more or accepts less: a new required field, a removed field, a removed enum value. What a
// client READS (responses) breaks when the answer holds less or something else: a removed field, a
// field that stopped being required, a new `null`, a changed type. A new optional field, a new
// operation and a new response enum value are additive (an exhaustive `switch` over the enum is
// caught by the compiler instead).
//
// Compositions (`allOf`, `anyOf`, `oneOf`) are read before they are compared; the rules are listed
// in the README, section "Syncing the API".

export type Kind = 'breaking' | 'additive' | 'info';
export type Direction = 'request' | 'response';

export interface Schema {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: readonly string[];
  readonly items?: Schema;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly Schema[];
  readonly oneOf?: readonly Schema[];
  readonly allOf?: readonly Schema[];
  readonly additionalProperties?: boolean | Schema;
  readonly [key: string]: unknown;
}

interface Parameter {
  readonly $ref?: string;
  readonly name?: string;
  readonly in?: string;
  readonly required?: boolean;
  readonly schema?: Schema;
}

interface MediaType {
  readonly schema?: Schema;
}

interface Operation {
  readonly parameters?: readonly Parameter[];
  readonly requestBody?: {
    readonly $ref?: string;
    readonly required?: boolean;
    readonly content?: Readonly<Record<string, MediaType>>;
  };
  readonly responses?: Readonly<
    Record<
      string,
      { readonly $ref?: string; readonly content?: Readonly<Record<string, MediaType>> }
    >
  >;
}

export interface Spec {
  readonly paths?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly components?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly [key: string]: unknown;
}

export interface Change {
  readonly kind: Kind;
  /** Where in the operation: `query q`, `request application/json sku`, `response 200 … items.price`. */
  readonly where: string;
  readonly message: string;
}

export interface OperationChange {
  /** `METHOD /path`, the method in upper case. */
  readonly operation: string;
  readonly status: 'added' | 'removed' | 'changed';
  readonly kind: Kind;
  readonly changes: readonly Change[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
/** Keywords that narrow or widen what a value may be; a change is reported, never ignored. */
const LIMITS = [
  'format',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'multipleOf',
] as const;

interface Doc {
  readonly spec: Spec;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deref<T extends { readonly $ref?: string }>(doc: Doc, node: T): T {
  let current: T = node;
  for (let hops = 0; current.$ref !== undefined && hops < 32; hops += 1) {
    const ref: string = current.$ref;
    if (!ref.startsWith('#/')) return current;
    let target: unknown = doc.spec;
    for (const part of ref.slice(2).split('/')) {
      target = isRecord(target)
        ? target[part.replaceAll('~1', '/').replaceAll('~0', '~')]
        : undefined;
    }
    if (!isRecord(target)) return current;
    current = target as T;
  }
  return current;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function typesOf(schema: Schema): string[] {
  if (schema.type === undefined) return [];
  return (
    Array.isArray(schema.type) ? [...(schema.type as string[])] : [schema.type as string]
  ).sort();
}

function variantsOf(
  schema: Schema,
): { key: 'anyOf' | 'oneOf' | 'allOf'; list: readonly Schema[] } | null {
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = schema[key];
    if (list !== undefined) return { key, list };
  }
  return null;
}

/** A name for a variant that survives a different position in the list. */
function signature(variant: Schema): string {
  if (variant.$ref !== undefined) return variant.$ref;
  const { description: _d, title: _t, ...rest } = variant as Record<string, unknown>;
  return stable(rest);
}

const NULL_SCHEMA = (schema: Schema): boolean =>
  schema.type === 'null' ||
  (Array.isArray(schema.enum) && schema.enum.length === 1 && schema.enum[0] === null);

/** The schema with its `allOf` parts merged in, or as it was when the parts cannot be merged. */
function flatten(doc: Doc, schema: Schema, depth = 0): Schema {
  const node = deref(doc, schema);
  if (node.allOf === undefined || depth > 16) return node;
  const { allOf, ...base } = node;
  const merged: Record<string, unknown> = { ...base };
  for (const raw of allOf) {
    const part = flatten(doc, raw, depth + 1);
    if (part.anyOf !== undefined || part.oneOf !== undefined || part.allOf !== undefined)
      return node;
    const typesMerged = typesOf(merged as Schema);
    const typesPart = typesOf(part);
    if (
      typesMerged.length > 0 &&
      typesPart.length > 0 &&
      stable(typesMerged) !== stable(typesPart)
    ) {
      return node;
    }
    for (const [key, value] of Object.entries(part)) {
      if (key === 'properties' && isRecord(value)) {
        const own = (merged['properties'] ?? {}) as Record<string, Schema>;
        const next: Record<string, Schema> = { ...own };
        for (const [name, property] of Object.entries(value as Record<string, Schema>)) {
          const existing = own[name];
          next[name] =
            existing === undefined
              ? property
              : stable(existing) === stable(property)
                ? existing
                : { allOf: [existing, property] };
        }
        merged['properties'] = next;
      } else if (key === 'required' && Array.isArray(value)) {
        merged['required'] = [
          ...new Set([
            ...((merged['required'] as string[] | undefined) ?? []),
            ...(value as string[]),
          ]),
        ];
      } else if (key === 'description' || key === 'title') {
        merged[key] ??= value;
      } else if (merged[key] === undefined) {
        merged[key] = value;
      } else if (stable(merged[key]) !== stable(value)) {
        return node;
      }
    }
  }
  return merged as Schema;
}

/**
 * `anyOf`/`oneOf` of one schema and `null` is that schema allowing `null`: a typed schema gets `null`
 * among its types, a union of its own is kept as it is and marked `$nullable`.
 */
function readNullable(doc: Doc, schema: Schema): Schema {
  const list = schema.anyOf ?? schema.oneOf;
  if (list === undefined) return schema;
  const rest = list.filter((variant) => !NULL_SCHEMA(flatten(doc, variant)));
  const only = rest[0];
  if (rest.length !== 1 || only === undefined || rest.length === list.length) return schema;
  const inner = flatten(doc, only);
  const { anyOf: _a, oneOf: _o, ...siblings } = schema as Record<string, unknown>;
  if (inner.anyOf !== undefined || inner.oneOf !== undefined) {
    return { ...siblings, ...inner, $nullable: true } as Schema;
  }
  const types = typesOf(inner);
  if (types.length === 0) return schema;
  return { ...siblings, ...inner, type: [...new Set([...types, 'null'])].sort() } as Schema;
}

function read(doc: Doc, schema: Schema): Schema {
  return readNullable(doc, flatten(doc, schema));
}

/** What names a schema across a nullable or single-part wrapper; used to stop on a cycle. */
function refOf(schema: Schema): string | undefined {
  if (schema.$ref !== undefined) return schema.$ref;
  const list = schema.anyOf ?? schema.oneOf ?? schema.allOf;
  if (list === undefined) return undefined;
  const refs = list
    .map((variant) => variant.$ref)
    .filter((ref): ref is string => ref !== undefined);
  if (schema.allOf !== undefined)
    return refs.length === list.length ? refs.sort().join('+') : undefined;
  return refs.length > 0 && list.length - refs.length <= 1 && refs.length === 1
    ? refs[0]
    : undefined;
}

/** How alike two schemas are: same type, shared field names, and shared fields of the same type. */
function resemblance(docA: Doc, left: Schema, docB: Doc, right: Schema): number {
  const propsA = left.properties ?? {};
  const propsB = right.properties ?? {};
  const shared = Object.keys(propsA).filter((name) => name in propsB);
  const union = new Set([...Object.keys(propsA), ...Object.keys(propsB)]).size;
  const sameType = typesOf(left).length > 0 && stable(typesOf(left)) === stable(typesOf(right));
  const sameTyped = shared.filter((name) => {
    const x = read(docA, propsA[name] as Schema);
    const y = read(docB, propsB[name] as Schema);
    return stable(typesOf(x)) === stable(typesOf(y));
  }).length;
  return (sameType ? 1 : 0) + (union === 0 ? 0 : (shared.length + sameTyped) / union);
}

class Walker {
  readonly #old: Doc;
  readonly #new: Doc;
  readonly #direction: Direction;
  readonly #error: boolean;
  readonly #seen = new Set<string>();

  constructor(oldDoc: Doc, newDoc: Doc, direction: Direction, error = false) {
    this.#old = oldDoc;
    this.#new = newDoc;
    this.#direction = direction;
    this.#error = error;
  }

  /** A change of the set of variants: in an error response it is information, not a break. */
  #variantKind(kind: Kind): Kind {
    return this.#error ? 'info' : kind;
  }

  /**
   * The variant of `variants` that stands for `plain`: the same `$ref`, the same shape, or the one
   * most alike (ties go to the smaller signature). `undefined` when none resembles it.
   */
  #match(
    plain: Schema,
    plainDoc: Doc,
    variants: readonly Schema[],
    variantsDoc: Doc,
  ): number | undefined {
    const ref = plain.$ref;
    const byRef = ref === undefined ? -1 : variants.findIndex((variant) => variant.$ref === ref);
    if (byRef >= 0) return byRef;
    const sig = signature(plain);
    const bySig = variants.findIndex((variant) => signature(variant) === sig);
    if (bySig >= 0) return bySig;
    const shape = read(plainDoc, plain);
    let best: number | undefined;
    let bestScore = 0;
    variants.forEach((variant, index) => {
      const score = resemblance(plainDoc, shape, variantsDoc, read(variantsDoc, variant));
      const better =
        score > bestScore ||
        (score === bestScore &&
          best !== undefined &&
          signature(variant) < signature(variants[best] as Schema));
      if (better) {
        best = index;
        bestScore = score;
      }
    });
    return best;
  }

  /** Whether an answer that accepts more is a problem for the side that reads it. */
  #widens(): Kind {
    return this.#direction === 'response' ? 'breaking' : 'additive';
  }

  #narrows(): Kind {
    return this.#direction === 'request' ? 'breaking' : 'additive';
  }

  /** `base` names the part of the operation, `path` the position inside its schema (dotted). */
  compare(a: Schema, b: Schema, base: string, path = ''): Change[] {
    const where = path === '' ? base : `${base} ${path}`;
    const out: Change[] = [];
    const refA = refOf(a);
    const refB = refOf(b);
    if (refA !== undefined && refB !== undefined) {
      const pair = `${refA}|${refB}`;
      if (this.#seen.has(pair)) return out;
      this.#seen.add(pair);
    }
    const left = read(this.#old, a);
    const right = read(this.#new, b);
    const at = (segment: string): string => (path === '' ? segment : `${path}.${segment}`);
    const put = (kind: Kind, place: string, message: string): void => {
      out.push({ kind, where: place, message });
    };

    const nullA = left['$nullable'] === true;
    const nullB = right['$nullable'] === true;
    if (nullA !== nullB) {
      put(
        nullB ? this.#widens() : this.#narrows(),
        where,
        nullB ? 'null allowed' : 'null no longer allowed',
      );
    }

    const anyA = left.anyOf ?? left.oneOf;
    const anyB = right.anyOf ?? right.oneOf;
    if ((anyA === undefined) !== (anyB === undefined)) {
      const plainSide = anyA === undefined ? left : right;
      if (variantsOf(plainSide) === null) {
        const oldIsPlain = anyA === undefined;
        const variants = (oldIsPlain ? anyB : anyA) ?? [];
        const index = this.#match(
          oldIsPlain ? a : b,
          oldIsPlain ? this.#old : this.#new,
          variants,
          oldIsPlain ? this.#new : this.#old,
        );
        if (index !== undefined) {
          const matched = variants[index] as Schema;
          out.push(
            ...(oldIsPlain
              ? this.compare(a, matched, base, path)
              : this.compare(matched, b, base, path)),
          );
          variants.forEach((variant, other) => {
            if (other === index) return;
            const name = refName(signature(variant));
            if (oldIsPlain) {
              put(
                this.#variantKind(this.#widens()),
                where,
                `variant added: ${name}${this.#error ? ' (error response)' : ''}`,
              );
            } else {
              put(
                this.#variantKind(this.#narrows()),
                where,
                `variant removed: ${name}${this.#error ? ' (error response)' : ''}`,
              );
            }
          });
          return out;
        }
      }
    }

    const typesA = typesOf(left);
    const typesB = typesOf(right);
    if (stable(typesA) !== stable(typesB)) {
      const gained = typesB.filter((type) => !typesA.includes(type));
      const lost = typesA.filter((type) => !typesB.includes(type));
      const kind =
        gained.length > 0 && lost.length === 0
          ? this.#widens()
          : lost.length > 0 && gained.length === 0
            ? this.#narrows()
            : 'breaking';
      put(kind, where, `type ${typesA.join('|') || 'any'} -> ${typesB.join('|') || 'any'}`);
    }

    if (left.enum !== undefined || right.enum !== undefined) {
      const before = (left.enum ?? []).map((value) => stable(value));
      const after = (right.enum ?? []).map((value) => stable(value));
      for (const value of (right.enum ?? []).filter((v) => !before.includes(stable(v)))) {
        put('additive', where, `enum value ${JSON.stringify(value)} added`);
      }
      for (const value of (left.enum ?? []).filter((v) => !after.includes(stable(v)))) {
        put(this.#narrows(), where, `enum value ${JSON.stringify(value)} removed`);
      }
    }

    for (const key of LIMITS) {
      if (stable(left[key]) !== stable(right[key])) {
        put(this.#narrows(), where, `${key} ${stable(left[key])} -> ${stable(right[key])}`);
      }
    }

    const propsA = left.properties ?? {};
    const propsB = right.properties ?? {};
    const requiredA = new Set(left.required ?? []);
    const requiredB = new Set(right.required ?? []);
    for (const name of new Set([...Object.keys(propsA), ...Object.keys(propsB)])) {
      const place = `${base} ${at(name)}`;
      const before = propsA[name];
      const after = propsB[name];
      if (before === undefined && after !== undefined) {
        const required = requiredB.has(name);
        put(
          this.#direction === 'request' && required ? 'breaking' : 'additive',
          place,
          `field ${name} added${required ? ' (required)' : ''}`,
        );
      } else if (before !== undefined && after === undefined) {
        put('breaking', place, `field ${name} removed`);
      } else if (before !== undefined && after !== undefined) {
        if (!requiredA.has(name) && requiredB.has(name)) {
          put(
            this.#direction === 'request' ? 'breaking' : 'additive',
            place,
            `field ${name} became required`,
          );
        } else if (requiredA.has(name) && !requiredB.has(name)) {
          put(
            this.#direction === 'request' ? 'additive' : 'breaking',
            place,
            `field ${name} became optional`,
          );
        }
        out.push(...this.compare(before, after, base, at(name)));
      }
    }

    if (left.items !== undefined && right.items !== undefined) {
      out.push(...this.compare(left.items, right.items, base, at('items')));
    }

    const extraA = left.additionalProperties;
    const extraB = right.additionalProperties;
    if (isRecord(extraA) && isRecord(extraB)) {
      out.push(...this.compare(extraA as Schema, extraB as Schema, base, at('*')));
    } else if (
      stable(extraA) !== stable(extraB) &&
      (isRecord(extraA) || isRecord(extraB) || extraA !== undefined || extraB !== undefined)
    ) {
      put('additive', where, `additionalProperties ${stable(extraA)} -> ${stable(extraB)}`);
    }

    const varA = variantsOf(left);
    const varB = variantsOf(right);
    const sameKind = (x: string, y: string): boolean => x === y || (x !== 'allOf' && y !== 'allOf');
    if (varA !== null && varB !== null && sameKind(varA.key, varB.key)) {
      const keysA = new Map(varA.list.map((variant) => [signature(variant), variant] as const));
      const keysB = new Map(varB.list.map((variant) => [signature(variant), variant] as const));
      const goneA = [...keysA.entries()].filter(([key]) => !keysB.has(key));
      const newB = [...keysB.entries()].filter(([key]) => !keysA.has(key));
      for (const [key, variant] of keysA) {
        const other = keysB.get(key);
        if (other !== undefined) out.push(...this.compare(variant, other, base, path));
      }
      if (
        goneA.length === 1 &&
        newB.length === 1 &&
        goneA[0] !== undefined &&
        newB[0] !== undefined
      ) {
        out.push(...this.compare(goneA[0][1], newB[0][1], base, path));
      } else {
        const note = this.#error ? ' (error response)' : '';
        for (const [key] of newB) {
          put(this.#variantKind(this.#widens()), where, `variant added: ${refName(key)}${note}`);
        }
        for (const [key] of goneA) {
          put(this.#variantKind(this.#narrows()), where, `variant removed: ${refName(key)}${note}`);
        }
      }
    } else if ((varA === null) !== (varB === null)) {
      put(
        this.#variantKind('breaking'),
        where,
        `${varA === null ? 'composition added' : 'composition removed'}`,
      );
    }
    return out;
  }
}

function refName(key: string): string {
  return key.startsWith('#/') ? (key.split('/').pop() ?? key) : key.slice(0, 80);
}

function operationsOf(spec: Spec): Map<string, Operation> {
  const found = new Map<string, Operation>();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (isRecord(operation)) found.set(`${method.toUpperCase()} ${path}`, operation as Operation);
    }
  }
  return found;
}

function pathItemOf(spec: Spec, key: string): Record<string, unknown> {
  const [, path = ''] = key.split(' ');
  return (spec.paths?.[path] ?? {}) as Record<string, unknown>;
}

function parametersOf(doc: Doc, key: string, operation: Operation): Map<string, Parameter> {
  const shared = pathItemOf(doc.spec, key)['parameters'];
  const all = [
    ...(Array.isArray(shared) ? (shared as Parameter[]) : []),
    ...(operation.parameters ?? []),
  ];
  const out = new Map<string, Parameter>();
  for (const raw of all) {
    const parameter = deref(doc, raw);
    out.set(`${parameter.in ?? '?'} ${parameter.name ?? '?'}`, parameter);
  }
  return out;
}

function diffOperation(
  oldDoc: Doc,
  newDoc: Doc,
  key: string,
  a: Operation,
  b: Operation,
): Change[] {
  const out: Change[] = [];

  const paramsA = parametersOf(oldDoc, key, a);
  const paramsB = parametersOf(newDoc, key, b);
  const request = new Walker(oldDoc, newDoc, 'request');
  for (const id of new Set([...paramsA.keys(), ...paramsB.keys()])) {
    const before = paramsA.get(id);
    const after = paramsB.get(id);
    if (before === undefined && after !== undefined) {
      out.push({
        kind: after.required === true ? 'breaking' : 'additive',
        where: id,
        message: `parameter ${after.name} added${after.required === true ? ' (required)' : ''}`,
      });
    } else if (before !== undefined && after === undefined) {
      out.push({ kind: 'breaking', where: id, message: `parameter ${before.name} removed` });
    } else if (before !== undefined && after !== undefined) {
      if (before.required !== true && after.required === true) {
        out.push({
          kind: 'breaking',
          where: id,
          message: `parameter ${after.name} became required`,
        });
      }
      out.push(...request.compare(before.schema ?? {}, after.schema ?? {}, id));
    }
  }

  const bodyA = a.requestBody === undefined ? undefined : deref(oldDoc, a.requestBody);
  const bodyB = b.requestBody === undefined ? undefined : deref(newDoc, b.requestBody);
  if (bodyA === undefined && bodyB !== undefined) {
    out.push({
      kind: bodyB.required === true ? 'breaking' : 'additive',
      where: 'request',
      message: `request body added${bodyB.required === true ? ' (required)' : ''}`,
    });
  } else if (bodyA !== undefined && bodyB === undefined) {
    out.push({ kind: 'breaking', where: 'request', message: 'request body removed' });
  } else if (bodyA !== undefined && bodyB !== undefined) {
    out.push(...diffContent(request, 'request', bodyA.content, bodyB.content));
  }

  const responseWalker = new Walker(oldDoc, newDoc, 'response');
  const errorWalker = new Walker(oldDoc, newDoc, 'response', true);
  const responsesA = a.responses ?? {};
  const responsesB = b.responses ?? {};
  for (const status of new Set([...Object.keys(responsesA), ...Object.keys(responsesB)])) {
    const before = responsesA[status];
    const after = responsesB[status];
    if (before === undefined && after !== undefined) {
      out.push({
        kind: 'additive',
        where: `response ${status}`,
        message: `response ${status} added`,
      });
    } else if (before !== undefined && after === undefined) {
      out.push({
        kind: 'breaking',
        where: `response ${status}`,
        message: `response ${status} removed`,
      });
    } else if (before !== undefined && after !== undefined) {
      out.push(
        ...diffContent(
          /^([45](\d\d|XX)|default)$/i.test(status) ? errorWalker : responseWalker,
          `response ${status}`,
          deref(oldDoc, before).content,
          deref(newDoc, after).content,
        ),
      );
    }
  }
  return out;
}

function diffContent(
  walker: Walker,
  where: string,
  a: Readonly<Record<string, MediaType>> | undefined,
  b: Readonly<Record<string, MediaType>> | undefined,
): Change[] {
  const out: Change[] = [];
  const left = a ?? {};
  const right = b ?? {};
  for (const media of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const before = left[media];
    const after = right[media];
    const place = `${where} ${media}`;
    if (before === undefined && after !== undefined) {
      out.push({ kind: 'additive', where: place, message: `content type ${media} added` });
    } else if (before !== undefined && after === undefined) {
      out.push({ kind: 'breaking', where: place, message: `content type ${media} removed` });
    } else if (before?.schema !== undefined && after?.schema !== undefined) {
      out.push(...walker.compare(before.schema, after.schema, place));
    } else if ((before?.schema === undefined) !== (after?.schema === undefined)) {
      out.push({ kind: 'breaking', where: place, message: 'schema added or removed' });
    }
  }
  return out;
}

/** Every added, removed and changed operation of `next` against `previous`, sorted by operation. */
export function diffSpecs(previous: Spec, next: Spec): OperationChange[] {
  const oldDoc: Doc = { spec: previous };
  const newDoc: Doc = { spec: next };
  const before = operationsOf(previous);
  const after = operationsOf(next);
  const out: OperationChange[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(key);
    const b = after.get(key);
    if (a === undefined && b !== undefined) {
      out.push({ operation: key, status: 'added', kind: 'additive', changes: [] });
    } else if (a !== undefined && b === undefined) {
      out.push({ operation: key, status: 'removed', kind: 'breaking', changes: [] });
    } else if (a !== undefined && b !== undefined) {
      const changes = dedupe(diffOperation(oldDoc, newDoc, key, a, b));
      if (changes.length > 0) {
        out.push({
          operation: key,
          status: 'changed',
          kind: changes.some((change) => change.kind === 'breaking')
            ? 'breaking'
            : changes.some((change) => change.kind === 'additive')
              ? 'additive'
              : 'info',
          changes,
        });
      }
    }
  }
  return out;
}

function dedupe(changes: readonly Change[]): Change[] {
  const seen = new Set<string>();
  return changes.filter((change) => {
    const id = `${change.kind}|${change.where}|${change.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
