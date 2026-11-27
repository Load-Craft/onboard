// `results_export_report` (module results): the archived Gatling report of a run, saved file by
// file under `loadcraft/reports/<handle>/`. The paths come from the HTML of the report, which
// holds what the target answered: a path that leaves the report, a link to another host, a
// symbolic link of the workspace must never move a write outside `loadcraft/reports/`.
//
// The saved files hold the bytes of the report as they are (the user's own report, not a result
// for the model): a test that saves a sentinel in them removes the folder before the rig checks
// the files under `loadcraft/` for sentinels.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { MAX_RESPONSE_BYTES } from '../../../src/http/client.js';
import { resultsExportReport } from '../../../src/tools/results/exportReport.js';
import { delayReportFile, seedReport } from '../../fake-backend/routes/results.js';
import { BACKEND_CANARY, CANARY_PREFIX_LENGTH } from '../../helpers/canary.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  executionPath,
  OTHER_HANDLE,
  REPORT_EXPECTED,
  REPORT_FILES,
  RUN,
  RUN_HANDLE,
} from './fixtures.js';
import { BOUND, dataOf, errorCode, processOf, readsOf, resultsRig, runCalls } from './rig.js';

const TOOL = 'results_export_report';
const FOLDER = `loadcraft/reports/${RUN_HANDLE}`;

interface ExportData {
  readonly run: string;
  readonly run_id: string;
  readonly path: string;
  readonly files: number;
  readonly bytes: number;
  readonly missingCount: number;
  readonly skippedLinks: number;
  readonly truncated: boolean;
}

type Files = Readonly<Record<string, string | Buffer>>;

function rig(
  files: Files | undefined = REPORT_FILES,
  locale: 'en' | 'pl' = 'en',
): Promise<ToolRig> {
  return resultsRig({
    tools: [resultsExportReport],
    locale,
    seed: (fake) => {
      if (files !== undefined) seedReport(fake.store, RUN, files);
    },
  });
}

const reportCalls = (r: ToolRig) => runCalls(r).filter((call) => call.path.includes('/report'));

/** The file paths of the report asked for, relative to the report (`index.html`, `js/stats.js`). */
function asked(r: ToolRig): string[] {
  const prefix = executionPath(RUN, '/report/');
  return reportCalls(r).map((call) => decodeURIComponent(call.path.slice(prefix.length)));
}

/** Every file under a folder, relative to it, sorted. */
function tree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(dir, path).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** A folder outside the workspace, removed when the test ends. */
function outside(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-results-outside-'));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** The saved report holds the sentinel of index.html on purpose: out before the rig's own check. */
function dropReports(r: ToolRig): void {
  rmSync(join(r.workspace, 'loadcraft', 'reports'), { recursive: true, force: true });
}

describe('results_export_report', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(resultsExportReport);
    expect(resultsExportReport.implemented).toBe(true);
  });

  it('is offered as a tool that writes, but deletes nothing (annotations of the catalog)', async () => {
    const r = await rig();
    const listed = (await r.session.listTools()).find((tool) => tool.name === TOOL);
    expect(listed?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('saves the files the report names, byte for byte, starting from index.html', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        'Gatling report of run e-3f9a12c4 saved: 7 files, 1 KB',
        '2 files the report names are not in the archive',
        '4 links were not followed: outside the report or not a file name',
        'The folder is ignored by git: the report holds what the target answered.',
        `open: ${FOLDER}/index.html`,
      ].join('\n'),
    );
    const folder = join(r.workspace, FOLDER);
    expect(tree(folder)).toEqual([...REPORT_EXPECTED.saved]);
    for (const path of REPORT_EXPECTED.saved) {
      expect(readFileSync(join(folder, path), 'utf8'), path).toBe(REPORT_FILES[path]);
    }
    expect(readFileSync(join(r.workspace, 'loadcraft/reports/.gitignore'), 'utf8')).toBe('*\n');
    expect(asked(r)[0]).toBe('index.html');
    expect(runCalls(r).some((call) => call.path.endsWith('/report'))).toBe(false);
    expect(asked(r).sort()).toEqual([...REPORT_EXPECTED.saved, ...REPORT_EXPECTED.missing].sort());
    expect(readsOf(r).map(([tool, , logged]) => [tool, logged])).toEqual([
      [TOOL, `${FOLDER}/index.html`],
    ]);
    dropReports(r);
  });

  it('format data carries counts and the relative path, nothing of the content', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' });
    const data = dataOf<ExportData>(result);
    expect(data).toMatchObject({
      run: RUN_HANDLE,
      run_id: RUN,
      path: `${FOLDER}/index.html`,
      files: 7,
      missingCount: 2,
      skippedLinks: REPORT_EXPECTED.skippedLinks,
      truncated: false,
    });
    expect(data).not.toHaveProperty('absolute');
    expect(result.text).not.toContain(r.workspace);
    expect(result.text).not.toContain('<html');
    dropReports(r);
  });

  it('asks for no file outside the report and writes nothing outside its folder', async () => {
    const r = await rig();
    const before = tree(r.workspace);
    await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(asked(r).length).toBeGreaterThan(0);
    for (const path of asked(r)) {
      expect(path, path).toMatch(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u);
      expect(path.split('/'), path).not.toContain('..');
    }
    expect(asked(r).join(' ')).not.toMatch(/etc\/passwd|cdn\.example|evil\.example|win\.ini/u);
    // the state file of the registry (loadcraft/.cache/) is not a write of the tool
    const added = tree(r.workspace).filter(
      (path) => !before.includes(path) && !path.startsWith('loadcraft/.cache/'),
    );
    expect(added.length).toBeGreaterThan(0);
    for (const path of added) expect(path.startsWith('loadcraft/reports/'), path).toBe(true);
    expect(added.filter((path) => !path.startsWith(`${FOLDER}/`))).toEqual(
      added.filter((path) => path === 'loadcraft/reports/.gitignore'),
    );
    dropReports(r);
  });

  it('the text of a saved file never reaches the model: the sentinel is in the file only', async () => {
    const r = await rig();
    const text = await r.call(TOOL, { run_id: RUN_HANDLE });
    const data = await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true, format: 'data' });
    for (const output of [text.text, data.text, JSON.stringify(readsOf(r))]) {
      expect(output).not.toContain(BACKEND_CANARY);
    }
    expect(readFileSync(join(r.workspace, FOLDER, 'index.html'), 'utf8')).toContain(BACKEND_CANARY);
    dropReports(r);
  });

  it('a run without a report is report_not_archived, and nothing is written', async () => {
    const r = await rig(undefined);
    const result = await r.call(TOOL, { run_id: OTHER_HANDLE });
    expect(errorCode(result)).toBe('report_not_archived');
    expect(result.text).toContain(OTHER_HANDLE);
    expect(existsSync(join(r.workspace, 'loadcraft/reports', OTHER_HANDLE))).toBe(false);
  });

  it('a second export is refused without overwrite, before any request, and the first stays', async () => {
    const r = await rig();
    await r.call(TOOL, { run_id: RUN_HANDLE });
    const marker = join(r.workspace, FOLDER, 'mine.txt');
    writeFileSync(marker, 'kept');
    const callsBefore = reportCalls(r).length;
    const refused = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(errorCode(refused)).toBe('report_exists');
    expect(refused.text).toContain(`${FOLDER}`);
    expect(refused.text).not.toContain(r.workspace);
    expect(reportCalls(r)).toHaveLength(callsBefore);
    expect(readFileSync(marker, 'utf8')).toBe('kept');

    const replaced = await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true });
    expect(replaced.isError, replaced.text).toBe(false);
    expect(existsSync(marker)).toBe(false);
    expect(tree(join(r.workspace, FOLDER))).toEqual([...REPORT_EXPECTED.saved]);
    dropReports(r);
  });

  it('a failure halfway leaves no temporary folder and does not touch the report saved before', async () => {
    const r = await rig();
    await r.call(TOOL, { run_id: RUN_HANDLE });
    const marker = join(r.workspace, FOLDER, 'mine.txt');
    writeFileSync(marker, 'kept');
    // the client sends the path of a file as one segment (`/` encoded)
    r.fake.faults.next('GET', executionPath(RUN, '/report/js%2Fstats.js'), {
      status: 500,
      body: { detail: 'Internal Server Error' },
    });
    const failed = await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true });
    expect(failed.isError).toBe(true);
    expect(failed.text).not.toMatch(/^\[not_implemented\]/u);
    expect(readFileSync(marker, 'utf8')).toBe('kept');
    expect(readdirSync(join(r.workspace, 'loadcraft/reports')).sort()).toEqual([
      '.gitignore',
      RUN_HANDLE,
    ]);
    dropReports(r);
  });

  it('after a failed read it waits for the reads in flight: no temporary folder comes back later', async () => {
    const files = ['a.css', 'b.css', 'c.css', 'd.css'];
    const r = await rig({
      'index.html': files.map((file) => `<link rel="stylesheet" href="${file}">`).join(''),
      ...Object.fromEntries(files.map((file) => [file, 'body{}'])),
    });
    for (const file of files.slice(1)) delayReportFile(r.fake.store, RUN, file, 150);
    r.fake.faults.next('GET', executionPath(RUN, '/report/a.css'), {
      status: 500,
      body: { detail: 'Internal Server Error' },
    });
    const failed = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(failed.isError).toBe(true);
    // the reads still in flight would answer now: give them the time to land
    await new Promise((resolve) => setTimeout(resolve, 400));
    const reports = join(r.workspace, 'loadcraft/reports');
    const left = existsSync(reports) ? readdirSync(reports) : [];
    expect(left.filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(left.filter((name) => name !== '.gitignore')).toEqual([]);
  });

  it('stops at 400 files and says so', async () => {
    const pages = Array.from({ length: 400 }, (_, i) => `p${String(i)}.html`);
    const files: Record<string, string> = {
      'index.html': pages.map((page) => `<a href="${page}">x</a>`).join(''),
    };
    for (const page of pages) files[page] = '<html></html>';
    const r = await rig(files);
    const data = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.truncated).toBe(true);
    expect(data.files).toBe(400);
    expect(tree(join(r.workspace, FOLDER))).toHaveLength(400);
    expect(asked(r).length).toBeLessThanOrEqual(400);
    const text = await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true });
    expect(text.text.split('\n').some((line) => line.startsWith('stopped at 400 files, '))).toBe(
      true,
    );
  });

  it('a file over the limit of the client stops the export; the file is not saved in part', async () => {
    const big = Buffer.alloc(MAX_RESPONSE_BYTES + 1, 0x61);
    const r = await rig({
      'index.html': '<a href="a.html">a</a><a href="big.bin">b</a>',
      'a.html': '<html></html>',
      'big.bin': big,
    });
    const data = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.truncated).toBe(true);
    expect(existsSync(join(r.workspace, FOLDER, 'big.bin'))).toBe(false);
    expect(data.bytes).toBeLessThan(1024);
  });

  it('an index.html over the limit of the client is response_too_large, and nothing is written', async () => {
    const r = await rig({ 'index.html': Buffer.alloc(MAX_RESPONSE_BYTES + 1, 0x61) });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(errorCode(result)).toBe('response_too_large');
    expect(existsSync(join(r.workspace, FOLDER))).toBe(false);
    const reports = join(r.workspace, 'loadcraft/reports');
    expect(
      existsSync(reports) ? readdirSync(reports).filter((name) => name !== '.gitignore') : [],
    ).toEqual([]);
  });

  it('a file whose path is a folder of another file is not saved, and counts as skipped', async () => {
    const r = await rig({
      'index.html': '<a href="a">1</a><a href="a/b">2</a>',
      a: 'file a',
      'a/b': 'file b',
    });
    const data = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.skippedLinks).toBe(1);
    const saved = tree(join(r.workspace, FOLDER)).filter((path) => path !== 'index.html');
    expect(saved.length).toBe(1);
    expect(['a', 'a/b']).toContain(saved[0]);
    expect(data.files).toBe(2);
  });

  it('a file that would pass 64 MiB in all is not saved at all', async () => {
    const part = Buffer.alloc(30 * 1024 * 1024, 0x62);
    const r = await rig({
      'index.html': '<a href="a.bin">a</a><a href="b.bin">b</a><a href="c.bin">c</a>',
      'a.bin': part,
      'b.bin': part,
      'c.bin': part,
    });
    const data = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.truncated).toBe(true);
    expect(data.bytes).toBeLessThanOrEqual(64 * 1024 * 1024);
    const saved = tree(join(r.workspace, FOLDER)).filter((path) => path.endsWith('.bin'));
    expect(saved).toHaveLength(2);
    for (const path of saved) {
      expect(lstatSync(join(r.workspace, FOLDER, path)).size).toBe(part.length);
    }
  });

  it('a folder of the path that links outside the workspace is refused, and nothing is written there', async () => {
    for (const linked of ['loadcraft', 'loadcraft/reports']) {
      const r = await rig();
      const away = outside();
      const link = join(r.workspace, linked);
      if (linked === 'loadcraft/reports')
        mkdirSync(join(r.workspace, 'loadcraft'), { recursive: true });
      else rmSync(link, { recursive: true, force: true });
      // the binding of the project moves with the folder it lives in
      if (linked === 'loadcraft') writeFileSync(join(away, 'project.json'), BOUND);
      symlinkSync(away, link, 'dir');
      const before = tree(away);
      const result = await r.call(TOOL, { run_id: RUN });
      expect(result.isError, `${linked}: ${result.text}`).toBe(true);
      expect(result.text).not.toMatch(/^\[not_implemented\]/u);
      expect(tree(away), linked).toEqual(before);
      rmSync(link);
    }
  });

  it('with overwrite, an old report folder that links outside is not followed: its target keeps its files', async () => {
    const r = await rig();
    const away = outside();
    writeFileSync(join(away, 'precious.txt'), 'keep me');
    mkdirSync(join(r.workspace, 'loadcraft/reports'), { recursive: true });
    symlinkSync(away, join(r.workspace, FOLDER), 'dir');
    const result = await r.call(TOOL, { run_id: RUN, overwrite: true });
    expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    expect(readFileSync(join(away, 'precious.txt'), 'utf8')).toBe('keep me');
    expect(tree(away)).toEqual(['precious.txt']);
    if (!result.isError) expect(lstatSync(join(r.workspace, FOLDER)).isSymbolicLink()).toBe(false);
    dropReports(r);
  });

  it('a .gitignore that links outside is not written through, and one with other lines stays as it is', async () => {
    const linked = await rig();
    const away = outside();
    const target = join(away, 'config.txt');
    writeFileSync(target, 'original');
    mkdirSync(join(linked.workspace, 'loadcraft/reports'), { recursive: true });
    symlinkSync(target, join(linked.workspace, 'loadcraft/reports/.gitignore'));
    const viaLink = await linked.call(TOOL, { run_id: RUN_HANDLE });
    expect(viaLink.text).not.toMatch(/^\[not_implemented\]/u);
    expect(readFileSync(target, 'utf8')).toBe('original');
    dropReports(linked);

    const kept = await rig();
    mkdirSync(join(kept.workspace, 'loadcraft/reports'), { recursive: true });
    writeFileSync(join(kept.workspace, 'loadcraft/reports/.gitignore'), '*\n!keep.txt\n');
    const result = await kept.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(readFileSync(join(kept.workspace, 'loadcraft/reports/.gitignore'), 'utf8')).toBe(
      '*\n!keep.txt\n',
    );
    dropReports(kept);
  });

  it('follows no encoded path, no path of more than five segments, and asks for one path once', async () => {
    const r = await rig({
      'index.html': [
        '<a href="%2e%2e/x.html">1</a>',
        '<a href="a%2F..%2Fb.html">2</a>',
        '<a href="a/b/c/d/e/f.html">3</a>',
        '<link href="style/./x.css">',
        '<a href="sub/../index.html">4</a>',
        '<a href="./index.html">5</a>',
      ].join(''),
    });
    const data = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN_HANDLE, format: 'data' }));
    expect(data.skippedLinks).toBe(3);
    expect(asked(r)).toEqual(['index.html', 'style/x.css']);
    expect(data.missingCount).toBe(1);
  });

  it('a page name of the shape of a secret, missing from the archive, never reaches the model', async () => {
    const r = await rig({
      'index.html': '<script src="js/stats.js"></script>',
      'js/stats.js': `var stats={contents:{ x: { pathFormatted: 'req_${BACKEND_CANARY}' } }};`,
    });
    const text = await r.call(TOOL, { run_id: RUN_HANDLE });
    const data = await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true, format: 'data' });
    expect(text.isError, text.text).toBe(false);
    expect(dataOf<ExportData>(data).missingCount).toBe(1);
    for (const output of [text.text, data.text, JSON.stringify(processOf(r))]) {
      expect(output).not.toContain(BACKEND_CANARY.slice(0, CANARY_PREFIX_LENGTH));
    }
    // The HTTP client logs the path it asks for at debug level (KONTRAKT v3.8, card FIX-62): the
    // log of the process is out of this case until that card lands; results and state are checked
    // above and again by the rig.
    r.forgetLogs();
    dropReports(r);
  });

  it('without the workspace folder it is workspace_not_found, and asks for no file', async () => {
    const r = await rig();
    rmSync(r.workspace, { recursive: true, force: true });
    const result = await r.call(TOOL, { run_id: RUN });
    expect(result.isError).toBe(true);
    expect(result.text).not.toMatch(/^\[not_implemented\]/u);
    expect(reportCalls(r)).toEqual([]);
  });

  it('the handle and the UUID of the run save the same folder', async () => {
    const r = await rig();
    const byId = dataOf<ExportData>(await r.call(TOOL, { run_id: RUN, format: 'data' }));
    expect(byId.path).toBe(`${FOLDER}/index.html`);
    const byHandle = dataOf<ExportData>(
      await r.call(TOOL, { run_id: RUN_HANDLE, overwrite: true, format: 'data' }),
    );
    expect(byHandle).toEqual(byId);
    dropReports(r);
  });

  it('answers in Polish with every key of the view, the path still last', async () => {
    const r = await rig(REPORT_FILES, 'pl');
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).not.toMatch(/results_export_report\.[a-z]/u);
    expect(result.text.split('\n').at(-1)).toMatch(new RegExp(`${FOLDER}/index\\.html$`, 'u'));
    expect(result.text).not.toContain('Gatling report of run');
    dropReports(r);
  });
});
