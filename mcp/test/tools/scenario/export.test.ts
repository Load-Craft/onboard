// `scenario_export` (module scenario): the Gatling project of a scenario saved as a ZIP in the
// workspace, read from the fake backend over HTTP (docs/tools/scenario/export.md).

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scenarioExport } from '../../../src/tools/scenario/export.js';
import { newProcess } from '../../../src/workspace/migrate.js';
import { State } from '../../../src/workspace/processState.js';
import { registerAllRoutes } from '../../fake-backend/routes/index.js';
import { DEFAULT_EXPORT, seedScenarioExport } from '../../fake-backend/routes/scenario.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_WORLD_IDS, seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY } from '../../helpers/canary.js';
import { buildZip } from '../../helpers/zip.js';
import { createTestClock } from '../../helpers/clock.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

const PROJECT = SKLEP_IDS.project;
const SCENARIO = SKLEP_WORLD_IDS.scenarios.przegladanie;
const FLOW = SKLEP_WORLD_IDS.flowPrzegladanie;
const NOW = '2026-11-26T12:00:00.000Z';
const EXPORT = `/api/v1/projects/${PROJECT}/gatling/scenarios/${SCENARIO}/export`;
const FILE = 'loadcraft/exports/scenario-b7e2d495.zip';
const RECIPE = 'loadcraft/exports/scenario-b7e2d495.run.md';

const BOUND = JSON.stringify({
  schema: 1,
  url: 'https://app.loadcraft.io',
  project: { id: PROJECT, name: 'sklep' },
});

function stateFile(): string {
  const empty = newProcess(PROJECT, NOW);
  const state = {
    schema: 3,
    process: {
      [PROJECT]: { ...empty, ids: { ...empty.ids, scenario_ids: { [FLOW]: SCENARIO } } },
    },
  };
  State.parse(state);
  return JSON.stringify(state);
}

interface Options {
  readonly locale?: 'en' | 'pl';
  readonly seed?: (fake: Fake) => void;
  readonly files?: Readonly<Record<string, string>>;
}

async function rig(options: Options = {}): Promise<ToolRig> {
  return toolRig({
    tools: [scenarioExport],
    world: (fake: Fake) => {
      registerAllRoutes(fake);
      seedSklep(fake.store, { stage: 'scenario' });
      options.seed?.(fake);
    },
    clock: createTestClock(Date.parse(NOW)),
    env: { LOADCRAFT_LOCALE: options.locale ?? 'en' },
    files: {
      'loadcraft/project.json': BOUND,
      'loadcraft/.cache/state.json': stateFile(),
      ...options.files,
    },
  });
}

const exportCalls = (r: ToolRig): string[] =>
  r.fake.calls.map((c) => c.path).filter((p) => p.endsWith('/export'));

const exportsDir = (r: ToolRig): string => join(r.workspace, 'loadcraft', 'exports');

function reads(r: ToolRig): { tool: string; args: string; result: string }[] {
  const state = JSON.parse(
    readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
  ) as { process: Record<string, { reads: { tool: string; args: string; result: string }[] }> };
  return Object.values(state.process).flatMap((p) => p.reads);
}

describe('scenario_export', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(scenarioExport);
    expect(scenarioExport.implemented).toBe(true);
  });

  it('saves the ZIP byte for byte under loadcraft/exports and returns the relative path, in one request', async () => {
    const r = await rig();
    const result = await r.call('scenario_export', {});
    expect(result.isError, result.text).toBe(false);
    const lines = result.text.split('\n');
    expect(lines[0]).toBe(`Exported the Gatling project of scenario ${SCENARIO} as a ZIP (1 KB).`);
    expect(lines.slice(-2)).toEqual([
      'The folder is ignored by git; an earlier export is never replaced.',
      `open: ${FILE}`,
    ]);
    expect(readFileSync(join(r.workspace, FILE)).equals(DEFAULT_EXPORT)).toBe(true);
    expect(statSync(join(r.workspace, FILE)).mode & 0o777).toBe(0o644);
    // the export, and the scenario read for the dataset slots of the recipe
    expect(exportCalls(r)).toEqual([EXPORT]);
    expect(result.text).not.toContain(r.workspace);
    expect(result.text).not.toContain('dataset secrets are masked');
  });

  it('makes a .gitignore with * and leaves an existing one as it is', async () => {
    const fresh = await rig();
    await fresh.call('scenario_export', {});
    expect(readFileSync(join(exportsDir(fresh), '.gitignore'), 'utf8')).toBe('*\n');

    const kept = await rig({ files: { 'loadcraft/exports/.gitignore': 'mine\n' } });
    await kept.call('scenario_export', {});
    expect(readFileSync(join(exportsDir(kept), '.gitignore'), 'utf8')).toBe('mine\n');
  });

  it('never replaces an earlier export: the next one takes the next free name', async () => {
    const r = await rig({
      seed: (fake) => {
        seedScenarioExport(fake, SCENARIO, Buffer.from('PK\u0003\u0004second'));
      },
      files: { [FILE]: 'earlier export' },
    });
    const result = await r.call('scenario_export', {});
    expect(result.isError, result.text).toBe(false);
    expect(readFileSync(join(r.workspace, FILE), 'utf8')).toBe('earlier export');
    expect(result.text).toContain('open: loadcraft/exports/scenario-b7e2d495-2.zip');
    expect(
      readFileSync(join(r.workspace, 'loadcraft/exports/scenario-b7e2d495-2.zip'), 'utf8'),
    ).toBe('PK\u0003\u0004second');
    expect(readdirSync(exportsDir(r)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('a symlink in the place of the name is not followed or replaced', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'scenario-export-out-'));
    writeFileSync(join(outside, 'victim.txt'), 'untouched');
    const r = await rig({ files: { 'loadcraft/exports/.gitignore': '*\n' } });
    symlinkSync(join(outside, 'victim.txt'), join(exportsDir(r), 'scenario-b7e2d495.zip'));
    const result = await r.call('scenario_export', {});
    expect(result.isError, result.text).toBe(false);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('untouched');
    expect(lstatSync(join(exportsDir(r), 'scenario-b7e2d495.zip')).isSymbolicLink()).toBe(true);
    expect(result.text).toContain('scenario-b7e2d495-2.zip');
  });

  it('a folder of exports that is a symlink out of the workspace is refused before any request', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'scenario-export-out-'));
    const r = await rig();
    mkdirSync(join(r.workspace, 'loadcraft'), { recursive: true });
    symlinkSync(outside, join(r.workspace, 'loadcraft', 'exports'), 'dir');
    const result = await r.call('scenario_export', {});
    expect(result.text).toMatch(/^\[path_outside_workspace\] /u);
    expect(exportCalls(r)).toEqual([]);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('a scenario the backend does not know is not_found and saves nothing', async () => {
    const r = await rig();
    const result = await r.call('scenario_export', {
      scenario_id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    });
    expect(result.text).toMatch(/^\[not_found\] /u);
    expect(existsSync(exportsDir(r))).toBe(false);
  });

  it('with no id and none in the state asks for scenario_id, no request', async () => {
    const r = await rig({
      files: {
        'loadcraft/.cache/state.json': (() => {
          const empty = newProcess(PROJECT, NOW);
          return JSON.stringify({ schema: 3, process: { [PROJECT]: empty } });
        })(),
      },
    });
    const result = await r.call('scenario_export', {});
    expect(result.text).toMatch(/^\[missing_argument\] .*scenario_id/u);
    expect(exportCalls(r)).toEqual([]);
  });

  it('format data carries the path and the size', async () => {
    const r = await rig();
    const data = JSON.parse((await r.call('scenario_export', { format: 'data' })).text) as {
      project_id: string;
      scenario_id: string;
      path: string;
      bytes: number;
    };
    expect(data).toMatchObject({
      project_id: PROJECT,
      scenario_id: SCENARIO,
      path: FILE,
      bytes: DEFAULT_EXPORT.byteLength,
      datasets_omitted: true,
      conf_read: false,
      folder: null,
      env_vars: [],
      recipe: RECIPE,
    });
  });

  it('logs the call with the templates of the catalog', async () => {
    const r = await rig();
    await r.call('scenario_export', {});
    expect(reads(r).map((entry) => [entry.tool, entry.args, entry.result])).toEqual([
      ['scenario_export', SCENARIO, FILE],
    ]);
  });

  it('what is inside the ZIP never reaches the model, the log or the state', async () => {
    const inner = 'inner-file-name-4f9c1e7b';
    const r = await rig({
      seed: (fake) => {
        seedScenarioExport(fake, SCENARIO, Buffer.from(`PK\u0003\u0004secrets/${inner}.csv`));
      },
    });
    const result = await r.call('scenario_export', { format: 'data' });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toContain(inner);
    expect(
      readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
    ).not.toContain(inner);
  });

  it('a 500 that quotes a credential is an error without it, and saves nothing', async () => {
    const r = await rig();
    r.fake.faults.next('GET', EXPORT, {
      status: 500,
      body: { detail: `Upstream said: password: ${BACKEND_CANARY}` },
    });
    const result = await r.call('scenario_export', {});
    expect(result.isError).toBe(true);
    expect(existsSync(join(exportsDir(r), 'scenario-b7e2d495.zip'))).toBe(false);
    r.forgetResults();
    r.forgetLogs();
  });

  it('speaks Polish', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call('scenario_export', {});
    expect(result.text.split('\n')[0]).toContain('Wyeksportowano projekt Gatling scenariusza');
    expect(result.text.split('\n').at(-1)).toBe(`otwórz: ${FILE}`);
    expect(result.text).toContain('celowo');
  });

  describe('the recipe: what to bring so that the project starts', () => {
    /** A value inside the ZIP that no output may carry (the rig scans files for its own canary, which the saved ZIP would trip). */
    const MARK = 'zip-value-7d3a91c2';
    const CONF = [
      '# generated; password: ' + MARK,
      'loadcraft {',
      '  feeder.accounts = "accounts.csv"',
      '  feeder.search = search_phrases.csv   # the phrases',
      '  header.key = ${?LC_HDR_X_PUBLISHABLE_KEY}',
      '  header.other = ${LC_HDR_X_TENANT}',
      '}',
    ].join('\n');
    const zipOf = (conf: string, deflate = false): Buffer =>
      buildZip([
        { name: 'build.gradle', text: 'plugins {}' },
        { name: 'src/gatling/resources/application.conf', text: conf, deflate },
        { name: 'secrets/inner-file-name-4f9c1e7b.csv', text: `token,${MARK}` },
        { name: 'README.txt', text: './gradlew gatlingRun' },
      ]);
    const seeded = (zip: Buffer) => ({
      seed: (fake: Fake) => seedScenarioExport(fake, SCENARIO, zip),
    });
    const slotsOf = (r: ToolRig) =>
      r.fake.store
        .collection<{ id: string; feeder_slots: { default_file: string; columns: string[] }[] }>(
          'gatling_scenarios',
        )
        .require(SCENARIO, 'scenario').feeder_slots;
    const recipeOf = (r: ToolRig) => readFileSync(join(r.workspace, RECIPE), 'utf8');
    const viewOf = (text: string) =>
      text
        .split('\n')
        .filter((line) => !line.startsWith('↗ '))
        .join('\n');

    it('says the dataset files are left out on purpose, names the files, their columns and the variables', async () => {
      const r = await rig(seeded(zipOf(CONF)));
      r.fake.store
        .collection<{ id: string; feeder_slots: unknown[] }>('gatling_scenarios')
        .update(SCENARIO, {
          feeder_slots: [
            {
              slot: 'a',
              default_file: 'accounts.csv',
              columns: ['email', 'password'],
              role: 'auth',
            },
            { slot: 'b', default_file: 'search_phrases.csv', columns: ['q'], role: 'data' },
          ],
        });
      const result = await r.call('scenario_export', {});
      expect(result.isError, result.text).toBe(false);
      expect(viewOf(result.text).split('\n')).toEqual([
        `Exported the Gatling project of scenario ${SCENARIO} as a ZIP (1 KB).`,
        'The dataset files are not in it, on purpose: they hold real values and are never put into an export.',
        'Add 2 dataset files in src/gatling/resources (names and columns only; the values are yours):',
        '- accounts.csv (sign-in accounts): columns email, password',
        '- search_phrases.csv: columns q',
        'Set 2 environment variables (your own values):',
        '- LC_HDR_X_PUBLISHABLE_KEY',
        '- LC_HDR_X_TENANT',
        `steps to start it: ${RECIPE}`,
        'The folder is ignored by git; an earlier export is never replaced.',
        `open: ${FILE}`,
      ]);
    });

    it('writes the same recipe beside the ZIP with the commands, leaves the ZIP as the backend sent it', async () => {
      const zip = zipOf(CONF);
      const r = await rig(seeded(zip));
      await r.call('scenario_export', {});
      expect(readFileSync(join(r.workspace, FILE)).equals(zip)).toBe(true);
      const file = recipeOf(r);
      expect(file).toContain('# Running the exported scenario');
      expect(file).toContain('- LC_HDR_X_PUBLISHABLE_KEY');
      expect(file).toContain('./gradlew gatlingClasses\n./gradlew gatlingRun');
      expect(file).toContain("The README.txt inside the ZIP is the backend's");
      expect(statSync(join(r.workspace, RECIPE)).mode & 0o777).toBe(0o644);
    });

    it('reads a deflated application.conf the same way, and takes the columns from the slots', async () => {
      const r = await rig(seeded(zipOf(CONF, true)));
      const slot = slotsOf(r)[0];
      const named = `feeder.a = "${slot?.default_file ?? ''}"`;
      const result = await r.call('scenario_export', {
        format: 'data',
      });
      const data = JSON.parse(result.text.split('\n')[0] ?? '') as {
        conf_read: boolean;
        folder: string;
        env_vars: string[];
        datasets: { file: string; columns: string[] }[];
      };
      expect(named).toContain('feeder.a');
      expect(data.conf_read).toBe(true);
      expect(data.folder).toBe('src/gatling/resources');
      expect(data.env_vars).toEqual(['LC_HDR_X_PUBLISHABLE_KEY', 'LC_HDR_X_TENANT']);
      expect(data.datasets.map((item) => item.file)).toEqual([
        'accounts.csv',
        'search_phrases.csv',
      ]);
    });

    it('a ZIP whose application.conf cannot be read still lists the dataset slots and says so', async () => {
      const r = await rig();
      const result = await r.call('scenario_export', {});
      const text = viewOf(result.text);
      expect(text).toContain('Its application.conf could not be read here');
      for (const slot of slotsOf(r)) {
        expect(text).toContain(slot.default_file);
        for (const column of slot.columns) expect(text).toContain(column);
      }
    });

    it('the project that reads no dataset file and no variable says there is nothing to add', async () => {
      const r = await rig(seeded(zipOf('loadcraft { users = 10 }')));
      r.fake.store
        .collection<{ id: string; feeder_slots: unknown[] }>('gatling_scenarios')
        .update(SCENARIO, { feeder_slots: [] });
      const result = await r.call('scenario_export', {});
      expect(viewOf(result.text)).toContain('nothing to add');
    });

    it('takes only plain names from the configuration: odd file names, paths and lower-case variables are dropped', async () => {
      const conf = [
        'feeder.a = "../../etc/passwd.csv"',
        'feeder.b = "$(rm -rf).csv"',
        'feeder.c = "ok_file.csv"',
        'key = ${?lower_case}',
        'key2 = ${?GOOD_NAME}',
        `secret = "Authorization: Bearer ${MARK}"`,
      ].join('\n');
      const r = await rig(seeded(zipOf(conf)));
      const result = await r.call('scenario_export', { format: 'data' });
      const data = JSON.parse(result.text.split('\n')[0] ?? '') as {
        datasets: { file: string }[];
        env_vars: string[];
      };
      expect(data.datasets.map((item) => item.file)).toEqual(['ok_file.csv']);
      expect(data.env_vars).toEqual(['GOOD_NAME']);
      expect(result.text).not.toContain(MARK);
    });

    it('no value and no other file name of the ZIP reaches the view, the recipe file, the log or the state', async () => {
      const r = await rig(seeded(zipOf(CONF)));
      const result = await r.call('scenario_export', {});
      const everything = [
        result.text,
        recipeOf(r),
        readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8'),
      ].join('\n');
      expect(everything).not.toContain(MARK);
      expect(everything).not.toContain('inner-file-name-4f9c1e7b');
      expect(r.lines.join('\n')).not.toContain(MARK);
    });

    it('a dataset with a credential in its rows is never read: the canary is in no output', async () => {
      const r = await rig({
        seed: (fake) => {
          seedScenarioExport(fake, SCENARIO, zipOf(CONF));
          fake.store
            .collection('gatling_feeders')
            .list()
            .forEach((feeder) => {
              fake.store.collection('gatling_feeders').update((feeder as { id: string }).id, {
                content: `email,password\nuser@example.com,${BACKEND_CANARY}`,
              });
            });
        },
      });
      const result = await r.call('scenario_export', {});
      expect(`${result.text}\n${recipeOf(r)}`).not.toContain(BACKEND_CANARY);
      r.assertClean();
    });

    it('a ZIP that is truncated, has no end record or is not a ZIP gives no recipe and no error', async () => {
      for (const bytes of [
        zipOf(CONF).subarray(0, 60),
        Buffer.from('PK\u0003\u0004garbage'),
        Buffer.alloc(0),
        Buffer.concat([zipOf(CONF).subarray(0, 100), Buffer.alloc(40, 0xff)]),
      ]) {
        const r = await rig(seeded(bytes));
        const result = await r.call('scenario_export', {});
        expect(result.isError, result.text).toBe(false);
        expect(viewOf(result.text)).toContain('could not be read here');
      }
    });

    it('never replaces a recipe file or follows a symlink in its place: nothing is written, the view has no steps line', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'scenario-export-out-'));
      writeFileSync(join(outside, 'victim.md'), 'untouched');
      const r = await rig({
        ...seeded(zipOf(CONF)),
        files: { 'loadcraft/exports/.gitignore': '*\n' },
      });
      symlinkSync(join(outside, 'victim.md'), join(exportsDir(r), 'scenario-b7e2d495.run.md'));
      const result = await r.call('scenario_export', {});
      expect(result.isError, result.text).toBe(false);
      expect(readFileSync(join(outside, 'victim.md'), 'utf8')).toBe('untouched');
      expect(result.text).not.toContain('steps to start it');
    });

    it('speaks Polish: the recipe file and the view', async () => {
      const r = await rig({ ...seeded(zipOf(CONF)), locale: 'pl' });
      const result = await r.call('scenario_export', {});
      expect(result.text).toContain('Dołóż 2 pliki zbiorów danych w src/gatling/resources');
      expect(result.text).toContain('Ustaw 2 zmienne środowiska');
      expect(recipeOf(r)).toContain('Potem zbuduj i uruchom projekt');
    });
  });

  it('refuses an argument outside the catalog, such as a path of its own, sending nothing', async () => {
    const r = await rig();
    for (const args of [
      { path: '../../etc/x.zip' },
      { project_id: PROJECT },
      { scenario_id: 'nope' },
    ]) {
      expect((await r.call('scenario_export', args)).isError).toBe(true);
    }
    expect(exportCalls(r)).toEqual([]);
    expect(existsSync(exportsDir(r))).toBe(false);
  });
});
