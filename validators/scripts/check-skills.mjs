// Fails when a built validator under skills/*/scripts differs from what validators/src builds to.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VALIDATORS, buildTo, outputPath } from './build.mjs';

const dir = await mkdtemp(join(tmpdir(), 'lc-validators-'));
try {
  for (const validator of VALIDATORS) {
    const fresh = join(dir, `validate_${validator.name}.mjs`);
    await buildTo(validator, fresh);
    const committedPath = outputPath(validator);
    const committed = existsSync(committedPath) ? await readFile(committedPath) : null;
    if (committed === null || !(await readFile(fresh)).equals(committed)) {
      process.stderr.write(
        `skills/${validator.skill}/scripts/validate_${validator.name}.mjs is out of date: run npm run build:skills and commit it\n`,
      );
      process.exitCode = 1;
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
