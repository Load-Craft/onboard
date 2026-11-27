// `functional_save_catalog` (module functional): Save a custom catalog entry (base test type, base
// validator or assertion type; no id: create). The catalog is shared by all projects.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2 on a card (docs/consent-card.md). The first call reads the entry (a change)
// and makes the card; a repeat with the same arguments asks the person; only their yes writes.
// A new entry is one POST; a change reads the entry first (the values now: the comparison, and the
// previous values of the fields written, which are the undo) and sends only the fields that differ;
// nothing is asked or sent when none does. The backend checks every value; the tool refuses locally
// only what cannot be sent: a field that is not of the kind, a new entry without its required
// fields, a name on a change (the backend has no rename), a change with nothing in it.
// Undo (`update.log.undo_args`): a new entry -> `functional_delete` (`undo_tool`); a change -> this
// tool with the previous values (a null cannot be put back; a value the secret mask would change is
// not kept).
// Log: args "{name}", result "{kind} {name} saved".
// Arguments (the catalog's): kind, entry_id, name, fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSaveCatalog,
  renderSaveCatalog,
  type CatalogKind,
  type CatalogUndo,
  type SaveCatalogData,
  type SaveCatalogFacts,
} from '../../render/functional/saveCatalog.js';
import {
  callBackend,
  LIMITS,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { factOf } from './consentFields.js';
import { getAssertionType, getBaseTestType, getBaseValidator } from './getCatalog.js';
import { FUNCTIONAL_SAVE_CATALOG } from './meta.generated.js';
import { stable } from './saveTemplate.js';

type Id = {
  testCreate: 'create_base_test_type_api_v1_base_test_types_post';
  testUpdate: 'update_base_test_type_api_v1_base_test_types__test_type_id__put';
  validatorCreate: 'create_base_validator_api_v1_base_validators_post';
  validatorUpdate: 'update_base_validator_api_v1_base_validators__validator_id__put';
  assertionCreate: 'create_assertion_type_api_v1_assertion_types_post';
  assertionUpdate: 'update_assertion_type_api_v1_assertion_types__type_id__put';
};

/** POST /base-test-types (REST API v1) */
export function createBaseTestType(
  ctx: CallContext,
  body: BodyOf<Id['testCreate']>,
): Promise<OpOutput<Id['testCreate']>> {
  return callBackend(ctx, 'create_base_test_type_api_v1_base_test_types_post', { body });
}

/** PUT /base-test-types/{test_type_id} (REST API v1) */
export function updateBaseTestType(
  ctx: CallContext,
  path: { readonly test_type_id: string },
  body: BodyOf<Id['testUpdate']>,
): Promise<OpOutput<Id['testUpdate']>> {
  return callBackend(ctx, 'update_base_test_type_api_v1_base_test_types__test_type_id__put', {
    path,
    body,
  });
}

/** POST /base-validators (REST API v1) */
export function createBaseValidator(
  ctx: CallContext,
  body: BodyOf<Id['validatorCreate']>,
): Promise<OpOutput<Id['validatorCreate']>> {
  return callBackend(ctx, 'create_base_validator_api_v1_base_validators_post', { body });
}

/** PUT /base-validators/{validator_id} (REST API v1) */
export function updateBaseValidator(
  ctx: CallContext,
  path: { readonly validator_id: string },
  body: BodyOf<Id['validatorUpdate']>,
): Promise<OpOutput<Id['validatorUpdate']>> {
  return callBackend(ctx, 'update_base_validator_api_v1_base_validators__validator_id__put', {
    path,
    body,
  });
}

/** POST /assertion-types (REST API v1) */
export function createAssertionType(
  ctx: CallContext,
  body: BodyOf<Id['assertionCreate']>,
): Promise<OpOutput<Id['assertionCreate']>> {
  return callBackend(ctx, 'create_assertion_type_api_v1_assertion_types_post', { body });
}

/** PUT /assertion-types/{type_id} (REST API v1) */
export function updateAssertionType(
  ctx: CallContext,
  path: { readonly type_id: string },
  body: BodyOf<Id['assertionUpdate']>,
): Promise<OpOutput<Id['assertionUpdate']>> {
  return callBackend(ctx, 'update_assertion_type_api_v1_assertion_types__type_id__put', {
    path,
    body,
  });
}

const NAME_LIMIT = 120;
const UNDO_LIMIT = 20000;

/** The fields of each kind: the union is the input, the lists decide what a kind takes. */
const FIELDS: Readonly<Record<CatalogKind, readonly string[]>> = {
  catalog_test_type: [
    'category',
    'display_name',
    'description',
    'expected_outcome',
    'input_generation_prompt',
    'input_schema',
    'example_inputs',
    'is_active',
  ],
  catalog_validator: [
    'category',
    'display_name',
    'description',
    'validator_type',
    'activation',
    'group',
    'scope',
    'requires_profile_flags',
    'ai_prompt_template',
    'parameters',
    'is_active',
  ],
  catalog_assertion_type: [
    'category',
    'display_name',
    'description',
    'prompt_template',
    'parameters',
    'is_active',
  ],
};
const REQUIRED: Readonly<Record<CatalogKind, readonly string[]>> = {
  catalog_test_type: ['category', 'display_name', 'input_generation_prompt'],
  catalog_validator: ['activation', 'category', 'display_name', 'group', 'scope', 'validator_type'],
  catalog_assertion_type: ['category', 'display_name'],
};

const objects = z.array(z.record(z.string(), z.unknown()));
const fieldsInput = z.strictObject({
  category: z.string().optional(),
  display_name: z.string().optional(),
  description: z.string().optional(),
  expected_outcome: z.string().optional(),
  input_generation_prompt: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  example_inputs: objects.optional(),
  is_active: z.boolean().optional(),
  validator_type: z.enum(['assertion', 'ai_semantic']).optional(),
  activation: z.string().optional(),
  group: z.string().optional(),
  scope: z.string().optional(),
  requires_profile_flags: z.array(z.string()).optional(),
  ai_prompt_template: z.string().optional(),
  parameters: objects.optional(),
  prompt_template: z.string().optional(),
});
type Fields = z.infer<typeof fieldsInput>;

/** The entry as the backend holds it now, with the fields the call can write. */
interface Current {
  readonly id: string;
  readonly name: string;
  readonly is_builtin: boolean;
  readonly values: Readonly<Record<string, unknown>>;
}

async function readEntry(ctx: CallContext, kind: CatalogKind, id: string): Promise<Current> {
  const entry =
    kind === 'catalog_test_type'
      ? await getBaseTestType(ctx, { test_type_id: id })
      : kind === 'catalog_validator'
        ? await getBaseValidator(ctx, { validator_id: id })
        : await getAssertionType(ctx, { type_id: id });
  return {
    id: entry.id,
    name: entry.name,
    is_builtin: entry.is_builtin,
    values: { ...entry },
  };
}

/** The fields the call gives, in the order of the kind, as the backend takes them. */
function wantedFields(kind: CatalogKind, fields: Fields): [string, unknown][] {
  const given: Record<string, unknown> = { ...fields };
  const allowed = new Set(FIELDS[kind]);
  const foreign = Object.keys(given).filter((key) => !allowed.has(key));
  if (foreign.length > 0) refuseRule('catalog_field_not_of_kind');
  return FIELDS[kind].filter((key) => given[key] !== undefined).map((key) => [key, given[key]]);
}

export const functionalSaveCatalog = moduleTool(FUNCTIONAL_SAVE_CATALOG, {
  title: 'Save a custom catalog entry',
  input: {
    kind: z
      .enum(['catalog_test_type', 'catalog_validator', 'catalog_assertion_type'])
      .describe('Which shared catalog: base test type, base validator or assertion type.'),
    entry_id: uuidArgument()
      .optional()
      .describe('The entry to change; without it, a new one is created.'),
    name: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("The entry's name; required for a new one."),
    fields: fieldsInput
      .optional()
      .describe('Fields to set: the create or update body of that catalog.'),
  },
  async card(ctx, args) {
    const wanted = wantedFields(args.kind, args.fields ?? {});
    if (args.entry_id === undefined) {
      const missing = REQUIRED[args.kind].some((key) => !wanted.some(([name]) => name === key));
      if (args.name === undefined || missing) refuseRule('catalog_new_needs');
      const facts: SaveCatalogFacts = {
        kind: args.kind,
        name: thirdParty(ctx, args.name, NAME_LIMIT),
        created: true,
        builtin: false,
        fields: wanted.map(([key, value]) => factOf(ctx, key, value)),
      };
      return { facts };
    }
    if (args.name !== undefined) refuseRule('catalog_name_new_only');
    if (wanted.length === 0) refuseRule('catalog_nothing');
    const id = args.entry_id.toLowerCase();
    const before = await readEntry(ctx, args.kind, id);
    const changed = wanted.filter(([key, value]) => stable(value) !== stable(before.values[key]));
    const name = thirdParty(ctx, before.name, NAME_LIMIT);
    if (changed.length === 0) {
      const data: SaveCatalogData = {
        kind: args.kind,
        entry_id: id,
        name,
        created: false,
        changed: [],
        not_undoable: [],
        undo: 'none',
      };
      return { unchanged: data };
    }
    const facts: SaveCatalogFacts = {
      kind: args.kind,
      name,
      entry_id: id,
      created: false,
      builtin: before.is_builtin,
      fields: changed.map(([key, value]) => factOf(ctx, key, value)),
    };
    return { facts };
  },
  cardView: cardViewSaveCatalog,
  async run(ctx, args) {
    const wanted = wantedFields(args.kind, args.fields ?? {});
    const body: Record<string, unknown> = Object.fromEntries(wanted);
    if (args.entry_id === undefined) {
      const named = { ...body, name: args.name ?? '' };
      const created =
        args.kind === 'catalog_test_type'
          ? await createBaseTestType(ctx, named as BodyOf<Id['testCreate']>)
          : args.kind === 'catalog_validator'
            ? await createBaseValidator(ctx, named as BodyOf<Id['validatorCreate']>)
            : await createAssertionType(ctx, named as BodyOf<Id['assertionCreate']>);
      const name = thirdParty(ctx, created.name, NAME_LIMIT);
      const data: SaveCatalogData = {
        kind: args.kind,
        entry_id: created.id,
        name,
        created: true,
        changed: [],
        not_undoable: [],
        undo: 'kept',
      };
      return {
        status: 'done',
        data,
        update: {
          log: {
            values: { name, kind: args.kind },
            undo_args: { undo_tool: 'functional_delete', kind: args.kind, item_id: created.id },
          },
        },
      };
    }
    const id = args.entry_id.toLowerCase();
    const before = await readEntry(ctx, args.kind, id);
    const changed = wanted.filter(([key, value]) => stable(value) !== stable(before.values[key]));
    const send = Object.fromEntries(changed);
    const after =
      args.kind === 'catalog_test_type'
        ? await updateBaseTestType(ctx, { test_type_id: id }, send)
        : args.kind === 'catalog_validator'
          ? await updateBaseValidator(ctx, { validator_id: id }, send)
          : await updateAssertionType(ctx, { type_id: id }, send);
    const empty = (value: unknown): boolean => value === null || value === undefined;
    const notUndoable = changed.map(([key]) => key).filter((key) => empty(before.values[key]));
    const previous = Object.fromEntries(
      changed
        .filter(([key]) => !empty(before.values[key]))
        .map(([key]) => [key, before.values[key]]),
    );
    const undoArgs = { kind: args.kind, entry_id: id, fields: previous };
    const text = JSON.stringify(undoArgs);
    // masking the previous text registers what the mask finds in it, before the check below
    thirdParty(ctx, text, UNDO_LIMIT);
    let undo: CatalogUndo = 'kept';
    if (Object.keys(previous).length === 0) undo = 'none';
    else if (text.length > UNDO_LIMIT || ctx.secrets.scrub(text) !== text) undo = 'withheld';
    else if (notUndoable.length > 0) undo = 'partial';
    const name = thirdParty(ctx, after.name, LIMITS.name);
    const data: SaveCatalogData = {
      kind: args.kind,
      entry_id: id,
      name,
      created: false,
      changed: changed.map(([key]) => key),
      not_undoable: notUndoable,
      undo,
    };
    const keep = undo === 'kept' || undo === 'partial';
    return {
      status: 'done',
      data,
      update: {
        log: { values: { name, kind: args.kind }, ...(keep ? { undo_args: undoArgs } : {}) },
      },
    };
  },
  render: renderSaveCatalog,
});
