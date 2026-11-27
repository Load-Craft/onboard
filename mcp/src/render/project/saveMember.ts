// The view of `project_save_member` and of the lines of its consent card: who gets which role, and what
// it was before. The user ids and the roles arrive masked and made one line (the tool does it); the
// answers carry no name and no e-mail address, and the tool reads no other field.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';

export type MemberRole = 'owner' | 'editor' | 'viewer';

/** What the card froze. `user_id` and `role` are also the slots of the log entry. */
export interface SaveMemberFacts {
  readonly user_id: string;
  readonly role: MemberRole;
  /** The role the person has now; null when they are not a member yet. */
  readonly previous: string | null;
}

export interface SaveMemberData {
  readonly user_id: string;
  readonly role: MemberRole;
  /** The role before the call; null when the person was added. */
  readonly previous_role: string | null;
  readonly action: 'added' | 'changed' | 'unchanged';
  /** The way back the log keeps: the previous role, the removal of a new member, none. */
  readonly undo: 'role' | 'removal' | 'withheld' | 'none';
}

export function cardViewSaveMember(facts: SaveMemberFacts, t: Translator): CardView {
  const lines =
    facts.previous === null
      ? [t('project_save_member.card.add', { user_id: facts.user_id, role: facts.role })]
      : [
          t('project_save_member.card.change', {
            user_id: facts.user_id,
            from: facts.previous,
            role: facts.role,
          }),
        ];
  lines.push(t(`project_save_member.card.role.${facts.role}`));
  return {
    title: t('project_save_member.card.title', { user_id: facts.user_id, role: facts.role }),
    lines,
    undo: t(
      facts.previous === null
        ? 'project_save_member.card.undo.added'
        : 'project_save_member.card.undo.changed',
      { previous: facts.previous ?? '' },
    ),
  };
}

export function renderSaveMember(data: SaveMemberData, t: Translator): string {
  if (data.action === 'unchanged') {
    return t('project_save_member.unchanged', { user_id: data.user_id, role: data.role });
  }
  const done =
    data.action === 'added'
      ? t('project_save_member.added', { user_id: data.user_id, role: data.role })
      : t('project_save_member.changed', {
          user_id: data.user_id,
          role: data.role,
          previous: data.previous_role ?? '',
        });
  return [
    done,
    t(`project_save_member.undo.${data.undo}`, { previous: data.previous_role ?? '' }),
  ].join('\n');
}
