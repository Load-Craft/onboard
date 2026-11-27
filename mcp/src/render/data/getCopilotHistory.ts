// The view of `data_get_copilot_history`: the latest messages of the data hub conversation, oldest
// first, one numbered line each with who said it; the kinds of what a reply proposed are a short note
// under it. The texts arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface DataHubMessage {
  /** `user` or `assistant`; any other role the backend names is kept as written. */
  readonly role: string;
  readonly content: string;
  /** The kinds of the actions the reply proposed (their bodies are never read). */
  readonly actions: readonly string[];
  /** How many quick replies the reply offered. */
  readonly chips: number;
}

export interface DataHubHistoryData {
  readonly project_id: string;
  /** How many messages the conversation has. */
  readonly count: number;
  /** How many of them the data carries: the latest ones. */
  readonly shown: number;
  /** How many turns (messages of the user) the conversation has. */
  readonly turns: number;
  readonly messages: readonly DataHubMessage[];
}

function noteOf(message: DataHubMessage, t: Translator): string | null {
  const notes: string[] = [];
  if (message.actions.length > 0) {
    notes.push(t('data_get_copilot_history.actions', { kinds: message.actions.join(', ') }));
  }
  if (message.chips > 0) notes.push(t.plural('data_get_copilot_history.chips', message.chips));
  return notes.length === 0 ? null : `   ${notes.join('; ')}`;
}

export function renderDataHubHistory(data: DataHubHistoryData, t: Translator): string {
  if (data.count === 0) return t('data_get_copilot_history.empty');
  const lines = [
    data.shown < data.count
      ? t('data_get_copilot_history.header_cut', { shown: data.shown, total: data.count })
      : t.plural('data_get_copilot_history.header', data.count),
  ];
  const first = data.count - data.shown;
  data.messages.forEach((message, index) => {
    const who = t(`data_get_copilot_history.role.${message.role === 'user' ? 'user' : 'other'}`, {
      role: message.role,
    });
    lines.push(`${String(first + index + 1)}. ${who}: ${message.content}`);
    const note = noteOf(message, t);
    if (note !== null) lines.push(note);
  });
  return lines.join('\n');
}
