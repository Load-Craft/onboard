// `data_get_slots` (module data): Get the data slots of a scenario or composition with compatible
// datasets and current bindings.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The slots and the datasets that fit them come from the options read; the bindings (which
// dataset a slot is pinned to) from the detail of the scenario or composition, an auxiliary read: an
// error of the backend leaves the slots and marks the bindings unknown. Only the id of the bound
// dataset and the state of the binding are read from the detail. Slot keys, labels, columns and
// dataset names pass `content`.
// Log: args "{target}", result "{slots} slots, {bound} bound": the data of the result carries the
// fields.

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderSlots,
  type SlotBinding,
  type SlotItem,
  type SlotsData,
} from '../../render/data/getSlots.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { fromState, projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { scenarioIdOf } from '../scenario/scenarioId.js';
import { DATA_GET_SLOTS } from './meta.generated.js';

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

/** GET /projects/{project_id}/gatling/compositions/{composition_id}/slots/options (REST API v1) */
export function getCompositionSlotOptions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'get_composition_slot_options_api_v1_projects__project_id__gatling_compositions__composition_id__slots_options_get'>
> {
  return callBackend(
    ctx,
    'get_composition_slot_options_api_v1_projects__project_id__gatling_compositions__composition_id__slots_options_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id} (REST API v1): the bindings only. */
export function getScenario(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get'>
> {
  return callBackend(
    ctx,
    'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/compositions/{composition_id} (REST API v1): the bindings only. */
export function getComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get'>
> {
  return callBackend(
    ctx,
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
    { path },
  );
}

const COLUMNS_SHOWN = 20;
const OPTIONS_SHOWN = 10;
const NAME_LIMIT = 100;

type Options =
  OpOutput<'get_scenario_slot_options_api_v1_projects__project_id__gatling_scenarios__scenario_id__slots_options_get'>;

/** What the detail says of the bindings; null when it could not be read. */
interface Bindings {
  readonly bound: Readonly<Record<string, string>>;
  readonly stale: ReadonlySet<string>;
}

/** An auxiliary read: an API error of the backend leaves the part out, anything else ends the call. */
async function optional<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

type Target = { readonly kind: 'scenario' | 'composition'; readonly id: string };

/** The scenario or composition the call is about; see the contract for the defaults. */
function targetOf(
  ctx: Parameters<typeof scenarioIdOf>[0] & Parameters<typeof fromState>[0],
  scenarioId: string | undefined,
  compositionId: string | undefined,
): Target {
  if (scenarioId !== undefined && compositionId !== undefined) {
    throw new ToolError('invalid', {
      params: { detail: 'pass scenario_id or composition_id, not both' },
    });
  }
  if (compositionId !== undefined) return { kind: 'composition', id: compositionId.toLowerCase() };
  if (scenarioId !== undefined) return { kind: 'scenario', id: scenarioId.toLowerCase() };
  const kept = fromState(ctx, 'ids.composition_id');
  if (typeof kept === 'string') return { kind: 'composition', id: kept };
  return { kind: 'scenario', id: scenarioIdOf(ctx, undefined) };
}

function bindingsOf(
  detail: {
    readonly slot_bindings: Readonly<Record<string, string>>;
    readonly slot_binding_states: readonly { readonly slot: string; readonly state: string }[];
  } | null,
): Bindings | null {
  if (detail === null) return null;
  return {
    bound: detail.slot_bindings,
    stale: new Set(
      detail.slot_binding_states.filter((entry) => entry.state === 'stale').map((e) => e.slot),
    ),
  };
}

function bindingOf(
  ctx: CallContext,
  slot: Options['slots'][number],
  bindings: Bindings | null,
): SlotBinding {
  if (bindings === null) return { state: 'unknown', dataset_id: null, dataset_name: null };
  const id = bindings.bound[slot.slot];
  if (id !== undefined) {
    const named = slot.options.find((option) => option.id === id);
    return {
      state: 'bound',
      dataset_id: id,
      dataset_name: named === undefined ? null : content(ctx, named.name, NAME_LIMIT),
    };
  }
  return {
    state: bindings.stale.has(slot.slot) ? 'stale' : 'unbound',
    dataset_id: null,
    dataset_name: null,
  };
}

function itemOf(
  ctx: CallContext,
  slot: Options['slots'][number],
  bindings: Bindings | null,
): SlotItem {
  return {
    slot: content(ctx, slot.slot, NAME_LIMIT),
    label: slot.label === null ? null : content(ctx, slot.label, NAME_LIMIT),
    role: content(ctx, slot.role, 30),
    identity_kind: slot.identity_kind,
    columns: slot.columns.slice(0, COLUMNS_SHOWN).map((column) => content(ctx, column, NAME_LIMIT)),
    columns_total: slot.columns.length,
    never_fabricated_columns: slot.never_fabricated_columns
      .slice(0, COLUMNS_SHOWN)
      .map((column) => content(ctx, column, NAME_LIMIT)),
    generated: slot.generated === true,
    generated_rows: slot.generated_rows,
    binding: bindingOf(ctx, slot, bindings),
    options: slot.options.slice(0, OPTIONS_SHOWN).map((option) => ({
      id: option.id,
      name: content(ctx, option.name, NAME_LIMIT),
      rows: option.rows,
    })),
    options_total: slot.options.length,
  };
}

export const dataGetSlots = moduleTool(DATA_GET_SLOTS, {
  title: 'Get the data slots of a scenario or composition with compat…',
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario; default: the only one in this workspace.'),
    composition_id: uuidArgument().optional().describe('The composition (not with scenario_id).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const target = targetOf(ctx, args.scenario_id, args.composition_id);
    const [options, detail] = await settleAll(
      target.kind === 'scenario'
        ? ([
            getScenarioSlotOptions(ctx, { project_id: projectId, scenario_id: target.id }),
            optional(getScenario(ctx, { project_id: projectId, scenario_id: target.id })),
          ] as const)
        : ([
            getCompositionSlotOptions(ctx, { project_id: projectId, composition_id: target.id }),
            optional(getComposition(ctx, { project_id: projectId, composition_id: target.id })),
          ] as const),
    );
    const bindings = bindingsOf(detail);
    const slots = options.slots.map((slot) => itemOf(ctx, slot, bindings));
    const bound =
      bindings === null ? null : slots.filter((slot) => slot.binding.state === 'bound').length;
    const data: SlotsData = {
      project_id: projectId,
      target,
      count: slots.length,
      bound,
      bindings: bindings === null ? 'unknown' : 'read',
      slots,
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { target: target.id, bound: bound ?? 'unknown' } } },
    };
  },
  render: renderSlots,
});
