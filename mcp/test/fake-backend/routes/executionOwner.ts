// Whose run a result route reads. The backend answers a run the path project does not have (an
// unknown run, a run of another project) with one 404, `Execution {id} not found`, before it reads
// any store; every result route of the fake asks here first.

import type { Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS, type SklepExecution } from '../worlds/sklep.js';
import { STARTED_RUNS, type StartedRun } from './executions.js';

const OWNERS = 'results_execution_owners';

/** Makes `executionId` a run of project `projectId`, another project than the world's. */
export function seedExecutionOwner(store: Store, executionId: string, projectId: string): void {
  const owners = store.collection<{ id: string; project: string }>(OWNERS);
  owners.delete(executionId);
  owners.insert({ id: executionId, project: projectId });
}

/**
 * The backend's 404 for a run the path project does not have: one neither recorded nor started on
 * the fake (a run under way is a run of the backend too, before its record is written), or a run of
 * another project. A run nobody seeded an owner for is the world's project's. Without `projectId`
 * only the run's existence is checked.
 */
export function requireRun(store: Store, executionId: string, projectId?: string): void {
  const recorded = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).get(executionId);
  const started = store.collection<StartedRun>(STARTED_RUNS).get(executionId);
  const owner = store.collection<{ id: string; project: string }>(OWNERS).get(executionId);
  const foreign =
    projectId !== undefined &&
    (store.collection(SKLEP_COLLECTIONS.projects).get(projectId) === undefined ||
      (owner !== undefined && owner.project !== projectId));
  if ((recorded === undefined && started === undefined) || foreign) {
    throw new FakeHttpError(404, { detail: `Execution ${executionId} not found` });
  }
}

/** The record of the run `executionId` of the path project, or the backend's 404 for it. */
export function requireExecution(
  store: Store,
  executionId: string,
  projectId?: string,
): SklepExecution {
  requireRun(store, executionId, projectId);
  const execution = store.collection<SklepExecution>(SKLEP_COLLECTIONS.executions).get(executionId);
  if (execution === undefined) {
    throw new FakeHttpError(404, { detail: `Execution ${executionId} not found` });
  }
  return execution;
}
