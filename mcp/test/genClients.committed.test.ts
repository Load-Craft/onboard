// The committed generated files are what the generator makes of the committed contracts, and the
// hand-written channel addresses of the plugin are the generated ones (`npm run check:clients`
// does the first check from the command line).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = join(resolve(import.meta.dirname, '..'), 'scripts', 'gen-clients.mjs');

describe('generated clients are current', () => {
  it.each(['api', 'ws'])(
    'the %s half matches its contract',
    (half) => {
      const result = spawnSync(process.execPath, [SCRIPT, '--check', '--only', half], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
    60_000,
  );
});

describe('a stale file names its client', () => {
  it.each([
    ['REST client', 'gen:api', ['gen-api.mjs', '--check', '--out']],
    ['WebSocket client', 'gen:ws', ['gen-clients.mjs', '--only', 'ws', '--check', '--out-ws']],
  ])(
    '%s: exit 1 and %s in the message',
    (name, command, args) => {
      const dir = mkdtempSync(join(tmpdir(), 'lc-stale-'));
      try {
        const stale = join(dir, 'stale.ts');
        writeFileSync(stale, '// old\n');
        const [script = '', ...rest] = args;
        const result = spawnSync(
          process.execPath,
          [join(dirname(SCRIPT), script), ...rest, stale],
          {
            encoding: 'utf8',
            timeout: 60_000,
          },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(name);
        expect(result.stderr).toContain(`npm run ${command}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});

describe('the two generators are independent', () => {
  function broken(): { dir: string; asyncapi: string } {
    const dir = mkdtempSync(join(tmpdir(), 'lc-broken-'));
    const asyncapi = join(dir, 'broken.asyncapi.json');
    const doc = JSON.parse(
      readFileSync(
        join(dirname(SCRIPT), '..', 'test', 'fixtures', 'gen-clients', 'mini.asyncapi.json'),
        'utf8',
      ),
    ) as { components: { messages: Record<string, { payload: Record<string, unknown> }> } };
    const message = doc.components.messages['OrdersFailed'];
    if (message === undefined) throw new Error('fixture');
    message.payload['oneOf'] = [{ type: 'string' }];
    writeFileSync(asyncapi, JSON.stringify(doc));
    return { dir, asyncapi };
  }

  it('a broken AsyncAPI document fails gen:ws only, with a message that names it', () => {
    const { dir, asyncapi } = broken();
    try {
      const outApi = join(dir, 'api.d.ts');
      const outWs = join(dir, 'channels.ts');
      const result = spawnSync(
        process.execPath,
        [SCRIPT, '--asyncapi', asyncapi, '--out-api', outApi, '--out-ws', outWs],
        { encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`gen:ws: ${asyncapi}: `);
      expect(result.stderr).toContain('OrdersFailed');
      expect(result.stderr).toContain('gen:clients: gen:api ok, gen:ws FAILED');
      expect(readFileSync(outApi, 'utf8')).toContain('export interface paths');
      expect(existsSync(outWs)).toBe(false);

      const apiOnly = spawnSync(
        process.execPath,
        [SCRIPT, '--only', 'api', '--asyncapi', asyncapi, '--out-api', outApi],
        { encoding: 'utf8', timeout: 60_000 },
      );
      expect(apiOnly.status).toBe(0);
      expect(apiOnly.stderr).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('a broken OpenAPI document fails gen:api only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-broken-'));
    try {
      const openapi = join(dir, 'broken.openapi.json');
      writeFileSync(openapi, '{ not json');
      const outWs = join(dir, 'channels.ts');
      const result = spawnSync(
        process.execPath,
        [SCRIPT, '--openapi', openapi, '--out-api', join(dir, 'api.d.ts'), '--out-ws', outWs],
        { encoding: 'utf8', timeout: 60_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`gen:api: ${openapi}: `);
      expect(result.stderr).toContain('gen:clients: gen:api FAILED, gen:ws ok');
      expect(readFileSync(outWs, 'utf8')).toContain('export const CHANNELS');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('command line', () => {
  it('refuses an unknown --only value', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--only', 'rest'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--only');
    expect(result.stderr).toContain('api');
    expect(result.stderr).toContain('ws');
  });

  it('names the document it was really given in an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-arg-'));
    try {
      const file = join(dir, 'mine.asyncapi.json');
      writeFileSync(file, '{ nope');
      const result = spawnSync(
        process.execPath,
        [SCRIPT, '--only', 'ws', '--asyncapi', file, '--out-ws', join(dir, 'c.ts')],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`gen:ws: ${file}: `);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a header that names the command that regenerates the file', () => {
    expect(
      readFileSync(join(dirname(SCRIPT), '..', 'src', 'ws', 'generated', 'channels.ts'), 'utf8'),
    ).toContain('npm run gen:ws');
  });
});
