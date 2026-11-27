// `functional_save_template` (module functional): Save a functional test template (no id: create).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// A new template is one POST; a change reads the template first (the values now: the comparison, and the
// previous values of the fields written, which are the undo) and sends only the fields that differ; nothing
// is sent when none does. The backend checks every value (a 422 is its refusal); the tool refuses locally only
// what cannot be sent: a new template without its required fields, a change with nothing in it, `docs_id` on
// a change. The undo of a change is this tool with the previous values; of a new template the deletion
// (`functional_delete`, level 3, only named with `undo_tool`). A previous value the backend would ignore (a null) is
// reported, one the secret mask would change is not kept, and a way back over 20000 characters is not kept.
// The name is a third party's text and passes the mask; the rest of the template is only counted or named.
// Log: args "{name}" (`update.log.values`), result "template {name} saved": the data carries `name`.
// Arguments: template_id, name, docs_id, fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderSaveTemplate,
  type SaveTemplateData,
  type TemplateUndo,
} from '../../render/functional/saveTemplate.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import {
  LIMITS,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
  callBackend,
} from '../kit/transitional.js';
import { getTestTemplate } from './getTemplates.js';
import { FUNCTIONAL_SAVE_TEMPLATE } from './meta.generated.js';

/** POST /test-templates (REST API v1) */
export function createTestTemplate(
  ctx: CallContext,
  body: BodyOf<'create_test_template_api_v1_test_templates_post'>,
): Promise<OpOutput<'create_test_template_api_v1_test_templates_post'>> {
  return callBackend(ctx, 'create_test_template_api_v1_test_templates_post', { body });
}

/** PUT /test-templates/{template_id} (REST API v1) */
export function updateTestTemplate(
  ctx: CallContext,
  path: { readonly template_id: string },
  body: BodyOf<'update_test_template_api_v1_test_templates__template_id__put'>,
): Promise<OpOutput<'update_test_template_api_v1_test_templates__template_id__put'>> {
  return callBackend(ctx, 'update_test_template_api_v1_test_templates__template_id__put', {
    path,
    body,
  });
}
const UNDO_LIMIT = 20000;
/** The fields the backend can read back to a value; null it ignores, so an empty one cannot be put back. */
const FIELD_NAMES = [
  'api_description',
  'flow_definition',
  'assertions',
  'endpoint_ids',
  'tags',
  'description',
  'is_active',
] as const;
type FieldName = (typeof FIELD_NAMES)[number];

/** The text of a value with its keys in order, so two values that say the same compare equal. */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

const fieldsInput = z.strictObject({
  api_description: z.string().optional(),
  flow_definition: z.record(z.string(), z.unknown()).optional(),
  assertions: z
    .array(
      z.strictObject({
        type_id: z.string(),
        enabled: z.boolean(),
        type_name: z.string().nullable().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  endpoint_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const functionalSaveTemplate = moduleTool(FUNCTIONAL_SAVE_TEMPLATE, {
  title: 'Save a functional test template',
  input: {
    template_id: uuidArgument()
      .optional()
      .describe('The template to change; without it, a new template is created.'),
    name: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("The template's name; required for a new one."),
    docs_id: uuidArgument().optional().describe('The API docs the template belongs to, if any.'),
    fields: fieldsInput
      .optional()
      .describe(
        'Fields to set: api_description (10-5000 characters) and flow_definition (required for a new one), assertions, endpoint_ids, tags, description, is_active.',
      ),
  },
  async run(ctx, args) {
    const fields = args.fields ?? {};
    const wanted: Partial<Record<FieldName, unknown>> = fields;
    if (args.template_id === undefined) {
      if (
        args.name === undefined ||
        fields.api_description === undefined ||
        fields.flow_definition === undefined
      ) {
        refuseRule('functional_template_new_needs');
      }
      const created = await createTestTemplate(ctx, {
        name: args.name,
        api_description: fields.api_description,
        flow_definition: fields.flow_definition,
        ...(args.docs_id === undefined ? {} : { openapi_spec_id: args.docs_id.toLowerCase() }),
        ...(fields.assertions === undefined
          ? {}
          : {
              assertions: fields.assertions.map((item) => ({
                type_id: item.type_id,
                enabled: item.enabled,
                ...(item.type_name === undefined ? {} : { type_name: item.type_name }),
                ...(item.parameters === undefined ? {} : { parameters: item.parameters }),
              })),
            }),
        ...(fields.endpoint_ids === undefined ? {} : { endpoint_ids: fields.endpoint_ids }),
        ...(fields.tags === undefined ? {} : { tags: fields.tags }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
      });
      const name = thirdParty(ctx, created.name, LIMITS.name);
      const data: SaveTemplateData = {
        template: { id: created.id },
        name,
        created: true,
        changed: [],
        assertions: created.assertions_count,
        not_undoable: [],
        undo: 'kept',
      };
      return {
        status: 'done',
        data,
        update: {
          log: {
            values: { name },
            undo_args: { undo_tool: 'functional_delete', kind: 'template', item_id: created.id },
          },
        },
      };
    }
    if (args.docs_id !== undefined) refuseRule('functional_template_docs_new_only');
    if (args.name === undefined && Object.keys(fields).length === 0) {
      refuseRule('functional_template_nothing');
    }
    const id = args.template_id.toLowerCase();
    const path = { template_id: id };
    const before = await getTestTemplate(ctx, path);
    const nowValues: Record<string, unknown> = { ...before };
    const changedFields = FIELD_NAMES.filter(
      (field) => wanted[field] !== undefined && stable(wanted[field]) !== stable(nowValues[field]),
    );
    const nameChanged = args.name !== undefined && args.name !== before.name;
    const changed: string[] = [...(nameChanged ? ['name'] : []), ...changedFields];
    const shownName = thirdParty(
      ctx,
      nameChanged && args.name !== undefined ? args.name : before.name,
      LIMITS.name,
    );
    const logValues = { name: shownName };
    if (changed.length === 0) {
      const data: SaveTemplateData = {
        template: { id },
        name: shownName,
        created: false,
        changed,
        assertions: before.assertions_count,
        not_undoable: [],
        undo: 'none',
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    const after = await updateTestTemplate(ctx, path, {
      ...(nameChanged && args.name !== undefined ? { name: args.name } : {}),
      ...Object.fromEntries(changedFields.map((field) => [field, wanted[field]])),
    });
    // the way back: the previous value of each field written; an empty one cannot be put back
    const empty = (value: unknown): boolean => value === null || value === undefined;
    const restorable = changedFields.filter((field) => !empty(nowValues[field]));
    const notUndoable: string[] = changedFields.filter((field) => empty(nowValues[field]));
    const previous = Object.fromEntries(restorable.map((field) => [field, nowValues[field]]));
    const undoArgs = {
      template_id: id,
      ...(nameChanged ? { name: before.name } : {}),
      ...(restorable.length === 0 ? {} : { fields: previous }),
    };
    const text = JSON.stringify(undoArgs);
    // masking the previous text registers what the mask finds in it, before the check below
    thirdParty(ctx, text, UNDO_LIMIT);
    let undo: TemplateUndo = 'kept';
    if (!nameChanged && restorable.length === 0) undo = 'none';
    else if (text.length > UNDO_LIMIT) undo = 'too_large';
    else if (ctx.secrets.scrub(text) !== text) undo = 'withheld';
    else if (notUndoable.length > 0) undo = 'partial';
    const data: SaveTemplateData = {
      template: { id },
      name: thirdParty(ctx, after.name, LIMITS.name),
      created: false,
      changed,
      assertions: after.assertions_count,
      not_undoable: notUndoable,
      undo,
    };
    const keep = undo === 'kept' || undo === 'partial';
    return {
      status: 'done',
      data,
      update: { log: { values: logValues, ...(keep ? { undo_args: undoArgs } : {}) } },
    };
  },
  render: renderSaveTemplate,
});
