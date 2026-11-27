// The view of `flows_get_copilot_history`: the latest turns of the conversation of a flow with the
// copilot (what it proposed, and whether it was applied), or the copilot's open suggestions. The texts
// arrive made one line and masked by the tool (`content` of tools/moduleCall.ts).

import type { Translator } from '../../context.js';

export interface ChangeRow {
  readonly type: string;
  readonly description: string;
  readonly status: string | null;
  readonly target_block_id: string | null;
}

export interface TurnRow {
  readonly role: string;
  readonly kind: string | null;
  readonly content: string;
  readonly changes: readonly ChangeRow[];
}

export interface SuggestionRow {
  readonly target_block_id: string;
  readonly text: string;
}

export interface CopilotData {
  readonly mode: 'history' | 'suggestions';
  readonly project_id: string;
  readonly flow: { readonly id: string; readonly name: string };
  /** The turns of the conversation, or the suggestions, the flow has. */
  readonly count: number;
  readonly shown: number;
  readonly messages: readonly TurnRow[];
  readonly suggestions: readonly SuggestionRow[];
}

function changeLine(change: ChangeRow, t: Translator): string {
  const status = change.status === null || change.status === '' ? '' : ` [${change.status}]`;
  return `  ${t('flows_get_copilot_history.proposed', {
    type: change.type,
    description: change.description,
  })}${status}`;
}

function renderSuggestions(data: CopilotData, t: Translator): string {
  if (data.count === 0)
    return t('flows_get_copilot_history.no_suggestions', { name: data.flow.name });
  const lines = [
    t('flows_get_copilot_history.suggestions', { name: data.flow.name, count: data.count }),
  ];
  data.suggestions.forEach((item, index) => {
    lines.push(
      `${String(index + 1)}. ${t('flows_get_copilot_history.suggestion', {
        text: item.text,
        block: item.target_block_id,
      })}`,
    );
  });
  return lines.join('\n');
}

export function renderGetCopilotHistory(data: CopilotData, t: Translator): string {
  if (data.mode === 'suggestions') return renderSuggestions(data, t);
  if (data.count === 0) return t('flows_get_copilot_history.empty', { name: data.flow.name });
  const lines = [
    t.plural('flows_get_copilot_history.header', data.count, { name: data.flow.name }),
  ];
  for (const turn of data.messages) {
    lines.push(`${turn.role}: ${turn.content}`);
    for (const change of turn.changes) lines.push(changeLine(change, t));
  }
  if (data.shown < data.count) {
    lines.push(t('flows_get_copilot_history.more', { shown: data.shown, count: data.count }));
  }
  return lines.join('\n');
}
