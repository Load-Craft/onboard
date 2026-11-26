// Shared helpers of the skill tests: the repository layout and a runner for the built validators.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PACK_ROOT = resolve(import.meta.dirname, '..');
export const SKILLS_ROOT = join(PACK_ROOT, 'skills');

export type ValidatorName = 'openapi' | 'asyncapi' | 'journeys' | 'overview';

export const VALIDATOR_PATHS: Record<ValidatorName, string> = {
  openapi: join(SKILLS_ROOT, 'loadcraft-openapi', 'scripts', 'validate_openapi.mjs'),
  asyncapi: join(SKILLS_ROOT, 'loadcraft-asyncapi', 'scripts', 'validate_asyncapi.mjs'),
  journeys: join(SKILLS_ROOT, 'loadcraft-journeys', 'scripts', 'validate_journeys.mjs'),
  overview: join(SKILLS_ROOT, 'loadcraft-overview', 'scripts', 'validate_overview.mjs'),
};

export type RunResult = { status: number; stdout: string; stderr: string };

/** Runs the built validator with `node`, as a user would: `node <skill-root>/scripts/validate_*.mjs <args>`. */
export function runValidator(
  name: ValidatorName,
  args: string[],
  options: { cwd?: string } = {},
): RunResult {
  const result = spawnSync(process.execPath, [VALIDATOR_PATHS[name], ...args], {
    encoding: 'utf8',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** Reads a repository file as UTF-8 text; `parts` are joined under the repository root. */
export function readRepo(...parts: string[]): string {
  return readFileSync(join(PACK_ROOT, ...parts), 'utf8');
}

/** Runs `body` with a fresh temporary directory that is removed afterwards (`tempfile.TemporaryDirectory`). */
export function withTempDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'lc-skills-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
