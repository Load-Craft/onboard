// Self-check routes of the fake backend: the scenario detail (which carries the whole artifact and
// the `self_check` field), the manual start (`POST …/self-check`) and the per-request rows of a
// run (`…/executions/{id}/endpoints`). A check is a job on the test clock: a test plans the states
// it walks through (`pending` → `running` → …), and the detail shows the state the clock has
// reached. Registration is idempotent per fake, so every test that needs the routes may call it.

import { registerDataRoutes, scenarioDetailHooks, unboundStatus } from './data.js';
import type { Fake, JobStep } from '../server.js';
import { FakeHttpError } from '../server.js';
import { requireRun } from './executionOwner.js';
import {
  SKLEP_COLLECTIONS,
  type SklepEndpointRow,
  type SklepCheckVerdict,
  type SklepSelfCheckFailure,
  type SklepSelfCheckRepair,
  type SklepSelfCheckRun,
  type SklepSelfCheckStep,
  type SklepExecutionResult,
  type SklepScenario,
} from '../worlds/sklep.js';

export type SelfCheckFailureDocument = SklepSelfCheckFailure;

/** Why a repair round wrote no version, as the contract enumerates the codes. */
export type RefusedCode = NonNullable<SklepSelfCheckRepair['refused_code']>;

/** One repair round of the document. */
export type SelfCheckRepairDocument = SklepSelfCheckRepair;

/** The states a self-check can be in, as the contract enumerates them. */
export type SelfCheckStatus = SklepCheckVerdict;

/** A step of a run of the check (see the `runs` of the document). */
export type SelfCheckStepDocument = SklepSelfCheckStep;

/** One run of the check: the first pass, or the run of a version a repair wrote. */
export type SelfCheckRunDocument = SklepSelfCheckRun;

export interface SelfCheckDocument {
  status: SelfCheckStatus;
  scenario_version: number;
  execution_ids: string[];
  failure: SelfCheckFailureDocument | null;
  notes: string[];
  missing_slots: string[];
  repairs: SelfCheckRepairDocument[];
  max_repair_rounds: number | null;
  runs: SelfCheckRunDocument[];
  started_at: string | null;
  finished_at: string | null;
}

/** A document with the given fields; the rest is what a fresh, queued check has. */
export function selfCheckDocument(fields: Partial<SelfCheckDocument>): SelfCheckDocument {
  return {
    status: 'pending',
    scenario_version: 1,
    execution_ids: [],
    failure: null,
    notes: [],
    missing_slots: [],
    repairs: [],
    max_repair_rounds: 2,
    runs: [],
    started_at: null,
    finished_at: null,
    ...fields,
  };
}

export function failureDocument(
  requestName: string,
  message: string,
  goalUrl: string | null = null,
  httpStatus: number | null = null,
): SelfCheckFailureDocument {
  return { request_name: requestName, message, http_status: httpStatus, goal_url: goalUrl };
}

/** A step of a run: `[name, result, http status, reason]`; a failed step has a status and a reason. */
export type StepSpec = readonly [
  name: string,
  result: SklepSelfCheckStep['result'],
  http?: number,
  reason?: string,
];

/** One run of a check with its steps in the order they ran; `planIndex` counts from 0 in the plan. */
export function checkRunDocument(
  executionId: string,
  version: number,
  status: SklepCheckVerdict | null,
  steps: readonly StepSpec[],
  stepsOmitted = 0,
): SelfCheckRunDocument {
  return {
    execution_id: executionId,
    scenario_version: version,
    status,
    steps: steps.map(([name, result, http, reason], index) => ({
      name,
      group: null,
      plan_index: index,
      is_preflight: false,
      method: null,
      path: null,
      result,
      http_status: http ?? (result === 'ok' ? 200 : null),
      reason: reason ?? null,
    })),
    steps_omitted: stepsOmitted,
  };
}

export interface SelfCheckFake {
  /** What the next `POST …/self-check` of the scenario does: its states over time since the POST. */
  plan(scenarioId: string, steps: readonly JobStep<SelfCheckDocument>[]): void;
  /** The scenario has no modular build: starting its check answers `409 full_rebuild_required`. */
  requireRebuild(scenarioId: string): void;
  /** The document the detail shows while no check of the scenario is in progress. */
  set(scenarioId: string, document: SelfCheckDocument): void;
}

/** Seconds a check without a plan takes before it shows the stored document again. */
const DEFAULT_CHECK_MS = 3000;

const registered = new WeakMap<Fake, SelfCheckFake>();

/**
 * What a check without a plan ends with on this fake, when the function answers (the stand-alone
 * fake decides from the scenario's data); `undefined` keeps the stored document. One per fake.
 */
export const selfCheckOutcomes = new WeakMap<
  Fake,
  (scenario: SklepScenario) => SelfCheckDocument | undefined
>();

/**
 * A fake that asks for this answers a check that has no pick for a slot of accounts or of plain
 * data without rows with `waiting_for_data`, whatever a test planned. The backend's self-check
 * runs a scenario alone and reads only the scenario's own picks, never the picks of a composition
 * it belongs to (`_run_slot_bindings`).
 */
export const selfCheckReadsOwnPicks = new WeakSet<Fake>();

/** The document of a check of `scenario` that waits for the slots it has no pick for; else undefined. */
export function waitingForOwnPicks(scenario: SklepScenario): SelfCheckDocument | undefined {
  const missing = scenario.feeder_slots
    .filter(
      (slot) =>
        unboundStatus(slot) === 'missing' && scenario.slot_bindings[slot.slot] === undefined,
    )
    .map((slot) => slot.slot);
  return missing.length === 0
    ? undefined
    : selfCheckDocument({
        status: 'waiting_for_data',
        scenario_version: scenario.current_version,
        missing_slots: missing,
      });
}

const projectNotFound = (id: string): string => `Project not found: ${id}`;

/** Registers the routes (once per fake) and returns the handle a test plans checks with. */
export function registerSelfCheckRoutes(fake: Fake): SelfCheckFake {
  const known = registered.get(fake);
  if (known !== undefined) return known;

  const plans = new Map<string, readonly JobStep<SelfCheckDocument>[]>();
  const stored = new Map<string, SelfCheckDocument>();
  const jobOf = new Map<string, string>();
  const needsRebuild = new Set<string>();

  const control: SelfCheckFake = {
    plan: (scenarioId, steps) => {
      plans.set(scenarioId, steps);
    },
    requireRebuild: (scenarioId) => {
      needsRebuild.add(scenarioId);
    },
    set: (scenarioId, document) => {
      stored.set(scenarioId, document);
    },
  };
  registered.set(fake, control);

  const baseline = (scenario: SklepScenario): SelfCheckDocument | null =>
    stored.get(scenario.id) ?? scenario.self_check;

  // The scenario detail is the data routes'; the state of a check in progress is put into it.
  registerDataRoutes(fake);
  scenarioDetailHooks.set(fake, (scenario) => {
    const jobId = jobOf.get(scenario.id);
    const job = jobId === undefined ? undefined : fake.jobs.find<SelfCheckDocument>(jobId);
    return { ...scenario, self_check: job === undefined ? baseline(scenario) : job.state };
  });

  fake.route(
    'POST',
    '/api/v1/projects/{project_id}/gatling/scenarios/{scenario_id}/self-check',
    (req, store, jobs) => {
      store
        .collection(SKLEP_COLLECTIONS.projects)
        .require(req.params.project_id, projectNotFound(req.params.project_id));
      const scenario = store
        .collection<SklepScenario>(SKLEP_COLLECTIONS.scenarios)
        .require(req.params.scenario_id, 'Scenario not found');
      if (needsRebuild.has(scenario.id)) {
        throw new FakeHttpError(409, {
          detail:
            'full_rebuild_required: this scenario has no modular build — flat Scala is retired. Regenerate this scenario before running it.',
        });
      }
      const jobId = jobOf.get(scenario.id);
      const running = jobId === undefined ? undefined : jobs.find(jobId);
      if (running !== undefined && !running.finished) {
        throw new FakeHttpError(409, {
          detail: {
            code: 'self_check_in_progress',
            message: 'A self-check of this scenario is already running.',
          },
        });
      }
      const waiting = selfCheckReadsOwnPicks.has(fake) ? waitingForOwnPicks(scenario) : undefined;
      // A check that waits for data does not use up what the test planned for the check proper.
      const planned = waiting === undefined ? plans.get(scenario.id) : undefined;
      if (waiting === undefined) plans.delete(scenario.id);
      const queued = selfCheckDocument({ scenario_version: scenario.current_version });
      const outcome =
        waiting ?? (planned === undefined ? selfCheckOutcomes.get(fake)?.(scenario) : undefined);
      const steps = planned ?? [
        { afterMs: 0, state: queued },
        { afterMs: DEFAULT_CHECK_MS, state: outcome ?? baseline(scenario) ?? queued },
      ];
      jobOf.set(scenario.id, jobs.start('self_check', { steps }).id);
      return { status: 202, body: { status: 'pending' } };
    },
  );

  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/gatling/executions/{execution_id}/endpoints',
    (req, store) => {
      // A run under way has no record yet; it is still a run of the project.
      requireRun(store, req.params.execution_id, req.params.project_id);
      const result = store
        .collection<SklepExecutionResult>(SKLEP_COLLECTIONS.results)
        .get(req.params.execution_id);
      // A run whose samples are gone answers empty lists and says why (`series_source`).
      const rows: SklepEndpointRow[] = result?.endpoints ?? [];
      return {
        status: 200,
        body: {
          // `order=run` lists the rows in the order the run first answered them, numbered from 1.
          endpoints: rows.map((row, index) => ({
            ...row,
            time_series: [],
            run_order: req.query['order'] === 'run' ? index + 1 : null,
          })),
          groups: [],
          repicks: [],
          series_source:
            result === undefined ? ('absent_retention' as const) : ('prometheus' as const),
          series_retention: result === undefined ? '15 days' : null,
        },
      };
    },
  );

  return control;
}
