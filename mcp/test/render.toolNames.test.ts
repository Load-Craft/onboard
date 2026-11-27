// A text names a tool only when the server offers it. A hint that sends the model to a tool the plugin
// does not expose ("github_connect links a repository") is a dead end: the model calls it, finds
// nothing, and the user is told to do something the plugin cannot. Every name of a tool of the catalog
// in the texts of both languages is a tool of the registry, or is listed below as an action of the
// LoadCraft application, where the same text says it is done there (in the application, not by a tool).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from '../src/tools/index.js';
import { en } from '../src/render/i18n/en.js';
import { pl } from '../src/render/i18n/pl.js';
import { MODULE_TEXTS } from '../src/render/i18n/_generated/modules.js';

/**
 * Names of catalog tools the plugin does not offer that a text may still mention, each with the text
 * (a key of a dictionary) that says it is done in the application. Empty is the goal.
 */
const ONLY_IN_THE_APPLICATION: Readonly<Record<string, readonly string[]>> = {};

const CATALOG = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'catalog', 'katalog.json'), 'utf8'),
) as { modules: { tools: { name: string }[] }[] };

const CATALOG_NAMES = new Set(
  CATALOG.modules.flatMap((module) => module.tools.map((tool) => tool.name)),
);
const OFFERED = new Set(ALL_TOOLS.map((tool) => tool.name));

const NAME = /\b[a-z]+(?:_[a-z]+)+\b/gu;

interface Mention {
  readonly tool: string;
  readonly key: string;
  readonly language: string;
}

function mentions(): Mention[] {
  const found: Mention[] = [];
  const dictionaries = [
    ['en', { ...en, ...MODULE_TEXTS.en }],
    ['pl', { ...pl, ...MODULE_TEXTS.pl }],
  ] as const;
  for (const [language, dictionary] of dictionaries) {
    for (const [key, entry] of Object.entries(dictionary)) {
      const texts =
        typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, string>);
      for (const text of texts) {
        for (const match of text.matchAll(NAME)) {
          if (CATALOG_NAMES.has(match[0])) found.push({ tool: match[0], key, language });
        }
      }
    }
  }
  return found;
}

describe('the texts name only tools the server offers', () => {
  it('finds the mentions of tools in the texts', () => {
    expect(mentions().length).toBeGreaterThan(50);
  });

  it('every tool a text names is offered, or is a named action of the application', () => {
    const dead = mentions().filter(
      (mention) =>
        !OFFERED.has(mention.tool) &&
        !(ONLY_IN_THE_APPLICATION[mention.tool] ?? []).includes(mention.key),
    );
    expect(dead.map((mention) => `${mention.language} ${mention.key}: ${mention.tool}`)).toEqual(
      [],
    );
  });

  it('a name listed as application-only is a catalog tool that is not offered, and its text still names it', () => {
    const all = mentions();
    for (const [tool, keys] of Object.entries(ONLY_IN_THE_APPLICATION)) {
      expect(CATALOG_NAMES.has(tool), tool).toBe(true);
      expect(OFFERED.has(tool), `${tool} is offered: drop it from the list`).toBe(false);
      for (const key of keys) {
        expect(
          all.some((m) => m.tool === tool && m.key === key),
          `${key} names ${tool}`,
        ).toBe(true);
      }
    }
  });
});
