// `flows_generate_from_suggestions`: the names of saved proposals (`flows_suggest_journeys`) become
// the baskets of one batch run. LoadCraft generates the baskets in the background whether or not
// anybody listens, so the run is followed over the `batch` channel, and when the channel is
// unavailable the result is read back from the flows list by the unique tag every basket carries.

import { createHash, randomUUID } from 'node:crypto';

import * as z from 'zod';

import { flowQuestions, getFlow, listFlows, needsOfDetail } from '../../api/flows.js';
import {
  currentSpecHash,
  startBatchGeneration,
  type ApprovedBasket,
} from '../../api/batchGeneration.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { needsInputUpdate, type FlowNeeds } from '../../flow/needsInput.js';
import { buildOutline, type FlowOutline } from '../../flow/outline.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { startOrJoin, defineOperationKind, type OperationOutcome } from '../../ops/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import type { Process } from '../../workspace/processState.js';
import type { ProcessUpdateInput } from '../../workspace/reducer.js';
import {
  adviceKey,
  failureSummary,
  renderBuildFlows,
  type BuildFlowsData,
  type FailedFlow,
  type FailureCategory,
  type FailureReason,
  type FlowQuestionView,
} from '../../render/views/buildFlows.js';
import { inline } from '../../render/primitives.js';
import { createResolver } from '../../resolve/handles.js';

/** Flows read at a time; the backend generates five baskets at a time too. */
const CONCURRENCY = 5;
/** A basket without a flow this long after the start did not produce one. */
const LOST_AFTER_MS = 10 * 60 * 1000;
/** Names of saved proposals listed in an error. */
const SHOWN_NAMES = 10;
/** The code the backend names in the text of a refused over-budget prompt. */
const OVER_BUDGET_CODE = 'prompt_over_budget';
/** How the generator starts the text of a flow that failed its own checks, and the check of credentials. */
const VALIDATION_MARKER = 'hard-validation check';
const AUTH_CHECK = '[AUTH_GROUNDING]';
/** Prefix of the tag that lets the flows of a run be found without the channel. */
const TAG_PREFIX = 'mcp-';

// ---- saved proposals (written by `flows_suggest_journeys`) -------------------------------------------

const proposalsSchema = z.object({
  specHash: z.string().nullable(),
  baskets: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      endpoint_ids: z.array(z.string()),
      pattern_type: z.string(),
      tags: z.array(z.string()),
    }),
  ),
});

type SavedProposals = z.infer<typeof proposalsSchema>;
type SavedBasket = SavedProposals['baskets'][number];

function readProposals(ctx: ToolContext, projectId: string): SavedProposals {
  const entry = ctx.state.get('suggestions', projectId);
  const checked = proposalsSchema.safeParse(entry?.value);
  if (!checked.success || checked.data.baskets.length === 0) throw new ToolError('no_suggestions');
  return checked.data;
}

/** The saved proposals the names point at, each once; an unknown name lists the known ones. */
function pickProposals(
  ctx: ToolContext,
  proposals: SavedProposals,
  names: readonly string[],
): SavedBasket[] {
  const exact = new Map(proposals.baskets.map((basket) => [basket.name, basket]));
  const loose = new Map<string, SavedBasket>();
  for (const basket of proposals.baskets) {
    const key = basket.name.trim().toLowerCase();
    if (!loose.has(key)) loose.set(key, basket);
  }
  const picked = new Map<string, SavedBasket>();
  const unknown: string[] = [];
  for (const name of names) {
    const found = exact.get(name) ?? loose.get(name.trim().toLowerCase());
    if (found === undefined) unknown.push(name);
    else picked.set(found.name, found);
  }
  if (unknown.length > 0) {
    const known = proposals.baskets.slice(0, SHOWN_NAMES).map((basket) => quoted(basket.name));
    const more = proposals.baskets.length - known.length;
    throw new ToolError('unknown_suggestions', {
      params: {
        names: unknown.map(quoted).join(', '),
        available:
          more > 0
            ? ctx.t('resolve.more', { names: known.join(', '), count: more })
            : known.join(', '),
      },
    });
  }
  return [...picked.values()];
}

const quoted = (name: string): string => `"${inline(name, 80)}"`;

// ---- the run ------------------------------------------------------------------------------------

const runSchema = z.object({
  projectId: z.string(),
  /** Clock time of the start; a basket without a flow `LOST_AFTER_MS` later is given up on. */
  startedAtMs: z.number(),
  /** Flows the project had before the run: the first flows of a project are shown in full. */
  flowsBefore: z.number().int().min(0),
  /** basket_id → the proposal's name and the unique tag its flow carries. */
  baskets: z.record(z.string(), z.object({ name: z.string(), tag: z.string() })),
  /** Digest of what the proposals say (steps, endpoints): the same name with other content is another run. */
  content: z.string().default(''),
});

type SavedRun = z.infer<typeof runSchema>;

type BasketStatus = 'pending' | 'generating' | 'complete' | 'failed';

interface BasketState {
  readonly id: string;
  readonly name: string;
  readonly status: BasketStatus;
  readonly flowId?: string;
  readonly reason?: FailureReason;
  readonly category?: FailureCategory;
  readonly retryable?: boolean;
}

interface BatchState {
  readonly baskets: readonly BasketState[];
  /** The run said it is over (`complete` or `error`). */
  readonly ended: boolean;
}

/** What the plugin can tell about a failed basket without showing the backend's text. */
function causeOf(
  error: string,
  retryable: boolean | undefined,
): { reason?: FailureReason; category?: FailureCategory } {
  if (error.includes(`(${OVER_BUDGET_CODE})`)) return { reason: 'too_large' };
  if (error.includes(VALIDATION_MARKER)) {
    return error.includes(AUTH_CHECK)
      ? { reason: 'validation', category: 'auth' }
      : { reason: 'validation' };
  }
  return retryable === false ? { reason: 'refused' } : {};
}

const isFinal = (basket: BasketState): boolean =>
  basket.status === 'complete' || basket.status === 'failed';

function withBasket(
  state: BatchState,
  basketId: string,
  change: (basket: BasketState) => BasketState,
): BatchState {
  return {
    ...state,
    baskets: state.baskets.map((basket) => (basket.id === basketId ? change(basket) : basket)),
  };
}

/** The end of the run: whatever has no result yet gets the cause the run gave, if any. */
function ended(state: BatchState, failure: { retryable?: boolean } | undefined): BatchState {
  return {
    ended: true,
    baskets: state.baskets.map((basket): BasketState => {
      if (isFinal(basket)) return basket;
      return {
        id: basket.id,
        name: basket.name,
        status: 'failed',
        reason: 'no_result' as const,
        ...(failure?.retryable === undefined ? {} : { retryable: failure.retryable }),
      };
    }),
  };
}

function describeProgress(state: BatchState, t: ToolContext['t']) {
  const total = state.baskets.length;
  const done = state.baskets.filter(isFinal).length;
  const current =
    state.baskets.find((basket) => basket.status === 'generating') ??
    state.baskets.find((basket) => !isFinal(basket));
  const fraction = total === 0 ? 1 : done / total;
  return {
    message:
      current === undefined
        ? t('build.progress.done', { done, total })
        : t('build.progress', { done, total, name: inline(current.name, 60) }),
    fraction,
  };
}

export const batchGenerationOperation = defineOperationKind({
  kind: 'batch_generation',
  saved: runSchema,
  initial: (_ctx, _id, saved): BatchState => ({
    ended: false,
    baskets: Object.entries(saved.baskets).map(([id, basket]) => ({
      id,
      name: basket.name,
      status: 'pending' as const,
    })),
  }),
  channel: {
    name: 'batch',
    params: (id) => ({ run_id: id }),
    reduce(state: BatchState, frame): BatchState {
      switch (frame.type) {
        case 'batch-generation:basket-progress':
          return withBasket(state, frame.data.basket_id, (basket) =>
            isFinal(basket) ? basket : { ...basket, status: 'generating' },
          );
        case 'batch-generation:basket-complete':
          return withBasket(state, frame.data.basket_id, (basket) => ({
            id: basket.id,
            name: basket.name,
            status: 'complete',
            flowId: frame.data.flow_id,
          }));
        case 'batch-generation:basket-error': {
          // The text of the frame is not kept: it is backend text the model is not shown. Only the
          // cause it names is: the frame has no code field, an over-budget prompt names its code in
          // the text (backend/domain/services/prompt_budget.py:271), and `retryable` says whether a
          // second try can help (backend/api/routes/flow_suggestions.py:1032-1051).
          const cause = causeOf(frame.data.error, frame.data.retryable);
          return withBasket(state, frame.data.basket_id, (basket) =>
            basket.status === 'complete'
              ? basket
              : {
                  id: basket.id,
                  name: basket.name,
                  status: 'failed',
                  ...cause,
                  ...(frame.data.retryable === undefined
                    ? {}
                    : { retryable: frame.data.retryable }),
                },
          );
        }
        case 'batch-generation:complete':
          return ended(state, undefined);
        case 'batch-generation:error': {
          // An unknown run is announced by this frame and then by the close code 4404, which sends
          // the operation to the REST recovery; it says nothing about the baskets.
          if (frame.data.reason === 'run_not_found') return state;
          return ended(state, {
            ...(frame.data.recoverable == null ? {} : { retryable: frame.data.recoverable }),
          });
        }
      }
    },
  },
  recoverIsRead: true,
  // The run has no read of its own: a basket is done when a flow with its tag exists.
  async recover(ctx, _id, saved): Promise<BatchState> {
    const lost = ctx.clock.now() - saved.startedAtMs >= LOST_AFTER_MS;
    // One read for the whole run: the list keeps flows that carry any of the tags (100 at most).
    const found = await listFlows(ctx, saved.projectId, {
      tags: Object.values(saved.baskets).map((basket) => basket.tag),
    });
    const baskets = Object.entries(saved.baskets).map(([id, basket]): BasketState => {
      const flow = found.find((item) => item.tags.includes(basket.tag));
      if (flow !== undefined) return { id, name: basket.name, status: 'complete', flowId: flow.id };
      return lost
        ? { id, name: basket.name, status: 'failed', reason: 'not_created' }
        : { id, name: basket.name, status: 'pending' };
    });
    return { baskets, ended: false };
  },
  isTerminal: (state) => state.ended || state.baskets.every(isFinal),
  describe: (state, t) => describeProgress(state, t),
  async finish(ctx, _id, state, saved): Promise<DoneOutcome<BuildFlowsData>> {
    const read = await mapLimit(
      state.baskets.filter((basket) => basket.status === 'complete'),
      CONCURRENCY,
      async (basket) => ({
        basket,
        flow: await readBuilt(ctx, saved.projectId, basket.flowId ?? ''),
      }),
    );
    const built = read.flatMap((item) => (item.flow === undefined ? [] : [item.flow]));
    const failed: FailedFlow[] = [
      ...state.baskets.filter((basket) => !(basket.status === 'complete')).map(failureOf),
      ...read
        .filter((item) => item.flow === undefined)
        .map((item): FailedFlow => ({ name: item.basket.name, reason: 'unreadable' })),
    ];
    const outlines = built.map((item) => item.outline);
    if (outlines.length === 0) {
      const retryable = failed.some((failure) => failure.retryable === true);
      throw new ToolError('build_flows_failed', {
        params: {
          detail: failed
            .slice(0, SHOWN_NAMES)
            .map((failure) => failureSummary(failure, ctx.t))
            .join('; '),
          advice: ctx.t(
            adviceKey(failed) ?? (retryable ? 'build.advice.retry' : 'build.advice.fix'),
          ),
        },
      });
    }
    const lead = outlines.length === 1 || saved.flowsBefore === 0 ? 'full' : 'lines';
    const first = outlines[0];
    return {
      status: 'done',
      data: {
        built: outlines,
        questions: built.flatMap((item) => item.questions),
        failed,
        lead,
      },
      update: flowsUpdate(built, ctx.state.process(), 'flows_generate_from_suggestions'),
      ...(lead === 'full' && first !== undefined
        ? { links: [ctx.services.links.flow(saved.projectId, first.flowId)] }
        : {}),
    };
  },
  view: renderBuildFlows,
});

function failureOf(basket: BasketState): FailedFlow {
  return {
    name: basket.name,
    ...(basket.reason === undefined ? {} : { reason: basket.reason }),
    ...(basket.category === undefined ? {} : { category: basket.category }),
    ...(basket.retryable === undefined ? {} : { retryable: basket.retryable }),
  };
}

export interface BuiltFlow {
  readonly outline: FlowOutline;
  readonly questions: FlowQuestionView[];
  /** The open items of the flow, for the warning `flows_need_input`. */
  readonly needs: FlowNeeds;
}

/** Longest name of an object the process keeps for display. */
const MAX_LABEL = 120;

/**
 * What built flows change in the process: their ids join `ids.flow_ids`, their names the labels,
 * the check that flows are saved holds, and the warning `flows_need_input` follows their open items.
 * Every way of building returns it with its outcome; `tool` is the tool of that way.
 */
export function flowsUpdate(
  built: readonly BuiltFlow[],
  process: Process | undefined,
  tool: string,
): ProcessUpdateInput {
  const outlines = built.map((item) => item.outline);
  const needs = needsInputUpdate(
    process,
    built.map((item) => item.needs),
    tool,
    'some',
  );
  return {
    ...(needs?.problems === undefined ? {} : { problems: needs.problems }),
    add: { flow_ids: outlines.map((outline) => outline.flowId) },
    labels: Object.fromEntries(
      outlines.map((outline) => [
        outline.flowId,
        { name: outline.name.slice(0, MAX_LABEL), status: `v${String(outline.version)}` },
      ]),
    ),
    checks: { flows: { flows_built: { ok: true } } },
  };
}

/** A flow with its outline and the generator's questions; undefined when LoadCraft has no such flow. */
export async function readBuilt(
  ctx: ToolContext,
  projectId: string,
  flowId: string,
): Promise<BuiltFlow | undefined> {
  try {
    const flow = await getFlow(ctx, projectId, flowId);
    const outline = buildOutline(flow);
    const questions = flowQuestions(flow);
    return {
      outline,
      needs: needsOfDetail(flow),
      questions: questions.map((item): FlowQuestionView => ({
        flow: outline.name,
        field: item.field,
        question: item.question,
        ...(item.kind === '' ? {} : { kind: item.kind }),
        ...(item.why === '' ? {} : { why: item.why }),
        ...(item.steps === undefined ? {} : { steps: item.steps }),
        ...(item.definite === true ? { definite: true } : {}),
      })),
    };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) return undefined;
    throw error;
  }
}

/** Runs `work` over the items, `limit` at a time; the results keep the order of the items. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---- starting ---------------------------------------------------------------------------------

export interface FromSuggestionsArgs {
  readonly project?: string;
  readonly suggestions: readonly string[];
  readonly maxWaitS: number;
}

/** A tag no other basket of the request has; it is what finds the flow of a basket without the channel. */
function uniqueTags(): () => string {
  const used = new Set<string>();
  return () => {
    for (;;) {
      const tag = `${TAG_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      if (!used.has(tag)) {
        used.add(tag);
        return tag;
      }
    }
  };
}

/**
 * Equal for equal proposals in any order: the name, description, endpoints and pattern of each,
 * and the hash of the documentation they were made from (the same text over a changed API is other work).
 */
function contentDigest(
  picked: readonly {
    name: string;
    description: string;
    endpoint_ids: readonly string[];
    pattern_type: string;
  }[],
  specHash: string | null,
): string {
  const rows = picked
    .map((basket) =>
      JSON.stringify([basket.name, basket.description, basket.endpoint_ids, basket.pattern_type]),
    )
    .sort();
  return createHash('sha256')
    .update([specHash ?? '', ...rows].join('\n'))
    .digest('hex')
    .slice(0, 16);
}

export async function buildFromSuggestions(
  ctx: ToolContext,
  args: FromSuggestionsArgs,
): Promise<OperationOutcome<BuildFlowsData>> {
  const project = await createResolver(ctx).project(args.project?.trim() ?? '');
  const proposals = readProposals(ctx, project.id);
  const picked = pickProposals(ctx, proposals, args.suggestions);

  // The digest covers names and content of every proposal, so another set or another text of a
  // proposal is other work.
  const content = contentDigest(picked, proposals.specHash);
  // The same proposals still being built are joined: a second call must not pay for them twice.
  return startOrJoin(ctx, batchGenerationOperation, {
    maxWaitS: args.maxWaitS,
    matches: (run) => run.projectId === project.id && run.content === content,
    async start() {
      const current = await currentSpecHash(ctx, project.id);
      if (proposals.specHash !== null && current !== null && proposals.specHash !== current) {
        throw new ToolError('suggestions_stale');
      }
      const flowsBefore = (await listFlows(ctx, project.id)).length;

      const newTag = uniqueTags();
      const baskets: ApprovedBasket[] = [];
      const saved: Record<string, { name: string; tag: string }> = {};
      picked.forEach((basket, index) => {
        const basketId = `b${String(index + 1)}`;
        const tag = newTag();
        saved[basketId] = { name: basket.name, tag };
        baskets.push({
          basket_id: basketId,
          name: basket.name,
          description: basket.description,
          endpoint_ids: [...basket.endpoint_ids],
          pattern_type: basket.pattern_type,
          tags: [...basket.tags, tag],
        });
      });
      const startedAtMs = ctx.clock.now();
      const runId = await startBatchGeneration(ctx, project.id, baskets);
      const run: SavedRun = {
        projectId: project.id,
        startedAtMs,
        flowsBefore,
        baskets: saved,
        content,
      };
      return { id: runId, saved: run };
    },
  });
}
