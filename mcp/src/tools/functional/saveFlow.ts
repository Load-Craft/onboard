// `functional_save_flow` (module functional): Save a functional test flow (blocks and edges; no id: create), or
// snapshot it as a version.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the view.
// Three modes: a new flow (one POST), a change (the flow is read first: the values now are the
// comparison and the way back; only the fields that differ are sent, nothing when none does) and a named
// snapshot (`version`). A change of blocks or edges takes a safety snapshot of the current state first
// (`pre-save-<UTC time>`, a free label from the flow's versions): it is an extra version in the flow's
// history, and it is the way back of the blocks (`functional_restore_flow`, which brings back blocks and edges
// only). A change of other fields only has its previous values as the way back (this tool); a value the
// backend would ignore (a null) cannot be put back, one the secret mask would change is not kept, and a way
// back over 20000 characters is not kept. A new flow is taken back by deleting it (`functional_delete`, level 3,
// only named with `undo_tool`). The backend checks every value, the graph of blocks included (a 422).
// Log: args "{flow_id}" (`update.log.values`), result "functional flow {name} saved": the data carries
// `name`.
// Arguments: flow_id, name, docs_id (default: the active docs), fields, version, reason.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderSaveFlow,
  type FlowUndo,
  type SaveFlowData,
} from '../../render/functional/saveFlow.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import {
  LIMITS,
  callBackend,
  refId,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { getTestFlow, listVersions } from './getFlows.js';
import { stable } from './saveTemplate.js';
import { FUNCTIONAL_SAVE_FLOW } from './meta.generated.js';

/** POST /test-flows (REST API v1) */
export function createTestFlow(
  ctx: CallContext,
  body: BodyOf<'create_test_flow_api_v1_test_flows_post'>,
): Promise<OpOutput<'create_test_flow_api_v1_test_flows_post'>> {
  return callBackend(ctx, 'create_test_flow_api_v1_test_flows_post', { body });
}

/** PUT /test-flows/{flow_id} (REST API v1) */
export function updateTestFlow(
  ctx: CallContext,
  path: { readonly flow_id: string },
  body: BodyOf<'update_test_flow_api_v1_test_flows__flow_id__put'>,
): Promise<OpOutput<'update_test_flow_api_v1_test_flows__flow_id__put'>> {
  return callBackend(ctx, 'update_test_flow_api_v1_test_flows__flow_id__put', { path, body });
}

/** POST /test-flows/{flow_id}/versions (REST API v1) */
export function createVersion(
  ctx: CallContext,
  path: { readonly flow_id: string },
  body: BodyOf<'create_version_api_v1_test_flows__flow_id__versions_post'>,
): Promise<OpOutput<'create_version_api_v1_test_flows__flow_id__versions_post'>> {
  return callBackend(ctx, 'create_version_api_v1_test_flows__flow_id__versions_post', {
    path,
    body,
  });
}

const UNDO_LIMIT = 20000;
/** The fields of a flow a change writes, besides the name; the first two are what a restore brings back. */
const BLOCK_FIELDS = ['blocks', 'edges'] as const;
const OTHER_FIELDS = [
  'entry_block_id',
  'description',
  'tags',
  'variables',
  'timeout_ms',
  'retry_count',
  'retry_delay_ms',
  'is_active',
] as const;
type FieldName = (typeof BLOCK_FIELDS)[number] | (typeof OTHER_FIELDS)[number];
/** The backend's own defaults for a new flow. */
const DEFAULTS = { timeout_ms: 300000, retry_count: 0, retry_delay_ms: 1000 } as const;

const fieldsInput = z.strictObject({
  blocks: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  entry_block_id: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  timeout_ms: z.number().int().min(0).optional(),
  retry_count: z.number().int().min(0).optional(),
  retry_delay_ms: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

/** `pre-save-20261127T120000Z`, or the next free one (`-2`, `-3`) among the labels the flow has. */
function safetyLabel(nowMs: number, taken: ReadonlySet<string>): string {
  const base = `pre-save-${new Date(nowMs).toISOString().replace(/[-:]/gu, '').replace(/\.\d+/u, '')}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
  }
  return base;
}

export const functionalSaveFlow = moduleTool(FUNCTIONAL_SAVE_FLOW, {
  title: 'Save a functional test flow',
  input: {
    flow_id: uuidArgument()
      .optional()
      .describe('The flow to change; without it, a new flow is created.'),
    name: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("The flow's name; required for a new flow."),
    docs_id: uuidArgument()
      .optional()
      .describe('The API docs of a new flow; default: the active docs.'),
    fields: fieldsInput
      .optional()
      .describe(
        'Fields to set: blocks, edges, entry_block_id, description, tags, variables, timeout_ms, retry_count, retry_delay_ms, is_active.',
      ),
    version: z
      .string()
      .min(1)
      .max(60)
      .optional()
      .describe(
        'Save a named snapshot of the current blocks and edges instead (not with name or fields).',
      ),
    reason: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('With version: why the snapshot is taken.'),
  },
  async run(ctx, args) {
    const fields = args.fields ?? {};
    const wanted: Partial<Record<FieldName, unknown>> = fields;
    const writes = args.name !== undefined || Object.keys(fields).length > 0;
    if (args.reason !== undefined && args.version === undefined) {
      refuseRule('functional_flow_reason_needs_version');
    }
    if (args.version !== undefined) {
      if (args.flow_id === undefined || writes || args.docs_id !== undefined) {
        refuseRule('functional_flow_snapshot_alone');
      }
      const flowId = args.flow_id.toLowerCase();
      const flow = await getTestFlow(ctx, { flow_id: flowId });
      const saved = await createVersion(
        ctx,
        { flow_id: flowId },
        {
          version: args.version,
          ...(args.reason === undefined ? {} : { change_reason: args.reason }),
        },
      );
      const name = thirdParty(ctx, flow.name, LIMITS.name);
      const data: SaveFlowData = {
        flow: { id: flowId },
        name,
        created: false,
        changed: [],
        snapshot: thirdParty(ctx, saved.version, LIMITS.label),
        snapshot_asked: true,
        blocks: flow.blocks_count,
        not_undoable: [],
        undo: 'none',
      };
      return { status: 'done', data, update: { log: { values: { flow_id: flowId } } } };
    }
    if (args.flow_id === undefined) {
      if (args.name === undefined) refuseRule('functional_flow_new_needs');
      if (fields.is_active !== undefined) refuseRule('functional_flow_new_only');
      const docs = refId(ctx, 'docs_id', args.docs_id, 'ids.docs_id').toLowerCase();
      const created = await createTestFlow(ctx, {
        name: args.name,
        openapi_spec_id: docs,
        timeout_ms: fields.timeout_ms ?? DEFAULTS.timeout_ms,
        retry_count: fields.retry_count ?? DEFAULTS.retry_count,
        retry_delay_ms: fields.retry_delay_ms ?? DEFAULTS.retry_delay_ms,
        ...(fields.blocks === undefined ? {} : { blocks: fields.blocks }),
        ...(fields.edges === undefined ? {} : { edges: fields.edges }),
        ...(fields.entry_block_id === undefined ? {} : { entry_block_id: fields.entry_block_id }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.tags === undefined ? {} : { tags: fields.tags }),
        ...(fields.variables === undefined ? {} : { variables: fields.variables }),
      });
      const name = thirdParty(ctx, created.name, LIMITS.name);
      const data: SaveFlowData = {
        flow: { id: created.id },
        name,
        created: true,
        changed: [],
        snapshot: null,
        snapshot_asked: false,
        blocks: created.blocks_count,
        not_undoable: [],
        undo: 'values',
      };
      return {
        status: 'done',
        data,
        update: {
          log: {
            values: { flow_id: created.id },
            undo_args: { undo_tool: 'functional_delete', kind: 'flow', item_id: created.id },
          },
        },
      };
    }
    if (args.docs_id !== undefined) refuseRule('functional_flow_change_only');
    if (!writes) refuseRule('functional_flow_nothing');
    const flowId = args.flow_id.toLowerCase();
    const path = { flow_id: flowId };
    const before = await getTestFlow(ctx, path);
    const nowValues: Record<string, unknown> = { ...before };
    const nameChanged = args.name !== undefined && args.name !== before.name;
    const changedFields = [...BLOCK_FIELDS, ...OTHER_FIELDS].filter(
      (field) => wanted[field] !== undefined && stable(wanted[field]) !== stable(nowValues[field]),
    );
    const changed: string[] = [...(nameChanged ? ['name'] : []), ...changedFields];
    const shownName = thirdParty(
      ctx,
      nameChanged && args.name !== undefined ? args.name : before.name,
      LIMITS.name,
    );
    const logValues = { flow_id: flowId };
    if (changed.length === 0) {
      const data: SaveFlowData = {
        flow: { id: flowId },
        name: shownName,
        created: false,
        changed,
        snapshot: null,
        snapshot_asked: false,
        blocks: before.blocks_count,
        not_undoable: [],
        undo: 'none',
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    // a change of blocks or edges is kept restorable: the state before is saved as a version first
    const blocksChanged = changedFields.some((field) => BLOCK_FIELDS.some((one) => one === field));
    let snapshot: string | null = null;
    if (blocksChanged) {
      const taken = new Set((await listVersions(ctx, path)).map((entry) => entry.version));
      const label = safetyLabel(ctx.clock.now(), taken);
      await createVersion(ctx, path, {
        version: label,
        change_reason: 'Before functional_save_flow',
      });
      snapshot = label;
    }
    const after = await updateTestFlow(ctx, path, {
      ...(nameChanged && args.name !== undefined ? { name: args.name } : {}),
      ...Object.fromEntries(changedFields.map((field) => [field, wanted[field]])),
    });
    const empty = (value: unknown): boolean => value === null || value === undefined;
    const otherChanged = changedFields.filter((field) => OTHER_FIELDS.some((one) => one === field));
    const restorable = otherChanged.filter((field) => !empty(nowValues[field]));
    const notUndoable: string[] = otherChanged.filter((field) => empty(nowValues[field]));
    const valuesBack = {
      flow_id: flowId,
      ...(nameChanged ? { name: before.name } : {}),
      ...(restorable.length === 0
        ? {}
        : { fields: Object.fromEntries(restorable.map((field) => [field, nowValues[field]])) }),
    };
    const text = JSON.stringify(valuesBack);
    // masking the previous values registers what the mask finds in them, before the check below
    thirdParty(ctx, text, UNDO_LIMIT);
    let undo: FlowUndo;
    let undoArgs: Record<string, unknown> | undefined;
    if (snapshot !== null) {
      // restoring brings back blocks and edges; the other fields written are named as not covered
      const uncovered = [...(nameChanged ? ['name'] : []), ...otherChanged];
      undo = uncovered.length > 0 ? 'partial' : 'restore';
      undoArgs = { undo_tool: 'functional_restore_flow', flow_id: flowId, version: snapshot };
      notUndoable.splice(0, notUndoable.length, ...uncovered);
    } else if (!nameChanged && restorable.length === 0) {
      undo = 'none';
    } else if (text.length > UNDO_LIMIT) {
      undo = 'too_large';
    } else if (ctx.secrets.scrub(text) !== text) {
      undo = 'withheld';
    } else {
      undo = notUndoable.length > 0 ? 'partial' : 'values';
      undoArgs = { undo_tool: 'functional_save_flow', ...valuesBack };
    }
    const data: SaveFlowData = {
      flow: { id: flowId },
      name: thirdParty(ctx, after.name, LIMITS.name),
      created: false,
      changed,
      snapshot: snapshot === null ? null : thirdParty(ctx, snapshot, LIMITS.label),
      snapshot_asked: false,
      blocks: after.blocks_count,
      not_undoable: notUndoable,
      undo,
    };
    return {
      status: 'done',
      data,
      update: {
        log: { values: logValues, ...(undoArgs === undefined ? {} : { undo_args: undoArgs }) },
      },
    };
  },
  render: renderSaveFlow,
});
