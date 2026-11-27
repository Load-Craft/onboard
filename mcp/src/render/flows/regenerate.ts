// The lines of the consent card of `flows_regenerate`. The flow's name and the description are texts a
// person or a model wrote: they arrive masked and made one line. The view of the finished run is the
// view of the flow generation (`render/views/buildFlows.ts`), which `process_wait` draws too.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze: the flow as it is and what the run would do to it. */
export interface RegenerateFlowFacts {
  readonly flow_id: string;
  /** The flow's name (the `{name}` of the log entry). */
  readonly name: string;
  /** The version the run would overwrite; the way back. */
  readonly version: number;
  readonly blocks: number;
  /** The description the flow is regenerated from, cut. */
  readonly description: string;
  readonly skip_validators: boolean;
}

export function cardViewRegenerateFlow(facts: RegenerateFlowFacts, t: Translator): CardView {
  return {
    title: t('flows_regenerate.card.title', { name: facts.name }),
    lines: [
      t('flows_regenerate.card.rewrites', {
        version: num(facts.version, t.locale),
        blocks: num(facts.blocks, t.locale),
      }),
      t('flows_regenerate.card.description', { description: facts.description }),
      ...(facts.skip_validators ? [t('flows_regenerate.card.skip_validators')] : []),
      t('flows_regenerate.card.failed_run'),
    ],
    cost: t('flows_regenerate.card.cost'),
    undo: t('flows_regenerate.card.undo', { version: num(facts.version, t.locale) }),
  };
}
