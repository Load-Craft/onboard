// The dry run of `run_start`: the facts a client wants before a test, from the same steps the real
// call takes before it starts anything (target and environment, the limits, the clamped profile,
// the data under that load, whether the environment is free), and nothing after them. It reads
// and never writes: no start, no record in the workspace, and no lock on the environment, which a
// real call holds from its check to its record and a read does not need.

import { listActiveRuns, getRunEnvironment } from '../../api/executions.js';
import { getCompat } from '../../api/status.js';
import type { ToolContext } from '../../context.js';
import { plannedDurationSeconds } from '../../profiles/duration.js';
import type { DryRunBusy, DryRunData, DryRunSlot } from '../../render/views/run.js';
import { createResolver } from '../../resolve/handles.js';
import { checkData, clampToEnvironment, labelOf, liveRunsOn, type StartArgs } from './start.js';
import { asProfile } from './saved.js';
import { settleAll } from '../../http/operation.js';
import { content } from '../moduleCall.js';

/** A name from the backend, as a view shows it. */
const NAME_LIMIT = 120;

/** The slot with the least rows to spare among those that count rows: its numbers stand for the data. */
function tightest(slots: readonly DryRunSlot[]): { needed: number; available: number } | null {
  let found: { needed: number; available: number } | null = null;
  for (const slot of slots) {
    if (slot.have === null || slot.need === null) continue;
    if (found === null || slot.have - slot.need < found.available - found.needed) {
      found = { needed: slot.need, available: slot.have };
    }
  }
  return found;
}

export async function dryRunStart(
  ctx: ToolContext,
  args: Omit<StartArgs, 'thresholds' | 'confirm_capped'>,
): Promise<DryRunData> {
  await getCompat(ctx);
  const resolver = createResolver(ctx);
  const project = await resolver.project(args.project);
  const [target, environmentHandle] = await settleAll([
    resolver.runScenarioTarget(project.id, args.scenario),
    resolver.environment(project.id, args.environment),
  ]);
  const environment = await getRunEnvironment(ctx, project.id, environmentHandle.id);

  // The refusals of the real call before a start (no limits on a protected environment, a spike
  // that cannot fit) are refusals here as well.
  const requested = asProfile(args.profile);
  const { caps, result } = clampToEnvironment(ctx, environment, requested);
  const effective = result.profile;

  const live = await liveRunsOn(ctx, project.id, environment.id);
  let busy: DryRunBusy | null = null;
  const running = live[0];
  if (running !== undefined) {
    busy = { handle: `test_run:${running.executionId}` };
  } else {
    const elsewhere = await listActiveRuns(ctx, project.id, environment.id, ctx.clock.now());
    const other = elsewhere.find((run) => run.onEnvironment) ?? elsewhere[0];
    if (other !== undefined) busy = { handle: resolver.shortExecution(other.id) };
  }

  const demand = await checkData(ctx, project.id, target, environment.id, effective);
  const slots: DryRunSlot[] = demand.slots.map((slot) => ({
    slot: slot.label,
    key: slot.slot,
    dataset: slot.dataset,
    have: slot.have,
    need: slot.need,
    status: slot.status,
    blocking: slot.blocking,
    message: slot.message ?? null,
    identity_kind: slot.identityKind ?? null,
    ...(slot.regenerate == null
      ? {}
      : {
          regenerate: { dataset_id: slot.regenerate.datasetId, dataset: slot.regenerate.dataset },
        }),
    ...(slot.spent == null ? {} : { spent: slot.spent }),
  }));
  const tight = tightest(slots);

  return {
    dry_run: true,
    // names from the backend are shown masked, their secrets registered (FIX-76)
    target: { kind: target.kind, name: content(ctx, target.name, NAME_LIMIT) },
    environment: {
      name: content(ctx, environment.name, NAME_LIMIT),
      protected: environment.protected,
      ...(caps.maxVu === undefined && caps.maxRps === undefined
        ? {}
        : {
            limit: {
              ...(caps.maxVu === undefined ? {} : { max_vu: caps.maxVu }),
              ...(caps.maxRps === undefined ? {} : { max_rps: caps.maxRps }),
            },
          }),
    },
    profile_label: labelOf(requested.type),
    profile_requested: requested,
    profile_effective: effective,
    capped: result.clamped,
    consent_required: environment.protected || result.clamped,
    data: {
      needed: tight?.needed ?? null,
      available: tight?.available ?? null,
      ready: demand.ready,
      slots,
      refusal: demand.refusal,
    },
    planned_s: plannedDurationSeconds(effective),
    busy,
  };
}
