// `data_create_dataset` with `scenario` and `slot` alone: the rows of a slot of plain data or of new
// identities (a slot the backend judged `fresh`: a sign-up creates the accounts, each value is used
// once), made the way the LoadCraft frontend makes them, from the columns of one scenario's slot
// (`…/slots/{slot}/generate-feeder`, without the model's enrichment). That writes a dataset of the
// project (`<slot> data`) and sends nothing to the target system. A slot no scenario of the target can
// be the source of, a slot with a secret column and a slot whose generation the backend refused
// before are sent to a file; a new refusal is kept, so the plan names a file for that slot from then
// on instead of offering the generation again.

import {
  generateSlotData,
  identityOf,
  isPlainDataSlot,
  type SavedDataset,
} from '../../api/data.js';
import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { inline } from '../../render/primitives.js';
import { content } from '../moduleCall.js';
import type { RunTarget } from '../../resolve/handles.js';
import { dataSlotRemedy } from './plan.js';
import { keepRefusal, readSlots, refusalsOf, type SlotsRead } from './readPlan.js';

/** Statuses of the backend's answer with which the generation is a refusal for this slot. */
const REFUSALS: ReadonlySet<number> = new Set([400, 404, 409, 422]);

/** The code of the backend's refusal of columns it never makes up (a login, a secret, an id). */
const NEVER_FABRICATED = 'never_fabricated_columns';
const COLUMNS_SHOWN = 20;
const COLUMN_LIMIT = 80;

/**
 * The columns a `never_fabricated_columns` refusal names, read from its list (`details.columns`),
 * never from its sentence; each is the backend's text, so masked and on one line. Null when the
 * refusal is another one or its list is not a list of names.
 */
function neverFabricatedColumns(ctx: ToolContext, error: LoadcraftApiError): string[] | null {
  if (error.code !== NEVER_FABRICATED) return null;
  const details = error.details;
  const columns =
    typeof details === 'object' && details !== null && 'columns' in details
      ? details.columns
      : undefined;
  if (!Array.isArray(columns) || columns.length === 0) return null;
  const names = (columns as unknown[]).filter((column) => typeof column === 'string');
  if (names.length !== columns.length) return null;
  const shown = names.slice(0, COLUMNS_SHOWN).map((column) => content(ctx, column, COLUMN_LIMIT));
  return names.length > COLUMNS_SHOWN
    ? [...shown, `+${String(names.length - COLUMNS_SHOWN)}`]
    : shown;
}

export interface SlotDataPlan {
  readonly slots: SlotsRead;
  /** The scenario whose slot the rows are made from. */
  readonly scenarioId: string;
  /** Rows to make: the call's count, else what the slot needs. */
  readonly rows: number | null;
  /** The name the backend gives the dataset. */
  readonly name: string;
  /** The slot holds new identities (the backend's verdict): each value is used once. */
  readonly fresh: boolean;
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
  const declared = slots.scenarios.flatMap((scenario) =>
    scenario.slots.filter((spec) => spec.slot === args.slot),
  );
  const identity = identityOf(declared);
  if (identity === 'mixed')
    throw new ToolError('slot_mixed_identities', { params: { slot: args.slot } });
  const fresh = identity === 'fresh';
  const plain = fresh || declared.some(isPlainDataSlot);
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
    fresh,
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
    const refused = neverFabricatedColumns(ctx, error);
    if (refused !== null) {
      throw new ToolError(NEVER_FABRICATED, {
        params: {
          slot: args.slot,
          columns: refused.join(', '),
          all: columns.map((column) => inline(column)).join(', '),
        },
      });
    }
    throw new ToolError('slot_data_refused', {
      params: { slot: args.slot, detail: error.message, columns: columns.join(', ') },
    });
  }
}
