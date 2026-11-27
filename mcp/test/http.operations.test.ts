// The runtime table of the REST client (operationId -> method, path) and the helpers that type a
// call by operationId: OpInput / OpOutput / OpError and callOperation.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { EXCLUDED_OPERATIONS } from '../scripts/sync-api/excluded.js';
import { loadConfig } from '../src/config.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { createHttp, type HttpClient } from '../src/http/client.js';
import { OPERATIONS, type OperationId } from '../src/http/generated/operations.js';
import { CHANNELS, type ChannelId } from '../src/ws/generated/channels.js';
import type { operations } from '../src/http/generated/api.js';
import {
  callOperation,
  type OperationError,
  type OperationInput,
  type OperationOutput,
  type OpError,
  type OpInput,
  type OpOutput,
} from '../src/http/operation.js';
import { createLogger } from '../src/log.js';
import { Secret } from '../src/secret.js';

const ROOT = resolve(import.meta.dirname, '..');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

interface OpenApiOperation {
  operationId: string;
}
interface OpenApi {
  paths: Record<string, Partial<Record<(typeof METHODS)[number], OpenApiOperation>>>;
}
interface Catalog {
  modules: Array<{
    tools: Array<{ operations?: Array<{ operationId: string }>; channels?: string[] }>;
  }>;
  excluded: { operations: Array<{ operationId: string }>; channels?: Array<{ channel: string }> };
}

const contract = JSON.parse(
  readFileSync(join(ROOT, '..', 'contracts', 'loadcraft-openapi.json'), 'utf8'),
) as OpenApi;
const catalog = JSON.parse(readFileSync(join(ROOT, 'catalog', 'katalog.json'), 'utf8')) as Catalog;

const snapshot = new Map<string, { method: string; path: string }>();
for (const [path, item] of Object.entries(contract.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (op) snapshot.set(op.operationId, { method: method.toUpperCase(), path });
  }
}

describe('OPERATIONS: the table is the snapshot', () => {
  it('has all 389 operations of the snapshot, with the snapshot method and path', () => {
    expect(Object.keys(OPERATIONS)).toHaveLength(389);
    const differs = [...snapshot.entries()]
      .filter(([id, s]) => {
        const row = (OPERATIONS as Record<string, { method: string; path: string } | undefined>)[
          id
        ];
        return row?.method !== s.method || row.path !== s.path;
      })
      .map(([id]) => id);
    expect(differs).toEqual([]);
  });

  it('has every operationId of the catalog, tools and excluded', () => {
    const ids = [
      ...catalog.modules.flatMap((m) => m.tools.flatMap((t) => t.operations ?? [])),
      ...catalog.excluded.operations,
    ].map((o) => o.operationId);
    expect(ids.length).toBeGreaterThan(300);
    // dev-login is left out of the public snapshot (scripts/sync-api/excluded.ts).
    const leftOut = new Set(EXCLUDED_OPERATIONS.map((entry) => entry.operationId));
    expect(ids.filter((id) => !(id in OPERATIONS) && !leftOut.has(id))).toEqual([]);
    expect([...leftOut].filter((id) => id in OPERATIONS)).toEqual([]);
  });

  it('names how the answer is read: 204 is empty, a JPEG is a blob, the rest is JSON', () => {
    expect(OPERATIONS.revoke_api_token_api_v1_auth_api_tokens__token_id__delete.response).toBe(
      'empty',
    );
    expect(
      OPERATIONS
        .take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get
        .response,
    ).toBe('blob');
    expect(OPERATIONS.list_projects_api_v1_projects_get.response).toBe('json');
  });

  it('a JSON-declared string with a file media type or binary format is a blob', () => {
    const blobs = [
      'get_run_still_api_v1_projects__project_id__scenario_from_description_runs__run_id__stills__still_id__get',
      'fetch_job_bundle_api_v1_injector_agents_jobs__job_id__bundle_get',
      'export_scenario_project_api_v1_projects__project_id__gatling_scenarios__scenario_id__export_get',
      'generate_payloads_api_v1_projects__project_id__generate_payloads_post',
      'download_generated_payloads_api_v1_projects__project_id__generate_payloads__run_id__download_get',
    ] as const;
    for (const id of blobs) expect(OPERATIONS[id].response, id).toBe('blob');
  });

  it('a blob by contract is typed Blob, not the string the generator saw', () => {
    expectTypeOf<
      OpOutput<'fetch_job_bundle_api_v1_injector_agents_jobs__job_id__bundle_get'>
    >().toEqualTypeOf<Blob>();
  });

  it('the channels of the catalog are channels of the generated WebSocket client', () => {
    const names = [
      ...catalog.modules.flatMap((m) => m.tools.flatMap((t) => t.channels ?? [])),
      ...(catalog.excluded.channels ?? []).map((c) => c.channel),
    ];
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => !(n in CHANNELS))).toEqual([]);
    expectTypeOf<ChannelId>().toEqualTypeOf<keyof typeof CHANNELS>();
  });

  it('OperationId is exactly the key set of the generated operations type', () => {
    expectTypeOf<OperationId>().toEqualTypeOf<keyof operations>();
  });
});

describe('the generator', () => {
  const script = join(ROOT, 'scripts', 'gen-operations.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 60_000 });

  it('--check passes on the committed file', () => {
    const result = run('--check');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('--check goes red when the snapshot changed and the file was not regenerated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-genops-'));
    try {
      const spec = JSON.parse(
        readFileSync(join(ROOT, '..', 'contracts', 'loadcraft-openapi.json'), 'utf8'),
      ) as OpenApi;
      const item = spec.paths['/api/v1/projects'];
      if (item?.get === undefined) throw new Error('snapshot');
      item.get.operationId = 'renamed_operation';
      const changed = join(dir, 'openapi.json');
      writeFileSync(changed, JSON.stringify(spec));
      const result = run('--check', '--spec', changed);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('npm run gen:api');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a document in which two operations share an operationId', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-genops-'));
    try {
      const spec = {
        paths: {
          '/a': { get: { operationId: 'same', responses: {} } },
          '/b': { get: { operationId: 'same', responses: {} } },
        },
      };
      const file = join(dir, 'dup.json');
      writeFileSync(file, JSON.stringify(spec));
      const result = run('--spec', file, '--out', join(dir, 'out.ts'));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('same');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('OpInput / OpOutput: types by operationId', () => {
  it('204 answers nothing: void', () => {
    expectTypeOf<
      OpOutput<'revoke_api_token_api_v1_auth_api_tokens__token_id__delete'>
    >().toEqualTypeOf<void>();
  });

  it('a JSON answer is its schema', () => {
    expectTypeOf<OpOutput<'list_projects_api_v1_projects_get'>>().toEqualTypeOf<
      operations['list_projects_api_v1_projects_get']['responses']['200']['content']['application/json']
    >();
  });

  it('a file answer is a Blob', () => {
    expectTypeOf<
      OpOutput<'take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get'>
    >().toEqualTypeOf<Blob>();
  });

  it('a CSV answer is text', () => {
    interface CsvOperation {
      parameters: { query?: never; header?: never; path?: never; cookie?: never };
      requestBody?: never;
      responses: { 200: { headers: Record<string, unknown>; content: { 'text/csv': string } } };
    }
    expectTypeOf<OperationOutput<CsvOperation>>().toEqualTypeOf<string>();
  });

  it('an error answer is typed apart from the success', () => {
    expectTypeOf<OpError<'list_projects_api_v1_projects_get'>>().toEqualTypeOf<
      OperationError<operations['list_projects_api_v1_projects_get']>
    >();
    expectTypeOf<OpError<'list_projects_api_v1_projects_get'>>().not.toEqualTypeOf<
      OpOutput<'list_projects_api_v1_projects_get'>
    >();
  });

  it('a multipart upload takes FormData as its body', () => {
    expectTypeOf<
      OpInput<'upload_har_api_v1_projects__project_id__har_upload_post'>['body']
    >().toEqualTypeOf<FormData>();
  });

  it('path, query and header parameters are grouped; optional groups are optional', () => {
    expectTypeOf<
      OpInput<'revoke_api_token_api_v1_auth_api_tokens__token_id__delete'>['path']
    >().toEqualTypeOf<{ token_id: string }>();
    expectTypeOf<OpInput<'list_projects_api_v1_projects_get'>>().toHaveProperty('query');
    expectTypeOf<OperationInput<{ parameters: object }>>().not.toHaveProperty('body');
  });
});

describe('callOperation', () => {
  interface Seen {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: string;
  }
  let server: Server;
  let seen: Seen[];
  let reply: (status: number, type: string | undefined, body: Buffer | string) => void;
  let origin: string;
  let next: { status: number; type: string | undefined; body: Buffer | string };

  beforeEach(async () => {
    seen = [];
    next = { status: 200, type: 'application/json', body: '{}' };
    reply = (status, type, body) => {
      next = { status, type, body };
    };
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('latin1'),
        });
        res.writeHead(next.status, next.type === undefined ? {} : { 'Content-Type': next.type });
        res.end(next.status === 204 ? undefined : next.body);
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  });

  function client(): HttpClient {
    const config = loadConfig(
      { LOADCRAFT_API_URL: `${origin}/api/v1`, LOADCRAFT_API_TOKEN: 'tok-1' },
      '/tmp',
    );
    return createHttp(config, createLogger({ level: 'error', sink: () => undefined }));
  }

  it('uses the method and path of the table, fills path and query parameters', async () => {
    reply(200, 'application/json', JSON.stringify({ items: [], total: 0 }));
    const data = await callOperation(client(), 'list_projects_api_v1_projects_get', {
      query: { limit: 5 },
    });
    expect(data).toEqual({ items: [], total: 0 });
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url).toBe('/api/v1/projects?limit=5');
    expect(seen[0]?.headers.authorization).toBe('Bearer tok-1');
  });

  it('204 returns undefined', async () => {
    reply(204, undefined, '');
    const out = await callOperation(
      client(),
      'revoke_api_token_api_v1_auth_api_tokens__token_id__delete',
      { path: { token_id: 'abc' } },
    );
    expect(out).toBeUndefined();
    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.url).toBe('/api/v1/auth/api-tokens/abc');
  });

  it('a file answer comes back as a Blob', async () => {
    reply(200, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const out = await callOperation(
      client(),
      'take_run_snapshot_api_v1_projects__project_id__scenario_from_description_runs__run_id__paths__path_index__attempts__attempt__snapshot_get',
      { path: { project_id: 'p', run_id: 'r', path_index: 0, attempt: 1 } },
    );
    expect(out).toBeInstanceOf(Blob);
    expect(out.size).toBe(4);
  });

  it('sends FormData as multipart and the same token', async () => {
    reply(200, 'application/json', '{}');
    const form = new FormData();
    form.set('file', new Blob(['{"log":1}'], { type: 'application/json' }), 'a.har');
    await callOperation(client(), 'upload_har_api_v1_projects__project_id__har_upload_post', {
      path: { project_id: 'p1' },
      body: form,
    });
    expect(seen[0]?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0]?.body).toContain('filename="a.har"');
    expect(seen[0]?.headers.authorization).toBe('Bearer tok-1');
  });

  it('a zip answer declared as JSON is read as a Blob, with Accept */*', async () => {
    reply(200, 'application/zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff]));
    const out = await callOperation(
      client(),
      'download_generated_payloads_api_v1_projects__project_id__generate_payloads__run_id__download_get',
      { path: { project_id: 'p', run_id: 'r' } },
    );
    expect(out).toBeInstanceOf(Blob);
    expect(out.size).toBe(5);
    expect(seen[0]?.headers.accept).toBe('*/*');
  });

  it('a JSON call keeps Accept: application/json', async () => {
    reply(200, 'application/json', '{}');
    await callOperation(client(), 'list_projects_api_v1_projects_get');
    expect(seen[0]?.headers.accept).toBe('application/json');
  });

  it('refuses a missing path parameter before anything is sent, naming it', async () => {
    const bad = [
      {},
      { path: {} },
      { path: { token_id: '' } },
      { path: { token_id: null } },
    ] as unknown[];
    for (const input of bad) {
      await expect(
        callOperation(
          client(),
          'revoke_api_token_api_v1_auth_api_tokens__token_id__delete',
          input as never,
        ),
      ).rejects.toThrow(/token_id/);
    }
    expect(seen).toEqual([]);
  });

  it('a non-2xx answer is the client error, not a returned value', async () => {
    reply(404, 'application/json', JSON.stringify({ detail: 'nope' }));
    await expect(
      // the contract marks secret values of a project, so the call takes the secret scope
      callOperation(
        client(),
        'get_project_api_v1_projects__project_id__get',
        { path: { project_id: 'x' } },
        { secrets: { add: (value: string) => new Secret(value) } },
      ),
    ).rejects.toBeInstanceOf(LoadcraftApiError);
  });

  it('keeps the response size limit of the client', async () => {
    reply(200, 'application/json', JSON.stringify({ blob: 'x'.repeat(200) }));
    await expect(
      callOperation(client(), 'list_projects_api_v1_projects_get', {}, { maxResponseBytes: 50 }),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it('rejects an operationId that is not in the table', async () => {
    await expect(callOperation(client(), 'nope' as OperationId, {})).rejects.toThrow(/nope/);
  });
});
