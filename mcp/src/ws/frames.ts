/**
 * Frames of the six WebSocket channels the plugin uses.
 *
 * The schemas below are written by hand from `contracts/ws-frames.json`, which is the
 * contract; `test/ws.frames.test.ts` checks that both lists agree (frames, keys, required
 * and nullable flags, envelope). Schemas list only the keys the plugin reads. Other keys
 * are allowed and kept (`z.looseObject`), and a frame type the contract does not list is
 * not an error: `parseFrame` reports it as `{kind: 'unknown'}`.
 */
import * as z from 'zod';

import { readsTable, sendsTable } from '../contract/reads.js';

export const CHANNELS = ['refine', 'batch', 'scenario', 'analysis', 'har', 'describe'] as const;
export type Channel = (typeof CHANNELS)[number];

const str = z.string();
const int = z.number().int();
const bool = z.boolean();
const obj = z.looseObject({});

// ---- refine: /ws/flow-suggestions-refine/{job_id} -------------------------------------

const refineServer = readsTable<'refine'>()({
  'flow-suggestions-refine:progress': z.looseObject({
    job_id: str,
    status: str,
    progress: int,
    current_step: str.optional(),
    step_label: str.optional(),
    described: int.nullish(),
    total: int.nullish(),
  }),
  'flow-suggestions-refine:complete': z.looseObject({
    job_id: str,
    status: str,
    result: obj,
  }),
  'flow-suggestions-refine:error': z.looseObject({
    job_id: str,
    error: str.nullable(),
    recoverable: bool.nullish(),
    reason: str.nullish(),
  }),
  'flow-suggestions-refine:cancelled': z.looseObject({ job_id: str }),
});

// ---- batch: /ws/batch-generation/{run_id} ---------------------------------------------

const batchServer = readsTable<'batch'>()({
  'batch-generation:basket-progress': z.looseObject({
    basket_id: str,
    step_label: str.optional(),
    progress: int.optional(),
  }),
  'batch-generation:basket-complete': z.looseObject({
    basket_id: str,
    flow_id: str,
    flow_name: str.optional(),
    needs_input: z.array(z.unknown()).nullish(),
  }),
  'batch-generation:basket-error': z.looseObject({
    basket_id: str,
    error: str,
    retryable: bool.optional(),
  }),
  'batch-generation:complete': z.looseObject({
    success_count: int,
    failed_count: int,
  }),
  'batch-generation:error': z.looseObject({
    error: str.nullable(),
    recoverable: bool.nullish(),
    reason: str.nullish(),
    success_count: int.optional(),
    failed_count: int.optional(),
  }),
});

// ---- scenario: /ws/gatling-scenario/{run_id} ------------------------------------------

const scenarioServer = readsTable<'scenario'>()({
  'gatling-scenario:progress': z.looseObject({
    progress: int,
    current_step: str.optional(),
    step_label: str.optional(),
    planner_path: str.optional(),
    planner_path_reason: str.optional(),
  }),
  'gatling-scenario:complete': z.looseObject({
    run_id: str.optional(),
    scenario_id: str,
  }),
  'gatling-scenario:error': z.looseObject({
    error: str,
    recoverable: bool.optional(),
    status_code: int.optional(),
  }),
  'gatling-scenario:cancelled': z.looseObject({ run_id: str.optional() }),
});

// ---- analysis: /ws/gatling-analysis/{run_id} ------------------------------------------

const analysisServer = readsTable<'analysis'>()({
  'gatling-analysis:progress': z.looseObject({
    progress: int,
    current_step: str.optional(),
    step_label: str.optional(),
  }),
  'gatling-analysis:complete': z.looseObject({
    run_id: str.optional(),
    analysis: obj,
  }),
  'gatling-analysis:error': z.looseObject({
    error: str,
    recoverable: bool.optional(),
  }),
});

// ---- har: /ws/projects/{pid}/har/{sid} ------------------------------------------------

const harPath = z.looseObject({
  name: str,
  steps: z.array(z.unknown()),
  depends_on_prior: bool.optional(),
  rationale: str.optional(),
});

const harServer = readsTable<'har'>()({
  'har:progress': z.looseObject({
    status: str.optional(),
    progress: int,
    current_step: str.optional(),
    step_label: str.optional(),
  }),
  split_proposal: z.looseObject({ proposed_paths: z.array(harPath) }),
  'har:complete': z.looseObject({
    session_id: str.optional(),
    status: str.optional(),
    flow_id: str.optional(),
    flow_name: str.optional(),
    flows: z.array(z.looseObject({ flow_id: str, flow_name: str })).nullish(),
  }),
  'har:error': z.looseObject({
    error: str,
    recoverable: bool.optional(),
  }),
  'har:cancelled': z.looseObject({ session_id: str.optional() }),
});

const harClient = sendsTable<'har'>()({
  'har:generate': z.looseObject({
    flow_name: str,
    action_groups: z.array(z.unknown()).optional(),
    rejected_correlations: z.array(z.unknown()).optional(),
    excluded_entry_indices: z.array(z.unknown()).optional(),
    auth_username: str.optional(),
    auth_password: str.optional(),
  }),
  split_resume: z.looseObject({
    paths: z.array(z.looseObject({ name: str, steps: z.array(z.unknown()) })),
  }),
  'har:cancel': z.looseObject({}),
});

// ---- describe: /ws/projects/{pid}/scenario-from-description/runs/{run_id} --------------

const describePath = z.looseObject({
  name: str,
  steps: z.array(z.unknown()),
  depends_on_prior: bool.optional(),
});

/** A proposed path also says whether it brings its own account (the shared sign-in skips it). */
const describeProposedPath = describePath.extend({ creates_own_identity: bool.optional() });

const describeServer = readsTable<'describe'>()({
  split_proposal: z.looseObject({
    proposed_paths: z.array(describeProposedPath),
    shared_sign_in: bool.optional(),
  }),
  drive_snapshot: z.looseObject({
    setup: str,
    paths: z.array(
      z.looseObject({
        path_index: int,
        name: str.optional(),
        state: str,
        stop_cause: str.nullish(),
        reason: str.nullish(),
        not_driven: bool.optional(),
      }),
    ),
  }),
  path_stage: z.looseObject({
    path_index: int,
    attempt: int.optional(),
    stage: str,
  }),
  path_done: z.looseObject({
    path_index: int,
    path_name: str.optional(),
  }),
  path_failed: z.looseObject({
    path_index: int,
    path_name: str.optional(),
    reason: str.optional(),
    attempt: int.optional(),
    will_retry: bool,
    not_driven: bool.optional(),
  }),
  agent_step: z.looseObject({
    step: z.looseObject({
      path_index: int,
      attempt: int.nullish(),
      step_number: int.nullish(),
      label: str,
      plan_step_index: int.nullish(),
      outcome: str,
      failure: str.nullish(),
    }),
  }),
  help_requested: z.looseObject({
    path_index: int,
    attempt: int.optional(),
    reason: str,
    agent_says: str.nullish(),
    expires_at: str.nullish(),
  }),
  control_returned: z.looseObject({
    path_index: int,
    attempt: int.optional(),
    reason: str,
    choice: str.nullish(),
    obstacle_kind: str.nullish(),
  }),
  stop_accepted: z.looseObject({
    reason: str.optional(),
    path_index: int.nullish(),
    attempt: int.nullish(),
  }),
  stop_refused: z.looseObject({ code: str }),
  split_resume_refused: z.looseObject({
    detail: z.looseObject({
      error: str.optional(),
      message: str.optional(),
      limit: int.optional(),
    }),
  }),
  message_denied: z.looseObject({
    message_type: str.nullish(),
    code: str,
  }),
  complete: z.looseObject({ result: obj }),
  error: z.looseObject({
    error: str,
    node: str.nullish(),
    technical: str.nullish(),
  }),
  cancelled: z.looseObject({}),
  interrupted: z.looseObject({ error: str.nullish() }),
});

const describeClient = sendsTable<'describe'>()({
  split_resume: z.looseObject({ paths: z.array(describePath) }),
  stop: z.looseObject({}),
});

// ---- registries -----------------------------------------------------------------------

const serverSchemas = {
  refine: refineServer,
  batch: batchServer,
  scenario: scenarioServer,
  analysis: analysisServer,
  har: harServer,
  describe: describeServer,
} as const;

const clientSchemas = {
  refine: {},
  batch: {},
  scenario: {},
  analysis: {},
  har: harClient,
  describe: describeClient,
} as const;

type SchemaTable = Record<Channel, Record<string, z.ZodType>>;

/** Schema of the keys of every server frame, by channel and wire `type`. */
export const SERVER_SCHEMAS: SchemaTable = serverSchemas;
/** Schema of the keys of every client message the plugin sends, by channel and wire `type`. */
export const CLIENT_SCHEMAS: SchemaTable = clientSchemas;

/** Channel default; `split_proposal` of the HAR channel is the one flat frame on an enveloped channel. */
const CHANNEL_ENVELOPE: Record<Channel, 'payload' | 'flat'> = {
  refine: 'payload',
  batch: 'payload',
  scenario: 'payload',
  analysis: 'payload',
  har: 'payload',
  describe: 'flat',
};
const FLAT_OVERRIDES: Partial<Record<Channel, readonly string[]>> = {
  har: ['split_proposal'],
};

/** Whether a server frame carries its keys under `payload` or next to `type`. */
export function frameEnvelope(channel: Channel, type: string): 'payload' | 'flat' {
  return FLAT_OVERRIDES[channel]?.includes(type) === true ? 'flat' : CHANNEL_ENVELOPE[channel];
}

// ---- parsing --------------------------------------------------------------------------

export type ParsedFrame<C extends Channel = Channel> = C extends Channel
  ? {
      [T in keyof (typeof serverSchemas)[C] & string]: {
        kind: 'frame';
        channel: C;
        type: T;
        /** The frame's keys: the payload of an enveloped frame, the frame without `type` otherwise. */
        data: z.infer<(typeof serverSchemas)[C][T]>;
      };
    }[keyof (typeof serverSchemas)[C] & string]
  : never;

export interface UnknownFrame {
  kind: 'unknown';
  type: string;
}

/** A frame that is not one, or a known frame whose required key is missing or mistyped. */
export class FrameParseError extends Error {
  constructor(
    readonly channel: Channel,
    /** Wire `type` of the frame, `''` when the input has none. */
    readonly frameType: string,
    /** Dotted path of the offending key, `''` when the whole input is at fault. */
    readonly field: string,
    detail: string,
  ) {
    const where = field === '' ? '' : `, field "${field}"`;
    const what = frameType === '' ? 'frame' : `frame "${frameType}"`;
    super(`Channel "${channel}", ${what}${where}: ${detail}`);
    this.name = 'FrameParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(channel: Channel, raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new FrameParseError(channel, '', '', 'the text is not valid JSON');
    }
  }
  if (!isRecord(value)) {
    throw new FrameParseError(channel, '', '', 'a frame must be a JSON object');
  }
  return value;
}

/**
 * Reads one server frame of `channel`. Returns the frame with its keys typed, or
 * `{kind: 'unknown', type}` for a type the contract does not list (the backend may add
 * frames). Throws `FrameParseError` when the input is not a frame or a required key is
 * missing or of the wrong type.
 */
export function parseFrame<C extends Channel>(
  channel: C,
  raw: unknown,
): ParsedFrame<C> | UnknownFrame {
  const frame = decode(channel, raw);
  const type = frame['type'];
  if (typeof type !== 'string' || type === '') {
    throw new FrameParseError(channel, '', 'type', 'missing or not a string');
  }
  const schema = SERVER_SCHEMAS[channel][type];
  if (schema === undefined) return { kind: 'unknown', type };

  const enveloped = frameEnvelope(channel, type) === 'payload';
  const payload = frame['payload'];
  if (enveloped && !isRecord(payload)) {
    throw new FrameParseError(channel, type, 'payload', 'missing or not an object');
  }
  const body = enveloped
    ? payload
    : Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'type'));

  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = (issue?.path ?? []).map(String).join('.');
    const field = enveloped ? ['payload', path].filter((p) => p !== '').join('.') : path;
    const detail =
      issue?.code === 'invalid_type' && issue.input === undefined
        ? 'required key is missing'
        : (issue?.message ?? 'invalid');
    throw new FrameParseError(channel, type, field, detail);
  }
  return { kind: 'frame', channel, type, data: result.data } as ParsedFrame<C>;
}
