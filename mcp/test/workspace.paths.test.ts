import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from '../src/errors.js';
import { toToolError } from '../src/http/errors.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { resolveInside } from '../src/workspace/paths.js';
import { openAllowed, openAllowedForUpload, readTextAllowed } from '../src/workspace/uploads.js';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lc-ws-')));
  root = join(base, 'project');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'api.json'), '{"openapi":"3.0.0"}');
  writeFileSync(join(root, 'sub', 'notes.md'), '# Notes');
  writeFileSync(join(outside, 'secret.json'), '{"secret":true}');
  writeFileSync(join(outside, 'id_rsa'), 'PRIVATE');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): ToolError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error('expected ToolError');
}

async function asyncCodeOf(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error('expected ToolError');
}

function expectNoAbsolutePath(error: ToolError): void {
  const text = JSON.stringify([error.message, error.hint, error.details]);
  expect(text).not.toContain(base);
  expect(text).not.toContain(tmpdir());
}

describe('resolveInside', () => {
  it('resolves relative and absolute paths inside the root', () => {
    expect(resolveInside(root, 'api.json')).toBe(join(root, 'api.json'));
    expect(resolveInside(root, './sub/../sub/notes.md')).toBe(join(root, 'sub', 'notes.md'));
    expect(resolveInside(root, join(root, 'api.json'))).toBe(join(root, 'api.json'));
  });

  it('rejects ../ escapes', () => {
    const error = codeOf(() => resolveInside(root, '../outside/secret.json'));
    expect(error.code).toBe('path_outside_workspace');
    expectNoAbsolutePath(error);
  });

  it('rejects absolute paths outside the root', () => {
    const error = codeOf(() => resolveInside(root, join(outside, 'secret.json')));
    expect(error.code).toBe('path_outside_workspace');
    expectNoAbsolutePath(error);
  });

  it('does not treat a sibling with the same prefix as inside', () => {
    mkdirSync(join(base, 'project-evil'));
    writeFileSync(join(base, 'project-evil', 'a.json'), '{}');
    const error = codeOf(() => resolveInside(root, join(base, 'project-evil', 'a.json')));
    expect(error.code).toBe('path_outside_workspace');
  });

  it('does not reveal whether a missing path outside the root exists', () => {
    const error = codeOf(() => resolveInside(root, join(outside, 'nope.json')));
    expect(error.code).toBe('path_outside_workspace');
  });

  it('rejects a symlink pointing outside the root', () => {
    symlinkSync(join(outside, 'secret.json'), join(root, 'link.json'));
    const error = codeOf(() => resolveInside(root, 'link.json'));
    expect(error.code).toBe('path_outside_workspace');
    expectNoAbsolutePath(error);
  });

  it('rejects a file reached through a symlinked directory pointing outside', () => {
    symlinkSync(outside, join(root, 'dir-link'));
    const error = codeOf(() => resolveInside(root, 'dir-link/secret.json'));
    expect(error.code).toBe('path_outside_workspace');
  });

  it('allows a symlink that stays inside the root and returns the real path', () => {
    symlinkSync(join(root, 'api.json'), join(root, 'alias.json'));
    expect(resolveInside(root, 'alias.json')).toBe(join(root, 'api.json'));
  });

  it('works when the root itself is reached through a symlink', () => {
    const rootLink = join(base, 'root-link');
    symlinkSync(root, rootLink);
    expect(resolveInside(rootLink, 'api.json')).toBe(join(root, 'api.json'));
  });

  it('reports a missing file with the relative path only', () => {
    const error = codeOf(() => resolveInside(root, 'sub/missing.json'));
    expect(error.code).toBe('file_not_found');
    expect(error.params).toEqual({ file: 'sub/missing.json' });
    expectNoAbsolutePath(error);
  });

  it('reports a missing absolute path inside the root as relative', () => {
    const error = codeOf(() => resolveInside(root, join(root, 'missing.json')));
    expect(error.code).toBe('file_not_found');
    expect(error.params).toEqual({ file: 'missing.json' });
    expectNoAbsolutePath(error);
  });
});

describe('openAllowed', () => {
  it('opens an allowed file and describes it', async () => {
    const file = await openAllowed(root, 'api.json', 'openapi');
    expect(file).toMatchObject({
      kind: 'openapi',
      path: join(root, 'api.json'),
      name: 'api.json',
      size: 19,
    });
  });

  it.each([
    ['openapi', 'api.json'],
    ['asyncapi', 'api.json'],
    ['har', 'rec.har'],
    ['overview', 'sub/notes.md'],
    ['accounts', 'acc.csv'],
  ] as const)('accepts the %s kind for %s', async (kind, name) => {
    writeFileSync(join(root, 'rec.har'), '{}');
    writeFileSync(join(root, 'acc.csv'), 'a,b');
    await expect(openAllowed(root, name, kind)).resolves.toMatchObject({ kind });
  });

  it('matches extensions case-insensitively', async () => {
    writeFileSync(join(root, 'API.JSON'), '{}');
    await expect(openAllowed(root, 'API.JSON', 'openapi')).resolves.toMatchObject({
      kind: 'openapi',
    });
  });

  it.each(['id_rsa', '.env', 'api.json.bak', 'api.yaml', 'notes.md'])(
    'rejects the wrong extension: %s',
    async (name) => {
      writeFileSync(join(root, name), 'x');
      const error = await asyncCodeOf(openAllowed(root, name, 'openapi'));
      expect(error.code).toBe('unsupported_file_type');
      expectNoAbsolutePath(error);
    },
  );

  it('rejects a file outside the root before looking at its type', async () => {
    const error = await asyncCodeOf(openAllowed(root, '../outside/id_rsa', 'openapi'));
    expect(error.code).toBe('path_outside_workspace');
  });

  it('rejects a file over the limit and states the limit', async () => {
    writeFileSync(join(root, 'big.md'), Buffer.alloc(64 * 1024 + 1, 'a'));
    const error = await asyncCodeOf(openAllowed(root, 'big.md', 'overview'));
    expect(error.code).toBe('file_too_large');
    expect(error.params).toEqual({ file: 'big.md', limit: '64 KB' });
    expectNoAbsolutePath(error);
  });

  it('accepts a file exactly at the limit', async () => {
    writeFileSync(join(root, 'edge.md'), Buffer.alloc(64 * 1024, 'a'));
    await expect(openAllowed(root, 'edge.md', 'overview')).resolves.toMatchObject({ size: 65536 });
  });

  it('rejects a directory', async () => {
    mkdirSync(join(root, 'dir.json'));
    const error = await asyncCodeOf(openAllowed(root, 'dir.json', 'openapi'));
    expect(error.code).toBe('not_a_file');
    expectNoAbsolutePath(error);
  });

  it('rejects a special file', async () => {
    execFileSync('mkfifo', [join(root, 'pipe.json')]);
    const error = await asyncCodeOf(openAllowed(root, 'pipe.json', 'openapi'));
    expect(error.code).toBe('not_a_file');
  });

  it('reports a missing file', async () => {
    const error = await asyncCodeOf(openAllowed(root, 'nope.json', 'openapi'));
    expect(error.code).toBe('file_not_found');
  });

  it('cannot be forged outside the module', async () => {
    const forged = { kind: 'openapi', path: join(outside, 'secret.json'), name: 'x', size: 1 };
    // @ts-expect-error a plain object is not an AllowedFile (private brand)
    const attempt = readTextAllowed(forged);
    const error = await asyncCodeOf(attempt);
    expect(error.code).toBe('file_not_allowed');
  });
});

describe('readTextAllowed', () => {
  it('reads UTF-8 text', async () => {
    writeFileSync(join(root, 'sub', 'notes.md'), 'Zażółć gęślą jaźń');
    const file = await openAllowed(root, 'sub/notes.md', 'overview');
    await expect(readTextAllowed(file)).resolves.toBe('Zażółć gęślą jaźń');
  });

  it('strips a UTF-8 BOM', async () => {
    writeFileSync(
      join(root, 'bom.csv'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b')]),
    );
    const file = await openAllowed(root, 'bom.csv', 'accounts');
    await expect(readTextAllowed(file)).resolves.toBe('a,b');
  });

  it('rejects invalid UTF-8', async () => {
    writeFileSync(join(root, 'bad.md'), Buffer.from([0xff, 0xfe, 0x41]));
    const file = await openAllowed(root, 'bad.md', 'overview');
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_encoding_invalid');
  });

  it('refuses the binary-style har kind', async () => {
    writeFileSync(join(root, 'rec.har'), '{}');
    const file = await openAllowed(root, 'rec.har', 'har');
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('unsupported_file_type');
  });

  it('re-checks the limit if the file grew after it was opened', async () => {
    const file = await openAllowed(root, 'sub/notes.md', 'overview');
    writeFileSync(join(root, 'sub', 'notes.md'), Buffer.alloc(64 * 1024 + 1, 'a'));
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_too_large');
  });

  it('refuses a file swapped for a symlink to the outside after opening', async () => {
    const file = await openAllowed(root, 'api.json', 'openapi');
    rmSync(join(root, 'api.json'));
    symlinkSync(join(outside, 'secret.json'), join(root, 'api.json'));
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('path_outside_workspace');
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('refuses a file swapped for another inside file after opening', async () => {
    writeFileSync(join(root, 'other.json'), '{"other":true}');
    const file = await openAllowed(root, 'api.json', 'openapi');
    renameSync(join(root, 'other.json'), join(root, 'api.json'));
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_changed');
  });

  it('fails fast when the file is swapped for a FIFO after opening', async () => {
    const file = await openAllowed(root, 'api.json', 'openapi');
    rmSync(join(root, 'api.json'));
    execFileSync('mkfifo', [join(root, 'api.json')]);
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('not_a_file');
  }, 2000);

  it('reports file_not_found when the file vanishes after opening', async () => {
    const file = await openAllowed(root, 'api.json', 'openapi');
    rmSync(join(root, 'api.json'));
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_not_found');
  });
});

describe('NUL in paths', () => {
  it('rejects a path with NUL without echoing it', () => {
    const error = codeOf(() => resolveInside(root, 'ok.json\0.json'));
    expect(error.code).toBe('file_not_found');
    expect(JSON.stringify(error.message)).not.toContain('\\u0000');
    expect(error.message).not.toContain('\0');
  });
});

describe('errors of a file that was replaced after the check', () => {
  const t = createTranslator('en');

  async function replacedByDirectory(): Promise<Awaited<ReturnType<typeof openAllowed>>> {
    const file = await openAllowed(root, 'sub/notes.md', 'overview');
    rmSync(join(root, 'sub', 'notes.md'));
    mkdirSync(join(root, 'sub', 'notes.md'));
    return file;
  }

  it('readTextAllowed names the file in not_a_file', async () => {
    const file = await replacedByDirectory();
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('not_a_file');
    expect(error.params).toEqual({ file: 'sub/notes.md' });
    expect(toToolError(error, t).message).toBe('sub/notes.md is not a regular file.');
  });

  it('openAllowedForUpload names the file in not_a_file', async () => {
    const file = await replacedByDirectory();
    const error = await asyncCodeOf(openAllowedForUpload(file));
    expect(error.code).toBe('not_a_file');
    expect(error.params).toEqual({ file: 'sub/notes.md' });
    expect(toToolError(error, t).message).toBe('sub/notes.md is not a regular file.');
  });

  it('a swapped file keeps its name in file_changed and the text carries no slot', async () => {
    const file = await openAllowed(root, 'sub/notes.md', 'overview');
    writeFileSync(join(root, 'sub', 'other.md'), 'other');
    renameSync(join(root, 'sub', 'other.md'), join(root, 'sub', 'notes.md'));
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_changed');
    expect(toToolError(error, t).message).toBe('sub/notes.md changed after it was checked.');
  });

  it('keeps no cause of a decoding failure, so no content can follow it', async () => {
    writeFileSync(join(root, 'bad.md'), Buffer.from([0xff, 0xfe, 0x41]));
    const file = await openAllowed(root, 'bad.md', 'overview');
    const error = await asyncCodeOf(readTextAllowed(file));
    expect(error.code).toBe('file_encoding_invalid');
    expect(error.cause).toBeUndefined();
  });
});
