// `flows_save` (module flows): Save a flow from blocks (flow_id: new version; none: new flow). Direct
// edit, only on the user's request; normally use flows_ask_copilot.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads, the writes and
// the view. A new flow is one POST. A change reads the flow first (find it by name, then read it: the
// version and the values before are the way back; the graph is what `drop_steps` works on), then one PUT;
// a call that would change nothing sends none. `drop_steps` takes top-level steps out of the graph the
// tool read and sends the blocks that stay exactly as stored (flow/dropSteps.ts), so no value of a
// header or a body goes through the model. A graph the model writes is refused when it carries a secret
// literal (flow/graphSecrets.ts), and `variables` are never written, read or shown. The backend lints the
// graph and decides what it accepts.
// Log: args "{flow_id}", result "{name} v{version} saved": the data carries `name` and `version`, the log
// values `flow_id`. One undo is recorded per call (`update.log.undo_args`, with `undo_tool`): a new flow
// is deleted; a change of the graph is restored to the version before (a name or description changed in
// the same call stays: it makes no version); only a name or a description is saved again as it was.
// State: a new flow joins `ids.flow_ids`; the flow is built; the warning `flows_need_input` follows.
// Arguments: flow_id (no default from the state), name, description, graph, drop_steps, reason.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { dropSteps } from '../../flow/dropSteps.js';
import { secretInGraph } from '../../flow/graphSecrets.js';
import { needsInputUpdate } from '../../flow/needsInput.js';
import { buildOutline } from '../../flow/outline.js';
import { needsOfDetail } from '../../flow/questions.js';
import type { OpOutput } from '../../http/operation.js';
import { renderSaveFlow, type SaveChange, type SaveFlowData } from '../../render/flows/save.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getFlow } from './get.js';
import { FLOWS_SAVE } from './meta.generated.js';

/** POST /projects/{project_id}/flows (REST API v1) */
export function createFlow(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'create_flow_api_v1_projects__project_id__flows_post'>,
): Promise<OpOutput<'create_flow_api_v1_projects__project_id__flows_post'>> {
  return callBackend(ctx, 'create_flow_api_v1_projects__project_id__flows_post', { path, body });
}

/** PUT /projects/{project_id}/flows/{flow_id} (REST API v1) */
export function updateFlow(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
  body: BodyOf<'update_flow_api_v1_projects__project_id__flows__flow_id__put'>,
): Promise<OpOutput<'update_flow_api_v1_projects__project_id__flows__flow_id__put'>> {
  return callBackend(ctx, 'update_flow_api_v1_projects__project_id__flows__flow_id__put', {
    path,
    body,
  });
}

type Rec = Record<string, unknown>;
type Created = OpOutput<'create_flow_api_v1_projects__project_id__flows_post'>;

const NAME_LIMIT = 255;
const REASON_LIMIT = 300;
const MAX_STEPS_DROPPED = 50;
const STEP_NUMBER = /^\d+(?:\.\d+)*$/u;
const GRAPH_KEYS = new Set(['blocks', 'edges', 'entry_block_id']);

const invalid = (detail: string): ToolError => new ToolError('invalid', { params: { detail } });

const isRecordList = (value: unknown): value is Rec[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item));

/** The graph a model wrote, checked as far as the contract says: its keys, its two lists and its entry. */
function graphOf(graph: Rec): { blocks: Rec[]; edges: Rec[]; entry_block_id?: string } {
  const extra = Object.keys(graph).filter((key) => !GRAPH_KEYS.has(key));
  if (extra.length > 0) {
    throw invalid(
      `graph takes blocks, edges and entry_block_id only (not ${extra.join(', ')}): the variables of a flow are not written by this tool`,
    );
  }
  const { blocks, edges, entry_block_id: entry } = graph;
  if (!isRecordList(blocks) || blocks.length === 0 || !isRecordList(edges)) {
    throw invalid('graph needs blocks (at least one block) and edges, each a list of objects');
  }
  if (entry !== undefined && entry !== null && typeof entry !== 'string') {
    throw invalid('entry_block_id of the graph is the id of a block');
  }
  return { blocks, edges, ...(typeof entry === 'string' ? { entry_block_id: entry } : {}) };
}

/** `"14, 15"` as the numbers of steps; anything else, or more than 50, is refused. */
function stepNumbers(list: string): string[] {
  const numbers = list
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  if (numbers.length === 0 || numbers.some((item) => !STEP_NUMBER.test(item))) {
    throw invalid(
      'drop_steps is step numbers as flows_get numbers them, comma-separated, e.g. "14,15"',
    );
  }
  if (numbers.length > MAX_STEPS_DROPPED) {
    throw invalid(`drop_steps names at most ${String(MAX_STEPS_DROPPED)} steps`);
  }
  return numbers;
}

/** The combinations the contract rules out, refused before any request. */
function checked(args: {
  flow_id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  graph?: Rec | undefined;
  drop_steps?: string | undefined;
  reason?: string | undefined;
}): void {
  const changesGraph = args.graph !== undefined || args.drop_steps !== undefined;
  if (args.graph !== undefined && args.drop_steps !== undefined) {
    throw invalid('graph replaces the whole graph, drop_steps edits it: pass one of them');
  }
  if (args.flow_id === undefined) {
    if (args.drop_steps !== undefined)
      throw invalid('drop_steps needs flow_id: it edits a flow that exists');
    if (args.name === undefined) throw invalid('a new flow needs a name');
    if (args.reason !== undefined)
      throw invalid('reason goes on a new version of an existing flow: pass flow_id');
    return;
  }
  if (args.reason !== undefined && !changesGraph) {
    throw invalid('reason is kept on a new version: pass graph or drop_steps with it');
  }
  if (args.name === undefined && args.description === undefined && !changesGraph) {
    throw invalid('nothing to change: pass name, description, graph or drop_steps');
  }
}

export const flowsSave = moduleTool(FLOWS_SAVE, {
  title: 'Save a flow from blocks',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow to change (id or name); without it, a new flow is created.'),
    name: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("The flow's name; required for a new flow."),
    description: z.string().min(1).max(2000).optional().describe("The flow's description."),
    graph: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'The whole graph {blocks, edges, entry_block_id} (no variables); a new flow or a full replacement.',
      ),
    drop_steps: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        'Step numbers to remove, as flows_get numbers them, comma-separated (at most 50); with flow_id, not with graph.',
      ),
    reason: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe('Why the graph changes (with graph or drop_steps); kept on the new version.'),
  },
  async run(ctx, args) {
    checked(args);
    const numbers = args.drop_steps === undefined ? undefined : stepNumbers(args.drop_steps);
    const graph = args.graph === undefined ? undefined : graphOf(args.graph);
    if (graph !== undefined) {
      const path = secretInGraph(graph);
      if (path !== undefined)
        throw new ToolError('flows_save_secret_in_graph', { params: { path } });
    }
    const projectId = projectIdOf(ctx, undefined);
    const reason = args.reason === undefined ? undefined : args.reason;

    if (args.flow_id === undefined) {
      const body: BodyOf<'create_flow_api_v1_projects__project_id__flows_post'> = {
        name: args.name ?? '',
        flow_type: 'api',
        timeout_ms: 300_000,
        retry_count: 0,
        retry_delay_ms: 1000,
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(graph === undefined ? {} : graph),
      };
      const made = await createFlow(ctx, { project_id: projectId }, body);
      return created(ctx, projectId, made, args.description !== undefined, graph !== undefined);
    }

    const found = await createResolver(ctx).flow(projectId, args.flow_id);
    const path = { project_id: projectId, flow_id: found.id };
    const before = await getFlow(ctx, path);
    let next: { blocks: Rec[]; edges: Rec[]; entry_block_id?: string | null } | undefined = graph;
    let dropped: readonly { readonly num: string; readonly name: string }[] = [];
    if (numbers !== undefined) {
      const result = dropSteps(
        { ...before, entry_block_id: before.entry_block_id ?? null },
        numbers,
      );
      if (!result.ok) {
        throw new ToolError('flows_save_step_not_droppable', {
          params: { step: result.step, why: ctx.t(`flows_save.why.${result.reason}`) },
        });
      }
      next = result.graph;
      dropped = result.dropped.map((item) => ({
        num: item.num,
        name: content(ctx, item.name, 100),
      }));
    }
    const changed: SaveChange[] = [];
    if (args.name !== undefined && args.name !== before.name) changed.push('name');
    if (args.description !== undefined && args.description !== (before.description ?? undefined)) {
      changed.push('description');
    }
    if (next !== undefined) changed.push('graph');
    const flow = { id: found.id };
    const logValues = { flow_id: found.id };
    const name = content(ctx, before.name, NAME_LIMIT);
    if (changed.length === 0) {
      const data: SaveFlowData = {
        project_id: projectId,
        flow,
        name,
        version: before.current_version,
        previous_version: before.current_version,
        created: false,
        changed,
        renamed_from: null,
        steps: buildOutline(before).stepCount,
        dropped: [],
        reason: null,
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    const after = await updateFlow(ctx, path, {
      ...(changed.includes('name') ? { name: args.name ?? '' } : {}),
      ...(changed.includes('description') ? { description: args.description ?? '' } : {}),
      ...(next === undefined
        ? {}
        : {
            blocks: next.blocks,
            edges: next.edges,
            ...(next.entry_block_id === undefined || next.entry_block_id === null
              ? {}
              : { entry_block_id: next.entry_block_id }),
            ...(reason === undefined ? {} : { change_reason: reason }),
          }),
    });
    const data: SaveFlowData = {
      project_id: projectId,
      flow,
      name: content(ctx, after.name, NAME_LIMIT),
      version: after.current_version,
      previous_version: before.current_version,
      created: false,
      changed,
      renamed_from: changed.includes('name') ? name : null,
      steps: buildOutline(after).stepCount,
      dropped,
      reason: reason === undefined ? null : content(ctx, reason, REASON_LIMIT),
    };
    const needs = needsInputUpdate(
      ctx.state.process(),
      [needsOfDetail(after)],
      'flows_save',
      'some',
    );
    const undo: Rec = changed.includes('graph')
      ? { undo_tool: 'flows_restore_version', flow_id: found.id, version: before.current_version }
      : {
          undo_tool: 'flows_save',
          flow_id: found.id,
          ...(changed.includes('name') ? { name: before.name } : {}),
          ...(changed.includes('description') &&
          before.description !== null &&
          before.description !== ''
            ? { description: before.description }
            : {}),
        };
    return {
      status: 'done',
      data,
      update: {
        ...(needs ?? {}),
        checks: { flows: { flows_built: { ok: true } } },
        log: { values: logValues, undo_args: undo },
      },
    };
  },
  render: renderSaveFlow,
});

function created(
  ctx: ToolContext,
  projectId: string,
  made: Created,
  described: boolean,
  withGraph: boolean,
) {
  const changed: SaveChange[] = [
    'name',
    ...(described ? (['description'] as const) : []),
    ...(withGraph ? (['graph'] as const) : []),
  ];
  const data: SaveFlowData = {
    project_id: projectId,
    flow: { id: made.id },
    name: content(ctx, made.name, NAME_LIMIT),
    version: made.current_version,
    previous_version: null,
    created: true,
    changed,
    renamed_from: null,
    steps: buildOutline(made).stepCount,
    dropped: [],
    reason: null,
  };
  const needs = needsInputUpdate(ctx.state.process(), [needsOfDetail(made)], 'flows_save', 'some');
  return {
    status: 'done' as const,
    data,
    update: {
      ...(needs ?? {}),
      add: { flow_ids: [made.id] },
      checks: { flows: { flows_built: { ok: true } } },
      log: {
        values: { flow_id: made.id },
        undo_args: { undo_tool: 'flows_delete', kind: 'flow', ids: [made.id] },
      },
    },
  };
}
