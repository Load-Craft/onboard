import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolError } from '../src/errors.js';
import { listWorktrees, openInOtherWorktree } from '../src/workspace/worktrees.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'ignore' });
}

let base: string;
/** A repository whose project directory is a sub-directory, and a second working tree of it. */
let repo: string;
let project: string;
let tree: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lc-worktrees-')));
  repo = join(base, 'sklep');
  project = join(repo, 'app');
  mkdirSync(project, { recursive: true });
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'openapi.json'), '{}');
  writeFileSync(join(project, 'openapi.json'), '{}');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  tree = join(base, 'sklep-qa');
  git(repo, 'worktree', 'add', '-q', '-b', 'qa', tree);
  writeFileSync(join(tree, 'openapi.json'), '{}');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof ToolError ? error.code : String(error);
  }
};

describe('listWorktrees', () => {
  it('lists the main tree and the linked ones as real paths', async () => {
    expect((await listWorktrees(project)).sort()).toEqual([realpathSync(tree), repo].sort());
  });

  it('is empty outside a repository', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'lc-nogit-')));
    try {
      expect(await listWorktrees(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('leaves out a tree whose directory is gone', async () => {
    rmSync(tree, { recursive: true, force: true });
    expect(await listWorktrees(project)).toEqual([repo]);
  });
});

/** What an attacker with write access to `.git` can do: name any directory as a working tree. */
function forge(victim: string, entry: string, gitFile?: string): void {
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, 'credentials.json'), '{"token":"x"}');
  const meta = join(repo, '.git', 'worktrees', entry);
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, 'gitdir'), `${join(victim, '.git')}\n`);
  writeFileSync(join(meta, 'HEAD'), 'ref: refs/heads/qa\n');
  writeFileSync(join(meta, 'commondir'), '../..\n');
  if (gitFile !== undefined) writeFileSync(join(victim, '.git'), gitFile);
}

describe('a forged registration', () => {
  it('is not taken for a working tree when the directory has no .git', async () => {
    const victim = join(base, 'victim');
    forge(victim, 'evil');
    expect(await listWorktrees(project)).not.toContain(realpathSync(victim));
    expect(
      await codeOf(openInOtherWorktree(project, join(victim, 'credentials.json'), 'openapi')),
    ).toBe('file_not_in_worktree');
  });

  it('is not taken for one when .git points at another repository', async () => {
    const other = join(base, 'other');
    mkdirSync(other);
    git(other, 'init', '-q');
    const victim = join(base, 'victim');
    forge(victim, 'evil', `gitdir: ${join(other, '.git', 'worktrees', 'evil')}\n`);
    expect(await listWorktrees(project)).not.toContain(realpathSync(victim));
  });

  it('is not taken for one when .git is a directory of its own', async () => {
    const victim = join(base, 'victim');
    forge(victim, 'evil');
    mkdirSync(join(victim, '.git'));
    expect(await listWorktrees(project)).not.toContain(realpathSync(victim));
  });

  it('is not taken for one when its entry does not point back at the .git file', async () => {
    const victim = join(base, 'victim');
    forge(victim, 'evil', `gitdir: ${join(repo, '.git', 'worktrees', 'evil')}\n`);
    writeFileSync(
      join(repo, '.git', 'worktrees', 'evil', 'gitdir'),
      `${join(base, 'x', '.git')}\n`,
    );
    expect(await listWorktrees(project)).not.toContain(realpathSync(victim));
  });
});

describe('a tree git does not vouch for', () => {
  it('is left out when it is locked', async () => {
    git(repo, 'worktree', 'lock', tree);
    expect(await listWorktrees(project)).toEqual([repo]);
  });
});

describe('openInOtherWorktree', () => {
  it('opens a file of another working tree, by an absolute or a relative path', async () => {
    const absolute = await openInOtherWorktree(project, join(tree, 'openapi.json'), 'openapi');
    expect(absolute.path).toBe(join(realpathSync(tree), 'openapi.json'));
    const relative = await openInOtherWorktree(project, '../../sklep-qa/openapi.json', 'openapi');
    expect(relative.path).toBe(absolute.path);
  });

  it('does not let in a file of the tree the project directory is in', async () => {
    expect(await codeOf(openInOtherWorktree(project, join(repo, 'openapi.json'), 'openapi'))).toBe(
      'file_not_in_worktree',
    );
  });

  it('refuses a file outside every working tree', async () => {
    writeFileSync(join(base, 'openapi.json'), '{}');
    expect(await codeOf(openInOtherWorktree(project, join(base, 'openapi.json'), 'openapi'))).toBe(
      'file_not_in_worktree',
    );
  });

  it('refuses a link inside a working tree that leads out of it', async () => {
    writeFileSync(join(base, 'secret.json'), '{}');
    symlinkSync(join(base, 'secret.json'), join(tree, 'link.json'));
    expect(await codeOf(openInOtherWorktree(project, join(tree, 'link.json'), 'openapi'))).toBe(
      'file_not_in_worktree',
    );
  });

  it('keeps the type rule of the kind: a file that is not .json is refused as such', async () => {
    writeFileSync(join(tree, 'openapi.yaml'), 'openapi: 3.0.3');
    expect(await codeOf(openInOtherWorktree(project, join(tree, 'openapi.yaml'), 'openapi'))).toBe(
      'unsupported_file_type',
    );
  });

  it('reports a missing file of a working tree as missing', async () => {
    expect(await codeOf(openInOtherWorktree(project, join(tree, 'gone.json'), 'openapi'))).toBe(
      'file_not_found',
    );
  });

  it('finds no other tree without git', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'lc-nogit-')));
    try {
      expect(
        await codeOf(openInOtherWorktree(outside, join(tree, 'openapi.json'), 'openapi')),
      ).toBe('file_not_in_worktree');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
