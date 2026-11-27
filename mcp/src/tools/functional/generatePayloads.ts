// `functional_generate_payloads` (module functional): Generate request payloads for flows and test types;
// saves the ZIP to a local file and returns its path.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the card, the kind and the start.
// Kind `process`, level 2, costly (docs/consent-card.md, docs/long-operation.md): call 1 reads the names of the
// flows and the test types and makes the card (what, how many cases, where the ZIP goes, the cost); the repeat
// with the same arguments asks the person; only their yes starts the run, once.
// The channel `payloadGen` (`/ws/payload-gen/{run_id}`) sends the progress and `complete`; nothing is sent on
// connect and nothing replayed, and the run id is known only after the start, so a frame sent before the
// socket joined is lost. The ZIP is fetched once (`GET …/generate-payloads/{run_id}/download`: a second fetch is
// a 404) and saved at once, by `finish`, under the first free name (`payloadFile.ts`: nothing is overwritten),
// never read: the model sees the path and the size. The run cannot be stopped (the channel takes no client
// frame). A run whose ZIP the REST way cannot give (404) is waited for until it is given up on.
// Log: args "Generate payloads for {n} flows", result "ZIP saved to {path}".
// Arguments (the catalog's): flow_ids (object: id -> {}), test_types (object: id -> cases 1-20), file.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewGeneratePayloads,
  isPayloadStep,
  renderPayloads,
  renderPayloadsProgress,
  type PayloadFacts,
  type PayloadsData,
  type PayloadStep,
} from '../../render/functional/payloads.js';
import { defineOperationKind, renderOperation, startOperation } from '../kit/operation.js';
import {
  callBackend,
  isUuid,
  projectIdOf,
  refuseRule,
  settleAll,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getTestFlow } from './getFlows.js';
import { getTestType } from './getTestTypes.js';
import { FUNCTIONAL_GENERATE_PAYLOADS } from './meta.generated.js';
import { checkPayloadFile, savePayloads } from './payloadFile.js';

/** POST /projects/{project_id}/generate-payloads-async (REST API v1) */
export function generatePayloadsAsync(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'generate_payloads_async_api_v1_projects__project_id__generate_payloads_async_post'>,
): Promise<
  OpOutput<'generate_payloads_async_api_v1_projects__project_id__generate_payloads_async_post'>
> {
  return callBackend(
    ctx,
    'generate_payloads_async_api_v1_projects__project_id__generate_payloads_async_post',
    { path, body },
  );
}

/** GET /projects/{project_id}/generate-payloads/{run_id}/download (REST API v1): the ZIP, served once. */
export function downloadGeneratedPayloads(
  ctx: CallContext,
  path: { readonly project_id: string; readonly run_id: string },
): Promise<
  OpOutput<'download_generated_payloads_api_v1_projects__project_id__generate_payloads__run_id__download_get'>
> {
  return callBackend(
    ctx,
    'download_generated_payloads_api_v1_projects__project_id__generate_payloads__run_id__download_get',
    { path },
  );
}

const NAME_LIMIT = 120;
const SHOWN = 20;
const MAX_ITEMS = 50;
/** A run whose ZIP is not served within this long is given up on: the backend lost it. */
const GIVE_UP_MS = 15 * 60_000;

// ---- the operation ----------------------------------------------------------------------

const saved = z.object({
  projectId: z.string().min(1).max(64),
  /** The file the call named (checked), else empty: the ZIP goes under `loadcraft/payloads/`. */
  file: z.string().max(300),
  flows: z.number().int().min(0),
  testTypes: z.number().int().min(0),
  cases: z.number().int().min(0),
  startedAt: z.number(),
});
type Saved = z.infer<typeof saved>;

interface PayloadState {
  readonly phase: 'running' | 'done' | 'failed';
  readonly percent: number;
  readonly step: PayloadStep | null;
  /** The ZIP, when a read through REST already took it (the channel only says it is ready). */
  readonly bytes?: Uint8Array;
  readonly cause?: string;
}

const RUNNING: PayloadState = { phase: 'running', percent: 0, step: null };

async function zipOf(ctx: CallContext, projectId: string, id: string): Promise<Uint8Array> {
  const blob = await downloadGeneratedPayloads(ctx, { project_id: projectId, run_id: id });
  return new Uint8Array(await blob.arrayBuffer());
}

export const payloadsOperation = defineOperationKind<
  PayloadState,
  PayloadsData,
  Saved,
  'payloadGen'
>({
  kind: 'payload_generation',
  saved,
  initial: (): PayloadState => RUNNING,
  channel: {
    name: 'payloadGen',
    params: (id) => ({ run_id: id }),
    reduce(state: PayloadState, frame): PayloadState {
      switch (frame.type) {
        case 'payload-gen:progress':
          return {
            ...state,
            percent: Math.max(state.percent, frame.data.progress),
            step: isPayloadStep(frame.data.current_step) ? frame.data.current_step : state.step,
          };
        case 'payload-gen:complete':
          return { ...state, phase: 'done', percent: 100 };
        case 'payload-gen:error':
          return { ...state, phase: 'failed', cause: frame.data.error };
      }
    },
  },
  // `recoverIsRead`: the read that takes the ZIP also marks it served, but the state keeps the bytes and the very
  // next step (`finish`) saves them, so a finished run is not reported as running again and again.
  recoverIsRead: true,
  // Frames are not replayed. The ZIP is the only thing REST gives, once; a 404 means still running, failed,
  // already served or unknown, which REST cannot tell apart: wait until the run is given up on.
  async recover(ctx, id, run): Promise<PayloadState> {
    try {
      return {
        phase: 'done',
        percent: 100,
        step: null,
        bytes: await zipOf(ctx, run.projectId, id),
      };
    } catch (error) {
      if (!(error instanceof LoadcraftApiError && error.status === 404)) throw error;
    }
    if (ctx.clock.now() - run.startedAt >= GIVE_UP_MS) {
      return { phase: 'failed', percent: 0, step: null, cause: 'the backend lost the run' };
    }
    return RUNNING;
  },
  isTerminal: (state) => state.phase !== 'running',
  ended: (state) => (state.phase === 'failed' ? 'failed' : undefined),
  describe: (state, t) => ({
    message: renderPayloadsProgress({ step: state.step, percent: state.percent }, t),
    fraction: Math.min(1, Math.max(0, state.percent / 100)),
  }),
  async finish(ctx, id, state, run) {
    if (state.phase === 'failed') {
      throw new ToolError('functional_payloads_failed', {
        params: { cause: thirdParty(ctx, state.cause ?? 'unknown', 200) },
      });
    }
    let bytes = state.bytes;
    if (bytes === undefined) {
      try {
        bytes = await zipOf(ctx, run.projectId, id);
      } catch (error) {
        if (error instanceof LoadcraftApiError && error.status === 404) {
          throw new ToolError('functional_payloads_lost');
        }
        throw error;
      }
    }
    const path = savePayloads(
      ctx.config.workspaceRoot,
      run.file === '' ? undefined : run.file,
      id,
      bytes,
    );
    const data: PayloadsData = {
      path,
      bytes: bytes.byteLength,
      flows: run.flows,
      test_types: run.testTypes,
      cases: run.cases,
    };
    return { status: 'done', data, update: { log: { values: { n: run.flows } } } };
  },
  view: renderPayloads,
});

// ---- the tool -----------------------------------------------------------------------------

const casesInput = z.number().int().min(1).max(20);

/** The ids of an object whose keys are ids: lower case, 1 to 50, each a UUID. */
function idsOf(given: Readonly<Record<string, unknown>>): string[] {
  const keys = Object.keys(given);
  if (keys.length < 1 || keys.length > MAX_ITEMS) refuseRule('payloads_items_count');
  if (!keys.every((key) => isUuid(key))) refuseRule('payloads_ids');
  return keys.map((key) => key.toLowerCase());
}

export const functionalGeneratePayloads = moduleTool(FUNCTIONAL_GENERATE_PAYLOADS, {
  title: 'Generate request payloads for flows and test types',
  input: {
    flow_ids: z
      .record(z.string(), z.strictObject({}))
      .describe('The flows to generate for (key: flow id; value: {}); 1-50.'),
    test_types: z
      .record(z.string(), casesInput)
      .describe(
        'The test types to use (key: test type id; value: number of cases per flow, 1-20); 1-50.',
      ),
    file: z
      .string()
      .min(1)
      .max(260)
      .optional()
      .describe(
        'Where to save the ZIP: a relative path inside the project directory; default: loadcraft/payloads/<run>.zip. Never overwrites a file.',
      ),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const flowIds = idsOf(args.flow_ids);
    const typeIds = idsOf(args.test_types);
    const file = checkPayloadFile(ctx.config.workspaceRoot, args.file);
    const shownFlows = flowIds.slice(0, SHOWN);
    const shownTypes = Object.entries(args.test_types).slice(0, SHOWN);
    const [flows, types] = await settleAll([
      settleAll(shownFlows.map((id) => getTestFlow(ctx, { flow_id: id }))),
      settleAll(
        shownTypes.map(([id]) =>
          getTestType(ctx, { project_id: projectId, test_type_id: id.toLowerCase() }),
        ),
      ),
    ]);
    // the rest are only counted: a flow or test type that does not exist is the backend's refusal at the start
    const perFlow = Object.values(args.test_types).reduce((sum, cases) => sum + cases, 0);
    const facts: PayloadFacts = {
      n: flowIds.length,
      flows: flows.map((flow) => thirdParty(ctx, flow.name, NAME_LIMIT)),
      types: types.map((type, at) => ({
        name: thirdParty(ctx, type.effective_name, NAME_LIMIT),
        cases: shownTypes[at]?.[1] ?? 0,
      })),
      types_count: typeIds.length,
      cases: flowIds.length * perFlow,
      ...(file === undefined ? {} : { file }),
    };
    return { facts };
  },
  cardView: cardViewGeneratePayloads,
  run: (ctx, args, facts) => {
    const projectId = projectIdOf(ctx, undefined);
    const flowIds = idsOf(args.flow_ids);
    const counts = Object.fromEntries(
      Object.entries(args.test_types).map(([id, cases]) => [id.toLowerCase(), cases]),
    );
    const typeIds = Object.keys(counts);
    return startOperation(ctx, payloadsOperation, {
      matches: (run) =>
        run.projectId === projectId &&
        run.flows === flowIds.length &&
        run.testTypes === typeIds.length &&
        run.cases === facts.cases &&
        run.file === (facts.file ?? ''),
      async start() {
        const answer = await generatePayloadsAsync(
          ctx,
          { project_id: projectId },
          { flow_ids: flowIds, test_type_ids: typeIds, test_counts: counts },
        );
        return {
          id: answer.run_id,
          saved: {
            projectId,
            file: facts.file ?? '',
            flows: flowIds.length,
            testTypes: typeIds.length,
            cases: facts.cases,
            startedAt: ctx.clock.now(),
          },
        };
      },
    });
  },
  render: renderOperation(payloadsOperation),
});
