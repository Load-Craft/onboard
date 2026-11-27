// The tools of module project. `npm run gen:tools -- --scaffold <tool>` adds a tool here; the server
// offers a tool to the client once its file has `run` and `render` (docs/module-tools.md).

import type { ModuleTool } from '../moduleTool.js';
import { projectDisconnectTelemetry } from './disconnectTelemetry.js';
import { projectGetActivity } from './getActivity.js';
import { projectGetApimap } from './getApimap.js';
import { projectGetDocs } from './getDocs.js';
import { projectGetEndpoints } from './getEndpoints.js';
import { projectGetEnvs } from './getEnvs.js';
import { projectGetHttpSettings } from './getHttpSettings.js';
import { projectList } from './list.js';
import { projectListNotes } from './listNotes.js';
import { projectListTeam } from './listTeam.js';
import { projectSaveMember } from './saveMember.js';
import { projectSetActiveDocs } from './setActiveDocs.js';
import { projectSetApimap } from './setApimap.js';
import { projectSetHttpSettings } from './setHttpSettings.js';
import { projectUpdate } from './update.js';
import { projectUpdateNote } from './updateNote.js';

export const tools: readonly ModuleTool[] = [
  projectDisconnectTelemetry,
  projectGetActivity,
  projectGetApimap,
  projectGetDocs,
  projectGetEndpoints,
  projectGetEnvs,
  projectGetHttpSettings,
  projectList,
  projectListNotes,
  projectListTeam,
  projectSaveMember,
  projectSetActiveDocs,
  projectSetApimap,
  projectSetHttpSettings,
  projectUpdate,
  projectUpdateNote,
];
