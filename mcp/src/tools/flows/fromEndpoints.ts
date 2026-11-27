// `flows_generate_from_endpoints`: one flow from a name, a description and a list of endpoints the
// user chose in the conversation. LoadCraft generates the flow in the background (`generate-async`);
// the run is followed by reading its state through REST only, because the backend keeps the state of
// a run, so a call that stopped waiting and `process_wait` later read the same thing.

import * as z from 'zod';

import { listEndpoints, type EndpointRef } from '../../api/suggestions.js';
import { getFlowGenerationStatus, startFlowGeneration } from '../../api/flowGeneration.js';
import { listFlowsWithTotal } from '../../api/flows.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { withheldJobText } from '../../http/errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { defineOperationKind, startOrJoin, type OperationOutcome } from '../../ops/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import { inline } from '../../render/primitives.js';
import { content } from '../moduleCall.js';
import { renderBuildFlows, type BuildFlowsData } from '../../render/views/buildFlows.js';
import { createResolver } from '../../resolve/handles.js';
import { flowsUpdate, readBuilt } from './fromSuggestions.js';

/** Endpoint ids named in one error. */
const SHOWN_IDS = 10;
/** Closest known endpoints offered for each id LoadCraft does not know. */
const CLOSEST_PER_ID = 3;
const MAX_NAME = 80;
/** The tool of this way, named in the errors that tell the model to call it again. */
const TOOL = 'flows_generate_from_endpoints';

// ---- endpoints ---------------------------------------------------------------------------------

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const SPACED = /^([A-Za-z]+)\s+(\/.*)$/u;
const COLONED = /^([A-Za-z]+):(\/.*)$/u;

/**
 * `"POST /auth/login"` and `"post:/auth/login"` become `POST:/auth/login`, the form LoadCraft
 * matches by method and path. Anything else (a UUID, an `operationId`, a bare path) is kept as the
 * user wrote it, apart from surrounding blanks.
 */
export function normalizeEndpoint(raw: string): string {
  const text = raw.trim();
  const match = SPACED.exec(text) ?? COLONED.exec(text);
  const [, method, path] = match ?? [];
  if (method === undefined || path === undefined || !METHODS.has(method.toLowerCase())) return text;
  return `${method.toUpperCase()}:${path.trim()}`;
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitute = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(substitute, (previous[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1));
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/**
 * Up to `CLOSEST_PER_ID` operations of the specification whose `METHOD:/path` or `operationId` is
 * closest to `id` (edit distance), nearest first; none when nothing is reasonably close.
 */
export function closestEndpoints(id: string, known: readonly EndpointRef[]): string[] {
  const wanted = id.toLowerCase();
  const limit = Math.max(2, Math.ceil(wanted.length * 0.4));
  return known
    .map((endpoint) => {
      const keys = [`${endpoint.method}:${endpoint.path}`, endpoint.operationId ?? ''];
      const nearest = Math.min(
        ...keys.filter((key) => key !== '').map((key) => distance(wanted, key.toLowerCase())),
      );
      return { label: `${endpoint.method}:${endpoint.path}`, nearest };
    })
    .filter((candidate) => candidate.nearest <= limit)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, CLOSEST_PER_ID)
    .map((candidate) => candidate.label);
}

function unknownIds(error: LoadcraftApiError): string[] {
  const details = error.details;
  if (typeof details !== 'object' || details === null || !('endpoint_ids' in details)) return [];
  const { endpoint_ids: ids } = details;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [];
}

/** The refusal of ids LoadCraft does not know, with the closest known operations for each. */
async function unknownEndpoints(
  ctx: ToolContext,
  projectId: string,
  error: LoadcraftApiError,
): Promise<ToolError> {
  const ids = unknownIds(error);
  let known: EndpointRef[] = [];
  try {
    known = await listEndpoints(ctx, projectId);
  } catch (failure) {
    // The closest names are a help only; a project without a readable specification has none.
    if (!(failure instanceof ToolError)) throw failure;
  }
  const shown = ids.slice(0, SHOWN_IDS);
  const closest = shown.flatMap((id) => {
    const found = closestEndpoints(id, known);
    return found.length === 0
      ? []
      : [
          `${content(ctx, id, MAX_NAME)} → ${found.map((name) => content(ctx, name, MAX_NAME)).join(', ')}`,
        ];
  });
  const more = ids.length - shown.length;
  const names = shown.map((id) => `"${content(ctx, id, MAX_NAME)}"`).join(', ');
  return new ToolError('unknown_endpoints', {
    params: {
      what: ctx.t.plural('build.manual.unknownIds', ids.length, {
        ids: more > 0 ? ctx.t('resolve.more', { names, count: more }) : names,
      }),
      closest:
        closest.length === 0 ? '' : ctx.t('build.manual.closest', { items: closest.join('; ') }),
    },
    cause: error,
  });
}

// ---- the run -----------------------------------------------------------------------------------

const savedSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  /** Flows of the project when the name could not be checked against all of them. */
  unchecked: z.number().int().optional(),
  /**
   * Set by `flows_regenerate`: the run rewrites this flow as a new version (the one it had is the way back),
   * instead of making a new one.
   */
  regenerate: z
    .object({ flowId: z.string().min(1).max(64), previousVersion: z.number().int().min(0) })
    .optional(),
});

interface GenerationState {
  readonly name: string;
  /** The run regenerates a flow (`flows_regenerate`): its lines of progress say so. */
  readonly regenerating?: true;
  readonly phase: 'running' | 'completed' | 'failed' | 'cancelled';
  /** 0..100 */
  readonly progress: number;
  readonly step?: string;
  readonly flowId?: string;
  readonly error?: string;
}

/** The tool of the regeneration, named in its log entry and in the problems it opens. */
const REGENERATE_TOOL = 'flows_regenerate';

/**
 * A run of `flows_regenerate` that ended: the flow it rewrote with the version it has now, read back; a run that
 * failed or whose result cannot be read is an error of the module, and the flow is as it was.
 */
async function finishRegeneration(
  ctx: ToolContext,
  state: GenerationState,
  saved: z.infer<typeof savedSchema>,
  regenerate: NonNullable<z.infer<typeof savedSchema>['regenerate']>,
): Promise<DoneOutcome<BuildFlowsData>> {
  const name = content(ctx, saved.name, MAX_NAME);
  if (state.phase === 'cancelled') {
    throw new ToolError('flow_generation_cancelled', { params: { name, tool: REGENERATE_TOOL } });
  }
  const built =
    state.phase === 'completed'
      ? await readBuilt(ctx, saved.projectId, regenerate.flowId)
      : undefined;
  if (built === undefined) {
    const detail =
      withheldJobText(ctx, REGENERATE_TOOL, state.error) ??
      ctx.t(
        state.phase === 'completed' ? 'build.flows.reason.unreadable' : 'build.manual.noDetail',
      );
    throw new ToolError('flows_regenerate_failed', { params: { name, detail } });
  }
  const update = flowsUpdate([built], ctx.state.process(), REGENERATE_TOOL);
  return {
    status: 'done',
    data: {
      built: [built.outline],
      questions: built.questions,
      failed: [],
      lead: 'single',
      regenerated: {
        previous_version: regenerate.previousVersion,
        version: built.outline.version,
      },
    },
    links: [ctx.services.links.flow(saved.projectId, regenerate.flowId)],
    update: {
      ...update,
      log: {
        values: { name: built.outline.name, version: built.outline.version },
        undo_args: { flow_id: regenerate.flowId, version: regenerate.previousVersion },
      },
    },
  };
}

export const flowGenerationOperation = defineOperationKind({
  kind: 'flow_generation',
  saved: savedSchema,
  initial: (_ctx, _id, saved): GenerationState => ({
    name: saved.name,
    ...(saved.regenerate === undefined ? {} : { regenerating: true as const }),
    phase: 'running',
    progress: 0,
  }),
  // No channel: the backend keeps the state of the run, a 404 means it forgot the run.
  async recover(ctx, id, saved): Promise<GenerationState> {
    const status = await getFlowGenerationStatus(ctx, saved.projectId, id);
    return {
      name: saved.name,
      ...(saved.regenerate === undefined ? {} : { regenerating: true as const }),
      phase: status.phase,
      progress: status.progress,
      ...(status.step === null ? {} : { step: status.step }),
      ...(status.flowId === null ? {} : { flowId: status.flowId }),
      ...(status.error === null ? {} : { error: status.error }),
    };
  },
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) =>
    state.phase === 'failed' || state.phase === 'cancelled' ? state.phase : undefined,
  describe(state, t) {
    const name = inline(state.name, MAX_NAME);
    const prefix = state.regenerating === true ? 'flows_regenerate' : 'build.manual';
    return {
      message:
        state.step === undefined
          ? t(`${prefix}.running`, { name })
          : t(`${prefix}.progress`, { name, step: inline(state.step, 60) }),
      fraction: Math.min(1, Math.max(0, state.progress / 100)),
    };
  },
  async finish(ctx, _id, state, saved): Promise<DoneOutcome<BuildFlowsData>> {
    const name = content(ctx, saved.name, MAX_NAME);
    if (saved.regenerate !== undefined)
      return finishRegeneration(ctx, state, saved, saved.regenerate);
    if (state.phase === 'cancelled')
      throw new ToolError('flow_generation_cancelled', { params: { name, tool: TOOL } });
    const built =
      state.phase === 'completed' && state.flowId !== undefined
        ? await readBuilt(ctx, saved.projectId, state.flowId)
        : undefined;
    if (built === undefined) {
      const detail =
        withheldJobText(ctx, TOOL, state.error) ??
        ctx.t(
          state.phase === 'completed' ? 'build.flows.reason.unreadable' : 'build.manual.noDetail',
        );
      throw new ToolError('flow_generation_failed', { params: { name, detail, tool: TOOL } });
    }
    return {
      status: 'done',
      data: {
        built: [built.outline],
        questions: built.questions,
        failed: [],
        lead: 'single',
        ...(saved.unchecked === undefined ? {} : { uncheckedFlows: saved.unchecked }),
      },
      links: [ctx.services.links.flow(saved.projectId, built.outline.flowId)],
      update: flowsUpdate([built], ctx.state.process(), TOOL),
    };
  },
  view: renderBuildFlows,
});

// ---- starting ----------------------------------------------------------------------------------

export interface FromEndpointsArgs {
  readonly project?: string;
  readonly name: string;
  readonly description: string;
  readonly endpoints: readonly string[];
  readonly maxWaitS: number;
}

export async function buildFromEndpoints(
  ctx: ToolContext,
  args: FromEndpointsArgs,
): Promise<OperationOutcome<BuildFlowsData>> {
  const { name, description, endpoints } = args;
  const project = await createResolver(ctx).project(args.project?.trim() ?? '');

  const wanted = name.trim().toLowerCase();

  // The same flow still being generated is joined: a second call must not pay for it twice.
  return startOrJoin(ctx, flowGenerationOperation, {
    maxWaitS: args.maxWaitS,
    matches: (run) => run.projectId === project.id && run.name.trim().toLowerCase() === wanted,
    async start() {
      // A second flow with the same name would make every handle by name ambiguous.
      const listed = await listFlowsWithTotal(ctx, project.id);
      const existing = listed.flows.find((flow) => flow.name.trim().toLowerCase() === wanted);
      if (existing !== undefined) {
        throw new ToolError('flow_exists', {
          params: { name: content(ctx, existing.name, MAX_NAME), tool: TOOL },
        });
      }
      let runId: string;
      try {
        runId = await startFlowGeneration(ctx, project.id, {
          name: name.trim(),
          description,
          endpoints: endpoints.map(normalizeEndpoint),
        });
      } catch (error) {
        if (error instanceof LoadcraftApiError && error.code === 'unknown_endpoint_ids') {
          throw await unknownEndpoints(ctx, project.id, error);
        }
        throw error;
      }
      return {
        id: runId,
        saved: {
          projectId: project.id,
          name: name.trim(),
          ...(listed.total > listed.flows.length ? { unchecked: listed.total } : {}),
        },
      };
    },
  });
}
