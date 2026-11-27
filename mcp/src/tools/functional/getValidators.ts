// `functional_get_validators` (module functional): Get the project's validators: list, one,
// applicable catalog validators, or Gatling enforcement levels.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A validator is named by its id (one read) or by the name the project uses (found in the
// list, which already holds the whole record). Names, reasons, descriptions and prompts are written
// by people and by models, so they pass the mask of a third party's text (`content`); a custom AI
// prompt is not read into the data at all (only whether there is one).
// Log: args "", result "{count} validators": the data carries the count.
// Arguments (the catalog's): `validator`, `view`, `is_enabled`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetValidators,
  type ApplicableGroup,
  type ValidatorDetail,
  type ValidatorRow,
  type ValidatorsData,
} from '../../render/functional/getValidators.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { LIMITS, isUuid, projectIdOf, thirdParty, thirdPartyOrNull } from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { pickNamed } from '../run/common.js';
import { FUNCTIONAL_GET_VALIDATORS } from './meta.generated.js';

/** GET /projects/{project_id}/validators (REST API v1) */
export function listProjectValidators(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_project_validators_api_v1_projects__project_id__validators_get'>,
): Promise<OpOutput<'list_project_validators_api_v1_projects__project_id__validators_get'>> {
  return callBackend(ctx, 'list_project_validators_api_v1_projects__project_id__validators_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /projects/{project_id}/validators/{validator_id} (REST API v1) */
export function getValidator(
  ctx: CallContext,
  path: { readonly project_id: string; readonly validator_id: string },
): Promise<OpOutput<'get_validator_api_v1_projects__project_id__validators__validator_id__get'>> {
  return callBackend(
    ctx,
    'get_validator_api_v1_projects__project_id__validators__validator_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/validators/applicable (REST API v1) */
export function listApplicableValidators(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'list_applicable_validators_api_v1_projects__project_id__validators_applicable_get'>
> {
  return callBackend(
    ctx,
    'list_applicable_validators_api_v1_projects__project_id__validators_applicable_get',
    { path },
  );
}

/** GET /projects/{project_id}/validators/gatling-enforcement (REST API v1) */
export function getGatlingEnforcement(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'get_gatling_enforcement_api_v1_projects__project_id__validators_gatling_enforcement_get'>
> {
  return callBackend(
    ctx,
    'get_gatling_enforcement_api_v1_projects__project_id__validators_gatling_enforcement_get',
    { path },
  );
}

/** What the data lists: validators, groups of applicable ones, their items, levels. */
const ITEMS_SHOWN = 50;
const GROUP_ITEMS_SHOWN = 30;
const LEVELS_SHOWN = 40;
const PARAMETERS_SHOWN = 20;

type Validator =
  OpOutput<'get_validator_api_v1_projects__project_id__validators__validator_id__get'>;

function rowOf(ctx: CallContext, item: Validator): ValidatorRow {
  return {
    id: item.id,
    name: thirdParty(ctx, item.effective_name, LIMITS.name),
    displayName: thirdParty(ctx, item.effective_display_name, LIMITS.name),
    category: thirdPartyOrNull(ctx, item.effective_category, LIMITS.name),
    type: thirdParty(ctx, item.effective_validator_type, LIMITS.name),
    enabled: item.is_enabled,
    priority: item.priority,
    base: thirdPartyOrNull(ctx, item.base_validator_name, LIMITS.name),
  };
}

function detailOf(ctx: CallContext, item: Validator): ValidatorDetail {
  const parameters = [...(item.custom_parameters ?? item.base_validator_parameters ?? [])]
    .map((parameter) => parameter['name'])
    .filter((name): name is string => typeof name === 'string');
  return {
    ...rowOf(ctx, item),
    description: thirdPartyOrNull(ctx, item.custom_description, LIMITS.sentence),
    engine: thirdPartyOrNull(ctx, item.engine, LIMITS.name),
    scope: thirdPartyOrNull(ctx, item.scope, LIMITS.name),
    needsReview: item.needs_review === true,
    autoConfigReason: thirdPartyOrNull(ctx, item.auto_config_reason, LIMITS.sentence),
    evaluatedAfterRun: item.evaluated_after_run,
    parameters: parameters
      .slice(0, PARAMETERS_SHOWN)
      .map((name) => thirdParty(ctx, name, LIMITS.name)),
    hasAiPrompt: item.custom_ai_prompt !== null && item.custom_ai_prompt !== undefined,
  };
}

const base = (projectId: string, view: ValidatorsData['view']): ValidatorsData => ({
  project_id: projectId,
  view,
  count: 0,
  shown: 0,
  items: [],
  validator: null,
  applicable: null,
  enforcement: null,
});

export const functionalGetValidators = moduleTool(FUNCTIONAL_GET_VALIDATORS, {
  title: "Get the project's validators",
  input: {
    validator: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('One validator (id or name); without it, the list.'),
    view: z
      .enum(['list', 'applicable', 'gatling_enforcement'])
      .default('list')
      .describe('list (default), the applicable ones, or how load runs enforce them.'),
    is_enabled: z.boolean().optional().describe('Only enabled (true) or disabled (false) ones.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.view === 'applicable') {
      const answer = await listApplicableValidators(ctx, path);
      const groups: ApplicableGroup[] = Object.entries(answer.groups).map(([group, items]) => ({
        group: thirdParty(ctx, group, LIMITS.name),
        items: items.slice(0, GROUP_ITEMS_SHOWN).map((item) => ({
          id: item.id,
          name: thirdParty(ctx, item.name, LIMITS.name),
          displayName: thirdParty(ctx, item.display_name, LIMITS.name),
          type: thirdParty(ctx, item.validator_type, LIMITS.name),
          applicable: item.applicable,
          reason: thirdParty(ctx, item.reason, LIMITS.sentence),
          activation: thirdParty(ctx, item.activation, LIMITS.name),
          requiresProfileFlags: item.requires_profile_flags.map((flag) =>
            thirdParty(ctx, flag, LIMITS.name),
          ),
        })),
      }));
      const data: ValidatorsData = {
        ...base(projectId, 'applicable'),
        count: answer.total,
        shown: groups.reduce((sum, group) => sum + group.items.length, 0),
        applicable: { total: answer.total, applicableTotal: answer.applicable_total, groups },
      };
      return { status: 'done', data };
    }
    if (args.view === 'gatling_enforcement') {
      const answer = await getGatlingEnforcement(ctx, path);
      const levels = Object.entries(answer.levels);
      const data: ValidatorsData = {
        ...base(projectId, 'gatling_enforcement'),
        count: levels.length,
        shown: levels.length,
        enforcement: {
          defaultLevel: thirdParty(ctx, answer.default_level, LIMITS.name),
          levels: levels.slice(0, LEVELS_SHOWN).map(([kind, level]) => ({
            kind: thirdParty(ctx, kind, LIMITS.name),
            level: thirdParty(ctx, level, LIMITS.name),
          })),
          levelCount: levels.length,
        },
      };
      return { status: 'done', data };
    }
    const given = args.validator?.trim();
    if (given !== undefined && isUuid(given)) {
      const one = await getValidator(ctx, { ...path, validator_id: given.toLowerCase() });
      const data: ValidatorsData = {
        ...base(projectId, 'list'),
        count: 1,
        validator: detailOf(ctx, one),
      };
      return { status: 'done', data };
    }
    const all = await listProjectValidators(ctx, path, {
      ...(args.is_enabled === undefined ? {} : { is_enabled: args.is_enabled }),
    });
    if (given !== undefined) {
      const picked = pickNamed(
        ctx,
        'validator',
        given,
        all.items.map((item) => ({ id: item.id, name: item.effective_name })),
      );
      const one = all.items.find((item) => item.id === picked.id);
      if (one === undefined) throw new Error('picked validator vanished');
      const data: ValidatorsData = {
        ...base(projectId, 'list'),
        count: 1,
        validator: detailOf(ctx, one),
      };
      return { status: 'done', data };
    }
    const items = all.items.slice(0, ITEMS_SHOWN).map((item) => rowOf(ctx, item));
    const data: ValidatorsData = {
      ...base(projectId, 'list'),
      count: all.items.length,
      shown: items.length,
      items,
    };
    return { status: 'done', data };
  },
  render: renderGetValidators,
});
