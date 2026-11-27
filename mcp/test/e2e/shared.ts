// What runs 2, 4 and 5 share with run 1 and with each other: the environments of the `sklep`
// project, the scripted test on `perf`, the tail of the run (run_plan to results_analyze_run) and
// the helper that lists the writes a run made.

import { readFileSync } from 'node:fs';

import type { components } from '../../src/http/generated/api.js';
import type { RunScript } from '../fake-backend/routes/executions.js';
import type { Step } from './driver.js';

export type FlowDetail = components['schemas']['FlowDetail'];

export function fixtureFlow(name: string): FlowDetail {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/flows/${name}.json`, import.meta.url), 'utf8'),
  ) as FlowDetail;
}

export const ENVIRONMENTS = [
  { name: 'perf', api: 'api.perf.example.com', frontend: 'perf.example.com', default: true },
  { name: 'qa', api: 'api.qa.example.com', frontend: 'qa.example.com', limit: [100, 20] },
  { name: 'dev', api: 'api.dev.example.com', frontend: 'dev.example.com' },
  { name: 'prod', api: 'api.example.com', frontend: 'example.com', limit: [20, 5] },
];

export const PERF_LEVELS = [0, 0, 150, 150, 150, 290, 290, 290, 430, 570, 710, 860, 1000, 1000];

export function spread(values: readonly number[], length: number): number[] {
  const points = Array<number>(length).fill(0);
  values.forEach((value, index) => {
    const from = Math.floor((index * length) / values.length);
    const to = Math.floor(((index + 1) * length) / values.length);
    for (let at = from; at < to; at += 1) points[at] = value;
  });
  return points;
}

/** The test on `perf`: 10 minutes of load, 690 requests/s at the end, p95 over the threshold. */
export const PERF: RunScript = {
  createdBeforeS: 2,
  startsAtS: 16,
  loadS: 600,
  end: 'completed',
  live: (elapsed) =>
    elapsed >= 390
      ? { rps: 690, p95: 910, errorRate: 0.006 }
      : { rps: elapsed * 1.7, p95: 500, errorRate: 0.006 },
  final: { rps: 1035, p95: 1120, errorRate: 0.006 },
  series: spread(PERF_LEVELS, 60),
};

export const RAMP_2000 = { type: 'ramp_concurrency', vusers: 2000, ramp: 600 } as const;

export const SPLIT = [
  { flow: 'przeglądanie', proportion: 60 },
  { flow: 'zakupy', proportion: 30 },
  { flow: 'konto', proportion: 10 },
];

/** The scenario and the data of runs 1 to 4, from the proposal of the split to the provisioning. */
export const SCENARIO_AND_DATA: readonly Step[] = [
  {
    tool: 'scenario_suggest_split',
    args: { name: 'checkout', flows: ['przeglądanie', 'zakupy', 'konto'] },
    expect: '05-scenario_suggest_split-propozycja',
  },
  {
    tool: 'scenario_generate',
    args: {
      name: 'checkout',
      proportions: { przeglądanie: 40, zakupy: 50, konto: 10 },
      data_mix: 'realistic',
    },
    expect: '06-scenario_generate-generowanie',
  },
  {
    tool: 'data_check_readiness',
    args: { scenario: 'checkout' },
    expect: '07-data_check_readiness-plan',
  },
  {
    tool: 'data_create_accounts',
    args: { scenario: 'checkout', slot: 'accounts', count: 2000 },
    expect: '08-data_create_accounts',
  },
];

/** The test on `perf`, its report and its diagnosis: the tail runs 1 to 4 have in common. */
export const RUN_REPORT_DIAGNOSIS: readonly Step[] = [
  {
    tool: 'run_plan',
    args: { scenario: 'checkout', environment: 'perf', target_users: 2000 },
    expect: '09a-run_plan',
  },
  {
    tool: 'run_start',
    args: {
      scenario: 'checkout',
      environment: 'perf',
      profile: RAMP_2000,
      thresholds: { p95_ms: 400, error_rate_pct: 1 },
    },
    expect: '10-run_start',
  },
  {
    tool: 'results_get_report',
    args: { execution: 'e-3f9a12c4' },
    expect: '11-results_get_report',
  },
  {
    tool: 'results_analyze_run',
    args: { execution: 'e-3f9a12c4', force: true },
    expect: '12-results_analyze_run',
  },
];

/** The writes of a run in order, one entry for each run of the same call. */
export function writesOf(calls: readonly { method: string; path: string }[]): string[] {
  const writes = calls
    .filter((call) => call.method !== 'GET')
    .map(
      (call) =>
        `${call.method} ${call.path
          .replace('/api/v1', '')
          .replace(/created-feeder-\d+/u, ':feeder')
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gu, ':id')}`,
    );
  return writes.filter((write, index) => write !== writes[index - 1]);
}
