// Shared by the evaluation-layout tests (evals.spec.ts, evals-negative.spec.ts): the front matter
// reader of the case files, grader loading, and the few Python behaviours the ports rely on
// (`json.dumps`, `str.splitlines`, `Path.rglob`).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { splitLines, splitWords } from '../validators/src/py/str.ts';
import { PACK_ROOT } from './helpers.ts';

export const EVALS = join(PACK_ROOT, 'evals');
export const PREFIX = 'mcp__plugin_loadcraft_lc__';

export type Fields = Record<string, string>;
export type Graded = { fields: Fields; body: string };

/**
 * How the quotes of a front matter value are treated. `single-quoted-whole` drops one pair of YAML
 * single quotes around the whole value; `strip-except-patterns` strips every leading and trailing
 * quote character except for the `pattern` and `input_match` keys, which keep theirs.
 */
export type QuoteStyle = 'single-quoted-whole' | 'strip-except-patterns';

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Front matter (flat `key: value` lines) and body of a Markdown file. */
export function splitFrontMatter(path: string, style: QuoteStyle): Graded {
  const text = readText(path);
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (match === null) return { fields: {}, body: text };
  const fields: Fields = {};
  for (const found of (match[1] ?? '').matchAll(/^([\w-]+):[ \t]*([^\n]*?)[ \t]*$/gm)) {
    const key = found[1] as string;
    const value = found[2] as string;
    if (style === 'single-quoted-whole') {
      fields[key] =
        value.length > 1 && value.startsWith("'") && value.endsWith("'")
          ? value.slice(1, -1)
          : value;
    } else {
      fields[key] =
        key === 'pattern' || key === 'input_match'
          ? value
          : value.replace(/^['"]+/, '').replace(/['"]+$/, '');
    }
  }
  return { fields, body: match[2] ?? '' };
}

/** `sorted(folder.glob("*.md"))` as stem -> parsed grader; a missing folder is an empty glob. */
export function loadGraders(caseDir: string, style: QuoteStyle): Record<string, Graded> {
  const folder = join(caseDir, 'graders');
  if (!existsSync(folder)) return {};
  const result: Record<string, Graded> = {};
  for (const name of readdirSync(folder).sort()) {
    if (name.endsWith('.md'))
      result[name.slice(0, -3)] = splitFrontMatter(join(folder, name), style);
  }
  return result;
}

/**
 * A grader pattern (Python dialect) as a JavaScript RegExp. The patterns use only constructs the two
 * dialects share (classes, groups, look-ahead, `^`, `$`), and the validators' `compile` rejects `[\s\S]`.
 */
export function py(source: string): RegExp {
  return new RegExp(source);
}

/** Every file under `root`, as paths relative to it split into parts, sorted (`Path.rglob("*")` files). */
export function rglobFiles(root: string): string[][] {
  const found: string[][] = [];
  const walk = (dir: string, parts: string[]): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, [...parts, name]);
      else found.push([...parts, name]);
    }
  };
  walk(root, []);
  return found;
}

/** `str.rstrip("\n")`. */
export function rstripNewlines(text: string): string {
  return text.replace(/\n+$/, '');
}

/** `str.splitlines()`: no empty last element after a final line break. */
export const splitlines = splitLines;

/** `str.split()` without arguments: runs of whitespace separate words. */
export const words = splitWords;

function quote(text: string, ensureAscii: boolean): string {
  const encoded = JSON.stringify(text);
  if (!ensureAscii) return encoded;
  return encoded.replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Python's `json.dumps(value, ensure_ascii=..., separators=...)`: spaced (`, ` and `: `) unless `compact`. */
export function pyDumps(
  value: unknown,
  options: { ensureAscii?: boolean; compact?: boolean } = {},
): string {
  const ensureAscii = options.ensureAscii ?? true;
  const itemSeparator = options.compact === true ? ',' : ', ';
  const keySeparator = options.compact === true ? ':' : ': ';
  const dump = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string') return quote(item, ensureAscii);
    if (typeof item === 'number' || typeof item === 'boolean') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(dump).join(itemSeparator)}]`;
    if (typeof item === 'object') {
      const entries = Object.entries(item).map(
        ([key, inner]) => `${quote(key, ensureAscii)}${keySeparator}${dump(inner)}`,
      );
      return `{${entries.join(itemSeparator)}}`;
    }
    throw new Error(`cannot dump ${typeof item}`);
  };
  return dump(value);
}
