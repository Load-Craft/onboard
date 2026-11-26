// Reading a project file safely, shared by the allow-list (`uploads.ts`) and the env-file reader
// (`envFile.ts`). The descriptor is opened without following a final symlink and without blocking on a
// FIFO, then checked (regular file, expected device and inode, size) and read up to a limit.
//
// Errors carry only a code and the `params` of the dictionary text `error.<code>.*`; the model reads
// the dictionary, never the `message`.

import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { ToolError } from '../errors.js';

const KB = 1024;

// O_NOFOLLOW: a last component swapped for a symlink fails instead of being followed.
// O_NONBLOCK: opening a FIFO swapped in does not block the server.
const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export interface FileLimit {
  /** Largest accepted size in bytes. */
  readonly bytes: number;
  /** The limit as shown to the model, e.g. `64 KB`. */
  readonly label: string;
}

export interface FileIdentity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

export function fileChanged(shown: string): ToolError {
  return new ToolError('file_changed', { params: { file: shown } });
}

export function fileTooLarge(shown: string, limit: FileLimit): ToolError {
  return new ToolError('file_too_large', {
    details: { limitBytes: limit.bytes },
    params: { file: shown, limit: limit.label },
  });
}

export function notAFile(shown: string): ToolError {
  return new ToolError('not_a_file', { params: { file: shown } });
}

export function fileNotFound(shown: string, cause?: unknown): ToolError {
  return new ToolError('file_not_found', {
    params: { file: shown },
    ...(cause === undefined ? {} : { cause }),
  });
}

export async function openNoFollow(path: string, shown: string): Promise<FileHandle> {
  try {
    return await open(path, OPEN_FLAGS);
  } catch (error) {
    // A final component that became a symlink is a change, not a missing file.
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw fileChanged(shown);
    throw fileNotFound(shown, error);
  }
}

export interface Expectation {
  readonly limit: FileLimit;
  /** The very file seen earlier (device and inode); omit when there is no earlier look. */
  readonly identity?: FileIdentity;
}

/** Checks an open descriptor: regular file, expected identity, within the limit. Returns its size. */
export async function checkHandle(
  handle: FileHandle,
  shown: string,
  expect: Expectation,
): Promise<number> {
  const info = await handle.stat({ bigint: true });
  if (!info.isFile()) throw notAFile(shown);
  if (
    expect.identity !== undefined &&
    (info.dev !== BigInt(expect.identity.dev) || info.ino !== BigInt(expect.identity.ino))
  ) {
    throw fileChanged(shown);
  }
  if (info.size > BigInt(expect.limit.bytes)) throw fileTooLarge(shown, expect.limit);
  return Number(info.size);
}

/** Opens `path` and checks the descriptor; the handle is closed when a check fails. */
export async function openChecked(
  path: string,
  shown: string,
  expect: Expectation,
): Promise<{ handle: FileHandle; size: number }> {
  const handle = await openNoFollow(path, shown);
  try {
    return { handle, size: await checkHandle(handle, shown, expect) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/** Reads to the end, failing as soon as more than `limit.bytes` have arrived (a file that grew). */
export async function readLimited(
  handle: FileHandle,
  shown: string,
  limit: FileLimit,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * KB, limit.bytes - total + 1));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > limit.bytes) throw fileTooLarge(shown, limit);
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

/**
 * UTF-8 text of `bytes`; a leading BOM is dropped, invalid input is rejected. No `cause` is attached:
 * the decoder error must not carry any part of the content.
 */
export function decodeUtf8(bytes: Buffer, shown: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ToolError('file_encoding_invalid', { params: { file: shown } });
  }
}
