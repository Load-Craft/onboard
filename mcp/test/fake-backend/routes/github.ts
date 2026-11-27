// Routes of the module github: the link of the project to a repository, its recent syncs and the
// preview of a composition's push. Shapes are the contract's; a test puts its own answers in with the
// seeding functions, and a project without one is not linked.

import type { components } from '../../../src/http/generated/api.js';
import type { OpOutput } from '../../../src/http/operation.js';
import { FakeHttpError, type Fake } from '../server.js';
import type { Store } from '../store.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';

export type GithubStatus =
  OpOutput<'get_github_status_api_v1_projects__project_id__github_status_get'>;
export type GithubHistory =
  OpOutput<'get_sync_history_api_v1_projects__project_id__github_history_get'>;
export type GithubDiff =
  OpOutput<'get_diff_preview_api_v1_projects__project_id__github_diff_preview_get'>;

export const GITHUB_STATUS = 'github_status';
export const GITHUB_HISTORY = 'github_history';
export const GITHUB_DIFFS = 'github_diffs';
export const GITHUB_PULLS = 'github_pulls';
export const GITHUB_PUSHES = 'github_pushes';

export type GithubPushBody = components['schemas']['PushBody'];

/** The pushes the fake has taken, in order (what a test compares after a write). */
export function githubPushes(store: Store): readonly GithubPushBody[] {
  return store
    .collection<{ id: string; body: GithubPushBody }>(GITHUB_PUSHES)
    .list()
    .map((entry) => entry.body);
}

/** A project linked to a repository, synced once. */
export const LINKED: GithubStatus = {
  id: '0d0c7034-0007-4000-8000-000000000001',
  project_id: '0d0c7034-0007-4000-8000-000000000002',
  connected: true,
  repo_url: 'https://github.com/acme/shop-load',
  branch: 'main',
  hostname: 'github.com',
  auto_sync_enabled: true,
  has_webhook_secret: true,
  sync_status: 'idle',
  last_synced_at: '2026-11-26T10:00:00Z',
  last_synced_commit: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
  created_at: '2026-11-20T08:00:00Z',
  updated_at: '2026-11-26T10:00:00Z',
};

/** The answer of a project with no link. */
export const NOT_LINKED: GithubStatus = { connected: false, sync_status: 'not_configured' };

interface Stored<T> {
  readonly id: string;
  readonly value: T;
}

function put<T>(store: Store, name: string, projectId: string, value: T): void {
  const collection = store.collection<Stored<T>>(name);
  if (collection.get(projectId) !== undefined) collection.update(projectId, { value });
  else collection.insert({ id: projectId, value });
}

export function seedGithubStatus(store: Store, projectId: string, status: GithubStatus): void {
  put(store, GITHUB_STATUS, projectId, status);
}

/** The syncs of the project, newest first as given (the route keeps at most 50, as the backend). */
export function seedGithubHistory(
  store: Store,
  projectId: string,
  entries: GithubHistory['entries'],
): void {
  put(store, GITHUB_HISTORY, projectId, entries);
}

export type GithubPull = OpOutput<'pull_from_github_api_v1_projects__project_id__github_pull_post'>;

/**
 * What the next pull of the project lists. A pull moves the sync marker: the one after it answers an
 * empty list (the head it moved to stays), as the backend does.
 */
export function seedGithubPull(store: Store, projectId: string, pull: GithubPull): void {
  put(store, GITHUB_PULLS, projectId, pull);
}

/** The preview the push of `compositionId` would produce. */
export function seedGithubDiff(store: Store, compositionId: string, diff: GithubDiff): void {
  put(store, GITHUB_DIFFS, compositionId, diff);
}

const registered = new WeakSet<Fake>();

export function registerGithubRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  const project = (store: Store, projectId: string): void => {
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(projectId, `Project not found: ${projectId}`);
  };
  fake.route('GET', '/api/v1/projects/{project_id}/github/status', (req, store) => {
    project(store, req.params.project_id);
    const stored = store.collection<Stored<GithubStatus>>(GITHUB_STATUS).get(req.params.project_id);
    return { status: 200, body: stored?.value ?? NOT_LINKED };
  });
  fake.route('POST', '/api/v1/projects/{project_id}/github/push', (req, store) => {
    project(store, req.params.project_id);
    const status = store.collection<Stored<GithubStatus>>(GITHUB_STATUS).get(req.params.project_id);
    if (status?.value.connected !== true) {
      throw new FakeHttpError(404, { detail: 'No GitHub integration for this project' });
    }
    const body = req.body as GithubPushBody;
    const diff = store
      .collection<Stored<GithubDiff>>(GITHUB_DIFFS)
      .require(body.composite_id, 'Composition not found');
    const pushes = store.collection<{ id: string; body: GithubPushBody }>(GITHUB_PUSHES);
    pushes.insert({ id: store.newId(), body });
    const commit = (
      pushes.list().length.toString(16) + 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    ).slice(0, 40);
    const repo = (status.value.repo_url ?? '').replace(/\.git$/u, '');
    return {
      status: 200,
      body: {
        branch: body.create_pr ? 'loadcraft/update' : (status.value.branch ?? 'main'),
        commit_hash: commit,
        diff_summary: `+${String(diff.value.total_additions)} -${String(diff.value.total_deletions)}`,
        files_changed: diff.value.files.length,
        url: `${repo}/commit/${commit}`,
      },
    };
  });
  fake.route('POST', '/api/v1/projects/{project_id}/github/disconnect', (req, store) => {
    project(store, req.params.project_id);
    const statuses = store.collection<Stored<GithubStatus>>(GITHUB_STATUS);
    if (statuses.get(req.params.project_id) === undefined) {
      throw new FakeHttpError(404, { detail: 'No GitHub integration for this project' });
    }
    statuses.delete(req.params.project_id);
    return { status: 200, body: { status: 'disconnected' } };
  });
  fake.route('GET', '/api/v1/projects/{project_id}/github/history', (req, store) => {
    project(store, req.params.project_id);
    const stored = store
      .collection<Stored<GithubHistory['entries']>>(GITHUB_HISTORY)
      .get(req.params.project_id);
    const all = (stored?.value ?? []).slice(0, 50);
    const limit = Number(req.query['limit'] ?? '20');
    return { status: 200, body: { entries: all.slice(0, limit), total: all.length } };
  });
  fake.route('GET', '/api/v1/projects/{project_id}/github/diff-preview', (req, store) => {
    project(store, req.params.project_id);
    const id = req.query['composite_id'] ?? '';
    const stored = store
      .collection<Stored<GithubDiff>>(GITHUB_DIFFS)
      .require(id, `Composition not found: ${id}`);
    return { status: 200, body: stored.value };
  });
  fake.route('POST', '/api/v1/projects/{project_id}/github/pull', (req, store) => {
    project(store, req.params.project_id);
    const stored = store.collection<Stored<GithubPull>>(GITHUB_PULLS).get(req.params.project_id);
    if (stored === undefined) {
      return {
        status: 200,
        body: { changes: [], files_processed: 0, last_commit: '0'.repeat(40) },
      };
    }
    put(store, GITHUB_PULLS, req.params.project_id, {
      changes: [],
      files_processed: 0,
      last_commit: stored.value.last_commit,
    });
    return { status: 200, body: stored.value };
  });
}
