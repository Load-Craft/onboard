// Working trees of the repository the project directory belongs to. A specification may be sent from
// another working tree of the same repository (a checkout of the branch that is deployed to the
// environment under test); this is the only place a file outside the project directory is let in.
//
// The list comes from `git worktree list`, run as a process with an argument list (no shell). A
// directory without git, or a machine without it, has no other working trees.

import { execFile } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { ToolError } from '../errors.js';
import { openAllowed, type AllowedFile, type UploadKind } from './uploads.js';

const GIT_TIMEOUT_MS = 10_000;
const GIT_OUTPUT_LIMIT = 1024 * 1024;

/** Environment variables that would point git at another repository than the directory's own. */
const GIT_LOCATION = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
];

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
  for (const name of GIT_LOCATION) delete env[name];
  return env;
}

function runGit(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((done) => {
    execFile(
      'git',
      [...args],
      {
        cwd,
        env: gitEnvironment(),
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_OUTPUT_LIMIT,
        windowsHide: true,
        ...(signal === undefined ? {} : { signal }),
      },
      // A failure (no git, not a repository, timeout) means there is nothing to list.
      (error, stdout) => {
        done(error === null ? stdout : '');
      },
    );
  });
}

interface Entry {
  path: string;
  /** Marked bare, locked or prunable: git itself does not vouch for the tree. */
  skipped: boolean;
}

function parseEntries(output: string): Entry[] {
  const entries: Entry[] = [];
  for (const record of output.split('\0')) {
    if (record.startsWith('worktree ')) {
      entries.push({ path: record.slice('worktree '.length), skipped: false });
    } else if (/^(bare|locked|prunable)( |$)/.test(record)) {
      const last = entries[entries.length - 1];
      if (last !== undefined) last.skipped = true;
    }
  }
  return entries;
}

function real(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Whether `tree` really is a working tree of the repository whose common git directory is
 * `common`. The listing is not trusted by itself: its entries come from files in `.git/worktrees`
 * that name any directory. A linked tree has a `.git` file pointing at its entry in
 * `<common>/worktrees/`, and that entry must point back at the same `.git` file; the main tree
 * has `.git` as the common directory itself. Nothing of the tree's own configuration is run.
 */
function belongsTo(tree: string, common: string): boolean {
  const dotGit = join(tree, '.git');
  let info;
  try {
    info = lstatSync(dotGit);
  } catch {
    return false;
  }
  if (info.isDirectory()) return real(dotGit) === common;
  if (!info.isFile()) return false;
  try {
    const pointer = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    const entry = pointer?.[1] === undefined ? undefined : real(resolve(tree, pointer[1].trim()));
    if (entry === undefined || dirname(entry) !== join(common, 'worktrees')) return false;
    const back = readFileSync(join(entry, 'gitdir'), 'utf8').trim();
    return real(resolve(entry, back)) === real(dotGit);
  } catch {
    return false;
  }
}

/**
 * Directories of the working trees of the repository `root` is in, the main one included, as real
 * paths. A tree git marks bare, locked or prunable, one whose directory is gone and one that does
 * not point back at this repository (see `belongsTo`) is left out.
 */
export async function listWorktrees(root: string, signal?: AbortSignal): Promise<string[]> {
  const gitDir = (
    await runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal)
  ).trim();
  const common = gitDir === '' ? undefined : real(gitDir);
  if (common === undefined) return [];
  // `-z`: records end with NUL, so a path with a newline in it stays one path.
  const output = await runGit(root, ['worktree', 'list', '--porcelain', '-z'], signal);
  const found = parseEntries(output)
    .filter((entry) => !entry.skipped)
    .map((entry) => real(entry.path))
    .filter((path): path is string => path !== undefined && belongsTo(path, common));
  return [...new Set(found)];
}

function contains(directory: string, path: string): boolean {
  const rel = relative(directory, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Opens a file that lies in a working tree other than the one the project directory is in. The
 * file goes through the same checks as one in the project directory, with the working tree as its
 * root. `input` is relative to the project directory or absolute.
 */
export async function openInOtherWorktree(
  root: string,
  input: string,
  kind: UploadKind,
  signal?: AbortSignal,
): Promise<AllowedFile> {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new ToolError('workspace_not_found');
  }
  const wanted = resolve(realRoot, input);
  const others = (await listWorktrees(realRoot, signal)).filter(
    (tree) => !contains(tree, realRoot),
  );
  for (const tree of others) {
    try {
      return await openAllowed(tree, wanted, kind);
    } catch (error) {
      // Not in this tree: try the next one. Any other refusal (type, size, missing) is final.
      if (!(error instanceof ToolError) || error.code !== 'path_outside_workspace') throw error;
    }
  }
  throw new ToolError('file_not_in_worktree', { params: { kind } });
}
