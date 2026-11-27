// The coverage of module results: the operations of the backend the tests of its written tools call on
// the fake backend equal the operations of those tools in the catalog. Every view of every written
// tool is called once here; the requests the fake saw are turned into the catalog's operations.

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { MODULE_INDEX } from '../../../src/tools/_generated/modules.js';
import { seedComparison } from '../../fake-backend/routes/compare.js';
import {
  seedBaseline,
  seedLogs,
  seedProductionOverlay,
  seedReport,
  seedRequestDetail,
  seedThinkTime,
} from '../../fake-backend/routes/results.js';
import {
  expectModuleCoverage,
  operationOf,
  type UnusedOperations,
} from '../../helpers/moduleClosure.js';
import { RESULTS_DEBTS } from './debts.js';
import {
  BASELINE_ESTABLISHED,
  COMPARE_SYNTHETIC,
  LOGS_FULL,
  OTHER,
  OTHER_HANDLE,
  OVERLAY_FULL,
  REPORT_FILES,
  REQUEST_FULL,
  RUN,
  RUN_HANDLE,
  THINK_FULL,
} from './fixtures.js';
import { resultsRig } from './rig.js';

/** The operations of written tools that no test calls, with why. */
const UNUSED: UnusedOperations = {
  get_execution_endpoint_percentiles_api_v1_projects__project_id__gatling_executions__execution_id__endpoints__name__percentiles_get:
    'the percentiles of a request come from the histogram of the request detail: the route is not called',
  get_execution_report_index_api_v1_projects__project_id__gatling_executions__execution_id__report_get:
    'the report is read file by file from its index.html: the index route is not called',
};

describe('module results: the tests call every operation of the written tools', () => {
  it('equals the operations of the catalog, but those named unused; the debts call none', async () => {
    const r = await resultsRig({
      tools: MODULE_INDEX.results,
      seed: (fake) => {
        seedRequestDetail(fake.store, RUN, 'POST /checkout', REQUEST_FULL);
        seedLogs(fake.store, RUN, LOGS_FULL);
        seedReport(fake.store, RUN, REPORT_FILES);
        seedProductionOverlay(fake.store, RUN, OVERLAY_FULL);
        seedThinkTime(fake.store, RUN, THINK_FULL);
        seedComparison(fake.store, OTHER, RUN, COMPARE_SYNTHETIC);
        seedBaseline(fake.store, RUN, BASELINE_ESTABLISHED);
      },
    });
    const calls: [string, Record<string, unknown>][] = [
      ['results_get_request', { run_id: RUN_HANDLE, request: 'POST /checkout' }],
      [
        'results_get_request',
        { run_id: RUN_HANDLE, request: 'POST /checkout', include: ['series'] },
      ],
      ['results_get_logs', { run_id: RUN_HANDLE }],
      ['results_export_report', { run_id: RUN_HANDLE, overwrite: true }],
      ['results_check_production', { run_id: RUN_HANDLE }],
      ['results_compare_runs', { run_id: RUN_HANDLE, compare_to: OTHER_HANDLE }],
      ['results_compare_runs', { run_id: RUN_HANDLE, compare_to: 'baseline' }],
      // reads the baseline of the pair, then pins the run
      ['results_set_baseline', { run_id: RUN_HANDLE }],
    ];
    for (const [tool, args] of calls) {
      const result = await r.call(tool, args);
      if (result.isError) throw new Error(`${tool} ${JSON.stringify(args)}: ${result.text}`);
    }
    // the saved report holds the bytes of the report as they are, which the rig would scan for sentinels
    rmSync(join(r.workspace, 'loadcraft', 'reports'), { recursive: true, force: true });
    const called = new Set(
      r.fake.calls
        .map((call) => operationOf('results', call.method, call.path))
        .filter((id): id is string => id !== undefined),
    );
    expectModuleCoverage('results', called, RESULTS_DEBTS, UNUSED);
  });
});
