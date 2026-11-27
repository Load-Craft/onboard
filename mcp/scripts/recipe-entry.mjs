// Prints what docs/tool-recipe.md needs to know about one tool of the catalog: its template, the
// names and files to use, how each argument is read, and every reason to stop.
//
//   node scripts/recipe-entry.mjs <tool_name>      exit 0: a template was chosen; exit 2: STOP
//
// Reads only; writes nothing.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CATALOG = ['catalog/catalog.json', 'catalog/katalog.json']
  .map((file) => resolve(ROOT, file))
  .find((file) => existsSync(file));

const name = process.argv[2] ?? '';
const catalog = CATALOG === undefined ? { modules: [] } : JSON.parse(readFileSync(CATALOG, 'utf8'));
const module = catalog.modules.find((one) => one.tools.some((tool) => tool.name === name));
const tool = module?.tools.find((one) => one.name === name);

if (tool === undefined) {
  console.log(`STOP S-02 ${name}: the catalog has no such tool`);
  process.exit(2);
}

const camel = (text) => text.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const object = camel(name.slice(module.name.length + 1));
const dashes = name.slice(module.name.length + 1).replaceAll('_', '-');
const verb = name.slice(module.name.length + 1).split('_')[0];
const effect = tool.class.split('+')[0];
const stops = [];

// ---- consent --------------------------------------------------------------------------------
const { consent, undo } = tool;
if (consent.level !== 1) stops.push(`S-03 consent level ${String(consent.level)}`);
if (consent.by_argument !== null) stops.push('S-03 another consent level by argument');
if ((consent.escalate_to_3 ?? []).length > 0) stops.push('S-03 escalates to level 3');

// ---- template -------------------------------------------------------------------------------
const selfUndo = undo.ways.length === 1 && undo.ways[0].tool === name;
let template = null;
if (verb === 'list' && effect === 'read') template = 'LIST';
else if (['get', 'check', 'plan', 'compare'].includes(verb) && effect === 'read') {
  template = 'OBJECT';
} else if (['set', 'update', 'restore'].includes(verb) && effect === 'write' && selfUndo) {
  template = 'SET';
}
// "the list, or one": two modes in one tool. The selector is the optional argument that names one
// object (LIST_OR_OBJECT) or asks for a second list (LIST_OR_LIST).
const LIST_OR_ONE = /the list, or|\bor one\b|: list, one|list \([^)]*\) or one/i;
const NOT_A_SELECTOR = new Set(['query', 'tags', 'limit', 'offset', 'include', 'format']);
const selectors = (tool.arguments ?? [])
  .filter(
    (argument) =>
      ['string', 'uuid', 'uuid|default', 'integer'].includes(argument.type) &&
      argument.from_state === null &&
      argument.required !== true &&
      argument.default === undefined &&
      !NOT_A_SELECTOR.has(argument.name),
  )
  .map((argument) => argument.name);
// "without it, the list" in the doc of a selector that does not name one object: a second list.
const docOf = (selector) =>
  (tool.arguments ?? []).find((argument) => argument.name === selector)?.doc ?? '';
const secondList = selectors.filter(
  (selector) => /without it, the list/i.test(docOf(selector)) && !/^one\b/i.test(docOf(selector)),
);
if (template === 'OBJECT' && verb === 'get' && LIST_OR_ONE.test(tool.description)) {
  template = 'LIST_OR_OBJECT';
} else if (template === 'OBJECT' && verb === 'get' && secondList.length === 1) {
  template = 'LIST_OR_LIST';
}
if (template === null) {
  stops.push(`S-08 no template for verb "${verb}" of class ${tool.class} with this undo`);
}

// ---- arguments ------------------------------------------------------------------------------
const PLAIN = new Set(['integer', 'boolean', 'enum', 'string[]']);
const argumentLines = [];
if (!Array.isArray(tool.arguments)) stops.push('S-02 the catalog names no arguments (null)');
for (const argument of tool.arguments ?? []) {
  const state = argument.from_state;
  let read;
  if (PLAIN.has(argument.type)) {
    read = `args.${argument.name}`;
  } else if (argument.type === 'uuid' && state === null) {
    read = `args.${argument.name}`;
  } else if (argument.type === 'uuid') {
    read = `refId(ctx, '${argument.name}', args.${argument.name}, '${state}').toLowerCase()`;
  } else if (argument.type === 'uuid|run_handle') {
    read = `await runOf(ctx, projectId, args.${argument.name})  (gives { id, run }; input: runIdArgument())`;
  } else if (argument.type === 'string' || argument.type === 'uuid|default') {
    // an id or a name, or an id or a word: read as it is; the template says how to resolve it
    read = `args.${argument.name}`;
  } else {
    read = 'STOP';
    stops.push(`S-02 argument ${argument.name}: type ${argument.type} has no block`);
  }
  const need = argument.required === true ? 'required' : 'optional';
  const fallback =
    argument.default !== undefined
      ? JSON.stringify(argument.default)
      : state !== null
        ? `state ${state}`
        : 'none';
  argumentLines.push(
    `  ${argument.name}: ${argument.type}, ${need}, default ${fallback} -> ${read}`,
    `    doc: ${argument.doc ?? ''}`,
  );
}

// ---- state ----------------------------------------------------------------------------------
if (tool.state_writes.length > 0) {
  stops.push(`S-13 writes state (${tool.state_writes.join(', ')}): the brief must give the update`);
}

const slots = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
const lines = [
  `tool       ${name}`,
  `module     ${module.name}`,
  `class      ${tool.class}  level ${String(consent.level)}`,
  `about      ${tool.description}`,
  `template   ${template ?? 'none'}`,
  ...(template === 'LIST_OR_OBJECT'
    ? [
        `selector   ${selectors.length === 1 ? selectors[0] : `one of: ${selectors.join(', ') || '(none found)'}; the brief names it`}`,
      ]
    : []),
  ...(template === 'LIST_OR_LIST' ? [`selector   ${secondList[0] ?? ''}`] : []),
  `names      <object>=${object}  <Object>=${object[0].toUpperCase()}${object.slice(1)}  <META>=${name.toUpperCase()}  <toolCamel>=${camel(name)}`,
  `files      src/tools/${module.name}/${object}.ts`,
  `           src/render/${module.name}/${object}.ts`,
  `           test/tools/${module.name}/${object}.test.ts`,
  `           docs/tools/${module.name}/${dashes}.md`,
  'arguments',
  ...(argumentLines.length > 0 ? argumentLines : ['  (none)']),
  'operations',
  ...tool.operations.map((one, at) => `  ${String(at + 1)}. ${one.method} ${one.path}`),
  `log        args "${tool.log.args}"  result "${tool.log.result}"`,
  `log slots  args: ${slots(tool.log.args).join(', ') || '-'}  result: ${slots(tool.log.result).join(', ') || '-'}`,
  `undo       ${selfUndo ? `${name} with the previous values` : (undo.reversible ?? 'none')}`,
  `state      writes ${tool.state_writes.join(', ') || '-'}  (reads, for information only: ${tool.state_reads.join(', ') || '-'})`,
  ...stops.map((stop) => `STOP ${stop}`),
];
console.log(lines.join('\n'));
// S-13 alone does not stop the work when the brief gives the update
process.exit(stops.some((stop) => !stop.startsWith('S-13')) ? 2 : 0);
