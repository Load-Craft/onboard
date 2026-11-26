// Python `re` patterns run as JavaScript regular expressions. The two dialects differ where the
// validators care: `\w \d \s \b` are Unicode-aware in Python, `$` also matches before a final newline,
// `^ $ .` treat only `\n` as a line break, and JavaScript's unicode mode rejects escapes Python allows.
// `compile` rewrites a Python pattern so the JavaScript engine matches the same text.

export type Flags = { ignoreCase?: boolean; multiline?: boolean; dotAll?: boolean };
export type Mode = 'search' | 'match' | 'fullmatch';

const WORD = '\\p{L}\\p{N}_';
const SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SYNTAX = new Set('^$\\.*+?()[]{}|/'.split(''));

function isQuantifierBrace(source: string, at: number): number {
  // Returns the index just after a valid `{m}`, `{m,}`, `{,n}` or `{m,n}` starting at `at`, else -1.
  const match = /^\{(\d*)(?:(,)(\d*))?\}/.exec(source.slice(at));
  if (match === null) return -1;
  if (match[1] === '' && (match[2] === undefined || match[3] === '')) return -1;
  return at + match[0].length;
}

function translateEscape(
  source: string,
  at: number,
  inClass: boolean,
): { out: string; next: number } {
  const ch = source[at + 1];
  if (ch === undefined) throw new Error('bad escape (end of pattern)');
  const next = at + 2;
  switch (ch) {
    case 'w':
      return { out: inClass ? WORD : `[${WORD}]`, next };
    case 'W':
      if (inClass) throw new Error('\\W inside a character class is not supported');
      return { out: `[^${WORD}]`, next };
    case 'd':
      return { out: '\\p{Nd}', next };
    case 'D':
      return { out: '\\P{Nd}', next };
    case 's':
      return { out: inClass ? SPACE : `[${SPACE}]`, next };
    case 'S':
      if (inClass) throw new Error('\\S inside a character class is not supported');
      return { out: `[^${SPACE}]`, next };
    case 'b':
      return inClass
        ? { out: '\\x08', next }
        : { out: `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`, next };
    case 'B':
      return { out: `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`, next };
    case 'A':
      return { out: '(?<![\\s\\S])', next };
    case 'Z':
      return { out: '(?![\\s\\S])', next };
    case 'a':
      return { out: '\\x07', next };
    case 'n':
    case 'r':
    case 't':
    case 'f':
    case 'v':
      return { out: `\\${ch}`, next };
    case 'x': {
      const hex = source.slice(next, next + 2);
      return { out: `\\x${hex}`, next: next + 2 };
    }
    case 'u': {
      const hex = source.slice(next, next + 4);
      return { out: `\\u${hex}`, next: next + 4 };
    }
    case 'U': {
      const hex = source.slice(next, next + 8).replace(/^0+(?=.)/, '');
      return { out: `\\u{${hex}}`, next: next + 8 };
    }
    default:
      break;
  }
  if (/[0-9]/.test(ch)) return { out: `\\${ch}`, next };
  if (SYNTAX.has(ch) || (inClass && ch === '-')) return { out: `\\${ch}`, next };
  // Python lets any ASCII punctuation be escaped; unicode-mode JavaScript does not.
  return { out: ch === '\\' ? '\\\\' : ch, next };
}

// Under IGNORECASE Python also lets the Turkish dotted capital I (U+0130) and dotless small i (U+0131)
// stand for an ASCII `i`; JavaScript's unicode case folding does not. The extra characters are added
// wherever the pattern can match an ASCII `i`.
const TURKISH_I = '\\u0130\\u0131';

function classCoversI(body: string): boolean {
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    const low = ch.codePointAt(0) as number;
    let high = low;
    if (body[i + 1] === '-' && i + 2 < body.length && body[i + 2] !== '\\') {
      high = (body[i + 2] as string).codePointAt(0) as number;
      i += 2;
    }
    if ((low <= 0x49 && 0x49 <= high) || (low <= 0x69 && 0x69 <= high)) return true;
  }
  return false;
}

export function translate(source: string, flags: Flags = {}): string {
  let out = '';
  let at = 0;
  const multiline = flags.multiline === true;
  const dotAll = flags.dotAll === true;
  while (at < source.length) {
    const ch = source[at] as string;
    if (ch === '\\') {
      const piece = translateEscape(source, at, false);
      out += piece.out;
      at = piece.next;
    } else if (ch === '[') {
      let cls = '[';
      const classStart = at + 1;
      at += 1;
      if (source[at] === '^') {
        cls += '^';
        at += 1;
      }
      const prefix = cls;
      if (source[at] === ']') {
        cls += '\\]';
        at += 1;
      }
      while (at < source.length && source[at] !== ']') {
        const inner = source[at] as string;
        if (inner === '\\') {
          const piece = translateEscape(source, at, true);
          cls += piece.out;
          at = piece.next;
        } else {
          cls += inner === '[' ? '\\[' : inner;
          at += 1;
        }
      }
      if (source[at] !== ']') throw new Error('unterminated character set');
      if (flags.ignoreCase === true && classCoversI(source.slice(classStart, at))) {
        cls = `${prefix}${TURKISH_I}${cls.slice(prefix.length)}`;
      }
      out += `${cls}]`;
      at += 1;
    } else if (ch === '(' && source.startsWith('(?P<', at)) {
      const close = source.indexOf('>', at);
      out += `(?<${source.slice(at + 4, close + 1)}`;
      at = close + 1;
    } else if (ch === '(' && source.startsWith('(?P=', at)) {
      const close = source.indexOf(')', at);
      out += `\\k<${source.slice(at + 4, close)}>`;
      at = close + 1;
    } else if (ch === '.') {
      out += dotAll ? '[\\s\\S]' : '[^\\n]';
      at += 1;
    } else if (ch === '^') {
      out += multiline ? '(?<![^\\n])' : '(?<![\\s\\S])';
      at += 1;
    } else if (ch === '$') {
      out += multiline ? '(?![^\\n])' : '(?=\\n?(?![\\s\\S]))';
      at += 1;
    } else if (ch === '{') {
      const end = isQuantifierBrace(source, at);
      if (end === -1) {
        out += '\\{';
        at += 1;
      } else {
        const body = source.slice(at, end);
        out += body.startsWith('{,') ? `{0${body.slice(1)}` : body;
        at = end;
      }
    } else if (ch === '}' || ch === ']') {
      out += `\\${ch}`;
      at += 1;
    } else if (flags.ignoreCase === true && (ch === 'i' || ch === 'I')) {
      out += `[iI${TURKISH_I}]`;
      at += 1;
    } else {
      out += ch;
      at += 1;
    }
  }
  return out;
}

/** A Python pattern as a JavaScript `RegExp`. `fullmatch` and `match` anchor like `re.fullmatch` / `re.match`. */
export function compile(source: string, flags: Flags = {}, mode: Mode = 'search'): RegExp {
  let body = translate(source, flags);
  if (mode === 'fullmatch') body = `(?<![\\s\\S])(?:${body})(?![\\s\\S])`;
  else if (mode === 'match') body = `(?<![\\s\\S])(?:${body})`;
  return new RegExp(body, `u${flags.ignoreCase === true ? 'i' : ''}`);
}

/** `re.compile(source, flags)` for a search; the global variant is for `re.finditer` / `re.sub`. */
export function compileGlobal(source: string, flags: Flags = {}): RegExp {
  return new RegExp(translate(source, flags), `gu${flags.ignoreCase === true ? 'i' : ''}`);
}
