// The start of a test run, in the order that keeps load off a system until everything about it is
// known: resolve the target and the environment, refuse a protected environment without limits,
// clamp every phase to the environment's limits before start, ask for the user's confirmation,
// check the data under the clamped load, start, and record the run. No step before the last two
// sends anything that starts load.

import * as z from 'zod';

import { preflightCompositionFor, preflightScenarioFor, type DataDemand } from '../../api/data.js';
import {
  getRunEnvironment,
  listActiveRuns,
  readRun,
  startCompositionRun,
  startScenarioRun,
  type RunCaps,
  type SlaThreshold,
} from '../../api/executions.js';
import { getCompat } from '../../api/status.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { createLockTable, withLock } from '../../ops/lock.js';
import { findAllRunning, recordOperation } from '../../ops/operation.js';
import type { Link } from '../../outcome.js';
import { clampProfile, type ClampResult } from '../../profiles/caps.js';
import { buildPresets, type Profile, type ProfileType } from '../../profiles/presets.js';
import { num } from '../../render/primitives.js';
import {
  dataShortage,
  type RunConfirmData,
  type RunDataSlot,
  type RunStartData,
} from '../../render/views/run.js';
import { createResolver, type Handle, type RunTarget } from '../../resolve/handles.js';
import { content } from '../moduleCall.js';
import {
  asProfile,
  profileSchema,
  recordRunLoad,
  testRunSaved,
  type TestRunSaved,
} from './saved.js';
import { testRunOperation } from './wait.js';
import { settleAll } from '../../http/operation.js';

export { asProfile, profileSchema, testRunSaved, type TestRunSaved };

/** Stress stairs reach `5 × max(vusers / 5, 1)` new users per second. */
const STRESS_MIN_TOP = 5;

/** Longest environment name quoted in a refusal. */
export const ENVIRONMENT_NAME_LIMIT = 80;

export const thresholdsSchema = z.strictObject({
  p95_ms: z.number().int().positive().optional(),
  error_rate_pct: z.number().min(0).max(100).optional(),
});

export interface StartArgs {
  readonly scenario: string;
  readonly environment: string;
  readonly profile: z.infer<typeof profileSchema>;
  readonly thresholds?: z.infer<typeof thresholdsSchema> | undefined;
  readonly confirm_capped?: boolean | undefined;
  readonly project?: string | undefined;
}

export interface StartedRun {
  readonly kind: 'started';
  readonly handle: string;
  readonly executionId: string;
  readonly saved: TestRunSaved;
  readonly data: RunStartData;
  /** Live page of the run. */
  readonly link: Link;
}

/** A test of this target on this environment is still running: nothing was sent, the call joins it. */
export interface JoinedRun {
  readonly kind: 'joined';
  readonly executionId: string;
  readonly saved: TestRunSaved;
}

/** Nothing was sent: the user has to agree to the environment or to the clamped load first. */
export interface ConfirmationNeeded {
  readonly kind: 'confirm';
  readonly data: RunConfirmData;
}

/** A run the workspace recorded, on this environment, that LoadCraft still runs; newest first. */
interface LiveRun {
  readonly executionId: string;
  readonly saved: TestRunSaved;
}

/**
 * Runs of any target on this environment that the workspace recorded and LoadCraft still runs. A
 * second load on an environment under load would double it, whatever it is aimed at.
 */
export async function liveRunsOn(
  ctx: ToolContext,
  projectId: string,
  environmentId: string,
): Promise<LiveRun[]> {
  const recorded = findAllRunning(
    ctx,
    testRunOperation,
    (saved) => saved.project.id === projectId && saved.environment.id === environmentId,
  ).reverse();
  const live: LiveRun[] = [];
  for (const { id, saved } of recorded) {
    try {
      const row = await readRun(ctx, projectId, id);
      if (row.status === 'pending' || row.status === 'building' || row.status === 'running') {
        live.push({ executionId: id, saved });
      }
    } catch (error) {
      // A run LoadCraft does not know is not running; any other failure must not start a second one.
      if (!(error instanceof LoadcraftApiError && error.status === 404)) throw error;
    }
  }
  return live;
}

/** Runs of one environment under way in this process, so two calls at once cannot both start. */
const startLocks = createLockTable();

function sameLoad(a: StartArgs['profile'], b: Profile): boolean {
  return (
    a.type === b.type &&
    a.vusers === b.vusers &&
    (a.ramp ?? 0) === (b.ramp ?? 0) &&
    (a.hold ?? 0) === (b.hold ?? 0)
  );
}

/** `{p95_ms, error_rate_pct}` as `SlaThreshold` entries of `workload`. */
export function toThresholds(input: StartArgs['thresholds']): SlaThreshold[] {
  return [
    ...(input?.p95_ms === undefined
      ? []
      : [{ type: 'responseTime' as const, percentile: 95 as const, max_ms: input.p95_ms }]),
    ...(input?.error_rate_pct === undefined
      ? []
      : [{ type: 'failedRequests' as const, max_percent: input.error_rate_pct }]),
  ];
}

/** Product name of a profile type, as the run wizard and `run_plan` name it. */
export function labelOf(type: ProfileType): string {
  return buildPresets(1).find((preset) => preset.type === type)?.label ?? type;
}

/** Steps 2 and 3: the limits the run must respect, then the profile within them. */
export function clampToEnvironment(
  ctx: ToolContext,
  environment: { name: string; protected: boolean; caps: RunCaps | null },
  requested: Profile,
): { caps: RunCaps; result: ClampResult } {
  const name = content(ctx, environment.name, ENVIRONMENT_NAME_LIMIT);
  const { caps } = environment;
  if (caps === null) {
    throw new ToolError('environment_caps_unreadable', { params: { environment: name } });
  }
  if (environment.protected && caps.maxVu === undefined && caps.maxRps === undefined) {
    throw new ToolError('environment_needs_caps', { params: { environment: name } });
  }
  const result = clampProfile(requested, caps);
  if (result.refusal !== undefined) {
    throw new ToolError('spike_not_possible', {
      params: { environment: name, limit: num(caps.maxVu ?? 0, ctx.t.locale) },
    });
  }
  // The stairs never climb below 5 new users per second, whatever `vusers` says: under a lower
  // limit some step would exceed it, so the run is not started at all.
  if (
    result.profile.type === 'stress' &&
    caps.maxRps !== undefined &&
    Math.max(result.profile.vusers, STRESS_MIN_TOP) > Math.floor(caps.maxRps)
  ) {
    throw new ToolError('stress_over_limit', {
      params: {
        environment: name,
        limit: num(Math.floor(caps.maxRps), ctx.t.locale),
        floor: num(STRESS_MIN_TOP, ctx.t.locale),
      },
    });
  }
  return { caps, result };
}

/** Step 5: the data check of the target under the load that will be sent. */
export async function checkData(
  ctx: ToolContext,
  projectId: string,
  target: RunTarget,
  environmentId: string,
  effective: Profile,
): Promise<DataDemand> {
  return target.kind === 'composition'
    ? preflightCompositionFor(ctx, projectId, target.id, effective)
    : preflightScenarioFor(ctx, projectId, target.id, effective, environmentId);
}

export function dataRows(demand: DataDemand): RunDataSlot[] {
  return demand.slots.map((slot) => ({
    slot: slot.label,
    dataset: slot.dataset,
    have: slot.have,
    need: slot.need,
  }));
}

/**
 * Starts the run, asks for the user's consent, or refuses before anything starts. A refusal is a
 * `ToolError` with the numbers the user needs; the start itself is the last request sent.
 */
export async function startTestRun(
  ctx: ToolContext,
  args: StartArgs,
): Promise<StartedRun | ConfirmationNeeded | JoinedRun> {
  await getCompat(ctx);
  const resolver = createResolver(ctx);
  const project: Handle = await resolver.project(args.project);

  // 1. Target and environment: both named by the user, never chosen here.
  const [target, environmentHandle] = await settleAll([
    resolver.runScenarioTarget(project.id, args.scenario),
    resolver.environment(project.id, args.environment),
  ]);
  const environment = await getRunEnvironment(ctx, project.id, environmentHandle.id);

  // One call at a time per environment in this process, from the check for a running test to the
  // record of the new one: two calls at once cannot both find the environment free. Between
  // processes the list of runs of LoadCraft is the only protection.
  return withLock(startLocks, `${project.id}:${environment.id}`, async () => {
    // 2–3. Limits, then the profile within them; the clamped profile is what is sent.
    const requested = asProfile(args.profile);
    const { caps, result } = clampToEnvironment(ctx, environment, requested);
    const effective = result.profile;

    const shownName = content(ctx, environment.name, ENVIRONMENT_NAME_LIMIT);

    // An environment under a test is not loaded a second time, whatever the new test is aimed at.
    // The same target with the same load joins the running test; anything else is refused with the
    // handle and the live page of the one that runs.
    const live = await liveRunsOn(ctx, project.id, environment.id);
    const joined = live.find(
      (run) => run.saved.target.id === target.id && sameLoad(run.saved.effective, effective),
    );
    if (joined !== undefined) {
      return { kind: 'joined', executionId: joined.executionId, saved: joined.saved };
    }
    const running = live[0];
    if (running !== undefined) {
      const sameTarget = running.saved.target.id === target.id;
      throw new ToolError(sameTarget ? 'run_already_running' : 'run_environment_busy', {
        params: {
          target: content(ctx, target.name, ENVIRONMENT_NAME_LIMIT),
          environment: shownName,
          handle: `test_run:${running.executionId}`,
          link: ctx.services.links.executionLive(project.id, running.executionId).url,
        },
      });
    }

    // The same environment under a run started from elsewhere (another session, the application).
    const elsewhere = await listActiveRuns(ctx, project.id, environment.id, ctx.clock.now());
    const known = elsewhere.find((run) => run.onEnvironment);
    const other = known ?? elsewhere[0];
    if (other !== undefined) {
      throw new ToolError(known === undefined ? 'run_build_elsewhere' : 'run_environment_busy', {
        params: {
          target: content(ctx, target.name, ENVIRONMENT_NAME_LIMIT),
          environment: shownName,
          handle: resolver.shortExecution(other.id),
          link: ctx.services.links.executionLive(project.id, other.id).url,
        },
      });
    }

    // 4. A protected environment or a clamped profile runs only after the user agreed: nothing is
    // sent, the answer asks for the consent with the numbers.
    if ((environment.protected || result.clamped) && args.confirm_capped !== true) {
      return {
        kind: 'confirm',
        data: {
          needsConfirmation: true,
          target: { kind: target.kind, name: content(ctx, target.name, ENVIRONMENT_NAME_LIMIT) },
          environment: {
            name: content(ctx, environment.name, ENVIRONMENT_NAME_LIMIT),
            protected: environment.protected,
            caps,
          },
          label: labelOf(requested.type),
          requested,
          effective,
          clamped: result.clamped,
          ...(result.note === undefined ? {} : { note: result.note }),
        },
      };
    }

    // 5. Data for exactly the load that will be sent.
    const demand = await checkData(ctx, project.id, target, environment.id, effective);
    if (!demand.ready) {
      throw new ToolError('data_not_ready', {
        params: { rows: dataShortage(demand, ctx.t), environment: shownName },
        details: { slots: dataRows(demand) },
      });
    }

    // 6. The start, always with the clamped load and the thresholds inside `workload`.
    const thresholds = toThresholds(args.thresholds);
    const workload = {
      type: effective.type,
      vusers: effective.vusers,
      ramp: effective.ramp ?? 0,
      hold: effective.hold ?? 0,
      thresholds,
    };
    const request = { environmentId: environment.id, workload };
    const executionId =
      target.kind === 'composition'
        ? await startCompositionRun(ctx, project.id, target.id, request)
        : await startScenarioRun(ctx, project.id, target.id, request);

    // 7. The run in the workspace, with what was asked for and what was sent.
    const startedAt = ctx.clock.now();
    const dataCheck = dataRows(demand);
    const label = labelOf(effective.type);
    const saved: TestRunSaved = {
      project: { id: project.id, name: content(ctx, project.name, ENVIRONMENT_NAME_LIMIT) },
      target: {
        kind: target.kind,
        id: target.id,
        name: content(ctx, target.name, ENVIRONMENT_NAME_LIMIT),
      },
      environment: {
        id: environment.id,
        name: content(ctx, environment.name, ENVIRONMENT_NAME_LIMIT),
        protected: environment.protected,
        caps,
      },
      label,
      requested,
      effective,
      clamped: result.clamped,
      ...(result.note === undefined ? {} : { note: result.note }),
      thresholds,
      dataCheck,
      startedAt,
    };
    const handle = await recordOperation(ctx.state, {
      kind: 'test_run',
      id: executionId,
      startedAt,
      saved,
    });
    if (result.clamped) {
      await recordRunLoad(ctx.state, {
        execution_id: executionId,
        requested_vu: requested.vusers,
        effective_vu: effective.vusers,
      });
    }

    const link = ctx.services.links.executionLive(project.id, executionId);
    return {
      kind: 'started',
      handle,
      executionId,
      saved,
      link,
      data: {
        execution: { id: executionId, handle: resolver.shortExecution(executionId) },
        target: { kind: target.kind, name: content(ctx, target.name, ENVIRONMENT_NAME_LIMIT) },
        environment: {
          name: content(ctx, environment.name, ENVIRONMENT_NAME_LIMIT),
          protected: environment.protected,
          caps,
        },
        label,
        requested,
        effective,
        clamped: result.clamped,
        ...(result.note === undefined ? {} : { note: result.note }),
        thresholds,
        dataCheck,
        link: link.url,
      },
    };
  });
}
