// `scenario_get_versions` (module scenario): Get a scenario's versions: the list, or one with its
// code (literals masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The reasons of the changes are third-party text and pass `content`; the stored artifact of
// one version is a recorded body and passes `body` (see artifact.ts). The list is cut to the newest
// versions; its count says how many there are.
// Log: args "{scenario_id}", result "{count} versions": the data of the result carries the count.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderScenarioVersions,
  type VersionItem,
  type VersionsData,
} from '../../render/scenario/getVersions.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { artifactOf } from './artifact.js';
import { scenarioIdOf } from './scenarioId.js';
import { SCENARIO_GET_VERSIONS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/versions (REST API v1) */
export function listScenarioVersions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'list_scenario_versions_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions_get'>
> {
  return callBackend(
    ctx,
    'list_scenario_versions_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/versions/{version} (REST API v1) */
export function getScenarioVersion(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string; readonly version: number },
): Promise<
  OpOutput<'get_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__get'>
> {
  return callBackend(
    ctx,
    'get_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__get',
    { path },
  );
}

const VERSIONS_SHOWN = 50;
const REASON_LIMIT = 200;

type Listed =
  OpOutput<'list_scenario_versions_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions_get'>['versions'][number];
type One =
  OpOutput<'get_scenario_version_api_v1_projects__project_id__gatling_scenarios__scenario_id__versions__version__get'>;

function itemOf(ctx: CallContext, entry: Listed): VersionItem {
  return {
    version: entry.version,
    id: entry.id,
    created_at: entry.created_at,
    change_reason:
      entry.change_reason === null ? null : content(ctx, entry.change_reason, REASON_LIMIT),
    has_artifact_snapshot: entry.has_artifact_snapshot,
    cut: entry.truncate_after_block_id_snapshot !== null,
  };
}

function itemOfOne(ctx: CallContext, entry: One): VersionItem {
  return {
    version: entry.version,
    id: entry.id,
    created_at: entry.created_at,
    change_reason:
      entry.change_reason === null ? null : content(ctx, entry.change_reason, REASON_LIMIT),
    has_artifact_snapshot: entry.scenario_artifact_snapshot !== null,
    cut: entry.truncate_after_block_id_snapshot !== null,
  };
}

export const scenarioGetVersions = moduleTool(SCENARIO_GET_VERSIONS, {
  title: "Get a scenario's versions",
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario; default: the only one in this workspace.'),
    version: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .optional()
      .describe('One version with its stored artifact (literals masked); without it, the list.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = scenarioIdOf(ctx, args.scenario_id);
    const path = { project_id: projectId, scenario_id: scenarioId };
    const log = { values: { scenario_id: scenarioId } };
    if (args.version !== undefined) {
      const entry = await getScenarioVersion(ctx, { ...path, version: args.version });
      const data: VersionsData = {
        mode: 'one',
        project_id: projectId,
        scenario_id: scenarioId,
        count: 1,
        shown: 1,
        versions: [itemOfOne(ctx, entry)],
        artifact: artifactOf(ctx, entry.scenario_artifact_snapshot),
      };
      return { status: 'done', data, update: { log } };
    }
    const { versions } = await listScenarioVersions(ctx, path);
    const newest = [...versions]
      .sort((a, b) => b.version - a.version)
      .slice(0, VERSIONS_SHOWN)
      .map((entry) => itemOf(ctx, entry));
    const data: VersionsData = {
      mode: 'list',
      project_id: projectId,
      scenario_id: scenarioId,
      count: versions.length,
      shown: newest.length,
      versions: newest,
      artifact: null,
    };
    return { status: 'done', data, update: { log } };
  },
  render: renderScenarioVersions,
});
