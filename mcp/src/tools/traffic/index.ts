// The tools of module traffic. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { trafficDelete } from './delete.js';
import { trafficGetPushSetup } from './getPushSetup.js';
import { trafficGetSnapshot } from './getSnapshot.js';
import { trafficListSnapshots } from './listSnapshots.js';

export const tools: readonly ModuleTool[] = [
  trafficDelete,
  trafficGetPushSetup,
  trafficGetSnapshot,
  trafficListSnapshots,
];
