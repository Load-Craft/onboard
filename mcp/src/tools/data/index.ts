// The tools of module data. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { dataAskCopilot } from './askCopilot.js';
import { dataDelete } from './delete.js';
import { dataGenerateDataset } from './generateDataset.js';
import { dataGetCopilotHistory } from './getCopilotHistory.js';
import { dataGetDataset } from './getDataset.js';
import { dataGetGenerators } from './getGenerators.js';
import { dataGetSlots } from './getSlots.js';
import { dataListDatasets } from './listDatasets.js';
import { dataRegenerateDataset } from './regenerateDataset.js';
import { dataRestoreDataset } from './restoreDataset.js';
import { dataSetSlotLabel } from './setSlotLabel.js';
import { dataUpdateDataset } from './updateDataset.js';

export const tools: readonly ModuleTool[] = [
  dataAskCopilot,
  dataDelete,
  dataGenerateDataset,
  dataGetCopilotHistory,
  dataGetDataset,
  dataGetGenerators,
  dataGetSlots,
  dataListDatasets,
  dataRegenerateDataset,
  dataRestoreDataset,
  dataSetSlotLabel,
  dataUpdateDataset,
];
