// `npm run gen:tools`: the generated files follow the catalog (`--check` fails after a change of the
// catalog that was not regenerated, and when a file a module owns is missing), and `--scaffold`
// writes a tool and its test that compile, whose reads are typed by the client generated from the
// contract: a type changed in a copy of the client breaks the scaffold at compile time.

import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const MCP = resolve(import.meta.dirname, '..', '..');
const SCRIPT = join(MCP, 'scripts', 'gen-tools.mjs');
const CONTRACTS = resolve(MCP, '..', 'contracts');
const WALKS = 'list_scenario_runs_api_v1_projects__project_id__scenario_from_description_runs_get';

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function genTools(...args: string[]): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { cwd: MCP });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** Diagnostics of a program of the given files (and what they import), under the root's tsconfig. */
function compile(root: string, files: readonly string[]): string[] {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram({ rootNames: [...files], options: parsed.options });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const where = diagnostic.file?.fileName.replace(root, '') ?? '';
    return `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
}

const MARKERS = /\b(?:TODO|FIXME|XXX)\b/u;

describe('gen:tools --check', () => {
  it('passes on the repository', async () => {
    const result = await genTools('--check');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('fails after a change of the catalog that was not regenerated, and names the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-tools-catalog-'));
    try {
      const catalog = JSON.parse(readFileSync(join(MCP, 'catalog', 'katalog.json'), 'utf8')) as {
        modules: { name: string; tools: { name: string; description: string }[] }[];
      };
      const notes = catalog.modules
        .flatMap((module) => module.tools)
        .find((tool) => tool.name === 'project_list_notes');
      if (notes === undefined) throw new Error('project_list_notes is not in the catalog');
      notes.description = 'List the notes, in other words.';
      const changed = join(dir, 'katalog.json');
      writeFileSync(changed, JSON.stringify(catalog));
      const result = await genTools('--check', '--catalog', changed);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('src/tools/project/meta.generated.ts is out of date');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs with check:catalog, so check:dist and the gate of every task run it', () => {
    const scripts = (
      JSON.parse(readFileSync(join(MCP, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['check:catalog']).toContain('scripts/gen-tools.mjs --check');
    expect(scripts['gen:catalog']).toContain('scripts/gen-tools.mjs');
    expect(scripts['gen:tools']).toBe('node scripts/gen-tools.mjs');
  });

  it('the generated files carry no placeholder', () => {
    const meta = readFileSync(join(MCP, 'src', 'tools', 'flows', 'meta.generated.ts'), 'utf8');
    expect(meta).toContain('export const FLOWS_GET_WALKS = {');
    expect(meta).not.toMatch(MARKERS);
  });
});

describe('gen:tools --scaffold in a copy of mcp/', () => {
  let base = '';
  let root = '';
  let written: string[] = [];

  beforeAll(async () => {
    base = mkdtempSync(join(tmpdir(), 'gen-tools-scaffold-'));
    root = join(base, 'mcp');
    mkdirSync(root);
    for (const part of ['src', 'test', 'catalog']) {
      cpSync(join(MCP, part), join(root, part), { recursive: true });
    }
    for (const file of ['tsconfig.json', 'package.json']) {
      cpSync(join(MCP, file), join(root, file));
    }
    symlinkSync(join(MCP, 'node_modules'), join(root, 'node_modules'), 'dir');
    symlinkSync(CONTRACTS, join(base, 'contracts'), 'dir');
    const result = await genTools('--root', root, '--scaffold', 'flows_get_walks');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    written = result.stdout.trim().split('\n');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('writes the tool, its test and the entry in the list of the module', () => {
    expect(written).toEqual([
      'src/tools/flows/getWalks.ts',
      'test/tools/flows/getWalks.test.ts',
      'src/tools/flows/index.ts',
    ]);
    const index = readFileSync(join(root, 'src', 'tools', 'flows', 'index.ts'), 'utf8');
    expect(index).toContain("import { flowsGetWalks } from './getWalks.js';");
    expect(index).toMatch(/export const tools: readonly ModuleTool\[\] = \[flowsGetWalks\];/u);
    const tool = readFileSync(join(root, 'src', 'tools', 'flows', 'getWalks.ts'), 'utf8');
    // a reader per operation of the catalog entry, typed by the client
    expect(tool).toContain(`OpOutput<'${WALKS}'>`);
    expect(tool).toContain('path: { readonly project_id: string }');
    // the catalog names no arguments for it: none, and the header says where they come from
    expect(tool).toMatch(/input: \{\}/u);
    expect(tool).toContain('the catalog names none for this tool yet');
    // no run and no render: registered, not implemented
    expect(tool).not.toMatch(/\brun\b\s*[:(]/u);
    for (const file of written) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(MARKERS);
    }
  });

  it('compiles: the tool, its test and the list of the module', () => {
    expect(
      compile(
        root,
        written.map((file) => join(root, file)),
      ),
    ).toEqual([]);
  });

  it('breaks at compile time when the client changes the type of a path parameter', () => {
    const client = join(root, 'src', 'http', 'generated', 'api.d.ts');
    const text = readFileSync(client, 'utf8');
    const start = text.indexOf(`    ${WALKS}: {`);
    expect(start).toBeGreaterThan(0);
    const param = text.indexOf('project_id: string;', start);
    writeFileSync(
      client,
      `${text.slice(0, param)}project_id: number;${text.slice(param + 'project_id: string;'.length)}`,
    );
    try {
      const errors = compile(root, [join(root, 'src', 'tools', 'flows', 'getWalks.ts')]);
      expect(errors.some((error) => error.startsWith('/src/tools/flows/getWalks.ts:'))).toBe(true);
    } finally {
      writeFileSync(client, text);
    }
  });

  it('takes exactly the arguments the catalog names, none of its own', async () => {
    const result = await genTools('--root', root, '--scaffold', 'results_get_request');
    expect(result.code, result.stderr).toBe(0);
    const tool = readFileSync(join(root, 'src', 'tools', 'results', 'getRequest.ts'), 'utf8');
    const input = tool.slice(tool.indexOf('input: {'));
    expect(input).toMatch(/run_id: uuidArgument\(\)\s*\.optional\(\)/u);
    expect(input).toMatch(/request: z\.string\(\)\.min\(1\)\.describe/u);
    expect(input).not.toContain('project_id');
  });

  it('says of a tool that asks that it stays a scaffold until the card mechanism exists', async () => {
    const result = await genTools('--root', root, '--scaffold', 'project_save_member');
    expect(result.code, result.stderr).toBe(0);
    const tool = readFileSync(join(root, 'src', 'tools', 'project', 'saveMember.ts'), 'utf8');
    expect(tool.replace(/\n\/\/ /gu, ' ')).toContain(
      'This layer draws no consent card, so `moduleTool` takes no `run` for it',
    );
  });

  it('refuses a tool that takes over one of today still registered (the migration map)', async () => {
    // a catalog whose map says flows_list takes over today's flows_get, which the server still has
    const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as {
      migration: { current: string; kind: string; change: string; new: string[] }[];
    };
    catalog.migration.push({
      current: 'flows_get',
      kind: 'tool',
      change: 'zmienia nazwę',
      new: ['flows_list'],
    });
    const changed = join(base, 'katalog-takeover.json');
    writeFileSync(changed, JSON.stringify(catalog));
    const result = await genTools('--root', root, '--catalog', changed, '--scaffold', 'flows_list');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('flows_list takes over flows_get, still a tool of the server');
    expect(existsSync(join(root, 'src', 'tools', 'flows', 'list.ts'))).toBe(false);
  });

  it('refuses a tool that exists, one the server already has, and one the catalog lacks', async () => {
    const again = await genTools('--root', root, '--scaffold', 'flows_get_walks');
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('src/tools/flows/getWalks.ts exists');
    const legacy = await genTools('--root', root, '--scaffold', 'flows_get');
    expect(legacy.code).toBe(1);
    expect(legacy.stderr).toContain('flows_get is already a tool of the server');
    const unknown = await genTools('--root', root, '--scaffold', 'flows_nothing');
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('flows_nothing is not a tool of the catalog');
  });

  it('--check fails when a file a module owns is missing', async () => {
    rmSync(join(root, 'src', 'render', 'i18n', 'github.pl.ts'));
    const result = await genTools('--root', root, '--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('src/render/i18n/github.pl.ts is missing');
    expect(existsSync(join(root, 'src', 'tools', 'github', 'index.ts'))).toBe(true);
  });
});
