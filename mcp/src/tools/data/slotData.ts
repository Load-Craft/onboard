// `data_create_dataset` with `scenario` and `slot` alone: the rows of a slot of plain data, made the
// way the LoadCraft frontend makes them, from the columns of one scenario's slot
// (`…/slots/{slot}/generate-feeder`, without the model's enrichment). That writes a dataset of the
// project (`<slot> data`) and sends nothing to the target system. A slot no scenario of the target can
// be the source of, a slot with a secret column and a slot whose generation the backend refused
// before are sent to a file; a new refusal is kept, so the plan names a file for that slot from then
// on instead of offering the generation again.

import { generateSlotData, isPlainDataSlot, type SavedDataset } from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { inline } from '../../render/primitives.js';
import type { RunTarget } from '../../resolve/handles.js';
import { dataSlotRemedy } from './plan.js';
import { keepRefusal, readSlots, refusalsOf, type SlotsRead } from './readPlan.js';

/** Statuses of the backend's answer with which the generation is a refusal for this slot. */
const REFUSALS: ReadonlySet<number> = new Set([400, 404, 409, 422]);

export interface SlotDataPlan {
  readonly slots: SlotsRead;
  /** The scenario whose slot the rows are made from. */
  readonly scenarioId: string;
  /** Rows to make: the call's count, else what the slot needs. */
  readonly rows: number | null;
  /** The name the backend gives the dataset. */
  readonly name: string;
}

/** Checks that the slot's rows can be made from its columns, and from which scenario. Sends nothing. */
export async function planSlotData(
  ctx: ToolContext,
  args: { projectId: string; target: RunTarget; slot: string; rows?: number },
): Promise<SlotDataPlan> {
  const slots = await readSlots(ctx, { projectId: args.projectId, target: args.target });
  const verdict = slots.verdicts.find((item) => item.slot === args.slot);
  if (verdict === undefined) {
    throw new ToolError('slot_unknown', {
      params: {
        slot: args.slot,
        available: [...new Set(slots.verdicts.map((item) => item.slot))].join(', '),
      },
    });
  }
  const plain = slots.scenarios.some((scenario) =>
    scenario.slots.some((spec) => spec.slot === args.slot && isPlainDataSlot(spec)),
  );
  const remedy = dataSlotRemedy(args.slot, {
    verdicts: slots.verdicts,
    members: slots.scenarios,
    proposed: [],
    hubReply: null,
    refused: refusalsOf(ctx, args.projectId, args.target.id),
  });
  if (!plain || remedy.kind !== 'slot_generates') {
    const detail = inline(remedy.kind === 'file_only' ? (remedy.detail ?? '') : '', 200);
    const reason = !plain
      ? ctx.t('error.slot_data_unavailable.reason.accounts')
      : ctx.t(
          `data.fix.data_from_file.${remedy.kind === 'file_only' ? remedy.reason : 'no_source'}`,
          {
            detail,
          },
        );
    const columns = remedy.kind === 'file_only' ? remedy.columns : verdict.columns;
    throw new ToolError('slot_data_unavailable', {
      params: {
        slot: args.slot,
        reason,
        columns: columns.map((column) => inline(column)).join(', '),
      },
    });
  }
  return {
    slots,
    scenarioId: remedy.scenarioId,
    rows: args.rows ?? verdict.need,
    name: `${args.slot} data`,
  };
}

/** Makes the rows; a refusal of the backend is kept for the plan and answered with a file. */
export async function makeSlotData(
  ctx: ToolContext,
  args: { projectId: string; target: RunTarget; slot: string },
  plan: SlotDataPlan,
): Promise<SavedDataset> {
  try {
    const saved = await generateSlotData(
      ctx,
      args.projectId,
      plan.scenarioId,
      args.slot,
      plan.rows,
    );
    await keepRefusal(ctx, args.projectId, args.target.id, args.slot, null);
    return saved;
  } catch (error) {
    if (!(error instanceof LoadcraftApiError) || !REFUSALS.has(error.status)) throw error;
    await keepRefusal(ctx, args.projectId, args.target.id, args.slot, error.message);
    const columns = plan.slots.verdicts.find((item) => item.slot === args.slot)?.columns ?? [];
    throw new ToolError('slot_data_refused', {
      params: { slot: args.slot, detail: error.message, columns: columns.join(', ') },
    });
  }
}
