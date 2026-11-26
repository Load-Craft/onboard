// Lists the tools the server exposes (name, title, input parameters, names of nested fields) as the JSON that
// dist/tools.json holds. The list comes from ALL_TOOLS itself: the sources are bundled to a
// temporary module and loaded, so a tool added to or removed from the server changes the list.
// The output must be reproducible: sorted, no dates, no absolute paths.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const TOOLS_OUT = resolve(ROOT, 'dist', 'tools.json');

// A tiny entry next to the sources, so esbuild resolves `zod` and the tools from mcp/.
const ENTRY = `
import * as z from 'zod';
import { ALL_TOOLS } from './src/tools/index.ts';

// Property names found anywhere below a schema node (keys of nested objects an argument takes).
function nested(node, found) {
  if (Array.isArray(node)) {
    for (const item of node) nested(item, found);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        for (const name of Object.keys(value)) found.add(name);
      }
      nested(value, found);
    }
  }
  return found;
}

export const tools = ALL_TOOLS.map((tool) => {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' });
  const params = Object.keys(schema.properties ?? {}).sort();
  const fields = [...nested(schema, new Set())].filter((name) => !params.includes(name)).sort();
  return { name: tool.name, title: tool.title, params, fields };
}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
`;

/** The content of dist/tools.json; `buildTo` is the bundler of build.mjs (passed in, so the two files do not import each other). */
export async function renderTools(buildTo) {
  const dir = await mkdtemp(join(tmpdir(), 'lc-mcp-tools-'));
  try {
    const entry = join(ROOT, `.list-tools-entry-${process.pid}.ts`);
    await writeFile(entry, ENTRY);
    const bundle = join(dir, 'tools.mjs');
    try {
      await buildTo(bundle, entry);
    } finally {
      await rm(entry, { force: true });
    }
    const { tools } = await import(pathToFileURL(bundle).href);
    return `${JSON.stringify({ tools }, null, 2)}\n`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
