// The tools of module run. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { runDelete } from './delete.js';
import { runGet } from './get.js';
import { runGetProfiles } from './getProfiles.js';
import { runGetSaved } from './getSaved.js';
import { runGetUsage } from './getUsage.js';
import { runList } from './list.js';
import { runSave } from './save.js';
import { runSaveProfile } from './saveProfile.js';

export const tools: readonly ModuleTool[] = [
  runDelete,
  runGet,
  runGetProfiles,
  runGetSaved,
  runGetUsage,
  runList,
  runSave,
  runSaveProfile,
];
