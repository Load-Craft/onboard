// The tools of module project. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { projectListNotes } from './listNotes.js';

export const tools: readonly ModuleTool[] = [projectListNotes];
