// The tools of module functional. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { functionalCompareRuns } from './compareRuns.js';
import { functionalDelete } from './delete.js';
import { functionalGenerateTestTypes } from './generateTestTypes.js';
import { functionalGeneratePayloads } from './generatePayloads.js';
import { functionalGetAnalytics } from './getAnalytics.js';
import { functionalGetCatalog } from './getCatalog.js';
import { functionalGetFlows } from './getFlows.js';
import { functionalGetResults } from './getResults.js';
import { functionalGetRuns } from './getRuns.js';
import { functionalGetTemplates } from './getTemplates.js';
import { functionalGetTestTypes } from './getTestTypes.js';
import { functionalGetValidators } from './getValidators.js';
import { functionalRestoreFlow } from './restoreFlow.js';
import { functionalSaveCatalog } from './saveCatalog.js';
import { functionalSuggestTestTypes } from './suggestTestTypes.js';
import { functionalSaveFlow } from './saveFlow.js';
import { functionalSaveTemplate } from './saveTemplate.js';
import { functionalSaveTestTypes } from './saveTestTypes.js';
import { functionalSaveValidators } from './saveValidators.js';
import { functionalSuggestValidators } from './suggestValidators.js';

export const tools: readonly ModuleTool[] = [
  functionalCompareRuns,
  functionalDelete,
  functionalGenerateTestTypes,
  functionalGeneratePayloads,
  functionalGetAnalytics,
  functionalGetCatalog,
  functionalGetFlows,
  functionalGetResults,
  functionalGetRuns,
  functionalGetTemplates,
  functionalGetTestTypes,
  functionalGetValidators,
  functionalRestoreFlow,
  functionalSaveCatalog,
  functionalSaveFlow,
  functionalSuggestTestTypes,
  functionalSaveTemplate,
  functionalSaveTestTypes,
  functionalSaveValidators,
  functionalSuggestValidators,
];
