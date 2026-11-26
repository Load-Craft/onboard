import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { toToolError } from '../src/http/errors.js';
import { LINK_KEYS } from '../src/outcome.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { en, type Dictionary, type DictionaryKey } from '../src/render/i18n/en.js';
import { pl } from '../src/render/i18n/pl.js';

describe('createTranslator', () => {
  it('substitutes {name} parameters', () => {
    const t = createTranslator('en', {
      dictionaries: { en: { 'x.hi': 'Hi {who}, {who}!' }, pl: {} },
    });
    expect(t('x.hi', { who: 'Ann' })).toBe('Hi Ann, Ann!');
    expect(t.locale).toBe('en');
  });

  it('leaves an unknown placeholder untouched outside strict mode and accepts numbers', () => {
    const t = createTranslator('en', {
      strict: false,
      dictionaries: { en: { 'x.n': '{n} of {m}' }, pl: {} },
    });
    expect(t('x.n', { n: 3 })).toBe('3 of {m}');
  });

  it.each([
    [1, '1 krok'],
    [3, '3 kroki'],
    [5, '5 kroków'],
    [22, '22 kroki'],
    [12, '12 kroków'],
    [0, '0 kroków'],
  ])('pl plural for %i steps', (count, expected) => {
    expect(createTranslator('pl').plural('common.steps', count)).toBe(expected);
  });

  it('uses the thousands separator of the locale for the count', () => {
    expect(createTranslator('pl').plural('common.requests', 12345)).toBe('12 345 żądań');
    expect(createTranslator('en').plural('common.requests', 12345)).toBe('12,345 requests');
  });

  it('en plural forms', () => {
    const t = createTranslator('en');
    expect(t.plural('common.steps', 1)).toBe('1 step');
    expect(t.plural('common.pauses', 2)).toBe('2 pauses');
  });

  it('falls back to "other" when a category is missing', () => {
    const t = createTranslator('pl', {
      dictionaries: { en: {}, pl: { 'x.k': { other: '{count} rzeczy' } } },
    });
    expect(t.plural('x.k', 1)).toBe('1 rzeczy');
  });

  it('throws on a missing key in strict mode', () => {
    expect(() => createTranslator('en', { strict: true })('nope.key')).toThrow(/nope\.key/);
    expect(() => createTranslator('en', { strict: true }).plural('nope.key', 2)).toThrow(
      /nope\.key/,
    );
  });

  it('throws when a plain key is used as plural or the reverse (strict)', () => {
    const t = createTranslator('en', { strict: true });
    expect(() => t('common.steps')).toThrow(/common\.steps/);
    expect(() => t.plural('link.flow', 2)).toThrow(/link\.flow/);
  });

  it('shows the key in brackets in production mode', () => {
    const t = createTranslator('pl', { strict: false });
    expect(t('nope.key')).toBe('[nope.key]');
    expect(t.plural('nope.key', 2)).toBe('[nope.key]');
  });

  it('throws by default under the test runner', () => {
    expect(() => createTranslator('en')('nope.key')).toThrow();
  });
});

describe('dictionaries', () => {
  it('pl has exactly the keys of en', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });

  it('every link key is translated in both languages', () => {
    for (const key of LINK_KEYS) {
      expect(en, key).toHaveProperty([key]);
      expect(pl, key).toHaveProperty([key]);
    }
  });

  it('pl plural entries have all four forms', () => {
    for (const [key, entry] of Object.entries(pl)) {
      if (typeof entry === 'string') continue;
      expect(Object.keys(entry).sort(), key).toEqual(['few', 'many', 'one', 'other']);
    }
  });

  it('the type forces the full key set', () => {
    expectTypeOf<keyof typeof pl>().toEqualTypeOf<DictionaryKey>();
    expectTypeOf<{ 'common.steps': string }>().not.toExtend<Dictionary>();
  });
});

describe('strict translator', () => {
  const dictionaries = { en: { 'x.n': '{n} of {m}', 'x.p': { other: '{count} of {m}' } }, pl: {} };

  it('throws when a slot has no parameter', () => {
    const t = createTranslator('en', { strict: true, dictionaries });
    expect(() => t('x.n', { n: 3 })).toThrow(/\{m\}|"m"/);
    expect(() => t('x.n')).toThrow(/x\.n/);
    expect(() => t.plural('x.p', 2)).toThrow(/x\.p/);
  });

  it('accepts a complete set of parameters, extra ones included', () => {
    const t = createTranslator('en', { strict: true, dictionaries });
    expect(t('x.n', { n: 3, m: 4, extra: 'x' })).toBe('3 of 4');
    expect(t.plural('x.p', 2, { m: 5 })).toBe('2 of 5');
  });
});

// Every error the plugin throws by literal code must have its text in both dictionaries, and every
// call site must supply the slots of that text.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function balanced(text: string, open: number): string {
  const pairs: Readonly<Record<string, string>> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let quote: string | undefined;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (quote !== undefined) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch in pairs) stack.push(pairs[ch] ?? '');
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

function topLevelKeys(objectText: string): string[] {
  const inner = objectText.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? '';
    if (quote !== undefined) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = undefined;
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('({['.includes(ch)) depth += 1;
    else if (')}]'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts
    .map((part) => /^\s*(\w+)/.exec(part)?.[1])
    .filter((k): k is string => k !== undefined);
}

interface Site {
  file: string;
  code: string;
  /** undefined: params are not an inline object (checked where they are built). */
  params: Set<string> | undefined;
}

function throwSites(): Site[] {
  const sites: Site[] = [];
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/new ToolError\(\s*'([a-z0-9_]+)'/g)) {
      const open = text.indexOf('(', match.index);
      const call = balanced(text, open);
      const at = call.search(/\bparams\b/);
      let params: Set<string> | undefined = new Set();
      if (at >= 0) {
        const brace = /\bparams\s*:\s*\{/.exec(call.slice(at));
        params =
          brace === null
            ? undefined
            : new Set(topLevelKeys(balanced(call, at + brace[0].length - 1)));
      }
      sites.push({ file: file.slice(srcDir.length + 1), code: match[1] ?? '', params });
    }
  }
  return sites;
}

function slotsOf(...texts: (string | undefined)[]): string[] {
  return texts.flatMap((text) => [...(text ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''));
}

describe('error texts', () => {
  const sites = throwSites();
  const text = (dictionary: Readonly<Record<string, unknown>>, key: string): string | undefined => {
    const entry = dictionary[key];
    return typeof entry === 'string' ? entry : undefined;
  };

  it('finds the throw sites', () => {
    expect(sites.length).toBeGreaterThan(20);
  });

  // Slots the translator fills itself in `http/errors.ts` (the reason text is looked up by kind; the test below renders every kind).
  const FILLED_BY_TRANSLATION = new Map([['backend_too_old', new Set(['reason'])]]);

  it('every thrown code has a message in both dictionaries', () => {
    const missing = [...new Set(sites.map((site) => site.code))].filter(
      (code) =>
        text(en, `error.${code}.message`) === undefined ||
        text(pl, `error.${code}.message`) === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('every call site supplies the slots of the message and the hint, in both languages', () => {
    const problems: string[] = [];
    for (const site of sites) {
      if (site.params === undefined) continue;
      for (const [name, dictionary] of [
        ['en', en],
        ['pl', pl],
      ] as const) {
        const slots = slotsOf(
          text(dictionary, `error.${site.code}.message`),
          text(dictionary, `error.${site.code}.hint`),
        );
        for (const slot of slots) {
          if (!site.params.has(slot) && FILLED_BY_TRANSLATION.get(site.code)?.has(slot) !== true)
            problems.push(`${site.file}: ${site.code} lacks {${slot}} (${name})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('en and pl use the same slots in every error text', () => {
    const different = Object.keys(en)
      .filter((key) => key.startsWith('error.'))
      .filter(
        (key) => slotsOf(text(en, key)).sort().join() !== slotsOf(text(pl, key)).sort().join(),
      );
    expect(different).toEqual([]);
  });
});

describe('backend_too_old reasons', () => {
  const kinds = [
    ['revision', { have: 3, need: 4 }],
    ['capability', { capability: 'har_upload' }],
    ['noMeta', {}],
  ] as const;

  it.each(
    kinds.flatMap(([kind, extra]) => (['en', 'pl'] as const).map((l) => [kind, extra, l] as const)),
  )('%s renders without an unfilled slot (%j, %s)', (kind, extra, locale) => {
    const error = new ToolError('backend_too_old', {
      params: { reasonKind: kind, advice: '', ...extra },
    });
    const shown = toToolError(error, createTranslator(locale));
    expect(`${shown.message}\n${shown.hint ?? ''}`).not.toMatch(/\{\w+\}/);
    expect(shown.message).not.toContain('no details');
  });
});
