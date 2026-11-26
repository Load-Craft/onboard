// Texts of the tools of module traffic, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { trafficEn } from './traffic.en.js';

export const trafficPl: { readonly [K in keyof typeof trafficEn]: Entry } = {};
