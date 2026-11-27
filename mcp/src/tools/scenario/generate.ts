// `scenario_generate`: one scenario per flow, generated one after another (the compilations
// share one build cache), a composition of them with the requested weights, and the automatic
// self-check of every scenario. Every step can be repeated: a scenario that already exists for a
// flow with the same data mix is used again, so a call after a partial failure or after a handle
// was returned finishes the work without generating anything twice.

import { createHmac, randomBytes } from 'node:crypto';

import * as z from 'zod';

import {
  createComposition,
  findComposition,
  readCompositionMembers,
  replaceCompositionMembers,
  type CompositionMember,
  type MemberWrite,
} from '../../api/compositions.js';
import {
  cancelGeneration,
  listEnabledTestTypes,
  listScenarioSources,
  startScenarioGeneration,
  type ScenarioSource,
  type TestTypeRef,
} from '../../api/scenarios.js';
import { listFlows } from '../../api/lookup.js';
import { IN_FLIGHT_STATUSES } from '../../api/selfCheck.js';
import { listEnvironmentStates } from '../../api/status.js';
import type { ToolContext } from '../../context.js';
import { quotesBackendText } from '../../http/apiError.js';
import { ToolError } from '../../errors.js';
import {
  callWaitS,
  defineOperationKind,
  MAX_CALL_WAIT_S,
  startOrJoin,
  type RunningOperation,
} from '../../ops/operation.js';
import { pollUntil } from '../../ops/poll.js';
import { createWriteChain } from '../../ops/writeChain.js';
import type { DoneOutcome } from '../../outcome.js';
import {
  renderFlowNames,
  renderGenerationEnd,
  renderGenerationFailures,
  renderGenerationProgress,
  type DataRole,
  type DataShare,
  type GeneratedData,
  type GenerationEnd,
  type GenerationFailure,
} from '../../render/views/buildScenario.js';
import type { Resolver } from '../../resolve/handles.js';
import { selfCheckOperation } from '../scenarioCheckSelf.js';
import { roundToHundred } from './propose.js';
import { content } from '../moduleCall.js';

export interface FlowRef {
  readonly id: string;
  readonly name: string;
}

export type DataMixInput = 'normal' | 'realistic' | Readonly<Record<string, number>>;

export interface GenerateArgs {
  readonly name: string;
  readonly flows: readonly FlowRef[];
  readonly proportions: Readonly<Record<string, number>>;
  readonly dataMix: DataMixInput;
  readonly maxWaitS: number;
}

/** Proportions may miss 100 by this much (rounding of the user's numbers). */
const SUM_TOLERANCE = 0.5;
/** A run that left neither a frame nor a scenario this long after its start is given up. */
const GIVE_UP_MS = 10 * 60_000;
/** Two mixes are the same when no class differs by more than this many percent points. */
const MIX_TOLERANCE = 0.01;
const HAPPY_PATH = 'happy_path';
/** The realistic mix: typical, invalid and edge-case data (percent). */
const REALISTIC = { typical: 95, invalid: 4, edge: 1 } as const;
/** Built-in test types whose project versions carry the invalid and the edge-case data. */
const BASE_OF_ROLE = { invalid: 'negative_testing', edge: 'edge_cases' } as const;

// ---- proportions ------------------------------------------------------------------------

/** Every share positive and the sum 100 ± 0.5; checked before anything is read or sent. */
export function checkProportionValues(proportions: Readonly<Record<string, number>>): void {
  const entries = Object.entries(proportions);
  const notPositive = entries.filter(([, value]) => !(Number.isFinite(value) && value > 0));
  if (notPositive.length > 0) {
    throw new ToolError('proportions_not_positive', {
      params: { flows: notPositive.map(([key]) => key).join(', ') },
    });
  }
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  if (Math.abs(sum - 100) > SUM_TOLERANCE) {
    throw new ToolError('proportions_sum', { params: { sum: String(Math.round(sum * 10) / 10) } });
  }
}

/** The share of every flow, keyed in `proportions` by the flow's name or id. */
export function sharesOf(
  flows: readonly FlowRef[],
  proportions: Readonly<Record<string, number>>,
): { flow: FlowRef; percent: number }[] {
  const used = new Set<string>();
  const missing: string[] = [];
  const shares = flows.flatMap((flow) => {
    const key = [flow.name, flow.id].find((candidate) => Object.hasOwn(proportions, candidate));
    const percent = key === undefined ? undefined : proportions[key];
    if (key === undefined || percent === undefined) {
      missing.push(flow.name);
      return [];
    }
    used.add(key);
    return [{ flow, percent }];
  });
  const expected = renderFlowNames(flows.map((flow) => flow.name));
  if (missing.length > 0) {
    throw new ToolError('proportions_missing', {
      params: { flows: renderFlowNames(missing), expected },
    });
  }
  const unknown = Object.keys(proportions).filter((key) => !used.has(key));
  if (unknown.length > 0) {
    throw new ToolError('proportions_unknown', {
      params: { keys: renderFlowNames(unknown), expected },
    });
  }
  return shares;
}

/** A fraction for the backend from a percent, without binary noise (40 → 0.4, 33.3 → 0.333). */
export function fractionOf(percent: number): number {
  return Number((percent / 100).toFixed(6));
}

// ---- data mix ---------------------------------------------------------------------------

export interface DataMixPlan {
  /** What generation is sent; `null` for typical data only. */
  readonly classMix: Readonly<Record<string, number>> | null;
  readonly view: GeneratedData['dataMix'];
}

function roleOf(name: string, types: readonly TestTypeRef[]): DataRole | null {
  if (name === HAPPY_PATH) return 'typical';
  const base = types.find((type) => type.name === name)?.baseName;
  if (base === BASE_OF_ROLE.invalid) return 'invalid';
  if (base === BASE_OF_ROLE.edge) return 'edge';
  return null;
}

function sharesView(
  mix: Readonly<Record<string, number>>,
  types: readonly TestTypeRef[],
): DataShare[] {
  const entries = Object.entries(mix);
  const percents = roundToHundred(entries.map(([, weight]) => weight));
  return entries.map(([name], index) => ({
    type: name,
    role: roleOf(name, types),
    label: types.find((type) => type.name === name)?.label ?? name,
    percent: percents[index] ?? 0,
  }));
}

const availableOf = (types: readonly TestTypeRef[]): string =>
  [HAPPY_PATH, ...types.map((type) => type.name)].join(', ');

/**
 * The `class_mix` of every generation: none for `normal`; 95/4/1 for `realistic`, on the project's
 * own names of the types based on `negative_testing` and `edge_cases`; weights by type name as
 * given otherwise. Every name must be an enabled type of the project (or `happy_path`).
 */
export async function planDataMix(
  ctx: ToolContext,
  projectId: string,
  input: DataMixInput,
): Promise<DataMixPlan> {
  if (input === 'normal') return { classMix: null, view: { kind: 'normal', shares: [] } };
  if (input !== 'realistic') {
    const weights = Object.values(input);
    const valid = weights.every((weight) => Number.isFinite(weight) && weight >= 0);
    if (!valid || !(weights.reduce((sum, weight) => sum + weight, 0) > 0)) {
      throw new ToolError('data_mix_invalid');
    }
  }
  const types = await listEnabledTestTypes(ctx, projectId);
  if (input === 'realistic') {
    const invalid = types.find((type) => type.baseName === BASE_OF_ROLE.invalid);
    const edge = types.find((type) => type.baseName === BASE_OF_ROLE.edge);
    if (invalid === undefined || edge === undefined) {
      const missing: string[] = [];
      if (invalid === undefined) missing.push(BASE_OF_ROLE.invalid);
      if (edge === undefined) missing.push(BASE_OF_ROLE.edge);
      throw new ToolError('data_mix_realistic_unavailable', {
        params: {
          missing: missing.join(', '),
          available: availableOf(types),
        },
      });
    }
    const classMix = {
      [HAPPY_PATH]: REALISTIC.typical,
      [invalid.name]: REALISTIC.invalid,
      [edge.name]: REALISTIC.edge,
    };
    return { classMix, view: { kind: 'realistic', shares: sharesView(classMix, types) } };
  }
  const known = new Set(types.map((type) => type.name));
  const unknown = Object.keys(input).filter((name) => name !== HAPPY_PATH && !known.has(name));
  if (unknown.length > 0) {
    throw new ToolError('data_mix_unknown_type', {
      params: { types: unknown.join(', '), available: availableOf(types) },
    });
  }
  const onlyTypical = Object.keys(input).every((name) => name === HAPPY_PATH);
  const classMix = onlyTypical ? null : { ...input };
  return {
    classMix,
    view: onlyTypical
      ? { kind: 'normal', shares: [] }
      : { kind: 'custom', shares: sharesView(input, types) },
  };
}

/** A mix in percent as the backend resolves it: none, or only typical data, is 100% typical. */
function normalised(mix: Readonly<Record<string, number>> | null): Map<string, number> {
  const entries = Object.entries(mix ?? {}).filter(([, weight]) => weight > 0);
  if (entries.every(([name]) => name === HAPPY_PATH)) return new Map([[HAPPY_PATH, 100]]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return new Map(entries.map(([name, weight]) => [name, (weight / total) * 100]));
}

export function sameMix(
  a: Readonly<Record<string, number>> | null,
  b: Readonly<Record<string, number>> | null,
): boolean {
  const left = normalised(a);
  const right = normalised(b);
  if (left.size !== right.size) return false;
  return [...left].every(([name, value]) => {
    const other = right.get(name);
    return other !== undefined && Math.abs(other - value) <= MIX_TOLERANCE;
  });
}

// ---- one generation: the operation --------------------------------------------------------

const saved = z.object({
  projectId: z.string(),
  flowId: z.string(),
  flowName: z.string(),
  /** Position of the flow in the call (1-based) and the number of flows, for the progress. */
  index: z.number(),
  total: z.number(),
  /** Scenarios of the flow before the start: a scenario of the flow not among them is the result. */
  known: z.array(z.string()),
  startedAt: z.number(),
  /** The data mix the scenario was asked for (`mixKey`): another mix is another scenario. */
  mix: z.string().default(''),
});
type Saved = z.infer<typeof saved>;

interface GenerationState {
  readonly phase: 'running' | 'completed' | 'failed' | 'cancelled' | 'not_produced';
  readonly flow: string;
  readonly index: number;
  readonly total: number;
  readonly progress: number;
  readonly step: string | null;
  readonly scenarioId?: string;
  /**
   * `reason` only when the frame names a refusal of the input (status 4xx); see `quotesBackendText`.
   * `cause` tells this failure from another whether or not its text may be shown (`causeOf`).
   */
  readonly error?: {
    readonly reason?: string;
    readonly recoverable: boolean;
    readonly cause: string;
  };
}

/** The key of the digests of this server process: a digest says nothing outside it. */
const CAUSE_KEY = randomBytes(32);

/**
 * A digest of the text of a failure: equal for equal texts, so that a failure that comes back with
 * the same cause is known as such, even when its text is not shown. Keyed per process, so the digest
 * of a text the model is not shown tells nothing about the text.
 */
function causeOf(text: string): string {
  return createHmac('sha256', CAUSE_KEY).update(text.trim()).digest('hex').slice(0, 32);
}

function initialState(start: Saved): GenerationState {
  return {
    phase: 'running',
    flow: start.flowName,
    index: start.index,
    total: start.total,
    progress: 0,
    step: null,
  };
}

function endOf(state: GenerationState): GenerationEnd {
  const flow = state.flow;
  if (state.phase === 'completed' && state.scenarioId !== undefined) {
    return { status: 'completed', flow, scenarioId: state.scenarioId };
  }
  const failure: GenerationFailure =
    state.phase === 'cancelled'
      ? { kind: 'cancelled' }
      : state.error === undefined
        ? { kind: 'not_produced' }
        : {
            kind: 'error',
            ...(state.error.reason === undefined ? {} : { reason: state.error.reason }),
            recoverable: state.error.recoverable,
            retried: false,
            cause: state.error.cause,
          };
  return { status: 'failed', flow, failure };
}

/**
 * Generation of one scenario (`POST …/scenarios/generate-async`). The channel of the run is the
 * only source of its progress and of the reason of a failure; it hands the last final frame to a
 * socket that opens after the end. Without the channel the result is found in the scenario list:
 * a scenario of the flow that was not there before the start. A failure leaves nothing there, so
 * after ten minutes without one the run is given up with an unknown cause.
 */
export const scenarioGenerationOperation = defineOperationKind({
  kind: 'scenario_generation',
  saved,
  initial: (_ctx, _id, start) => initialState(start),
  channel: {
    name: 'scenario',
    params: (id) => ({ run_id: id }),
    reduce(state: GenerationState, frame): GenerationState {
      switch (frame.type) {
        case 'gatling-scenario:progress':
          return {
            ...state,
            progress: Math.max(state.progress, frame.data.progress),
            step: frame.data.step_label ?? frame.data.current_step ?? state.step,
          };
        case 'gatling-scenario:complete':
          return {
            ...state,
            phase: 'completed',
            progress: 100,
            scenarioId: frame.data.scenario_id,
          };
        case 'gatling-scenario:error':
          return {
            ...state,
            phase: 'failed',
            error: {
              // The text of a failure on the server side is not shown; a refusal of the input is.
              ...(quotesBackendText(frame.data.status_code) ? { reason: frame.data.error } : {}),
              recoverable: frame.data.recoverable ?? false,
              cause: causeOf(frame.data.error),
            },
          };
        case 'gatling-scenario:cancelled':
          return { ...state, phase: 'cancelled' };
      }
    },
  },
  async recover(ctx, _id, start): Promise<GenerationState> {
    const base = initialState(start);
    const made = (await listScenarioSources(ctx, start.projectId)).find(
      (scenario) => scenario.sourceFlowId === start.flowId && !start.known.includes(scenario.id),
    );
    if (made !== undefined) {
      return { ...base, phase: 'completed', progress: 100, scenarioId: made.id };
    }
    if (ctx.clock.now() - start.startedAt >= GIVE_UP_MS) return { ...base, phase: 'not_produced' };
    return base;
  },
  cancel: (ctx, id, start) => cancelGeneration(ctx, start.projectId, id),
  isTerminal: (state) => state.phase !== 'running',
  // `finish` reports a generation that failed or produced nothing as a result of the flow, not as an error
  ended: (state) =>
    state.phase === 'cancelled'
      ? 'cancelled'
      : state.phase === 'failed' || state.phase === 'not_produced'
        ? 'failed'
        : undefined,
  describe: (state, t) => ({
    message: renderGenerationProgress(
      {
        flow: state.flow,
        index: state.index,
        total: state.total,
        step: state.step,
        percent: state.progress,
      },
      t,
    ),
    // The last share of the call belongs to the composition and the self-checks.
    fraction: Math.min(1, (state.index - 1 + state.progress / 100) / (state.total + 1)),
  }),
  finish: (_ctx, _id, state): Promise<DoneOutcome<GenerationEnd>> =>
    Promise.resolve({ status: 'done', data: endOf(state) }),
  view: renderGenerationEnd,
});

// ---- the call ---------------------------------------------------------------------------

type ScenarioOutcome =
  | { readonly kind: 'ready'; readonly scenarioId: string }
  | { readonly kind: 'failed'; readonly failure: GenerationFailure }
  | { readonly kind: 'running'; readonly outcome: RunningOperation };

interface Deadline {
  /** Seconds left of the call's `max_wait_s`. */
  left(): number;
}

/** A data mix as a string that is equal for equal mixes. */
function mixKey(classMix: Readonly<Record<string, number>> | null): string {
  if (classMix === null) return '';
  return JSON.stringify(Object.entries(classMix).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Generates the scenario of one flow. A recoverable failure is tried once more, unless its cause is
 * one this call already confirmed (`causes`, filled here): a refusal, or a failure whose retry failed
 * the same way. A confirmed cause is a refusal of the input, not a passing failure, and another try
 * ends the same way.
 */
async function generateOne(
  ctx: ToolContext,
  projectId: string,
  flow: FlowRef,
  position: { readonly index: number; readonly total: number },
  classMix: Readonly<Record<string, number>> | null,
  known: readonly string[],
  deadline: Deadline,
  causes: Set<string>,
): Promise<ScenarioOutcome> {
  const mix = mixKey(classMix);
  // The cause of the first attempt, when it was tried again.
  let firstCause: string | undefined;
  for (let attempt = 0; ; attempt += 1) {
    // The same flow with the same mix still being generated is joined, not generated twice.
    const outcome = await startOrJoin(ctx, scenarioGenerationOperation, {
      maxWaitS: deadline.left(),
      matches: (run) => run.projectId === projectId && run.flowId === flow.id && run.mix === mix,
      async start() {
        const startedAt = ctx.clock.now();
        const { runId } = await startScenarioGeneration(ctx, projectId, {
          flowId: flow.id,
          scenarioName: flow.name,
          classMix,
        });
        return {
          id: runId,
          saved: {
            projectId,
            flowId: flow.id,
            flowName: flow.name,
            index: position.index,
            total: position.total,
            known: [...known],
            startedAt,
            mix,
          },
        };
      },
    });
    if (outcome.status !== 'done') return { kind: 'running', outcome };
    const end = outcome.data;
    if (end.status === 'completed') return { kind: 'ready', scenarioId: end.scenarioId };
    const failure = end.failure;
    if (failure.kind !== 'error') return { kind: 'failed', failure };
    const cause = failure.cause;
    const confirmed = cause !== undefined && causes.has(cause);
    if (failure.recoverable && attempt === 0 && !confirmed) {
      ctx.log.info('scenario generation failed with a recoverable error, retrying once', {
        flowId: flow.id,
      });
      firstCause = cause;
      continue;
    }
    if (failure.recoverable && attempt === 0) {
      ctx.log.info('scenario generation failed with the cause of an earlier failure, not retried', {
        flowId: flow.id,
      });
    }
    // The same cause on the retry: this flow confirms the cause.
    const again = attempt > 0 && cause !== undefined && cause === firstCause;
    const repeated = confirmed || again;
    // Only a cause a failure confirmed (a refusal, or the retry failed the same way) keeps a later flow
    // from its retry; a failure whose retry went through, or came back otherwise, says nothing of the cause.
    if (cause !== undefined && (!failure.recoverable || again)) causes.add(cause);
    return { kind: 'failed', failure: { ...failure, retried: attempt > 0, repeated } };
  }
}

/**
 * The scenario of a flow that can be used as it is: generated from the flow with the same data mix.
 * A current member of the composition wins, then the newest one.
 */
function reusable(
  flow: FlowRef,
  classMix: Readonly<Record<string, number>> | null,
  sources: readonly ScenarioSource[],
  members: readonly CompositionMember[],
): string | undefined {
  const member = members.find(
    (candidate) => candidate.sourceFlowId === flow.id && sameMix(candidate.classMix, classMix),
  );
  if (member !== undefined) return member.scenarioId;
  return sources
    .filter((scenario) => scenario.sourceFlowId === flow.id && sameMix(scenario.classMix, classMix))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0]?.id;
}

/** The source flow of a member, from the composition or from the scenario list. */
function memberFlow(member: CompositionMember, sources: readonly ScenarioSource[]): string | null {
  return (
    member.sourceFlowId ??
    sources.find((scenario) => scenario.id === member.scenarioId)?.sourceFlowId ??
    null
  );
}

/**
 * An existing composition is changed only when it combines the same flows; another composition
 * that happens to have the name is refused with both lists of flows.
 */
async function checkSameFlows(
  ctx: ToolContext,
  projectId: string,
  name: string,
  flows: readonly FlowRef[],
  members: readonly CompositionMember[],
  sources: readonly ScenarioSource[],
): Promise<void> {
  const wanted = new Set(flows.map((flow) => flow.id));
  const have = members.map((member) => memberFlow(member, sources));
  const same =
    members.length === flows.length &&
    have.every((flowId) => flowId !== null && wanted.has(flowId)) &&
    new Set(have).size === wanted.size;
  if (same) return;
  const known = await listFlows(ctx, projectId);
  // A member whose flow is unknown (deleted, or a scenario without a flow) is named by its scenario.
  const saved = members.map(
    (member, index) => known.find((flow) => flow.id === have[index])?.name ?? member.scenarioName,
  );
  throw new ToolError('composition_flows_differ', {
    params: {
      name,
      saved: renderFlowNames(saved),
      requested: renderFlowNames(flows.map((flow) => flow.name)),
    },
  });
}

/** The flows of the call: given, from the proposal of phase 1, or the keys of `proportions`. */
export async function flowsOfCall(
  ctx: ToolContext,
  resolver: Resolver,
  projectId: string,
  args: {
    readonly name: string;
    readonly flows: readonly string[] | undefined;
    readonly proportions: Readonly<Record<string, number>>;
  },
): Promise<FlowRef[]> {
  const draft = draftSchema.safeParse(ctx.state.get('drafts', args.name)?.value);
  const names =
    args.flows !== undefined && args.flows.length > 0
      ? args.flows
      : draft.success && draft.data.projectId === projectId
        ? null
        : Object.keys(args.proportions);
  if (names === null && draft.success) return draft.data.flows;
  const resolved: FlowRef[] = [];
  for (const name of names ?? []) {
    const flow = await resolver.flow(projectId, name);
    if (!resolved.some((other) => other.id === flow.id)) resolved.push(flow);
  }
  return resolved;
}

const draftSchema = z.object({
  projectId: z.string(),
  flows: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
});

/** The work of `scenario_generate`; `project` is resolved and the flows are known. */
export async function generateScenarios(
  ctx: ToolContext,
  project: { readonly id: string; readonly name: string },
  args: GenerateArgs,
): Promise<DoneOutcome<GeneratedData> | RunningOperation> {
  // The whole call (generation, then the self-checks) stays inside one call's wait limit.
  const endAt = ctx.clock.now() + callWaitS(args.maxWaitS) * 1000;
  const deadline: Deadline = { left: () => Math.max(0, (endAt - ctx.clock.now()) / 1000) };
  const split = sharesOf(args.flows, args.proportions);
  const mix = await planDataMix(ctx, project.id, args.dataMix);
  const existing = await findComposition(ctx, project.id, args.name);
  const sources = await listScenarioSources(ctx, project.id);
  const members =
    existing === null ? [] : await readCompositionMembers(ctx, project.id, existing.id);
  if (existing !== null) {
    await checkSameFlows(ctx, project.id, args.name, args.flows, members, sources);
  }

  // 1. One scenario per flow, one generation at a time; a failed flow does not stop the others.
  const chosen = new Map<string, string>();
  const generated = new Set<string>();
  const failed: { flow: string; failure: GenerationFailure }[] = [];
  // The causes this call failed with, so that a cause that comes back is not tried again.
  const causes = new Set<string>();
  for (const [index, flow] of args.flows.entries()) {
    const found = reusable(flow, mix.classMix, sources, members);
    if (found !== undefined) {
      chosen.set(flow.id, found);
      continue;
    }
    const known = sources.filter((scenario) => scenario.sourceFlowId === flow.id);
    const result = await generateOne(
      ctx,
      project.id,
      flow,
      { index: index + 1, total: args.flows.length },
      mix.classMix,
      known.map((scenario) => scenario.id),
      deadline,
      causes,
    );
    if (result.kind === 'running') return result.outcome;
    if (result.kind === 'failed') {
      failed.push({ flow: flow.name, failure: result.failure });
      continue;
    }
    chosen.set(flow.id, result.scenarioId);
    generated.add(result.scenarioId);
  }
  if (failed.length > 0) {
    const ready = args.flows.filter((flow) => chosen.has(flow.id)).map((flow) => flow.name);
    // A refusal, or a failure that came back with the same cause, ends the same way on a call with the
    // same input: the model is told to change the input, not to call again as it is.
    const refused = failed.some(
      ({ failure }) =>
        failure.kind === 'error' && (!failure.recoverable || failure.repeated === true),
    );
    throw new ToolError(refused ? 'scenario_generation_refused' : 'scenario_generation_failed', {
      params: {
        name: args.name,
        failed: failed.length,
        total: args.flows.length,
        failures: renderGenerationFailures(failed, ctx.t),
        ready: ready.length === 0 ? ctx.t('buildScenario.none') : renderFlowNames(ready),
      },
    });
  }

  // 2. The composition: created, or its members replaced by the whole new list.
  const writes: MemberWrite[] = split.map(({ flow, percent }) => {
    const scenarioId = chosen.get(flow.id) ?? '';
    const kept = members.find((member) => member.scenarioId === scenarioId);
    // A scenario generated again replaces the member of its flow, which keeps being on or off.
    const sameFlow = members.find((member) => memberFlow(member, sources) === flow.id);
    return {
      scenarioId,
      variantLabel: kept?.variantLabel ?? '',
      proportion: fractionOf(percent),
      enabled: (kept ?? sameFlow)?.enabled ?? true,
    };
  });
  if (existing === null) await createComposition(ctx, project.id, args.name, writes);
  else await replaceCompositionMembers(ctx, project.id, existing.id, writes);

  // 3. The automatic self-checks: read until they end, at most two minutes.
  const environments = await listEnvironmentStates(ctx, project.id);
  const environment = environments.find((candidate) => candidate.isDefault)?.name ?? null;
  const checks = await awaitSelfChecks(
    ctx,
    project,
    environment,
    args.flows,
    chosen,
    generated,
    deadline,
  );

  const data: GeneratedData = {
    name: args.name,
    composition: existing === null ? 'created' : 'updated',
    scenarios: args.flows.length,
    compiled: true,
    split: split.map(({ flow, percent }) => ({ flow: flow.name, percent })),
    dataMix: mix.view,
    selfCheck: { environment, chains: checks.chains },
    regenerated: generated.size > 0,
  };
  return { status: 'done', data, ...(checks.links.length === 0 ? {} : { links: checks.links }) };
}

/**
 * Reads the self-check of every scenario until none is in progress (a scenario generated by this
 * call also waits for its check to appear) or the wait is over; then draws what there is.
 */
async function awaitSelfChecks(
  ctx: ToolContext,
  project: { readonly id: string; readonly name: string },
  environment: string | null,
  flows: readonly FlowRef[],
  chosen: ReadonlyMap<string, string>,
  generated: ReadonlySet<string>,
  deadline: Deadline,
) {
  const spec = selfCheckOperation.spec;
  const start = {
    // names are shown masked in the self-check view, their secrets registered (FIX-76)
    project: { id: project.id, name: content(ctx, project.name, 120) },
    environment,
    scenarios: flows.map((flow) => ({
      id: chosen.get(flow.id) ?? '',
      name: content(ctx, flow.name, 120),
    })),
  };
  // The view of these checks in the state file is kept per project: a later call replaces it.
  const operationId = `build-scenario:${project.id}`;
  const total = flows.length;
  // The view of the checks while they run goes through a chain of its own, never holding the reads.
  const views = createWriteChain();
  const polled = await pollUntil(() => spec.recover(ctx, operationId, start), {
    isTerminal: (state) =>
      state.scenarios.every((scenario) =>
        scenario.state === null
          ? !generated.has(scenario.id)
          : !IN_FLIGHT_STATUSES.includes(scenario.state.status),
      ),
    deadlineMs: Math.min(MAX_CALL_WAIT_S * 1000, deadline.left() * 1000),
    signal: ctx.signal,
    clock: ctx.clock,
    ...(spec.pollIntervalMs === undefined ? {} : { intervalMs: spec.pollIntervalMs }),
    onState: (state) => {
      const { message, fraction } = spec.describe(state, ctx.t);
      ctx.progress.report(message, (total + (fraction ?? 0)) / (total + 1));
      if (spec.observe !== undefined && !spec.isTerminal(state)) {
        void views.run(async () => {
          try {
            await spec.observe?.(ctx, operationId, state, start);
          } catch (error) {
            ctx.log.warn('self-check view not written', { error });
          }
        });
      }
    },
  });
  // The end is written by `finish`, after the views in flight.
  await views.flush();
  const done = await spec.finish(ctx, operationId, polled.state, start);
  // The chains are named after the flows, as the split above them is.
  const chains = done.data.scenarios.map((check, index) => ({
    ...check,
    name: flows[index]?.name ?? check.name,
  }));
  return { chains, links: done.links ?? [] };
}
