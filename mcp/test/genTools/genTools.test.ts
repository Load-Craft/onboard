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
  readdirSync,
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

interface CatalogTool {
  readonly name: string;
  readonly module: string;
  readonly description: string;
  readonly arguments: readonly { readonly name: string }[] | null;
  readonly consent: {
    readonly level: number;
    readonly by_argument: unknown;
    readonly escalate_to_3: readonly string[];
  };
}

/** The tools of the catalog at `root`, each with its module. */
function catalogTools(root: string): CatalogTool[] {
  const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as {
    modules: { name: string; tools: Omit<CatalogTool, 'module'>[] }[];
  };
  return catalog.modules.flatMap((module) =>
    module.tools.map((tool) => ({ ...tool, module: module.name })),
  );
}

const camel = (snake: string): string =>
  snake.replace(/_([a-z0-9])/gu, (_, letter: string) => letter.toUpperCase());

/** The file name of a module tool (`flows_get_walks` -> `getWalks`), as the generator names it. */
const objectOf = (tool: CatalogTool): string =>
  camel(
    tool.name.startsWith(`${tool.module}_`) ? tool.name.slice(tool.module.length + 1) : tool.name,
  );

/** The files a module wrote for the tool, in `root`. */
function toolFiles(root: string, tool: CatalogTool): { source: string; test: string } {
  return {
    source: join(root, 'src', 'tools', tool.module, `${objectOf(tool)}.ts`),
    test: join(root, 'test', 'tools', tool.module, `${objectOf(tool)}.test.ts`),
  };
}

/**
 * Takes a tool a module wrote out of the copy at `root` (its file, its test, its entry in the list of
 * the module): the scaffold is what is under test, not the tools written so far, which come and go.
 */
function takeOut(root: string, tool: CatalogTool): void {
  const files = toolFiles(root, tool);
  rmSync(files.source, { force: true });
  rmSync(files.test, { force: true });
  const indexFile = join(root, 'src', 'tools', tool.module, 'index.ts');
  if (!existsSync(indexFile)) return;
  const exported = camel(tool.name);
  writeFileSync(
    indexFile,
    readFileSync(indexFile, 'utf8')
      .replace(
        new RegExp(`import \\{ ${exported} \\} from '\\./${objectOf(tool)}\\.js';\\n`, 'u'),
        '',
      )
      .replace(new RegExp(`\\s*\\b${exported}\\b,?`, 'u'), ''),
  );
}

/** The same rule as `asksNothing` of src/tools/moduleTool.ts: level 1, nothing by argument, no escalation. */
const asksNothing = (tool: CatalogTool): boolean =>
  tool.consent.level === 1 &&
  tool.consent.by_argument === null &&
  tool.consent.escalate_to_3.length === 0;

/** Names of the tools the server has today outside the modules (`src/tools/*.ts`), as the generator reads them. */
function legacyNames(root: string): Set<string> {
  const dir = join(root, 'src', 'tools');
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.startsWith('module')) continue;
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(
      /^\s{2}name: '([a-z_]+)',$/gmu,
    )) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return names;
}

/** A tool of today the catalog also names: the generator refuses to scaffold it. */
function legacyCatalogTool(root: string): string | undefined {
  const legacy = legacyNames(root);
  return catalogTools(root).find((tool) => legacy.has(tool.name))?.name;
}

describe('gen:tools --check', () => {
  it('passes on the repository', async () => {
    const result = await genTools('--check');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('fails after a change of the catalog that was not regenerated, and names the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen-tools-catalog-'));
    try {
      // any tool of a module: the first of the catalog, whichever it is today
      const catalog = JSON.parse(readFileSync(join(MCP, 'catalog', 'katalog.json'), 'utf8')) as {
        modules: { name: string; tools: { name: string; description: string }[] }[];
      };
      const module = catalog.modules.find((one) => one.tools.length > 0);
      const first = module?.tools[0];
      expect(first, 'the catalog has a module with a tool').toBeDefined();
      if (module === undefined || first === undefined) return;
      first.description = `${first.description} In other words.`;
      const changed = join(dir, 'katalog.json');
      writeFileSync(changed, JSON.stringify(catalog));
      const result = await genTools('--check', '--catalog', changed);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`src/tools/${module.name}/meta.generated.ts is out of date`);
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
    // the tool the scaffold writes is written by the module by now: take it out of the copy first
    const walks = catalogTools(root).find((tool) => tool.name === 'flows_get_walks');
    if (walks === undefined) throw new Error('flows_get_walks is not in the catalog');
    takeOut(root, walks);
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
    expect(index).toMatch(
      /export const tools: readonly ModuleTool\[\] = \[[^\]]*flowsGetWalks[^\]]*\];/u,
    );
    const tool = readFileSync(join(root, 'src', 'tools', 'flows', 'getWalks.ts'), 'utf8');
    // a reader per operation of the catalog entry, typed by the client
    expect(tool).toContain(`OpOutput<'${WALKS}'>`);
    expect(tool).toContain('path: { readonly project_id: string }');
    // the arguments are the catalog's (`walk_id`, `limit`, `include`), as the entry names them
    expect(tool).toMatch(/walk_id: z/u);
    expect(tool).toMatch(/limit: z/u);
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
    // any tool of the catalog with arguments that the generator accepts; none is named here, because
    // the tools the modules write one by one have their file in the repository
    const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as {
      modules: { name: string; tools: { name: string; arguments: { name: string }[] | null }[] }[];
    };
    const candidates = catalog.modules.flatMap((module) =>
      module.tools.map((tool) => ({ ...tool, module: module.name })),
    );
    let scaffolded: { name: string; names: string[]; file: string } | undefined;
    for (const entry of candidates) {
      if (entry.arguments === null || entry.arguments.length === 0) continue;
      const dir = join(root, 'src', 'tools', entry.module);
      // the file a module wrote in the repository is removed from the copy first: the scaffold is
      // what is under test, not the tools written so far
      const object = entry.name
        .slice(entry.module.length + 1)
        .replace(/_(\w)/gu, (_, letter: string) => letter.toUpperCase());
      rmSync(join(dir, `${object}.ts`), { force: true });
      const before = new Set(readdirSync(dir));
      const result = await genTools('--root', root, '--scaffold', entry.name);
      if (result.code !== 0) continue;
      const created = readdirSync(dir).filter((file) => !before.has(file) && file.endsWith('.ts'));
      expect(created, entry.name).toHaveLength(1);
      scaffolded = {
        name: entry.name,
        names: entry.arguments.map((argument) => argument.name),
        file: join(dir, created[0] ?? ''),
      };
      break;
    }
    expect(scaffolded, 'a tool with arguments that the generator scaffolds').toBeDefined();
    const tool = readFileSync(scaffolded?.file ?? '', 'utf8');
    const input = tool.slice(tool.indexOf('input: {'));
    const keys = [...input.slice(0, input.indexOf('\n  },')).matchAll(/^ {4}(\w+): /gmu)].map(
      (match) => match[1],
    );
    expect(keys.sort(), scaffolded?.name).toEqual([...(scaffolded?.names ?? [])].sort());
    expect(input.includes('project_id')).toBe(scaffolded?.names.includes('project_id'));
  });

  it('scaffolds an argument of the catalog type object as a record, not as text', async () => {
    const choices = catalogTools(root).find((tool) => tool.name === 'process_set_choices');
    if (choices === undefined) throw new Error('process_set_choices is not in the catalog');
    takeOut(root, choices);
    const result = await genTools('--root', root, '--scaffold', 'process_set_choices');
    expect(result.code, result.stderr).toBe(0);
    const tool = readFileSync(join(root, 'src', 'tools', 'process', 'setChoices.ts'), 'utf8');
    expect(tool).toMatch(/choices: z\s*\.record\(z\.string\(\), z\.unknown\(\)\)/u);
  });

  it('says of a tool that asks that it stays a scaffold until the card mechanism exists', async (context) => {
    // a tool that asks, picked from the catalog: the first one no module has written yet, else the first
    // one taken out of the copy; the tools agents write come and go, so none is named here
    const asking = catalogTools(root).filter((tool) => !asksNothing(tool));
    if (asking.length === 0) {
      context.skip('the catalog has no tool that asks (level 2 or more): nothing to scaffold here');
      return;
    }
    const unwritten = asking.filter((tool) => {
      const files = toolFiles(MCP, tool);
      return !existsSync(files.source) && !existsSync(files.test);
    });
    let scaffolded: CatalogTool | undefined;
    for (const tool of [...unwritten, ...asking.filter((one) => !unwritten.includes(one))]) {
      takeOut(root, tool);
      const result = await genTools('--root', root, '--scaffold', tool.name);
      if (result.code === 0) {
        scaffolded = tool;
        break;
      }
    }
    expect(scaffolded, 'a tool that asks that the generator scaffolds').toBeDefined();
    if (scaffolded === undefined) return;
    const tool = readFileSync(toolFiles(root, scaffolded).source, 'utf8');
    expect(tool.replace(/\n\/\/ /gu, ' '), scaffolded.name).toContain(
      'This layer draws no consent card, so `moduleTool` takes no `run` for it',
    );
  });

  it('refuses a tool that takes over one of today still registered (the migration map)', async () => {
    // a catalog whose map says flows_get_versions takes over a tool of today the server still has
    const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'katalog.json'), 'utf8')) as {
      migration: { current: string; kind: string; change: string; new: string[] }[];
    };
    const current = legacyCatalogTool(root) ?? [...legacyNames(root)][0];
    expect(current, 'the server has a tool outside the modules').toBeDefined();
    catalog.migration.push({
      current: current ?? '',
      kind: 'tool',
      change: 'zmienia nazwę',
      new: ['flows_get_versions'],
    });
    const existedBefore = existsSync(join(root, 'src', 'tools', 'flows', 'getVersions.ts'));
    const changed = join(base, 'katalog-takeover.json');
    writeFileSync(changed, JSON.stringify(catalog));
    const result = await genTools(
      '--root',
      root,
      '--catalog',
      changed,
      '--scaffold',
      'flows_get_versions',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      `flows_get_versions takes over ${current ?? ''}, still a tool of the server`,
    );
    // the refusal writes nothing: the file is as it was (written by the module or absent)
    expect(existsSync(join(root, 'src', 'tools', 'flows', 'getVersions.ts'))).toBe(existedBefore);
  });

  it('refuses a tool that exists, one the server already has, and one the catalog lacks', async () => {
    const again = await genTools('--root', root, '--scaffold', 'flows_get_walks');
    expect(again.code).toBe(1);
    // the refusal names the first of the files the scaffold would write over: the tool or its test
    expect(again.stderr).toMatch(
      /(?:src\/tools\/flows\/getWalks\.ts|test\/tools\/flows\/getWalks\.test\.ts) exists/u,
    );
    // a tool of today the catalog names too; once every one has moved into a module, there is none
    const legacyName = legacyCatalogTool(root);
    if (legacyName !== undefined) {
      const legacy = await genTools('--root', root, '--scaffold', legacyName);
      expect(legacy.code).toBe(1);
      expect(legacy.stderr).toContain(`${legacyName} is already a tool of the server`);
    }
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
