import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

describe('VERSION', () => {
  it('is a valid semver string', () => {
    expect(VERSION).toMatch(SEMVER);
  });

  it('equals the version field of package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
