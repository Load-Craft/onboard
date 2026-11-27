// The views of the two tools that run the AI on the test types of a project (`functional_suggest_test_types`,
// `functional_generate_test_types`): the cards, the progress line while the run goes, and the finished view
// both share (the kind `test_types_generation`). Every text arrives masked and made one line by the tool.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

export type TestTypesMode = 'suggest' | 'generate';

/** The steps of the run, the only values the progress line takes from the backend. */
const STEPS = ['prepare_context', 'run_operation'] as const;
export type TestTypesStep = (typeof STEPS)[number];
export const isTestTypesStep = (value: string): value is TestTypesStep =>
  (STEPS as readonly string[]).includes(value);

export interface SuggestFacts {
  readonly docs_id: string;
  /** The areas to focus on, as given, masked; absent when none. */
  readonly focus?: string;
}

export interface GenerateFacts {
  /** Base test types the project lacks (inside the categories asked), and their names (at most 20). */
  readonly missing: number;
  readonly names: readonly string[];
  readonly categories?: string;
}

export interface SuggestionView {
  readonly name: string;
  readonly display_name: string;
  readonly category: string;
  readonly description: string;
  readonly expected_outcome: string | null;
  /** The prompt that makes the inputs: what `functional_save_test_types` takes as `input_prompt`. */
  readonly input_prompt: string;
  readonly examples: number;
  readonly rationale: string;
}

export interface TestTypesRunData {
  readonly mode: TestTypesMode;
  /** What the run made: suggestions (suggest) or test types created (generate); the slot of the log entry. */
  readonly count: number;
  /** suggest: at most 20 suggestions and how many the run made. */
  readonly suggestions: readonly SuggestionView[];
  readonly total: number;
  /** generate: test types created and base ones the project already had; at most 20 created shown. */
  readonly created: number;
  readonly skipped: number;
  readonly created_types: readonly { readonly id: string; readonly name: string }[];
  readonly rationale: string | null;
  /** Operations of a large API the model was not shown. */
  readonly omitted: number;
}

const S = 'functional_suggest_test_types';
const G = 'functional_generate_test_types';
const R = 'functional.test_types_run';

export function cardViewSuggestTestTypes(facts: SuggestFacts, t: Translator): CardView {
  return {
    title: t(`${S}.card.title`),
    lines: [
      t(`${S}.card.docs`, { id: facts.docs_id }),
      ...(facts.focus === undefined ? [] : [t(`${S}.card.focus`, { focus: facts.focus })]),
    ],
    cost: t(`${S}.card.cost`),
    undo: t(`${S}.card.undo`),
  };
}

export function cardViewGenerateTestTypes(facts: GenerateFacts, t: Translator): CardView {
  const names = facts.names.join(', ') + (facts.missing > facts.names.length ? ', …' : '');
  return {
    title: t(`${G}.card.title`),
    lines: [
      t.plural(`${G}.card.missing`, facts.missing, { names }),
      ...(facts.categories === undefined
        ? []
        : [t(`${G}.card.categories`, { categories: facts.categories })]),
    ],
    cost: t(`${G}.card.cost`),
    undo: t(`${G}.card.undo`),
  };
}

export function renderTestTypesProgress(
  state: {
    readonly step: TestTypesStep | null;
    readonly percent: number;
    readonly mode: TestTypesMode;
  },
  t: Translator,
): string {
  return t(`${R}.progress`, {
    what: t(`${R}.what.${state.mode}`),
    step: t(`${R}.step.${state.step ?? 'prepare_context'}`),
    percent: num(state.percent, t.locale),
  });
}

export function renderTestTypesRun(data: TestTypesRunData, t: Translator): string {
  const lines: string[] = [];
  if (data.mode === 'suggest') {
    if (data.total === 0) lines.push(t(`${R}.suggest.none`));
    else lines.push(t.plural(`${R}.suggest.header`, data.total));
    for (const item of data.suggestions) {
      lines.push(
        t(`${R}.suggest.item`, {
          name: item.name,
          display: item.display_name,
          category: item.category,
        }),
        t(`${R}.suggest.description`, { text: item.description }),
        t(`${R}.suggest.outcome`, { text: item.expected_outcome ?? t(`${R}.unknown`) }),
        t(`${R}.suggest.prompt`, { text: item.input_prompt }),
        t(`${R}.suggest.why`, { text: item.rationale, examples: num(item.examples, t.locale) }),
      );
    }
    if (data.total > data.suggestions.length) {
      lines.push(t(`${R}.more`, { count: num(data.total - data.suggestions.length, t.locale) }));
    }
    if (data.total > 0) lines.push(t(`${R}.suggest.next`));
  } else {
    lines.push(
      t(`${R}.generate.done`, {
        created: num(data.created, t.locale),
        skipped: num(data.skipped, t.locale),
      }),
    );
    for (const item of data.created_types) {
      lines.push(t(`${R}.generate.created`, { name: item.name, id: item.id }));
    }
    if (data.created > data.created_types.length) {
      lines.push(
        t(`${R}.more`, { count: num(data.created - data.created_types.length, t.locale) }),
      );
    }
    if (data.rationale !== null) lines.push(t(`${R}.generate.why`, { text: data.rationale }));
    if (data.created > 1) lines.push(t(`${R}.generate.one_by_one`));
  }
  if (data.omitted > 0) lines.push(t(`${R}.omitted`, { count: num(data.omitted, t.locale) }));
  return lines.join('\n');
}
