// `flows_export_walk_image` (module flows): an image of a step of a walk, saved to the workspace, read
// from the fake backend over HTTP (docs/tools/flows/export-walk-image.md). The file is the product: the
// tests read it back from the workspace.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/registry.js';
import { flowsExportWalkImage } from '../../../src/tools/flows/exportWalkImage.js';
import { registerLookupRoutes } from '../../fake-backend/routes/lookup.js';
import {
  registerWalkImageRoutes,
  seedWalkSnapshot,
  seedWalkStill,
} from '../../fake-backend/routes/walkImages.js';
import type { Fake } from '../../fake-backend/server.js';
import { seedSklep } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import { toolRig, type ToolRig } from '../../helpers/rig.js';

const PROJECT = SKLEP_IDS.project;
const WALK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const HANDLE = 'r-1a2b3c4d';
const STILL = '7b1f6a30-2c8d-4e59-9a04-3d5c8e1f7b62';
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946000100', 'hex');
const DIR = `loadcraft/walks/${HANDLE}`;

const BOUND = {
  'loadcraft/project.json': JSON.stringify({
    schema: 1,
    url: 'https://app.loadcraft.io',
    project: { id: PROJECT, name: 'sklep' },
  }),
};

/** Puts a walk in the state as the tool that starts walks does (the registry applies a catalog tool's update). */
const remember = (id: string) =>
  defineTool({
    name: 'flows_describe_journeys',
    title: 'remember',
    description: 'stub',
    input: z.strictObject({}),
    annotations: {},
    run: () =>
      Promise.resolve({
        status: 'done' as const,
        data: {},
        update: { ids: { walk_id: id }, log: { values: { paths: 1 } } },
      }),
    render: () => 'ok',
  });

async function rig(
  locale: 'en' | 'pl' = 'en',
  before?: (workspace: string) => void,
): Promise<ToolRig> {
  const r = await toolRig({
    tools: [flowsExportWalkImage, remember(WALK)],
    world: (fake: Fake) => {
      registerLookupRoutes(fake);
      registerWalkImageRoutes(fake);
      seedSklep(fake.store, { stage: 'flows' });
      seedWalkSnapshot(fake.store, WALK, 3, 1, PNG);
      seedWalkStill(fake.store, WALK, STILL, JPEG);
    },
    env: { LOADCRAFT_LOCALE: locale },
    files: BOUND,
  });
  before?.(r.workspace);
  return r;
}

const imageCalls = (r: ToolRig) =>
  r.fake.calls.filter((call) => /\/(?:snapshot|stills\/)/u.test(call.path));
interface LogRead {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
}
const reads = (r: ToolRig): LogRead[] => {
  const text = readFileSync(join(r.workspace, 'loadcraft', '.cache', 'state.json'), 'utf8');
  const state = JSON.parse(text) as { process: Record<string, { reads: LogRead[] }> };
  return Object.values(state.process).flatMap((process) => process.reads);
};
const files = (r: ToolRig): string[] =>
  existsSync(join(r.workspace, DIR)) ? readdirSync(join(r.workspace, DIR)).sort() : [];

describe('flows_export_walk_image', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(flowsExportWalkImage);
    expect(flowsExportWalkImage.implemented).toBe(true);
    expect(flowsExportWalkImage.annotations.readOnlyHint).toBe(false);
  });

  it('saves a live snapshot of a step attempt byte for byte, and answers with its path', async () => {
    const r = await rig();
    const result = await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        `Saved the live image of step 3, attempt 1 of walk ${HANDLE}: 12 B.`,
        'The folder is ignored by git: the image shows what the application displayed.',
        `open: ${DIR}/path-3-attempt-1.png`,
      ].join('\n'),
    );
    expect(readFileSync(join(r.workspace, DIR, 'path-3-attempt-1.png'))).toEqual(PNG);
    expect(readFileSync(join(r.workspace, 'loadcraft/walks/.gitignore'), 'utf8')).toBe('*\n');
    expect(imageCalls(r).map((call) => call.path)).toEqual([
      `/api/v1/projects/${PROJECT}/scenario-from-description/runs/${WALK}/paths/3/attempts/1/snapshot`,
    ]);
  });

  it('saves a still of the timeline under the extension of its type', async () => {
    const r = await rig();
    const result = await r.call('flows_export_walk_image', { walk_id: WALK, still_id: STILL });
    expect(result.isError, result.text).toBe(false);
    expect(result.text.split('\n')[0]).toBe(`Saved the still ${STILL} of walk ${HANDLE}: 13 B.`);
    expect(readFileSync(join(r.workspace, DIR, `still-${STILL}.jpg`))).toEqual(JPEG);
    expect(imageCalls(r).map((call) => call.path)).toEqual([
      `/api/v1/projects/${PROJECT}/scenario-from-description/runs/${WALK}/stills/${STILL}`,
    ]);
  });

  it('takes the walk of the state, and the three ways to name one', async () => {
    const r = await rig();
    await r.call('flows_describe_journeys', {});
    for (const walk_id of [undefined, WALK.toUpperCase(), `record_run:${WALK}`]) {
      const result = await r.call('flows_export_walk_image', {
        ...(walk_id === undefined ? {} : { walk_id }),
        path_index: 3,
        overwrite: true,
      });
      expect(result.isError, String(walk_id)).toBe(false);
    }
    expect(
      (await r.call('flows_export_walk_image', { walk_id: 'r-deadbeef', path_index: 3 })).text,
    ).toMatch(/^\[operation_unknown\] /u);
  });

  it('without a walk and none in the state asks for one, with no request', async () => {
    const r = await rig();
    expect((await r.call('flows_export_walk_image', { path_index: 3 })).text).toMatch(
      /^\[missing_argument\] /u,
    );
    expect(imageCalls(r)).toEqual([]);
  });

  it('exactly one of path_index and still_id; attempt only with path_index; a still id with a path in it is refused', async () => {
    const r = await rig();
    for (const args of [
      { walk_id: WALK },
      { walk_id: WALK, path_index: 3, still_id: STILL },
      { walk_id: WALK, still_id: STILL, attempt: 2 },
      { walk_id: WALK, still_id: '../../etc/passwd' },
      { walk_id: WALK, still_id: 'a/b' },
    ]) {
      const result = await r.call('flows_export_walk_image', args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(imageCalls(r)).toEqual([]);
    expect(files(r)).toEqual([]);
  });

  it('refuses values outside the catalog bounds and an argument it does not give, with no request', async () => {
    const r = await rig();
    for (const args of [
      { walk_id: WALK, path_index: -1 },
      { walk_id: WALK, path_index: 10001 },
      { walk_id: WALK, path_index: 3, attempt: 0 },
      { walk_id: WALK, path_index: 3, attempt: 101 },
      { walk_id: WALK, path_index: 3, project_id: PROJECT },
    ]) {
      expect((await r.call('flows_export_walk_image', args)).isError, JSON.stringify(args)).toBe(
        true,
      );
    }
    expect(imageCalls(r)).toEqual([]);
  });

  it('an image saved earlier is refused before the request, and replaced with overwrite', async () => {
    const r = await rig();
    await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    const calls = imageCalls(r).length;
    const again = await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/^\[flows_walk_image_exists\] /u);
    expect(again.text).toContain(`${DIR}/path-3-attempt-1.png`);
    expect(imageCalls(r)).toHaveLength(calls);
    writeFileSync(join(r.workspace, DIR, 'path-3-attempt-1.png'), 'old');
    const replaced = await r.call('flows_export_walk_image', {
      walk_id: WALK,
      path_index: 3,
      overwrite: true,
    });
    expect(replaced.isError, replaced.text).toBe(false);
    expect(readFileSync(join(r.workspace, DIR, 'path-3-attempt-1.png'))).toEqual(PNG);
    expect(files(r)).toEqual(['path-3-attempt-1.png']);
  });

  it('overwrite replaces an image of the same name that has another extension', async () => {
    const r = await rig('en', (workspace) => {
      mkdirSync(join(workspace, DIR), { recursive: true });
      writeFileSync(join(workspace, DIR, 'path-3-attempt-1.jpg'), 'old');
    });
    expect(
      (await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 })).text,
    ).toMatch(/^\[flows_walk_image_exists\] /u);
    const result = await r.call('flows_export_walk_image', {
      walk_id: WALK,
      path_index: 3,
      overwrite: true,
    });
    expect(result.isError, result.text).toBe(false);
    expect(files(r)).toEqual(['path-3-attempt-1.png']);
  });

  it('an image the backend does not have is not_found, and one that is no image saves nothing', async () => {
    const r = await rig();
    const missing = await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 9 });
    expect(missing.text).toMatch(/^\[not_found\] /u);
    r.fake.faults.next(
      'GET',
      `/api/v1/projects/${PROJECT}/scenario-from-description/runs/${WALK}/paths/3/attempts/1/snapshot`,
      { status: 200, body: { detail: 'not an image' } },
      { outsideContract: true },
    );
    const notImage = await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    expect(notImage.text).toMatch(/^\[flows_walk_image_not_an_image\] /u);
    expect(files(r)).toEqual([]);
  });

  it('a folder of the workspace that points outside it is refused, and nothing is written there', async () => {
    const outside = join(tmpdir(), `lc-walks-outside-${String(process.pid)}`);
    mkdirSync(outside, { recursive: true });
    const r = await rig('en', (workspace) => {
      mkdirSync(join(workspace, 'loadcraft'), { recursive: true });
      symlinkSync(outside, join(workspace, 'loadcraft/walks'));
    });
    const result = await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    expect(result.isError).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
    expect(imageCalls(r)).toEqual([]);
  });

  it('format data: the path, the exact size and the type', async () => {
    const r = await rig();
    const data: unknown = JSON.parse(
      (await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3, format: 'data' }))
        .text,
    );
    expect(data).toEqual({
      project_id: PROJECT,
      walk: { id: WALK, handle: HANDLE },
      kind: 'snapshot',
      path: `${DIR}/path-3-attempt-1.png`,
      bytes: PNG.byteLength,
      type: 'image/png',
      path_index: 3,
      attempt: 1,
    });
  });

  it('logs the call with the templates of the catalog', async () => {
    const r = await rig();
    await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 });
    await r.call('flows_export_walk_image', { walk_id: WALK, still_id: STILL });
    expect(reads(r).map((entry) => [entry.args, entry.result])).toEqual([
      [`${HANDLE} 3`, `${DIR}/path-3-attempt-1.png`],
      [`${HANDLE} still:${STILL}`, `${DIR}/still-${STILL}.jpg`],
    ]);
  });

  it('speaks Polish and only Polish', async () => {
    const r = await rig('pl');
    const text = (await r.call('flows_export_walk_image', { walk_id: WALK, path_index: 3 })).text;
    expect(text.split('\n')[0]).toBe(
      `Zapisano obraz na żywo kroku 3, próby 1 przejścia ${HANDLE}: 12 B.`,
    );
    expect(text).not.toMatch(/\b(?:Saved|folder is ignored)\b/u);
    expect(text.split('\n').at(-1)).toBe(`open: ${DIR}/path-3-attempt-1.png`);
  });
});
