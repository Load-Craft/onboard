// `scenario_check_composition` (module scenario): Check a composition: contract issues between
// members and version drift. Changes no user data (stores the verdict).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The check is a POST that stores the verdict in the backend and changes no data of the user.
// The messages of the issues are third-party text and pass `content`; the problems it puts in the
// state carry a fixed sentence, never a message of the backend.
// State: `steps.scenario.composition_valid` follows the verdict; an invalid composition opens the
// problem `composition_invalid` (a blocker of the scenario step), drifted members open
// `composition_members_drifted` (a warning); a verdict that no longer holds closes its problem.
// Log: args "{composition_id}", result "valid: {valid}; {issues} issues": the log values carry them.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderCompositionCheck,
  type CheckData,
  type DriftedView,
  type IssueView,
} from '../../render/scenario/checkComposition.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { compositionIdOf } from './compositionRef.js';
import { getComposition } from './getComposition.js';
import { SCENARIO_CHECK_COMPOSITION } from './meta.generated.js';
import { slotCollisions } from './slotCollisions.js';

/** POST /projects/{project_id}/gatling/compositions/{composition_id}/validate (REST API v1) */
export function validateComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post'>
> {
  return callBackend(
    ctx,
    'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post',
    { path },
  );
}

const TEXT_LIMIT = 200;
const ISSUES_SHOWN = 20;
const DRIFTED_SHOWN = 20;
const FEEDERS_SHOWN = 10;

/** The code of the problem an invalid composition raises, and the one for drifted members. */
export const INVALID_CODE = 'composition_invalid';
export const DRIFT_CODE = 'composition_members_drifted';

type Answer =
  OpOutput<'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post'>;

const text = (ctx: CallContext, value: string, max = TEXT_LIMIT): string =>
  content(ctx, value, max);

function issueOf(ctx: CallContext, issue: Answer['issue_details'][number]): IssueView {
  return {
    level: issue.level,
    message: text(ctx, issue.message),
    scenario_id: issue.scenario_id,
    step_index: issue.step_index,
    suggestion: issue.suggestion === null ? null : text(ctx, issue.suggestion),
    variable: issue.variable === null ? null : text(ctx, issue.variable, 80),
  };
}

function driftedOf(ctx: CallContext, member: Answer['drifted_members'][number]): DriftedView {
  return {
    scenario_id: member.scenario_id,
    scenario_name: member.scenario_name === null ? null : text(ctx, member.scenario_name, 120),
    variant_label: text(ctx, member.variant_label, 80),
    pinned_version: member.pinned_version,
    current_version: member.current_version,
    drift_fields: member.drift_fields.slice(),
  };
}

export const scenarioCheckComposition = moduleTool(SCENARIO_CHECK_COMPOSITION, {
  title: 'Check a composition',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const compositionId = await compositionIdOf(ctx, projectId, args.composition_id);
    const answer = await validateComposition(ctx, {
      project_id: projectId,
      composition_id: compositionId,
    });
    const members = await getComposition(ctx, {
      project_id: projectId,
      composition_id: compositionId,
    });
    const collisions = await slotCollisions(
      ctx,
      projectId,
      members.scenarios.map((member) => ({
        id: member.scenario_id,
        name: text(ctx, member.scenario_name ?? member.scenario_id, 120),
      })),
    );
    const errors = answer.issue_details.filter((issue) => issue.level === 'error').length;
    const warnings = answer.issue_details.length - errors;
    const data: CheckData = {
      project_id: projectId,
      composition_id: compositionId,
      valid: answer.is_valid,
      authoring_valid: answer.authoring_valid,
      effective_status: answer.effective_status,
      has_drift: answer.has_drift,
      scenario_count: answer.scenario_count,
      total_proportion: answer.total_proportion,
      last_validated_at: answer.last_validated_at,
      errors,
      warnings,
      issues: answer.issue_details.length,
      issue_list: answer.issue_details.slice(0, ISSUES_SHOWN).map((issue) => issueOf(ctx, issue)),
      drifted: answer.drifted_members
        .slice(0, DRIFTED_SHOWN)
        .map((member) => driftedOf(ctx, member)),
      missing_bound_feeders: answer.missing_bound_feeders
        .slice(0, FEEDERS_SHOWN)
        .map((name) => text(ctx, name, 80)),
      slot_collisions: collisions,
    };
    const ref = { kind: 'composition', id: compositionId } as const;
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            composition_id: compositionId,
            valid: answer.is_valid,
            issues: answer.issue_details.length,
          },
        },
        checks: { scenario: { composition_valid: { ok: answer.is_valid } } },
        problems: {
          open: [
            ...(answer.is_valid
              ? []
              : [
                  {
                    module: 'scenario',
                    tool: 'scenario_check_composition',
                    code: INVALID_CODE,
                    severity: 'blocker',
                    message: 'The composition does not pass its check; read the issues it lists.',
                    ref,
                  } as const,
                ]),
            ...(answer.has_drift
              ? [
                  {
                    module: 'scenario',
                    tool: 'scenario_check_composition',
                    code: DRIFT_CODE,
                    severity: 'warning',
                    message: 'Members of the composition drifted from their scenarios.',
                    ref,
                  } as const,
                ]
              : []),
          ],
          close: [
            ...(answer.is_valid ? [{ code: INVALID_CODE, ref_id: compositionId }] : []),
            ...(answer.has_drift ? [] : [{ code: DRIFT_CODE, ref_id: compositionId }]),
          ],
        },
      },
    };
  },
  render: renderCompositionCheck,
});
