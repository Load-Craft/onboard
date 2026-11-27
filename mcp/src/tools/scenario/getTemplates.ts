// `scenario_get_templates` (module scenario): Get built-in scenario templates: the list, or one;
// include adds its draft composition config for the project (nothing saved).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The templates are files LoadCraft ships: their descriptions are its own documentation
// (`ownDoc`); their names, ids, tags, scenario and file texts are third-party texts (masked).
// Log: args "{template}", result "{count} templates": the log values carry the count; the argument
// is the entry's own.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderScenarioGetTemplates,
  type DraftView,
  type ScenarioGetTemplatesData,
  type TemplateFileItem,
  type TemplateItem,
  type TemplateOne,
  type TemplateScenarioItem,
} from '../../render/scenario/getTemplates.js';
import { callBackend, type BodyOf, type QueryOf } from '../moduleCall.js';
import {
  includes,
  isUuid,
  kind,
  LIMITS,
  mapPart,
  ownDoc,
  page,
  pickNamed,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { SCENARIO_GET_TEMPLATES } from './meta.generated.js';

/** The templates the list shows. */
const TEMPLATES_SHOWN = 50;
/** The scenarios of one template the view shows. */
const SCENARIOS_SHOWN = 20;
/** The data files of one template the view shows. */
const FILES_SHOWN = 20;

/** GET /templates (REST API v1) */
export function listTemplates(
  ctx: ToolContext,
  query?: QueryOf<'list_templates_api_v1_templates_get'>,
): Promise<OpOutput<'list_templates_api_v1_templates_get'>> {
  return callBackend(ctx, 'list_templates_api_v1_templates_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /templates/{template_id} (REST API v1) */
export function getTemplate(
  ctx: ToolContext,
  path: { readonly template_id: string },
): Promise<OpOutput<'get_template_api_v1_templates__template_id__get'>> {
  return callBackend(ctx, 'get_template_api_v1_templates__template_id__get', { path });
}

/** POST /projects/{project_id}/gatling/templates/{template_id}/instantiate (REST API v1) */
export function instantiateTemplate(
  ctx: ToolContext,
  path: { readonly project_id: string; readonly template_id: string },
  body?: BodyOf<'instantiate_template_api_v1_projects__project_id__gatling_templates__template_id__instantiate_post'>,
): Promise<
  OpOutput<'instantiate_template_api_v1_projects__project_id__gatling_templates__template_id__instantiate_post'>
> {
  return callBackend(
    ctx,
    'instantiate_template_api_v1_projects__project_id__gatling_templates__template_id__instantiate_post',
    { path, ...(body === undefined ? {} : { body }) },
  );
}

type ListWire = OpOutput<'list_templates_api_v1_templates_get'>['templates'][number];
type DetailWire = OpOutput<'get_template_api_v1_templates__template_id__get'>;
type CompositionWire =
  OpOutput<'instantiate_template_api_v1_projects__project_id__gatling_templates__template_id__instantiate_post'>['composition'];

/** A description of LoadCraft's own documentation: null when missing or empty. */
function ownDocOrNull(ctx: ToolContext, text: string | null | undefined): string | null {
  return text === undefined || text === null || text === ''
    ? null
    : ownDoc(ctx, text, LIMITS.sentence);
}

function itemOf(ctx: ToolContext, wire: ListWire): TemplateItem {
  return {
    id: thirdParty(ctx, wire.id, LIMITS.name),
    name: thirdParty(ctx, wire.name, LIMITS.name),
    category: kind(ctx, wire.category),
    difficulty: kind(ctx, wire.difficulty),
    scenario_count: wire.scenario_count,
    description: ownDocOrNull(ctx, wire.description),
  };
}

function oneOf(ctx: ToolContext, detail: DetailWire): TemplateOne {
  const scenarios = detail.scenarios ?? [];
  const files = detail.feeder_schemas ?? [];
  return {
    id: thirdParty(ctx, detail.id ?? '', LIMITS.name),
    name: thirdParty(ctx, detail.name ?? '', LIMITS.name),
    category: kind(ctx, detail.category ?? ''),
    difficulty: kind(ctx, detail.difficulty ?? ''),
    description: ownDocOrNull(ctx, detail.description),
    tags: (detail.tags ?? []).map((tag) => thirdParty(ctx, tag, LIMITS.label)),
    scenario_count: scenarios.length,
    file_count: files.length,
    scenarios: scenarios.slice(0, SCENARIOS_SHOWN).map((one): TemplateScenarioItem => ({
      name: thirdParty(ctx, one.name ?? '', LIMITS.name),
      description: ownDocOrNull(ctx, one.description),
      inputs: (one.inputs ?? []).map((input) => thirdParty(ctx, input, LIMITS.label)),
      outputs: (one.outputs ?? []).map((output) => thirdParty(ctx, output, LIMITS.label)),
    })),
    files: files.slice(0, FILES_SHOWN).map((file): TemplateFileItem => ({
      name: thirdParty(ctx, file.name ?? '', LIMITS.name),
      columns: (file.columns ?? []).map((column) => thirdParty(ctx, column, LIMITS.label)),
    })),
  };
}

/**
 * Users from which a draft that starts them all without a ramp (`at_once`, `constant`) is said to be a
 * jolt: the view warns, without knowing the environment it will run against (DOKTOR-08).
 */
const SUDDEN_USERS = 100;

function draftOf(ctx: ToolContext, composition: CompositionWire): DraftView {
  const profile = composition.injection_profile;
  const type = profile?.type;
  const users = profile?.total_users;
  const seconds = profile?.duration_seconds;
  return {
    name: thirdPartyOrNull(ctx, composition.name, LIMITS.name),
    load:
      type === undefined || users === undefined || seconds === undefined
        ? null
        : {
            type: kind(ctx, type),
            users,
            seconds,
            sudden: type !== 'ramp' && users >= SUDDEN_USERS,
          },
    mix: Object.entries(composition.proportions ?? {}).map(([scenario, weight]) => ({
      scenario: thirdParty(ctx, scenario, LIMITS.label),
      weight,
    })),
    thresholds: Object.entries(composition.thresholds ?? {}).flatMap(([name, value]) =>
      typeof value === 'number' ? [{ name: thirdParty(ctx, name, LIMITS.label), value }] : [],
    ),
  };
}

/** The id of the template a name (in any letter case) matches: one list read, then the pick. */
async function idOfName(ctx: ToolContext, name: string): Promise<string> {
  const answer = await listTemplates(ctx);
  return pickNamed(ctx, ctx.t('scenario_get_templates.kind'), name, answer.templates).id;
}

export const scenarioGetTemplates = moduleTool(SCENARIO_GET_TEMPLATES, {
  title: 'Get built-in scenario templates',
  input: {
    template: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'One template with its scenarios and data files (id or name); without it, the list.',
      ),
    include: z
      .array(z.enum(['draft']))
      .max(1)
      .optional()
      .describe(
        '"draft": its composition config for this project, nothing saved (with template only).',
      ),
  },
  async run(ctx, args) {
    // 1. rules: include works only with template
    if (args.include !== undefined && args.template === undefined) {
      refuseRule('get_templates_only_with');
    }
    // 2. the project
    const projectId = projectIdOf(ctx, undefined);
    if (args.template === undefined) {
      // 3. the list, as read
      const answer = await listTemplates(ctx);
      // 4. the data: the first templates the backend sorted by name
      const templates = page(answer.templates, {
        total: answer.total,
        limit: TEMPLATES_SHOWN,
        map: (wire) => itemOf(ctx, wire),
      });
      const data: ScenarioGetTemplatesData = { mode: 'list', project_id: projectId, templates };
      // 5. the outcome
      return { status: 'done', data, update: { log: { values: { count: templates.count } } } };
    }
    // 3. the template: its id (a name is resolved in the list), then the main read and the part
    const templateId = isUuid(args.template) ? args.template : await idOfName(ctx, args.template);
    const want = includes(args.include);
    const [detail, draft] = await settleAll([
      getTemplate(ctx, { template_id: templateId }),
      want.part('draft', () =>
        instantiateTemplate(ctx, { project_id: projectId, template_id: templateId }),
      ),
    ]);
    // 4. the data
    const data: ScenarioGetTemplatesData = {
      mode: 'one',
      project_id: projectId,
      template: oneOf(ctx, detail),
      draft: mapPart(draft, (answer) => draftOf(ctx, answer.composition)),
    };
    // 5. the outcome
    return { status: 'done', data, update: { log: { values: { count: 1 } } } };
  },
  render: renderScenarioGetTemplates,
});
