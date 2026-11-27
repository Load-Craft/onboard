// What a run of an exported project needs that the ZIP does not hold, read from the project's own
// `application.conf`: the dataset files it reads (the ZIP leaves them out on purpose: they hold real
// values) and the environment variables it takes from the machine. Only NAMES are taken: a file name of
// a dataset, a variable name, the folder of the configuration. The ZIP is third-party content, so it
// is opened narrowly and defensively: the central directory is read, one entry (`application.conf`,
// at most 1 MiB unpacked, stored or deflated) is unpacked in memory, nothing is extracted to disk, no
// other file name is kept, and anything that does not look like a name (a pattern below) is dropped.
// A ZIP that does not open this way gives no recipe, never an error.

import { inflateRawSync } from 'node:zlib';

/** What `application.conf` asks the person running the project to bring. */
export interface ProjectRecipe {
  /** The folder of `application.conf` inside the project; the dataset files go there. */
  readonly folder: string;
  /** Dataset files the configuration reads. */
  readonly datasetFiles: readonly string[];
  /** Environment variables the configuration reads (names only). */
  readonly envVars: readonly string[];
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;
const MAX_ENTRIES = 5000;
const MAX_CONF_BYTES = 1024 * 1024;
const MAX_ITEMS = 30;

const CONF_NAME = /(?:^|\/)application\.conf$/u;
/** A relative path of plain segments; no `..`, no absolute path, no odd characters. */
const SAFE_PATH = /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}\/){0,8}[A-Za-z0-9_][A-Za-z0-9_.-]{0,60}$/u;
const DATA_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}\.(?:csv|tsv|ssv|json)$/u;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,80}$/u;

/** The unpacked bytes of the entry `application.conf` (the shortest path wins), or undefined. */
function readConf(zip: Uint8Array): { path: string; text: string } | undefined {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (
    let at = zip.byteLength - 22;
    at >= Math.max(0, zip.byteLength - 22 - MAX_COMMENT);
    at -= 1
  ) {
    if (view.getUint32(at, true) === EOCD) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = view.getUint16(eocd + 10, true);
  const directory = view.getUint32(eocd + 16, true);
  // ZIP64 (a size or an offset that does not fit) is not read
  if (count === 0xffff || directory === 0xffffffff || directory >= zip.byteLength) return undefined;
  let found:
    { path: string; method: number; size: number; packed: number; local: number } | undefined;
  let at = directory;
  for (let index = 0; index < Math.min(count, MAX_ENTRIES); index += 1) {
    if (at + 46 > zip.byteLength || view.getUint32(at, true) !== CENTRAL) break;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const path = Buffer.from(zip.subarray(at + 46, at + 46 + nameLength)).toString('utf8');
    if (CONF_NAME.test(path) && SAFE_PATH.test(path)) {
      if (found === undefined || path.length < found.path.length) {
        found = {
          path,
          method: view.getUint16(at + 10, true),
          packed: view.getUint32(at + 20, true),
          size: view.getUint32(at + 24, true),
          local: view.getUint32(at + 42, true),
        };
      }
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (found === undefined || found.size > MAX_CONF_BYTES) return undefined;
  const local = found.local;
  if (local + 30 > zip.byteLength || view.getUint32(local, true) !== LOCAL) return undefined;
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const packed = zip.subarray(start, start + found.packed);
  if (packed.byteLength !== found.packed) return undefined;
  if (found.method === 0) return { path: found.path, text: Buffer.from(packed).toString('utf8') };
  if (found.method === 8) {
    const raw = inflateRawSync(packed, { maxOutputLength: MAX_CONF_BYTES });
    return { path: found.path, text: raw.toString('utf8') };
  }
  return undefined;
}

const uniqueSorted = (items: Iterable<string>): string[] =>
  [...new Set(items)].sort().slice(0, MAX_ITEMS);

/** The dataset files and the environment variables an `application.conf` names. */
export function parseConf(text: string): { datasetFiles: string[]; envVars: string[] } {
  const files: string[] = [];
  const vars: string[] = [];
  for (const line of text.split('\n')) {
    const code = line.trim();
    if (code === '' || code.startsWith('#') || code.startsWith('//')) continue;
    for (const match of code.matchAll(/[=:]\s*["']?([^"'\s,#}]+)["']?/gu)) {
      const file = match[1] ?? '';
      if (DATA_FILE.test(file)) files.push(file);
    }
    for (const match of code.matchAll(/\$\{\??([A-Z][A-Z0-9_]*)\}/gu)) {
      const name = match[1] ?? '';
      if (ENV_NAME.test(name)) vars.push(name);
    }
  }
  return { datasetFiles: uniqueSorted(files), envVars: uniqueSorted(vars) };
}

/** The recipe of a project ZIP; undefined when the ZIP has no readable `application.conf`. */
export function readRecipe(zip: Uint8Array): ProjectRecipe | undefined {
  try {
    const conf = readConf(zip);
    if (conf === undefined) return undefined;
    const slash = conf.path.lastIndexOf('/');
    const { datasetFiles, envVars } = parseConf(conf.text);
    return { folder: slash < 0 ? '.' : conf.path.slice(0, slash), datasetFiles, envVars };
  } catch {
    return undefined;
  }
}
