// Guard: the plugin names no system it was tested on and no idiom of one.
//
// Every rule, hint, tool description, example and test of the plugin describes a class of
// situations ("a fixed header with an application key in every request"), never one product.
// Test fictions use a made-up application (`shop`, `acme`) and a neutral header (`x-api-key`).
//
// The forbidden words are assembled from fragments below. Spelled out, the guard would be a
// match of its own rule; assembled, this file is clean and the exception list stays empty.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

// Names of the systems the plugin is tried on, and idioms that betray one of them.
const FORBIDDEN_FRAGMENTS: readonly (readonly string[])[] = [
  ['syl', 'ius'],
  ['med', 'usa'],
  ['x-publish', 'able-api-key'],
  ['email', 'pass'],
];
const FORBIDDEN = new RegExp(
  FORBIDDEN_FRAGMENTS.map((parts) => parts.join('').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
    '|',
  ),
  'gi',
);
// The line boundaries of Python's `str.splitlines()`.
const LINE_BREAK = new RegExp(String.raw`\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]`);
// Files allowed to contain a forbidden word, each with the reason. Keep it empty.
const ALLOWED: Record<string, string> = {};

/** `path:line: word` for each forbidden word in the given path -> text map. */
function violations(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (path in ALLOWED) continue;
    for (const match of path.matchAll(FORBIDDEN)) found.push(`${path} (the path): ${match[0]}`);
    text.split(LINE_BREAK).forEach((line, index) => {
      for (const match of line.matchAll(FORBIDDEN)) found.push(`${path}:${index + 1}: ${match[0]}`);
    });
  }
  return found;
}

function trackedFiles(): Record<string, string> {
  const listing = execFileSync('git', ['ls-files', '-z'], {
    cwd: PACK_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  const files: Record<string, string> = {};
  for (const name of listing.split('\0').filter((entry) => entry !== '')) {
    const path = join(PACK_ROOT, name);
    let isFile: boolean;
    try {
      isFile = statSync(path).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) continue;
    try {
      files[name] = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
    } catch {
      files[name] = ''; // binary: only its path is checked
    }
  }
  return files;
}

describe('NoTargetNames', () => {
  it('tracked files name no tested system', () => {
    expect(violations(trackedFiles())).toEqual([]);
  });

  it('the allowed list is empty', () => {
    expect(ALLOWED).toEqual({});
  });

  it('a name or idiom added to a skill is caught', () => {
    const clean = 'Send a fixed header with the application key in every request.\n';
    expect(violations({ 'skills/x/SKILL.md': clean })).toEqual([]);
    for (const parts of FORBIDDEN_FRAGMENTS) {
      const word = parts.join('');
      for (const variant of [
        word,
        word.toUpperCase(),
        word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
      ]) {
        const caught = violations({ 'skills/x/SKILL.md': `${clean}See ${variant}.\n` });
        expect(caught, variant).toHaveLength(1);
        expect(caught[0]).toContain('SKILL.md:2');
      }
    }
  });

  it('a name in a path is caught', () => {
    const name = (FORBIDDEN_FRAGMENTS[1] as readonly string[]).join('');
    expect(violations({ [`mcp/specs/${name}.json`]: '' })).toHaveLength(1);
  });
});
