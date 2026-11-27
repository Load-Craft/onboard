// In-memory state of the fake backend ("the database"): named collections of records with an id,
// and deterministic identifiers drawn from a seed. Survives a simulated backend restart.

/** Backend error envelope (`HTTPException` and the custom exception handlers add keys to it). */
export interface ErrorBody {
  detail: unknown;
  [key: string]: unknown;
}

/** An error response a handler (or a helper it calls) throws; the server sends it as is. */
export class FakeHttpError extends Error {
  override readonly name = 'FakeHttpError';
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(`fake backend answered ${String(status)}: ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/** Deterministic UUID v4-shaped identifiers (mulberry32 PRNG), so tests can pin them. */
export function createIdSource(seed: number): () => string {
  let state = seed >>> 0;
  const nextByte = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
  return () => {
    const bytes = Array.from({ length: 16 }, nextByte);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

export interface StoredRecord {
  readonly id: string;
}

export class Collection<T extends StoredRecord> {
  readonly name: string;
  readonly #items = new Map<string, T>();

  constructor(name: string) {
    this.name = name;
  }

  get size(): number {
    return this.#items.size;
  }

  insert(item: T): T {
    if (this.#items.has(item.id)) {
      throw new Error(`${this.name}: record ${item.id} already exists`);
    }
    this.#items.set(item.id, item);
    return item;
  }

  get(id: string): T | undefined {
    return this.#items.get(id);
  }

  /** The record, or a 404 the server sends with `detail` (default `<name> not found: <id>`). */
  require(id: string, detail = `${this.name} not found: ${id}`): T {
    const item = this.#items.get(id);
    if (item === undefined) throw new FakeHttpError(404, { detail });
    return item;
  }

  /** Records in insertion order, optionally filtered. */
  list(filter: (item: T) => boolean = () => true): T[] {
    return [...this.#items.values()].filter(filter);
  }

  update(id: string, patch: Partial<Omit<T, 'id'>>): T {
    const current = this.require(id);
    const next = { ...current, ...patch };
    this.#items.set(id, next);
    return next;
  }

  delete(id: string): boolean {
    return this.#items.delete(id);
  }
}

export interface Store {
  /** Next deterministic identifier of this fake (shared with jobs). */
  newId(): string;
  /** The collection with this name, created empty on first use. */
  collection<T extends StoredRecord>(name: string): Collection<T>;
}

export function createStore(newId: () => string): Store {
  const collections = new Map<string, Collection<StoredRecord>>();
  return {
    newId,
    collection<T extends StoredRecord>(name: string): Collection<T> {
      let found = collections.get(name);
      if (found === undefined) {
        found = new Collection<StoredRecord>(name);
        collections.set(name, found);
      }
      // One collection holds one record type; callers name it at each use.
      return found as unknown as Collection<T>;
    },
  };
}
