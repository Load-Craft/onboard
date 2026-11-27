// `data_set_slot_label` (module data): Set the display label of a scenario's data slot.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The tool reads the slot first (the label before, which the undo restores) and writes only
// when the label differs; it says nothing was changed when it does not (no write, no undo). The
// backend has no way to clear a label, so a slot that had none cannot be restored: that change is
// not offered for undo. A label that held a secret is not kept either. The label sits in the scenario
// artifact without a version bump or a snapshot, so the undo is the only way back.
// Log: args "{slot}", result "slot {slot}: {label}": the data carries both; the undo is the same tool
// with the previous label (`update.log.undo_args`).
// Arguments (the catalog's): `scenario_id` (default: the only scenario of the workspace), `slot`, `label`.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import { inline } from '../../render/primitives.js';
import { renderSetSlotLabel, type SetSlotLabelData } from '../../render/data/setSlotLabel.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { scenarioIdOf } from '../scenario/scenarioId.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { DATA_SET_SLOT_LABEL } from './meta.generated.js';

/** PATCH /projects/{project_id}/data-hub/scenarios/{scenario_id}/slots/{slot}/label (REST API v1) */
export function relabelSlot(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string; readonly slot: string },
  body: BodyOf<'relabel_slot_api_v1_projects__project_id__data_hub_scenarios__scenario_id__slots__slot__label_patch'>,
): Promise<
  OpOutput<'relabel_slot_api_v1_projects__project_id__data_hub_scenarios__scenario_id__slots__slot__label_patch'>
> {
  return callBackend(
    ctx,
    'relabel_slot_api_v1_projects__project_id__data_hub_scenarios__scenario_id__slots__slot__label_patch',
    { path, body },
  );
}

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/slots/options (REST API v1) */
export function getScenarioSlotOptions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'get_scenario_slot_options_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots_options_get'>
> {
  return callBackend(
    ctx,
    'get_scenario_slot_options_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots_options_get',
    { path },
  );
}

const TEXT_LIMIT = 200;

export const dataSetSlotLabel = moduleTool(DATA_SET_SLOT_LABEL, {
  title: "Set the display label of a scenario's data slot",
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario; default: the only one in this workspace.'),
    slot: z.string().min(1).max(100).describe('The data slot.'),
    label: z.string().min(1).max(200).describe("The slot's new label."),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = scenarioIdOf(ctx, args.scenario_id);
    const path = { project_id: projectId, scenario_id: scenarioId };
    const options = await getScenarioSlotOptions(ctx, path);
    const slot = options.slots.find((item) => item.slot === args.slot);
    if (slot === undefined) {
      throw new ToolError('not_found', {
        message: `The scenario has no slot "${inline(args.slot, 100)}".`,
        params: {
          available: ` Slots: ${options.slots
            .slice(0, 10)
            .map((item) => `"${content(ctx, item.slot, 100)}"`)
            .join(', ')}.`,
        },
      });
    }
    const label = args.label.trim();
    const shown = content(ctx, label, TEXT_LIMIT);
    const previous = slot.label ?? null;
    if (previous === label) {
      const data: SetSlotLabelData = {
        scenario_id: scenarioId,
        slot: content(ctx, args.slot, 100),
        label: shown,
        previous: shown,
        changed: false,
        undoable: false,
        notUndoable: null,
      };
      return { status: 'done', data, inert: true };
    }
    await relabelSlot(ctx, { ...path, slot: args.slot }, { label });
    const shownPrevious = previous === null ? null : content(ctx, previous, TEXT_LIMIT);
    const notUndoable =
      previous === null
        ? 'no_previous'
        : ctx.secrets.scrub(previous) !== previous || shownPrevious !== previous
          ? 'secret'
          : null;
    const data: SetSlotLabelData = {
      scenario_id: scenarioId,
      slot: content(ctx, args.slot, 100),
      label: shown,
      previous: shownPrevious,
      changed: true,
      undoable: notUndoable === null,
      notUndoable,
    };
    return {
      status: 'done',
      data,
      ...(previous !== null && notUndoable === null
        ? {
            update: {
              log: { undo_args: { scenario_id: scenarioId, slot: args.slot, label: previous } },
            },
          }
        : {}),
    };
  },
  render: renderSetSlotLabel,
});
