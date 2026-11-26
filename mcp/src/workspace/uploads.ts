import { execFile } from 'node:child_process';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { ToolError } from '../errors.js';
import {
  decodeUtf8,
  fileChanged,
  fileTooLarge,
  notAFile,
  openChecked,
  openNoFollow,
  readLimited,
  type FileLimit,
} from './fileRead.js';
import { relativeToWorkspace, resolveInside } from './paths.js';

export type UploadKind = 'openapi' | 'asyncapi' | 'har' | 'overview' | 'accounts';

interface Rule {
  readonly extension: string;
  readonly limit: number;
  readonly limitLabel: string;
  readonly text: boolean;
}

const KB = 1024;
const MB = 1024 * KB;

const RULES: Readonly<Record<UploadKind, Rule>> = {
  openapi: { extension: '.json', limit: 10 * MB, limitLabel: '10 MB', text: true },
  asyncapi: { extension: '.json', limit: 10 * MB, limitLabel: '10 MB', text: true },
  har: { extension: '.har', limit: 100 * MB, limitLabel: '100 MB', text: false },
  overview: { extension: '.md', limit: 64 * KB, limitLabel: '64 KB', text: true },
  accounts: { extension: '.csv', limit: 2 * MB, limitLabel: '2 MB', text: true },
};

declare const allowedBrand: unique symbol;

/** A file that passed workspace, type and size checks. Only this module can create one. */
export interface AllowedFile {
  readonly kind: UploadKind;
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly [allowedBrand]: true;
}

interface Issued {
  readonly root: string;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

const issued = new WeakMap<object, Issued>();

export async function openAllowed(
  root: string,
  input: string,
  kind: UploadKind,
): Promise<AllowedFile> {
  const rule = RULES[kind];
  const path = resolveInside(root, input);
  const shown = relativeToWorkspace(root, path);

  const handle = await openNoFollow(path, shown);
  let info;
  try {
    info = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  if (!info.isFile()) throw notAFile(shown);
  if (extname(path).toLowerCase() !== rule.extension) {
    throw new ToolError('unsupported_file_type', {
      details: { kind, extension: rule.extension },
      params: { file: shown, kind, extension: rule.extension },
    });
  }
  if (isDocumentKind(kind)) await refuseExcludedPath(path, shown);
  // A recording is often ignored by git on purpose (it holds a session), so only the place counts.
  if (kind === 'har' && isExcludedPlace(path, shown)) {
    throw new ToolError('har_path_excluded', { params: { file: shown } });
  }
  if (info.size > BigInt(rule.limit)) throw fileTooLarge(shown, limitOf(rule));

  const file: AllowedFile = Object.freeze({
    kind,
    path,
    name: basename(path),
    size: Number(info.size),
  }) as AllowedFile;
  issued.set(file, { root, dev: info.dev, ino: info.ino });
  return file;
}

const isDocumentKind = (kind: UploadKind): boolean => kind === 'openapi' || kind === 'asyncapi';

/**
 * Documentation is sent to LoadCraft as it is, so it must not come from a place that holds
 * something else: a hidden directory (`.docker`, `.config`, `.git`), `node_modules`, or a path
 * git ignores (build output, local secrets).
 */
async function refuseExcludedPath(path: string, shown: string): Promise<void> {
  if (isExcludedPlace(path, shown)) {
    throw new ToolError('document_path_excluded', { params: { file: shown } });
  }
  if (await gitIgnores(path)) {
    throw new ToolError('document_path_ignored', { params: { file: shown } });
  }
}

/** A hidden directory or file, or `node_modules`: a place that holds something other than the project's own files. */
function isExcludedPlace(path: string, shown: string): boolean {
  const segments = shown.split('/');
  const excluded = segments.some(
    (segment, index) =>
      segment === 'node_modules' || (index < segments.length - 1 && segment.startsWith('.')),
  );
  return excluded || basename(path).startsWith('.');
}

/** True only when git says the path is ignored; no git, no repository or a timeout mean "not ignored". */
function gitIgnores(path: string): Promise<boolean> {
  return new Promise((done) => {
    execFile(
      'git',
      ['check-ignore', '-q', '--', path],
      { cwd: dirname(path), timeout: 10_000, windowsHide: true },
      (error) => {
        done(error === null);
      },
    );
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The content of an OpenAPI or AsyncAPI file as parsed JSON. It must look like such a document: a
 * version field (`openapi` or `swagger`; `asyncapi`) and a body (`paths`, `webhooks`, `components`;
 * `info`, `channels`, `operations`, `components`). Any other JSON is refused before it is sent anywhere.
 */
export function parseDocument(bytes: Uint8Array, name: string, kind: UploadKind): unknown {
  let document: unknown;
  try {
    document = JSON.parse(decodeUtf8(Buffer.from(bytes), name));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError('openapi_not_json', { params: { file: name } });
  }
  if (!isPlainObject(document)) throw new ToolError('openapi_not_json', { params: { file: name } });
  const asyncapi = kind === 'asyncapi';
  const versions = asyncapi ? ['asyncapi'] : ['openapi', 'swagger'];
  const bodies = asyncapi
    ? ['info', 'channels', 'operations', 'components']
    : ['paths', 'webhooks', 'components'];
  const versioned = versions.some((key) => typeof document[key] === 'string');
  const hasBody = bodies.some((key) => isPlainObject(document[key]));
  if (!versioned || !hasBody) {
    throw new ToolError(asyncapi ? 'asyncapi_not_asyncapi' : 'openapi_not_openapi', {
      params: { file: name },
    });
  }
  return document;
}

/** Reads an allowed documentation file and checks that its content is such a document. */
export async function readDocumentAllowed(file: AllowedFile): Promise<unknown> {
  return parseDocument(await readBytesAllowed(file), file.name, file.kind);
}

function limitOf(rule: Rule): FileLimit {
  return { bytes: rule.limit, label: rule.limitLabel };
}

/**
 * The location is re-checked, then the same descriptor is opened and must be a regular file, the very
 * one `openAllowed` saw (device and inode) and still within the size limit.
 */
async function reopenChecked(
  file: AllowedFile,
  rule: Rule,
): Promise<{ handle: FileHandle; size: number; shown: string }> {
  const origin = issued.get(file);
  if (origin === undefined) throw new ToolError('file_not_allowed');
  const shown = relativeToWorkspace(origin.root, file.path);
  if (resolveInside(origin.root, file.path) !== file.path) throw fileChanged(shown);
  const opened = await openChecked(file.path, shown, {
    limit: limitOf(rule),
    identity: origin,
  });
  return { ...opened, shown };
}

/** Reads a text-kind file as UTF-8. A leading BOM is dropped; invalid UTF-8 is rejected. */
export async function readTextAllowed(file: AllowedFile): Promise<string> {
  const rule = RULES[file.kind];
  if (!issued.has(file)) throw new ToolError('file_not_allowed');
  if (!rule.text) {
    throw new ToolError('unsupported_file_type', {
      params: { file: file.name, kind: file.kind, extension: rule.extension },
    });
  }

  const { handle, shown } = await reopenChecked(file, rule);
  let bytes: Buffer;
  try {
    bytes = await readLimited(handle, shown, limitOf(rule));
  } finally {
    await handle.close();
  }
  return decodeUtf8(bytes, file.name);
}

/** The bytes of an allowed file, read once through the checked descriptor. */
export async function readBytesAllowed(file: AllowedFile): Promise<Buffer> {
  const rule = RULES[file.kind];
  const { handle, shown } = await reopenChecked(file, rule);
  try {
    return await readLimited(handle, shown, limitOf(rule));
  } finally {
    await handle.close();
  }
}

/**
 * Opens an allowed file for sending and returns the descriptor that passed the checks. The caller
 * streams from it and closes it.
 */
export async function openAllowedForUpload(
  file: AllowedFile,
): Promise<{ handle: FileHandle; size: number }> {
  const { handle, size } = await reopenChecked(file, RULES[file.kind]);
  return { handle, size };
}
