// The tools of the modules: what the catalog says of them, generated, and a scaffold of a new tool.
//
//   node scripts/gen-tools.mjs                     writes the generated files (below) and creates the
//                                                  files a module owns when they are missing
//   node scripts/gen-tools.mjs --check             exits 1 when a generated file is stale or a file of a
//                                                  module is missing (part of npm run check:catalog)
//   node scripts/gen-tools.mjs --scaffold <tool>   creates the file of a tool of the catalog and its test,
//                                                  and adds the tool to the list of its module
//
// Generated, never edited by hand (one per module of catalog/katalog.json):
//   src/tools/<module>/meta.generated.ts     the catalog entry of every tool of the module
//   src/tools/_generated/modules.ts          the tools of every module, for src/tools/index.ts
//   src/render/i18n/_generated/modules.ts    the dictionaries of every module, for i18n/index.ts
// Owned by the module (created empty once, then written by the module's tasks):
//   src/tools/<module>/index.ts              the list of the module's tools
//   src/render/i18n/<module>.en.ts, .pl.ts   the texts of the module's tools
//   ../skills/loadcraft-test/references/errors-<module>.md   the error codes of the module's tools
// A scaffold (--scaffold) is owned by the module from the start:
//   src/tools/<module>/<object>.ts           the input, a reader per operation; no run, no render yet
//   test/tools/<module>/<object>.test.ts     the catalog entry, and "registered, not implemented"
//
// --root <dir> works in another copy of mcp/ (the tests); --catalog <file> and --contract <file>
// replace catalog/katalog.json and ../contracts/loadcraft-openapi.json. The texts are formatted with
// the prettier configuration of this mcp/, wherever --root points.

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as prettier from 'prettier';

const SCRIPT_ROOT = resolve(import.meta.dirname, '..');

const HEADER = (source) => `/**
 * Generated file - do not edit.
 * Source: ${source}. Regenerate with "npm run gen:tools" (from mcp/).
 */
`;

// Keys a newer catalog has that an older one may lack: the generated entry always carries them.
const LATER_KEYS = {
  arguments: null,
  views: null,
  requires_user_interaction: null,
  install_allow: null,
  shows_content: null,
  known_debt: null,
  annotations: null,
};

const json = (value) => JSON.stringify(value, null, 2);

/** A paragraph as `// ` lines of at most 100 columns. */
function comment(text) {
  const lines = [];
  let line = '//';
  for (const word of text.split(/\s+/)) {
    if (line.length + 1 + word.length > 100 && line !== '//') {
      lines.push(line);
      line = '//';
    }
    line = `${line} ${word}`;
  }
  lines.push(line);
  return lines;
}

/** `get_walks` -> `getWalks`. */
export const camel = (snake) => snake.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

/** `flows_get_walks` -> `FLOWS_GET_WALKS`: the name of a catalog entry in meta.generated.ts. */
export const constantOf = (name) => name.toUpperCase();

/** `flows_get_walks` of module `flows` -> `getWalks`: the base name of the tool's file. */
export function objectOf(tool, module) {
  const rest = tool.startsWith(`${module}_`) ? tool.slice(module.length + 1) : tool;
  return camel(rest);
}

export function pathsOf(root) {
  return {
    catalog: join(root, 'catalog', 'katalog.json'),
    contract: join(root, '..', 'contracts', 'loadcraft-openapi.json'),
    tools: join(root, 'src', 'tools'),
    i18n: join(root, 'src', 'render', 'i18n'),
    tests: join(root, 'test', 'tools'),
    skillReferences: join(root, '..', 'skills', 'loadcraft-test', 'references'),
  };
}

// ---- formatting -----------------------------------------------------------------------------

let prettierOptions;

async function format(text, file) {
  prettierOptions ??= JSON.parse(await readFile(join(SCRIPT_ROOT, '.prettierrc.json'), 'utf8'));
  return prettier.format(text, { ...prettierOptions, filepath: file });
}

// ---- generated files ------------------------------------------------------------------------

// The name a tool had in the first catalog version is the business of the rename map
// (catalog.generated.ts); a module needs only today's name.
const DROPPED = new Set(['v1_name']);

function entryOf(tool, module) {
  const { name, ...all } = tool;
  const rest = Object.fromEntries(Object.entries(all).filter(([key]) => !DROPPED.has(key)));
  const operations = (tool.operations ?? []).map(({ operationId, method, path }) => ({
    operationId,
    method,
    path,
  }));
  const later = Object.fromEntries(
    Object.entries(LATER_KEYS).filter(([key]) => !Object.hasOwn(tool, key)),
  );
  return { name, module, ...rest, operations, ...later };
}

function metaFile(module) {
  const entries = module.tools.map((tool) => {
    const entry = entryOf(tool, module.name);
    return `/** \`${tool.name}\`: ${tool.description.replaceAll('*/', '* /')} */
export const ${constantOf(tool.name)} = ${json(entry)} as const satisfies ToolMeta;\n`;
  });
  return [
    HEADER(`catalog/katalog.json, module ${module.name}`),
    "import type { ToolMeta } from '../moduleTool.js';\n",
    ...entries,
  ].join('\n');
}

function toolsComposition(modules) {
  const imports = modules.map(
    (module) => `import { tools as ${camel(module.name)}Tools } from '../${module.name}/index.js';`,
  );
  const byModule = modules.map((module) => `  ${module.name}: ${camel(module.name)}Tools,`);
  return [
    HEADER('the modules of catalog/katalog.json'),
    "import type { ModuleName } from '../../catalog.generated.js';",
    "import { exposedTools, type ModuleTool } from '../moduleTool.js';",
    ...imports,
    '',
    '/** The tools of each module, as its `index.ts` lists them, the ones not written yet included. */',
    'export const MODULE_INDEX: Readonly<Record<ModuleName, readonly ModuleTool[]>> = {',
    ...byModule,
    '};',
    '',
    '/** Every tool of the modules; one without `run` and `render` answers `not_implemented`. */',
    'export const MODULE_TOOLS: readonly ModuleTool[] = Object.values(MODULE_INDEX).flat();',
    '',
    '/** The tools of the modules the server offers to the client: the written ones only. */',
    'export const EXPOSED_MODULE_TOOLS: readonly ModuleTool[] = exposedTools(MODULE_TOOLS);',
    '',
  ].join('\n');
}

function dictionariesComposition(modules) {
  const imports = modules.flatMap((module) => [
    `import { ${camel(module.name)}En } from '../${module.name}.en.js';`,
    `import { ${camel(module.name)}Pl } from '../${module.name}.pl.js';`,
  ]);
  const parts = modules.map(
    (module) => `  ${module.name}: { en: ${camel(module.name)}En, pl: ${camel(module.name)}Pl },`,
  );
  return [
    HEADER('the modules of catalog/katalog.json'),
    "import type { ModuleName } from '../../../catalog.generated.js';",
    "import type { Entry } from '../core.js';",
    ...imports,
    '',
    'type Dictionary = Readonly<Record<string, Entry>>;',
    '',
    '/** The texts of each module, in both languages. */',
    'export const MODULE_DICTIONARIES: Readonly<',
    '  Record<ModuleName, { readonly en: Dictionary; readonly pl: Dictionary }>',
    '> = {',
    ...parts,
    '};',
    '',
    '/** The texts of every module, in one dictionary per language. */',
    'export const MODULE_TEXTS: { readonly en: Dictionary; readonly pl: Dictionary } = {',
    '  en: Object.fromEntries(',
    '    Object.values(MODULE_DICTIONARIES).flatMap((part) => Object.entries(part.en)),',
    '  ),',
    '  pl: Object.fromEntries(',
    '    Object.values(MODULE_DICTIONARIES).flatMap((part) => Object.entries(part.pl)),',
    '  ),',
    '};',
    '',
  ].join('\n');
}

/** Every generated file: path -> text (unformatted). */
export function generatedFiles(catalog, root) {
  const paths = pathsOf(root);
  const files = new Map();
  for (const module of catalog.modules) {
    files.set(join(paths.tools, module.name, 'meta.generated.ts'), metaFile(module));
  }
  files.set(join(paths.tools, '_generated', 'modules.ts'), toolsComposition(catalog.modules));
  files.set(join(paths.i18n, '_generated', 'modules.ts'), dictionariesComposition(catalog.modules));
  return files;
}

// ---- the files a module owns ----------------------------------------------------------------

function moduleIndex(module) {
  return `// The tools of module ${module}. \`npm run gen:tools -- --scaffold <tool>\` adds a tool here; the server
// offers a tool to the client once its file has \`run\` and \`render\` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';

export const tools: readonly ModuleTool[] = [];
`;
}

function moduleEn(module) {
  return `// Texts of the tools of module ${module}, English: the key set of ${module}.pl.ts. A key starts with the
// name of a tool of the module (\`${module}_list.\`) or with \`${module}.\` for a text its tools share.

import type { Entry } from './core.js';

export const ${camel(module)}En = {} as const satisfies Readonly<Record<string, Entry>>;
`;
}

function modulePl(module) {
  return `// Texts of the tools of module ${module}, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { ${camel(module)}En } from './${module}.en.js';

export const ${camel(module)}Pl: { readonly [K in keyof typeof ${camel(module)}En]: Entry } = {};
`;
}

function moduleErrors(module) {
  return `# Errors of the tools of module ${module}

The codes of the tools of module \`${module}\` start with \`${module}_\`; the codes every tool shares, and the general rules, are in [errors-and-resume.md](errors-and-resume.md). Error results start with \`[code]\` on the first line: look the code up below, then read the hint line under it.

| Code | Meaning and action |
|---|---|
`;
}

/** The files each module owns: path -> text of the empty file. */
export function moduleFiles(catalog, root) {
  const paths = pathsOf(root);
  const files = new Map();
  for (const { name } of catalog.modules) {
    files.set(join(paths.tools, name, 'index.ts'), moduleIndex(name));
    files.set(join(paths.i18n, `${name}.en.ts`), moduleEn(name));
    files.set(join(paths.i18n, `${name}.pl.ts`), modulePl(name));
    files.set(join(paths.skillReferences, `errors-${name}.md`), moduleErrors(name));
  }
  return files;
}

// ---- scaffold -------------------------------------------------------------------------------

const UUID_SAMPLE = '00000000-0000-4000-8000-000000000001';

/** A TypeScript type of a parameter schema of the contract (primitives; anything else: string). */
function typeOfSchema(schema) {
  if (schema === undefined || schema === null) return 'string';
  if (Array.isArray(schema.anyOf)) {
    return [...new Set(schema.anyOf.map(typeOfSchema))].join(' | ');
  }
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';
  return 'string';
}

function operationOf(contract, operation) {
  const item = contract.paths?.[operation.path]?.[operation.method.toLowerCase()];
  if (item === undefined) {
    throw new Error(
      `${operation.operationId}: ${operation.method} ${operation.path} is not in the contract`,
    );
  }
  return item;
}

/** The reader functions of a tool: one per operation, named by its operationId. */
function readersOf(tool, contract) {
  const used = new Map();
  return (tool.operations ?? []).map((operation) => {
    const base = camel(operation.operationId.split('_api_')[0] ?? operation.operationId);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const fn = seen === 0 ? base : `${base}${seen + 1}`;
    const item = operationOf(contract, operation);
    const parameters = item.parameters ?? [];
    const pathParams = parameters.filter((param) => param.in === 'path');
    const query = parameters.filter((param) => param.in === 'query');
    const queryRequired = query.some((param) => param.required === true);
    const hasBody = item.requestBody !== undefined;
    const bodyRequired = item.requestBody?.required === true;
    return { fn, operation, pathParams, query, queryRequired, hasBody, bodyRequired };
  });
}

function readerSource(reader) {
  const { fn, operation, pathParams, query, queryRequired, hasBody, bodyRequired } = reader;
  const id = `'${operation.operationId}'`;
  const params = ['ctx: CallContext'];
  const parts = [];
  if (pathParams.length > 0) {
    const fields = pathParams.map(
      (param) => `readonly ${param.name}: ${typeOfSchema(param.schema)}`,
    );
    params.push(`path: { ${fields.join('; ')} }`);
    parts.push('path');
  }
  if (query.length > 0) {
    params.push(`query${queryRequired ? '' : '?'}: QueryOf<${id}>`);
    parts.push(queryRequired ? 'query' : '...(query === undefined ? {} : { query })');
  }
  if (hasBody) {
    params.push(`body${bodyRequired ? '' : '?'}: BodyOf<${id}>`);
    parts.push(bodyRequired ? 'body' : '...(body === undefined ? {} : { body })');
  }
  const input = parts.length === 0 ? '' : `, { ${parts.join(', ')} }`;
  return `/** ${operation.method} ${operation.path.replace(/^\/api\/v1(?=\/)/u, '')} (REST API v1) */
export function ${fn}(${params.join(', ')}): Promise<OpOutput<${id}>> {
  return callBackend(ctx, ${id}${input});
}
`;
}

/**
 * The arguments of a scaffold: exactly the catalog's. A tool the catalog names none for takes none
 * (only `format`): an argument it needs is added to the catalog first, never chosen in the module.
 */
function argumentsOf(tool, marked = false) {
  return Array.isArray(tool.arguments)
    ? tool.arguments.map((argument) => ({ ...argument, marked }))
    : [];
}

/** The same rule as `asksNothing` of src/tools/moduleTool.ts: level 1, nothing by argument, no escalation. */
function asksNothing(tool) {
  const { consent } = tool;
  return (
    consent.level === 1 &&
    consent.by_argument === null &&
    Array.isArray(consent.escalate_to_3) &&
    consent.escalate_to_3.length === 0
  );
}

/**
 * Whether a call must give the argument. A catalog that marks required arguments (`required: true`
 * on some argument) marks every one: the others are optional. An older catalog marks none: an
 * argument without a default in the state is required. A default makes it optional either way.
 */
function isRequired(argument) {
  if (argument.default !== undefined) return false;
  if (typeof argument.required === 'boolean') return argument.required;
  return argument.marked === true ? false : argument.from_state === null;
}

/** The catalog marks required arguments (`required` on at least one argument of any tool). */
function marksRequired(catalog) {
  return catalog.modules.some((module) =>
    module.tools.some((tool) => (tool.arguments ?? []).some((argument) => 'required' in argument)),
  );
}

const bounds = (argument, low, high) =>
  `${typeof argument[low] === 'number' ? `.min(${String(argument[low])})` : ''}${
    typeof argument[high] === 'number' ? `.max(${String(argument[high])})` : ''
  }`;

/** The zod schema of an argument of the catalog, from its type and its bounds. */
function schemaOf(argument) {
  switch (argument.type) {
    case 'uuid':
      return 'uuidArgument()';
    case 'uuid|baseline':
      return "z.union([uuidArgument(), z.literal('baseline')])";
    case 'uuid|run_handle':
      return 'z.string().min(1).max(64)';
    case 'uuid|run_handle|baseline':
      return 'z.string().min(1).max(64)';
    case 'boolean':
      return 'z.boolean()';
    case 'integer':
      return `z.number().int()${bounds(argument, 'min', 'max')}`;
    case 'enum':
      return Array.isArray(argument.enum) && argument.enum.length > 0
        ? `z.enum(${JSON.stringify(argument.enum)})`
        : 'z.string().min(1)';
    case 'string[]': {
      const item =
        Array.isArray(argument.enum) && argument.enum.length > 0
          ? `z.enum(${JSON.stringify(argument.enum)})`
          : 'z.string().min(1)';
      return `z.array(${item})${typeof argument.max_items === 'number' ? `.max(${String(argument.max_items)})` : ''}`;
    }
    default:
      return `z.string().min(1)${typeof argument.max_length === 'number' ? `.max(${String(argument.max_length)})` : ''}`;
  }
}

function zodOf(argument) {
  const kind =
    argument.type === 'uuid'
      ? ' (UUID)'
      : argument.type === 'uuid|baseline'
        ? ' (a UUID, or "baseline")'
        : argument.type === 'uuid|run_handle'
          ? ' (a UUID, or a handle such as e-1a2b3c4d)'
          : argument.type === 'uuid|run_handle|baseline'
            ? ' (a UUID, a handle such as e-1a2b3c4d, or "baseline")'
            : '';
  const subject = argument.name.endsWith('_id')
    ? `The ${argument.name.replace(/_id$/, '').replaceAll('_', ' ')}${kind}`
    : `\`${argument.name}\`${kind}`;
  const description =
    typeof argument.doc === 'string' && argument.doc.trim() !== ''
      ? argument.doc
      : argument.from_state === null
        ? `${subject}.`
        : `${subject}; default: ${argument.from_state} of the process state.`;
  const optional =
    argument.default !== undefined
      ? `.default(${JSON.stringify(argument.default)})`
      : isRequired(argument)
        ? ''
        : '.optional()';
  return `${argument.name}: ${schemaOf(argument)}${optional}.describe(${JSON.stringify(description)}),`;
}

function sampleOf(argument) {
  if (argument.type === 'uuid') return JSON.stringify(UUID_SAMPLE);
  if (argument.type === 'uuid|baseline') return "'baseline'";
  if (argument.type === 'boolean') return 'true';
  if (argument.type === 'integer')
    return String(typeof argument.min === 'number' ? argument.min : 1);
  if (argument.type === 'enum' && Array.isArray(argument.enum))
    return JSON.stringify(argument.enum[0]);
  if (argument.type === 'string[]') return "['example']";
  return "'example'";
}

/** `List projects, or search…` -> `List projects`: the first clause of the description. */
function titleOf(description) {
  const first = description.split(/[.:;(]/)[0]?.trim() ?? description;
  const clause = first.length > 60 ? (first.split(',')[0] ?? first).trim() : first;
  return clause.length > 60 ? `${clause.slice(0, 59).trimEnd()}…` : clause;
}

function scaffoldSource(tool, module, contract, marked) {
  const object = objectOf(tool.name, module);
  const meta = constantOf(tool.name);
  const readers = readersOf(tool, contract);
  const args = argumentsOf(tool, marked);
  const usesQuery = readers.some((reader) => reader.query.length > 0);
  const usesBody = readers.some((reader) => reader.hasBody);
  const callTypes = [
    ...(usesBody ? ['type BodyOf'] : []),
    'type CallContext',
    ...(usesQuery ? ['type QueryOf'] : []),
  ];
  const imports = [
    ...(args.some((argument) => argument.type !== 'uuid' || argument.default !== undefined)
      ? ["import * as z from 'zod';", '']
      : []),
    ...(readers.length > 0
      ? [
          "import type { OpOutput } from '../../http/operation.js';",
          `import { callBackend, ${callTypes.join(', ')} } from '../moduleCall.js';`,
        ]
      : []),
    `import { moduleTool${args.some((argument) => argument.type === 'uuid' || argument.type === 'uuid|baseline') ? ', uuidArgument' : ''} } from '../moduleTool.js';`,
    `import { ${meta} } from './meta.generated.js';`,
  ];
  const card = tool.consent?.card;
  const header = [
    `\`${tool.name}\` (module ${module}): ${tool.description}`,
    "The name, the description, the class, the consent level, the annotations and the card and log templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the view. Without `run` and `render` the tool is registered but not offered to the client, and a call answers `not_implemented` (docs/module-tools.md: how to write it).",
    `Log: args "${tool.log.args}", result "${tool.log.result}": the data of the result carries the fields.`,
    ...(Array.isArray(tool.arguments)
      ? []
      : [
          'Arguments: the catalog names none for this tool yet, so it takes none (only `format`). An argument it needs is added to the catalog (`arguments`) first, then this file is scaffolded again; it is never chosen here.',
        ]),
    ...(asksNothing(tool)
      ? []
      : [
          `Consent: level ${String(tool.consent.level)}${tool.consent.by_argument === null ? '' : ' (another level by argument)'}${tool.consent.escalate_to_3.length === 0 ? '' : ` (escalates to 3: ${tool.consent.escalate_to_3.join(', ')})`}. This layer draws no consent card, so \`moduleTool\` takes no \`run\` for it: it stays a scaffold, not offered, until the card mechanism exists.`,
        ]),
    ...(card === null || card === undefined
      ? []
      : [`Card: "${card.title}"; fields: ${card.fields.map((field) => field.label).join(', ')}.`]),
  ];
  const lines = [
    ...header.flatMap(comment),
    '',
    ...imports,
    '',
    ...readers.map(readerSource),
    `export const ${camel(tool.name)} = moduleTool(${meta}, {`,
    `  title: ${JSON.stringify(titleOf(tool.description))},`,
    `  input: {${args.length === 0 ? '' : '\n'}${args.map((argument) => `    ${zodOf(argument)}`).join('\n')}${args.length === 0 ? '' : '\n  '}},`,
    '});',
    '',
  ];
  return { object, text: lines.join('\n') };
}

function scaffoldTest(tool, module, marked) {
  const object = objectOf(tool.name, module);
  const name = camel(tool.name);
  const required = argumentsOf(tool, marked).filter(isRequired);
  const args = required.map((argument) => `${argument.name}: ${sampleOf(argument)}`).join(', ');
  const header = comment(
    `\`${tool.name}\` (module ${module}). Written by \`npm run gen:tools -- --scaffold\`: while the tool has no \`run\` and \`render\`, the second case pins it as registered and not implemented. Writing the tool starts by replacing that case with the cases of its view (docs/module-tools.md).`,
  ).join('\n');
  return `${header}

import { describe, expect, it } from 'vitest';

import { ${name} } from '../../../src/tools/${module}/${object}.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig } from '../../helpers/rig.js';

describe('${tool.name}', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(${name});
  });

  it('is registered and not implemented yet: a call answers not_implemented', async () => {
    const r = await toolRig({ tools: [${name}] });
    const result = await r.call('${tool.name}', { ${args} });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^\\[not_implemented\\] /u);
  });
});
`;
}

/** The tools of today's registry (`name: '…'` in a file of src/tools), which a scaffold must not shadow. */
async function legacyToolNames(root) {
  const dir = pathsOf(root).tools;
  const names = new Set();
  const files = readdirSync(dir).filter(
    (file) => file.endsWith('.ts') && !file.startsWith('module'),
  );
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    for (const match of text.matchAll(/^\s{2}name: '([a-z_]+)',$/gm)) names.add(match[1]);
    // `name: TOOL` with `const TOOL = 'flows_migrate_docs'` in the same file
    for (const [, constant] of text.matchAll(/^\s{2}name: ([A-Z_]+),$/gm)) {
      const value = new RegExp(`^const ${constant}(?:: string)? = '([a-z_]+)';$`, 'm').exec(text);
      if (value?.[1] !== undefined) names.add(value[1]);
    }
  }
  return names;
}

const INDEX_LIST = /export const tools: readonly ModuleTool\[\] = \[([^\]]*)\];/;

function addToIndex(text, name, object, module) {
  const list = INDEX_LIST.exec(text);
  if (list === null) {
    throw new Error(
      `src/tools/${module}/index.ts does not hold "export const tools: readonly ModuleTool[] = [...]": add ${name} by hand`,
    );
  }
  const names = (list[1] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (names.includes(name)) throw new Error(`${name} is already in src/tools/${module}/index.ts`);
  const sorted = [...names, name].sort();
  const withList = text.replace(
    INDEX_LIST,
    `export const tools: readonly ModuleTool[] = [${sorted.join(', ')}];`,
  );
  const importLine = `import { ${name} } from './${object}.js';`;
  const lines = withList.split('\n');
  // among the imports of the module's own files, in the order of the names
  const own = lines.findIndex(
    (line) => /^import \{ \w+ \} from '\.\/\w+\.js';$/.test(line) && line > importLine,
  );
  const last = lines.findLastIndex((line) => line.startsWith('import '));
  lines.splice(own === -1 ? last + 1 : own, 0, importLine);
  return lines.join('\n');
}

export async function scaffold(catalog, contract, root, toolName) {
  const module = catalog.modules.find((one) => one.tools.some((tool) => tool.name === toolName));
  if (module === undefined) throw new Error(`${toolName} is not a tool of the catalog`);
  const tool = module.tools.find((one) => one.name === toolName);
  const legacy = await legacyToolNames(root);
  if (legacy.has(toolName)) {
    throw new Error(
      `${toolName} is already a tool of the server (src/tools/*.ts): adapt it there; moving it into module ${module.name} is a task of its own`,
    );
  }
  // a tool that takes over one of today's tools (the migration map) waits until that one leaves
  const replaced = (catalog.migration ?? []).filter(
    (entry) =>
      entry.new.includes(toolName) && entry.current !== toolName && legacy.has(entry.current),
  );
  if (replaced.length > 0) {
    throw new Error(
      `${toolName} takes over ${replaced.map((entry) => entry.current).join(', ')}, still a tool of the server: two tools with one effect would be offered; it moves when that tool is moved (the migration of today's tools)`,
    );
  }
  const paths = pathsOf(root);
  const marked = marksRequired(catalog);
  const { object, text } = scaffoldSource(tool, module.name, contract, marked);
  const toolFile = join(paths.tools, module.name, `${object}.ts`);
  const testFile = join(paths.tests, module.name, `${object}.test.ts`);
  const indexFile = join(paths.tools, module.name, 'index.ts');
  for (const file of [toolFile, testFile]) {
    if (existsSync(file)) throw new Error(`${relative(root, file)} exists: nothing written`);
  }
  if (!existsSync(indexFile)) {
    throw new Error(`${relative(root, indexFile)} is missing: run npm run gen:tools first`);
  }
  const index = addToIndex(await readFile(indexFile, 'utf8'), camel(toolName), object, module.name);
  await mkdir(dirname(testFile), { recursive: true });
  await writeFile(toolFile, await format(text, toolFile));
  await writeFile(testFile, await format(scaffoldTest(tool, module.name, marked), testFile));
  await writeFile(indexFile, await format(index, indexFile));
  return [toolFile, testFile, indexFile];
}

// ---- entry ----------------------------------------------------------------------------------

/** Problems `--check` reports: stale or missing generated files, missing files of a module. */
export async function check(catalog, root) {
  const problems = [];
  for (const [file, text] of generatedFiles(catalog, root)) {
    const current = await readFile(file, 'utf8').catch(() => null);
    if (current !== (await format(text, file))) {
      problems.push(`${relative(root, file)} is out of date: run npm run gen:tools`);
    }
  }
  for (const file of moduleFiles(catalog, root).keys()) {
    if (!existsSync(file))
      problems.push(`${relative(root, file)} is missing: run npm run gen:tools`);
  }
  return problems;
}

export async function generate(catalog, root) {
  const written = [];
  for (const [file, text] of generatedFiles(catalog, root)) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await format(text, file));
    written.push(file);
  }
  for (const [file, text] of moduleFiles(catalog, root)) {
    if (existsSync(file)) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await format(text, file));
    written.push(file);
  }
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const option = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : resolve(argv[at + 1] ?? '');
  };
  const root = option('--root') ?? SCRIPT_ROOT;
  const paths = pathsOf(root);
  const catalog = JSON.parse(await readFile(option('--catalog') ?? paths.catalog, 'utf8'));
  const scaffolds = argv.flatMap((arg, at) => (arg === '--scaffold' ? [argv[at + 1] ?? ''] : []));
  try {
    if (argv.includes('--check')) {
      const problems = await check(catalog, root);
      for (const problem of problems) process.stderr.write(`gen:tools: ${problem}\n`);
      if (problems.length > 0) process.exitCode = 1;
    } else if (scaffolds.length > 0) {
      const contract = JSON.parse(await readFile(option('--contract') ?? paths.contract, 'utf8'));
      for (const name of scaffolds) {
        for (const file of await scaffold(catalog, contract, root, name)) {
          process.stdout.write(`${relative(root, file)}\n`);
        }
      }
    } else {
      for (const file of await generate(catalog, root)) {
        process.stdout.write(`${relative(root, file)}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`gen:tools: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
