// A tool that falls back to the state for an argument ends in `missing_argument` when the state holds
// none, and the hint of that error must send the model to something that can give the value: the tool
// that lists such objects, or a plain statement that none does. "Run process_get_status" is a dead end
// (the state is what held nothing). Every argument of the catalog that has a `from_state` has a hint of
// its own in both languages, and no such hint names process_get_status.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { en } from '../src/render/i18n/en.js';
import { pl } from '../src/render/i18n/pl.js';
import { MODULE_TEXTS } from '../src/render/i18n/_generated/modules.js';

const CATALOG = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'catalog', 'katalog.json'), 'utf8'),
) as {
  modules: {
    tools: { name: string; arguments: { name: string; from_state: string | null }[] | null }[];
  }[];
};

/** The arguments the state can fill, with the tools that take them. */
function stateArguments(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const module of CATALOG.modules) {
    for (const tool of module.tools) {
      for (const argument of tool.arguments ?? []) {
        if (argument.from_state === null) continue;
        found.set(argument.name, [...(found.get(argument.name) ?? []), tool.name]);
      }
    }
  }
  return found;
}

const dictionaries = {
  en: { ...en, ...MODULE_TEXTS.en } as Record<string, unknown>,
  pl: { ...pl, ...MODULE_TEXTS.pl } as Record<string, unknown>,
};

describe('the hint of a missing argument the state could have filled', () => {
  it('finds the arguments the state fills', () => {
    expect(stateArguments().size).toBeGreaterThan(5);
  });

  it('every such argument has a hint of its own in both languages', () => {
    const missing: string[] = [];
    for (const [name, tools] of stateArguments()) {
      for (const [language, dictionary] of Object.entries(dictionaries)) {
        if (typeof dictionary[`error.missing_argument.hint.${name}`] !== 'string') {
          missing.push(`${language}: ${name} (${tools.join(', ')})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('no such hint sends the model to process_get_status', () => {
    const blind = Object.entries(dictionaries).flatMap(([language, dictionary]) =>
      Object.entries(dictionary)
        .filter(([key]) => key.startsWith('error.missing_argument.hint.'))
        .filter(([, text]) => typeof text === 'string' && text.includes('process_get_status'))
        .map(([key]) => `${language}: ${key}`),
    );
    expect(blind).toEqual([]);
  });
});
