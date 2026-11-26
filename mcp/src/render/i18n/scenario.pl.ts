// Texts of the tools of module scenario, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { scenarioEn } from './scenario.en.js';

export const scenarioPl: { readonly [K in keyof typeof scenarioEn]: Entry } = {};
