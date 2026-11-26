// Texts of the tools of module results, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { resultsEn } from './results.en.js';

export const resultsPl: { readonly [K in keyof typeof resultsEn]: Entry } = {};
