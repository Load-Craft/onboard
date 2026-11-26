// Texts of the tools of module process, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { processEn } from './process.en.js';

export const processPl: { readonly [K in keyof typeof processEn]: Entry } = {};
