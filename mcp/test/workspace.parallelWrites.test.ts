// DOKTOR-07 pkt 1: two tools called at once in one server each leave their entry in the log of the
// state file. A write of the state reads the file fresh and applies its own change on it, so a later
// write never puts back a state that lacks an earlier one.

import { describe, expect, it } from 'vitest';

import { resultsCompareRuns } from '../src/tools/results/compareRuns.js';
import { resultsGetLogs } from '../src/tools/results/getLogs.js';
import { resultsSetBaseline } from '../src/tools/results/setBaseline.js';
import { seedComparison } from './fake-backend/routes/compare.js';
import { seedBaselinePair } from './fake-backend/routes/results.js';
import {
  COMPARE_SYNTHETIC,
  OTHER,
  OTHER_HANDLE,
  RUN,
  RUN_HANDLE,
} from './tools/results/fixtures.js';
import { processOf, resultsRig } from './tools/results/rig.js';

describe('tools called at once write the state one after another', () => {
  it('results_set_baseline and results_compare_runs in parallel: both entries stay', async () => {
    const r = await resultsRig({
      tools: [resultsSetBaseline, resultsCompareRuns],
      seed: (fake) => {
        seedComparison(fake.store, OTHER, RUN, COMPARE_SYNTHETIC);
        seedBaselinePair(fake.store, RUN, OTHER);
      },
    });
    const [set, compare] = await Promise.all([
      r.call('results_set_baseline', { run_id: RUN_HANDLE }),
      r.call('results_compare_runs', { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE }),
    ]);
    expect(set.isError, set.text).toBe(false);
    expect(compare.isError, compare.text).toBe(false);
    const process = processOf(r);
    const tools = [...(process?.log ?? []), ...(process?.reads ?? [])].map((entry) => entry.tool);
    expect(tools).toContain('results_set_baseline');
    expect(tools).toContain('results_compare_runs');
  });

  it('the same pair five times, with the warnings of the store in the log of the server', async () => {
    const r = await resultsRig({
      tools: [resultsSetBaseline, resultsCompareRuns],
      seed: (fake) => {
        seedComparison(fake.store, OTHER, RUN, COMPARE_SYNTHETIC);
        seedBaselinePair(fake.store, RUN, OTHER);
      },
    });
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([
        r.call('results_set_baseline', { run_id: RUN_HANDLE }),
        r.call('results_compare_runs', { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE }),
      ]);
    }
    const lost = r.logRecords().filter((record) => record.msg === 'log entry not saved');
    expect(lost).toEqual([]);
    const process = processOf(r);
    const entries = [...(process?.log ?? []), ...(process?.reads ?? [])];
    expect(entries.filter((entry) => entry.tool === 'results_set_baseline')).toHaveLength(5);
    expect(entries.filter((entry) => entry.tool === 'results_compare_runs')).toHaveLength(5);
  });

  it('ten reads at once: ten entries', async () => {
    const r = await resultsRig({ tools: [resultsGetLogs] });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => r.call('results_get_logs', { run_id: RUN_HANDLE })),
    );
    for (const result of results) expect(result.isError, result.text).toBe(false);
    const reads = (processOf(r)?.reads ?? []).filter((entry) => entry.tool === 'results_get_logs');
    expect(reads).toHaveLength(10);
  });
});
