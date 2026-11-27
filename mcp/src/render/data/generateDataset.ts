// The views of `data_generate_dataset`: the card (what is generated, for what, how many rows, the cost), the progress of
// a run while it goes on, and the result. The names of the target, of the dataset and of its columns are texts a person
// or a model wrote: they arrive masked and made one line by the tool. The cells are never read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type GenerateKind = 'flow' | 'scenario' | 'slot';

/** What the card froze: the target and what will be asked of the backend. */
export interface GenerateDatasetFacts {
  readonly kind: GenerateKind;
  readonly target_id: string;
  /** The name of the flow or scenario, masked; fills the `{target}` of the log entry. */
  readonly target: string;
  /** The slot of a scenario, for `kind: "slot"`. */
  readonly slot?: string;
  readonly rows: number;
  /** The name of the new dataset; a slot's dataset is named by the backend. */
  readonly name: string;
  readonly feeder_type: 'csv' | 'tsv' | 'json';
  readonly enrich_with_llm?: boolean;
}

export interface GenerateDatasetData {
  readonly kind: GenerateKind;
  readonly target_id: string;
  readonly dataset_id: string;
  readonly name: string;
  readonly rows: number;
  readonly rows_requested: number;
  readonly columns: readonly string[];
  readonly column_count: number;
  /** A slot's dataset the backend refreshed instead of creating; null when it does not say. */
  readonly created: boolean | null;
}

export function cardViewGenerateDataset(facts: GenerateDatasetFacts, t: Translator): CardView {
  return {
    title: t(`data_generate_dataset.card.title.${facts.kind}`, {
      target: facts.target,
      slot: facts.slot ?? '',
    }),
    lines: [
      t(`data_generate_dataset.card.for.${facts.kind}`, {
        target: facts.target,
        slot: facts.slot ?? '',
      }),
      t('data_generate_dataset.card.rows', {
        rows: num(facts.rows, t.locale),
        type: facts.feeder_type,
      }),
      ...(facts.kind === 'slot'
        ? [t(`data_generate_dataset.card.enrich.${facts.enrich_with_llm === true ? 'on' : 'off'}`)]
        : [t('data_generate_dataset.card.name', { name: facts.name })]),
    ],
    cost: t('data_generate_dataset.card.cost'),
    undo: t('data_generate_dataset.card.undo'),
  };
}

/** The steps of a run, the only values a progress line takes from the backend. */
const STEPS = ['prepare', 'generate', 'format', 'save'] as const;
export type GenerateStep = (typeof STEPS)[number];

export function isGenerateStep(value: string): value is GenerateStep {
  return (STEPS as readonly string[]).includes(value);
}

export function renderGenerateProgress(
  progress: { readonly step: GenerateStep | null; readonly percent: number },
  t: Translator,
): string {
  return progress.step === null
    ? t('data_generate_dataset.progress.start')
    : t('data_generate_dataset.progress.step', {
        step: t(`data_generate_dataset.step.${progress.step}`),
        percent: Math.round(progress.percent),
      });
}

export function renderGenerateDataset(data: GenerateDatasetData, t: Translator): string {
  const lines = [
    t(`data_generate_dataset.done.${data.created === false ? 'refreshed' : 'created'}`, {
      name: data.name,
      rows: num(data.rows, t.locale),
      columns: num(data.column_count, t.locale),
    }),
  ];
  if (data.rows !== data.rows_requested) {
    lines.push(
      t('data_generate_dataset.fewer', {
        asked: num(data.rows_requested, t.locale),
        rows: num(data.rows, t.locale),
      }),
    );
  }
  if (data.columns.length > 0) {
    lines.push(
      t('data_generate_dataset.columns', {
        names: data.columns.join(', '),
        more:
          data.column_count > data.columns.length
            ? `, +${num(data.column_count - data.columns.length, t.locale)}`
            : '',
      }),
    );
  }
  lines.push(t('data_generate_dataset.undo'));
  return lines.join('\n');
}
