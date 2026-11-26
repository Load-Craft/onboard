// `flows_suggest_journeys`: user journeys proposed from the project's API documentation. The free
// heuristic answers at once; the model's refinement is a background job of LoadCraft that lives
// only as long as somebody watches its WebSocket channel (it is cancelled after 45 s without a
// listener), so the call opens the channel right after the job starts and keeps it open.

import * as z from 'zod';

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { getCompat } from '../api/status.js';
import {
  cancelRefine,
  getHeuristicSuggestions,
  listEndpoints,
  parseSuggestions,
  startRefine,
  type Basket,
  type EndpointRef,
  type Suggestions,
} from '../api/suggestions.js';
import {
  awaitOperation,
  callWaitS,
  defineOperationKind,
  encodeHandle,
  endOperation,
  findRunning,
  maxWaitInput,
} from '../ops/operation.js';
import { abortError } from '../ops/clock.js';
import { defineTool } from '../registry.js';
import { renderSuggestJourneys, type SuggestionsData } from '../render/views/suggestJourneys.js';
import { createResolver } from '../resolve/handles.js';
import type { StateCache } from '../workspace/cache.js';

/** Uncovered operations the view names. */
const SHOWN_UNCOVERED = 5;
/** Times the channel is opened again after REST found the job alive but unobserved. */
const REJOINS = 1;

const input = z.object({
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
  refine: z
    .boolean()
    .default(true)
    .describe(
      'Refine the proposals with a model (minutes on a large API); false = only the free heuristic.',
    ),
  force: z
    .boolean()
    .default(false)
    .describe('Refine again even when LoadCraft already has a refinement for this documentation.'),
  max_wait_s: maxWaitInput('the refinement'),
});

// ---- saved proposals ------------------------------------------------------------------

/** What `loadcraft/.cache/state.json → suggestions[<project id>]` holds; `flows_generate_from_suggestions` reads it. */
interface SavedSuggestions {
  readonly specHash: string | null;
  readonly baskets: {
    readonly name: string;
    readonly description: string;
    readonly endpoint_ids: readonly string[];
    readonly pattern_type: string;
    readonly tags: readonly string[];
    /** What each step does, as the proposals were shown (for a client that lists them); optional. */
    readonly step_labels?: readonly string[];
  }[];
}

/** Step labels kept per proposal in the workspace state; a client shows the first few. */
const SAVED_STEP_LABELS = 12;

async function remember(
  state: StateCache,
  projectId: string,
  suggestions: Suggestions,
  label?: (endpointId: string) => string,
): Promise<void> {
  const saved: SavedSuggestions = {
    specHash: suggestions.specHash,
    baskets: suggestions.baskets.map((basket) => ({
      name: basket.name,
      description: basket.description,
      endpoint_ids: basket.endpointIds,
      pattern_type: basket.patternType,
      tags: basket.tags,
      ...(label === undefined
        ? {}
        : { step_labels: basket.endpointIds.slice(0, SAVED_STEP_LABELS).map(label) }),
    })),
  };
  await state.set('suggestions', projectId, saved);
}

/** Two proposals never share a name: `flows_generate_from_suggestions` takes proposals by name. */
function withUniqueNames(suggestions: Suggestions): Suggestions {
  const used = new Set<string>();
  const baskets = suggestions.baskets.map((basket): Basket => {
    let name = basket.name;
    for (let n = 2; used.has(name); n += 1) name = `${basket.name} (${String(n)})`;
    used.add(name);
    return name === basket.name ? basket : { ...basket, name };
  });
  return { ...suggestions, baskets };
}

// ---- view data ------------------------------------------------------------------------

const labelOf = (endpoint: EndpointRef): string => {
  const summary = endpoint.summary?.trim() ?? '';
  return summary === '' ? `${endpoint.method} ${endpoint.path}` : summary;
};

async function present(
  ctx: ToolContext,
  projectId: string,
  suggestions: Suggestions,
  refined: boolean,
): Promise<SuggestionsData> {
  const endpoints = await listEndpoints(ctx, projectId);
  const labels = new Map(endpoints.map((endpoint) => [endpoint.id, labelOf(endpoint)]));
  const label = (id: string): string => labels.get(id) ?? id.slice(0, 8);
  // The proposals are saved before they are shown; the labels follow, so that a client that lists
  // the proposals (the mod's Path tab) has the steps without asking the backend.
  // Text from the backend that holds a registered secret is never written: the proposals stay as
  // they were saved, without labels.
  try {
    await remember(ctx.state, projectId, suggestions, label);
  } catch (error) {
    if (!(error instanceof ToolError) || error.code !== 'internal_secret_in_state') throw error;
  }
  return {
    suggestions: suggestions.baskets.map((basket) => ({
      name: basket.name,
      steps: basket.endpointIds.map(label),
      patternType: basket.patternType,
      ...(basket.confidence === undefined ? {} : { confidence: basket.confidence }),
      ...(basket.reasoning === undefined ? {} : { note: basket.reasoning }),
    })),
    more: 0,
    coverage: {
      covered: suggestions.covered,
      total: endpoints.length,
      uncovered: suggestions.uncoveredIds.slice(0, SHOWN_UNCOVERED).map(label),
      more: Math.max(0, suggestions.uncoveredIds.length - SHOWN_UNCOVERED),
    },
    failedUnits: suggestions.failedUnits,
    refined,
  };
}

// ---- the refinement as a long operation -------------------------------------------------

interface RefineState {
  /** `gone`: LoadCraft does not know the job (the channel said so); its result may still be cached. */
  readonly phase: 'running' | 'done' | 'failed' | 'cancelled' | 'gone';
  /** 0-100, as the backend counts. */
  readonly progress: number;
  readonly label?: string;
  readonly described?: number;
  readonly total?: number;
  readonly result?: Suggestions;
  readonly recoverable?: boolean;
}

const RUNNING: RefineState = { phase: 'running', progress: 0 };

/** The job is alive and nobody can watch it: it would be cancelled, so waiting would be a pretence. */
function channelNeeded(ctx: ToolContext): ToolError {
  return new ToolError('websocket_unavailable', {
    params: { advice: ctx.t('suggest.advice.noRefine') },
  });
}

/**
 * The result of refinement `id` read from the backend's cache (asking again without `force`). That
 * ask is a POST: when LoadCraft has neither the result nor the job, it starts a new, paid job. So
 * the job expired (LoadCraft cancelled it after 45 s without a watcher, or forgot it): a job this
 * call started is stopped at once, so a wait never leaves paid work behind, and the operation ends
 * as lost (its row says so and its payload goes in the write of the call), so that no later call
 * joins a job that is gone. A job somebody else runs is left alone.
 */
async function readCached(ctx: ToolContext, id: string, projectId: string): Promise<RefineState> {
  const answer = await startRefine(ctx, projectId);
  if (answer.kind === 'result') return { phase: 'done', progress: 100, result: answer.result };
  if (answer.jobId === id) throw channelNeeded(ctx);
  if (!answer.joined) await stopStrayJob(ctx, projectId, answer.jobId);
  endOperation(ctx, encodeHandle('refine', id), 'lost');
  // An abort during the stop (Esc) ends the call, but only after the stop was sent.
  if (ctx.signal.aborted) throw abortError(ctx.signal);
  throw new ToolError('refine_expired');
}

/** Longest the request that stops a stray job may take. */
const STOP_TIMEOUT_MS = 10_000;

/**
 * Stops a job this call started by mistake. The request does not carry the signal of the call: an
 * abort (Esc) must not leave paid work running; it has its own short time limit instead.
 */
async function stopStrayJob(ctx: ToolContext, projectId: string, jobId: string): Promise<void> {
  const limit = new AbortController();
  const timer = new AbortController();
  ctx.clock.sleep(STOP_TIMEOUT_MS, timer.signal).then(
    () => {
      limit.abort();
    },
    () => undefined,
  );
  try {
    await cancelRefine({ services: ctx.services, signal: limit.signal }, projectId, jobId);
    ctx.log.info('stopped a refinement started by mistake', { jobId });
  } catch (error) {
    ctx.log.warn('could not stop a refinement started by mistake', { error });
  } finally {
    timer.abort();
  }
}

export const refineOperation = defineOperationKind({
  kind: 'refine',
  saved: z.object({ projectId: z.string() }),
  initial: (): RefineState => RUNNING,
  channel: {
    name: 'refine',
    params: (id) => ({ job_id: id }),
    // The backend cancels a job that nobody watched for 45 s: reconnect inside 30 s or give up.
    reconnect: { attempts: 5, delaysMs: [500, 1500, 4000, 9000, 15_000] },
    reduce(state: RefineState, frame): RefineState {
      switch (frame.type) {
        case 'flow-suggestions-refine:progress': {
          const { progress, step_label: label, described, total } = frame.data;
          return {
            phase: 'running',
            progress,
            ...(label === undefined ? {} : { label }),
            ...(described == null ? {} : { described }),
            ...(total == null ? {} : { total }),
          };
        }
        case 'flow-suggestions-refine:complete':
          return { phase: 'done', progress: 100, result: parseSuggestions(frame.data.result) };
        case 'flow-suggestions-refine:error':
          if (frame.data.reason === 'job_not_found') return { phase: 'gone', progress: 0 };
          return {
            phase: 'failed',
            progress: state.progress,
            recoverable: frame.data.recoverable === true,
          };
        case 'flow-suggestions-refine:cancelled':
          return { phase: 'cancelled', progress: state.progress };
      }
    },
  },
  // The result of a finished job is in the backend's cache: asking again without `force` returns
  // it. A job still running is only reachable through its channel.
  recover: (ctx, id, saved): Promise<RefineState> => readCached(ctx, id, saved.projectId),
  cancel: (ctx, id, saved) => cancelRefine(ctx, saved.projectId, id),
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) =>
    state.phase === 'failed' || state.phase === 'cancelled' ? state.phase : undefined,
  describe(state, t) {
    const fraction = Math.min(1, Math.max(0, state.progress / 100));
    if (state.label === undefined) {
      return { message: t('suggest.progress.start'), fraction };
    }
    if (state.described === undefined || state.total === undefined) {
      return { message: t('suggest.progress.label', { label: state.label }), fraction };
    }
    return {
      message: t('suggest.progress.step', {
        label: state.label,
        described: state.described,
        total: state.total,
      }),
      fraction,
    };
  },
  async finish(ctx, id, reported, saved) {
    // The channel does not know the job: its result may still be in the cache, or it expired.
    const state = reported.phase === 'gone' ? await readCached(ctx, id, saved.projectId) : reported;
    switch (state.phase) {
      case 'done': {
        const result = withUniqueNames(
          state.result ?? {
            baskets: [],
            covered: 0,
            uncoveredIds: [],
            failedUnits: [],
            specHash: null,
          },
        );
        await remember(ctx.state, saved.projectId, result);
        return { status: 'done' as const, data: await present(ctx, saved.projectId, result, true) };
      }
      case 'failed':
        throw new ToolError('refine_failed', {
          params: {
            advice: ctx.t(
              state.recoverable === true ? 'suggest.advice.retry' : 'suggest.advice.noRefine',
            ),
          },
        });
      case 'cancelled':
      case 'running':
      case 'gone':
        throw new ToolError('refine_cancelled');
    }
  },
  view: renderSuggestJourneys,
});

/**
 * Runs the operation; when REST finds the job alive but the channel cannot be used, the channel is
 * tried once more (a short network break), then the call says so instead of waiting for a job
 * that LoadCraft is about to cancel.
 */
async function awaitRefine(ctx: ToolContext, jobId: string, projectId: string, maxWaitS: number) {
  const startedAt = ctx.clock.now();
  for (let attempt = 0; ; attempt += 1) {
    const left = Math.max(0, callWaitS(maxWaitS) - (ctx.clock.now() - startedAt) / 1000);
    try {
      return await awaitOperation(ctx, refineOperation, jobId, {
        maxWaitS: left,
        saved: { projectId },
      });
    } catch (error) {
      const again =
        attempt < REJOINS && error instanceof ToolError && error.code === 'websocket_unavailable';
      if (!again) throw error;
    }
  }
}

export const flowsSuggestJourneys = defineTool({
  name: 'flows_suggest_journeys',
  title: 'Suggest user journeys',
  description:
    "Journey proposals, flow candidates: proposes user journeys from the project's API " +
    'documentation (OpenAPI), first with a free heuristic, then (refine: true, the default) ' +
    'refined by a model, which can take minutes on a large API while the call stays open and ' +
    'reports progress. Saves the proposals so flows_generate_from_suggestions can build them by name. It does not ' +
    'create flows and does not change the documentation.',
  input,
  // Costly in the catalog (a model call, a stored result): never a free read for a client.
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await getCompat(ctx);
    const { id } = await createResolver(ctx).project(args.project?.trim() ?? '');
    const heuristic = withUniqueNames(await getHeuristicSuggestions(ctx, id));
    // Kept even if the refinement fails: flows_generate_from_suggestions can already use these.
    await remember(ctx.state, id, heuristic);
    if (!args.refine) {
      return { status: 'done', data: await present(ctx, id, heuristic, false) };
    }
    // A refinement of this project that is still running is joined: no second paid job.
    const running = findRunning(ctx, refineOperation, (saved) => saved.projectId === id);
    if (running !== undefined) return awaitRefine(ctx, running, id, args.max_wait_s);
    const answer = await startRefine(ctx, id, { force: args.force });
    if (answer.kind === 'result') {
      const result = withUniqueNames(answer.result);
      await remember(ctx.state, id, result);
      return { status: 'done', data: await present(ctx, id, result, true) };
    }
    return awaitRefine(ctx, answer.jobId, id, args.max_wait_s);
  },
  render: renderSuggestJourneys,
});
