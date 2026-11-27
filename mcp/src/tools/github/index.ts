// The tools of module github. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { githubDisconnect } from './disconnect.js';
import { githubGetChanges } from './getChanges.js';
import { githubGetStatus } from './getStatus.js';
import { githubPlanPush } from './planPush.js';
import { githubPush } from './push.js';

export const tools: readonly ModuleTool[] = [
  githubDisconnect,
  githubGetChanges,
  githubGetStatus,
  githubPlanPush,
  githubPush,
];
