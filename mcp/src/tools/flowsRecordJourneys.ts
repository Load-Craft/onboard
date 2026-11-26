// `flows_record_journeys`: the approval of the plan `flows_describe_journeys` returned, and the walk that follows.
// LoadCraft's browser walks the approved paths one after another and records the API calls of
// each; the flows are saved once, when the last path ends. The approval goes on the run's channel
// (REST has no way to send it), with the chosen paths exactly as the planner proposed them; a run
// whose walk has begun is followed without sending anything. The call waits at most 100 s and then
// returns the handle of the run (`record_run:<id>`) for `process_wait`. When the agent asks for help, the
// call ends with `needs_user` and the link of the live preview: only the creator of the run can take
// over the browser there, and this server never connects to that preview.

import * as z from 'zod';

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { requireCapability } from '../http/compat.js';
import {
  awaitOperation,
  encodeHandle,
  findAllRunning,
  maxWaitInput,
  parseHandle,
} from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { inline } from '../render/primitives.js';
import { renderRecordRun } from '../render/views/recordFlows.js';
import { planHandle, recordRunOperation, type RecordRunSaved } from './flowsDescribeJourneys.js';
import { respondWalk, type WalkSaved } from './recordWalk.js';

const ADVICE =
  'Update the LoadCraft server, or record the journeys in a browser and use flows_import_har.';
/** Longest name taken into an error. */
const MAX_NAME = 60;
/** Path names an error lists. */
const SHOWN_NAMES = 10;
/** A plan is found however long ago `flows_describe_journeys` returned it. */
const ANY_AGE = Number.POSITIVE_INFINITY;
const SHORT_HANDLE = /^r-([0-9a-f]{8})$/iu;

const input = z.strictObject({
  plan: z
    .string()
    .trim()
    .min(1)
    .describe(
      'The plan handle flows_describe_journeys returned (r-xxxxxxxx); its operation handle (record_run:<id>) works too.',
    ),
  paths: z
    .union([z.literal('all'), z.array(z.string().trim().min(1)).min(1)])
    .default('all')
    .describe(
      'Paths of the plan to record: "all", or the names of the ones the user chose, as the plan shows them.',
    ),
  max_wait_s: maxWaitInput('the walk of the paths'),
});

const quoted = (name: string): string => `"${inline(name, MAX_NAME)}"`;
const nameKey = (name: string): string => name.trim().toLowerCase();

/** The run of the plan this workspace recorded, by its short handle, operation handle or id. */
function findPlan(ctx: ToolContext, given: string): { id: string; saved: RecordRunSaved } {
  const short = SHORT_HANDLE.exec(given)?.[1]?.toLowerCase();
  let wanted: (id: string) => boolean;
  if (short !== undefined) {
    wanted = (id) => id.toLowerCase().startsWith(short);
  } else if (given.includes(':')) {
    const handle = parseHandle(given);
    wanted = (id) => handle.kind === 'record_run' && id === handle.id;
  } else {
    wanted = (id) => id.toLowerCase() === given.toLowerCase();
  }
  const found = findAllRunning(ctx, recordRunOperation, () => true, ANY_AGE)
    .filter((run) => wanted(run.id))
    .at(-1);
  if (found === undefined) {
    throw new ToolError('operation_unknown', { params: { value: inline(given, 120) } });
  }
  return found;
}

function nameOf(path: Readonly<Record<string, unknown>>): string {
  return typeof path['name'] === 'string' ? path['name'] : '';
}

function stepCount(path: Readonly<Record<string, unknown>>): number {
  const steps = path['steps'];
  return Array.isArray(steps) ? steps.length : 0;
}

/** The paths of the plan the call asked for, in the order of the plan, as the planner wrote them. */
function choosePaths(
  ctx: ToolContext,
  plan: string,
  proposed: readonly Readonly<Record<string, unknown>>[],
  wanted: 'all' | readonly string[],
): Readonly<Record<string, unknown>>[] {
  if (wanted === 'all') return [...proposed];
  const known = new Set(proposed.map((path) => nameKey(nameOf(path))));
  const unknown = wanted.filter((name) => !known.has(nameKey(name)));
  if (unknown.length > 0) {
    const shown = proposed.slice(0, SHOWN_NAMES).map((path) => quoted(nameOf(path)));
    const more = proposed.length - shown.length;
    throw new ToolError('record_unknown_paths', {
      params: {
        plan,
        names: unknown.map(quoted).join(', '),
        available:
          more > 0
            ? ctx.t('record.unknownPaths.more', { names: shown.join(', '), count: more })
            : shown.join(', '),
      },
    });
  }
  const picked = new Set(wanted.map(nameKey));
  return proposed.filter((path) => picked.has(nameKey(nameOf(path))));
}

/** A refused handshake of the run's channel, which the walk cannot go on without. */
function channelRefusal(error: unknown, link: string, ctx: ToolContext): ToolError | undefined {
  if (!(error instanceof LoadcraftApiError)) return undefined;
  const { details } = error;
  const fromChannel =
    typeof details === 'object' &&
    details !== null &&
    'channel' in details &&
    details.channel === 'describe';
  if (!fromChannel) return undefined;
  const reason = ctx.t(`describe.refusal.${error.code}`);
  return new ToolError('describe_channel_refused', { params: { reason, link }, cause: error });
}

export const flowsRecordJourneys = defineTool({
  name: 'flows_record_journeys',
  title: 'Approve and record flows from a description',
  description:
    'Flows from a description, approval and browser walk: approves the plan flows_describe_journeys ' +
    "returned (all paths, or the ones the user chose) and follows LoadCraft's browser as it " +
    'walks each path and records its API calls. The flows are saved once, at the end: the result ' +
    'gives the state of every path and the saved flows with their links, or the handle ' +
    '(record_run:<id>) to pass to wait. When the agent asks for help (a one-time code, a ' +
    'CAPTCHA) it returns needs_user with the live preview link: only the user who started the ' +
    'run can take over the browser, in the LoadCraft app. It does not plan paths ' +
    '(flows_describe_journeys does), and the approval needs the WebSocket channel to LoadCraft.',
  input,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async run(ctx, args) {
    await requireCapability(ctx.services.http, 'api_token_sockets', ADVICE);
    const { id, saved } = findPlan(ctx, args.plan);
    const plan = planHandle(id);
    if (saved.plan === undefined) {
      throw new ToolError('plan_not_ready', {
        params: { plan, operation: encodeHandle('record_run', id) },
      });
    }
    const { proposed } = saved.plan;
    const chosen = choosePaths(ctx, plan, proposed, args.paths);
    const walk: WalkSaved = {
      names: chosen.map(nameOf),
      steps: Object.fromEntries(proposed.map((path) => [nameOf(path), stepCount(path)])),
    };
    // The approval is this call's alone: it is never saved, so no later call can send it.
    const approval = chosen.map((path) => ({ ...path }));
    try {
      return await awaitOperation(ctx, recordRunOperation, id, {
        maxWaitS: args.max_wait_s,
        saved: { ...saved, walk },
        respond: (state, frame) =>
          state.phase === 'walk' ? respondWalk(frame, approval) : undefined,
      });
    } catch (error) {
      const link = ctx.services.links.describeRun(saved.projectId, id).url;
      throw channelRefusal(error, link, ctx) ?? error;
    }
  },
  render: renderRecordRun,
});
