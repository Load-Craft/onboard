// The tools of module scenario. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { scenarioAskCopilot } from './askCopilot.js';
import { scenarioCompileComposition } from './compileComposition.js';
import { scenarioCheckDrift } from './checkDrift.js';
import { scenarioDelete } from './delete.js';
import { scenarioCheckComposition } from './checkComposition.js';
import { scenarioExport } from './export.js';
import { scenarioGet } from './get.js';
import { scenarioGetComposition } from './getComposition.js';
import { scenarioGetCompositionCode } from './getCompositionCode.js';
import { scenarioGetCopilotHistory } from './getCopilotHistory.js';
import { scenarioGetTemplates } from './getTemplates.js';
import { scenarioGetVersions } from './getVersions.js';
import { scenarioList } from './list.js';
import { scenarioRestoreVersion } from './restoreVersion.js';
import { scenarioSave } from './save.js';
import { scenarioSaveComposition } from './saveComposition.js';
import { scenarioSetCompositionType } from './setCompositionType.js';
import { scenarioUpdatePins } from './updatePins.js';
import { scenarioListCompositions } from './listCompositions.js';

export const tools: readonly ModuleTool[] = [
  scenarioAskCopilot,
  scenarioCompileComposition,
  scenarioCheckDrift,
  scenarioDelete,
  scenarioCheckComposition,
  scenarioExport,
  scenarioGet,
  scenarioGetComposition,
  scenarioGetCompositionCode,
  scenarioGetCopilotHistory,
  scenarioGetTemplates,
  scenarioGetVersions,
  scenarioList,
  scenarioListCompositions,
  scenarioRestoreVersion,
  scenarioSave,
  scenarioSaveComposition,
  scenarioSetCompositionType,
  scenarioUpdatePins,
];
