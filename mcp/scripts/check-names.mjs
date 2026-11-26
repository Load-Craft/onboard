// Counts occurrences of old tool names and of the old server name across the plugin repository.
//
// Old tool names: today's tools (CURRENT_TOOL_NAMES in src/catalog.generated.ts, without the
// helper files: the names CURRENT_KIND marks as 'helper') plus every entry of the rename map
// (V1_NAME_TO_TOOL in the same module) whose old name differs from the new one.
// Old server name: `loadcraft` in `plugin_loadcraft_loadcraft` / `plugin:loadcraft:loadcraft`.
//
// Reporting mode by default; --strict exits 1 on any hit; --json prints the report as JSON.
// --root <dir> scans another tree (the test uses a fixture); the names are read from
// <root>/mcp/src/catalog.generated.ts.
//
// Only files tracked by git are counted (`git ls-files` run in the root), so untracked leftovers
// such as an executor's results directory or a stray printout do not change the result. When the
// root is not the top of a git work tree (a test fixture without git), the script falls back to
// walking the disk.
//
// Excluded beyond the brief: this script and its test (they hold the names as literals), the
// catalog (mcp/catalog: the rename map and the operation kinds are the reference, not usage), its
// copy of the state schema (mcp/src/workspace/processState.ts) and the test of the rename map
// (mcp/test/catalog.generated.test.ts), and the code generated from contracts/ (mcp/src/http/generated,
// mcp/src/ws/generated: backend names, excluded like the contracts themselves).
// Not excluded on purpose: test fixtures, evals, snapshots, all other text files. Inside them the
// uses of a name that are not the tool (NON_TOOL_CONTEXTS: an operation kind such as `self_check`,
// a backend value such as the plan action `provision_accounts`, HAR timings, pane keys) are left
// out of the count.

import { execFile } from 'node:child_process';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Common words: counted only as a quoted literal or as the ending of a full tool name (`__wait`).
const COMMON_WORDS = new Set(['wait', 'cancel', 'self_check']);

const SERVER_NAME = /plugin[_:]loadcraft[_:]loadcraft/g;

/**
 * Text that holds an old tool name without meaning the tool; blanked out before counting. Each
 * pattern is a use the plugin keeps after the rename: the operation kind `self_check` (handles
 * `<kind>:<id>`, kind lists, the scenario milestone), the backend values `self_check` (run source,
 * scenario field) and `provision_accounts` (an action of the data plan), the `wait` timing of a HAR
 * entry (a JSON key with a number of milliseconds; any other `wait` key counts), pane buttons, actions
 * and views called `cancel`, the `cancel` method of an operation kind, and the `cancel` action of an
 * elicitation answer (`{ action: 'cancel' }`, next to `accept` and `decline` in the MCP protocol).
 */
export const NON_TOOL_CONTEXTS = [
  /\b(?:kind|source)['"]?\]?\s*(?::|===|!==|==)\s*['"](?:self_check|provision_accounts)['"]/g,
  /['"]self_check['"]\s*\||\|\s*['"]self_check['"]/g,
  /['"](?:scenario_generation|scenario_contract_v2)['"],\s*['"]self_check['"]/g,
  /['"]self_check['"],\s*['"](?:record_run|drift_check|generator_state)['"]/g,
  /Omit<[^>]*'self_check'>|\.start\('self_check'|'scenario',\s*'self_check'|SOURCE = 'self_check'|\['self_check'\]/g,
  /"wait"\s*:\s*\d/g,
  /\b(?:key|kind|view|type)['"]?\s*(?::|===|!==)\s*['"](?:wait|cancel)['"]|"key":"cancel"/g,
  /`self_check` (?:field|document|state)\b/g,
  /`cancel` of the kind|the kind's `cancel`|`cancel` only:|`cancel`\s*\n\/\/ :\d|the old `wait`/g,
  /\baction['"]?\s*:\s*['"]cancel['"]/g,
  /order\.push\('cancel'\)|\['secrets', 'secrets', 'cancel'\]|b\.key\)\)\.not\.toContain\('cancel'\)|needle of \['cancel'/g,
];

const MAP_FILE = join('mcp', 'src', 'catalog.generated.ts');
const EXCLUDED_PREFIXES = [
  'mcp/gate-reports',
  'contracts',
  'mcp/dist',
  MAP_FILE,
  'mcp/catalog',
  'mcp/src/workspace/processState.ts',
  'mcp/test/catalog.generated.test.ts',
  'mcp/src/http/generated',
  'mcp/src/ws/generated',
  'mcp/scripts/check-names.mjs',
  'mcp/test/checkNames.test.ts',
];
const SKIP_DIRS = new Set(['node_modules', '.git']);

export function parseRenameMap(source) {
  const block = source.match(/V1_NAME_TO_TOOL[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('V1_NAME_TO_TOOL not found in the catalog module');
  const renames = [];
  for (const m of block[1].matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    if (m[1] !== m[2]) renames.push({ old: m[1], new: m[2] });
  }
  return renames;
}

/** Names CURRENT_KIND marks as helper files: they are not tools, so they are not counted. */
export function parseHelperNames(source) {
  const block = source.match(/CURRENT_KIND[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('CURRENT_KIND not found in the catalog module');
  return new Set([...block[1].matchAll(/"([^"]+)":\s*"helper"/g)].map((m) => m[1]));
}

export function parseCurrentNames(source) {
  const block = source.match(/CURRENT_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('CURRENT_TOOL_NAMES not found in the catalog module');
  const helpers = parseHelperNames(source);
  const names = [];
  for (const m of block[1].matchAll(/"([^"]+)"/g)) {
    if (!helpers.has(m[1])) names.push(m[1]);
  }
  return names;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toolPattern(name) {
  if (COMMON_WORDS.has(name)) {
    return new RegExp(`['"\`]${escapeRe(name)}['"\`]|__${escapeRe(name)}(?![A-Za-z0-9_])`, 'g');
  }
  // A whole word, or the name right after `__` (the ending of a full tool name such as mcp__…__init_project).
  return new RegExp(`(?:(?<![A-Za-z0-9_])|(?<=__))${escapeRe(name)}(?![A-Za-z0-9_])`, 'g');
}

export function countInText(text, oldNames) {
  const server = (text.match(SERVER_NAME) ?? []).length;
  let kept = text;
  for (const pattern of NON_TOOL_CONTEXTS)
    kept = kept.replace(pattern, (m) => ' '.repeat(m.length));
  let tools = 0;
  const byName = {};
  for (const name of oldNames) {
    const count = (kept.match(toolPattern(name)) ?? []).length;
    if (count === 0) continue;
    tools += count;
    byName[name] = count;
  }
  return { tools, server, byName };
}

function isExcluded(rel) {
  return EXCLUDED_PREFIXES.some(
    (p) => rel === p || rel.startsWith(p + sep) || rel.startsWith(p + '/'),
  );
}

function areaOf(rel) {
  const parts = rel.split(sep).join('/').split('/');
  if (parts.length === 1) return parts[0];
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : `${parts[0]}/`;
}

// Files tracked by git, relative to root; null when root is not the top of a git work tree.
async function trackedFiles(root) {
  try {
    const opts = { cwd: root, maxBuffer: 64 * 1024 * 1024 };
    const top = (await run('git', ['rev-parse', '--show-toplevel'], opts)).stdout.trim();
    if (resolve(top) !== (await realpath(root))) return null;
    const { stdout } = await run('git', ['ls-files', '-z'], opts);
    return stdout.split('\0').filter((f) => f !== '');
  } catch {
    return null;
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

export async function scan(root, renames, currentNames) {
  const oldNames = [...new Set([...currentNames, ...renames.map((r) => r.old)])];
  const areas = new Map();
  const names = {};
  const tracked = await trackedFiles(root);
  const paths = tracked ? tracked.map((f) => join(root, f)) : walk(root);
  for await (const path of paths) {
    const rel = relative(root, path).split(sep).join('/');
    if (isExcluded(rel)) continue;
    const buf = await readFile(path).catch(() => null);
    if (buf === null) continue;
    if (buf.includes(0)) continue;
    const { tools, server, byName } = countInText(buf.toString('utf8'), oldNames);
    if (tools === 0 && server === 0) continue;
    for (const [name, count] of Object.entries(byName)) names[name] = (names[name] ?? 0) + count;
    const area = areaOf(rel);
    if (!areas.has(area)) areas.set(area, { area, files: 0, tool_names: 0, server_name: 0 });
    const a = areas.get(area);
    a.files += 1;
    a.tool_names += tools;
    a.server_name += server;
  }
  const list = [...areas.values()].sort(
    (x, y) => y.tool_names + y.server_name - (x.tool_names + x.server_name),
  );
  return {
    root,
    areas: list,
    total_files: list.reduce((s, a) => s + a.files, 0),
    total_tool_names: list.reduce((s, a) => s + a.tool_names, 0),
    total_server_name: list.reduce((s, a) => s + a.server_name, 0),
    names,
  };
}

function formatTable(report) {
  const rows = [['obszar', 'pliki', 'nazwy narzędzi', 'nazwa serwera']];
  for (const a of report.areas)
    rows.push([a.area, String(a.files), String(a.tool_names), String(a.server_name)]);
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = rows.map((r) => r.map((c, i) => c.padEnd(widths[i])).join('  '));
  lines.push(
    `razem: ${report.total_files} plików, ${report.total_tool_names} wystąpień nazw narzędzi, ` +
      `${report.total_server_name} wystąpień nazwy serwera`,
  );
  const byName = Object.entries(report.names).sort((x, y) => y[1] - x[1]);
  if (byName.length > 0) lines.push(`nazwy: ${byName.map(([n, c]) => `${n} ${c}`).join(', ')}`);
  return lines.join('\n') + '\n';
}

async function main(argv) {
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const rootIdx = argv.indexOf('--root');
  const defaultRoot = resolve(import.meta.dirname, '..', '..');
  const root = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : defaultRoot;
  const mapPath = join(root, MAP_FILE);
  await stat(mapPath);
  const source = await readFile(mapPath, 'utf8');
  const report = await scan(root, parseRenameMap(source), parseCurrentNames(source));
  process.stdout.write(asJson ? JSON.stringify(report, null, 2) + '\n' : formatTable(report));
  const hits = report.total_tool_names + report.total_server_name;
  if (strict && hits > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await main(process.argv.slice(2));
}
