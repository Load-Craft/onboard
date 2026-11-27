// `results_set_baseline` (module results): pins a run as the baseline of its scenario and load,
// keeps the baseline that was there for the undo, and says only what the backend says (it does not
// tell whether a baseline was pinned by hand or adopted by itself).

import { describe, expect, it } from 'vitest';

import { resultsSetBaseline } from '../../../src/tools/results/setBaseline.js';
import {
  pinnedBaselineOf,
  seedBaseline,
  seedBaselinePair,
  type BaselineBody,
  type Seeded,
} from '../../fake-backend/routes/results.js';
import { expectCatalogEntry } from '../../helpers/moduleContract.js';
import type { ToolRig } from '../../helpers/rig.js';
import {
  BASELINE_CONFLICT,
  BASELINE_NOT_ESTABLISHED,
  BASELINE_UNMEASURED,
  executionPath,
  OTHER,
  OTHER_HANDLE,
  RUN,
  RUN_HANDLE,
} from './fixtures.js';
import { dataOf, errorCode, processOf, resultsRig, runCalls, target } from './rig.js';

const TOOL = 'results_set_baseline';

interface SetData {
  readonly run_id: string;
  readonly execution_id: string;
  readonly changed: boolean;
  readonly previous: { readonly run_id: string; readonly execution_id: string } | null;
}

interface Options {
  /** The baseline the pair has before the call: the run, or nothing. */
  readonly before?: 'other' | 'none';
  readonly seeded?: Seeded<BaselineBody>;
  readonly locale?: 'en' | 'pl';
}

function rig(options: Options = {}): Promise<ToolRig> {
  return resultsRig({
    tools: [resultsSetBaseline],
    locale: options.locale ?? 'en',
    seed: (fake) => {
      if (options.seeded !== undefined) seedBaseline(fake.store, RUN, options.seeded);
      else if ((options.before ?? 'other') === 'other') seedBaselinePair(fake.store, RUN, OTHER);
    },
  });
}

const baselineCalls = (r: ToolRig) =>
  runCalls(r)
    .filter((call) => call.path.endsWith('/baseline'))
    .map((call) => `${call.method} ${target(call)}`);

/** The baseline the backend holds for the pair of RUN, by the run it points at. */
const pinned = (r: ToolRig): string | undefined => pinnedBaselineOf(r.fake.store, RUN);

const logOf = (r: ToolRig) => (processOf(r)?.log ?? []).filter((entry) => entry.tool === TOOL);

interface StoredEntry {
  readonly tool: string;
  readonly args: string;
  readonly result: string;
  readonly undo?: { readonly tool: string; readonly args: Record<string, unknown> };
}

describe('results_set_baseline', () => {
  it('carries its catalog entry: description, class, level, annotations, card and log templates', () => {
    expectCatalogEntry(resultsSetBaseline);
    expect(resultsSetBaseline.implemented).toBe(true);
  });

  it('pins the run and names the baseline that was there, reading it first', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        `run ${RUN_HANDLE} is now the baseline of its scenario and load`,
        `before: ${OTHER_HANDLE} (the backend does not say whether it was pinned or adopted automatically)`,
        `→ undo: results_set_baseline with run_id "${OTHER}"`,
      ].join('\n'),
    );
    expect(baselineCalls(r)).toEqual([
      `GET ${executionPath(RUN, '/baseline')}`,
      `PUT ${executionPath(RUN, '/baseline')}`,
    ]);
    expect(pinned(r)).toBe(RUN);
  });

  it('gives the figures of the answer as data', async () => {
    const r = await rig();
    const data = dataOf<SetData>(await r.call(TOOL, { run_id: RUN, format: 'data' }));
    expect(data).toMatchObject({
      run_id: RUN_HANDLE,
      execution_id: RUN,
      changed: true,
      previous: { run_id: OTHER_HANDLE, execution_id: OTHER },
    });
  });

  it('writes the log entry with the run, and the undo that pins the previous baseline', async () => {
    const r = await rig();
    await r.call(TOOL, { run_id: RUN_HANDLE });
    const [entry] = logOf(r) as unknown as StoredEntry[];
    expect(entry).toMatchObject({
      tool: TOOL,
      args: RUN_HANDLE,
      result: `run ${RUN_HANDLE} is the baseline`,
      undo: { tool: 'results_set_baseline', args: { run_id: OTHER } },
    });
  });

  it('is undone from the log: the pair points at the run it pointed at before', async () => {
    const r = await rig();
    const before = pinned(r);
    expect(before).toBe(OTHER);
    await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(pinned(r)).toBe(RUN);
    const [entry] = logOf(r) as unknown as StoredEntry[];
    const undo = entry?.undo;
    if (undo === undefined) throw new Error('the entry has no undo');
    const back = await r.call(undo.tool, undo.args);
    expect(back.isError, back.text).toBe(false);
    expect(pinned(r)).toBe(before);
  });

  it('writes no undo when nothing was pinned before: the backend cannot remove a pin', async () => {
    const r = await rig({ before: 'none' });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        `run ${RUN_HANDLE} is now the baseline of its scenario and load`,
        'before: no baseline',
        'no undo: the backend has no call to remove a baseline',
      ].join('\n'),
    );
    expect(pinned(r)).toBe(RUN);
    const [entry] = logOf(r) as unknown as StoredEntry[];
    expect(entry?.undo).toBeUndefined();
  });

  it('writes no undo when the previous baseline has no measurements to pin again', async () => {
    const r = await rig({ seeded: BASELINE_UNMEASURED });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain(`before: ${OTHER_HANDLE} (no measurements`);
    const [entry] = logOf(r) as unknown as StoredEntry[];
    expect(entry?.undo).toBeUndefined();
  });

  it('sends no write when the run already is the baseline, and writes no undo', async () => {
    const r = await rig({ before: 'none' });
    seedBaselinePair(r.fake.store, RUN, RUN);
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(`run ${RUN_HANDLE} already is the baseline of its scenario and load`);
    expect(baselineCalls(r)).toEqual([`GET ${executionPath(RUN, '/baseline')}`]);
    const data = dataOf<SetData>(await r.call(TOOL, { run_id: RUN, format: 'data' }));
    expect(data.changed).toBe(false);
    for (const entry of logOf(r) as unknown as StoredEntry[]) expect(entry.undo).toBeUndefined();
  });

  it('a refused write changes nothing and leaves no undo in the log', async () => {
    const r = await rig({ seeded: BASELINE_CONFLICT });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError).toBe(true);
    expect(pinned(r)).toBeUndefined();
    for (const entry of logOf(r) as unknown as StoredEntry[]) expect(entry.undo).toBeUndefined();
  });

  it('a run with no baseline row reads as not established', async () => {
    const r = await rig({ seeded: BASELINE_NOT_ESTABLISHED });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain('before: no baseline');
  });

  it('refuses an argument the catalog does not have, before any request', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: RUN_HANDLE, baseline: OTHER });
    expect(result.isError).toBe(true);
    expect(baselineCalls(r)).toEqual([]);
  });

  it('refuses a run that is no handle or UUID, before any request', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: '../x' });
    expect(result.isError).toBe(true);
    expect(baselineCalls(r)).toEqual([]);
  });

  it('answers a run of no project with not_found and writes nothing', async () => {
    const r = await rig();
    const result = await r.call(TOOL, { run_id: 'e-deadbeef' });
    expect(errorCode(result)).toBe('not_found');
    expect(pinned(r)).toBe(OTHER);
  });

  it('shows the Polish view', async () => {
    const r = await rig({ locale: 'pl' });
    const result = await r.call(TOOL, { run_id: RUN_HANDLE });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toBe(
      [
        `przebieg ${RUN_HANDLE} jest teraz bazą swojego scenariusza i obciążenia`,
        `przedtem: ${OTHER_HANDLE} (backend nie mówi, czy baza była przypięta ręcznie, czy wybrana automatycznie)`,
        `→ cofnięcie: results_set_baseline z run_id "${OTHER}"`,
      ].join('\n'),
    );
  });
});
