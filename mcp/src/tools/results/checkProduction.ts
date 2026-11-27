// `results_check_production` (module results): Check a production-replay run: achieved load against
// the plan, and the think-time verdict.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{run_id}", result "load achieved: {achieved}%; think time: {verdict}": the data of the
// result carries the fields.

import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import { ToolError } from '../../errors.js';
import {
  renderCheckProduction,
  type LoadData,
  type OffPlanSite,
  type ProductionData,
  type ProductionSeries,
  type ThinkData,
} from '../../render/results/checkProduction.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  runIdArgument,
  runOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { RESULTS_CHECK_PRODUCTION } from './meta.generated.js';
import { tenth } from './run.js';

/** GET /projects/{project_id}/gatling/executions/{execution_id}/production-overlay (REST API v1) */
export function getProductionOverlay(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_production_overlay_api_v1_projects__project_id__gatling_executions__execution_id__production_overlay_get'>
> {
  return callBackend(
    ctx,
    'get_production_overlay_api_v1_projects__project_id__gatling_executions__execution_id__production_overlay_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/executions/{execution_id}/think-time-verdict (REST API v1) */
export function getThinkTimeVerdict(
  ctx: CallContext,
  path: { readonly project_id: string; readonly execution_id: string },
): Promise<
  OpOutput<'get_think_time_verdict_api_v1_projects__project_id__gatling_executions__execution_id__think_time_verdict_get'>
> {
  return callBackend(
    ctx,
    'get_think_time_verdict_api_v1_projects__project_id__gatling_executions__execution_id__think_time_verdict_get',
    { path },
  );
}

type Overlay =
  OpOutput<'get_production_overlay_api_v1_projects__project_id__gatling_executions__execution_id__production_overlay_get'>;
type ThinkTime =
  OpOutput<'get_think_time_verdict_api_v1_projects__project_id__gatling_executions__execution_id__think_time_verdict_get'>;

const LOAD_REASONS: ReadonlySet<string> = new Set([
  'series_absent',
  'session_starts_not_emitted',
  'injection_start_unknown',
  'injection_start_inconsistent',
  'session_starts_gap',
  'metrics_backend_unreachable',
  'run_not_finished',
]);

const THINK_CODES: ReadonlySet<string> = new Set([
  'think_time_within_tolerance',
  'think_time_outside_tolerance',
  'too_few_transitions',
  'think_time_partial_coverage',
  'injector_saturated',
  'injector_load_unmeasured',
  'injection_start_unknown',
  'injection_start_inconsistent',
  'session_starts_not_emitted',
  'think_time_verdict_unavailable_for_composition',
  'think_time_not_recorded',
  'think_time_loop_heads_unrecorded',
  'think_time_no_sites',
  'run_not_finished',
  'metrics_backend_unreachable',
  'series_absent',
  'think_time_not_emitted',
]);

const SERIES_SOURCES: ReadonlySet<string> = new Set([
  'prometheus',
  'absent_retention',
  'absent_unmeasured',
  'metrics_backend_unreachable',
]);

const SERIES_ABSENCE: ReadonlySet<string> = new Set([
  'snapshot_not_found',
  'snapshot_artifact_missing',
  'snapshot_changed',
]);

/** Sites off the plan the data carries. */
const OFF_PLAN_SHOWN = 8;
const RETENTION_LIMIT = 20;

function loadOf(verdict: Overlay['verdict']): LoadData {
  const planned = verdict.total_planned ?? 0;
  const actual = verdict.total_actual ?? null;
  const steps = verdict.steps ?? [];
  const failed = steps.filter((step) => !step.passed);
  const off = (step: (typeof failed)[number]): number =>
    Math.max(step.planned - step.actual_hi, step.actual_lo - step.planned);
  const worst = failed.reduce<(typeof failed)[number] | undefined>(
    (best, step) =>
      best === undefined || off(step) > off(best) || (off(step) === off(best) && step.k < best.k)
        ? step
        : best,
    undefined,
  );
  const reason = verdict.reason ?? null;
  return {
    passed: verdict.passed ?? null,
    reason: reason === null ? null : LOAD_REASONS.has(reason) ? reason : 'other',
    planned,
    actual,
    achievedPct: actual === null || planned === 0 ? null : tenth((actual / planned) * 100),
    tolerance: verdict.total_tolerance ?? null,
    steps: {
      total: steps.length,
      passed: steps.length - failed.length,
      failed: failed.length,
    },
    ...(worst === undefined
      ? {}
      : {
          worst: {
            k: worst.k,
            planned: worst.planned,
            actualLo: worst.actual_lo,
            actualHi: worst.actual_hi,
          },
        }),
  };
}

function thinkOf(ctx: CallContext, body: ThinkTime): ThinkData {
  const { verdict } = body;
  // the answer is the contract's or no verdict: a body of another shape is read as none
  if (typeof verdict !== 'object' || verdict === null || typeof verdict.code !== 'string') {
    throw new TypeError('think-time verdict of an unknown shape');
  }
  const code = THINK_CODES.has(verdict.code) ? verdict.code : 'other';
  const off = (verdict.sites ?? []).filter(
    (site) => site.status === 'shorter_than_plan' || site.status === 'longer_than_plan',
  );
  const offPlan: OffPlanSite[] = off.slice(0, OFF_PLAN_SHOWN).map((site) => ({
    label: thirdParty(ctx, site.label ?? site.site, LIMITS.label),
    status: site.status as OffPlanSite['status'],
    worstEdgeMs: site.worst_edge_ms ?? null,
  }));
  const coverage = verdict.coverage;
  return {
    state: 'read',
    passed: verdict.passed ?? null,
    code,
    source: verdict.think_time_source ?? null,
    coverage: {
      total: coverage?.sites_total ?? 0,
      production: coverage?.sites_production ?? 0,
      judged: coverage?.sites_judged ?? 0,
      excluded: coverage?.sites_excluded ?? 0,
    },
    offPlan,
    moreOffPlan: Math.max(0, off.length - offPlan.length),
  };
}

/** The think-time verdict is the helper of this tool: whatever the backend answers, the tool goes on. */
async function readThink(
  ctx: CallContext,
  path: { project_id: string; execution_id: string },
): Promise<ThinkData> {
  let body: ThinkTime;
  try {
    body = await getThinkTimeVerdict(ctx, path);
  } catch (error) {
    if (error instanceof LoadcraftApiError) return { state: 'unavailable', status: error.status };
    throw error;
  }
  try {
    return thinkOf(ctx, body);
  } catch {
    // an answer that does not have the contract's shape is no verdict
    return { state: 'unavailable', status: 200 };
  }
}

async function readOverlay(
  ctx: CallContext,
  path: { project_id: string; execution_id: string },
  run: string,
): Promise<Overlay> {
  try {
    return await getProductionOverlay(ctx, path);
  } catch (error) {
    if (
      error instanceof LoadcraftApiError &&
      error.status === 404 &&
      error.code === 'not_a_production_run'
    ) {
      throw new ToolError('not_a_production_run', { params: { run } });
    }
    throw error;
  }
}

/** Whether both halves of the check held: false when one failed, null when one is not known. */
function okOf(load: LoadData, think: ThinkData): boolean | null {
  const thinkPassed = think.state === 'read' ? think.passed : null;
  if (load.passed === false || thinkPassed === false) return false;
  return load.passed === true && thinkPassed === true ? true : null;
}

function noteOf(load: LoadData, think: ThinkData): string {
  const verdict = load.passed === null ? 'not judged' : load.passed ? 'passed' : 'failed';
  const achieved = load.achievedPct === null ? '?' : load.achievedPct.toFixed(1);
  return `load ${achieved}% (${verdict}); think time ${think.state === 'read' ? think.code : 'unavailable'}`;
}

function thinkWord(think: ThinkData): string {
  if (think.state === 'unavailable') return 'unavailable';
  if (think.passed === null) return 'not judged';
  return think.passed ? 'within tolerance' : 'outside tolerance';
}

export const resultsCheckProduction = moduleTool(RESULTS_CHECK_PRODUCTION, {
  title: 'Check a production-replay run',
  input: { run_id: runIdArgument() },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const { id, run } = await runOf(ctx, projectId, args.run_id);
    const path = { project_id: projectId, execution_id: id };
    const overlay = await readOverlay(ctx, path, run);
    const think = await readThink(ctx, path);
    const load = loadOf(overlay.verdict);
    const absence = overlay.production_series_absence;
    const productionSeries: ProductionSeries =
      overlay.production_series !== null && overlay.production_series !== undefined
        ? 'present'
        : absence !== null && absence !== undefined && SERIES_ABSENCE.has(absence)
          ? absence
          : 'present';
    const data: ProductionData = {
      run,
      run_id: id,
      load,
      plan: {
        steps: overlay.plan.steps.length,
        totalUsers: overlay.plan.total_users,
        durationS: overlay.plan.duration_s,
        scale: overlay.plan.scale,
      },
      productionSeries,
      seriesSource: SERIES_SOURCES.has(overlay.series_source) ? overlay.series_source : 'other',
      retention:
        overlay.series_retention === null || overlay.series_retention === undefined
          ? null
          : thirdParty(ctx, overlay.series_retention, RETENTION_LIMIT),
      think,
    };
    return {
      status: 'done',
      data,
      update: {
        checks: {
          results: { production_verdict: { ok: okOf(load, think), note: noteOf(load, think) } },
        },
        log: {
          values: {
            run_id: run,
            achieved: load.achievedPct === null ? '?' : load.achievedPct.toFixed(1),
            verdict: thinkWord(think),
          },
        },
      },
    };
  },
  render: renderCheckProduction,
});
