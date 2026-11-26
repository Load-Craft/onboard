// Texts of the tools of module flows, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { flowsEn } from './flows.en.js';

export const flowsPl: { readonly [K in keyof typeof flowsEn]: Entry } = {};
