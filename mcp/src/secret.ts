// `Secret`, the `SecretScope` contract and the values at the secret field paths of an operation
// (`secretValuesAt`): a leaf module with no imports from the project, so config,
// context, the HTTP client and the workspace code can all depend on it without forming a cycle.
// The implementation of the scope (masking) lives in `workspace/secrets.ts`.

import { inspect } from 'node:util';

/** The text every masked value is replaced with. */
export const REDACTED = '[redacted]';

/** Holds one secret value. `reveal()` is the only way to read it. */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/** Secrets of one tool call: registered values never appear in any output of the call. */
export interface SecretScope {
  /** Registers a value that must never appear in any output of this call. */
  add(value: string): Secret;
  scrub(text: string): string;
  scrubDeep<T>(value: T): T;
  containsSecret(value: unknown): boolean;
}

/**
 * `items[].headers.*` → `['items', '[]', 'headers', '*']`: a property by `.`, every item of a list by
 * `[]`, every value of a map by `*`; `[]` alone is an item of a root list. `[secret]` (an item whose
 * `name` names a secret) and `*secret` (a value under a key that names a secret) are segments too.
 */
function pathSegments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split('.')) {
    const name = part.replace(/(\[\]|\[secret\])+$/, '');
    if (name !== '') out.push(name);
    for (const item of part.slice(name.length).match(/\[\]|\[secret\]/g) ?? []) out.push(item);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every string under `value` (a number as its text): a secret field that holds a list or an object. */
function textsUnder(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number' || typeof value === 'bigint') out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) textsUnder(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) textsUnder(item, out);
}

/** Whether a field name (a map key, the `name` of an item) says its value is a secret. */
export type SecretName = (name: string) => boolean;

function walk(value: unknown, segments: readonly string[], named: SecretName, out: string[]): void {
  const [head, ...rest] = segments;
  if (head === undefined) {
    textsUnder(value, out);
    return;
  }
  if (head === '[]' || head === '[secret]') {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const kept =
        head === '[]' || (isRecord(item) && typeof item.name === 'string' && named(item.name));
      if (kept) walk(item, rest, named, out);
    }
    return;
  }
  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    // a field of a multipart form: its texts (a file is not a text the mask can search for)
    if (head === '*' || head === '*secret') return;
    for (const item of value.getAll(head)) {
      if (typeof item === 'string') walk(item, rest, named, out);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (head === '*' || head === '*secret') {
    for (const [key, item] of Object.entries(value)) {
      if (head === '*' || named(key)) walk(item, rest, named, out);
    }
  } else if (Object.hasOwn(value, head)) {
    walk(value[head], rest, named, out);
  }
}

/**
 * The values `value` holds at the field paths `paths` (as `SECRET_PATHS` of `http/generated/secrets.ts`
 * writes them): a property by `.`, every item of a list by `[]`, every value of a map by `*`; `[secret]`
 * and `*secret` keep only the items and values whose name `named` calls a secret. A field
 * that holds an object or a list gives every string and number under it; a missing field, a `null` and
 * a value of another shape give nothing. Each value once, in the order found.
 */
export function secretValuesAt(
  value: unknown,
  paths: readonly string[],
  named: SecretName,
): string[] {
  const out: string[] = [];
  for (const path of paths) walk(value, pathSegments(path), named, out);
  return [...new Set(out)];
}
