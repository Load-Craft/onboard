// `functional_save_test_types` (module functional): Save test types in the project: add custom ones,
// catalog ones in bulk or accepted AI suggestions, or update one.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2 on a card (docs/consent-card.md): the first call reads what it needs and
// makes the card; a repeat with the same arguments asks the person; only their yes writes.
// Two modes, never both: `source` with `items` (an addition: key = the name, or the id of a catalog
// test type; value = its fields; 1 to 50, counted here) or `test_type_id` with `fields` (a change of
// one). custom: one POST each; catalog: one bulk POST of ids; suggestions: one accept POST each. A
// change reads the test type first and sends only the fields that differ.
// Undo (`update.log.undo_args`): exactly one test type added -> `functional_delete` (`undo_tool`);
// several -> none in the log (the delete takes one target), the view says so; a change -> this tool
// with the previous values (a null cannot be put back; a value the secret mask would change is not
// kept).
// Log: args "Save {n} test types in the project", result "{count} test types saved".
// Arguments (the catalog's): source, items, test_type_id, fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import type { FieldFact } from '../../render/functional/consentFields.js';
import {
  cardViewSaveTestTypes,
  renderSaveTestTypes,
  type SaveTestTypesData,
  type SaveTestTypesFacts,
  type TestTypeItemFact,
  type TestTypesSource,
  type TestTypesUndo,
} from '../../render/functional/saveTestTypes.js';
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
import { listBaseTestTypes } from './getCatalog.js';
import { getTestType, listProjectTestTypes } from './getTestTypes.js';
import { factOf } from './consentFields.js';
import { FUNCTIONAL_SAVE_TEST_TYPES } from './meta.generated.js';
import { stable } from './saveTemplate.js';

type Op = {
  add: 'add_test_type_api_v1_projects__project_id__test_types_post';
  bulk: 'bulk_add_test_types_api_v1_projects__project_id__test_types_bulk_post';
  accept: 'accept_suggestion_api_v1_projects__project_id__test_types_suggest_accept_post';
  update: 'update_test_type_api_v1_projects__project_id__test_types__test_type_id__put';
};
type Path = { readonly project_id: string };

/** POST /projects/{project_id}/test-types (REST API v1) */
export function addTestType(
  ctx: CallContext,
  path: Path,
  body: BodyOf<Op['add']>,
): Promise<OpOutput<Op['add']>> {
  return callBackend(ctx, 'add_test_type_api_v1_projects__project_id__test_types_post', {
    path,
    body,
  });
}

/** POST /projects/{project_id}/test-types/bulk (REST API v1) */
export function bulkAddTestTypes(
  ctx: CallContext,
  path: Path,
  body: BodyOf<Op['bulk']>,
): Promise<OpOutput<Op['bulk']>> {
  return callBackend(ctx, 'bulk_add_test_types_api_v1_projects__project_id__test_types_bulk_post', {
    path,
    body,
  });
}

/** POST /projects/{project_id}/test-types/suggest/accept (REST API v1) */
export function acceptSuggestion(
  ctx: CallContext,
  path: Path,
  body: BodyOf<Op['accept']>,
): Promise<OpOutput<Op['accept']>> {
  return callBackend(
    ctx,
    'accept_suggestion_api_v1_projects__project_id__test_types_suggest_accept_post',
    { path, body },
  );
}

/** PUT /projects/{project_id}/test-types/{test_type_id} (REST API v1) */
export function updateTestType(
  ctx: CallContext,
  path: Path & { readonly test_type_id: string },
  body: BodyOf<Op['update']>,
): Promise<OpOutput<Op['update']>> {
  return callBackend(
    ctx,
    'update_test_type_api_v1_projects__project_id__test_types__test_type_id__put',
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
  category: 'custom_category',
  display_name: 'custom_display_name',
  description: 'custom_description',
  input_prompt: 'custom_input_prompt',
  example_inputs: 'custom_example_inputs',
  expected_outcome: 'custom_expected_outcome',
};
const ADD_FIELDS = [
  'category',
  'display_name',
  'description',
  'input_prompt',
  'example_inputs',
  'expected_outcome',
  'default_count',
  'priority',
  'poll_completion_values',
  'poll_timeout_ms',
] as const;
const SUGGESTION_FIELDS = ADD_FIELDS.filter(
  (field) => field !== 'poll_completion_values' && field !== 'poll_timeout_ms',
);
const SUGGESTION_REQUIRED = ['category', 'display_name', 'description', 'input_prompt'];
const UPDATE_FIELDS = [...ADD_FIELDS, 'name', 'is_enabled'] as const;

const fieldsInput = z.strictObject({
  name: z.string().min(1).max(255).optional(),
  category: z.string().min(1).max(100).optional(),
  display_name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  input_prompt: z.string().max(20000).optional(),
  example_inputs: z.array(z.record(z.string(), z.unknown())).optional(),
  expected_outcome: z.string().max(2000).optional(),
  default_count: z.number().int().min(1).max(100).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  poll_completion_values: z.array(z.string()).optional(),
  poll_timeout_ms: z.number().int().min(1).max(3_600_000).optional(),
  is_enabled: z.boolean().optional(),
});
type Fields = z.infer<typeof fieldsInput>;

/** The fields a call gives, in the order of `allowed`; a field outside `allowed` is refused. */
function pick(fields: Fields, allowed: readonly string[]): [string, unknown][] {
  const given: Record<string, unknown> = { ...fields };
  if (Object.keys(given).some((key) => !allowed.includes(key)))
    refuseRule('test_types_field_unknown');
  return allowed.filter((key) => given[key] !== undefined).map((key) => [key, given[key]]);
}

interface Item {
  readonly key: string;
  readonly fields: [string, unknown][];
}

/** The items of an addition, checked: the count, and the fields each source takes. */
function itemsOf(source: TestTypesSource, items: Readonly<Record<string, Fields>>): Item[] {
  const entries = Object.entries(items);
  if (entries.length < 1 || entries.length > MAX_ITEMS) refuseRule('test_types_items_count');
  return entries.map(([key, fields]) => {
    if (source === 'catalog') {
      if (!isUuid(key) || Object.keys(fields).length > 0) refuseRule('test_types_catalog_ids');
      return { key: key.toLowerCase(), fields: [] };
    }
    const picked = pick(fields, source === 'custom' ? ADD_FIELDS : SUGGESTION_FIELDS);
    if (
      source === 'suggestions' &&
      SUGGESTION_REQUIRED.some((need) => !picked.some(([name]) => name === need))
    ) {
      refuseRule('test_types_suggestion_needs');
    }
    return { key, fields: picked };
  });
}

/** The body of a custom addition: the fields under the backend's names, with the defaults it needs. */
function customBody(item: Item, priority: number): BodyOf<Op['add']> {
  const body: Record<string, unknown> = { custom_name: item.key, default_count: 3, priority };
  for (const [field, value] of item.fields) body[BACKEND[field] ?? field] = value;
  return body as BodyOf<Op['add']>;
}

function acceptBody(item: Item, priority: number): BodyOf<Op['accept']> {
  const given = Object.fromEntries(item.fields);
  const { input_prompt: prompt, ...rest } = given;
  return {
    default_count: 3,
    priority,
    ...rest,
    input_generation_prompt: prompt,
    name: item.key,
  } as BodyOf<Op['accept']>;
}

const empty = (value: unknown): boolean => value === null || value === undefined;

export const functionalSaveTestTypes = moduleTool(FUNCTIONAL_SAVE_TEST_TYPES, {
  title: 'Save test types in the project',
  input: {
    source: z
      .enum(['custom', 'catalog', 'suggestions'])
      .optional()
      .describe(
        'custom: new items; catalog: catalog entries to add; suggestions: accepted AI items.',
      ),
    items: z
      .record(z.string().min(1).max(255), fieldsInput)
      .optional()
      .describe('The items to add (key: name or id; value: its fields, {} for catalog ids); 1-50.'),
    test_type_id: uuidArgument()
      .optional()
      .describe('Change this test type of the project instead (not with source or items).'),
    fields: fieldsInput.optional().describe('With test_type_id: the fields to set.'),
  },
  async card(ctx, args) {
    const adding = args.source !== undefined || args.items !== undefined;
    const changing = args.test_type_id !== undefined || args.fields !== undefined;
    if (adding === changing) refuseRule('test_types_one_mode');
    const path = { project_id: projectIdOf(ctx, undefined) };
    if (adding) {
      if (args.source === undefined || args.items === undefined) refuseRule('test_types_one_mode');
      const items = itemsOf(args.source, args.items);
      const names =
        args.source === 'catalog'
          ? new Map((await listBaseTestTypes(ctx)).test_types.map((type) => [type.id, type.name]))
          : new Map<string, string>();
      const shown: TestTypeItemFact[] = items.slice(0, SHOWN).map((item) => ({
        name: thirdParty(ctx, names.get(item.key) ?? item.key, NAME_LIMIT),
        fields: item.fields.map(([field, value]) => factOf(ctx, field, value)),
      }));
      const facts: SaveTestTypesFacts = {
        mode: 'add',
        n: items.length,
        source: args.source,
        items: shown,
      };
      return { facts };
    }
    if (args.test_type_id === undefined || args.fields === undefined)
      refuseRule('test_types_one_mode');
    const wanted = pick(args.fields, UPDATE_FIELDS);
    if (wanted.length === 0) refuseRule('test_types_nothing');
    const id = args.test_type_id.toLowerCase();
    const before = await getTestType(ctx, { ...path, test_type_id: id });
    const name = thirdParty(ctx, before.effective_name, NAME_LIMIT);
    const now: Record<string, unknown> = before;
    const changed = wanted.filter(
      ([field, value]) => stable(value) !== stable(now[BACKEND[field] ?? field]),
    );
    if (changed.length === 0) {
      const data: SaveTestTypesData = {
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
    const facts: SaveTestTypesFacts = {
      mode: 'update',
      n: 1,
      test_type_id: id,
      name,
      fields: changed.map(([field, value]): FieldFact => factOf(ctx, field, value)),
    };
    return { facts };
  },
  cardView: cardViewSaveTestTypes,
  async run(ctx, args) {
    const path = { project_id: projectIdOf(ctx, undefined) };
    if (args.source !== undefined && args.items !== undefined) {
      const items = itemsOf(args.source, args.items);
      const base = (await listProjectTestTypes(ctx, path)).items.reduce(
        (top, item) => Math.max(top, item.priority),
        0,
      );
      let saved: { id: string; name: string }[] = [];
      let skipped = 0;
      if (args.source === 'catalog') {
        const answer = await bulkAddTestTypes(ctx, path, {
          base_type_ids: items.map((item) => item.key),
        });
        saved = answer.added_ids.map((id) => ({ id, name: id }));
        skipped = answer.skipped_count;
      } else {
        for (const [index, item] of items.entries()) {
          const priority = base + index + 1;
          const created =
            args.source === 'custom'
              ? await addTestType(ctx, path, customBody(item, priority))
              : await acceptSuggestion(ctx, path, acceptBody(item, priority));
          saved.push({ id: created.id, name: thirdParty(ctx, created.effective_name, NAME_LIMIT) });
        }
      }
      const only = saved.length === 1 ? saved[0] : undefined;
      const undo: TestTypesUndo =
        only !== undefined ? 'kept' : saved.length === 0 ? 'none' : 'one_by_one';
      const data: SaveTestTypesData = {
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
                    kind: 'test_type',
                    item_id: only.id,
                  },
                }),
          },
        },
      };
    }
    const id = (args.test_type_id ?? '').toLowerCase();
    const wanted = pick(args.fields ?? {}, UPDATE_FIELDS);
    const before = await getTestType(ctx, { ...path, test_type_id: id });
    const now: Record<string, unknown> = before;
    const changed = wanted.filter(
      ([field, value]) => stable(value) !== stable(now[BACKEND[field] ?? field]),
    );
    const send = Object.fromEntries(
      changed.map(([field, value]) => [BACKEND[field] ?? field, value]),
    );
    const after = await updateTestType(ctx, { ...path, test_type_id: id }, send);
    const notUndoable = changed
      .map(([field]) => field)
      .filter((field) => empty(now[BACKEND[field] ?? field]));
    const previous = Object.fromEntries(
      changed
        .filter(([field]) => !empty(now[BACKEND[field] ?? field]))
        .map(([field]) => [field, now[BACKEND[field] ?? field]]),
    );
    const undoArgs = {
      undo_tool: 'functional_save_test_types',
      test_type_id: id,
      fields: previous,
    };
    const text = JSON.stringify(undoArgs);
    // masking the previous text registers what the mask finds in it, before the check below
    thirdParty(ctx, text, UNDO_LIMIT);
    let undo: TestTypesUndo = 'kept';
    if (Object.keys(previous).length === 0) undo = 'none';
    else if (text.length > UNDO_LIMIT || ctx.secrets.scrub(text) !== text) undo = 'withheld';
    else if (notUndoable.length > 0) undo = 'partial';
    const name = thirdParty(ctx, after.effective_name, LIMITS.name);
    const data: SaveTestTypesData = {
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
  render: renderSaveTestTypes,
});
