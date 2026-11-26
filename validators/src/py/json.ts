// `json.loads` and `json.dumps` as Python runs them. JavaScript's JSON cannot stand in: it drops
// the difference between `1` and `1.0`, rounds big integers, re-orders integer-like keys (response
// status codes!) and words its errors differently. Objects become `Map`s that keep document order,
// integers `bigint`, floats `number`.

import { PyCrash } from './io.ts';
import { reprStr } from './str.ts';

export type PyValue = null | boolean | bigint | number | string | PyValue[] | Map<string, PyValue>;

export class JSONDecodeError extends Error {
  readonly msg: string;
  readonly lineno: number;
  readonly colno: number;

  constructor(msg: string, text: string, pos: number) {
    const before = text.slice(0, pos);
    const lineno = before.split('\n').length;
    const lastBreak = before.lastIndexOf('\n');
    const colno = Array.from(lastBreak === -1 ? before : before.slice(lastBreak + 1)).length + 1;
    super(`${msg}: line ${lineno} column ${colno}`);
    this.msg = msg;
    this.lineno = lineno;
    this.colno = colno;
  }
}

/** Python's `RecursionError` for a document nested deeper than the interpreter's limit. */
export class PyRecursionError extends Error {}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const MAX_DEPTH = 990;
// CPython 3.11+ refuses to turn an integer literal of more than this many digits into an `int`.
const INT_MAX_STR_DIGITS = 4300;

class Parser {
  private depth = 0;

  constructor(
    private readonly text: string,
    private readonly maxDepth: number,
  ) {}

  skip(at: number): number {
    let i = at;
    while (i < this.text.length && WHITESPACE.has(this.text[i] as string)) i += 1;
    return i;
  }

  fail(msg: string, at: number): never {
    throw new JSONDecodeError(msg, this.text, at);
  }

  parseDocument(): PyValue {
    const start = this.skip(0);
    const [value, end] = this.scan(start);
    const rest = this.skip(end);
    if (rest !== this.text.length) this.fail('Extra data', rest);
    return value;
  }

  private scan(at: number): [PyValue, number] {
    const text = this.text;
    const ch = text[at];
    if (ch === '"') return this.string(at + 1);
    if (ch === '{') return this.object(at + 1);
    if (ch === '[') return this.array(at + 1);
    if (ch === 'n' && text.startsWith('null', at)) return [null, at + 4];
    if (ch === 't' && text.startsWith('true', at)) return [true, at + 4];
    if (ch === 'f' && text.startsWith('false', at)) return [false, at + 5];
    if (ch === 'N' && text.startsWith('NaN', at)) return [Number.NaN, at + 3];
    if (ch === 'I' && text.startsWith('Infinity', at)) return [Number.POSITIVE_INFINITY, at + 8];
    if (ch === '-' && text.startsWith('-Infinity', at)) return [Number.NEGATIVE_INFINITY, at + 9];
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(text);
    if (match === null) this.fail('Expecting value', at);
    const literal = match[0];
    const end = at + literal.length;
    if (match[1] === undefined && match[2] === undefined) {
      const digits = literal.startsWith('-') ? literal.length - 1 : literal.length;
      if (digits > INT_MAX_STR_DIGITS) {
        throw new PyCrash(
          'ValueError',
          `Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`,
        );
      }
      return [BigInt(literal), end];
    }
    return [Number(literal), end];
  }

  private string(at: number): [string, number] {
    const text = this.text;
    const begin = at - 1;
    let out = '';
    let i = at;
    for (;;) {
      const start = i;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c === 0x22 || c === 0x5c || c < 0x20) break;
        i += 1;
      }
      out += text.slice(start, i);
      if (i >= text.length) this.fail('Unterminated string starting at', begin);
      const ch = text[i] as string;
      if (ch === '"') return [out, i + 1];
      if (ch !== '\\') this.fail('Invalid control character at', i);
      const esc = text[i + 1];
      if (esc === undefined) this.fail('Unterminated string starting at', begin);
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (esc !== 'u') {
        const mapped = simple[esc];
        if (mapped === undefined) this.fail('Invalid \\escape', i);
        out += mapped;
        i += 2;
        continue;
      }
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Invalid \\uXXXX escape', i + 1);
      let code = parseInt(hex, 16);
      i += 6;
      if (code >= 0xd800 && code <= 0xdbff && text[i] === '\\' && text[i + 1] === 'u') {
        const low = text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(low)) this.fail('Invalid \\uXXXX escape', i + 1);
        const lowCode = parseInt(low, 16);
        if (lowCode >= 0xdc00 && lowCode <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (lowCode - 0xdc00);
          i += 6;
        }
      }
      out += String.fromCodePoint(code);
    }
  }

  private enter(at: number): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) throw new PyRecursionError(`nesting at ${at}`);
  }

  private object(at: number): [PyValue, number] {
    this.enter(at);
    const result = new Map<string, PyValue>();
    let i = this.skip(at);
    if (this.text[i] === '}') {
      this.depth -= 1;
      return [result, i + 1];
    }
    for (;;) {
      if (this.text[i] !== '"') this.fail('Expecting property name enclosed in double quotes', i);
      const [key, afterKey] = this.string(i + 1);
      i = this.skip(afterKey);
      if (this.text[i] !== ':') this.fail("Expecting ':' delimiter", i);
      i = this.skip(i + 1);
      const [value, afterValue] = this.scan(i);
      result.set(key, value);
      i = this.skip(afterValue);
      const next = this.text[i];
      if (next === '}') {
        this.depth -= 1;
        return [result, i + 1];
      }
      if (next !== ',') this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skip(i + 1);
      if (this.text[i] === '}') this.fail('Illegal trailing comma before end of object', comma);
    }
  }

  private array(at: number): [PyValue, number] {
    this.enter(at);
    const result: PyValue[] = [];
    let i = this.skip(at);
    if (this.text[i] === ']') {
      this.depth -= 1;
      return [result, i + 1];
    }
    for (;;) {
      const [value, afterValue] = this.scan(i);
      result.push(value);
      i = this.skip(afterValue);
      const next = this.text[i];
      if (next === ']') {
        this.depth -= 1;
        return [result, i + 1];
      }
      if (next !== ',') this.fail("Expecting ',' delimiter", i);
      const comma = i;
      i = this.skip(i + 1);
      if (this.text[i] === ']') this.fail('Illegal trailing comma before end of array', comma);
    }
  }
}

/** `json.loads(text)`; `maxDepth` is the nesting at which the caller's Python would raise `RecursionError`. */
export function loads(text: string, maxDepth: number = MAX_DEPTH): PyValue {
  if (text.startsWith('\ufeff')) {
    throw new JSONDecodeError('Unexpected UTF-8 BOM (decode using utf-8-sig)', text, 0);
  }
  try {
    return new Parser(text, maxDepth).parseDocument();
  } catch (error) {
    // Nesting deeper than the JavaScript stack allows reads as Python's own RecursionError.
    if (error instanceof RangeError) throw new PyRecursionError('maximum recursion depth exceeded');
    throw error;
  }
}

/** `repr(float)`. */
export function reprFloat(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (value === Number.POSITIVE_INFINITY) return 'inf';
  if (value === Number.NEGATIVE_INFINITY) return '-inf';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const [mantissa, exponentText] = value.toExponential().split('e') as [string, string];
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const sign = negative ? '-' : '';
  if (exponent < -4 || exponent >= 16) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const absolute = Math.abs(exponent).toString().padStart(2, '0');
    return `${sign}${head}e${exponent < 0 ? '-' : '+'}${absolute}`;
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
  if (digits.length <= exponent + 1)
    return `${sign}${digits}${'0'.repeat(exponent + 1 - digits.length)}.0`;
  return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
}

function dumpString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

export type DumpOptions = { compact?: boolean };

/** `json.dumps(value, ensure_ascii=False)`, or with `separators=(",", ":")` when `compact`. */
export function dumps(value: PyValue, options: DumpOptions = {}): string {
  const itemSeparator = options.compact === true ? ',' : ', ';
  const keySeparator = options.compact === true ? ':' : ': ';
  const walk = (node: PyValue): string => {
    if (node === null) return 'null';
    if (node === true) return 'true';
    if (node === false) return 'false';
    if (typeof node === 'bigint') return node.toString();
    if (typeof node === 'number') {
      if (Number.isNaN(node)) return 'NaN';
      if (node === Number.POSITIVE_INFINITY) return 'Infinity';
      if (node === Number.NEGATIVE_INFINITY) return '-Infinity';
      return reprFloat(node);
    }
    if (typeof node === 'string') return dumpString(node);
    if (Array.isArray(node)) return `[${node.map(walk).join(itemSeparator)}]`;
    const members: string[] = [];
    for (const [key, child] of node)
      members.push(`${dumpString(key)}${keySeparator}${walk(child)}`);
    return `{${members.join(itemSeparator)}}`;
  };
  return walk(value);
}

export { reprStr };
