/**
 * The mod's texts: the step names the server's dictionaries are built from (`steps.ts`), so a step
 * has one name in the result of a tool and in the band. Only that small module is imported: the
 * dictionaries themselves are far larger than the band needs, and the translator in
 * `render/i18n/index.ts` reads `process.env`, which a hooks module does not have.
 */

import type { Translator } from '../../mcp/src/context.js';
import { createTranslatorCore } from '../../mcp/src/render/i18n/core.js';
import { resultsEn, resultsPl } from '../../mcp/src/render/i18n/results.js';
import { stepsEn, stepsPl } from '../../mcp/src/render/i18n/steps.js';

export type Locale = 'en' | 'pl';

/** The plugin option `locale`; anything but `pl` is English, as in the server's configuration. */
export function toLocale(value: unknown): Locale {
  return value === 'pl' ? 'pl' : 'en';
}

/** The name of step `step` (1 to 8) in `locale`; empty for a number outside the eight. */
export function stepName(locale: Locale, step: number): string {
  const key = `band.step.${step}`;
  const dictionary: Readonly<Record<string, string>> = locale === 'pl' ? stepsPl : stepsEn;
  const entry = dictionary[key];
  return entry ?? '';
}

/** The word that marks a step the session does not owe (`skipped` in the state), in `locale`. */
export function skippedWord(locale: Locale): string {
  return (locale === 'pl' ? stepsPl : stepsEn)['band.skipped'];
}

/**
 * The translator the result drawings use: only the texts of `results.ts`, which the server's
 * dictionaries spread in under the same keys, so a number or a label reads the same in the result
 * of a tool and in its drawing. A missing key reads `[key]`; it never throws.
 */
export function resultTexts(locale: Locale): Translator {
  return createTranslatorCore(locale, {
    strict: false,
    dictionaries: { en: resultsEn, pl: resultsPl },
  });
}
