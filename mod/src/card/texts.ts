/** The translator of the cards: the keys `card.*` of the server's dictionaries, nothing else is imported. */

import type { Translator } from '../../../mcp/src/context.js';
import { createTranslatorCore } from '../../../mcp/src/render/i18n/core.js';
import { cardEn, cardPl } from '../../../mcp/src/render/i18n/card.js';
import type { Locale } from '../i18n.js';

/** A missing key reads `[key]`; it never throws. */
export function cardTexts(locale: Locale): Translator {
  return createTranslatorCore(locale, {
    strict: false,
    dictionaries: { en: { ...cardEn }, pl: { ...cardPl } },
  });
}
