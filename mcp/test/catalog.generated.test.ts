// src/catalog.generated.ts is the only place the plugin code reads tool names, descriptions,
// consent levels and card templates from. These tests pin that the committed file is what the
// generator makes of catalog/katalog.json, and that the names it exposes are the v3 ones.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ALWAYS_LOAD,
  CATALOG,
  CHECKS,
  CURRENT_CHANGE,
  CURRENT_KIND,
  CURRENT_TO_TOOLS,
  DEFAULT_MODE,
  EXTENDED,
  LOG_META,
  MODULES,
  MODULE_NAMES,
  STATE_INVALIDATIONS,
  TOOL_NAMES,
  V1_NAME_TO_TOOL,
  WS_FRAMES,
  type ModuleName,
  type ToolName,
} from '../src/catalog.generated.js';
import { Process, isRequired } from '../src/workspace/processState.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const script = join(root, 'scripts', 'gen-catalog.mjs');
const catalogPath = join(root, 'catalog', 'katalog.json');
const outPath = join(root, 'src', 'catalog.generated.ts');
const scratch = mkdtempSync(join(tmpdir(), 'lc-gen-catalog-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

interface RawCatalog {
  state: {
    invalidations: Array<{ event: string }>;
    ws_frames: Array<{ effect: string }>;
    fields: Array<{ path: string; required?: boolean | string }>;
  };
  numbers: { tools_total: number; tools_default_mode: number; tools_always_load: number };
  modules: Array<{ name: string; tools: Array<{ name: string; description: string }> }>;
}

function mutatedCatalog(mutate: (catalog: RawCatalog) => void, file: string): string {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as RawCatalog;
  mutate(catalog);
  const path = join(scratch, file);
  writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
  return path;
}

describe('catalog.generated.ts: aktualność', () => {
  it('plik w repo odpowiada katalogowi (--check kończy się 0)', () => {
    expect(run('--check')).toMatchObject({ status: 0 });
  });

  it('zmiana opisu narzędzia w kopii katalogu: --check kończy się 1 i wskazuje npm run gen:catalog', () => {
    const copy = mutatedCatalog((c) => {
      const tool = c.modules[0]?.tools[0];
      if (tool === undefined) throw new Error('katalog bez narzędzi');
      tool.description += ' (zmiana)';
    }, 'opis.json');
    const result = run('--check', '--catalog', copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run gen:catalog');
  });

  it('dodanie narzędzia w kopii katalogu: --check kończy się 1', () => {
    const copy = mutatedCatalog((c) => {
      const first = c.modules[0]?.tools[0];
      if (first === undefined) throw new Error('katalog bez narzędzi');
      c.modules[0]?.tools.push({ ...first, name: 'process_extra_probe' });
    }, 'nowe.json');
    expect(run('--check', '--catalog', copy).status).toBe(1);
  });

  it('zmiana state.invalidations w kopii katalogu: --check kończy się 1', () => {
    const copy = mutatedCatalog((c) => {
      const row = c.state.invalidations[0];
      if (row === undefined) throw new Error('katalog bez unieważnień');
      row.event += ' (zmiana)';
    }, 'unieważnienia.json');
    expect(run('--check', '--catalog', copy).status).toBe(1);
  });

  it('zmiana state.ws_frames w kopii katalogu: --check kończy się 1', () => {
    const copy = mutatedCatalog((c) => {
      const frame = c.state.ws_frames[0];
      if (frame === undefined) throw new Error('katalog bez ramek');
      frame.effect += ' (zmiana)';
    }, 'ramki.json');
    expect(run('--check', '--catalog', copy).status).toBe(1);
  });

  it('zmiana required kontroli w kopii katalogu: --check kończy się 1', () => {
    const copy = mutatedCatalog((c) => {
      const check = c.state.fields.find((f) => f.required === true);
      if (check === undefined) throw new Error('katalog bez wymaganych kontroli');
      check.required = false;
    }, 'kontrole.json');
    expect(run('--check', '--catalog', copy).status).toBe(1);
  });

  it('bajt zmieniony w kopii schematu stanu w src: --check kończy się 1 i nazywa rozjazd', () => {
    const copy = join(scratch, 'processState.ts');
    writeFileSync(
      copy,
      readFileSync(join(root, 'src', 'workspace', 'processState.ts'), 'utf8') + ' ',
    );
    const result = run('--check', '--state-copy', copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('processState.ts');
    expect(result.stderr).toContain('stan-procesu.ts');
  });

  it('bajt zmieniony w stan-procesu.ts: --check kończy się 1 (odcisk i kopia się rozjeżdżają)', () => {
    const state = join(scratch, 'stan-procesu.ts');
    writeFileSync(state, readFileSync(join(root, 'catalog', 'stan-procesu.ts'), 'utf8') + ' ');
    const result = run('--check', '--state', state);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sha256');
  });

  it('odcisk niezgodny z treścią stan-procesu.ts: --check kończy się 1', () => {
    const sha = join(scratch, 'stan-procesu.sha256');
    writeFileSync(sha, `${'0'.repeat(64)}  stan-procesu.ts\n`);
    expect(run('--check', '--state-sha', sha).status).toBe(1);
  });

  it('komunikat o nieaktualnym pliku jest w jednym języku (angielskim)', () => {
    const copy = mutatedCatalog((c) => {
      const tool = c.modules[0]?.tools[0];
      if (tool === undefined) throw new Error('katalog bez narzędzi');
      tool.description += ' (zmiana)';
    }, 'jezyk.json');
    expect(run('--check', '--catalog', copy).stderr).toContain(
      'run npm run gen:catalog and add the file to the commit',
    );
  });

  it('brak pliku wynikowego: --check kończy się 1', () => {
    expect(run('--check', '--out', join(scratch, 'nie-ma.ts')).status).toBe(1);
  });

  it('generowanie do wskazanego pliku daje to samo co plik w repo', () => {
    const out = join(scratch, 'out.ts');
    expect(run('--out', out).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(outPath, 'utf8'));
  });
});

describe('catalog.generated.ts: typy i stałe', () => {
  it('ToolName zawiera process_get_status i nie zawiera get_status', () => {
    const accepted: ToolName = 'process_get_status';
    expect(TOOL_NAMES).toContain(accepted);
    // @ts-expect-error get_status is a v1 name, absent from ToolName
    const old: ToolName = 'get_status';
    expect(TOOL_NAMES).not.toContain(old);
  });

  it('ModuleName obejmuje moduły katalogu', () => {
    const modules: ModuleName[] = ['process', 'project', 'flows', 'scenario', 'data', 'run'];
    for (const name of modules) expect(MODULE_NAMES).toContain(name);
    expect(MODULE_NAMES).toHaveLength(10);
  });

  it('liczby zgadzają się z numbers z katalogu', () => {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as RawCatalog;
    expect(TOOL_NAMES).toHaveLength(raw.numbers.tools_total);
    expect(Object.keys(CATALOG)).toHaveLength(raw.numbers.tools_total);
    expect(DEFAULT_MODE).toHaveLength(raw.numbers.tools_default_mode);
    expect(ALWAYS_LOAD).toHaveLength(raw.numbers.tools_always_load);
    expect(DEFAULT_MODE.length + EXTENDED.length).toBe(TOOL_NAMES.length);
  });

  it('ALWAYS_LOAD to rdzeń procesu, EXTENDED to moduły poza trybem domyślnym', () => {
    expect(ALWAYS_LOAD).toContain('process_get_status');
    for (const name of EXTENDED) expect(CATALOG[name].tier).toBe('extended');
    for (const name of DEFAULT_MODE) expect(CATALOG[name].tier).not.toBe('extended');
  });

  it('V1_NAME_TO_TOOL mapuje stare nazwy na nowe od każdego v1_name z katalogu', () => {
    expect(V1_NAME_TO_TOOL['project_get_notes']).toBe('project_list_notes');
    expect(V1_NAME_TO_TOOL['process_get_status']).toBe('process_get_status');
    expect(Object.keys(V1_NAME_TO_TOOL).sort()).toEqual(
      Object.values(CATALOG)
        .flatMap((tool) => (tool.v1_name === null ? [] : [tool.v1_name]))
        .sort(),
    );
  });

  it('wpis katalogu niesie opis, poziom zgody i szablon karty', () => {
    const tool = CATALOG['project_create'];
    expect(tool.name).toBe('project_create');
    expect(tool.module).toBe('project');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.consent.level).toBe(2);
    expect(tool.consent.card?.title).toBe('Create project {name}');
    expect(tool.full_name).toBe(`mcp__plugin_loadcraft_lc__${tool.name}`);
  });

  it('STATE_INVALIDATIONS, WS_FRAMES i CHECKS pochodzą z sekcji state katalogu', () => {
    const raw = JSON.parse(readFileSync(catalogPath, 'utf8')) as RawCatalog & {
      numbers: { state_checks: number; state_checks_required: number; ws_frames_handled: number };
    };
    expect(STATE_INVALIDATIONS).toHaveLength(14); // project_analyze_setup has a row of its own
    expect(STATE_INVALIDATIONS).toHaveLength(raw.state.invalidations.length);
    expect(WS_FRAMES).toHaveLength(raw.numbers.ws_frames_handled);
    expect(CHECKS).toHaveLength(raw.numbers.state_checks);
    expect(CHECKS.filter((check) => check.required === true)).toHaveLength(
      raw.numbers.state_checks_required,
    );
    expect(CHECKS.filter((check) => typeof check.required === 'object')).toHaveLength(6);
    const first = CHECKS[0];
    expect(first).toMatchObject({ module: 'project', check: 'created', required: true });
  });

  it('każdy warunek required jest strukturalny: ścieżka w choices znanego modułu, wartość z `in` go spełnia, inna nie', () => {
    const modules = Object.keys(Process.shape.choices.unwrap().shape);
    const conditional = CHECKS.filter((check) => typeof check.required === 'object');
    expect(conditional.map((check) => check.path)).toContain('steps.data.accounts');
    for (const check of conditional) {
      const required = check.required;
      if (typeof required !== 'object') continue;
      const [root, module, ...rest] = required.when.split('.');
      expect(root, check.path).toBe('choices');
      expect(modules, check.path).toContain(module);
      // the leaf exists in the schema of that module: a typo would make the check never required
      const [leaf, ...deeper] = rest;
      const fields = Object.keys(
        (
          Process.shape.choices.unwrap().shape as Record<
            string,
            { unwrap: () => { shape: Record<string, unknown> } }
          >
        )[module ?? '']?.unwrap().shape ?? {},
      );
      expect(fields, check.path).toContain(leaf);
      expect(deeper.length, check.path).toBeLessThanOrEqual(1);
      const at = (value: unknown): Process => {
        const leaf = rest.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
        return { choices: { [module ?? '']: leaf } } as unknown as Process;
      };
      for (const value of required.in)
        expect(isRequired(required, at(value)), check.path).toBe(true);
      expect(isRequired(required, at('other')), check.path).toBe(false);
      expect(isRequired(required, at(undefined)), check.path).toBe(false);
    }
  });

  it('MODULES niesie pola modułu i listę jego narzędzi', () => {
    expect(Object.keys(MODULES)).toEqual([...MODULE_NAMES]);
    const project = MODULES.project;
    expect(project.tier).toBe('pipeline');
    expect(project.subagent_tools_default_mode).toContain('project_create');
    expect(project.tools).toContain('project_create');
    expect(MODULES.process.subagent_tools).toBeNull();
    expect(MODULES.process.tools).toEqual(expect.arrayContaining([...ALWAYS_LOAD]));
  });
});

describe('CURRENT_TO_TOOLS: mapa dzisiejszych nazw na nowe', () => {
  const baseline = JSON.parse(
    readFileSync(join(here, 'fixtures', 'surface-baseline.json'), 'utf8'),
  ) as { tools: Array<{ name: string }> };
  const helpers = ['recordWalk', 'operationKinds'];
  const keys = Object.keys(CURRENT_TO_TOOLS);

  // Splits already done: the surface has the tools of their map entry, not today's name.
  const splitDone: readonly (keyof typeof CURRENT_TO_TOOLS)[] = [
    'init_project',
    'build_flows',
    'build_scenario',
    'prepare_data',
    'run_test',
    'list_profiles',
  ];

  it("has exactly the 37 tools of surface-baseline.json: today's, renamed, from the splits done and added", () => {
    expect(baseline.tools).toHaveLength(37);
    // A tool renamed 1:1 is in the surface under its new name (the first element of the map), a
    // split already done under the names of all its tools.
    const shipped = keys.flatMap((name): string[] => {
      const current = name as keyof typeof CURRENT_TO_TOOLS;
      const change = CURRENT_CHANGE[current];
      if (splitDone.includes(current)) return [...CURRENT_TO_TOOLS[current]];
      return change === 'rename' || change === 'rename_and_role'
        ? [CURRENT_TO_TOOLS[current][0]]
        : [name];
    });
    // a tool of the catalog that no tool of today became ships under its catalog name
    const added = [
      'flows_migrate_docs',
      'project_get',
      'project_set_profile',
      'project_delete',
      'flows_delete',
      'results_get_errors',
      'results_get_traces',
    ];
    expect(added.every((name) => (TOOL_NAMES as readonly string[]).includes(name))).toBe(true);
    expect([...new Set([...shipped, ...added])].sort()).toEqual(
      [...baseline.tools.map((t) => t.name), ...helpers].sort(),
    );
    for (const name of added) {
      expect(
        Object.values(CURRENT_TO_TOOLS).some((ways) => (ways as readonly string[]).includes(name)),
        name,
      ).toBe(false);
    }
  });

  it('każdy wpis ma niepustą krotkę celów, a każdy cel jest w TOOL_NAMES', () => {
    for (const [current, targets] of Object.entries(CURRENT_TO_TOOLS)) {
      expect(targets.length, current).toBeGreaterThan(0);
      for (const target of targets) expect(TOOL_NAMES, `${current} -> ${target}`).toContain(target);
    }
  });

  it('droga główna (element [0]) i tagi zmian zgadzają się z katalogiem', () => {
    expect(CURRENT_TO_TOOLS.init_project[0]).toBe('project_create');
    expect(CURRENT_TO_TOOLS.build_flows[0]).toBe('flows_generate_from_suggestions');
    expect(CURRENT_TO_TOOLS.build_scenario[0]).toBe('scenario_generate');
    expect(CURRENT_TO_TOOLS.prepare_data[0]).toBe('data_suggest_actions');
    expect(CURRENT_TO_TOOLS.run_test[0]).toBe('run_start');
    expect(CURRENT_CHANGE.build_flows).toBe('split');
    expect(CURRENT_CHANGE.get_status).toBe('rename_and_role');
    expect(CURRENT_CHANGE.list_profiles).toBe('merge');
    expect(CURRENT_CHANGE.recordWalk).toBe('library');
    expect(Object.keys(CURRENT_CHANGE).sort()).toEqual([...keys].sort());
  });

  it('każdy wpis ma rodzaj z katalogu: tool dla 20 narzędzi, helper dla 2 plików pomocniczych; klucz to sama nazwa', () => {
    expect(Object.keys(CURRENT_KIND).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(key, key).toMatch(/^[A-Za-z_]+$/u);
    expect(
      Object.entries(CURRENT_KIND)
        .filter(([, kind]) => kind === 'helper')
        .map(([name]) => name)
        .sort(),
    ).toEqual([...helpers].sort());
    expect(Object.values(CURRENT_KIND).filter((kind) => kind === 'tool')).toHaveLength(20);
  });

  it('migration z nieznanym rodzajem albo bez rodzaju: generator odmawia z komunikatem', () => {
    for (const kind of ['narzędzie', undefined]) {
      const copy = mutatedCatalog(
        (c) => {
          const migration = (c as unknown as { migration: Array<{ kind?: string }> }).migration;
          const entry = migration[0];
          if (entry === undefined) throw new Error('katalog bez migration');
          if (kind === undefined) delete entry.kind;
          else entry.kind = kind;
        },
        `migration-kind-${String(kind)}.json`,
      );
      const result = run('--check', '--catalog', copy);
      expect(result.status, String(kind)).not.toBe(0);
      expect(result.stderr, String(kind)).toContain('kind');
    }
  });

  it('mutacja migration w kopii katalogu: --check kończy się 1', () => {
    const copy = mutatedCatalog((c) => {
      const migration = (c as unknown as { migration: Array<{ new: string[] }> }).migration;
      const entry = migration[0];
      if (entry === undefined) throw new Error('katalog bez migration');
      entry.new.reverse();
    }, 'migration.json');
    expect(run('--check', '--catalog', copy)).toMatchObject({ status: 1 });
  });

  it('migration wskazująca nieznane narzędzie: generator odmawia z komunikatem', () => {
    const copy = mutatedCatalog((c) => {
      const migration = (c as unknown as { migration: Array<{ new: string[] }> }).migration;
      const entry = migration[1];
      if (entry === undefined) throw new Error('katalog bez migration');
      entry.new = ['nie_ma_takiego'];
    }, 'migration-nieznane.json');
    const result = run('--check', '--catalog', copy);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('nie_ma_takiego');
  });
});

describe('LOG_META: wycinek katalogu dla dziennika wywołań', () => {
  it('każde narzędzie ma wpis zgodny z CATALOG (moduł, poziom, klasa, szablony, drogi cofania z poziomem narzędzia cofającego)', () => {
    expect(Object.keys(LOG_META)).toEqual([...TOOL_NAMES]);
    for (const name of TOOL_NAMES) {
      const tool = CATALOG[name];
      expect(LOG_META[name], name).toEqual({
        module: tool.module,
        level: tool.consent.level,
        class: tool.class,
        log: tool.log,
        undo: tool.undo.ways.map((way) => ({
          tool: way.tool,
          how: way.how,
          for: way.for,
          level: CATALOG[way.tool as ToolName].consent.level,
        })),
      });
    }
  });
});
