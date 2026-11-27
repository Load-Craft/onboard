// The view of `scenario_ask_copilot` and of the lines of its consent card. The scenario name, the
// question, the load profile, the copilot's reply and its proposals are texts a person or a model
// wrote: they arrive masked and made one line. Nothing the copilot proposes is applied.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type CopilotMode = 'message' | 'review';

/** Where the load profile of the call comes from: the argument or what the workspace chose. */
export type ProfileSource = 'argument' | 'state';

/** What the card froze: the scenario, what is asked and the profile that goes with it. */
export interface AskCopilotFacts {
  readonly scenario_id: string;
  /** The scenario's name (the `{name}` of the log entry). */
  readonly name: string;
  readonly mode: CopilotMode;
  /** The question, cut; null for a review. */
  readonly message: string | null;
  /** The load profile as masked JSON, cut; null when the call sends none. */
  readonly profile: string | null;
  readonly profile_source: ProfileSource | null;
}

export type ActionKind =
  'adjust_and_regenerate' | 'generate_slot_feeder' | 'rewrite_validator' | 'other';

/** One proposal of the copilot, in a line: its kind, what it is about and its own summary. */
export interface ProposedAction {
  readonly kind: ActionKind;
  /** The slot or the validator it names; null for a rebuild. */
  readonly about: string | null;
  readonly summary: string | null;
}

export interface AskCopilotData {
  readonly scenario_id: string;
  readonly name: string;
  readonly mode: CopilotMode;
  /** The copilot's answer, masked and cut. */
  readonly reply: string;
  readonly reply_cut: boolean;
  /** At most 10 proposals, and how many there are (the `{actions}` of the log entry). */
  readonly proposals: readonly ProposedAction[];
  readonly actions: number;
}

export function cardViewAskCopilot(facts: AskCopilotFacts, t: Translator): CardView {
  return {
    title: t('scenario_ask_copilot.card.title', { name: facts.name }),
    lines: [
      facts.mode === 'review'
        ? t('scenario_ask_copilot.card.review')
        : t('scenario_ask_copilot.card.message', { message: facts.message ?? '' }),
      t('scenario_ask_copilot.card.profile', {
        profile: facts.profile ?? t('scenario_ask_copilot.profile.none'),
      }),
      t('scenario_ask_copilot.card.proposes'),
    ],
    cost: t('scenario_ask_copilot.card.cost'),
    undo: t('scenario_ask_copilot.card.undo'),
  };
}

export function renderAskCopilot(data: AskCopilotData, t: Translator): string {
  const lines = [
    t(`scenario_ask_copilot.done.${data.mode}`, { name: data.name }),
    t(data.reply_cut ? 'scenario_ask_copilot.reply.cut' : 'scenario_ask_copilot.reply', {
      reply: data.reply,
    }),
  ];
  if (data.actions === 0) {
    lines.push(t('scenario_ask_copilot.actions.none'));
  } else {
    lines.push(t('scenario_ask_copilot.actions', { count: num(data.actions, t.locale) }));
    data.proposals.forEach((action, index) => {
      lines.push(
        t(`scenario_ask_copilot.action.${action.kind}`, {
          index: num(index + 1, t.locale),
          about: action.about ?? '',
          summary: action.summary ?? '',
        }),
      );
    });
    if (data.actions > data.proposals.length) {
      lines.push(
        t('scenario_ask_copilot.more', {
          count: num(data.actions - data.proposals.length, t.locale),
        }),
      );
    }
  }
  lines.push(t('scenario_ask_copilot.applied.none'));
  return lines.join('\n');
}
