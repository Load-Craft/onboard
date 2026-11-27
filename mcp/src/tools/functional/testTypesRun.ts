// The AI run on the test types of a project, as a long operation (docs/long-operation.md): the kind
// `test_types_generation` shared by `functional_suggest_test_types` and `functional_generate_test_types`.
// Both start with an async POST that answers a `run_id`; the channel `testTypes` (`/ws/test-types/{run_id}`)
// sends the progress and the result, sends nothing on connect and replays nothing, so a frame sent before
// the socket joined is lost; the result is then read through REST (`GET …/test-types/suggest/{run_id}`,
// which holds the outcome of both modes). The run cannot be stopped (the channel takes no client frame).
// The names and texts of the result are third-party text (`content`); the operation entry keeps the
// project, the mode and the start time, no text of the result.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import {
  isTestTypesStep,
  renderTestTypesProgress,
  renderTestTypesRun,
  type SuggestionView,
  type TestTypesMode,
  type TestTypesRunData,
  type TestTypesStep,
} from '../../render/functional/testTypesRun.js';
import { defineOperationKind } from '../kit/operation.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';

/** POST /projects/{project_id}/test-types/suggest-async (REST API v1) */
export function suggestTestTypesAsync(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'suggest_test_types_async_api_v1_projects__project_id__test_types_suggest_async_post'>,
): Promise<
  OpOutput<'suggest_test_types_async_api_v1_projects__project_id__test_types_suggest_async_post'>
> {
  return callBackend(
    ctx,
    'suggest_test_types_async_api_v1_projects__project_id__test_types_suggest_async_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/test-types/generate-async (REST API v1) */
export function generateTestTypesAsync(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'generate_test_types_async_api_v1_projects__project_id__test_types_generate_async_post'>,
): Promise<
  OpOutput<'generate_test_types_async_api_v1_projects__project_id__test_types_generate_async_post'>
> {
  return callBackend(
    ctx,
    'generate_test_types_async_api_v1_projects__project_id__test_types_generate_async_post',
    { path, body },
  );
}

/** GET /projects/{project_id}/test-types/suggest/{run_id} (REST API v1) */
export function getTestTypesRunResult(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
): Promise<
  OpOutput<'get_suggest_test_types_result_api_v1_projects__project_id__test_types_suggest__run_id__get'>
> {
  return callBackend(
    ctx,
    'get_suggest_test_types_result_api_v1_projects__project_id__test_types_suggest__run_id__get',
    { path },
  );
}

const NAME_LIMIT = 120;
const TEXT_LIMIT = 600;
const SHOWN = 20;
/** A run not seen to end within this long is given up on: the backend lost it. */
const GIVE_UP_MS = 15 * 60_000;

const saved = z.object({
  projectId: z.string().min(1).max(64),
  mode: z.enum(['suggest', 'generate']),
  startedAt: z.number(),
});
type Saved = z.infer<typeof saved>;

/** What the run produced, as the `complete` frame or the REST result says it (not yet masked). */
export interface RunResult {
  readonly suggestions: readonly Readonly<Record<string, unknown>>[];
  readonly total: number;
  readonly created: number;
  readonly skipped: number;
  readonly types: readonly Readonly<Record<string, unknown>>[];
  readonly rationale: string | null;
  readonly omitted: number;
}

interface RunState {
  readonly mode: TestTypesMode;
  readonly phase: 'running' | 'done' | 'failed';
  readonly percent: number;
  readonly step: TestTypesStep | null;
  readonly result?: RunResult;
  readonly cause?: string;
}

const running = (mode: TestTypesMode): RunState => ({
  mode,
  phase: 'running',
  percent: 0,
  step: null,
});

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): readonly Readonly<Record<string, unknown>>[] =>
  Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown, fallback = 0): number =>
  typeof value === 'number' ? value : fallback;
const maybeText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The result of the `complete` frame (the fields depend on the mode). */
function fromFrame(payload: Readonly<Record<string, unknown>>): RunResult {
  const suggestions = list(payload['suggestions']);
  return {
    suggestions,
    total: count(payload['total'], suggestions.length),
    created: count(payload['created']),
    skipped: count(payload['skipped']),
    types: list(payload['test_types']),
    rationale: maybeText(payload['rationale']),
    omitted: Array.isArray(payload['omitted_operations'])
      ? payload['omitted_operations'].length
      : 0,
  };
}

export const testTypesOperation = defineOperationKind<
  RunState,
  TestTypesRunData,
  Saved,
  'testTypes'
>({
  kind: 'test_types_generation',
  saved,
  initial: (_ctx, _id, run): RunState => running(run.mode),
  channel: {
    name: 'testTypes',
    params: (id) => ({ run_id: id }),
    reduce(state: RunState, frame): RunState {
      switch (frame.type) {
        case 'test-types:progress':
          return {
            ...state,
            percent: Math.max(state.percent, frame.data.progress),
            step: isTestTypesStep(frame.data.current_step) ? frame.data.current_step : state.step,
          };
        case 'test-types:complete':
          return {
            mode: state.mode,
            phase: 'done',
            percent: 100,
            step: state.step,
            result: fromFrame(frame.data),
          };
        case 'test-types:error':
          return { ...state, phase: 'failed', cause: frame.data.error };
      }
    },
  },
  recoverIsRead: true,
  // Frames are not replayed: the REST result holds the outcome of a run whose frames were missed.
  async recover(ctx, id, run): Promise<RunState> {
    const answer = await getTestTypesRunResult(ctx, { project_id: run.projectId, run_id: id });
    if (answer.status === 'failed') {
      return {
        mode: run.mode,
        phase: 'failed',
        percent: 0,
        step: null,
        cause: answer.error ?? 'unknown',
      };
    }
    if (answer.status === 'completed') {
      const generated = record(answer.result);
      const result =
        run.mode === 'generate'
          ? fromFrame({ ...generated, omitted_operations: generated['omitted_operations'] ?? [] })
          : fromFrame({
              suggestions: answer.suggestions ?? [],
              total: answer.total ?? undefined,
              omitted_operations: answer.omitted_operations ?? [],
            });
      return { mode: run.mode, phase: 'done', percent: 100, step: null, result };
    }
    if (ctx.clock.now() - run.startedAt >= GIVE_UP_MS) {
      return {
        mode: run.mode,
        phase: 'failed',
        percent: 0,
        step: null,
        cause: 'the backend lost the run',
      };
    }
    return running(run.mode);
  },
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) => (state.phase === 'failed' ? 'failed' : undefined),
  describe: (state, t) => ({
    message: renderTestTypesProgress(
      { step: state.step, percent: state.percent, mode: state.mode },
      t,
    ),
    fraction: Math.min(1, Math.max(0, state.percent / 100)),
  }),
  finish: (ctx, _id, state, run) => Promise.resolve().then(() => finished(ctx, state, run)),
  view: renderTestTypesRun,
});

function finished(ctx: CallContext, state: RunState, run: Saved): DoneOutcome<TestTypesRunData> {
  if (state.phase === 'failed') {
    throw new ToolError('functional_test_types_failed', {
      params: { cause: content(ctx, state.cause ?? 'unknown', 200) },
    });
  }
  const result = state.result;
  const shown = (value: unknown, max: number): string => content(ctx, text(value), max);
  const suggestions: SuggestionView[] = (result?.suggestions ?? []).slice(0, SHOWN).map((item) => ({
    name: shown(item['name'], NAME_LIMIT),
    display_name: shown(item['display_name'], NAME_LIMIT),
    category: shown(item['category'], 60),
    description: shown(item['description'], TEXT_LIMIT),
    expected_outcome:
      maybeText(item['expected_outcome']) === null ? null : shown(item['expected_outcome'], 60),
    input_prompt: shown(item['input_generation_prompt'], TEXT_LIMIT),
    examples: list(item['example_inputs']).length,
    rationale: shown(item['rationale'], TEXT_LIMIT),
  }));
  const types = (result?.types ?? []).slice(0, SHOWN).map((item) => ({
    id: text(item['id']),
    name: shown(item['effective_name'], NAME_LIMIT),
  }));
  const data: TestTypesRunData = {
    mode: run.mode,
    count: run.mode === 'suggest' ? (result?.total ?? 0) : (result?.created ?? 0),
    suggestions,
    total: result?.total ?? 0,
    created: result?.created ?? 0,
    skipped: result?.skipped ?? 0,
    created_types: types,
    rationale:
      result?.rationale === null || result === undefined
        ? null
        : shown(result.rationale, TEXT_LIMIT),
    omitted: result?.omitted ?? 0,
  };
  const only = data.created === 1 ? types[0] : undefined;
  return {
    status: 'done',
    data,
    update: {
      log: {
        ...(only === undefined ? {} : { undo_args: { kind: 'test_type', item_id: only.id } }),
      },
      ...(run.mode === 'generate'
        ? { checks: { functional: { test_types: { ok: data.created + data.skipped > 0 } } } }
        : {}),
    },
  };
}
