// `scenario_list` (module scenario): List the project's scenarios: name, source flow, version,
// self-check state.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The names are what a person or the generator wrote, so they pass the mask of a third
// party's text (`content`); the artifact and the slot detail of the answer are never read.
// Log: args "", result "{count} scenarios": the data of the result carries the field.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderScenarioList,
  type ScenarioItem,
  type ScenarioListData,
} from '../../render/scenario/list.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { SCENARIO_LIST } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/scenarios (REST API v1) */
export function listScenarios(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get'>,
): Promise<OpOutput<'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get'>> {
  return callBackend(ctx, 'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

const NAME_LIMIT = 120;

type Summary =
  OpOutput<'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get'>['scenarios'][number];

function itemOf(ctx: CallContext, scenario: Summary): ScenarioItem {
  const check = scenario.self_check;
  return {
    id: scenario.id,
    name: content(ctx, scenario.name, NAME_LIMIT),
    source_flow_id: scenario.source_flow_id,
    source_flow_version: scenario.source_flow_version,
    version: scenario.current_version,
    self_check: check === null ? null : { status: check.status, version: check.scenario_version },
    generator_state: scenario.generator_state,
    slots: scenario.feeder_slots.length,
    updated_at: scenario.updated_at,
  };
}

export const scenarioList = moduleTool(SCENARIO_LIST, {
  title: "List the project's scenarios",
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many scenarios to return (1-200).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const answer = await listScenarios(ctx, { project_id: projectId }, { limit: args.limit });
    const scenarios = answer.scenarios.map((scenario) => itemOf(ctx, scenario));
    const data: ScenarioListData = {
      project_id: projectId,
      count: answer.total,
      shown: scenarios.length,
      scenarios,
    };
    return { status: 'done', data };
  },
  render: renderScenarioList,
});
