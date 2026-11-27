// The view of `flows_ask_copilot` and of the lines of its consent card: what the call asks (a
// message, or the standard review), what it costs, and the proposal that comes back. The flow name,
// the message, the reply and the descriptions of the proposed changes are texts a person or a model
// wrote: they arrive masked and made one line. The blocks of a proposal are never copied.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze. `name` is also the slot of the log entry. */
export interface AskFlowCopilotFacts {
  readonly name: string;
  readonly id: string;
  /** The question (masked, cut); null: the standard review. */
  readonly message: string | null;
}

export interface ProposedFlowChange {
  readonly id: string;
  readonly type: 'add' | 'modify' | 'remove';
  readonly block: string;
  readonly description: string;
  readonly warnings: number;
}

export interface AskFlowCopilotData {
  readonly flow: { readonly id: string };
  readonly name: string;
  readonly review: boolean;
  /** The id of the proposal the backend stored. */
  readonly message_id: string;
  readonly reply: string;
  /** How many changes it proposes (the list below holds the first ones). */
  readonly count: number;
  readonly proposed: readonly ProposedFlowChange[];
}

export function cardViewAskFlowCopilot(facts: AskFlowCopilotFacts, t: Translator): CardView {
  return {
    title: t('flows_ask_copilot.card.title', { name: facts.name }),
    lines: [
      t('flows_ask_copilot.card.flow', { id: facts.id }),
      facts.message === null
        ? t('flows_ask_copilot.card.review')
        : t('flows_ask_copilot.card.message', { message: facts.message }),
      t('flows_ask_copilot.card.proposes'),
    ],
    cost: t('flows_ask_copilot.card.cost'),
    undo: t('flows_ask_copilot.card.undo'),
  };
}

export function renderAskFlowCopilot(data: AskFlowCopilotData, t: Translator): string {
  const lines = [
    t(data.review ? 'flows_ask_copilot.header_review' : 'flows_ask_copilot.header', {
      name: data.name,
    }),
    t('flows_ask_copilot.reply', { reply: data.reply }),
  ];
  if (data.count === 0) {
    lines.push(t('flows_ask_copilot.no_changes'));
  } else {
    lines.push(
      t.plural('flows_ask_copilot.changes', data.count, { count: num(data.count, t.locale) }),
    );
    data.proposed.forEach((change, index) => {
      const warn =
        change.warnings > 0 ? ` ${t.plural('flows_ask_copilot.warnings', change.warnings)}` : '';
      lines.push(
        `${String(index + 1)}. ${t(`flows_ask_copilot.type.${change.type}`)} ${change.block}: ${change.description}${warn}`,
      );
    });
    if (data.count > data.proposed.length) {
      lines.push(
        t('flows_ask_copilot.more', {
          shown: data.proposed.length,
          total: num(data.count, t.locale),
        }),
      );
    }
  }
  lines.push(t('flows_ask_copilot.proposal', { id: data.message_id }));
  return lines.join('\n');
}
