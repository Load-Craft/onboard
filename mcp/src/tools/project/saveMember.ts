// `project_save_member` (module project): Save a project member: add one, or change a member's
// role.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Give {user_id} the role {role}", result "{user_id}: {role}": the data of the result
// carries the fields.
// Consent: level 2 (docs/consent-card.md). The first call reads the team and makes the card; a repeat
// with the same arguments asks the person; only their yes sends the write: a person who is not in the
// team is added (POST), one who is gets the new role (PUT). The backend takes a user id only (no
// e-mail address). A person who already has the role: nothing to ask, nothing sent.
// Undo: a changed role is this tool with the previous role; an added member is the removal
// (`project_delete`, kind member).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSaveMember,
  renderSaveMember,
  type MemberRole,
  type SaveMemberData,
  type SaveMemberFacts,
} from '../../render/project/saveMember.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { listTeamMembers } from './listTeam.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { PROJECT_SAVE_MEMBER } from './meta.generated.js';

/** POST /projects/{project_id}/team (REST API v1) */
export function addTeamMember(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'add_team_member_api_v1_projects__project_id__team_post'>,
): Promise<OpOutput<'add_team_member_api_v1_projects__project_id__team_post'>> {
  return callBackend(ctx, 'add_team_member_api_v1_projects__project_id__team_post', { path, body });
}

/** PUT /projects/{project_id}/team/{user_id} (REST API v1) */
export function changeMemberRole(
  ctx: CallContext,
  path: { readonly project_id: string; readonly user_id: string },
  body: BodyOf<'change_member_role_api_v1_projects__project_id__team__user_id__put'>,
): Promise<OpOutput<'change_member_role_api_v1_projects__project_id__team__user_id__put'>> {
  return callBackend(ctx, 'change_member_role_api_v1_projects__project_id__team__user_id__put', {
    path,
    body,
  });
}

const ROLES: readonly MemberRole[] = ['owner', 'editor', 'viewer'];
const isRole = (value: string): value is MemberRole => ROLES.some((role) => role === value);

/** The role the person has in the team now (null: not a member). */
async function roleNow(
  ctx: CallContext,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const team = await listTeamMembers(ctx, { project_id: projectId });
  return team.find((member) => member.user_id.toLowerCase() === userId)?.role ?? null;
}

export const projectSaveMember = moduleTool(PROJECT_SAVE_MEMBER, {
  title: 'Save a project member',
  input: {
    user_id: uuidArgument().describe(
      'The person to add or whose role changes (their user id, as project_list_team shows).',
    ),
    role: z.enum(['owner', 'editor', 'viewer']).describe('The role the person gets.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const userId = args.user_id.toLowerCase();
    const current = await roleNow(ctx, projectId, userId);
    if (current === args.role) {
      const data: SaveMemberData = {
        user_id: userId,
        role: args.role,
        previous_role: current,
        action: 'unchanged',
        undo: 'none',
      };
      return { unchanged: data };
    }
    const facts: SaveMemberFacts = {
      user_id: userId,
      role: args.role,
      previous: current === null ? null : thirdParty(ctx, current, LIMITS.label),
    };
    return { facts };
  },
  cardView: cardViewSaveMember,
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const userId = args.user_id.toLowerCase();
    // the team is read again: the write is the one that fits the team as it is now
    const current = await roleNow(ctx, projectId, userId);
    if (current === null) {
      await addTeamMember(ctx, path, { user_id: userId, role: args.role });
    } else {
      await changeMemberRole(ctx, { ...path, user_id: userId }, { role: args.role });
    }
    const undoable = current === null || isRole(current);
    const undoArgs =
      current === null
        ? { undo_tool: 'project_delete', kind: 'member', user_id: userId }
        : { undo_tool: 'project_save_member', user_id: userId, role: current };
    const data: SaveMemberData = {
      user_id: userId,
      role: args.role,
      previous_role: current === null ? null : thirdParty(ctx, current, LIMITS.label),
      action: current === null ? 'added' : 'changed',
      undo: !undoable ? 'withheld' : current === null ? 'removal' : 'role',
    };
    return {
      status: 'done',
      data,
      update: { log: { values: {}, ...(undoable ? { undo_args: undoArgs } : {}) } },
    };
  },
  render: renderSaveMember,
});
