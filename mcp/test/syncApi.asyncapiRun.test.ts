// `npm run sync:api` with an AsyncAPI source: the WebSocket document goes through the same steps as
// the OpenAPI one (snapshot, generated types, change report, type-check, exit code). The project is
// a small copy of the layout with one channel, so a real generator and a real `tsc` run.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AsyncApiDocument, Schema } from '../scripts/gen-clients/model.js';
import mini from './fixtures/gen-clients/mini.asyncapi.json' with { type: 'json' };

// Each run starts a node process, generates types and runs tsc.
vi.setConfig({ testTimeout: 60_000 });

const MCP = resolve(import.meta.dirname, '..');
const SCRIPT = join(MCP, 'scripts', 'sync-api.mjs');
const MINI = mini as unknown as AsyncApiDocument;

/** The plugin reads `order_id` and `progress` of orders:progress and lists `eta_seconds` as used. */
const SURFACE = {
  channels: {
    orders: {
      server: [
        {
          type: 'orders:progress',
          keys: [
            { name: 'order_id', required: true },
            { name: 'progress', required: true },
            { name: 'eta_seconds', required: false },
          ],
        },
      ],
      client: [],
    },
  },
};

const READER = `
import * as z from 'zod';

import { readsTable } from '../contract/reads.js';

export const ordersReaders = readsTable<'orders'>()({
  'orders:progress': z.looseObject({ order_id: z.string(), progress: z.number().int() }),
});
`;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Project {
  readonly root: string;
  readonly mcp: string;
  readonly snapshot: string;
  readonly types: string;
}

function project(): Project {
  const root = mkdtempSync(join(tmpdir(), 'lc-sync-async-'));
  made.push(root);
  const mcp = join(root, 'mcp');
  const contracts = join(root, 'contracts');
  for (const dir of ['src/ws/generated', 'src/http/generated', 'src/contract', 'src/api']) {
    mkdirSync(join(mcp, dir), { recursive: true });
  }
  mkdirSync(contracts, { recursive: true });
  cpSync(
    join(MCP, 'test', 'fixtures', 'sync-api', 'old.json'),
    join(contracts, 'loadcraft-openapi.json'),
  );
  writeFileSync(join(contracts, 'loadcraft-asyncapi.json'), `${JSON.stringify(MINI, null, 2)}\n`);
  writeFileSync(join(contracts, 'ws-frames.json'), JSON.stringify(SURFACE));
  writeFileSync(join(mcp, 'package.json'), '{ "name": "x", "type": "module", "private": true }\n');
  cpSync(join(MCP, 'tsconfig.json'), join(mcp, 'tsconfig.json'));
  cpSync(join(MCP, 'src', 'contract', 'reads.ts'), join(mcp, 'src', 'contract', 'reads.ts'));
  writeFileSync(join(mcp, 'src', 'ws', 'readers.ts'), READER);
  symlinkSync(join(MCP, 'node_modules'), join(mcp, 'node_modules'));
  const api = spawnSync(
    process.execPath,
    [
      join(MCP, 'scripts', 'gen-clients.mjs'),
      '--openapi',
      join(contracts, 'loadcraft-openapi.json'),
      '--asyncapi',
      join(contracts, 'loadcraft-asyncapi.json'),
      '--out-api',
      join(mcp, 'src', 'http', 'generated', 'api.d.ts'),
      '--out-ws',
      join(mcp, 'src', 'ws', 'generated', 'channels.ts'),
    ],
    { encoding: 'utf8' },
  );
  expect(api.status, api.stderr).toBe(0);
  return {
    root,
    mcp,
    snapshot: join(contracts, 'loadcraft-asyncapi.json'),
    types: join(mcp, 'src', 'ws', 'generated', 'channels.ts'),
  };
}

function run(p: Project, args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', p.root, ...args], {
    cwd: p.mcp,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '' },
    timeout: 120_000,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** A copy of the mini document, edited, written where the test can hand it to `--asyncapi-from-file`. */
function source(p: Project, edit: (doc: AsyncApiDocument) => void): string[] {
  const doc = structuredClone(MINI);
  edit(doc);
  const file = join(p.root, 'incoming.asyncapi.json');
  writeFileSync(file, JSON.stringify(doc));
  return ['--asyncapi-from-file', file];
}

function progressBody(doc: AsyncApiDocument): Record<string, Schema> {
  const properties =
    doc.components.messages['OrdersProgress']?.payload.properties?.['payload']?.properties;
  if (properties === undefined) throw new Error('fixture');
  return properties;
}

describe('sync-api with an AsyncAPI source', () => {
  it('0 and no changes when the source equals the snapshot', () => {
    const p = project();
    const result = run(
      p,
      source(p, () => undefined),
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toContain('WebSocket API changes: no frame or key changes');
    expect(result.out).toContain('typecheck: ok');
  });

  it('0 for an added key; the snapshot and the generated types follow', () => {
    const p = project();
    const result = run(
      p,
      source(p, (doc) => void (progressBody(doc)['warehouse'] = { type: 'string' })),
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).toMatch(/\[additive\] orders orders:progress warehouse: key added/);
    expect(readFileSync(p.snapshot, 'utf8')).toContain('"warehouse"');
    expect(readFileSync(p.types, 'utf8')).toContain('warehouse?: string');
  });

  it('1 when a key a reader reads is gone: tsc names the reader file', () => {
    const p = project();
    const result = run(
      p,
      source(p, (doc) => void delete progressBody(doc)['progress']),
    );
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain('src/ws/readers.ts');
    expect(result.out).toContain('.progress: not in the contract');
    expect(result.out).toContain('WebSocket client: exit 1 (does not compile)');
    expect(result.out).toContain('REST client: exit 0');
    expect(result.out).toMatch(/\[BREAKING\] orders orders:progress progress: key removed/);
  });

  it('2 when a key the plugin lists but no reader reads is gone', () => {
    const p = project();
    const result = run(
      p,
      source(p, (doc) => void delete progressBody(doc)['eta_seconds']),
    );
    expect(result.code, result.out).toBe(2);
    expect(result.out).toContain('Used by the plugin: 1');
    expect(result.out).toContain('WebSocket client: exit 2');
    expect(result.out).toContain('eta_seconds: key removed');
  });

  it('--dry-run reports the same and writes nothing', () => {
    const p = project();
    const before = [p.snapshot, p.types].map((file) => readFileSync(file, 'utf8'));
    const result = run(p, [
      ...source(p, (doc) => void delete progressBody(doc)['progress']),
      '--dry-run',
    ]);
    expect(result.code, result.out).toBe(1);
    expect([p.snapshot, p.types].map((file) => readFileSync(file, 'utf8'))).toEqual(before);
  });

  it('3 for a file that is not an AsyncAPI 3 document', () => {
    const p = project();
    const file = join(p.root, 'not.json');
    writeFileSync(file, '{"openapi":"3.1.0","paths":{}}');
    const result = run(p, ['--asyncapi-from-file', file]);
    expect(result.code, result.out).toBe(3);
    expect(result.out).toContain('is not an AsyncAPI 3 document');
  });

  it('the REST half owns src/api and src/contract: a reader file that no longer compiles is "REST client: exit 1"', () => {
    const p = project();
    writeFileSync(
      join(p.mcp, 'src', 'api', 'orders.ts'),
      "import { reads, type ResponseOf } from '../contract/reads.js';\nimport * as z from 'zod';\nexport const row = reads<ResponseOf<'/api/v1/items', 'get'>>()(z.object({ gone: z.string() }));\n",
    );
    const result = run(
      p,
      source(p, () => undefined),
    );
    expect(result.code, result.out).toBe(1);
    expect(result.out).toContain('src/api/orders.ts');
    expect(result.out).toContain('REST client: exit 1 (does not compile)');
    expect(result.out).toContain('WebSocket client: exit 0');
  });

  it('writes x-nullable as the standard type list [T, "null"]', () => {
    const p = project();
    const result = run(
      p,
      source(p, (doc) => {
        const body = progressBody(doc);
        body['eta_seconds'] = { type: 'number', 'x-nullable': true };
        body['warehouse'] = { type: 'string', enum: ['north', 'south'], 'x-nullable': true };
      }),
    );
    expect(result.code, result.out).toBe(0);
    const written = progressBody(JSON.parse(readFileSync(p.snapshot, 'utf8')) as AsyncApiDocument);
    expect(written['eta_seconds']).toEqual({ type: ['number', 'null'] });
    expect(written['warehouse']).toEqual({
      type: ['string', 'null'],
      enum: ['north', 'south', null],
    });
    expect(readFileSync(p.snapshot, 'utf8')).not.toContain('x-nullable');
    expect(readFileSync(p.types, 'utf8')).toMatch(/warehouse\?: \(?"north" \| "south"\)? \| null/);
  });

  it('x-nullable in the source is no change when the snapshot says [T, "null"]', () => {
    const p = project();
    const before = readFileSync(p.snapshot, 'utf8');
    const result = run(
      p,
      source(
        p,
        (doc) => void (progressBody(doc)['eta_seconds'] = { type: 'number', 'x-nullable': true }),
      ),
    );
    expect(result.code, result.out).toBe(0);
    expect(result.out).not.toContain('written:');
    expect(readFileSync(p.snapshot, 'utf8')).toBe(before);
  });

  it('is idempotent: the same document written another way is no change and writes nothing', () => {
    const p = project();
    const before = readFileSync(p.snapshot, 'utf8');
    // Another key order and a whole number spelled like Python writes a float (10.0 parses to 10).
    const doc = JSON.parse(before) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    const file = join(p.root, 'again.asyncapi.json');
    const text = JSON.stringify(reordered).replace('"progress":10', '"progress":10.0');
    expect(text).toContain('"progress":10.0');
    writeFileSync(file, text);
    const result = run(p, ['--asyncapi-from-file', file]);
    expect(result.code, result.out).toBe(0);
    expect(result.out).not.toContain('written:');
    expect(readFileSync(p.snapshot, 'utf8')).toBe(before);
  });

  it('one half failing does not stop the other and leaves its own files as they were', () => {
    const p = project();
    // A schema the generator refuses (oneOf), with a REST document that is fine and changed.
    const bad = structuredClone(MINI);
    const message = bad.components.messages['OrdersFailed'];
    if (message === undefined) throw new Error('fixture');
    message.payload['oneOf'] = [{ type: 'string' }];
    const badFile = join(p.root, 'bad.asyncapi.json');
    writeFileSync(badFile, JSON.stringify(bad));
    const before = [p.snapshot, p.types].map((file) => readFileSync(file, 'utf8'));
    const result = run(p, [
      '--from-file',
      join(MCP, 'test', 'fixtures', 'sync-api', 'additive.json'),
      '--asyncapi-from-file',
      badFile,
    ]);
    expect(result.code, result.out).toBe(3);
    expect(result.out).toContain('WebSocket client: exit 3');
    expect(result.out).toContain('OrdersFailed');
    expect(result.out).toContain('REST client: exit 0');
    expect(readFileSync(join(p.root, 'contracts', 'loadcraft-openapi.json'), 'utf8')).toContain(
      'created_at',
    );
    expect([p.snapshot, p.types].map((file) => readFileSync(file, 'utf8'))).toEqual(before);
  });

  describe('channel metadata of the snapshot', () => {
    const META = {
      'x-terminal-frames': ['orders:done'],
      'x-replay': { mode: 'state' },
      'x-requires-origin': true,
      'x-close-codes': { '4404': 'unknown order' },
      'x-started-by': [
        { operationId: 'start_order', parameter: 'order_id', field: 'id', source: 'response' },
      ],
    };
    const channelOf = (doc: AsyncApiDocument, id: string): Record<string, unknown> =>
      (doc.channels as unknown as Record<string, Record<string, unknown>>)[id] ?? {};
    const withMeta = (p: Project): void => {
      const doc = structuredClone(MINI);
      Object.assign(channelOf(doc, 'orders'), META);
      writeFileSync(p.snapshot, `${JSON.stringify(doc, null, 2)}\n`);
    };

    it('a source without the extensions keeps those of the snapshot', () => {
      const p = project();
      withMeta(p);
      const result = run(
        p,
        source(p, (doc) => void delete progressBody(doc)['stage']),
      );
      expect(result.code, result.out).toBe(0);
      const written = JSON.parse(readFileSync(p.snapshot, 'utf8')) as AsyncApiDocument;
      expect(channelOf(written, 'orders')).toMatchObject(META);
      expect(channelOf(written, 'chat')['x-terminal-frames']).toBeUndefined();
      expect(result.out).not.toContain('no channel metadata');
      expect(readFileSync(p.types, 'utf8')).toContain('terminalFrames: ["orders:done"]');
    });

    it('a new channel is reported as one without metadata', () => {
      const p = project();
      withMeta(p);
      const result = run(
        p,
        source(p, (doc) => {
          doc.channels['fresh'] = structuredClone(doc.channels['orders'] as never);
          (doc.channels['fresh'] as unknown as Record<string, unknown>)['address'] =
            '/ws/fresh/{order_id}';
          for (const name of Object.keys(META)) {
            delete (doc.channels['fresh'] as unknown as Record<string, unknown>)[name];
          }
          for (const [id, operation] of Object.entries(doc.operations)) {
            if (operation.channel.$ref === '#/channels/orders') {
              doc.operations[`fresh_${id}`] = {
                ...structuredClone(operation),
                channel: { $ref: '#/channels/fresh' },
              };
            }
          }
        }),
      );
      expect(result.out).toContain('fresh');
      expect(result.out).toContain('no channel metadata');
    });

    it('an extension the source has wins over the snapshot', () => {
      const p = project();
      withMeta(p);
      const result = run(
        p,
        source(p, (doc) => {
          Object.assign(channelOf(doc, 'orders'), { 'x-requires-origin': false });
        }),
      );
      expect(result.code, result.out).toBe(0);
      const written = JSON.parse(readFileSync(p.snapshot, 'utf8')) as AsyncApiDocument;
      expect(channelOf(written, 'orders')['x-requires-origin']).toBe(false);
      expect(channelOf(written, 'orders')['x-terminal-frames']).toEqual(['orders:done']);
    });
  });
});
