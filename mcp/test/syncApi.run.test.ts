// `npm run sync:api` as a whole (`scripts/sync-api.mjs`): exit codes, `--dry-run`, the token, and the
// compile errors grouped by file and tool. The project under test is a small copy of the layout
// (contracts/, mcp/src/api, mcp/src/tools) so that a real `openapi-typescript` and a real `tsc` run.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const MCP = resolve(import.meta.dirname, '..');
const SCRIPT = join(MCP, 'scripts', 'sync-api.mjs');
const FIXTURES = join(MCP, 'test', 'fixtures', 'sync-api');
const TOKEN = 'tok_5f3a9c1d_secret_value';

const ITEMS_API = `
import type { paths } from '../http/generated/api.js';

type Item = paths['/api/v1/items']['get']['responses'][200]['content']['application/json'][number];

export function priceOf(item: Item): number | undefined {
  return item.price;
}

export const list = (api: { services: { http: { GET: (path: string, init: object) => unknown } } }) =>
  api.services.http.GET('/api/v1/items', {});
`;

const REPORTS_API = `
export const reports = (api: { services: { http: { GET: (path: string, init: object) => unknown } } }) =>
  api.services.http.GET('/api/v1/reports', {});
`;

interface Project {
  readonly root: string;
  readonly mcp: string;
  readonly spec: string;
  readonly types: string;
}

const made: string[] = [];
const servers: Server[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
});

/** A project on `old.json`: its snapshot, types generated from it, and plugin sources. */
function project(old = 'old.json', api = ITEMS_API, reports = REPORTS_API): Project {
  const root = mkdtempSync(join(tmpdir(), 'lc-sync-run-'));
  made.push(root);
  const mcp = join(root, 'mcp');
  mkdirSync(join(root, 'contracts'), { recursive: true });
  mkdirSync(join(mcp, 'src', 'api'), { recursive: true });
  mkdirSync(join(mcp, 'src', 'tools'), { recursive: true });
  mkdirSync(join(mcp, 'src', 'http', 'generated'), { recursive: true });
  cpSync(join(FIXTURES, old), join(root, 'contracts', 'loadcraft-openapi.json'));
  writeFileSync(
    join(root, 'contracts', 'README.md'),
    'Source: backend at commit `aaaaaaaaa` (branch `main`).\n',
  );
  writeFileSync(join(mcp, 'package.json'), '{ "name": "x", "type": "module", "private": true }\n');
  cpSync(join(MCP, 'tsconfig.json'), join(mcp, 'tsconfig.json'));
  symlinkSync(join(MCP, 'node_modules'), join(mcp, 'node_modules'));
  writeFileSync(join(mcp, 'src', 'api', 'items.ts'), api);
  writeFileSync(join(mcp, 'src', 'api', 'reports.ts'), reports);
  writeFileSync(
    join(mcp, 'src', 'tools', 'index.ts'),
    "import { listItems } from './listItems.js';\nexport const ALL = [listItems];\n",
  );
  writeFileSync(
    join(mcp, 'src', 'tools', 'listItems.ts'),
    "import { list, priceOf } from '../api/items.js';\nexport const listItems = { list, priceOf };\n",
  );
  const spec = join(root, 'contracts', 'loadcraft-openapi.json');
  const types = join(mcp, 'src', 'http', 'generated', 'api.d.ts');
  const generated = spawnSync(
    process.execPath,
    [join(MCP, 'scripts', 'gen-api.mjs'), '--spec', spec, '--out', types],
    { encoding: 'utf8' },
  );
  expect(generated.status).toBe(0);
  return { root, mcp, spec, types };
}

function run(p: Project, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', p.root, ...args], {
    cwd: p.mcp,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...env },
    timeout: 120_000,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** Every file under `dir`, without the linked node_modules. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function fromFile(name: string): string[] {
  return ['--from-file', join(FIXTURES, name)];
}

describe('sync-api: exit codes', () => {
  it('0 and "no changes" when the source equals the snapshot', () => {
    const p = project();
    const result = run(p, fromFile('old.json'));
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/no changes|bez zmian/i);
  });

  it('0 when the changes are additive and everything compiles', () => {
    const p = project();
    const result = run(p, fromFile('additive.json'));
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('created_at');
    expect(readFileSync(p.spec, 'utf8')).toContain('"created_at"');
    expect(readFileSync(p.types, 'utf8')).toContain('created_at');
  });

  it('1 when the plugin no longer compiles, grouped by file and tool, linked to the operation', () => {
    const p = project();
    const result = run(p, fromFile('new.json'));
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain('src/api/items.ts');
    expect(result.out).toContain('list_items');
    expect(result.out).toMatch(/TS2339/);
    expect(result.out).toContain('GET /api/v1/items');
    expect(result.out).toMatch(/price/);
  });

  it('2 when a route the plugin uses changed in a breaking way but the code still compiles', () => {
    const p = project(
      'old.json',
      `${ITEMS_API.split('export function priceOf')[0]}
export function priceOf(): undefined { return undefined; }
export const list = (api: { services: { http: { GET: (path: string, init: object) => unknown } } }) =>
  api.services.http.GET('/api/v1/items', {});
`,
    );
    const result = run(p, fromFile('new.json'));
    expect(result.code, result.out).toBe(2);
    expect(result.out).toMatch(/used by the plugin|używane przez plugin/i);
  });

  it('removed operations the plugin does not use are listed apart and do not change the code', () => {
    const p = project(
      'old.json',
      'export const list = 1;\nexport const priceOf = 2;\n',
      'export {};\n',
    );
    const result = run(p, fromFile('new.json'));
    expect(result.out).toContain('GET /api/v1/reports');
    expect(result.out).toMatch(/not used by the plugin|nieużywane przez plugin/i);
    expect(result.code, result.out).toBe(0);
  });

  it('the commit and branch of the source are printed only: no file of the project records them', () => {
    const p = project();
    const sha = 'b7c3e9a1f04d';
    const result = run(p, [
      ...fromFile('additive.json'),
      '--source-commit',
      sha,
      '--source-branch',
      'feature-x',
    ]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain(sha);
    const holding = filesUnder(p.root).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes(sha.slice(0, 9)) || text.includes('feature-x');
    });
    expect(holding).toEqual([]);
    const readme = readFileSync(join(p.root, 'contracts', 'README.md'), 'utf8');
    expect(readme).toBe('Source: backend at commit `aaaaaaaaa` (branch `main`).\n');
  });
});

describe('sync-api: --dry-run', () => {
  it('writes nothing, yet still reports the changes and the compile errors', () => {
    const p = project();
    const before = [p.spec, p.types, join(p.root, 'contracts', 'README.md')].map((file) =>
      readFileSync(file, 'utf8'),
    );
    const result = run(p, [...fromFile('new.json'), '--dry-run', '--source-commit', 'bbbbbbbbb']);
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain('src/api/items.ts');
    const after = [p.spec, p.types, join(p.root, 'contracts', 'README.md')].map((file) =>
      readFileSync(file, 'utf8'),
    );
    expect(after).toEqual(before);
    expect(existsSync(join(p.mcp, 'src', 'http', 'generated', 'api.d.ts.tmp'))).toBe(false);
  });
});

describe('sync-api: --from-url and the token', () => {
  function backend(spec: string, seen: { auth: string | undefined }): Promise<string> {
    const body = readFileSync(join(FIXTURES, spec), 'utf8');
    const server = createServer((request, response) => {
      seen.auth = request.headers.authorization;
      if (request.url === '/openapi.json') {
        response.setHeader('content-type', 'application/json');
        response.end(body);
      } else {
        response.statusCode = 404;
        response.end(`not here, token ${TOKEN}`);
      }
    });
    servers.push(server);
    return new Promise((done) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        done(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`);
      });
    });
  }

  it('sends the token from the environment as a bearer and never prints it', async () => {
    const seen = { auth: undefined as string | undefined };
    const url = await backend('additive.json', seen);
    const p = project();
    const result = await runAsync(p, ['--from-url', url, '--dry-run'], {
      LOADCRAFT_API_TOKEN: TOKEN,
    });
    expect(result.code, result.out).toBe(0);
    expect(seen.auth).toBe(`Bearer ${TOKEN}`);
    expect(result.out).not.toContain(TOKEN);
    expect(result.out).toContain('created_at');
  });

  it('does not print the token when the backend echoes it in an error', async () => {
    const seen = { auth: undefined as string | undefined };
    const url = await backend('additive.json', seen);
    const p = project();
    const result = await runAsync(p, ['--from-url', `${url}/nope`, '--dry-run'], {
      LOADCRAFT_API_TOKEN: TOKEN,
    });
    expect(result.code).toBe(3);
    expect(result.out).not.toContain(TOKEN);
  });
});

function runAsync(p: Project, args: string[], env: Record<string, string>) {
  // The fake backend lives in this process, so the script must run without blocking the event loop.
  return new Promise<{ code: number | null; out: string }>((done) => {
    void import('node:child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, [SCRIPT, '--root', p.root, ...args], {
        cwd: p.mcp,
        env: { PATH: process.env['PATH'] ?? '', ...env },
      });
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
      child.on('close', (code) => done({ code, out }));
    });
  });
}

describe('sync-api: operations the public snapshot leaves out', () => {
  it('drops dev-login and the schema only it used on import, so the snapshot stays as it was', () => {
    const p = project();
    const source = JSON.parse(readFileSync(join(FIXTURES, 'old.json'), 'utf8')) as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };
    source.paths['/api/v1/auth/dev-login'] = {
      post: {
        operationId: 'dev_login_api_v1_auth_dev_login_post',
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DevLoginBody' } },
          },
        },
        responses: { '200': { description: 'Session for any user.' } },
      },
    };
    source.components = {
      ...source.components,
      schemas: {
        ...source.components?.schemas,
        DevLoginBody: { type: 'object', properties: { user_id: { type: 'string' } } },
      },
    };
    const file = join(p.root, 'with-dev-login.json');
    writeFileSync(file, JSON.stringify(source));
    const before = readFileSync(p.spec, 'utf8');
    const result = run(p, ['--from-file', file]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/no changes|bez zmian/i);
    const after = readFileSync(p.spec, 'utf8');
    expect(after).toBe(before);
    expect(after).not.toContain('dev-login');
    expect(after).not.toContain('DevLoginBody');
  });
});
