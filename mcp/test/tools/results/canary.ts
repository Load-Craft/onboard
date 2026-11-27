// Sentinel cases of the tools of module results (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file. The
// suite taints every JSON answer; the files of a report are bytes and are saved as they are.

import { seedComparison } from '../../fake-backend/routes/compare.js';
import {
  seedBaseline,
  seedBaselinePair,
  seedLogs,
  seedProductionOverlay,
  seedReport,
  seedRequestDetail,
  seedThinkTime,
} from '../../fake-backend/routes/results.js';
import type { Case } from '../../security/canaryCases.js';
import {
  BASELINE_ESTABLISHED,
  COMPARE_SYNTHETIC,
  LOGS_FULL,
  OTHER,
  OVERLAY_FULL,
  REQUEST_FULL,
  RUN,
  RUN_HANDLE,
  THINK_FULL,
} from './fixtures.js';

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'results_get_request',
    label: 'one request of a run, with its series',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE, request: 'POST /checkout', include: ['series'] }),
    setup: (fake) => {
      seedRequestDetail(fake.store, RUN, 'POST /checkout', REQUEST_FULL);
    },
  },
  {
    tool: 'results_get_logs',
    label: 'log lines of a run',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE }),
    setup: (fake) => {
      seedLogs(fake.store, RUN, LOGS_FULL);
    },
  },
  {
    tool: 'results_get_logs',
    label: 'log lines of a run, format data',
    stage: 'executed',
    args: () => ({ run_id: RUN, format: 'data' }),
    setup: (fake) => {
      seedLogs(fake.store, RUN, LOGS_FULL);
    },
  },
  {
    tool: 'results_export_report',
    label: 'the report of a run saved under loadcraft/reports',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE }),
    setup: (fake) => {
      seedReport(fake.store, RUN, {
        'index.html': '<link rel="stylesheet" href="style.css"><a href="missing.html">m</a>',
        'style.css': 'body{}',
      });
    },
  },
  {
    tool: 'results_check_production',
    label: 'the load and the think time of a production replay',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE }),
    setup: (fake) => {
      seedProductionOverlay(fake.store, RUN, OVERLAY_FULL);
      seedThinkTime(fake.store, RUN, THINK_FULL);
    },
  },
  {
    tool: 'results_compare_runs',
    label: 'a run against its baseline, with the console errors',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE, compare_to: 'baseline', include: ['errors'] }),
    setup: (fake) => {
      seedBaseline(fake.store, RUN, BASELINE_ESTABLISHED);
      seedComparison(fake.store, OTHER, RUN, COMPARE_SYNTHETIC);
    },
  },
  {
    tool: 'results_compare_runs',
    label: 'a run against another, format data',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE, compare_to: OTHER, format: 'data' }),
    setup: (fake) => {
      seedComparison(fake.store, OTHER, RUN, COMPARE_SYNTHETIC);
    },
  },
  {
    tool: 'results_set_baseline',
    label: 'a run pinned as the baseline over another, format data',
    stage: 'executed',
    args: () => ({ run_id: RUN_HANDLE, format: 'data' }),
    setup: (fake) => {
      seedBaselinePair(fake.store, RUN, OTHER);
    },
  },
];
