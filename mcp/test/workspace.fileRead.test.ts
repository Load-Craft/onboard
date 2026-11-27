import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { openNoFollow } from '../src/workspace/fileRead.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-fr-'));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'real.txt'), 'x');
  symlinkSync(join(dir, 'real.txt'), join(dir, 'sub', 'link.txt'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openNoFollow', () => {
  it('opens a regular file', async () => {
    const handle = await openNoFollow(join(dir, 'real.txt'), 'real.txt');
    await handle.close();
  });

  it('refuses a final symlink, even one pointing at a file inside the directory', async () => {
    const error = await openNoFollow(join(dir, 'sub', 'link.txt'), 'sub/link.txt').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe('file_changed');
    expect((error as ToolError).params).toEqual({ file: 'sub/link.txt' });
  });

  it('reports a missing file with its name', async () => {
    const error = await openNoFollow(join(dir, 'nope'), 'nope').catch((e: unknown) => e);
    expect((error as ToolError).code).toBe('file_not_found');
    expect((error as ToolError).params).toEqual({ file: 'nope' });
  });
});
