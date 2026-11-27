// Sentinel cases of the tools of module run (test/security/canaryCases.ts finds them here): a secret
// in an answer of the backend never reaches the model, the log or the state file. Names, messages,
// cron expressions and the build output are texts a third party or a person wrote.

import type { Case } from '../../security/canaryCases.js';
import {
  seedDiagnostics,
  seedHistory,
  seedProfiles,
  seedRunResults,
  seedSavedRuns,
  seedUsage,
} from '../../fake-backend/routes/run.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

const RUN = SKLEP_IDS.executionPerf;

const PROFILE = {
  id: '5a1b2c3d-0001-4a00-8000-000000000001',
  name: `spike password: ${BACKEND_CANARY}`,
  description: `Authorization: Bearer ${SHAPE_CANARY}`,
  injection_profile: 'custom' as const,
  users: 50,
  duration_seconds: 120,
  ramp_duration_seconds: 10,
  is_default: false,
  created_at: '2026-11-20T10:00:00Z',
  injection_steps: [
    { kind: 'rampUsers', note: `Authorization: Bearer ${SHAPE_CANARY}`, users: 50 },
  ],
};

const SAVED = {
  id: '7b1c2d3e-0001-4b00-8000-000000000001',
  name: `nightly password: ${BACKEND_CANARY}`,
  project_id: SKLEP_IDS.project,
  scenario_id: null,
  composite_id: null,
  environment_id: null,
  workload: { type: `ramp Authorization: Bearer ${SHAPE_CANARY}`, vusers: 10 },
  cron_expression: `0 2 * * * Authorization: Bearer ${SHAPE_CANARY}`,
  schedule_enabled: true,
  paused: false,
  auto_paused: false,
  consecutive_failures: 1,
  last_error: `login failed: password=${BACKEND_CANARY}`,
  last_run_at: null,
  next_run_at: null,
  created_at: null,
  updated_at: null,
  created_by: null,
  source_execution_id: RUN,
  target_base_url: `https://user:${BACKEND_CANARY}@shop.example.test`,
  feeder_binding_contracts: [],
  feeder_binding_states: { [`slot password: ${BACKEND_CANARY}`]: 'pinned' as const },
  feeder_bindings: {},
};

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'run_save_profile',
    label: 'a change of a stored profile whose texts hold credentials',
    stage: 'executed',
    args: () => ({ profile: PROFILE.id, users: 51 }),
    setup: (fake) => {
      seedProfiles(fake.store, [PROFILE]);
    },
  },
  {
    tool: 'run_save_profile',
    label: 'a new profile',
    stage: 'executed',
    args: () => ({ name: 'canary', type: 'ramp', users: 5 }),
  },
  {
    tool: 'run_list',
    label: 'the runs of the project, with headline results',
    stage: 'executed',
    args: () => ({ include: ['results'] }),
    setup: (fake) => {
      seedRunResults(fake.store, {
        results: [
          {
            id: 'r1',
            execution_id: RUN,
            created_at: null,
            total_requests: 10,
            ok_count: 9,
            ko_count: 1,
            mean_response_time: 100,
            p95: 200,
            requests_per_second: 5,
          },
        ],
        total: 1,
      });
    },
  },
  {
    tool: 'run_get',
    label: 'one run, with its diagnostics',
    stage: 'executed',
    args: () => ({ run_id: RUN, include: ['diagnostics'] }),
    setup: (fake) => {
      seedDiagnostics(fake.store, RUN, {
        execution_id: RUN,
        status: 'failed',
        stage: 'build',
        cause: `Authorization: Bearer ${SHAPE_CANARY}`,
        error_message: `password=${BACKEND_CANARY}`,
        started_at: null,
        completed_at: null,
        duration_seconds: null,
        load_window_state: 'unavailable',
        log_bytes: 80,
        log_truncated: false,
        logs: `[error] password=${BACKEND_CANARY}\n[error] Authorization: Bearer ${SHAPE_CANARY}`,
        created_entity_inventory: null,
        regression_verdict: null,
        run_aggregate_report: null,
      });
    },
  },
  {
    tool: 'run_get_profiles',
    label: 'one stored load profile with its steps',
    stage: 'executed',
    args: () => ({ profile: PROFILE.id }),
    setup: (fake) => {
      seedProfiles(fake.store, [PROFILE]);
    },
  },
  {
    tool: 'run_get_saved',
    label: 'one saved run',
    stage: 'executed',
    args: () => ({ saved_run: SAVED.id }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_get_saved',
    label: 'the saved runs, format data',
    stage: 'executed',
    args: () => ({ format: 'data' }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_get_usage',
    label: 'the finished runs of the last days and their compute time',
    stage: 'executed',
    args: () => ({ days: 7 }),
    setup: (fake) => {
      seedHistory(fake.store, {
        entries: [
          {
            execution_id: RUN,
            created_at: '2026-11-22T10:20:00Z',
            status: 'completed',
            duration: 600,
            error_rate: 0,
            backend_type: `local ${BACKEND_CANARY}`,
            composite_name: '',
          },
        ],
        total: 1,
      });
      seedUsage(fake.store, { measured_execution_count: 1, total_burn_seconds: 700 });
    },
  },
  {
    tool: 'run_delete',
    label: 'the card of a deletion over a profile whose texts hold credentials',
    stage: 'executed',
    personSaysYes: true,
    args: () => ({ kind: 'profile', item_id: PROFILE.id }),
    setup: (fake) => {
      seedProfiles(fake.store, [PROFILE]);
    },
  },
  {
    tool: 'run_delete',
    label: 'the card of a deletion over a saved run whose texts hold credentials',
    stage: 'executed',
    personSaysYes: true,
    args: () => ({ kind: 'saved_run', item_id: SAVED.id }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_delete',
    label: 'the deletion of a saved run after the yes of the person',
    stage: 'executed',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('run_delete', { kind: 'saved_run', item_id: SAVED.id });
      return {};
    },
    args: () => ({ kind: 'saved_run', item_id: SAVED.id }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_save',
    label: 'the card of a change of the load of a scheduled saved run whose texts hold credentials',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    args: () => ({
      saved_run_id: SAVED.id,
      workload: { type: 'ramp', vusers: 20, ramp: 5, hold: 10 },
      target_base_url: 'https://new.example.test',
    }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_save',
    label: 'a scheduled saved run changed after the yes of the person, its texts tainted',
    stage: 'executed',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('run_save', {
        saved_run_id: SAVED.id,
        workload: { type: 'ramp', vusers: 20, ramp: 5, hold: 10 },
      });
      return {};
    },
    args: () => ({
      saved_run_id: SAVED.id,
      workload: { type: 'ramp', vusers: 20, ramp: 5, hold: 10 },
    }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
  {
    tool: 'run_save',
    label: 'a rename of a saved run, which needs no card, over texts that hold credentials',
    stage: 'executed',
    names: true,
    args: () => ({ saved_run_id: SAVED.id, name: 'Renamed nightly' }),
    setup: (fake) => {
      seedSavedRuns(fake.store, [SAVED]);
    },
  },
];
