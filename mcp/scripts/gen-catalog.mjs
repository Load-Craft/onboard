// Generates src/catalog.generated.ts from catalog/katalog.json.
//   node scripts/gen-catalog.mjs           writes the file
//   node scripts/gen-catalog.mjs --check   generates to memory and exits 1 when the file differs
//   --check also compares the process-state schema: catalog/stan-procesu.ts, its copy in
//   src/workspace/processState.ts and the fingerprint in catalog/stan-procesu.sha256
//   --catalog <file> and --out <file> replace the input and the output (used by the tests);
//   --state, --state-copy and --state-sha replace the three state-schema files

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { EXCLUDED_OPERATIONS } from './sync-api/excluded.ts';

const ROOT = resolve(import.meta.dirname, '..');
export const CATALOG_FILE = resolve(ROOT, 'catalog', 'katalog.json');
export const OUT = resolve(ROOT, 'src', 'catalog.generated.ts');
export const STATE_FILE = resolve(ROOT, 'catalog', 'stan-procesu.ts');
export const STATE_COPY = resolve(ROOT, 'src', 'workspace', 'processState.ts');
export const STATE_SHA = resolve(ROOT, 'catalog', 'stan-procesu.sha256');

// Fields the plugin code does not read at run time (the route table, the state map and the
// operation lists stay in katalog.json for the maintainers' tools).
const DROPPED = new Set(['operations', 'also_calls', 'channels', 'state_reads', 'state_writes']);

// The catalog says how an entry of `migration` changed in Polish; the generated file carries a
// fixed English tag, so the code never matches Polish text.
const CHANGE_TAGS = {
  'zmienia nazwę': 'rename',
  'zmienia nazwę i rolę': 'rename_and_role',
  'dzieli się': 'split',
  'łączy się': 'merge',
  biblioteka: 'library',
};

const HEADER = `/**
 * Generated file - do not edit.
 * Source: catalog/katalog.json. Regenerate with "npm run gen:catalog" (from mcp/).
 */
`;

const TYPES = `export interface CatalogCardField {
  readonly label: string;
  readonly from: string;
  readonly source: string;
}

export interface CatalogCard {
  readonly title: string;
  readonly fields: readonly CatalogCardField[];
  readonly cost?: string;
}

export interface CatalogConsent {
  readonly level: 1 | 2 | 3;
  readonly level3_reason: string | null;
  readonly by_argument: {
    readonly when: string;
    readonly level: 1 | 2 | 3;
    readonly why: string | null;
    readonly card: CatalogCard | null;
  } | null;
  readonly escalate_to_3: readonly string[];
  readonly target_traffic: string | null;
  readonly scope: { readonly group: string; readonly target: string | null } | null;
  readonly cost: string | null;
  readonly card: CatalogCard | null;
  readonly resolve: readonly Readonly<Record<string, unknown>>[];
  readonly snapshot: boolean;
  readonly follow_ups: readonly ToolName[];
  readonly freeze: readonly Readonly<Record<string, unknown>>[];
  /** The most items one call of the tool may name (a delete); null when the catalog sets no limit. */
  readonly max_items: number | null;
}

export interface CatalogUndo {
  readonly reversible: string | null;
  readonly ways: readonly Readonly<Record<string, unknown>>[];
  readonly reason: string | null;
}

export interface CatalogTool {
  readonly name: ToolName;
  readonly module: ModuleName;
  readonly full_name: string;
  readonly v1_name: string | null;
  readonly tier: 'core' | 'pipeline' | 'extended';
  readonly audience: 'model' | 'mod';
  readonly always_load: boolean;
  readonly kind: 'atomic' | 'composite' | 'process';
  readonly class:
    | 'read'
    | 'write'
    | 'destructive'
    | 'costly'
    | 'read+secret'
    | 'write+secret'
    | 'costly+secret';
  readonly safety: string;
  readonly secret: boolean;
  readonly consent: CatalogConsent;
  readonly undo: CatalogUndo;
  readonly log: { readonly args: string; readonly result: string };
  readonly route: string | null;
  readonly description: string;
  /** Tools the result of this one names as the next step. */
  readonly next_steps: readonly ToolName[];
  /** The backend operations a tool still waits for (an id of the plan); null when none. */
  readonly pending_operations: string | null;
  /** The capability of \`GET /api/v1/meta\` the tool needs; null when it needs none. */
  readonly requires_capability: string | null;
  /** A deviation of the tool from its catalog entry the maintainers know of (in words); null when none. */
  readonly known_debt: string | null;
  /** The tool asks the user in a dialog of the client (a server question), so it cannot run without one. */
  readonly requires_user_interaction: boolean;
  /** The install instructions list the tool as allowed without a permission prompt. */
  readonly install_allow: boolean;
  /** The paged lists a tool returns beside its text: which detail, the item type and the page size. */
  readonly views: readonly Readonly<Record<string, unknown>>[] | null;
  /** The arguments of the tool that the process state fills when the caller omits them. */
  readonly arguments:
    | readonly {
        readonly name: string;
        readonly type: string;
        readonly from_state: string | null;
        /** Further facts of the argument (doc, required, default, enum, min, max, …). */
        readonly [key: string]: unknown;
      }[]
    | null;
  /** The content of a third party the tool shows, and what is done with a part the plugin cannot read. */
  readonly shows_content: {
    readonly what: string;
    readonly unrecognized: string;
  } | null;
  /**
   * The MCP hints the catalog fixes, with the reason when they differ from the class; absent in a
   * catalog that does not give them (the hints then follow the class and the level).
   */
  readonly annotations?: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly override_reason: string | null;
  } | null;
}

export interface CatalogModule {
  readonly name: ModuleName;
  readonly tier: 'core' | 'pipeline' | 'extended';
  readonly subagent: string | null;
  readonly skill: string;
  readonly state_in: string;
  readonly state_out: string;
  readonly subagent_tools: readonly ToolName[] | null;
  readonly subagent_tools_default_mode: readonly ToolName[] | null;
  readonly subagent_model: string | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly tools: readonly ToolName[];
}

export interface StateInvalidation {
  readonly event: string;
  readonly triggers: readonly string[];
  readonly invalidates: readonly string[];
}

/**
 * When a check is required: always (true), never (false), or while the state field \`when\` (a path in the
 * process, such as choices.flows.method) holds one of the values \`in\`.
 */
export type CheckRequired =
  | boolean
  | { readonly when: string; readonly in: readonly (string | boolean)[] };

/** A check a step stores under steps.<module>.<check>. */
export interface StateCheck {
  readonly path: string;
  readonly module: ModuleName;
  readonly check: string;
  readonly type: string;
  readonly description: string;
  readonly writers: readonly string[];
  readonly readers: readonly string[];
  readonly required: CheckRequired;
}

export interface WsFrame {
  readonly channel: string;
  readonly frame: string;
  readonly effect: string;
  readonly resume: string;
}

/** A problem code with a fixed rule: its severity, its fields, and the tools that set, clear and show it. */
export interface ProblemCode {
  readonly code: string;
  readonly severity: 'blocker' | 'warning';
  readonly fields: readonly string[];
  readonly set_by: readonly string[];
  readonly cleared_by: readonly string[];
  readonly shown_by: readonly string[];
}
`;

const json = (value) => JSON.stringify(value, null, 2);
// What the registration layer needs for an entry of the log of calls, per tool: a small slice of
// the catalog, so the server bundle does not carry the whole catalog for it.
function logMetaOf(tools, byName) {
  return Object.fromEntries(
    tools.map((tool) => {
      const ways = tool.undo.ways.map((way) => {
        const undoer = byName[way.tool];
        if (undoer === undefined)
          throw new Error(`undo of ${tool.name} names unknown tool ${way.tool}`);
        return { tool: way.tool, how: way.how, for: way.for, level: undoer.consent.level };
      });
      return [
        tool.name,
        {
          module: tool.module,
          level: tool.consent.level,
          class: tool.class,
          log: { args: tool.log.args, result: tool.log.result },
          undo: ways,
        },
      ];
    }),
  );
}

const list = (name, type, items) => `export const ${name}: readonly ${type}[] = ${json(items)};\n`;

// A condition of `required` is data, never words: `{when: 'choices.<module>.<field>', in: [values]}`.
function requiredOf(path, required) {
  if (typeof required === 'boolean') return required;
  const shaped =
    typeof required === 'object' &&
    required !== null &&
    Object.keys(required).sort().join(',') === 'in,when' &&
    typeof required.when === 'string' &&
    /^choices(\.[a-z_]+)+$/.test(required.when) &&
    Array.isArray(required.in) &&
    required.in.length > 0 &&
    required.in.every((value) => typeof value === 'string' || typeof value === 'boolean');
  if (!shaped) throw new Error(`check ${path}: required is not true, false or {when, in}`);
  return { when: required.when, in: required.in };
}

function checksOf(fields) {
  return fields
    .filter((field) => 'required' in field)
    .map((field) => {
      const [, module, check] = /^steps\.([a-z]+)\.([a-z_]+)$/.exec(field.path) ?? [];
      if (module === undefined || check === undefined) {
        throw new Error(`check path is not steps.<module>.<check>: ${field.path}`);
      }
      const { path, type, description, writers, readers } = field;
      const required = requiredOf(path, field.required);
      return { path, module, check, type, description, writers, readers, required };
    });
}

// A problem code is data the reducer's callers read: the severity is one of two, every list is a list of names.
function problemCodesOf(codes = []) {
  return codes.map((entry) => {
    const {
      code,
      severity,
      fields,
      set_by: setBy,
      cleared_by: clearedBy,
      shown_by: shownBy,
    } = entry;
    if (typeof code !== 'string' || !/^[a-z][a-z0-9_]*$/.test(code)) {
      throw new Error(`problem code "${String(code)}" is not a snake_case name`);
    }
    if (severity !== 'blocker' && severity !== 'warning') {
      throw new Error(
        `problem code ${code}: severity "${String(severity)}" is not blocker or warning`,
      );
    }
    const names = (list, key) => {
      if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) {
        throw new Error(`problem code ${code}: ${key} is not a list of names`);
      }
      return list;
    };
    return {
      code,
      severity,
      fields: names(fields, 'fields'),
      set_by: names(setBy, 'set_by'),
      cleared_by: names(clearedBy, 'cleared_by'),
      shown_by: names(shownBy, 'shown_by'),
    };
  });
}

// What an entry of `migration` names: a tool of today, or a helper file of the plugin (not a tool).
const MIGRATION_KINDS = new Set(['tool', 'helper']);

function migrationOf(migration, toolNames) {
  if (!Array.isArray(migration) || migration.length === 0) {
    throw new Error('katalog.json has no "migration" section');
  }
  const seen = new Set();
  return migration.map(({ current, kind, change, new: targets }) => {
    const tag = CHANGE_TAGS[change];
    if (tag === undefined) throw new Error(`migration: unknown change "${change}" for ${current}`);
    if (!MIGRATION_KINDS.has(kind)) {
      throw new Error(`migration: ${current} has kind "${String(kind)}", not tool or helper`);
    }
    if (typeof current !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(current)) {
      throw new Error(`migration: "${String(current)}" is not a bare name`);
    }
    if (seen.has(current)) throw new Error(`migration: ${current} appears twice`);
    seen.add(current);
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error(`migration: ${current} has no new tools`);
    }
    const unknown = targets.filter((name) => !toolNames.includes(name));
    if (unknown.length > 0) {
      throw new Error(`migration: ${current} names unknown tools: ${unknown.join(', ')}`);
    }
    return { current, kind, change: tag, new: targets };
  });
}

export function render(catalog) {
  const tools = catalog.modules.flatMap((module) =>
    module.tools.map((tool) => {
      const kept = Object.fromEntries(Object.entries(tool).filter(([key]) => !DROPPED.has(key)));
      // `module` goes second, after `name`, so a diff of the catalog reads top-down.
      const { name, ...rest } = kept;
      return { name, module: module.name, ...rest };
    }),
  );
  const toolNames = tools.map((tool) => tool.name);
  const moduleNames = catalog.modules.map((module) => module.name);
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const v1 = Object.fromEntries(
    tools.filter((tool) => tool.v1_name !== null).map((tool) => [tool.v1_name, tool.name]),
  );
  const names = (predicate) => tools.filter(predicate).map((tool) => tool.name);
  const alwaysLoad = catalog.core_always_load;
  const missing = alwaysLoad.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`core_always_load names unknown tools: ${missing.join(', ')}`);
  }

  const migration = migrationOf(catalog.migration, toolNames);
  const currentNames = migration.map((entry) => entry.current);
  const currentToTools = Object.fromEntries(migration.map((entry) => [entry.current, entry.new]));
  const currentChange = Object.fromEntries(migration.map((entry) => [entry.current, entry.change]));
  const currentKind = Object.fromEntries(migration.map((entry) => [entry.current, entry.kind]));

  const modules = Object.fromEntries(
    catalog.modules.map((module) => [
      module.name,
      {
        ...Object.fromEntries(Object.entries(module).filter(([key]) => key !== 'tools')),
        tools: module.tools.map((tool) => tool.name),
      },
    ]),
  );

  const catalogOperationIds = [
    ...new Set([
      ...catalog.modules.flatMap((module) =>
        module.tools.flatMap((tool) => (tool.operations ?? []).map((op) => op.operationId)),
      ),
      ...catalog.excluded.operations.map((op) => op.operationId),
    ]),
  ]
    // An operation the public snapshot leaves out (sync-api/excluded.ts) has no client type.
    .filter((id) => !EXCLUDED_OPERATIONS.some((entry) => entry.operationId === id))
    .sort();
  const catalogChannelIds = [
    ...new Set([
      ...catalog.modules.flatMap((module) => module.tools.flatMap((tool) => tool.channels ?? [])),
      ...catalog.excluded.channels.map((entry) => entry.channel),
    ]),
  ].sort();

  return [
    HEADER,
    `import type { OperationId } from './http/generated/operations.js';
import type { ChannelId } from './ws/generated/channels.js';\n`,
    `export const TOOL_NAMES = ${json(toolNames)} as const;\n`,
    'export type ToolName = (typeof TOOL_NAMES)[number];\n',
    `export const MODULE_NAMES = ${json(moduleNames)} as const;\n`,
    'export type ModuleName = (typeof MODULE_NAMES)[number];\n',
    TYPES,
    `export const CATALOG: Readonly<Record<ToolName, CatalogTool>> = ${json(byName)};\n`,
    `export const MODULES: Readonly<Record<ModuleName, CatalogModule>> = ${json(modules)};\n`,
    `/** One way to undo a write: the tool, how (in words), what it undoes, and the consent level of the tool. */
export interface LogMetaUndo {
  readonly tool: ToolName;
  readonly how: string;
  readonly for: string;
  readonly level: 1 | 2 | 3;
}

/** The slice of a catalog entry the log of calls reads (module, consent level, class, templates, undo). */
export interface LogMeta {
  readonly module: ModuleName;
  readonly level: 1 | 2 | 3;
  readonly class: CatalogTool['class'];
  readonly log: { readonly args: string; readonly result: string };
  readonly undo: readonly LogMetaUndo[];
}

export const LOG_META: Readonly<Record<ToolName, LogMeta>> = ${json(logMetaOf(tools, byName))};\n`,
    `export const STATE_INVALIDATIONS: readonly StateInvalidation[] = ${json(catalog.state.invalidations)};\n`,
    `export const CHECKS: readonly StateCheck[] = ${json(checksOf(catalog.state.fields))};\n`,
    `export const WS_FRAMES: readonly WsFrame[] = ${json(catalog.state.ws_frames)};\n`,
    `export const PROBLEM_CODES: readonly ProblemCode[] = ${json(problemCodesOf(catalog.state.problem_codes))};\n`,
    `/**
 * The name a tool had in the FIRST catalog version, mapped to its name in this catalog. NOT today's
 * shipped tools: those are in CURRENT_TO_TOOLS.
 */
export const V1_NAME_TO_TOOL: Readonly<Record<string, ToolName>> = ${json(v1)};\n`,
    `/**
 * The names of today's tools and helper files (CURRENT_KIND) that the new catalog replaces. NOT the same as
 * V1_NAME_TO_TOOL: that maps the names of the FIRST catalog version, these are the tools of the
 * plugin as it ships now. Source: the "migration" section of katalog.json.
 */
export const CURRENT_TOOL_NAMES = ${json(currentNames)} as const;\n`,
    'export type CurrentToolName = (typeof CURRENT_TOOL_NAMES)[number];\n',
    `/** How a current name changed: rename, rename_and_role, split, merge or library. */
export type CurrentChange = 'rename' | 'rename_and_role' | 'split' | 'merge' | 'library';\n`,
    `/**
 * Today's name -> the new tools that take it over. The tuple is never empty and element [0] is the
 * main way (for a split, the tool that replaces the old default behaviour). Not V1_NAME_TO_TOOL,
 * which maps names from the first catalog version.
 */
export const CURRENT_TO_TOOLS: Readonly<Record<CurrentToolName, readonly [ToolName, ...ToolName[]]>> = ${json(currentToTools)};\n`,
    `/** The kind of change per current name, in English tags. */\nexport const CURRENT_CHANGE: Readonly<Record<CurrentToolName, CurrentChange>> = ${json(currentChange)};\n`,
    `/** What a current name is: a tool of today, or a helper file of the plugin (no tool, no log entry). */\nexport const CURRENT_KIND: Readonly<Record<CurrentToolName, 'tool' | 'helper'>> = ${json(currentKind)};\n`,
    `/** Tools whose schema the client loads up front. */\n${list('ALWAYS_LOAD', 'ToolName', alwaysLoad)}`,
    `/** Tools of the default mode: the core and the process modules. */\n${list(
      'DEFAULT_MODE',
      'ToolName',
      names((tool) => tool.tier !== 'extended'),
    )}`,
    `/** Tools of the extended modules, off in the default mode. */\n${list(
      'EXTENDED',
      'ToolName',
      names((tool) => tool.tier === 'extended'),
    )}`,
    `/**
 * Every backend operation the catalog names (tools and excluded), but those the public snapshot leaves
 * out (scripts/sync-api/excluded.ts). \`satisfies\` makes the compiler refuse an
 * operationId that is not a key of the generated client's operations.
 */
export const CATALOG_OPERATION_IDS = ${json(catalogOperationIds)} as const satisfies readonly OperationId[];\n`,
    `/** Every WebSocket channel the catalog names (tools and excluded); the compiler checks each against ChannelId. */
export const CATALOG_CHANNEL_IDS = ${json(catalogChannelIds)} as const satisfies readonly ChannelId[];\n`,
  ].join('\n');
}

export async function generate(file = CATALOG_FILE) {
  return render(JSON.parse(await readFile(file, 'utf8')));
}

/** Problems with the process-state schema copies; an empty list means they agree. */
export async function checkStateCopies(state = STATE_FILE, copy = STATE_COPY, shaFile = STATE_SHA) {
  const problems = [];
  const original = await readFile(state).catch(() => null);
  if (original === null) return [`${state} is missing`];
  const duplicate = await readFile(copy).catch(() => null);
  if (duplicate === null) problems.push(`${copy} is missing`);
  else if (!original.equals(duplicate)) {
    problems.push(
      `src/workspace/processState.ts differs from catalog/stan-procesu.ts: copy the schema again`,
    );
  }
  const line = (await readFile(shaFile, 'utf8').catch(() => '')).trim();
  const expected = /^([0-9a-f]{64})\s+stan-procesu\.ts$/.exec(line)?.[1];
  const actual = createHash('sha256').update(original).digest('hex');
  if (expected === undefined) problems.push('catalog/stan-procesu.sha256 is missing or malformed');
  else if (expected !== actual) {
    problems.push(
      'catalog/stan-procesu.sha256 does not match catalog/stan-procesu.ts: the sha256 fingerprint is stale',
    );
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const option = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : resolve(process.argv[at + 1] ?? '');
  };
  const out = option('--out') ?? OUT;
  const text = await generate(option('--catalog'));
  if (process.argv.includes('--check')) {
    const current = await readFile(out, 'utf8').catch(() => null);
    if (current !== text) {
      process.stderr.write(
        'src/catalog.generated.ts is out of date: run npm run gen:catalog and add the file to the commit\n',
      );
      process.exitCode = 1;
    }
    const problems = await checkStateCopies(
      option('--state'),
      option('--state-copy'),
      option('--state-sha'),
    );
    for (const problem of problems) process.stderr.write(`state schema: ${problem}\n`);
    if (problems.length > 0) process.exitCode = 1;
  } else {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text);
  }
}
