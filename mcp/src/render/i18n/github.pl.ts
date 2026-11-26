// Texts of the tools of module github, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { githubEn } from './github.en.js';

export const githubPl: { readonly [K in keyof typeof githubEn]: Entry } = {};
