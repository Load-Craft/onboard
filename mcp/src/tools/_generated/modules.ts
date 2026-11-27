/**
 * Generated file - do not edit.
 * Source: the modules of catalog/katalog.json. Regenerate with "npm run gen:tools" (from mcp/).
 */

import type { ModuleName } from '../../catalog.generated.js';
import { exposedTools, type ModuleTool } from '../moduleTool.js';
import { tools as processTools } from '../process/index.js';
import { tools as projectTools } from '../project/index.js';
import { tools as flowsTools } from '../flows/index.js';
import { tools as scenarioTools } from '../scenario/index.js';
import { tools as dataTools } from '../data/index.js';
import { tools as runTools } from '../run/index.js';
import { tools as resultsTools } from '../results/index.js';
import { tools as trafficTools } from '../traffic/index.js';
import { tools as functionalTools } from '../functional/index.js';
import { tools as githubTools } from '../github/index.js';

/** The tools of each module, as its `index.ts` lists them, the ones not written yet included. */
export const MODULE_INDEX: Readonly<Record<ModuleName, readonly ModuleTool[]>> = {
  process: processTools,
  project: projectTools,
  flows: flowsTools,
  scenario: scenarioTools,
  data: dataTools,
  run: runTools,
  results: resultsTools,
  traffic: trafficTools,
  functional: functionalTools,
  github: githubTools,
};

/** Every tool of the modules; one without `run` and `render` answers `not_implemented`. */
export const MODULE_TOOLS: readonly ModuleTool[] = Object.values(MODULE_INDEX).flat();

/** The tools of the modules the server offers to the client: the written ones only. */
export const EXPOSED_MODULE_TOOLS: readonly ModuleTool[] = exposedTools(MODULE_TOOLS);
