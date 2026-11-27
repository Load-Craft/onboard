// The view of `project_list_team`: one line per member with the role, the id and the date of joining,
// or the role and the permissions of the caller. The answers of the backend carry user ids, roles and
// dates only, and the tool reads nothing else. The texts arrive made one line and masked by the tool
// (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface MemberItem {
  readonly id: string;
  readonly user_id: string;
  readonly role: string;
  /** The user id of whoever added the member; null when the backend does not say. */
  readonly added_by: string | null;
  readonly joined_at: string;
}

export interface MyRole {
  readonly user_id: string;
  readonly role: string;
  readonly permissions: {
    readonly admin: boolean;
    readonly edit: boolean;
    readonly execute: boolean;
  };
}

export interface TeamData {
  readonly mode: 'list' | 'me';
  readonly project_id: string;
  readonly count: number;
  readonly shown: number;
  readonly members: readonly MemberItem[];
  readonly me: MyRole | null;
}

const dayOf = (at: string): string | null => /^\d{4}-\d{2}-\d{2}/u.exec(at)?.[0] ?? null;

function memberLine(member: MemberItem, index: number, t: Translator): string {
  const day = dayOf(member.joined_at);
  const parts = [
    `${String(index + 1)}. ${member.role} ${member.user_id}`,
    ...(day === null ? [] : [t('project_list_team.since', { day })]),
    ...(member.added_by === null ? [] : [t('project_list_team.added_by', { id: member.added_by })]),
  ];
  return parts.join(', ');
}

function renderMe(me: MyRole, t: Translator): string {
  const can = [
    ...(me.permissions.admin ? [t('project_list_team.can_admin')] : []),
    ...(me.permissions.edit ? [t('project_list_team.can_edit')] : []),
    ...(me.permissions.execute ? [t('project_list_team.can_execute')] : []),
  ];
  return t('project_list_team.me', {
    role: me.role,
    id: me.user_id,
    can: can.length === 0 ? t('project_list_team.can_read') : can.join(', '),
  });
}

export function renderListTeam(data: TeamData, t: Translator): string {
  if (data.mode === 'me')
    return data.me === null ? t('project_list_team.empty') : renderMe(data.me, t);
  if (data.count === 0) return t('project_list_team.empty');
  const lines = [t.plural('project_list_team.header', data.count)];
  data.members.forEach((member, index) => lines.push(memberLine(member, index, t)));
  if (data.shown < data.count) {
    lines.push(t('project_list_team.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
