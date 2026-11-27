/**
 * The translator of the panel: the texts of `pane.ts` and of `results.ts` (the names of the
 * verdicts), the same keys the server's dictionaries have. Only those small modules are imported.
 */

import type { Translator } from '../../../mcp/src/context.js';
import { createTranslatorCore } from '../../../mcp/src/render/i18n/core.js';
import { paneEn, panePl } from '../../../mcp/src/render/i18n/pane.js';
import { resultsEn, resultsPl } from '../../../mcp/src/render/i18n/results.js';
import type { Locale } from '../i18n.js';

/** A missing key reads `[key]`; it never throws. */
export function paneTexts(locale: Locale): Translator {
  return createTranslatorCore(locale, {
    strict: false,
    dictionaries: {
      en: { ...paneEn, ...resultsEn },
      pl: { ...panePl, ...resultsPl },
    },
  });
}
