// Texts of the tools of module run, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { runEn } from './run.en.js';

export const runPl: { readonly [K in keyof typeof runEn]: Entry } = {};
