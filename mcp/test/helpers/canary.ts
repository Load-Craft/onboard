// Sentinel secret for leak tests: tests feed it in as the API token and then prove it never shows up
// in any tool output, log line or error text - raw, URL-encoded or base64-encoded, whole or its head.

/** The API token of the tests. */
export const CANARY = 'CANARY-SECRET-7f3a';
export const TOKEN_CANARY = CANARY;
/** Passwords of the customer's files (accounts file, env file, recording): never the token. */
export const FILE_CANARY = 'FILE-SECRET-b41e8d';
/** Passwords and secrets in data a backend returns (dataset rows, provision rows, error text). */
export const BACKEND_CANARY = 'PW-SENTINEL-6c1e9b';

/** The value of a fixed header of an environment (an API key in the env file of the target). */
export const HEADER_CANARY = 'HDR-SECRET-9d27c4e1';

/**
 * A credential a backend repeats in a free text under no secret name and that no scope knows: only
 * the mask of a third party's text (`content`, `body` of tools/moduleCall.ts) finds it, by its shape
 * after `Authorization: Bearer`.
 */
export const SHAPE_CANARY = 'shp9Kq2LmZ7xV4tR8wN3bY6';

/** Every sentinel the leak check looks for; each is a different value, so none hides behind another. */
export const ALL_CANARIES: readonly string[] = [
  TOKEN_CANARY,
  FILE_CANARY,
  BACKEND_CANARY,
  HEADER_CANARY,
  SHAPE_CANARY,
];

/** Base64 (and base64url) fragments of the canary that are stable at any byte offset in a larger text. */
function base64Fragments(value: string): string[] {
  const fragments: string[] = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const bytes = Buffer.from('x'.repeat(offset) + value);
    const encoded = bytes.toString('base64').replace(/=+$/, '');
    const head = Math.ceil((offset * 8) / 6);
    const tail = bytes.length % 3 === 0 ? 0 : 1;
    const stable = encoded.slice(head, encoded.length - tail);
    fragments.push(stable, stable.replaceAll('+', '-').replaceAll('/', '_'));
  }
  return fragments;
}

/**
 * Characters at the start of a sentinel that already count as a leak: a view that cuts a text at its
 * limit can leave the head of a secret in front of the cut mark.
 */
export const CANARY_PREFIX_LENGTH = 8;

/** Characters of a sentinel any run of which counts as a leak, wherever it stands (FIX-79). */
export const CANARY_PIECE_LENGTH = 12;

/**
 * The pieces of a sentinel that count as a leak: the whole, its head and its tail, and every run of
 * `CANARY_PIECE_LENGTH` characters. A view that cuts a long line keeps the head, one that keeps the
 * end of a line keeps the tail, and a mask that hides only a part (`HDR-SECRET[redacted]`) leaves
 * a run in between.
 */
export function canaryPieces(value: string): string[] {
  const pieces = new Set([
    value,
    value.slice(0, CANARY_PREFIX_LENGTH),
    value.slice(-CANARY_PREFIX_LENGTH),
  ]);
  for (let at = 0; at + CANARY_PIECE_LENGTH <= value.length; at += 1) {
    pieces.add(value.slice(at, at + CANARY_PIECE_LENGTH));
  }
  return [...pieces];
}

/** The pieces of `secrets` that `text` holds; empty when none leaked. */
export function leakedPieces(text: string, secrets: readonly string[]): string[] {
  return secrets.flatMap(canaryPieces).filter((piece) => text.includes(piece));
}

const NEEDLES: readonly string[] = ALL_CANARIES.flatMap((value) => [
  ...canaryPieces(value),
  encodeURIComponent(value),
  Buffer.from(value).toString('hex'),
  ...base64Fragments(value),
]);

function textHasCanary(text: string): boolean {
  return NEEDLES.some((needle) => needle.length > 0 && text.includes(needle));
}

function findCanary(value: unknown, path: string, seen: WeakSet<object>): string | undefined {
  if (typeof value === 'string') return textHasCanary(value) ? path : undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return textHasCanary(bytes.toString('latin1')) || textHasCanary(bytes.toString('utf8'))
      ? path
      : undefined;
  }
  if (value instanceof ArrayBuffer) return findCanary(new Uint8Array(value), path, seen);
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (value instanceof Error) {
    const own = [value.name, value.message, value.stack ?? ''];
    for (const text of own) if (textHasCanary(text)) return path;
    if (value.cause !== undefined) return findCanary(value.cause, `${path}.cause`, seen);
  }
  if (value instanceof Map) {
    for (const [key, item] of value) {
      const hit =
        findCanary(key, `${path}<key>`, seen) ??
        findCanary(item, `${path}.get(${String(key)})`, seen);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (value instanceof Set || Array.isArray(value)) {
    let index = 0;
    for (const item of value as Iterable<unknown>) {
      const hit = findCanary(item, `${path}[${String(index)}]`, seen);
      if (hit !== undefined) return hit;
      index += 1;
    }
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    if (textHasCanary(key)) return `${path}.${key}`;
    const hit = findCanary(item, `${path}.${key}`, seen);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Throws when the canary appears anywhere in the given values (strings, objects, buffers, nested). */
export function assertNoCanary(...values: unknown[]): void {
  values.forEach((value, index) => {
    const hit = findCanary(value, `value[${String(index)}]`, new WeakSet());
    if (hit !== undefined) {
      throw new Error(`canary secret leaked at ${hit}`);
    }
  });
}
