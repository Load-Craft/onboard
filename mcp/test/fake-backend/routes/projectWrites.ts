// Routes of the module project (src/tools/project/) for the writes on a consent card: the team of a
// project (add a member, change a role). The members are those `seedTeamMember` stores. Registration
// is idempotent per fake.

import type { components } from '../../../src/http/generated/api.js';
import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';
import { SKLEP_COLLECTIONS } from '../worlds/sklep.js';
import { TEAM_MEMBERS, type StoredMember } from './project.js';

const registered = new WeakSet<Fake>();

type Role = components['schemas']['RoleEnum'];

const membersOf = (store: Store, projectId: string): StoredMember[] =>
  store
    .collection<StoredMember>(TEAM_MEMBERS)
    .list((entry) => entry.member.project_id === projectId);

export function registerProjectWriteRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);

  const requireProject = (store: Store, id: string): void => {
    store
      .collection<{ id: string }>(SKLEP_COLLECTIONS.projects)
      .require(id, `Project not found: ${id}`);
  };

  fake.route('POST', '/api/v1/projects/{project_id}/team', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as components['schemas']['AddMemberBody'];
    if (membersOf(store, req.params.project_id).some((m) => m.member.user_id === body.user_id)) {
      throw new FakeHttpError(409, { detail: 'Already a member of this project' });
    }
    const id = store.newId();
    const member = {
      id,
      project_id: req.params.project_id,
      user_id: body.user_id,
      role: body.role,
      added_by: null,
      created_at: '2026-11-27T12:00:00Z',
    };
    store.collection<StoredMember>(TEAM_MEMBERS).insert({ id, caller: false, member });
    return { status: 201, body: member };
  });

  fake.route('PUT', '/api/v1/projects/{project_id}/team/{user_id}', (req, store) => {
    requireProject(store, req.params.project_id);
    const body = req.body as { role: Role };
    const found = membersOf(store, req.params.project_id).find(
      (m) => m.member.user_id === req.params.user_id,
    );
    if (found === undefined) throw new FakeHttpError(404, { detail: 'Member not found' });
    const member = { ...found.member, role: body.role };
    store.collection<StoredMember>(TEAM_MEMBERS).update(found.id, { member });
    return { status: 200, body: member };
  });
}
