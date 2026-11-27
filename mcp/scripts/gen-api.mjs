// Generates src/http/generated/api.d.ts from ../contracts/loadcraft-openapi.json.
//   node scripts/gen-api.mjs           writes the file
//   node scripts/gen-api.mjs --check   generates to memory and exits 1 when the file differs
//   --spec <file> and --out <file> replace the snapshot and the output (used by `npm run sync:api`)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_SPEC = resolve(ROOT, '..', 'contracts', 'loadcraft-openapi.json');
export const OUT = resolve(ROOT, 'src', 'http', 'generated', 'api.d.ts');

const HEADER = `/**
 * Generated file - do not edit.
 * Source: contracts/loadcraft-openapi.json. Regenerate with "npm run gen:api" (from mcp/).
 */
`;

export async function generate(spec = DEFAULT_SPEC) {
  // An object schema without properties means "any object"; the default `Record<string, never>` would say "an object with no keys".
  const ast = await openapiTS(pathToFileURL(spec), { emptyObjectsUnknown: true });
  return HEADER + '\n' + astToString(ast);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : resolve(process.argv[at + 1] ?? '');
  };
  const out = option('--out') ?? OUT;
  let text;
  try {
    text = await generate(option('--spec'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `gen:api: ${option('--spec') ?? 'contracts/loadcraft-openapi.json'}: ${message}\n`,
    );
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const current = await readFile(out, 'utf8').catch(() => null);
    if (current !== text) {
      process.stderr.write(
        'REST client: src/http/generated/api.d.ts is out of date: run npm run gen:api and add the file to the commit\n',
      );
      process.exitCode = 1;
    }
  } else {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text);
  }
}
