import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTestClock } from '../../helpers/clock.js';
import { startFake } from '../server.js';
import { registerAllRoutes } from './index.js';

const DIR = import.meta.dirname;

describe('registerAllRoutes', () => {
  it('calls every register*Route(s) exported by a routes/*.ts file', () => {
    const index = readFileSync(join(DIR, 'index.ts'), 'utf8');
    for (const file of readdirSync(DIR)) {
      if (!file.endsWith('.ts') || file === 'index.ts' || file.endsWith('.test.ts')) continue;
      const names = [
        ...readFileSync(join(DIR, file), 'utf8').matchAll(
          /export function (register\w+Routes?)\(/g,
        ),
      ].map((m) => m[1] ?? '');
      for (const name of names) expect(index, `${file}: ${name}`).toContain(`${name}(fake)`);
    }
  });

  it('registers on one fake without a clash', async () => {
    const fake = await startFake({ clock: createTestClock() });
    expect(() => {
      registerAllRoutes(fake);
    }).not.toThrow();
  });
});
