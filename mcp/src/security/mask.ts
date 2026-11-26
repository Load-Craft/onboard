// The one place that knows how a secret can look inside a text: the logger, the per-call secret scope
// and the WebSocket channel all mask through `Masker`, so none of them is weaker than the others.

import { oneLine } from '../render/primitives.js';
import { REDACTED } from '../secret.js';

export { REDACTED };

/** One masking threshold for the whole process; shorter values are not searched for. */
export const MIN_SECRET_LENGTH = 4;

function percentEncodings(value: string): string[] {
  const component = encodeURIComponent(value);
  const form = new URLSearchParams({ v: value }).toString().slice(2);
  const lower = (s: string): string => s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
  return [component, lower(component), form, lower(form), encodeURI(value)];
}

/**
 * Base64 and base64url of the value, standalone and as the part that stays the same wherever the
 * value sits inside a larger encoded text (for example `user:password` in a Basic header).
 */
function base64Encodings(value: string): string[] {
  const out: string[] = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const bytes = Buffer.from('x'.repeat(offset) + value, 'utf8');
    const encoded = bytes.toString('base64');
    if (offset === 0) out.push(encoded, encoded.replace(/=+$/, ''));
    const unpadded = encoded.replace(/=+$/, '');
    const head = Math.ceil((offset * 8) / 6);
    const tail = bytes.length % 3 === 0 ? 0 : 1;
    out.push(unpadded.slice(head, unpadded.length - tail));
  }
  return out.flatMap((s) => [s, s.replaceAll('+', '-').replaceAll('/', '_')]);
}

/**
 * JSON string bodies: as `JSON.stringify` writes them, and with every character outside printable
 * ASCII as `\\uXXXX` (Python `json.dumps` with `ensure_ascii=True`), hex in lower and upper case.
 */
function jsonEncodings(value: string): string[] {
  const plain = JSON.stringify(value).slice(1, -1);
  const escape = (upper: boolean): string =>
    plain.replace(/[^\x20-\x7e]/g, (ch) => {
      const hex = ch.charCodeAt(0).toString(16).padStart(4, '0');
      return `\\u${upper ? hex.toUpperCase() : hex}`;
    });
  return [plain, escape(false), escape(true)];
}

/** Hex of the UTF-8 bytes. At least 8 characters for a value of the minimum length, so a chance match is not a concern. */
function hexEncodings(value: string): string[] {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  return [hex, hex.toUpperCase()];
}

/**
 * A value shorter than this is masked only where it stands as a word of its own: `test` hides in
 * "password test rejected" but not in `run_start`, `1234` not in the handle `e-3f912345`. The boundary
 * is asked for only on a side where the value has a letter, digit or `_` (`!Pass12` hides in
 * `zz!Pass12`). Encoded forms (base64, hex) are masked anywhere, as they are only ever a part of a
 * longer encoded run.
 */
export const SHORT_SECRET_LENGTH = 8;

/** The mark a view puts where it cut a text short (`inline()` with a limit). */
export const CUT_MARK = '…';
const CUT_CODE = CUT_MARK.charCodeAt(0);

const WORD = /[\p{L}\p{N}_]/u;

function isWordAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && WORD.test(text.charAt(index));
}

interface Needle {
  readonly text: string;
  /** Masked only with no letter, digit or underscore right before it. */
  readonly boundStart: boolean;
  /** Masked only with no letter, digit or underscore right after it. */
  readonly boundEnd: boolean;
}

/** Every form of `value` searched for in text, with the word boundaries it asks for. */
function formsOf(value: string): Needle[] {
  if (value.length < MIN_SECRET_LENGTH) return [];
  // `oneLine` is the value as `inline()` shows it: breaks and runs of spaces as one space, terminal
  // sequences and invisible marks removed.
  const plain = [value, oneLine(value), ...jsonEncodings(value), ...percentEncodings(value)];
  const encoded = [...base64Encodings(value), ...hexEncodings(value)];
  const forms = new Map<string, Needle>();
  for (const text of plain) {
    if (text.length < MIN_SECRET_LENGTH) continue;
    const short = text.length < SHORT_SECRET_LENGTH;
    forms.set(text, {
      text,
      boundStart: short && isWordAt(text, 0),
      boundEnd: short && isWordAt(text, text.length - 1),
    });
  }
  for (const text of encoded) {
    if (text.length >= MIN_SECRET_LENGTH)
      forms.set(text, { text, boundStart: false, boundEnd: false });
  }
  return [...forms.values()];
}

/** Every form of `value` that is searched for in text; forms shorter than the threshold are dropped. */
export function needlesFor(value: string): string[] {
  return formsOf(value).map((needle) => needle.text);
}

/**
 * A trie with edges of CHUNK characters. A needle follows whole chunks from the root and ends in a
 * `tail` of fewer than CHUNK characters, so matching walks one node per CHUNK characters of text
 * and values that share a long prefix share the nodes of it.
 */
const CHUNK = MIN_SECRET_LENGTH;

interface Tail {
  readonly rest: string;
  readonly needle: Needle;
}

class TrieNode {
  readonly children = new Map<string, TrieNode>();
  readonly tails: Tail[] = [];
  /** First 1..CHUNK-1 characters of every child key and of every tail that goes on past them. */
  readonly heads = new Set<string>();
  /** Some needle through this node asks for no boundary before it (a cut head may stand anywhere). */
  freeStart = false;
}

class NeedleTrie {
  readonly #root = new TrieNode();
  readonly #seen = new Map<string, Needle>();

  /** Adds the needle; a form some value needs without a boundary keeps no boundary. */
  add(needle: Needle): void {
    const known = this.#seen.get(needle.text);
    const merged: Needle =
      known === undefined
        ? needle
        : {
            text: needle.text,
            boundStart: known.boundStart && needle.boundStart,
            boundEnd: known.boundEnd && needle.boundEnd,
          };
    if (
      known !== undefined &&
      known.boundStart === merged.boundStart &&
      known.boundEnd === merged.boundEnd
    ) {
      return;
    }
    this.#seen.set(needle.text, merged);
    const { text } = merged;
    let node = this.#root;
    let depth = 0;
    for (;;) {
      if (!merged.boundStart) node.freeStart = true;
      if (text.length - depth < CHUNK) break;
      const key = text.slice(depth, depth + CHUNK);
      for (let n = 1; n < CHUNK; n += 1) node.heads.add(key.slice(0, n));
      let child = node.children.get(key);
      if (child === undefined) {
        child = new TrieNode();
        node.children.set(key, child);
      }
      node = child;
      depth += CHUNK;
    }
    const rest = text.slice(depth);
    const at = node.tails.findIndex((tail) => tail.rest === rest);
    if (at === -1) node.tails.push({ rest, needle: merged });
    else node.tails[at] = { rest, needle: merged };
    for (let n = 1; n < rest.length; n += 1) node.heads.add(rest.slice(0, n));
  }

  /**
   * End of the longest stretch from `at` this trie masks, or -1: a whole needle, or with `cuts` the
   * head (at least MIN_SECRET_LENGTH characters) of one right before CUT_MARK.
   */
  endAt(input: string, at: number, cuts: boolean): number {
    let wordBefore: boolean | undefined;
    const isWordBefore = (): boolean => (wordBefore ??= isWordAt(input, at - 1));
    let end = -1;
    // Every needle is at least one chunk long, so the root holds no tail and no head worth a cut.
    let node = this.#root.children.get(input.slice(at, at + CHUNK));
    let depth = CHUNK;
    while (node !== undefined) {
      for (const { rest, needle } of node.tails) {
        if (!input.startsWith(rest, at + depth)) continue;
        const stop = at + depth + rest.length;
        if (needle.boundStart && isWordBefore()) continue;
        if (needle.boundEnd && isWordAt(input, stop)) continue;
        end = Math.max(end, stop);
      }
      if (cuts && (node.freeStart || !isWordBefore())) {
        // The cut mark within the next chunk, after a head some needle goes on past.
        for (let n = 0; n < CHUNK && at + depth + n < input.length; n += 1) {
          if (input.charCodeAt(at + depth + n) !== CUT_CODE) continue;
          const goesOn =
            n === 0
              ? node.children.size > 0 || node.tails.some((tail) => tail.rest !== '')
              : node.heads.has(input.slice(at + depth, at + depth + n));
          if (goesOn) end = Math.max(end, at + depth + n);
          break;
        }
      }
      if (at + depth + CHUNK > input.length) break;
      node = node.children.get(input.slice(at + depth, at + depth + CHUNK));
      depth += CHUNK;
    }
    return end;
  }
}

/**
 * Registry of secrets and the text masking over it. A fork sees everything its parent knows (also
 * what the parent learns later) and keeps its own additions to itself, so a short-lived scope can
 * register values without growing the registry of the process.
 *
 * Text is scanned once. At each position the trie is walked a chunk of characters at a time, so the
 * cost follows the length of the text and of the longest matching needle, not the number of values
 * (also when many of them share a prefix), and a value is added without rebuilding anything. Every
 * stretch a needle covers is masked, overlapping stretches as one. A needle cut short by a view (its
 * first characters, at least MIN_SECRET_LENGTH of them, right before CUT_MARK) is masked too.
 */
export class Masker {
  readonly #parent: Masker | undefined;
  readonly #own = new NeedleTrie();
  #empty = true;

  constructor(parent?: Masker) {
    this.#parent = parent;
  }

  fork(): Masker {
    return new Masker(this);
  }

  add(value: string): void {
    for (const needle of formsOf(value)) {
      this.#own.add(needle);
      this.#empty = false;
    }
  }

  /** This masker's trie and those of its ancestors, the ones that hold a needle. */
  #tries(): NeedleTrie[] {
    const own = this.#empty ? [] : [this.#own];
    return this.#parent === undefined ? own : [...own, ...this.#parent.#tries()];
  }

  /**
   * Stretches `[start, end)` of `input` that hold a registered value, in order of their start. With
   * `cuts`, also the head of a value right before CUT_MARK; with `first`, stops at the first one.
   */
  #stretches(input: string, cuts: boolean, first: boolean): [number, number][] {
    const tries = this.#tries();
    const found: [number, number][] = [];
    if (tries.length === 0) return found;
    const withCuts = cuts && input.includes(CUT_MARK);
    for (let at = 0; at + MIN_SECRET_LENGTH <= input.length; at += 1) {
      let end = -1;
      for (const trie of tries) end = Math.max(end, trie.endAt(input, at, withCuts));
      if (end === -1) continue;
      found.push([at, end]);
      if (first) return found;
    }
    return found;
  }

  text(input: string): string {
    const found = this.#stretches(input, true, false);
    if (found.length === 0) return input;
    // Overlapping stretches are joined, so one secret starting inside another leaves no piece of it.
    const joined: [number, number][] = [];
    for (const [start, end] of found) {
      const last = joined[joined.length - 1];
      if (last !== undefined && start < last[1]) last[1] = Math.max(last[1], end);
      else joined.push([start, end]);
    }
    let out = '';
    let from = 0;
    for (const [start, end] of joined) {
      out += `${input.slice(from, start)}${REDACTED}`;
      from = end;
    }
    return out + input.slice(from);
  }

  /** Whether a whole registered value is in `input` (a cut head is not counted). */
  has(input: string): boolean {
    return this.#stretches(input, false, true).length > 0;
  }
}
