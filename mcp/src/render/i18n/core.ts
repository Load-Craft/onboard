// The translator itself, free of any Node API: the mod's bundle (which may use none) builds its
// translators here. `index.ts` adds the default of a missing key under tests.

import type { Locale } from '../../config.js';
import type { TranslationParams, Translator } from '../../context.js';
import { num } from '../primitives.js';

/** A text: a string, or the forms of a plural by the category the language's rules select. */
export type Entry =
  | string
  | {
      readonly zero?: string;
      readonly one?: string;
      readonly two?: string;
      readonly few?: string;
      readonly many?: string;
      readonly other: string;
    };

export type Dictionaries = Readonly<Record<Locale, Readonly<Record<string, Entry>>>>;

export interface TranslatorOptions {
  /** Missing key: throw (true) or return the key in brackets (false). */
  readonly strict: boolean;
  /** The texts: the server's own, or the few the mod draws with. */
  readonly dictionaries: Dictionaries;
}

/** Fills the `{name}` slots; a slot without a parameter goes to `onMissing` (throws) or stays as written. */
function substitute(
  template: string,
  params: TranslationParams | undefined,
  onMissing: ((name: string) => void) | undefined,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params?.[name];
    if (value !== undefined) return String(value);
    onMissing?.(name);
    return match;
  });
}

export function createTranslatorCore(locale: Locale, options: TranslatorOptions): Translator {
  const { strict } = options;
  const dictionary = options.dictionaries[locale];
  const rules = new Intl.PluralRules(locale === 'pl' ? 'pl' : 'en');

  const missing = (key: string, problem: string): string => {
    if (strict) throw new Error(`i18n: ${problem} "${key}" (locale ${locale})`);
    return `[${key}]`;
  };

  const slotMissing = (key: string): ((name: string) => void) | undefined =>
    strict
      ? (name) => {
          throw new Error(`i18n: no parameter for slot {${name}} of "${key}" (locale ${locale})`);
        }
      : undefined;

  const t = (key: string, params?: TranslationParams): string => {
    const entry = dictionary[key];
    if (entry === undefined) return missing(key, 'missing key');
    if (typeof entry !== 'string') return missing(key, 'plural entry used as plain text');
    return substitute(entry, params, slotMissing(key));
  };

  const plural = (key: string, count: number, params?: TranslationParams): string => {
    const entry = dictionary[key];
    if (entry === undefined) return missing(key, 'missing key');
    if (typeof entry === 'string') return missing(key, 'plain entry used as plural');
    const template = entry[rules.select(count)] ?? entry.other;
    return substitute(template, { count: num(count, locale), ...params }, slotMissing(key));
  };

  const has = (key: string): boolean => Object.hasOwn(dictionary, key);

  return Object.assign(t, { plural, has, locale });
}
