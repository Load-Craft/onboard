// Sends one file of the project directory to the LoadCraft API as multipart/form-data without reading
// it into memory. The file must come from `workspace/uploads.ts`: it is streamed from the descriptor
// that passed the allow-list checks, never from a path opened again.

import { randomBytes } from 'node:crypto';

import { ToolError } from '../errors.js';
import { openAllowedForUpload, type AllowedFile } from '../workspace/uploads.js';
import type { HttpClient } from './client.js';

export const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;

export interface UploadRequest {
  /** API path with its parameters filled in, e.g. `/api/v1/projects/<id>/har/upload`. */
  url: string;
  /** Name of the multipart field that carries the file. */
  field: string;
  file: AllowedFile;
  /**
   * The content of `file`, already read once (`readBytesAllowed`) and checked by the caller. It is
   * sent instead of reading the file again, so what was checked is exactly what goes out.
   */
  bytes?: Uint8Array;
  /** Further files of the same request, each in a multipart field of its own. */
  moreFiles?: readonly { readonly field: string; readonly file: AllowedFile }[];
  /** Extra text fields sent next to the file. */
  fields?: Readonly<Record<string, string>>;
  signal: AbortSignal;
  /** Time limit of the whole transfer; default `DEFAULT_UPLOAD_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Any POST path of the contract works the same here; the typed client only needs one of them. */
type SnapshotPostPath = '/api/v1/projects/{project_id}/har/upload';

const encoder = new TextEncoder();

/** Escapes a header parameter the way the HTML multipart encoder does (WHATWG, form-data encoding). */
function quoted(value: string): string {
  return value.replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll('"', '%22');
}

interface OpenPart {
  readonly field: string;
  readonly file: AllowedFile;
  /** Absent for a part sent from `bytes`. */
  readonly handle?: Awaited<ReturnType<typeof openAllowedForUpload>>['handle'];
  readonly size: number;
  readonly bytes?: Uint8Array;
}

export async function uploadFile(http: HttpClient, request: UploadRequest): Promise<unknown> {
  const { signal } = request;
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError');

  // Every file is opened before the first byte goes out, and closed whatever happens.
  const opened: OpenPart[] = [];
  const open = async (field: string, file: AllowedFile): Promise<void> => {
    const { handle, size } = await openAllowedForUpload(file);
    opened.push({ field, file, handle, size });
  };

  try {
    if (request.bytes === undefined) {
      await open(request.field, request.file);
    } else {
      opened.push({
        field: request.field,
        file: request.file,
        size: request.bytes.byteLength,
        bytes: request.bytes,
      });
    }
    for (const more of request.moreFiles ?? []) await open(more.field, more.file);

    const boundary = `----loadcraft${randomBytes(12).toString('hex')}`;
    const fieldsPart = encoder.encode(
      Object.entries(request.fields ?? {})
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(name)}"\r\n\r\n${value}\r\n`,
        )
        .join(''),
    );
    const tail = encoder.encode(`--${boundary}--\r\n`);

    // A change of a file while it is sent is reported as such, not as a broken connection.
    let changed: ToolError | undefined;
    async function* parts(): AsyncGenerator<Uint8Array> {
      yield fieldsPart;
      for (const { field, file, handle, size, bytes } of opened) {
        yield encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(field)}"; ` +
            `filename="${quoted(file.name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        );
        let sent = 0;
        if (bytes !== undefined) {
          yield bytes;
          sent = size;
        } else if (handle !== undefined && size > 0) {
          for await (const chunk of handle.createReadStream({
            start: 0,
            end: size - 1,
            autoClose: false,
          })) {
            const bytes = chunk as Uint8Array;
            sent += bytes.byteLength;
            yield bytes;
          }
        }
        if (sent !== size) {
          changed = new ToolError('file_changed_while_sending', { params: { file: file.name } });
          throw changed;
        }
        yield encoder.encode('\r\n');
      }
      yield tail;
    }

    try {
      // The typed client knows the contract's paths; this one carries a filled-in path of any of them.
      const { data } = await http.POST(request.url as SnapshotPostPath, {
        params: { path: { project_id: '' } },
        body: { file: '' },
        bodySerializer: () => ReadableStream.from(parts()),
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        duplex: 'half',
        // A 401 would make fetch replay the request with credentials, which a stream body cannot do.
        credentials: 'omit',
        signal,
        timeoutMs: request.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
      });
      return data;
    } catch (error) {
      if (changed !== undefined) throw changed;
      throw error;
    }
  } finally {
    await Promise.all(
      opened.flatMap(({ handle }) =>
        handle === undefined ? [] : [handle.close().catch(() => undefined)],
      ),
    );
  }
}
