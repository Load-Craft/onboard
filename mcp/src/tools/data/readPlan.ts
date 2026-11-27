// Reads the backend for the data plan of a scenario or composition and composes it. Shared by the
// data tools and by `data_create_accounts`, which draws the plan again once the accounts exist.

import * as z from 'zod';

import {
  getCompositionMembers,
  getScenarioSlots,
  listDatasets,
  preflightComposition,
  preflightScenario,
  proposeActions,
  type Dataset,
  type HubProposal,
  type ProposedAction,
  type DataApiContext,
  type ScenarioSlots,
  type SlotSpec,
  type SlotVerdictState,
} from '../../api/data.js';
import { listEnvironmentStates } from '../../api/status.js';
import type { ToolContext } from '../../context.js';
import type { DataPlanView } from '../../render/views/data.js';
import type { RunTarget } from '../../resolve/handles.js';
import { composePlan } from './plan.js';
import { settleAll } from '../../http/operation.js';

/** The slots of the scenarios, each once, with the scenarios that read it in the order given. */
export function mergeSlots(scenarios: readonly ScenarioSlots[], shown: boolean) {
  const merged = new Map<string, SlotSpec & { usedBy: string[] }>();
  for (const scenario of scenarios) {
    for (const slot of scenario.slots) {
      const known = merged.get(slot.slot);
      if (known === undefined) {
        merged.set(slot.slot, { ...slot, usedBy: shown ? [scenario.name] : [] });
      } else if (shown) {
        known.usedBy.push(scenario.name);
      }
    }
  }
  return [...merged.values()];
}

export interface PlanRequest {
  readonly projectId: string;
  readonly target: RunTarget;
  /** The environment the call named; without it, the project's default one is meant. */
  readonly environment?: { readonly id: string; readonly name: string };
  /** The data hub's answer the caller already holds; the hub is not asked again. */
  readonly hub?: HubProposal<ProposedAction>;
  /** Slots whose generation the backend refused, with its reason (`refusalsOf`). */
  readonly refused?: ReadonlyMap<string, string>;
}

/** What the backend says about the target's data without asking the data hub (no model is called). */
export interface SlotsRead {
  readonly environmentName: string | null;
  readonly datasets: readonly Dataset[];
  /** The scenarios the target runs, with their slots and saved picks. */
  readonly scenarios: readonly ScenarioSlots[];
  readonly verdicts: readonly SlotVerdictState[];
  /** For a composition: its id and its own picks, the store its run reads; null for a scenario. */
  readonly composition: {
    readonly id: string;
    readonly bindings: Readonly<Record<string, string>>;
  } | null;
}

export interface PlanRead extends SlotsRead {
  readonly view: DataPlanView;
}

/** What a target is made of: its scenarios with their slots and picks, its own picks, the datasets. */
export type TargetRead = Pick<SlotsRead, 'datasets' | 'scenarios' | 'composition'>;

/** The composition of a target (null for a scenario) and the scenarios it runs. */
async function membersOf(ctx: ToolContext & DataApiContext, projectId: string, target: RunTarget) {
  const composition =
    target.kind === 'composition'
      ? await getCompositionMembers(ctx, projectId, target.id)
      : undefined;
  return {
    members: composition?.scenarios ?? [{ id: target.id, name: target.name }],
    composition:
      composition === undefined ? null : { id: composition.id, bindings: composition.bindings },
  };
}

/**
 * The target's scenarios, slots and picks and the project's datasets, without a pre-flight. The
 * datasets are read first: their reader registers the secrets of their content, so a later answer
 * of the backend that quotes one is masked.
 */
export async function readTarget(
  ctx: ToolContext & DataApiContext,
  projectId: string,
  target: RunTarget,
): Promise<TargetRead> {
  const datasets = await listDatasets(ctx, projectId);
  const { members, composition } = await membersOf(ctx, projectId, target);
  const scenarios = await settleAll(
    members.map((member) => getScenarioSlots(ctx, projectId, member.id)),
  );
  return { datasets, scenarios, composition };
}

/** The slots, their verdicts and the datasets: the reads of the plan that call no model. */
export async function readSlots(
  ctx: ToolContext & DataApiContext,
  request: Pick<PlanRequest, 'projectId' | 'target' | 'environment'>,
): Promise<SlotsRead> {
  const { projectId, target, environment } = request;
  // The datasets first, for the secrets of their content (see `readTarget`).
  const [environments, datasets] = await settleAll([
    listEnvironmentStates(ctx, projectId),
    listDatasets(ctx, projectId),
  ]);
  const environmentName =
    environment?.name ?? environments.find((item) => item.isDefault)?.name ?? null;
  const { members, composition } = await membersOf(ctx, projectId, target);
  const [scenarios, verdicts] = await settleAll([
    settleAll(members.map((member) => getScenarioSlots(ctx, projectId, member.id))),
    target.kind === 'composition'
      ? preflightComposition(ctx, projectId, target.id)
      : preflightScenario(ctx, projectId, target.id, environment?.id),
  ]);
  return { environmentName, datasets, scenarios, verdicts, composition };
}

/** The data hub's proposals; it may call a model, so it is asked only when a slot is missing. */
export async function askHub(
  ctx: ToolContext & DataApiContext,
  request: Pick<PlanRequest, 'projectId' | 'target'>,
  slots: SlotsRead,
): Promise<HubProposal<ProposedAction>> {
  return slots.verdicts.some((verdict) => verdict.status === 'missing')
    ? proposeActions(ctx, request.projectId, request.target)
    : { actions: [], reply: null };
}

/** The plan composed from the reads and the hub's answer. */
export function planOf(
  request: PlanRequest,
  slots: SlotsRead,
  hub: HubProposal<ProposedAction>,
): PlanRead {
  const { target } = request;
  const view = composePlan({
    target: { kind: target.kind, name: target.name },
    environment: slots.environmentName,
    verdicts: slots.verdicts,
    specs: mergeSlots(slots.scenarios, target.kind === 'composition'),
    scenarioIds: slots.scenarios.map((scenario) => scenario.id),
    members: slots.scenarios,
    datasets: slots.datasets,
    proposed: [...hub.actions],
    hubReply: hub.reply,
    ...(request.refused === undefined || request.refused.size === 0
      ? {}
      : { refused: request.refused }),
  });
  return { ...slots, view };
}

export async function readPlan(
  ctx: ToolContext & DataApiContext,
  request: PlanRequest,
): Promise<PlanRead> {
  const slots = await readSlots(ctx, request);
  return planOf(request, slots, request.hub ?? (await askHub(ctx, request, slots)));
}

// ---- refusals of the generation of a slot's rows ----------------------------------------------

/** Where the refusals of a target are kept: the cache section `drafts`, one entry per target. */
const refusalKey = (projectId: string, targetId: string): string =>
  `data_refused:${projectId}:${targetId}`;

const refusalSchema = z.record(z.string(), z.string());

/**
 * Slots of the target whose rows the backend refused to make from their columns, with what it
 * said. A plan keeps naming a file for them, so the generation is not offered again in a loop.
 */
export function refusalsOf(
  ctx: Pick<ToolContext, 'state'>,
  projectId: string,
  targetId: string,
): ReadonlyMap<string, string> {
  const parsed = refusalSchema.safeParse(
    ctx.state.get('drafts', refusalKey(projectId, targetId))?.value,
  );
  return new Map(parsed.success ? Object.entries(parsed.data) : []);
}

/** Keeps the backend's refusal for a slot of the target, or (detail null) forgets it. */
export async function keepRefusal(
  ctx: Pick<ToolContext, 'state'>,
  projectId: string,
  targetId: string,
  slot: string,
  detail: string | null,
): Promise<void> {
  const known = Object.fromEntries(refusalsOf(ctx, projectId, targetId));
  if (detail === null) {
    if (!(slot in known)) return;
    delete known[slot];
  } else {
    known[slot] = detail;
  }
  const key = refusalKey(projectId, targetId);
  if (Object.keys(known).length === 0) await ctx.state.delete('drafts', key);
  else await ctx.state.set('drafts', key, known);
}
