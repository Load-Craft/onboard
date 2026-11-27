// The view of `functional_suggest_validators` and of the lines of its consent card. The proposals are
// text a model wrote from the API docs and recorded runs: they arrive masked and made one line, with
// the template and the parameters whole enough to be passed to `functional_save_validators`.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze: the docs to read (the project is the bound one). */
export interface SuggestValidatorsFacts {
  readonly docs_id: string;
}

export interface ProposalView {
  readonly name: string;
  readonly display_name: string;
  readonly description: string;
  readonly template: string;
  /** The parameters as JSON text (masked); `{}` when there are none. */
  readonly params: string;
  readonly rationale: string;
  readonly bucket: string;
  readonly confidence: number;
  readonly evidence_source: string;
  readonly evidence_count: number;
}

export interface SuggestValidatorsData {
  /** At most 20 proposals, best first as the backend lists them, and how many came back. */
  readonly proposals: readonly ProposalView[];
  readonly count: number;
  readonly considered: number;
  readonly rejected: number;
  readonly already_in_project: number;
  /** What the proposals were built on: `no_operations`, `schema_only`, `recorded_responses`. */
  readonly basis: string;
}

const P = 'functional_suggest_validators';

export function cardViewSuggestValidators(facts: SuggestValidatorsFacts, t: Translator): CardView {
  return {
    title: t(`${P}.card.title`),
    lines: [t(`${P}.card.docs`, { id: facts.docs_id })],
    cost: t(`${P}.card.cost`),
    undo: t(`${P}.card.undo`),
  };
}

export function renderSuggestValidators(data: SuggestValidatorsData, t: Translator): string {
  if (data.count === 0) {
    return [
      t(`${P}.none`, {
        considered: num(data.considered, t.locale),
        rejected: num(data.rejected, t.locale),
      }),
      t(`${P}.basis.${data.basis}`),
    ].join('\n');
  }
  const lines = [t.plural(`${P}.header`, data.count), t(`${P}.basis.${data.basis}`)];
  for (const item of data.proposals) {
    lines.push(
      t(`${P}.item`, {
        name: item.name,
        display: item.display_name,
        bucket: item.bucket,
        confidence: num(Math.round(item.confidence * 100), t.locale),
      }),
      t(`${P}.description`, { text: item.description }),
      t(`${P}.template`, { text: item.template }),
      t(`${P}.params`, { text: item.params }),
      t(`${P}.rationale`, {
        text: item.rationale,
        source: item.evidence_source,
        count: num(item.evidence_count, t.locale),
      }),
    );
  }
  if (data.count > data.proposals.length) {
    lines.push(t(`${P}.more`, { count: data.count - data.proposals.length }));
  }
  if (data.already_in_project > 0) {
    lines.push(t(`${P}.already`, { count: num(data.already_in_project, t.locale) }));
  }
  lines.push(t(`${P}.next`));
  return lines.join('\n');
}
