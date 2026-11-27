import { readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { LoadcraftApiError } from '../src/http/apiError.js';
import { toToolError } from '../src/http/errors.js';
import { createHttp, type HttpClient } from '../src/http/client.js';
import { uploadFile, DEFAULT_UPLOAD_TIMEOUT_MS, type UploadRequest } from '../src/http/upload.js';
import { createLogger } from '../src/log.js';
import { createTranslator } from '../src/render/i18n/index.js';
import { openAllowed, type AllowedFile } from '../src/workspace/uploads.js';
import { CANARY } from './helpers/canary.js';
import { createTestClock, type TestClock } from './helpers/clock.js';

interface Part {
  name: string;
  filename: string | undefined;
  contentType: string | undefined;
  data: Buffer;
}

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  parts: Part[];
  aborted: Promise<void>;
}

type Handler = (req: Received, res: ServerResponse) => void;

/** Splits a multipart/form-data body on its boundary; enough for the parts a client sends. */
function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ''}`);
  const parts: Part[] = [];
  let at = body.indexOf(marker);
  while (at !== -1) {
    const start = at + marker.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(marker, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2); // drop CRLF after the marker and before the next
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    parts.push({
      name: /name="([^"]*)"/.exec(head)?.[1] ?? '',
      filename: /filename="([^"]*)"/.exec(head)?.[1],
      contentType: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1],
      data: part.subarray(split + 4),
    });
    at = next;
  }
  return parts;
}

interface Backend {
  readonly origin: string;
  readonly requests: Received[];
  handle(handler: Handler): void;
  /** Runs once, when `bytes` bytes of a request body have arrived. */
  onBytes(bytes: number, hook: () => void): void;
  close(): Promise<void>;
}

async function startBackend(): Promise<Backend> {
  const requests: Received[] = [];
  let handler: Handler = (_req, res) => {
    res.writeHead(500).end();
  };
  let trigger: { bytes: number; hook: () => void } | undefined;
  let total = 0;
  const server: Server = createServer((req, res) => {
    const aborted = new Promise<void>((resolve) => {
      res.on('close', () => {
        if (!res.writableEnded) resolve();
      });
    });
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      if (trigger !== undefined && total >= trigger.bytes) {
        const { hook } = trigger;
        trigger = undefined;
        hook();
      }
    });
    req.on('end', () => {
      const received: Received = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        parts: parseMultipart(Buffer.concat(chunks), req.headers['content-type'] ?? ''),
        aborted,
      };
      requests.push(received);
      handler(received, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    handle: (next) => {
      handler = next;
    },
    onBytes: (bytes, hook) => {
      total = 0;
      trigger = { bytes, hook };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

const UPLOAD_PATH = '/api/v1/projects/p1/har/upload';

let backend: Backend;
let clock: TestClock;
let http: HttpClient;
let base: string;
let root: string;
let sleeps: number[];

beforeEach(async () => {
  backend = await startBackend();
  const inner = createTestClock();
  sleeps = [];
  clock = {
    now: () => inner.now(),
    advance: (ms) => inner.advance(ms),
    sleep(ms, signal) {
      sleeps.push(ms);
      return inner.sleep(ms, signal);
    },
  };
  const config = loadConfig(
    { LOADCRAFT_API_URL: `${backend.origin}/api/v1`, LOADCRAFT_API_TOKEN: CANARY },
    '/tmp',
  );
  http = createHttp(config, createLogger({ level: 'error', sink: () => undefined }), { clock });
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lc-upload-')));
  root = join(base, 'project');
  mkdirSync(join(root, 'captures', 'nested'), { recursive: true });
});

afterEach(async () => {
  await backend.close();
  rmSync(base, { recursive: true, force: true });
});

describe('uploadFile', () => {
  it('sends the file as multipart: field name, bare file name, bytes intact, extra fields', async () => {
    const content = randomBytes(5 * 1024 * 1024);
    writeFileSync(join(root, 'captures', 'nested', 'session.har'), content);
    const file = await openAllowed(root, 'captures/nested/session.har', 'har');
    backend.handle((_req, res) => json(res, 200, { upload_id: 'u1', entries: 12 }));

    const result = await uploadFile(http, {
      url: UPLOAD_PATH,
      field: 'file',
      file,
      fields: { label: 'checkout', note: 'zażółć gęślą' },
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ upload_id: 'u1', entries: 12 });
    const [req] = backend.requests;
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe(UPLOAD_PATH);
    expect(req?.headers.authorization).toBe(`Bearer ${CANARY}`);
    expect(req?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const filePart = req?.parts.find((part) => part.name === 'file');
    expect(filePart?.filename).toBe('session.har');
    expect(filePart?.data.length).toBe(content.length);
    expect(filePart?.data.equals(content)).toBe(true);
    const fields = Object.fromEntries(
      (req?.parts ?? [])
        .filter((part) => part.filename === undefined)
        .map((part) => [part.name, part.data.toString('utf8')]),
    );
    expect(fields).toEqual({ label: 'checkout', note: 'zażółć gęślą' });
  });

  it('sends a file name with quotes and line breaks as one safe header value', async () => {
    writeFileSync(join(root, 'a"b\nc.har'), '{"log":{}}');
    const file = await openAllowed(root, 'a"b\nc.har', 'har');
    backend.handle((_req, res) => json(res, 200, {}));

    await uploadFile(http, {
      url: UPLOAD_PATH,
      field: 'file',
      file,
      signal: new AbortController().signal,
    });

    const [part] = backend.requests[0]?.parts ?? [];
    expect(backend.requests[0]?.parts).toHaveLength(1);
    expect(part?.filename).toBe('a%22b%0Ac.har');
    expect(part?.data.toString()).toBe('{"log":{}}');
  });

  it('turns a 413 into LoadcraftApiError', async () => {
    writeFileSync(join(root, 'big.har'), '{}');
    const file = await openAllowed(root, 'big.har', 'har');
    backend.handle((_req, res) =>
      json(res, 413, { detail: 'HAR file exceeds 100MB limit (got 120MB)' }),
    );

    const error = await rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file,
        signal: new AbortController().signal,
      }),
    );

    expect(error).toBeInstanceOf(LoadcraftApiError);
    const api = error as LoadcraftApiError;
    expect(api.status).toBe(413);
    expect(api.code).toBe('payload_too_large');
    expect(api.message).toContain('100MB');
  });

  it('never repeats the upload and waits up to 300 s by default', async () => {
    writeFileSync(join(root, 'once.har'), '{}');
    const file = await openAllowed(root, 'once.har', 'har');
    backend.handle((_req, res) => json(res, 503, { detail: 'try later' }));

    const error = await rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file,
        signal: new AbortController().signal,
      }),
    );

    expect((error as LoadcraftApiError).status).toBe(503);
    expect(backend.requests).toHaveLength(1);
    expect(DEFAULT_UPLOAD_TIMEOUT_MS).toBe(300_000);
    expect(sleeps).toEqual([DEFAULT_UPLOAD_TIMEOUT_MS]);
  });

  it('honours timeoutMs', async () => {
    writeFileSync(join(root, 'once.har'), '{}');
    const file = await openAllowed(root, 'once.har', 'har');
    backend.handle(() => undefined);

    const call = rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file,
        signal: new AbortController().signal,
        timeoutMs: 1234,
      }),
    );
    while (!sleeps.includes(1234)) await new Promise((resolve) => setTimeout(resolve, 5));
    await clock.advance(1234);

    const error = await call;
    expect((error as LoadcraftApiError).code).toBe('timeout');
  });

  it('stops the transfer when the caller aborts', async () => {
    writeFileSync(join(root, 'slow.har'), '{}');
    const file = await openAllowed(root, 'slow.har', 'har');
    backend.handle(() => undefined);
    const controller = new AbortController();

    const call = rejection(
      uploadFile(http, { url: UPLOAD_PATH, field: 'file', file, signal: controller.signal }),
    );
    while (backend.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();

    expect(((await call) as Error).name).toBe('AbortError');
    await backend.requests[0]?.aborted;
  });

  it('refuses a file replaced by another one after it was checked, without sending anything', async () => {
    writeFileSync(join(root, 'swap.har'), '{"log":"checked"}');
    const file = await openAllowed(root, 'swap.har', 'har');
    writeFileSync(join(root, 'other.har'), '{"log":"swapped"}');
    renameSync(join(root, 'other.har'), join(root, 'swap.har'));

    const error = await rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file,
        signal: new AbortController().signal,
      }),
    );

    expect((error as { code?: string }).code).toBe('file_changed');
    expect(backend.requests).toHaveLength(0);
  });

  it('refuses a file that was not issued by the allow-list', async () => {
    const forged = {
      kind: 'har',
      path: join(root, 'x.har'),
      name: 'x.har',
      size: 2,
    } as unknown as AllowedFile;

    const error = await rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file: forged,
        signal: new AbortController().signal,
      }),
    );

    expect((error as { code?: string }).code).toBe('file_not_allowed');
    expect(backend.requests).toHaveLength(0);
  });

  async function send(name: string, signal = new AbortController().signal): Promise<unknown> {
    const file = await openAllowed(root, name, 'har');
    return uploadFile(http, { url: UPLOAD_PATH, field: 'file', file, signal });
  }

  it('turns a 401 into LoadcraftApiError 401, not a network error', async () => {
    writeFileSync(join(root, 'auth.har'), '{}');
    backend.handle((_req, res) => json(res, 401, { detail: 'Invalid token' }));

    const error = await rejection(send('auth.har'));

    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect((error as LoadcraftApiError).status).toBe(401);
    expect((error as LoadcraftApiError).code).toBe('unauthorized');
  });

  it('does not echo the token a 4xx answer quotes back', async () => {
    writeFileSync(join(root, 'leak.har'), '{}');
    backend.handle((_req, res) => json(res, 403, { detail: `bad token ${CANARY}` }));

    const error = await rejection(send('leak.har'));

    expect(error).toBeInstanceOf(LoadcraftApiError);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(CANARY);
    expect((error as Error).message).not.toContain(CANARY);
  });

  it('keeps the bytes of a file that contains multipart-looking sequences', async () => {
    const content = Buffer.concat([
      Buffer.from('a\r\n--b\r\n----loadcraft\r\n--\r\n\r\n'),
      randomBytes(300_000),
      Buffer.from('\r\n--'),
    ]);
    writeFileSync(join(root, 'tricky.har'), content);
    backend.handle((_req, res) => json(res, 200, {}));

    await send('tricky.har');

    const part = backend.requests[0]?.parts.find((p) => p.name === 'file');
    expect(part?.data.equals(content)).toBe(true);
  });

  it('streams from the checked descriptor: a file unlinked after the start is still sent whole', async () => {
    const path = join(root, 'gone.har');
    const content = randomBytes(8 * 1024 * 1024);
    writeFileSync(path, content);
    backend.handle((_req, res) => json(res, 200, {}));
    // Only once 256 KB of the file itself arrived: the file is certainly open and being read.
    backend.onBytes(256 * 1024, () => unlinkSync(path));

    await send('gone.har');

    const part = backend.requests[0]?.parts.find((p) => p.name === 'file');
    expect(part?.data.equals(content)).toBe(true);
  });

  it('leaks no file descriptor after success, a 413 and an abort', async () => {
    writeFileSync(join(root, 'fd.har'), randomBytes(2 * 1024 * 1024));
    const open = (): number => readdirSync('/proc/self/fd').length;
    backend.handle((_req, res) => json(res, 200, {}));
    await send('fd.har'); // warms up the keep-alive socket
    const before = open();

    await send('fd.har');
    backend.handle((_req, res) => json(res, 413, { detail: 'too big' }));
    await rejection(send('fd.har'));
    backend.handle(() => undefined);
    const controller = new AbortController();
    const aborted = rejection(send('fd.har', controller.signal));
    while (backend.requests.length < 4) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await aborted;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(open()).toBeLessThanOrEqual(before);
  });

  it('reports a file that shrank while it was sent as file_changed_while_sending', async () => {
    const path = join(root, 'grow.har');
    writeFileSync(path, 'x'.repeat(20 * 1024 * 1024));
    const file = await openAllowed(root, 'grow.har', 'har');
    backend.handle((_req, res) => json(res, 200, {}));
    backend.onBytes(256 * 1024, () => truncateSync(path, 10));

    const error = await rejection(
      uploadFile(http, {
        url: UPLOAD_PATH,
        field: 'file',
        file,
        signal: new AbortController().signal,
      }),
    );

    expect((error as { code?: string }).code).toBe('file_changed_while_sending');
    expect(toToolError(error, createTranslator('en')).message).toBe(
      'grow.har changed while it was being sent.',
    );
  });
});

describe('uploadFile types', () => {
  it('takes only a file issued by uploads.ts, never a bare path', () => {
    expectTypeOf<UploadRequest['file']>().toEqualTypeOf<AllowedFile>();
    expectTypeOf<string>().not.toExtend<UploadRequest['file']>();
    expectTypeOf<{
      kind: 'har';
      path: string;
      name: string;
      size: number;
    }>().not.toExtend<UploadRequest['file']>();
  });
});
