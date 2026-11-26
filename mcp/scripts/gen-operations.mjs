// Generates from ../contracts/loadcraft-openapi.json the run-time tables the typed client (api.d.ts)
// cannot give:
//   src/http/generated/operations.ts  `OPERATIONS`: operationId -> method, path, shape of the successful answer
//   src/http/generated/secrets.ts     `SECRET_PATHS`: operationId -> paths of its secret fields, from the
//                                     marks of the snapshot and ../contracts/secret-fields.json
//   node scripts/gen-operations.mjs           writes the files
//   node scripts/gen-operations.mjs --check   generates to memory and exits 1 when a file differs
//   --spec <file> and --out <file> replace the snapshot and the output (used by `npm run sync:api`);
//   secrets.ts is written next to the output, the exceptions are read next to the snapshot
//   (--secret-fields <file> replaces them)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { emitSecrets, secretPathsOf } from './gen-operations/secretPaths.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_SPEC = resolve(ROOT, '..', 'contracts', 'loadcraft-openapi.json');
export const OUT = resolve(ROOT, 'src', 'http', 'generated', 'operations.ts');
const FIELDS_NAME = 'secret-fields.json';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

const HEADER = `/**
 * Generated file - do not edit.
 * Source: contracts/loadcraft-openapi.json. Regenerate with "npm run gen:api" (from mcp/).
 */
`;

const JSON_MEDIA = /(\/|\+)json$/;

function deref(document, schema) {
  let current = schema;
  for (let depth = 0; depth < 10 && typeof current?.$ref === 'string'; depth += 1) {
    current = current.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node, key) => node?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], document);
  }
  return current;
}

/** A string declared under a JSON media type that is really a file: binary, or a non-JSON media type. */
function isFileString(schema) {
  if (schema?.type !== 'string') return false;
  if (schema.format === 'binary') return true;
  const media = schema.contentMediaType;
  return typeof media === 'string' && !JSON_MEDIA.test(media) && !media.startsWith('text/');
}

/**
 * How the body of the first successful (2xx) answer is read: "json", "text" (any text/*),
 * "blob" (any other media type, and a string schema that describes a file even under
 * application/json) or "empty" (no content, e.g. 204).
 */
export function answerKind(operation, document = {}) {
  const statuses = Object.keys(operation.responses ?? {})
    .filter((status) => /^2\d\d$/.test(status))
    .sort();
  for (const status of statuses) {
    const content = operation.responses[status]?.content ?? {};
    const media = Object.keys(content);
    if (media.length === 0) continue;
    const first = media.find((m) => JSON_MEDIA.test(m)) ?? media[0];
    if (JSON_MEDIA.test(first)) {
      return isFileString(deref(document, content[first]?.schema)) ? 'blob' : 'json';
    }
    return first.startsWith('text/') ? 'text' : 'blob';
  }
  return 'empty';
}

/** Rows of every operation of the document, sorted by operationId. */
export function readOperations(document) {
  const rows = new Map();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const id = operation.operationId;
      if (typeof id !== 'string' || id === '') {
        throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
      }
      if (rows.has(id)) throw new Error(`operationId ${id} is used twice`);
      rows.set(id, {
        method: method.toUpperCase(),
        path,
        response: answerKind(operation, document),
      });
    }
  }
  return [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The exceptions of `contracts/secret-fields.json`; none when the file is absent (a document of a test). */
async function readFields(file) {
  const text = await readFile(file, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return undefined;
  const fields = JSON.parse(text);
  return { fields: fields.fields ?? {}, without_fields: fields.without_fields ?? {} };
}

/** The text of `secrets.ts` for the document and the exceptions. */
export async function generateSecrets(spec = DEFAULT_SPEC, fieldsFile = undefined) {
  const document = JSON.parse(await readFile(spec, 'utf8'));
  const fields = await readFields(fieldsFile ?? join(dirname(spec), FIELDS_NAME));
  return emitSecrets(secretPathsOf(document, fields));
}

export async function generate(spec = DEFAULT_SPEC) {
  const document = JSON.parse(await readFile(spec, 'utf8'));
  const rows = readOperations(document).map(
    ([id, { method, path, response }]) =>
      `  ${id}: { method: '${method}', path: '${path}', response: '${response}' },\n`,
  );
  return (
    HEADER +
    `
/** The HTTP method and path of each operation, and how its successful answer is read. */
export const OPERATIONS = {
${rows.join('')}} as const;

export type OperationId = keyof typeof OPERATIONS;
`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : resolve(process.argv[at + 1] ?? '');
  };
  const out = option('--out') ?? OUT;
  const secretsOut = join(dirname(out), 'secrets.ts');
  let text;
  let secrets;
  try {
    text = await generate(option('--spec'));
    secrets = await generateSecrets(option('--spec'), option('--secret-fields'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `gen:operations: ${option('--spec') ?? 'contracts/loadcraft-openapi.json'}: ${message}\n`,
    );
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    for (const [file, expected, name] of [
      [out, text, 'operations.ts'],
      [secretsOut, secrets, 'secrets.ts'],
    ]) {
      const current = await readFile(file, 'utf8').catch(() => null);
      if (current !== expected) {
        process.stderr.write(
          `REST operations: src/http/generated/${name} is out of date: run npm run gen:api and add the file to the commit\n`,
        );
        process.exitCode = 1;
      }
    }
  } else {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text);
    await writeFile(secretsOut, secrets);
  }
}
