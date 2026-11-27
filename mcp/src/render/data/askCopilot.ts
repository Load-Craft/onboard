// The view of `data_ask_copilot` and of the lines of its consent card: what the call asks (a
// question about a scenario or a composition, with the load profile), what it costs, and the
// proposal that comes back. The names, the question, the reply, the issues and the chips are texts a
// person or a model wrote: they arrive masked and made one line. The bodies of the proposed actions
// (recipes, names, bindings) are never read: only their kind.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type CopilotTargetKind = 'scenario' | 'composition';

/** What the card froze. */
export interface AskDataCopilotFacts {
  readonly kind: CopilotTargetKind;
  readonly name: string;
  readonly id: string;
  /** The question (masked, cut). */
  readonly message: string;
  /** The load profile sent with it, as text (null: none is chosen, none is sent). */
  readonly profile: string | null;
}

export interface ProposedActionKind {
  readonly kind: string;
  readonly count: number;
}

export interface AskDataCopilotData {
  readonly target: { readonly kind: CopilotTargetKind; readonly id: string };
  readonly name: string;
  readonly reply: string;
  /** How many actions it proposes. */
  readonly count: number;
  /** Their kinds with how many of each (never their bodies). */
  readonly proposed: readonly ProposedActionKind[];
  readonly issues: readonly string[];
  readonly chips: readonly string[];
}

export function cardViewAskDataCopilot(facts: AskDataCopilotFacts, t: Translator): CardView {
  return {
    title: t('data_ask_copilot.card.title'),
    lines: [
      t(`data_ask_copilot.card.for.${facts.kind}`, { name: facts.name, id: facts.id }),
      t('data_ask_copilot.card.message', { message: facts.message }),
      facts.profile === null
        ? t('data_ask_copilot.card.no_profile')
        : t('data_ask_copilot.card.profile', { profile: facts.profile }),
      t('data_ask_copilot.card.proposes'),
    ],
    cost: t('data_ask_copilot.card.cost'),
    undo: t('data_ask_copilot.card.undo'),
  };
}

export function renderAskDataCopilot(data: AskDataCopilotData, t: Translator): string {
  const lines = [
    t(`data_ask_copilot.header.${data.target.kind}`, { name: data.name }),
    t('data_ask_copilot.reply', { reply: data.reply }),
  ];
  if (data.count === 0) {
    lines.push(t('data_ask_copilot.no_actions'));
  } else {
    lines.push(
      t.plural('data_ask_copilot.actions', data.count, {
        count: num(data.count, t.locale),
        kinds: data.proposed.map((one) => `${one.kind} ×${String(one.count)}`).join(', '),
      }),
    );
  }
  if (data.issues.length > 0) {
    lines.push(t('data_ask_copilot.issues', { issues: data.issues.join('; ') }));
  }
  if (data.chips.length > 0) {
    lines.push(t('data_ask_copilot.chips', { chips: data.chips.join('; ') }));
  }
  return lines.join('\n');
}
