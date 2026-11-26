// Deletion routes of the fake backend: one project or several (with its flows), one flow or several,
// and the two cheap counts a deletion card reads that no other route set answers (the AsyncAPI docs
// versions and the functional runs of a project, both counted by the backend for the whole project).
// The backend refuses to delete a project while a browser walk of it is still working (409
// `run_not_finished`, nothing deleted); `refuseProjectDeletion` makes the fake answer so.

import type { components } from '../../../src/http/generated/api.js';
import { FakeHttpError, type Fake, type Store } from '../server.js';
import { FLOW_COLLECTIONS } from './flows.js';

type ProjectDetail = components['schemas']['ProjectDetail'];
type FlowDetail = components['schemas']['FlowDetail'];

const registered = new WeakSet<Fake>();
const refusing = new WeakSet<Fake>();

/** From now on the fake refuses every project deletion, as the backend does while a walk works. */
export function refuseProjectDeletion(fake: Fake): void {
  refusing.add(fake);
}

function refuseWhileWalking(fake: Fake): void {
  if (!refusing.has(fake)) return;
  throw new FakeHttpError(409, {
    detail: {
      code: 'run_not_finished',
      message:
        'A run of this project is still working — driving, driving one of its paths again, or ' +
        'closing its review. Delete the project once it is done.',
    },
  });
}

/** Deletes a project and its flows; false when there is no such project. */
function deleteProject(store: Store, id: string): boolean {
  const projects = store.collection<ProjectDetail>(FLOW_COLLECTIONS.projects);
  if (projects.get(id) === undefined) return false;
  const flows = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  for (const flow of flows.list((item) => item.project_id === id)) flows.delete(flow.id);
  return projects.delete(id);
}

function deleteFlow(store: Store, projectId: string, id: string): boolean {
  const flows = store.collection<FlowDetail>(FLOW_COLLECTIONS.flows);
  const flow = flows.get(id);
  if (flow === undefined || flow.project_id !== projectId) return false;
  return flows.delete(id);
}

function requireProject(store: Store, id: string): void {
  store
    .collection<ProjectDetail>(FLOW_COLLECTIONS.projects)
    .require(id, `Project not found: ${id}`);
}

export function registerDeletionRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  fake.route('DELETE', '/api/v1/projects/{project_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    refuseWhileWalking(fake);
    deleteProject(store, req.params.project_id);
    return { status: 200, body: { deleted: true, message: 'Project deleted' } };
  });

  fake.route('POST', '/api/v1/projects/batch-delete', (req, store) => {
    const ids = (req.body as { project_ids: string[] }).project_ids;
    refuseWhileWalking(fake);
    const seen = new Set<string>();
    const failed: string[] = [];
    let deleted = 0;
    for (const id of ids) {
      if (seen.has(id) || !deleteProject(store, id)) failed.push(id);
      else deleted += 1;
      seen.add(id);
    }
    return { status: 200, body: { deleted_count: deleted, failed_ids: failed } };
  });

  fake.route('DELETE', '/api/v1/projects/{project_id}/flows/{flow_id}', (req, store) => {
    if (!deleteFlow(store, req.params.project_id, req.params.flow_id)) {
      throw new FakeHttpError(404, { detail: `Flow not found: ${req.params.flow_id}` });
    }
    return { status: 200, body: { deleted: true, message: 'Flow deleted' } };
  });

  fake.route('POST', '/api/v1/projects/{project_id}/flows/batch-delete', (req, store) => {
    const ids = (req.body as { flow_ids: string[] }).flow_ids;
    const seen = new Set<string>();
    const failed: string[] = [];
    let deleted = 0;
    for (const id of ids) {
      if (seen.has(id) || !deleteFlow(store, req.params.project_id, id)) failed.push(id);
      else deleted += 1;
      seen.add(id);
    }
    return { status: 200, body: { deleted_count: deleted, failed_ids: failed } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/asyncapi-specs', (req, store) => {
    requireProject(store, req.params.project_id);
    return { status: 200, body: { specs: [], total: 0, current_spec_id: null } };
  });

  fake.route('GET', '/api/v1/projects/{project_id}/executions', (req, store) => {
    requireProject(store, req.params.project_id);
    return { status: 200, body: { executions: [], total: 0 } };
  });
}
