// File reading as `Path.read_text(encoding="utf-8")` does it: strict UTF-8 whose failures read the
// way Python words them, universal newlines (`\r\n` and `\r` become `\n`), a byte order mark kept as a
// character. Errors are Python-shaped so the validators can print the same messages.

import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';

import { reprStr } from './str.ts';

/** `UnicodeDecodeError`. */
export class UnicodeDecodeError extends Error {}

/** `OSError` and subclasses; `kind` is the Python class name. */
export class PyOSError extends Error {
  constructor(
    readonly kind:
      | 'FileNotFoundError'
      | 'IsADirectoryError'
      | 'NotADirectoryError'
      | 'PermissionError'
      | 'OSError',
    message: string,
  ) {
    super(message);
  }
}

/** An uncaught Python exception: stderr gets its last traceback line and the exit status is 1. */
export class PyCrash extends Error {
  constructor(
    readonly pyType: string,
    message: string,
  ) {
    super(message);
  }
}

const CONTINUATION = (byte: number): boolean => (byte & 0xc0) === 0x80;

function decodeError(
  bytes: Uint8Array,
  start: number,
  end: number,
  reason: string,
): UnicodeDecodeError {
  const where =
    end - start === 1
      ? `byte 0x${(bytes[start] as number).toString(16).padStart(2, '0')} in position ${start}`
      : `bytes in position ${start}-${end - 1}`;
  return new UnicodeDecodeError(`'utf-8' codec can't decode ${where}: ${reason}`);
}

/** Strict UTF-8 decoding with CPython's error positions and reasons. */
export function decodeUtf8(bytes: Uint8Array): string {
  let ascii = true;
  for (const byte of bytes) {
    if (byte >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  const length = bytes.length;
  let i = 0;
  while (i < length) {
    const lead = bytes[i] as number;
    if (lead < 0x80) {
      out.push(String.fromCharCode(lead));
      i += 1;
      continue;
    }
    if (lead < 0xc2 || lead > 0xf4) throw decodeError(bytes, i, i + 1, 'invalid start byte');
    const need = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
    const second = bytes[i + 1];
    if (second === undefined) throw decodeError(bytes, i, length, 'unexpected end of data');
    if (need === 2) {
      if (!CONTINUATION(second)) throw decodeError(bytes, i, i + 1, 'invalid continuation byte');
      out.push(String.fromCharCode(((lead & 0x1f) << 6) | (second & 0x3f)));
      i += 2;
      continue;
    }
    const badSecond =
      need === 3
        ? !CONTINUATION(second) || (second < 0xa0 ? lead === 0xe0 : lead === 0xed)
        : !CONTINUATION(second) || (second < 0x90 ? lead === 0xf0 : lead === 0xf4);
    if (badSecond) throw decodeError(bytes, i, i + 1, 'invalid continuation byte');
    const third = bytes[i + 2];
    if (third === undefined) throw decodeError(bytes, i, length, 'unexpected end of data');
    if (!CONTINUATION(third)) throw decodeError(bytes, i, i + 2, 'invalid continuation byte');
    if (need === 3) {
      out.push(
        String.fromCharCode(((lead & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f)),
      );
      i += 3;
      continue;
    }
    const fourth = bytes[i + 3];
    if (fourth === undefined) throw decodeError(bytes, i, length, 'unexpected end of data');
    if (!CONTINUATION(fourth)) throw decodeError(bytes, i, i + 3, 'invalid continuation byte');
    out.push(
      String.fromCodePoint(
        ((lead & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f),
      ),
    );
    i += 4;
  }
  return out.join('');
}

const ERRNO: Record<string, [number, string]> = {
  ENOENT: [2, 'No such file or directory'],
  EACCES: [13, 'Permission denied'],
  ENOTDIR: [20, 'Not a directory'],
  EISDIR: [21, 'Is a directory'],
  ELOOP: [40, 'Too many levels of symbolic links'],
  ENAMETOOLONG: [36, 'File name too long'],
  EPERM: [1, 'Operation not permitted'],
  EMFILE: [24, 'Too many open files'],
  EIO: [5, 'Input/output error'],
};

function toPyOSError(error: unknown, path: string): PyOSError {
  const code = (error as { code?: string }).code ?? '';
  const known = ERRNO[code];
  if (known === undefined) return new PyOSError('OSError', `${(error as Error).message}`);
  const [errno, text] = known;
  const message = `[Errno ${errno}] ${text}: ${reprStr(path)}`;
  const kind =
    code === 'ENOENT'
      ? 'FileNotFoundError'
      : code === 'EISDIR'
        ? 'IsADirectoryError'
        : code === 'ENOTDIR'
          ? 'NotADirectoryError'
          : code === 'EACCES' || code === 'EPERM'
            ? 'PermissionError'
            : 'OSError';
  return new PyOSError(kind, message);
}

/** `Path.read_text(encoding="utf-8")`. */
export function readText(path: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw toPyOSError(error, path);
  }
  return decodeUtf8(bytes).replace(/\r\n?/g, '\n');
}

/** `Path.exists()` (follows symlinks; a dangling link does not exist). */
export function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EBADF')
      return false;
    throw toPyOSError(error, path);
  }
}

/** `Path.is_dir()`. */
export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** `Path.is_file()`. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** `Path.rglob("*")`: every entry below `root`, symbolic links to directories not entered. */
export function rglob(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = dir === '.' ? name : `${dir.endsWith('/') ? dir : `${dir}/`}${name}`;
      found.push(full);
      let real: boolean;
      try {
        real = lstatSync(full).isDirectory();
      } catch {
        real = false;
      }
      if (real) visit(full);
    }
  };
  visit(root);
  return found;
}
