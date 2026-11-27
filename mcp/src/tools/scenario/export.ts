// `scenario_export` (module scenario): Export the scenario's Gatling project as a local ZIP and
// return its path (dataset secrets masked).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The ZIP is saved under `loadcraft/exports/` of the workspace (exportFile.ts) and never read:
// the model sees its size and its path, relative to the workspace, not one name from inside it.
// Log: args "{scenario_id}", result "{path}": the log values carry both.

import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderRecipeFile,
  renderScenarioExport,
  type ExportData,
  type ExportDataset,
} from '../../render/scenario/export.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { checkExportTarget, saveExport, saveRecipe } from './exportFile.js';
import { readRecipe } from './exportRecipe.js';
import { getScenario } from './get.js';
import { scenarioIdOf } from './scenarioId.js';
import { SCENARIO_EXPORT } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/scenarios/{scenario_id}/export (REST API v1) */
export function exportScenarioProject(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
): Promise<
  OpOutput<'export_scenario_project_api_v1_projects__project_id__gatling_scenarios__scenario_id__export_get'>
> {
  return callBackend(
    ctx,
    'export_scenario_project_api_v1_projects__project_id__gatling_scenarios__scenario_id__export_get',
    { path },
  );
}

type Slot = { file: string; columns: readonly string[]; role: 'auth' | 'data' | null };
const NAME_LIMIT = 80;
const MAX_DATASETS = 30;

/** The dataset slots of the scenario: the file each reads and its columns; none when the read fails. */
async function slotsOf(
  ctx: CallContext,
  projectId: string,
  scenarioId: string,
): Promise<readonly Slot[]> {
  try {
    const detail = await getScenario(ctx, { project_id: projectId, scenario_id: scenarioId });
    return detail.feeder_slots.map((slot) => ({
      file: slot.default_file ?? '',
      columns: slot.columns ?? [],
      role: slot.role === 'auth' || slot.role === 'data' ? slot.role : null,
    }));
  } catch (error) {
    if (error instanceof LoadcraftApiError) return [];
    throw error;
  }
}

/** The dataset files to bring: those the configuration reads, else the slots' own; columns by name only. */
function datasetsOf(
  ctx: CallContext,
  files: readonly string[] | undefined,
  slots: readonly Slot[],
): ExportDataset[] {
  const names = files ?? slots.map((slot) => slot.file).filter((file) => file !== '');
  const seen = new Set<string>();
  const out: ExportDataset[] = [];
  for (const file of names) {
    if (seen.has(file)) continue;
    seen.add(file);
    const slot = slots.find((item) => item.file === file);
    out.push({
      file: content(ctx, file, NAME_LIMIT),
      columns: (slot?.columns ?? [])
        .slice(0, MAX_DATASETS)
        .map((name) => content(ctx, name, NAME_LIMIT)),
      role: slot?.role ?? null,
    });
  }
  return out.slice(0, MAX_DATASETS);
}

export const scenarioExport = moduleTool(SCENARIO_EXPORT, {
  title: "Export the scenario's Gatling project",
  input: {
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario; default: the only one in this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const scenarioId = scenarioIdOf(ctx, args.scenario_id);
    const root = ctx.config.stateRoot;
    // the folders first, then the backend: a workspace that cannot take the file asks nothing
    checkExportTarget(root);
    const blob = await exportScenarioProject(ctx, {
      project_id: projectId,
      scenario_id: scenarioId,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = saveExport(root, scenarioId, bytes);
    // what the project needs that the ZIP does not hold: from its own configuration (names only) and
    // from the dataset slots of the scenario (columns, names only); the datasets themselves are never read
    const recipe = readRecipe(bytes);
    const slots = await slotsOf(ctx, projectId, scenarioId);
    const datasets = datasetsOf(ctx, recipe?.datasetFiles, slots);
    const draft: ExportData = {
      project_id: projectId,
      scenario_id: scenarioId,
      path,
      bytes: bytes.byteLength,
      datasets_omitted: true,
      conf_read: recipe !== undefined,
      folder: recipe?.folder ?? null,
      datasets,
      env_vars: recipe?.envVars ?? [],
      recipe: null,
    };
    const recipePath = saveRecipe(root, path, renderRecipeFile(draft, ctx.t));
    const data: ExportData = { ...draft, recipe: recipePath };
    return {
      status: 'done',
      data,
      update: { log: { values: { scenario_id: scenarioId, path } } },
    };
  },
  render: renderScenarioExport,
});
