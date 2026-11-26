// Python `str` semantics that differ from JavaScript's: whitespace, case folding, `repr`, code point
// length and ordering, integer parsing and the `{:,}` format. The validators were written in Python;
// these helpers keep every message and every sort order the same after the move to TypeScript.

// Python's `str.isspace()` set (it differs from JavaScript's `\s`).
export const PY_SPACE_CLASS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const LEADING = new RegExp(`^[${PY_SPACE_CLASS}]+`);
const TRAILING = new RegExp(`[${PY_SPACE_CLASS}]+$`);
const ALL_SPACE = new RegExp(`^[${PY_SPACE_CLASS}]*$`);

/** `str.strip()` with no argument. */
export function strip(text: string): string {
  return text.replace(LEADING, '').replace(TRAILING, '');
}

/** `str.strip(chars)`. */
export function stripChars(text: string, chars: string): string {
  const set = new Set(Array.from(chars));
  const cps = Array.from(text);
  let start = 0;
  let end = cps.length;
  while (start < end && set.has(cps[start] as string)) start += 1;
  while (end > start && set.has(cps[end - 1] as string)) end -= 1;
  return cps.slice(start, end).join('');
}

/** `str.isspace()` (false for the empty string). */
export function isSpace(text: string): boolean {
  return text.length > 0 && ALL_SPACE.test(text);
}

/** `str.casefold()`: full Unicode case folding, which JavaScript has no call for. */
export function casefold(text: string): string {
  // Lower-casing applies the final-sigma rule (word-final σ becomes ς); case folding never does.
  return text
    .replace(/\u1e9e/g, 'ss')
    .toUpperCase()
    .toLowerCase()
    .replace(/\u03c2/g, '\u03c3');
}

/** `len(str)`: code points, not UTF-16 units. */
export function pyLen(text: string): number {
  return Array.from(text).length;
}

/** Order of Python `str` comparison (code points); JavaScript's `<` compares UTF-16 units. */
export function compareStr(a: string, b: string): number {
  if (a === b) return 0;
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next();
    const y = right.next();
    if (x.done === true) return y.done === true ? 0 : -1;
    if (y.done === true) return 1;
    const cx = x.value.codePointAt(0) as number;
    const cy = y.value.codePointAt(0) as number;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

const NON_PRINTABLE = /[\p{C}\p{Z}]/u;

/** `repr(str)`. */
export function reprStr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp < 0x7f) out += ch;
    else if (NON_PRINTABLE.test(ch)) {
      if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
      else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
      else out += `\\U${cp.toString(16).padStart(8, '0')}`;
    } else out += ch;
  }
  return out + quote;
}

const DECIMAL = /^\p{Nd}+$/u;

/** `str.isdigit()` for the characters that matter here (decimal digits of every script). */
export function isDigit(text: string): boolean {
  return DECIMAL.test(text);
}

/** `int(text)` for a string of decimal digits of any script. Unicode decimal digits come in runs of ten. */
export function intOfDigits(text: string): bigint {
  let value = 0n;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    let start = cp;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start -= 1;
    value = value * 10n + BigInt((cp - start) % 10);
  }
  return value;
}

/** `int(text)` as argparse's `type=int` runs it: returns undefined where Python raises ValueError. */
export function parseInt10(raw: string): bigint | undefined {
  const text = strip(raw);
  const match = /^([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)$/u.exec(text);
  if (match === null) return undefined;
  const digits = (match[2] as string).replace(/_/g, '');
  const value = intOfDigits(digits);
  return match[1] === '-' ? -value : value;
}

/** `f"{n:,}"` for an integer. */
export function groupThousands(n: number | bigint): string {
  const text = n.toString();
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

/** `str.splitlines()`: the same line boundaries as Python's, without the terminators. */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] as string;
    if (ch === '\r' && chars[i + 1] === '\n') {
      lines.push(current);
      current = '';
      i += 1;
    } else if ('\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029'.includes(ch)) {
      lines.push(current);
      current = '';
    } else current += ch;
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** `str.split()` with no argument: runs of Python whitespace, no empty fields. */
export function splitWords(text: string): string[] {
  return strip(text) === '' ? [] : strip(text).split(new RegExp(`[${PY_SPACE_CLASS}]+`));
}
