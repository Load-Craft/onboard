// Routes of the tools of module project (src/tools/project/) that no other route file answers. The
// notes the agent learned about a project are kept in their own collection; a test seeds them with
// `seedProjectNotes`. Registration is idempotent per fake (`registerAllRoutes` and a tool test may
// both call it).

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

type AgentGuidanceEntry = components['schemas']['AgentGuidanceEntry'];

/** The collection of the notes, by project. */
export const PROJECT_NOTES = 'project_agent_guidance';

interface StoredNote {
  readonly id: string;
  readonly project_id: string;
  readonly entry: AgentGuidanceEntry;
}

/** Adds notes to a project, in the order the backend returns them. */
export function seedProjectNotes(
  store: Store,
  projectId: string,
  notes: readonly AgentGuidanceEntry[],
): void {
  const collection = store.collection<StoredNote>(PROJECT_NOTES);
  for (const note of notes) {
    collection.insert({ id: store.newId(), project_id: projectId, entry: note });
  }
}

const registered = new WeakSet<Fake>();

export function registerProjectModuleRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  // The notes of the project, as stored: an unknown project is a 404.
  fake.route('GET', '/api/v1/projects/{project_id}/agent-guidance', (req, store) => {
    const projectId = req.params.project_id;
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
    const notes = store
      .collection<StoredNote>(PROJECT_NOTES)
      .list((note) => note.project_id === projectId)
      .map((note) => note.entry);
    return { status: 200, body: notes };
  });
}
