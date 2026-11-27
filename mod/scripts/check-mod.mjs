// Fails when mod/register.js differs from what the current sources build to.
// `--committed <path>` compares another file instead (used by the tests).

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DEFAULT_OUT, buildModTo } from './build-mod.mjs';

function option(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined) throw new Error(`${name} needs a path`);
  return value;
}

const given = option(process.argv.slice(2), '--committed');
const committedPath = given === undefined ? DEFAULT_OUT : resolve(given);

const dir = await mkdtemp(join(tmpdir(), 'lc-mod-'));
try {
  const fresh = join(dir, 'register.js');
  await buildModTo(fresh);
  const [expected, committed] = await Promise.all([
    readFile(fresh),
    readFile(committedPath).catch(() => null),
  ]);
  if (committed === null || !expected.equals(committed)) {
    process.stderr.write(
      'mod/register.js is out of date: run npm run build:mod and commit mod/register.js\n',
    );
    process.exitCode = 1;
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
