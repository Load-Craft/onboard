// The view of `scenario_get_copilot_history`: the latest messages of a conversation, oldest first,
// one numbered line each with who said it; what a reply proposed is a short note under it. The texts
// arrive made one line and masked by the tool (`content` of tools/moduleCall.ts); the view adds no
// text of the backend of its own.

import type { Translator } from '../../context.js';

export interface CopilotMessage {
  /** `user` or `assistant`; any other role the backend names is kept as written. */
  readonly role: string;
  readonly content: string;
  /** Planner messages: what kind of turn it was; null otherwise. */
  readonly kind: string | null;
  /** Scenario copilot replies: the kinds of the actions it proposed. */
  readonly actions: readonly string[];
  /** Planner replies: whether a split plan was proposed, and how many entries it has. */
  readonly proposal_entries: number | null;
  /** Planner replies: how many quick replies it offered. */
  readonly chips: number;
}

export interface CopilotHistoryData {
  readonly source: 'scenario' | 'planner';
  readonly project_id: string;
  /** The scenario or the planner draft the conversation belongs to. */
  readonly target_id: string;
  /** How many messages the conversation has. */
  readonly count: number;
  /** How many of them the data carries: the latest ones. */
  readonly shown: number;
  /** How many turns (messages of the user) the conversation has. */
  readonly turns: number;
  readonly messages: readonly CopilotMessage[];
}

function noteOf(message: CopilotMessage, t: Translator): string | null {
  const notes: string[] = [];
  if (message.actions.length > 0) {
    notes.push(t('scenario_get_copilot_history.actions', { kinds: message.actions.join(', ') }));
  }
  if (message.proposal_entries !== null) {
    notes.push(t.plural('scenario_get_copilot_history.proposal', message.proposal_entries));
  }
  if (message.chips > 0) {
    notes.push(t.plural('scenario_get_copilot_history.chips', message.chips));
  }
  return notes.length === 0 ? null : `   ${notes.join('; ')}`;
}

export function renderCopilotHistory(data: CopilotHistoryData, t: Translator): string {
  if (data.count === 0) return t(`scenario_get_copilot_history.empty.${data.source}`);
  const lines = [
    data.shown < data.count
      ? t(`scenario_get_copilot_history.header_cut.${data.source}`, {
          shown: data.shown,
          total: data.count,
          id: data.target_id,
        })
      : t.plural(`scenario_get_copilot_history.header.${data.source}`, data.count, {
          id: data.target_id,
        }),
  ];
  const first = data.count - data.shown;
  data.messages.forEach((message, index) => {
    const who = t(
      `scenario_get_copilot_history.role.${message.role === 'user' ? 'user' : 'other'}`,
      {
        role: message.role,
      },
    );
    lines.push(`${String(first + index + 1)}. ${who}: ${message.content}`);
    const note = noteOf(message, t);
    if (note !== null) lines.push(note);
  });
  return lines.join('\n');
}
