// `functional_get_catalog` (module functional): Get the global catalog of base test types, base
// validators or assertion types: list, one item.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The catalog is global (no project). `kind` picks one of three catalogs; `id` reads one entry
// (a UUID; for assertion types a name too, which the backend resolves), without it the list is read.
// `is_active` narrows test types and validators only: with assertion types the call is refused locally
// (`invalid_arguments`, nothing sent). Names, descriptions and categories pass `content`; a prompt
// template is never read, only whether the entry has one. The routes of categories, the seed status and
// the AI validators are not read by this tool.
// Log: args "{kind} {view}", result "{count} entries": the data carries `kind`, `view` and `count`.
// Arguments (the catalog's): `kind`, `id`, `category`, `is_active`, `limit`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetCatalog,
  type CatalogData,
  type CatalogEntry,
  type CatalogKind,
  type CatalogRow,
} from '../../render/functional/getCatalog.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { moduleTool } from '../moduleTool.js';
import { LIMITS, isUuid, refuseRule, thirdParty, thirdPartyOrNull } from '../kit/transitional.js';
import { FUNCTIONAL_GET_CATALOG } from './meta.generated.js';

/** GET /assertion-types/{type_id} (REST API v1) */
export function getAssertionType(
  ctx: CallContext,
  path: { readonly type_id: string },
): Promise<OpOutput<'get_assertion_type_api_v1_assertion_types__type_id__get'>> {
  return callBackend(ctx, 'get_assertion_type_api_v1_assertion_types__type_id__get', { path });
}

/** GET /assertion-types/by-name/{name} (REST API v1) */
export function getAssertionTypeByName(
  ctx: CallContext,
  path: { readonly name: string },
): Promise<OpOutput<'get_assertion_type_by_name_api_v1_assertion_types_by_name__name__get'>> {
  return callBackend(ctx, 'get_assertion_type_by_name_api_v1_assertion_types_by_name__name__get', {
    path,
  });
}

/** GET /base-test-types/{test_type_id} (REST API v1) */
export function getBaseTestType(
  ctx: CallContext,
  path: { readonly test_type_id: string },
): Promise<OpOutput<'get_base_test_type_api_v1_base_test_types__test_type_id__get'>> {
  return callBackend(ctx, 'get_base_test_type_api_v1_base_test_types__test_type_id__get', { path });
}

/** GET /base-validators/{validator_id} (REST API v1) */
export function getBaseValidator(
  ctx: CallContext,
  path: { readonly validator_id: string },
): Promise<OpOutput<'get_base_validator_api_v1_base_validators__validator_id__get'>> {
  return callBackend(ctx, 'get_base_validator_api_v1_base_validators__validator_id__get', { path });
}

/** GET /base-validators/ai (REST API v1) */
export function listAiValidators(
  ctx: CallContext,
): Promise<OpOutput<'list_ai_validators_api_v1_base_validators_ai_get'>> {
  return callBackend(ctx, 'list_ai_validators_api_v1_base_validators_ai_get');
}

/** GET /assertion-types (REST API v1) */
export function listAssertionTypes(
  ctx: CallContext,
  query?: QueryOf<'list_assertion_types_api_v1_assertion_types_get'>,
): Promise<OpOutput<'list_assertion_types_api_v1_assertion_types_get'>> {
  return callBackend(ctx, 'list_assertion_types_api_v1_assertion_types_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /base-test-types (REST API v1) */
export function listBaseTestTypes(
  ctx: CallContext,
  query?: QueryOf<'list_base_test_types_api_v1_base_test_types_get'>,
): Promise<OpOutput<'list_base_test_types_api_v1_base_test_types_get'>> {
  return callBackend(ctx, 'list_base_test_types_api_v1_base_test_types_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /base-validators (REST API v1) */
export function listBaseValidators(
  ctx: CallContext,
  query?: QueryOf<'list_base_validators_api_v1_base_validators_get'>,
): Promise<OpOutput<'list_base_validators_api_v1_base_validators_get'>> {
  return callBackend(ctx, 'list_base_validators_api_v1_base_validators_get', {
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /base-test-types/categories (REST API v1) */
export function listTestTypeCategories(
  ctx: CallContext,
): Promise<OpOutput<'list_test_type_categories_api_v1_base_test_types_categories_get'>> {
  return callBackend(ctx, 'list_test_type_categories_api_v1_base_test_types_categories_get');
}

/** GET /base-validators/categories (REST API v1) */
export function listValidatorCategories(
  ctx: CallContext,
): Promise<OpOutput<'list_validator_categories_api_v1_base_validators_categories_get'>> {
  return callBackend(ctx, 'list_validator_categories_api_v1_base_validators_categories_get');
}

/** GET /admin/seed/status (REST API v1) */
export function getSeedStatus(
  ctx: CallContext,
): Promise<OpOutput<'get_seed_status_api_v1_admin_seed_status_get'>> {
  return callBackend(ctx, 'get_seed_status_api_v1_admin_seed_status_get');
}

const ITEMS_SHOWN = 100;
const CATEGORIES_SHOWN = 30;
const PARAMETERS_SHOWN = 20;

interface Raw {
  readonly id: string;
  readonly name: string;
  readonly display_name: string;
  readonly category?: string | null;
  readonly is_active: boolean;
  readonly is_builtin?: boolean;
  readonly validator_type?: string;
  readonly description?: string | null;
  readonly parameters?: readonly Readonly<Record<string, unknown>>[];
  readonly prompt_template?: string | null;
  readonly ai_prompt_template?: string | null;
  readonly input_generation_prompt?: string;
}

function rowOf(ctx: CallContext, raw: Raw): CatalogRow {
  return {
    id: raw.id,
    name: thirdParty(ctx, raw.name, LIMITS.name),
    displayName: thirdParty(ctx, raw.display_name, LIMITS.name),
    category: thirdPartyOrNull(ctx, raw.category, LIMITS.name),
    active: raw.is_active,
    builtin: raw.is_builtin ?? false,
    type: thirdPartyOrNull(ctx, raw.validator_type, LIMITS.name),
  };
}

function entryOf(ctx: CallContext, raw: Raw): CatalogEntry {
  const names = (raw.parameters ?? [])
    .map((parameter) => parameter['name'])
    .filter((name): name is string => typeof name === 'string');
  return {
    ...rowOf(ctx, raw),
    description: thirdPartyOrNull(ctx, raw.description, LIMITS.sentence),
    parameters: names.slice(0, PARAMETERS_SHOWN).map((name) => thirdParty(ctx, name, LIMITS.name)),
    parameterCount: (raw.parameters ?? []).length,
    hasPromptTemplate: [
      raw.prompt_template,
      raw.ai_prompt_template,
      raw.input_generation_prompt,
    ].some((prompt) => prompt !== null && prompt !== undefined && prompt !== ''),
  };
}

export const functionalGetCatalog = moduleTool(FUNCTIONAL_GET_CATALOG, {
  title: 'Get the global catalog of base test types',
  input: {
    kind: z.enum(['test_types', 'validators', 'assertion_types']).describe('Which global catalog.'),
    entry_id: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('One entry (id; for assertion types also the name); without it, the list.'),
    category: z.string().min(1).max(80).optional().describe('Only this category.'),
    is_active: z
      .boolean()
      .optional()
      .describe('Only active (true) or inactive (false) entries; not for assertion types.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many entries to return (1-200).'),
  },
  async run(ctx, args) {
    const kind: CatalogKind = args.kind;
    if (kind === 'assertion_types' && args.is_active !== undefined) {
      refuseRule('catalog_assertion_types_active');
    }
    const base = {
      kind,
      limit: args.limit,
      category: args.category ?? null,
      categories: [] as readonly string[],
    };
    const given = args.entry_id?.trim();
    if (given !== undefined) {
      let raw: Raw;
      if (kind === 'test_types') {
        raw = await getBaseTestType(ctx, { test_type_id: given.toLowerCase() });
      } else if (kind === 'validators') {
        raw = await getBaseValidator(ctx, { validator_id: given.toLowerCase() });
      } else if (isUuid(given)) {
        raw = await getAssertionType(ctx, { type_id: given.toLowerCase() });
      } else {
        raw = await getAssertionTypeByName(ctx, { name: given });
      }
      const data: CatalogData = {
        ...base,
        view: 'one',
        count: 1,
        shown: 0,
        items: [],
        entry: entryOf(ctx, raw),
      };
      return { status: 'done', data, update: { log: { values: { view: 'one' } } } };
    }
    const filters = {
      ...(args.category === undefined ? {} : { category: args.category }),
    };
    let rows: readonly Raw[];
    let categories: readonly string[] = [];
    let total: number;
    if (kind === 'test_types') {
      const answer = await listBaseTestTypes(ctx, {
        ...filters,
        limit: args.limit,
        ...(args.is_active === undefined ? {} : { is_active: args.is_active }),
      });
      rows = answer.test_types;
      categories = answer.categories;
      total = answer.total;
    } else if (kind === 'validators') {
      const answer = await listBaseValidators(ctx, {
        ...filters,
        limit: args.limit,
        ...(args.is_active === undefined ? {} : { is_active: args.is_active }),
      });
      rows = answer.validators;
      categories = answer.categories;
      total = answer.total;
    } else {
      const answer = await listAssertionTypes(ctx, filters);
      rows = answer.slice(0, args.limit);
      total = answer.length;
    }
    const items = rows.slice(0, ITEMS_SHOWN).map((raw) => rowOf(ctx, raw));
    const data: CatalogData = {
      ...base,
      view: 'list',
      count: total,
      shown: items.length,
      categories: categories
        .slice(0, CATEGORIES_SHOWN)
        .map((name) => thirdParty(ctx, name, LIMITS.name)),
      items,
      entry: null,
    };
    return { status: 'done', data, update: { log: { values: { view: 'list' } } } };
  },
  render: renderGetCatalog,
});
