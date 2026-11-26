import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CURRENT_CHANGE, CURRENT_KIND } from '../src/catalog.generated.js';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'check-names.mjs');

interface Report {
  total_files: number;
  total_tool_names: number;
  total_server_name: number;
  names: Record<string, number>;
  areas: { area: string; files: number; tool_names: number; server_name: number }[];
}

let fixture = '';

async function put(rel: string, text: string): Promise<void> {
  const path = join(fixture, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

async function check(
  root: string,
  extra: string[] = [],
): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, '--root', root, ...extra]);
    return { code: 0, stdout };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '' };
  }
}

async function report(root: string): Promise<Report> {
  const { stdout } = await run(process.execPath, [SCRIPT, '--root', root, '--json']);
  return JSON.parse(stdout) as Report;
}

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'CORE-01-checknames-'));
  // The rename map: only entries whose old name differs from the new one count.
  await put(
    'mcp/src/catalog.generated.ts',
    [
      'export const CURRENT_TOOL_NAMES = ["init_project", "wait", "cancel", "self_check"] as const;',
      'export const CURRENT_KIND = {};',
      'export const V1_NAME_TO_TOOL: Readonly<Record<string, ToolName>> = {',
      '  "process_get_status": "process_get_status",',
      '  "project_get_notes": "project_list_notes"',
      '};',
      '',
    ].join('\n'),
  );
  // Hits: a bare old tool name, a renamed old name from the map, a quoted literal `wait`,
  // the `__wait` ending of a full tool name, and the old server name.
  await put(
    'docs/a.md',
    [
      'Wywolaj init_project, potem project_list_notes.',
      'Zdanie ze slowem wait nie jest trafieniem.',
      'process_wait jest nazwa nowa, nie trafia w stare wait.',
      "Literal 'wait' i mcp__plugin_loadcraft_loadcraft__wait trafiaja.",
      'Stara nazwa renamed: project_get_notes.',
      '',
    ].join('\n'),
  );
  // Excluded: contract snapshots, gate reports, the built artefact.
  await put('contracts/c.json', '{"tool": "init_project"}\n');
  await put('mcp/gate-reports/r.md', 'init_project plugin_loadcraft_loadcraft\n');
  await put('mcp/dist/server.mjs', 'init_project plugin_loadcraft_loadcraft\n');
  // New names only: no hits.
  await put('mod/x.ts', 'const n = "mcp__plugin_loadcraft_lc__process_get_status";\n');
});

afterAll(async () => {
  await rm(fixture, { recursive: true, force: true });
});

describe('check:names counts old tool and server names', () => {
  it('counts only real hits and skips excluded paths', async () => {
    const r = await report(fixture);
    expect(r.total_files).toBe(1);
    expect(r.total_tool_names).toBe(4);
    expect(r.total_server_name).toBe(1);
    expect(r.areas.map((a) => a.area)).toEqual(['docs/']);
  });

  it('reports how often each old name occurs', async () => {
    const r = await report(fixture);
    expect(r.names).toEqual({ init_project: 1, wait: 2, project_get_notes: 1 });
  });

  it('matches an old name that follows a double underscore in a full tool name', async () => {
    await put(
      'full/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["init_project", "wait"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put(
      'full/docs/b.md',
      'mcp__plugin_loadcraft_lc__init_project\nmcp__plugin_loadcraft_lc__process_wait\n',
    );
    const r = await report(join(fixture, 'full'));
    expect(r.total_tool_names).toBe(1);
    expect(r.total_server_name).toBe(0);
  });

  it('does not treat the common word wait in prose, nor process_wait, as an old name', async () => {
    await put(
      'clean/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["init_project", "wait"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put('clean/only-prose.md', 'wait for it; process_wait and waiting are fine\n');
    const r = await report(join(fixture, 'clean'));
    expect(r.total_tool_names).toBe(0);
    expect(r.total_files).toBe(0);
  });

  it('exits 1 with --strict on any hit and 0 on a clean tree', async () => {
    const dirty = await check(fixture, ['--strict']);
    expect(dirty.code).toBe(1);
    const clean = await check(join(fixture, 'clean'), ['--strict']);
    expect(clean.code).toBe(0);
  });

  it('reports without failing in the default (non-strict) mode', async () => {
    const dirty = await check(fixture);
    expect(dirty.code).toBe(0);
    expect(dirty.stdout).toContain('docs/');
  });
});

describe('check:names reads names from the catalog and counts tracked files only', () => {
  const git = (cwd: string, ...args: string[]) =>
    run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd });

  async function gitTree(name: string): Promise<string> {
    const dir = join(fixture, name);
    await put(
      `${name}/mcp/src/catalog.generated.ts`,
      'export const CURRENT_TOOL_NAMES = ["init_project", "wait"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put(`${name}/tracked.md`, 'init_project\n');
    await git(dir, 'init', '-q');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-q', '-m', 'x');
    return dir;
  }

  it('an untracked file with an old name does not change the result', async () => {
    const dir = await gitTree('gittree');
    const before = await report(dir);
    expect(before.total_tool_names).toBe(1);
    await put('gittree/.wyniki/out.txt', 'init_project plugin_loadcraft_loadcraft\n');
    await put('gittree/new.md', 'init_project\n');
    const after = await report(dir);
    expect(after).toEqual(before);
  });

  it('a tracked file is counted and an ignored one is not', async () => {
    const dir = await gitTree('gittree2');
    await put('gittree2/.gitignore', 'ign.md\n');
    await put('gittree2/ign.md', 'init_project\n');
    await put('gittree2/more.md', 'init_project\n');
    await git(dir, 'add', 'more.md', '.gitignore');
    await git(dir, 'commit', '-q', '-m', 'y');
    expect((await report(dir)).total_tool_names).toBe(2);
  });

  it('takes the bare old names from CURRENT_TOOL_NAMES and skips the helper files by their kind', async () => {
    await put(
      'cur/mcp/src/catalog.generated.ts',
      [
        'export const V1_NAME_TO_TOOL = {};',
        'export const CURRENT_TOOL_NAMES = [',
        '  "fancy_tool",',
        '  "helper"',
        '] as const;',
        'export const CURRENT_KIND = {',
        '  "fancy_tool": "tool",',
        '  "helper": "helper"',
        '};',
        '',
      ].join('\n'),
    );
    await put('cur/a.md', 'fancy_tool fancy_tool init_project helper\n');
    const r = await report(join(fixture, 'cur'));
    expect(r.total_tool_names).toBe(2);
  });

  it('refuses a catalog module without CURRENT_KIND instead of guessing helpers from their names', async () => {
    await put(
      'nokind/mcp/src/catalog.generated.ts',
      'export const V1_NAME_TO_TOOL = {};\nexport const CURRENT_TOOL_NAMES = ["fancy_tool"] as const;\n',
    );
    await put('nokind/a.md', 'fancy_tool\n');
    await expect(report(join(fixture, 'nokind'))).rejects.toThrow(/CURRENT_KIND/u);
  });
});

describe('check:names leaves out the uses of a name that are not the tool', () => {
  it('skips operation kinds, backend values, HAR timings and pane keys, and still counts the tool next to them', async () => {
    await put(
      'nontool/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["self_check", "provision_accounts", "wait", "cancel"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put(
      'nontool/src/kinds.ts',
      [
        "const op = { kind: 'self_check', id: 'x' };",
        "if (row['source'] === 'self_check') skip();",
        "type K = 'run' | 'self_check';",
        "const KINDS = ['scenario_generation', 'self_check', 'record_run'];",
        "if (action.kind === 'provision_accounts') skip();",
        'const har = { "timings": { "send": 1, "wait": 110 } };',
        "const button = { key: 'cancel', action: { kind: 'cancel' } };",
        "// the `self_check` field of the scenario; the kind's `cancel` runs; `cancel` only: stops it",
        '// what the old `wait` knew',
        '',
      ].join('\n'),
    );
    await put(
      'nontool/src/tools.ts',
      [
        "defineTool({ name: 'self_check' });",
        "await call('wait', {});",
        '// provision_accounts creates accounts',
        "const plan = { tool: 'cancel' };",
        "switch (tool) { case 'wait': break; }",
        '',
      ].join('\n'),
    );
    const r = await report(join(fixture, 'nontool'));
    expect(r.names).toEqual({ self_check: 1, wait: 2, provision_accounts: 1, cancel: 1 });
  });

  it('skips the cancel action of an elicitation answer, and still counts the old cancel tool', async () => {
    await put(
      'elicit/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["cancel"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put(
      'elicit/src/consent.ts',
      [
        "const answer = { action: 'cancel' };",
        'const other = { "action": "cancel" };',
        "await call('cancel', { handle });",
        'await call("cancel", { handle });',
        'const name = "mcp__plugin_loadcraft_lc__cancel";',
        '',
      ].join('\n'),
    );
    const r = await report(join(fixture, 'elicit'));
    expect(r.names).toEqual({ cancel: 3 });
  });

  it('counts a tool name used as an object key; only the timing of a HAR entry is left out', async () => {
    await put(
      'keys/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["wait", "cancel"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put(
      'keys/src/steps.ts',
      [
        'const STEP = { \'wait\': 1, "cancel": 2 };',
        'const har = { "timings": { "send": 1, "wait": 110, "receive": 9 } };',
        '',
      ].join('\n'),
    );
    const r = await report(join(fixture, 'keys'));
    expect(r.names).toEqual({ wait: 1, cancel: 1 });
  });

  it('skips the catalog, its copy of the state schema, the test of the rename map and the code generated from the contracts', async () => {
    await put(
      'copies/mcp/src/catalog.generated.ts',
      'export const CURRENT_TOOL_NAMES = ["get_status"] as const;\nexport const CURRENT_KIND = {};\nexport const V1_NAME_TO_TOOL = {};\n',
    );
    await put('copies/mcp/catalog/stan-procesu.ts', 'get_status\n');
    await put('copies/mcp/src/workspace/processState.ts', 'get_status\n');
    await put('copies/mcp/test/catalog.generated.test.ts', 'get_status\n');
    await put('copies/mcp/src/http/generated/api.d.ts', 'get_status\n');
    await put('copies/mcp/src/ws/generated/channels.ts', 'get_status\n');
    await put('copies/mcp/src/x.ts', 'get_status\n');
    const r = await report(join(fixture, 'copies'));
    expect(r.names).toEqual({ get_status: 1 });
  });
});

describe('check:names on this repository', () => {
  it('finds no old server name and only the old names of the tools that are still to split or merge', async () => {
    const r = await report(resolve(ROOT, '..'));
    const renamed = Object.keys(CURRENT_CHANGE).filter(
      (name) =>
        CURRENT_KIND[name as keyof typeof CURRENT_KIND] === 'tool' &&
        ['rename', 'rename_and_role'].includes(CURRENT_CHANGE[name as keyof typeof CURRENT_CHANGE]),
    );
    expect(renamed).toHaveLength(14);
    expect(r.total_server_name).toBe(0);
    expect(Object.keys(r.names).filter((name) => renamed.includes(name))).toEqual([]);
    // split into project_create … project_apply_setup: the old name is gone
    expect(r.names['init_project']).toBeUndefined();
  });
});
