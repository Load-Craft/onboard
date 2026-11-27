// `functional_get_analytics` (module functional): Get validator quality over N days: dashboard, flaky
// validators, failure patterns, accuracy, trend, threshold suggestion (view).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The views accuracy, trend and threshold_suggestion are about one validator, named by its id
// or its name (a name is found in the project's validators first); without `validator` they are
// refused locally. `threshold_pct` (percent) is sent to the backend as a fraction. Rates are kept as
// the backend gives them (fractions of one); only the view turns them into percent. Names, messages,
// evidence and rationale pass `content`.
// Log: args "{view} {days} days", result "{view}": the data carries `view` and `days`.
// Arguments (the catalog's): `view`, `days`, `validator`, `threshold_pct`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetAnalytics,
  type AccuracyReport,
  type AnalyticsData,
  type FlakyRow,
  type PatternRow,
  type Summary,
} from '../../render/functional/getAnalytics.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { LIMITS, isUuid, projectIdOf, refuseRule, thirdParty } from '../kit/transitional.js';
import { pickNamed } from '../run/common.js';
import { listProjectValidators } from './getValidators.js';
import { moduleTool } from '../moduleTool.js';
import { FUNCTIONAL_GET_ANALYTICS } from './meta.generated.js';

/** GET /projects/{project_id}/analytics/validators/dashboard (REST API v1) */
export function getAnalyticsDashboard(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_analytics_dashboard_api_v1_projects__project_id__analytics_validators_dashboard_get'>,
): Promise<
  OpOutput<'get_analytics_dashboard_api_v1_projects__project_id__analytics_validators_dashboard_get'>
> {
  return callBackend(
    ctx,
    'get_analytics_dashboard_api_v1_projects__project_id__analytics_validators_dashboard_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/analytics/validators/failure-patterns (REST API v1) */
export function getFailurePatterns(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_failure_patterns_api_v1_projects__project_id__analytics_validators_failure_patterns_get'>,
): Promise<
  OpOutput<'get_failure_patterns_api_v1_projects__project_id__analytics_validators_failure_patterns_get'>
> {
  return callBackend(
    ctx,
    'get_failure_patterns_api_v1_projects__project_id__analytics_validators_failure_patterns_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/analytics/validators/flaky (REST API v1) */
export function getFlakyValidators(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_flaky_validators_api_v1_projects__project_id__analytics_validators_flaky_get'>,
): Promise<
  OpOutput<'get_flaky_validators_api_v1_projects__project_id__analytics_validators_flaky_get'>
> {
  return callBackend(
    ctx,
    'get_flaky_validators_api_v1_projects__project_id__analytics_validators_flaky_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/analytics/validators/validators/{validator_id}/threshold-suggestion (REST API v1) */
export function getThresholdSuggestion(
  ctx: CallContext,
  path: { readonly project_id: string; readonly validator_id: string },
  query?: QueryOf<'get_threshold_suggestion_api_v1_projects__project_id__analytics_validators_validators__validator_id__threshold_suggestion_get'>,
): Promise<
  OpOutput<'get_threshold_suggestion_api_v1_projects__project_id__analytics_validators_validators__validator_id__threshold_suggestion_get'>
> {
  return callBackend(
    ctx,
    'get_threshold_suggestion_api_v1_projects__project_id__analytics_validators_validators__validator_id__threshold_suggestion_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/analytics/validators/validators/{validator_id}/accuracy (REST API v1) */
export function getValidatorAccuracy(
  ctx: CallContext,
  path: { readonly project_id: string; readonly validator_id: string },
  query?: QueryOf<'get_validator_accuracy_api_v1_projects__project_id__analytics_validators_validators__validator_id__accuracy_get'>,
): Promise<
  OpOutput<'get_validator_accuracy_api_v1_projects__project_id__analytics_validators_validators__validator_id__accuracy_get'>
> {
  return callBackend(
    ctx,
    'get_validator_accuracy_api_v1_projects__project_id__analytics_validators_validators__validator_id__accuracy_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

/** GET /projects/{project_id}/analytics/validators/validators/{validator_id}/trend (REST API v1) */
export function getValidatorTrend(
  ctx: CallContext,
  path: { readonly project_id: string; readonly validator_id: string },
  query?: QueryOf<'get_validator_trend_api_v1_projects__project_id__analytics_validators_validators__validator_id__trend_get'>,
): Promise<
  OpOutput<'get_validator_trend_api_v1_projects__project_id__analytics_validators_validators__validator_id__trend_get'>
> {
  return callBackend(
    ctx,
    'get_validator_trend_api_v1_projects__project_id__analytics_validators_validators__validator_id__trend_get',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

const LIST_SHOWN = 20;
const TOP_SHOWN = 5;
const POINTS_SHOWN = 60;
const LINES_SHOWN = 5;

type Flaky =
  OpOutput<'get_flaky_validators_api_v1_projects__project_id__analytics_validators_flaky_get'>[number];
type Pattern =
  OpOutput<'get_failure_patterns_api_v1_projects__project_id__analytics_validators_failure_patterns_get'>[number];
type Accuracy = NonNullable<
  OpOutput<'get_validator_accuracy_api_v1_projects__project_id__analytics_validators_validators__validator_id__accuracy_get'>
>;

const texts = (ctx: CallContext, list: readonly string[] | undefined, max: number): string[] =>
  (list ?? []).slice(0, LINES_SHOWN).map((item) => thirdParty(ctx, item, max));

const flakyOf = (ctx: CallContext, item: Flaky): FlakyRow => ({
  validatorId: item.validator_id,
  name: thirdParty(ctx, item.validator_name, LIMITS.name),
  score: item.flakiness_score,
  passRateVariance: item.pass_rate_variance,
  sampleSize: item.sample_size,
  recommendation: thirdParty(ctx, item.recommendation, LIMITS.sentence),
  evidence: texts(ctx, item.evidence, LIMITS.sentence),
});

const patternOf = (ctx: CallContext, item: Pattern): PatternRow => ({
  type: thirdParty(ctx, item.pattern_type, LIMITS.name),
  value: thirdParty(ctx, item.pattern_value, LIMITS.name),
  failures: item.failure_count,
  failureRate: item.failure_rate,
  correlation: item.correlation_strength,
  samples: texts(ctx, item.sample_messages, LIMITS.sentence),
});

const accuracyOf = (ctx: CallContext, item: Accuracy): AccuracyReport => ({
  validatorId: item.validator_id,
  name: thirdParty(ctx, item.validator_name, LIMITS.name),
  type: thirdParty(ctx, item.validator_type, LIMITS.name),
  executions: item.total_executions,
  passes: item.pass_count,
  fails: item.fail_count,
  passRate: item.pass_rate,
  retryRate: item.retry_rate,
  avgConfidence: item.avg_confidence ?? null,
  avgDurationMs: item.avg_duration_ms ?? null,
  failureReasons: texts(ctx, item.common_failure_reasons, LIMITS.sentence),
  suggestedActions: texts(ctx, item.suggested_actions, LIMITS.sentence),
});

const base = (
  view: AnalyticsData['view'],
  days: number,
  validatorId: string | null,
): AnalyticsData => ({
  view,
  days,
  validatorId,
  count: 0,
  summary: null,
  flaky: [],
  patterns: [],
  accuracy: [],
  trend: null,
  threshold: null,
});

export const functionalGetAnalytics = moduleTool(FUNCTIONAL_GET_ANALYTICS, {
  title: 'Get validator quality over N days',
  input: {
    view: z
      .enum(['dashboard', 'flaky', 'failure_patterns', 'accuracy', 'trend', 'threshold_suggestion'])
      .default('dashboard')
      .describe('Which analysis; default: dashboard.'),
    days: z.number().int().min(1).max(365).default(30).describe('How many past days (1-365).'),
    validator: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('The validator (id or name); needed for accuracy, trend and threshold_suggestion.'),
    threshold_pct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(20)
      .describe('With view flaky: the flakiness threshold in percent.'),
  },
  async run(ctx, args) {
    const perValidator = ['accuracy', 'trend', 'threshold_suggestion'].includes(args.view);
    if (perValidator && args.validator === undefined) {
      refuseRule('analytics_without_validator');
    }
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const days = args.days;
    let validatorId: string | null = null;
    if (perValidator && args.validator !== undefined) {
      const given = args.validator.trim();
      if (isUuid(given)) {
        validatorId = given.toLowerCase();
      } else {
        const all = await listProjectValidators(ctx, path);
        validatorId = pickNamed(
          ctx,
          'validator',
          given,
          all.items.map((item) => ({ id: item.id, name: item.effective_name })),
        ).id;
      }
    }
    const withValidator = { ...path, validator_id: validatorId ?? '' };
    switch (args.view) {
      case 'flaky': {
        const answer = await getFlakyValidators(ctx, path, {
          days,
          threshold: args.threshold_pct / 100,
        });
        const flaky = answer.slice(0, LIST_SHOWN).map((item) => flakyOf(ctx, item));
        return {
          status: 'done',
          data: { ...base('flaky', days, null), count: answer.length, flaky },
        };
      }
      case 'failure_patterns': {
        const answer = await getFailurePatterns(ctx, path, { days });
        const patterns = answer.slice(0, LIST_SHOWN).map((item) => patternOf(ctx, item));
        return {
          status: 'done',
          data: { ...base('failure_patterns', days, null), count: answer.length, patterns },
        };
      }
      case 'accuracy': {
        const answer = await getValidatorAccuracy(ctx, withValidator, { days });
        return {
          status: 'done',
          data: {
            ...base('accuracy', days, validatorId),
            count: answer === null ? 0 : 1,
            accuracy: answer === null ? [] : [accuracyOf(ctx, answer)],
          },
        };
      }
      case 'trend': {
        const answer = await getValidatorTrend(ctx, withValidator, { days });
        const series = answer?.data_points ?? [];
        const points = series.slice(-POINTS_SHOWN).map((point) => ({
          date: point.date,
          passRate: point.pass_rate,
          executions: point.total_executions,
          confidence: point.avg_confidence ?? null,
        }));
        const data: AnalyticsData = {
          ...base('trend', days, validatorId),
          count: answer === null ? 0 : 1,
          trend:
            answer === null
              ? null
              : {
                  name: thirdParty(ctx, answer.validator_name, LIMITS.name),
                  direction: thirdParty(ctx, answer.trend_direction, LIMITS.name),
                  points,
                  pointCount: series.length,
                },
        };
        return { status: 'done', data };
      }
      case 'threshold_suggestion': {
        const answer = await getThresholdSuggestion(ctx, withValidator, { days });
        const data: AnalyticsData = {
          ...base('threshold_suggestion', days, validatorId),
          count: answer === null ? 0 : 1,
          threshold:
            answer === null
              ? null
              : {
                  current: answer.current_threshold ?? null,
                  suggested: answer.suggested_threshold,
                  rationale: thirdParty(ctx, answer.rationale, LIMITS.sentence),
                  impact: Object.entries(answer.impact ?? {})
                    .slice(0, LINES_SHOWN)
                    .map(([key, value]) => ({ key: thirdParty(ctx, key, LIMITS.name), value })),
                },
        };
        return { status: 'done', data };
      }
      case 'dashboard': {
        const answer = await getAnalyticsDashboard(ctx, path, { days });
        const summary: Summary = {
          validators: answer.summary.total_validators,
          executions: answer.summary.total_executions,
          passRate: answer.summary.overall_pass_rate,
          flaky: answer.summary.flaky_validators_count,
          ai: answer.summary.ai_validators_count,
          avgAiConfidence: answer.summary.avg_ai_confidence ?? null,
          coverage:
            answer.coverage === undefined
              ? null
              : {
                  measured: answer.coverage.measured,
                  source: thirdParty(ctx, answer.coverage.source, LIMITS.name),
                  excludes: texts(ctx, answer.coverage.excludes, LIMITS.name),
                },
        };
        const data: AnalyticsData = {
          ...base('dashboard', answer.period_days, null),
          count: 1,
          summary,
          flaky: (answer.flaky_validators ?? [])
            .slice(0, TOP_SHOWN)
            .map((item) => flakyOf(ctx, item)),
          patterns: (answer.failure_patterns ?? [])
            .slice(0, TOP_SHOWN)
            .map((item) => patternOf(ctx, item)),
          accuracy: (answer.validators_by_accuracy ?? [])
            .slice(0, TOP_SHOWN)
            .map((item) => accuracyOf(ctx, item)),
        };
        return { status: 'done', data };
      }
    }
  },
  render: renderGetAnalytics,
});
