// `vitest related` passes when it selects no test file (its default is --passWithNoTests), so a list
// of changed files that matches nothing (a path from the wrong folder, a list passed as one word by
// zsh) ends green. Every script that selects tests by changed files fails on an empty selection.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

const scripts = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

describe('package scripts', () => {
  it('test:related runs vitest related and fails when it selects nothing', () => {
    expect(scripts['test:related']).toMatch(/^vitest related --run\b.*--passWithNoTests=false/u);
  });

  it('every script with vitest related fails on an empty selection', () => {
    const related = Object.entries(scripts).filter(([, command]) =>
      /vitest related/u.test(command),
    );
    expect(related.length).toBeGreaterThan(0);
    for (const [name, command] of related) {
      expect(command, name).toContain('--passWithNoTests=false');
    }
  });
});
