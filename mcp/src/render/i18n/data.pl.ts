// Texts of the tools of module data, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { dataEn } from './data.en.js';

export const dataPl: { readonly [K in keyof typeof dataEn]: Entry } = {};
