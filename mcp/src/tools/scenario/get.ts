// `scenario_get` (module scenario): Get a scenario: status, self-check, data slots; include adds
// the variable contract, drift and stored artifact (masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A scenario's texts (name, description, notes, the failure message, labels) are third-party
// text and pass `content`; the stored artifact is a recorded body and passes `body`: shown masked,
// or hidden whole when the mask cannot read it. The contract and the drift score are auxiliary
// reads: an API error there leaves the scenario and marks the part unavailable.
// Log: args "{scenario_id}", result "{name} v{version}; self-check {self_check}": the log values
// carry the id as resolved, the name, the version and the status of the check ("none" without one).
// State: a finished self-check sets the self-check check of the scenario step (passed: ok, failed: not ok).

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderScenarioGet,
  type ContractView,
  type DriftView,
  type ScenarioDetailView,
  type ScenarioGetData,
  type SelfCheckView,
  type SlotItem,
} from '../../render/scenario/get.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { artifactOf } from './artifact.js';
import { scenarioIdOf } from './scenarioId.js';
import { SCENARIO_GET } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id} (REST API v1) */
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

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/contract (REST API v1) */
export function getScenarioContract(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'get_scenario_contract_api_v1_projects__project_id__gatling_scenarios__scenario_id__contract_get'>
> {
  return callBackend(
    ctx,
    'get_scenario_contract_api_v1_projects__project_id__gatling_scenarios__scenario_id__contract_get',
    { path },
  );
}

/** GET /scenarios/{scenario_id}/staleness (REST API v1) */
export function getStaleness(
  ctx: CallContext,
  path: { readonly scenario_id: string },
): Promise<OpOutput<'get_staleness_api_scenarios__scenario_id__staleness_get'>> {
  return callBackend(ctx, 'get_staleness_api_scenarios__scenario_id__staleness_get', { path });
}

const TEXT_LIMIT = 200;
const NAMES_SHOWN = 40;
const SLOTS_SHOWN = 40;
const NOTES_SHOWN = 10;

type Detail =
  OpOutput<'get_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__get'>;
type Contract =
  OpOutput<'get_scenario_contract_api_v1_projects__project_id__gatling_scenarios__scenario_id__contract_get'>;

const text = (ctx: CallContext, value: string, max = TEXT_LIMIT): string =>
  content(ctx, value, max);

function names(ctx: CallContext, values: readonly string[] | undefined): string[] {
  return (values ?? []).slice(0, NAMES_SHOWN).map((value) => text(ctx, value, 80));
}

/** The step that failed in the latest run of the check: where the failure of the check says nothing. */
function failedStepOf(check: NonNullable<Detail['self_check']>): {
  readonly name: string | null;
  readonly status: number | null;
} {
  const run = check.runs.at(-1);
  const step = run?.steps.find((candidate) => candidate.result === 'failed');
  return { name: step?.name ?? null, status: step?.http_status ?? null };
}

function checkOf(ctx: CallContext, detail: Detail): SelfCheckView | null {
  const check = detail.self_check;
  if (check === null) return null;
  const failed = check.failure === null ? null : failedStepOf(check);
  return {
    status: check.status,
    version: check.scenario_version,
    notes: check.notes.slice(0, NOTES_SHOWN).map((note) => text(ctx, note)),
    missing_slots: names(ctx, check.missing_slots),
    repairs: check.repairs.length,
    failure:
      check.failure === null
        ? null
        : {
            request_name:
              (check.failure.request_name ?? failed?.name) === null ||
              (check.failure.request_name ?? failed?.name) === undefined
                ? null
                : text(ctx, check.failure.request_name ?? failed?.name ?? '', 80),
            http_status: check.failure.http_status ?? failed?.status ?? null,
            message: text(ctx, check.failure.message),
          },
  };
}

function slotsOf(ctx: CallContext, detail: Detail): SlotItem[] {
  const states = new Map(detail.slot_binding_states.map((entry) => [entry.slot, entry.state]));
  return detail.feeder_slots.slice(0, SLOTS_SHOWN).map((slot) => {
    const slotName = slot.slot ?? '';
    const state = states.get(slotName);
    const bound = slotName in detail.slot_bindings;
    return {
      slot: text(ctx, slotName, 80),
      label: slot.label === null || slot.label === undefined ? null : text(ctx, slot.label, 80),
      role: slot.role ?? null,
      identity_kind: slot.identity_kind ?? null,
      strategy: slot.strategy === undefined ? null : text(ctx, slot.strategy, 40),
      binding: state === 'stale' ? 'stale' : bound ? 'bound' : 'unbound',
    };
  });
}

function detailOf(ctx: CallContext, detail: Detail): ScenarioDetailView {
  return {
    id: detail.id,
    name: text(ctx, detail.name, 120),
    description:
      detail.description === null || detail.description === ''
        ? null
        : text(ctx, detail.description, 300),
    version: detail.current_version,
    is_active: detail.is_active,
    class_name: text(ctx, detail.simulation_class_name, 120),
    source_flow_id: detail.source_flow_id,
    source_flow_version: detail.source_flow_version,
    generator_state: detail.generator_state,
    tags: detail.tags.slice(0, NAMES_SHOWN).map((tag) => text(ctx, tag, 60)),
    self_check: checkOf(ctx, detail),
    slots: slotsOf(ctx, detail),
  };
}

function contractOf(ctx: CallContext, answer: Contract): ContractView {
  const contract = answer.contract_v2;
  return {
    required_inputs: names(ctx, contract.required_inputs ?? contract.inputs),
    exports: names(ctx, contract.exports ?? contract.outputs),
    session_vars: names(ctx, contract.session_vars),
    control_vars: names(ctx, contract.control_vars),
    locals: names(ctx, contract.locals),
  };
}

/** An auxiliary read: an API error of the backend leaves the part out, anything else ends the call. */
async function optional<T>(read: Promise<T>): Promise<{ value: T } | { status: number }> {
  try {
    return { value: await read };
  } catch (error) {
    if (error instanceof LoadcraftApiError) return { status: error.status };
    throw error;
  }
}

/** The verdict of a finished check for the state; a check still running or paused says nothing. */
function verdictOf(status: string | undefined): boolean | undefined {
  if (status === 'passed' || status === 'passed_after_repair') return true;
  if (status === 'failed' || status === 'goal_step_missing') return false;
  return undefined;
}

export const scenarioGet = moduleTool(SCENARIO_GET, {
  title: 'Get a scenario',
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario; default: the only one in this workspace.'),
    include: z
      .array(z.enum(['contract', 'drift', 'artifact']))
      .max(3)
      .optional()
      .describe(
        'contract: the session-variable contract; drift: the drift score; artifact: the stored scenario artifact (literals masked).',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = scenarioIdOf(ctx, args.scenario_id);
    const wants = new Set(args.include ?? []);
    const path = { project_id: projectId, scenario_id: scenarioId };
    const [detail, contract, drift] = await settleAll([
      getScenario(ctx, path),
      wants.has('contract') ? optional(getScenarioContract(ctx, path)) : Promise.resolve(null),
      wants.has('drift')
        ? optional(getStaleness(ctx, { scenario_id: scenarioId }))
        : Promise.resolve(null),
    ]);
    const scenario = detailOf(ctx, detail);
    const contractView =
      contract !== null && 'value' in contract ? contractOf(ctx, contract.value) : null;
    const driftView: DriftView | null =
      drift === null
        ? null
        : 'value' in drift
          ? {
              state: 'read',
              score: drift.value.staleness_score,
              checked_at: drift.value.checked_at,
            }
          : { state: drift.status === 404 ? 'none' : 'unavailable' };
    const data: ScenarioGetData = {
      project_id: projectId,
      scenario,
      contract: contractView,
      contract_state: contract === null ? 'none' : contractView === null ? 'unavailable' : 'read',
      drift: driftView,
      artifact: wants.has('artifact') ? artifactOf(ctx, detail.scenario_artifact) : null,
    };
    const verdict = verdictOf(scenario.self_check?.status);
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            scenario_id: scenarioId,
            name: scenario.name,
            version: scenario.version,
            self_check: scenario.self_check?.status ?? 'none',
          },
        },
        ...(verdict === undefined ? {} : { checks: { scenario: { self_check: { ok: verdict } } } }),
      },
    };
  },
  render: renderScenarioGet,
});
