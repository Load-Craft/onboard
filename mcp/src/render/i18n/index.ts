// Every user-visible text comes from a dictionary through the translator built here.

import type { Locale } from '../../config.js';
import type { Translator } from '../../context.js';
import { createTranslatorCore, type Dictionaries } from './core.js';
import { en } from './en.js';
import { pl } from './pl.js';
import { MODULE_TEXTS } from './_generated/modules.js';

export type { Dictionaries } from './core.js';

export interface TranslatorOptions {
  /** Missing key: throw (true) or return the key in brackets (false). Default: throw under tests. */
  readonly strict?: boolean;
  /** Replaces the built-in dictionaries (used by tests). */
  readonly dictionaries?: Dictionaries;
}

function runsUnderTests(): boolean {
  return process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
}

// The texts of the tools of the modules (`<module>.en.ts`, `<module>.pl.ts`) keep to keys of their own.
const BUILT_IN: Dictionaries = {
  en: { ...en, ...MODULE_TEXTS.en },
  pl: { ...pl, ...MODULE_TEXTS.pl },
};

export function createTranslator(locale: Locale, options: TranslatorOptions = {}): Translator {
  return createTranslatorCore(locale, {
    strict: options.strict ?? runsUnderTests(),
    dictionaries: options.dictionaries ?? BUILT_IN,
  });
}
