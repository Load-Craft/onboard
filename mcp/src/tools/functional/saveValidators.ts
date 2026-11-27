// `functional_save_validators` (module functional): Save validators in the project: add custom ones,
// catalog ones in bulk or accepted proposals, or update one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2 on a card (docs/consent-card.md): the first call reads what it needs and
// makes the card; a repeat with the same arguments asks the person; only their yes writes.
// Two modes, never both: `source` with `items` (an addition: key = the name, or the id of a catalog
// validator; value = its fields; 1 to 50, counted here) or `validator_id` with `fields` (a change of
// one). custom and proposals: one POST each (the backend has no accept route for validators: an
// accepted proposal is an addition with the fields of the proposal); catalog: one bulk POST of ids.
// A change reads the validator first and sends only the fields that differ.
// Undo (`update.log.undo_args`): exactly one validator added -> `functional_delete` (`undo_tool`);
// several -> none in the log (the delete takes one target), the view says so; a change -> this tool
// with the previous values (a null cannot be put back; a value the secret mask would change is not
// kept).
// Log: args "Save {n} validators in the project", result "{count} validators saved".
// Arguments (the catalog's): source, items, validator_id, fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import type { FieldFact } from '../../render/functional/consentFields.js';
import {
  cardViewSaveValidators,
  renderSaveValidators,
  type SaveValidatorsData,
  type SaveValidatorsFacts,
  type ValidatorItemFact,
  type ValidatorsSource,
  type ValidatorsUndo,
} from '../../render/functional/saveValidators.js';
import {
  callBackend,
  isUuid,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { listBaseValidators } from './getCatalog.js';
import { getValidator, listProjectValidators } from './getValidators.js';
import { factOf } from './consentFields.js';
import { FUNCTIONAL_SAVE_VALIDATORS } from './meta.generated.js';
import { stable } from './saveTemplate.js';

type Op = {
  add: 'add_validator_api_v1_projects__project_id__validators_post';
  bulk: 'bulk_add_validators_api_v1_projects__project_id__validators_bulk_post';
  update: 'update_validator_api_v1_projects__project_id__validators__validator_id__put';
};
type Path = { readonly project_id: string };

/** POST /projects/{project_id}/validators (REST API v1) */
export function addValidator(
  ctx: CallContext,
  path: Path,
  body: BodyOf<Op['add']>,
): Promise<OpOutput<Op['add']>> {
  return callBackend(ctx, 'add_validator_api_v1_projects__project_id__validators_post', {
    path,
    body,
  });
}

/** POST /projects/{project_id}/validators/bulk (REST API v1) */
export function bulkAddValidators(
  ctx: CallContext,
  path: Path,
  body: BodyOf<Op['bulk']>,
): Promise<OpOutput<Op['bulk']>> {
  return callBackend(ctx, 'bulk_add_validators_api_v1_projects__project_id__validators_bulk_post', {
    path,
    body,
  });
}

/** PUT /projects/{project_id}/validators/{validator_id} (REST API v1) */
export function updateValidator(
  ctx: CallContext,
  path: Path & { readonly validator_id: string },
  body: BodyOf<Op['update']>,
): Promise<OpOutput<Op['update']>> {
  return callBackend(
    ctx,
    'update_validator_api_v1_projects__project_id__validators__validator_id__put',
    { path, body },
  );
}

const NAME_LIMIT = 120;
const SHOWN = 20;
const MAX_ITEMS = 50;
const UNDO_LIMIT = 20000;

/** The fields of a call and the names of the backend's fields they are written under. */
const BACKEND: Readonly<Record<string, string>> = {
  name: 'custom_name',
  display_name: 'custom_display_name',
  description: 'custom_description',
  ai_prompt: 'custom_ai_prompt',
  parameters: 'custom_parameters',
  validator_type: 'custom_validator_type',
  rationale: 'auto_config_reason',
};
const ADD_FIELDS = [
  'display_name',
  'description',
  'ai_prompt',
  'parameters',
  'validator_type',
  'default_params',
  'scope',
  'template',
  'priority',
] as const;
const PROPOSAL_FIELDS = [
  'display_name',
  'description',
  'template',
  'default_params',
  'rationale',
  'scope',
  'priority',
] as const;
const PROPOSAL_REQUIRED = ['display_name', 'description', 'template'];
const UPDATE_FIELDS = [
  'name',
  'display_name',
  'description',
  'ai_prompt',
  'parameters',
  'validator_type',
  'default_params',
  'priority',
  'is_enabled',
  'needs_review',
] as const;

const fieldsInput = z.strictObject({
  name: z.string().min(1).max(255).optional(),
  display_name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  ai_prompt: z.string().max(20000).optional(),
  parameters: z.array(z.record(z.string(), z.unknown())).optional(),
  validator_type: z.enum(['assertion', 'ai_semantic']).optional(),
  default_params: z.record(z.string(), z.unknown()).optional(),
  scope: z.string().max(100).optional(),
  template: z.string().max(20000).optional(),
  rationale: z.string().max(2000).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  is_enabled: z.boolean().optional(),
  needs_review: z.boolean().optional(),
});
type Fields = z.infer<typeof fieldsInput>;

/** The fields a call gives, in the order of `allowed`; a field outside `allowed` is refused. */
function pick(fields: Fields, allowed: readonly string[]): [string, unknown][] {
  const given: Record<string, unknown> = { ...fields };
  if (Object.keys(given).some((key) => !allowed.includes(key))) {
    refuseRule('validators_field_unknown');
  }
  return allowed.filter((key) => given[key] !== undefined).map((key) => [key, given[key]]);
}

interface Item {
  readonly key: string;
  readonly fields: [string, unknown][];
}

/** The items of an addition, checked: the count, and the fields each source takes. */
function itemsOf(source: ValidatorsSource, items: Readonly<Record<string, Fields>>): Item[] {
  const entries = Object.entries(items);
  if (entries.length < 1 || entries.length > MAX_ITEMS) refuseRule('validators_items_count');
  return entries.map(([key, fields]) => {
    if (source === 'catalog') {
      if (!isUuid(key) || Object.keys(fields).length > 0) refuseRule('validators_catalog_ids');
      return { key: key.toLowerCase(), fields: [] };
    }
    const picked = pick(fields, source === 'custom' ? ADD_FIELDS : PROPOSAL_FIELDS);
    if (
      source === 'proposals' &&
      PROPOSAL_REQUIRED.some((need) => !picked.some(([name]) => name === need))
    ) {
      refuseRule('validators_proposal_needs');
    }
    return { key, fields: picked };
  });
}

/** The body of an addition: the fields under the backend's names, with the priority it needs. */
function addBody(item: Item, priority: number): BodyOf<Op['add']> {
  const body: Record<string, unknown> = { custom_name: item.key, priority };
  for (const [field, value] of item.fields) body[BACKEND[field] ?? field] = value;
  return body as BodyOf<Op['add']>;
}

const empty = (value: unknown): boolean => value === null || value === undefined;

export const functionalSaveValidators = moduleTool(FUNCTIONAL_SAVE_VALIDATORS, {
  title: 'Save validators in the project',
  input: {
    source: z
      .enum(['custom', 'catalog', 'proposals'])
      .optional()
      .describe(
        'custom: new items; catalog: catalog entries to add; proposals: accepted AI items.',
      ),
    items: z
      .record(z.string().min(1).max(255), fieldsInput)
      .optional()
      .describe('The items to add (key: name or id; value: its fields, {} for catalog ids); 1-50.'),
    validator_id: uuidArgument()
      .optional()
      .describe('Change this validator of the project instead (not with source or items).'),
    fields: fieldsInput.optional().describe('With validator_id: the fields to set.'),
  },
  async card(ctx, args) {
    const adding = args.source !== undefined || args.items !== undefined;
    const changing = args.validator_id !== undefined || args.fields !== undefined;
    if (adding === changing) refuseRule('validators_one_mode');
    const path = { project_id: projectIdOf(ctx, undefined) };
    if (adding) {
      if (args.source === undefined || args.items === undefined) refuseRule('validators_one_mode');
      const items = itemsOf(args.source, args.items);
      const names =
        args.source === 'catalog'
          ? new Map((await listBaseValidators(ctx)).validators.map((type) => [type.id, type.name]))
          : new Map<string, string>();
      const shown: ValidatorItemFact[] = items.slice(0, SHOWN).map((item) => ({
        name: thirdParty(ctx, names.get(item.key) ?? item.key, NAME_LIMIT),
        fields: item.fields.map(([field, value]) => factOf(ctx, field, value)),
      }));
      const facts: SaveValidatorsFacts = {
        mode: 'add',
        n: items.length,
        source: args.source,
        items: shown,
      };
      return { facts };
    }
    if (args.validator_id === undefined || args.fields === undefined)
      refuseRule('validators_one_mode');
    const wanted = pick(args.fields, UPDATE_FIELDS);
    if (wanted.length === 0) refuseRule('validators_nothing');
    const id = args.validator_id.toLowerCase();
    const before = await getValidator(ctx, { ...path, validator_id: id });
    const name = thirdParty(ctx, before.effective_name, NAME_LIMIT);
    const now: Record<string, unknown> = before;
    const changed = wanted.filter(
      ([field, value]) => stable(value) !== stable(now[BACKEND[field] ?? field]),
    );
    if (changed.length === 0) {
      const data: SaveValidatorsData = {
        mode: 'update',
        saved: [{ id, name }],
        count: 1,
        skipped: 0,
        changed: [],
        not_undoable: [],
        undo: 'none',
      };
      return { unchanged: data };
    }
    const facts: SaveValidatorsFacts = {
      mode: 'update',
      n: 1,
      validator_id: id,
      name,
      fields: changed.map(([field, value]): FieldFact => factOf(ctx, field, value)),
    };
    return { facts };
  },
  cardView: cardViewSaveValidators,
  async run(ctx, args) {
    const path = { project_id: projectIdOf(ctx, undefined) };
    if (args.source !== undefined && args.items !== undefined) {
      const items = itemsOf(args.source, args.items);
      const base = (await listProjectValidators(ctx, path)).items.reduce(
        (top, item) => Math.max(top, item.priority),
        0,
      );
      let saved: { id: string; name: string }[] = [];
      let skipped = 0;
      if (args.source === 'catalog') {
        const answer = await bulkAddValidators(ctx, path, {
          base_validator_ids: items.map((item) => item.key),
        });
        saved = answer.added_ids.map((id) => ({ id, name: id }));
        skipped = answer.skipped_count;
      } else {
        for (const [index, item] of items.entries()) {
          const priority = base + index + 1;
          const created = await addValidator(ctx, path, addBody(item, priority));
          saved.push({ id: created.id, name: thirdParty(ctx, created.effective_name, NAME_LIMIT) });
        }
      }
      const only = saved.length === 1 ? saved[0] : undefined;
      const undo: ValidatorsUndo =
        only !== undefined ? 'kept' : saved.length === 0 ? 'none' : 'one_by_one';
      const data: SaveValidatorsData = {
        mode: 'add',
        saved: saved.slice(0, SHOWN),
        count: saved.length,
        skipped,
        changed: [],
        not_undoable: [],
        undo,
      };
      return {
        status: 'done',
        data,
        update: {
          log: {
            values: { count: saved.length },
            ...(only === undefined
              ? {}
              : {
                  undo_args: {
                    undo_tool: 'functional_delete',
                    kind: 'validator',
                    item_id: only.id,
                  },
                }),
          },
        },
      };
    }
    const id = (args.validator_id ?? '').toLowerCase();
    const wanted = pick(args.fields ?? {}, UPDATE_FIELDS);
    const before = await getValidator(ctx, { ...path, validator_id: id });
    const now: Record<string, unknown> = before;
    const changed = wanted.filter(
      ([field, value]) => stable(value) !== stable(now[BACKEND[field] ?? field]),
    );
    const send = Object.fromEntries(
      changed.map(([field, value]) => [BACKEND[field] ?? field, value]),
    );
    const after = await updateValidator(ctx, { ...path, validator_id: id }, send);
    const notUndoable = changed
      .map(([field]) => field)
      .filter((field) => empty(now[BACKEND[field] ?? field]));
    const previous = Object.fromEntries(
      changed
        .filter(([field]) => !empty(now[BACKEND[field] ?? field]))
        .map(([field]) => [field, now[BACKEND[field] ?? field]]),
    );
    const undoArgs = {
      undo_tool: 'functional_save_validators',
      validator_id: id,
      fields: previous,
    };
    const text = JSON.stringify(undoArgs);
    // masking the previous text registers what the mask finds in it, before the check below
    thirdParty(ctx, text, UNDO_LIMIT);
    let undo: ValidatorsUndo = 'kept';
    if (Object.keys(previous).length === 0) undo = 'none';
    else if (text.length > UNDO_LIMIT || ctx.secrets.scrub(text) !== text) undo = 'withheld';
    else if (notUndoable.length > 0) undo = 'partial';
    const name = thirdParty(ctx, after.effective_name, LIMITS.name);
    const data: SaveValidatorsData = {
      mode: 'update',
      saved: [{ id, name }],
      count: 1,
      skipped: 0,
      changed: changed.map(([field]) => field),
      not_undoable: notUndoable,
      undo,
    };
    const keep = undo === 'kept' || undo === 'partial';
    return {
      status: 'done',
      data,
      update: { log: { values: { count: 1 }, ...(keep ? { undo_args: undoArgs } : {}) } },
    };
  },
  render: renderSaveValidators,
});
