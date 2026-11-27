// `functional_get_templates` (module functional): Get functional test templates: list (by docs
// version or tags) or one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Templates are narrowed to a documentation version (`docs_id`, default `ids.docs_id` of the
// state) and to tags (comma-separated, at most 10). A template is named by its id (one read) or its
// name (found in the list). The assertions and runtime parameters are shown by type and name with
// their plain values; every text passes `content`, and the flow definition is only counted.
// Log: args "", result "{count} templates": the data carries the count.
// Arguments (the catalog's): `template`, `docs_id`, `tags`, `limit`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetTemplates,
  type RuntimeParameter,
  type TemplateAssertion,
  type TemplateDetail,
  type TemplateRow,
  type TemplatesData,
} from '../../render/functional/getTemplates.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { LIMITS, isUuid, refuseRule, thirdParty, thirdPartyOrNull } from '../kit/transitional.js';
import { fromState } from '../moduleState.js';
import { pickNamed } from '../run/common.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_GET_TEMPLATES } from './meta.generated.js';

/** GET /test-templates (REST API v1) */
export function listTestTemplates(
  ctx: CallContext,
  query?: QueryOf<'list_test_templates_api_v1_test_templates_get'>,
): Promise<OpOutput<'list_test_templates_api_v1_test_templates_get'>> {
  return callBackend(ctx, 'list_test_templates_api_v1_test_templates_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /test-templates/{template_id} (REST API v1) */
export function getTestTemplate(
  ctx: CallContext,
  path: { readonly template_id: string },
): Promise<OpOutput<'get_test_template_api_v1_test_templates__template_id__get'>> {
  return callBackend(ctx, 'get_test_template_api_v1_test_templates__template_id__get', { path });
}

const ITEMS_SHOWN = 50;
const ASSERTIONS_SHOWN = 30;
const PARAMETERS_SHOWN = 20;
const ASSERTION_PARAMS_SHOWN = 5;
const TAGS_ALLOWED = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Summary = OpOutput<'list_test_templates_api_v1_test_templates_get'>[number];
type Detail = OpOutput<'get_test_template_api_v1_test_templates__template_id__get'>;

/** A plain value as one masked text; a list or an object is not read. */
function plain(ctx: CallContext, value: unknown): string | null {
  if (typeof value === 'string') return thirdParty(ctx, value, LIMITS.label);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function rowOf(ctx: CallContext, template: Summary): TemplateRow {
  return {
    id: template.id,
    name: thirdParty(ctx, template.name, LIMITS.name),
    description: thirdPartyOrNull(ctx, template.description, LIMITS.sentence),
    specId: template.openapi_spec_id ?? null,
    tags: (template.tags ?? [])
      .slice(0, TAGS_ALLOWED)
      .map((tag) => thirdParty(ctx, tag, LIMITS.name)),
    assertionsCount: template.assertions_count,
    active: template.is_active,
    updatedAt: template.updated_at,
  };
}

function detailOf(ctx: CallContext, template: Detail): TemplateDetail {
  const blocks = template.flow_definition['blocks'];
  const assertions: TemplateAssertion[] = (template.assertions ?? [])
    .slice(0, ASSERTIONS_SHOWN)
    .map((assertion) => ({
      type: thirdParty(ctx, assertion.type_name ?? assertion.type_id, LIMITS.name),
      enabled: assertion.enabled,
      parameters: Object.entries(assertion.parameters ?? {})
        .flatMap(([key, value]): string[] => {
          const shown = plain(ctx, value);
          return shown === null ? [] : [`${thirdParty(ctx, key, LIMITS.name)}=${shown}`];
        })
        .slice(0, ASSERTION_PARAMS_SHOWN),
    }));
  const parameters: RuntimeParameter[] = (template.runtime_parameters ?? [])
    .slice(0, PARAMETERS_SHOWN)
    .map((parameter) => ({
      name: thirdParty(ctx, parameter.name, LIMITS.name),
      type: thirdParty(ctx, parameter.type, LIMITS.name),
      assertion: thirdParty(ctx, parameter.assertion_type, LIMITS.name),
      description: thirdPartyOrNull(ctx, parameter.description, LIMITS.sentence),
      default: plain(ctx, parameter.default),
      values: (parameter.values ?? [])
        .slice(0, TAGS_ALLOWED)
        .map((value) => thirdParty(ctx, value, LIMITS.name)),
    }));
  return {
    ...rowOf(ctx, template),
    apiDescription: thirdPartyOrNull(ctx, template.api_description, LIMITS.sentence),
    endpoints: (template.endpoint_ids ?? []).length,
    blocks: Array.isArray(blocks) ? blocks.length : null,
    assertions,
    runtimeParameters: parameters,
  };
}

export const functionalGetTemplates = moduleTool(FUNCTIONAL_GET_TEMPLATES, {
  title: 'Get functional test templates',
  input: {
    template: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('One template (id or name); without it, the list.'),
    docs_id: uuidArgument()
      .optional()
      .describe(
        'Only templates of this documentation version; default: the one of this workspace.',
      ),
    tags: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('Only templates with these tags, comma-separated (at most 10).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many templates to return (1-200).'),
  },
  async run(ctx, args) {
    const kept = fromState(ctx, 'ids.docs_id');
    const docsId =
      args.docs_id ??
      (typeof kept === 'string' && UUID.test(kept) ? kept.toLowerCase() : undefined);
    const tags = (args.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');
    if (tags.length > TAGS_ALLOWED) {
      refuseRule('templates_too_many_tags');
    }
    const empty = (): TemplatesData => ({
      docsId: docsId ?? null,
      tags,
      count: 0,
      shown: 0,
      limit: args.limit,
      items: [],
      template: null,
    });
    const given = args.template?.trim();
    if (given !== undefined && isUuid(given)) {
      const one = await getTestTemplate(ctx, { template_id: given.toLowerCase() });
      return { status: 'done', data: { ...empty(), count: 1, template: detailOf(ctx, one) } };
    }
    const all = await listTestTemplates(ctx, {
      ...(docsId === undefined ? {} : { spec_id: docsId }),
      ...(tags.length === 0 ? {} : { tags: tags.join(',') }),
      limit: args.limit,
    });
    if (given !== undefined) {
      const picked = pickNamed(
        ctx,
        'template',
        given,
        all.map((item) => ({ id: item.id, name: item.name })),
      );
      const one = await getTestTemplate(ctx, { template_id: picked.id });
      return { status: 'done', data: { ...empty(), count: 1, template: detailOf(ctx, one) } };
    }
    const items = all.slice(0, ITEMS_SHOWN).map((template) => rowOf(ctx, template));
    const data: TemplatesData = { ...empty(), count: all.length, shown: items.length, items };
    return { status: 'done', data };
  },
  render: renderGetTemplates,
});
