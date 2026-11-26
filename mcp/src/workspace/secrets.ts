// Secret values (API token, test account passwords) live in the process only as `Secret` objects:
// no serialization channel reveals them, and every registered value is masked in text and data.

import type { Logger } from '../log.js';
import { Secret, type SecretScope } from '../secret.js';
import { Masker } from '../security/mask.js';

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Secrets of one tool call; values added here are also masked by the shared logger. */
export class CallSecretScope implements SecretScope {
  readonly #log: Pick<Logger, 'registerSecret'>;
  readonly #masker = new Masker();

  constructor(log: Pick<Logger, 'registerSecret'>) {
    this.#log = log;
  }

  add(value: string): Secret {
    this.#log.registerSecret(value);
    // Shorter values are still hidden by `Secret`, but not searched for in text.
    this.#masker.add(value);
    return new Secret(value);
  }

  scrub(text: string): string {
    return this.#masker.text(text);
  }

  /** Copy of `value` with every string (keys included) scrubbed; the input is not modified. */
  scrubDeep<T>(value: T): T {
    return this.#scrubValue(value, new Map()) as T;
  }

  containsSecret(value: unknown): boolean {
    return this.#contains(value, new WeakSet());
  }

  #hasNeedle(text: string): boolean {
    return this.#masker.has(text);
  }

  #contains(value: unknown, seen: WeakSet<object>): boolean {
    if (typeof value === 'string') return this.#hasNeedle(value);
    if (typeof value === 'bigint') return this.#hasNeedle(value.toString());
    if (typeof value !== 'object' || value === null) return false;
    if (value instanceof Secret) return true;
    if (ArrayBuffer.isView(value)) {
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      return this.#hasNeedle(bytes.toString('utf8')) || this.#hasNeedle(bytes.toString('latin1'));
    }
    if (value instanceof ArrayBuffer) return this.#contains(new Uint8Array(value), seen);
    if (seen.has(value)) return false;
    seen.add(value);
    if (value instanceof Error) {
      const own = [value.name, value.message, value.stack ?? ''];
      if (own.some((text) => this.#hasNeedle(text))) return true;
      if (value.cause !== undefined && this.#contains(value.cause, seen)) return true;
    }
    if (value instanceof Map) {
      for (const [key, item] of value) {
        if (this.#contains(key, seen) || this.#contains(item, seen)) return true;
      }
      return false;
    }
    if (value instanceof Set || Array.isArray(value)) {
      for (const item of value as Iterable<unknown>) if (this.#contains(item, seen)) return true;
      return false;
    }
    for (const [key, item] of Object.entries(value)) {
      if (this.#hasNeedle(key) || this.#contains(item, seen)) return true;
    }
    return false;
  }

  #scrubValue(value: unknown, seen: Map<object, unknown>): unknown {
    if (typeof value === 'string') return this.scrub(value);
    if (typeof value !== 'object' || value === null) return value;
    if (value instanceof Secret || value instanceof Date) return value;
    const done = seen.get(value);
    if (done !== undefined) return done;

    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(this.#scrubValue(item, seen));
      return out;
    }
    if (value instanceof Map) {
      const out = new Map<unknown, unknown>();
      seen.set(value, out);
      for (const [key, item] of value) {
        out.set(this.#scrubValue(key, seen), this.#scrubValue(item, seen));
      }
      return out;
    }
    if (value instanceof Set) {
      const out = new Set<unknown>();
      seen.set(value, out);
      for (const item of value) out.add(this.#scrubValue(item, seen));
      return out;
    }
    if (isPlainObject(value)) {
      const proto = Object.getPrototypeOf(value) as object | null;
      const out = Object.create(proto) as Record<string, unknown>;
      seen.set(value, out);
      for (const [key, item] of Object.entries(value)) {
        out[this.scrub(key)] = this.#scrubValue(item, seen);
      }
      return out;
    }
    // Other instances (errors, class objects, bytes) are kept as they are unless they hold a secret.
    if (!this.containsSecret(value)) return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      return `[binary ${String(value.byteLength)} bytes]`;
    }
    return this.#scrubInstance(value, seen);
  }

  /** Same prototype, own properties copied with scrubbed values (message and stack included). */
  #scrubInstance(value: object, seen: Map<object, unknown>): object {
    const out = Object.create(Object.getPrototypeOf(value) as object | null) as object;
    seen.set(value, out);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if ('value' in descriptor) {
        descriptor.value = this.#scrubValue(descriptor.value, seen);
      } else {
        // Accessors could compute the secret again; they are replaced by their scrubbed result.
        const current: unknown = Reflect.get(value, key);
        Object.defineProperty(out, typeof key === 'string' ? this.scrub(key) : key, {
          value: this.#scrubValue(current, seen),
          enumerable: descriptor.enumerable ?? false,
          writable: false,
          configurable: true,
        });
        continue;
      }
      Object.defineProperty(out, typeof key === 'string' ? this.scrub(key) : key, descriptor);
    }
    return out;
  }
}
