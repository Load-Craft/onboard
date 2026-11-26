// Texts of the tools of module functional, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { functionalEn } from './functional.en.js';

export const functionalPl: { readonly [K in keyof typeof functionalEn]: Entry } = {};
