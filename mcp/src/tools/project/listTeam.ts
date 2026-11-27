// `project_list_team` (module project): List project members; me=true returns your own role and
// permissions.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The answers carry user ids, roles and dates only (no e-mail address, no name of a person),
// and the tool reads no other field; the ids and the roles pass the mask of a third party's text
// (`content`).
// Log: args "", result "{count} members": the data carries `count`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { renderListTeam, type MemberItem, type TeamData } from '../../render/project/listTeam.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { PROJECT_LIST_TEAM } from './meta.generated.js';

/** GET /projects/{project_id}/team (REST API v1) */
export function listTeamMembers(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'list_team_members_api_v1_projects__project_id__team_get'>> {
  return callBackend(ctx, 'list_team_members_api_v1_projects__project_id__team_get', { path });
}

/** GET /projects/{project_id}/team/me (REST API v1) */
export function getMyRole(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_my_role_api_v1_projects__project_id__team_me_get'>> {
  return callBackend(ctx, 'get_my_role_api_v1_projects__project_id__team_me_get', { path });
}

const MEMBERS_SHOWN = 50;

export const projectListTeam = moduleTool(PROJECT_LIST_TEAM, {
  title: 'List project members',
  input: {
    me: z
      .boolean()
      .default(false)
      .describe('true: your own role and permissions instead of the list.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.me) {
      const me = await getMyRole(ctx, path);
      const data: TeamData = {
        mode: 'me',
        project_id: projectId,
        count: 1,
        shown: 1,
        members: [],
        me: {
          user_id: thirdParty(ctx, me.user_id, LIMITS.label),
          role: thirdParty(ctx, me.role, 30),
          permissions: {
            admin: me.permissions.canAdmin,
            edit: me.permissions.canEdit,
            execute: me.permissions.canExecute,
          },
        },
      };
      return { status: 'done', data };
    }
    const team = await listTeamMembers(ctx, path);
    const members: MemberItem[] = team.slice(0, MEMBERS_SHOWN).map((member) => ({
      id: member.id,
      user_id: thirdParty(ctx, member.user_id, LIMITS.label),
      role: thirdParty(ctx, member.role, 30),
      added_by: member.added_by === null ? null : thirdParty(ctx, member.added_by, LIMITS.label),
      joined_at: member.created_at,
    }));
    const data: TeamData = {
      mode: 'list',
      project_id: projectId,
      count: team.length,
      shown: members.length,
      members,
      me: null,
    };
    return { status: 'done', data };
  },
  render: renderListTeam,
});
