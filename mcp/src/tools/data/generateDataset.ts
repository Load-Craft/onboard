// `data_generate_dataset` (module data): Generate and save a dataset with AI for a flow, a scenario
// or one data slot.
// On the consent card and the block of a long operation (docs/consent-card.md, docs/long-operation.md). The first
// call reads the target and makes the card (what is generated, for what, how many rows, the cost); a repeat with the
// same arguments asks the person; only their yes sends the request. One target per call: a flow, a scenario, or one
// slot of a scenario (no default from the state beyond the only flow or scenario of the workspace).
// - a flow: `POST …/feeders/generate-async` starts a run; its progress and the id of the dataset come on the channel
//   `gatlingFeeder`. The backend names the run in the answer to that request, so the channel is joined after the start
//   and frames sent before are lost; when the `complete` frame is lost the dataset is found in the list (a new one of
//   the requested name that appeared after the start). A run is an operation (`dataset_generation:<run_id>`) for
//   `process_wait`; the backend cannot stop it, so `process_cancel` does not apply.
// - a scenario: `POST …/feeders/generate-from-scenario`, one request, the dataset at once.
// - a slot: `POST …/scenarios/{id}/slots/{slot}/generate-feeder`, one request; LoadCraft names that dataset itself.
// The synchronous `POST …/feeders/generate` is not used: a run lost with its channel would leave a second dataset.
// The names, the columns and the cause of a failure are third-party text (`content`); the cells are never read.
// Log: args "Generate a dataset with AI for {target}", result "dataset {name}: {rows} rows": the log values carry
// both; the undo is `data_delete` of the new dataset (`undo_args`).
// State: the dataset is added to `ids.dataset_ids`; the row of the operation is the mechanism's.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import {
  cardViewGenerateDataset,
  isGenerateStep,
  renderGenerateDataset,
  renderGenerateProgress,
  type GenerateDatasetData,
  type GenerateDatasetFacts,
  type GenerateKind,
  type GenerateStep,
} from '../../render/data/generateDataset.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refIdOrNone,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { defineOperationKind, renderOperation, startOperation } from '../kit/operation.js';
import { moduleTool } from '../moduleTool.js';
import { listFeeders } from './listDatasets.js';
import { getFeeder } from './updateDataset.js';
import { DATA_GENERATE_DATASET } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/feeders/generate-async (REST API v1) */
export function generateFeederAsync(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post'>,
): Promise<
  OpOutput<'generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post'>
> {
  return callBackend(
    ctx,
    'generate_feeder_async_api_v1_projects__project_id__gatling_feeders_generate_async_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/feeders/generate (REST API v1) */
export function generateFeederData(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'generate_feeder_data_api_v1_projects__project_id__gatling_feeders_generate_post'>,
): Promise<
  OpOutput<'generate_feeder_data_api_v1_projects__project_id__gatling_feeders_generate_post'>
> {
  return callBackend(
    ctx,
    'generate_feeder_data_api_v1_projects__project_id__gatling_feeders_generate_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/feeders/generate-from-scenario (REST API v1) */
export function generateFeederFromScenario(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post'>,
): Promise<
  OpOutput<'generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post'>
> {
  return callBackend(
    ctx,
    'generate_feeder_from_scenario_api_v1_projects__project_id__gatling_feeders_generate_from_scenario_post',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/scenarios/{scenario_id}/slots/{slot}/generate-feeder (REST API v1) */
export function generateSlotFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string; readonly slot: string },
  body: BodyOf<'generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post'>,
): Promise<
  OpOutput<'generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post'>
> {
  return callBackend(
    ctx,
    'generate_slot_feeder_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots__slot__generate_feeder_post',
    { path, body },
  );
}

const NAME_LIMIT = 120;
const COLUMNS_SHOWN = 20;
/** A run not seen to end, and no dataset of its name found, is given up on after this long. */
const GIVE_UP_MS = 10 * 60_000;

// ---- the operation (a flow) ----------------------------------------------------------------

const saved = z.object({
  projectId: z.string().min(1).max(64),
  flowId: z.string().min(1).max(64),
  /** The name of the flow, masked: it fills the `{target}` of the log entry. */
  target: z.string().max(200),
  /** The name asked for: the dataset of that name that appears after the start is the result. */
  name: z.string().min(1).max(200),
  rows: z.number().int().min(1),
  startedAt: z.number(),
});
type Saved = z.infer<typeof saved>;

interface RunState {
  readonly phase: 'running' | 'done' | 'failed';
  readonly percent: number;
  readonly step: GenerateStep | null;
  readonly feederId?: string;
  readonly cause?: string;
}

const RUNNING: RunState = { phase: 'running', percent: 0, step: null };

/** The dataset a run left in the list: a new one of the requested name, created after the start. */
async function savedByRun(ctx: CallContext, run: Saved): Promise<string | undefined> {
  const { feeders } = await listFeeders(ctx, { project_id: run.projectId });
  return feeders
    .filter(
      (feeder) => feeder.name === run.name && Date.parse(feeder.created_at ?? '') >= run.startedAt,
    )
    .at(-1)?.id;
}

export const datasetGenerationOperation = defineOperationKind<
  RunState,
  GenerateDatasetData,
  Saved,
  'gatlingFeeder'
>({
  kind: 'dataset_generation',
  saved,
  initial: (): RunState => RUNNING,
  channel: {
    name: 'gatlingFeeder',
    params: (id) => ({ run_id: id }),
    reduce(state: RunState, frame): RunState {
      switch (frame.type) {
        case 'gatling-feeder:progress': {
          const step = frame.data.current_step;
          return {
            ...state,
            percent: Math.max(state.percent, frame.data.progress),
            step: step !== undefined && isGenerateStep(step) ? step : state.step,
          };
        }
        case 'gatling-feeder:complete':
          return { ...state, phase: 'done', percent: 100, feederId: frame.data.feeder_id };
        case 'gatling-feeder:error':
          return { ...state, phase: 'failed', cause: frame.data.error };
      }
    },
  },
  recoverIsRead: true,
  // Frames before the connect are lost, and the answer of the request names the run: the list of datasets is the
  // trace of a run that ended well.
  async recover(ctx, _id, run): Promise<RunState> {
    const feederId = await savedByRun(ctx, run);
    if (feederId !== undefined) return { phase: 'done', percent: 100, step: null, feederId };
    if (ctx.clock.now() - run.startedAt >= GIVE_UP_MS) {
      return { phase: 'failed', percent: 0, step: null, cause: 'the backend lost the run' };
    }
    return RUNNING;
  },
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) => (state.phase === 'failed' ? 'failed' : undefined),
  describe: (state, t) => ({
    message: renderGenerateProgress({ step: state.step, percent: state.percent }, t),
    fraction: Math.min(1, Math.max(0, state.percent / 100)),
  }),
  finish: (ctx, _id, state, run) =>
    Promise.resolve().then(async () => {
      if (state.phase === 'failed') {
        throw new ToolError('data_generate_failed', {
          params: { cause: thirdParty(ctx, state.cause ?? 'unknown', 200) },
        });
      }
      const feederId = state.feederId ?? (await savedByRun(ctx, run));
      if (feederId === undefined) {
        throw new ToolError('data_generate_failed', { params: { cause: 'no dataset was saved' } });
      }
      const feeder = await getFeeder(ctx, { project_id: run.projectId, feeder_id: feederId });
      return doneOf(ctx, 'flow', run.flowId, run.target, run.rows, feeder);
    }),
  view: renderGenerateDataset,
});

// ---- the result --------------------------------------------------------------------------------

type FeederAnswer =
  OpOutput<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>;

/** The result of a generation, from the dataset the backend made; its cells are never read. */
function doneOf(
  ctx: CallContext,
  kind: GenerateKind,
  targetId: string,
  target: string,
  asked: number,
  feeder: FeederAnswer,
  created: boolean | null = null,
): DoneOutcome<GenerateDatasetData> {
  const data: GenerateDatasetData = {
    kind,
    target_id: targetId,
    dataset_id: feeder.id,
    name: thirdParty(ctx, feeder.name, NAME_LIMIT),
    rows: feeder.record_count,
    rows_requested: asked,
    columns: feeder.columns
      .slice(0, COLUMNS_SHOWN)
      .map((column) => thirdParty(ctx, column, LIMITS.label)),
    column_count: feeder.columns.length,
    created,
  };
  return {
    status: 'done',
    data,
    update: {
      add: { dataset_ids: [feeder.id] },
      log: {
        values: { target, name: data.name, rows: data.rows },
        undo_args: { dataset_id: feeder.id },
      },
    },
  };
}

// ---- the tool ----------------------------------------------------------------------------------

export const dataGenerateDataset = moduleTool(DATA_GENERATE_DATASET, {
  title: 'Generate and save a dataset with AI for a flow',
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Generate for a flow: the data its steps need (give this or scenario_id).'),
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Generate for a scenario, or (with slot) for one of its data slots.'),
    slot: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('One data slot of the scenario (with scenario_id).'),
    rows: z.number().int().min(1).max(100000).default(100).describe('How many rows to generate.'),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The name of the new dataset; default: made from the target.'),
    feeder_type: z
      .enum(['csv', 'tsv', 'json'])
      .default('csv')
      .describe('The file format of the dataset (not for a slot).'),
    enrich_with_llm: z
      .boolean()
      .default(true)
      .describe('A slot only: let a model enrich the values (a cost).'),
  },
  async card(ctx, args) {
    if (args.flow_id !== undefined && args.scenario_id !== undefined)
      refuseRule('generate_one_target');
    if (args.slot !== undefined && args.flow_id !== undefined) {
      refuseRule('generate_slot_needs_scenario');
    }
    if (args.slot !== undefined && args.name !== undefined) refuseRule('generate_slot_name');
    const projectId = projectIdOf(ctx, undefined);
    const resolver = createResolver(ctx);
    const flowRef =
      args.scenario_id !== undefined || args.slot !== undefined
        ? undefined
        : refIdOrNone(ctx, 'flow_id', args.flow_id, 'ids.flow_ids');
    const scenarioRef =
      flowRef !== undefined
        ? undefined
        : refIdOrNone(ctx, 'scenario_id', args.scenario_id, 'ids.scenario_ids');
    if (flowRef === undefined && scenarioRef === undefined) {
      throw new ToolError('missing_argument', {
        params: { name: args.slot === undefined ? 'flow_id' : 'scenario_id' },
      });
    }
    const kind: GenerateKind =
      flowRef !== undefined ? 'flow' : args.slot === undefined ? 'scenario' : 'slot';
    const handle =
      flowRef !== undefined
        ? await resolver.flow(projectId, flowRef)
        : await resolver.scenario(projectId, scenarioRef ?? '');
    const target = thirdParty(ctx, handle.name, NAME_LIMIT);
    const facts: GenerateDatasetFacts = {
      kind,
      target_id: handle.id,
      target,
      ...(args.slot === undefined ? {} : { slot: thirdParty(ctx, args.slot, LIMITS.label) }),
      rows: args.rows,
      name:
        args.name === undefined
          ? `AI data for ${target}`.slice(0, 200)
          : thirdParty(ctx, args.name.trim(), 200),
      feeder_type: args.feeder_type,
      ...(kind === 'slot' ? { enrich_with_llm: args.enrich_with_llm } : {}),
    };
    return { facts };
  },
  cardView: cardViewGenerateDataset,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    if (facts.kind === 'flow') {
      return startOperation(ctx, datasetGenerationOperation, {
        matches: (run) =>
          run.projectId === projectId &&
          run.flowId === facts.target_id &&
          run.name === facts.name &&
          run.rows === facts.rows,
        async start() {
          const started = await generateFeederAsync(
            ctx,
            { project_id: projectId },
            {
              name: facts.name,
              feeder_type: facts.feeder_type,
              record_count: facts.rows,
              override_record_count: true,
              flow_id: facts.target_id,
            },
          );
          return {
            id: started.run_id,
            saved: {
              projectId,
              flowId: facts.target_id,
              target: facts.target,
              name: facts.name,
              rows: facts.rows,
              startedAt: ctx.clock.now(),
            },
          };
        },
      });
    }
    if (facts.kind === 'scenario') {
      const feeder = await generateFeederFromScenario(
        ctx,
        { project_id: projectId },
        {
          scenario_id: facts.target_id,
          name: facts.name,
          output_type: facts.feeder_type,
          row_count: facts.rows,
        },
      );
      return doneOf(ctx, 'scenario', facts.target_id, facts.target, facts.rows, feeder);
    }
    const slot = facts.slot ?? args.slot ?? '';
    const made = await generateSlotFeeder(
      ctx,
      { project_id: projectId, scenario_id: facts.target_id, slot },
      { row_count: facts.rows, enrich_with_llm: facts.enrich_with_llm ?? true },
    );
    return doneOf(
      ctx,
      'slot',
      facts.target_id,
      facts.target,
      facts.rows,
      made,
      made.created ?? null,
    );
  },
  render: renderOperation(datasetGenerationOperation),
});
