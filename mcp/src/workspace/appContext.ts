// The text about the application that `flows_describe_journeys` hands to LoadCraft's browser agent as
// `app_context`, as the frontend does with the description of the project. It comes from the
// project's description, else from `loadcraft/overview.md`; before it leaves, every value of the
// env files in the repository root is masked (and every secret of the call), and the text is cut to
// the length of a project description.

import { readdirSync } from 'node:fs';

import { ToolError } from '../errors.js';
import type { SecretScope } from '../secret.js';
import { Masker, MIN_SECRET_LENGTH } from '../security/mask.js';
import { isEnvFileName, readEveryEnvValue } from './envFile.js';
import { openAllowed, readTextAllowed } from './uploads.js';

/** Longest project description (`PROJECT_DESCRIPTION_MAX_LENGTH`, `domain/contracts/projects.py`). */
export const APP_CONTEXT_MAX = 8000;
/** Where `loadcraft-overview` writes the overview of the application. */
export const OVERVIEW_PATH = 'loadcraft/overview.md';

/** Values that say nothing secret (switches, numbers) and would only damage the text. */
const PLAIN_VALUE = /^(?:true|false|null|none|\d+)$/iu;

function envFileNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isEnvFileName(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** A masker holding every value of every env file in `root` (an unreadable file is skipped). */
async function envMasker(root: string): Promise<Masker> {
  const masker = new Masker();
  for (const name of envFileNames(root)) {
    try {
      for (const value of await readEveryEnvValue(root, name)) {
        if (value.length >= MIN_SECRET_LENGTH && !PLAIN_VALUE.test(value)) masker.add(value);
      }
    } catch (error) {
      if (!(error instanceof ToolError)) throw error;
    }
  }
  return masker;
}

/** The overview file of the repository, or undefined when it is absent or cannot be read. */
async function overviewText(root: string): Promise<string | undefined> {
  try {
    return await readTextAllowed(await openAllowed(root, OVERVIEW_PATH, 'overview'));
  } catch (error) {
    if (error instanceof ToolError) return undefined;
    throw error;
  }
}

/**
 * The `app_context` of a run: `projectDescription`, else the overview file; masked, cut to
 * {@link APP_CONTEXT_MAX} characters (code points, as the backend counts). Undefined when there is
 * no text.
 */
export async function appContextFor(
  root: string,
  projectDescription: string | null,
  scope: SecretScope,
): Promise<string | undefined> {
  const own = projectDescription?.trim() ?? '';
  const raw = own === '' ? ((await overviewText(root)) ?? '').trim() : own;
  if (raw === '') return undefined;
  const masked = scope.scrub((await envMasker(root)).text(raw));
  return [...masked].slice(0, APP_CONTEXT_MAX).join('');
}
