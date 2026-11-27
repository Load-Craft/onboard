// The tools of module flows. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { flowsApplyCopilotChanges } from './applyCopilotChanges.js';
import { flowsAskCopilot } from './askCopilot.js';
import { flowsDuplicate } from './duplicate.js';
import { flowsExportWalkImage } from './exportWalkImage.js';
import { flowsGet } from './get.js';
import { flowsGetCopilotHistory } from './getCopilotHistory.js';
import { flowsGetVersions } from './getVersions.js';
import { flowsGetWalks } from './getWalks.js';
import { flowsList } from './list.js';
import { flowsMerge } from './merge.js';
import { flowsRegenerate } from './regenerate.js';
import { flowsRestoreVersion } from './restoreVersion.js';
import { flowsSave } from './save.js';
import { flowsSaveWalkNote } from './saveWalkNote.js';
import { flowsSetPollTerminals } from './setPollTerminals.js';

export const tools: readonly ModuleTool[] = [
  flowsApplyCopilotChanges,
  flowsAskCopilot,
  flowsDuplicate,
  flowsExportWalkImage,
  flowsGet,
  flowsGetCopilotHistory,
  flowsGetVersions,
  flowsGetWalks,
  flowsList,
  flowsMerge,
  flowsRegenerate,
  flowsRestoreVersion,
  flowsSave,
  flowsSaveWalkNote,
  flowsSetPollTerminals,
];
