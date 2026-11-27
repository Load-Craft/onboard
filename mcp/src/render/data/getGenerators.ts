// The view of `data_get_generators`: the generators the dataset rules offer, one line each with what
// they take as parameters and the choices they list, or, for the column names the model gave, what
// the data hub would make of each column. The texts arrive made one line and masked by the tool
// (`content` of tools/moduleCall.ts); no cell of a dataset is read.

import type { Translator } from '../../context.js';
import { semanticsText, type ColumnSemantics } from './semantics.js';

export interface GeneratorChoice {
  readonly label: string;
  readonly value: string;
  readonly default: boolean;
}

export interface GeneratorItem {
  readonly label: string;
  readonly hint: string;
  /** What the generator takes: `none`, `networks`, `pattern`, `range`, `list`, `ref` or `samples`. */
  readonly params: string;
  readonly choices: readonly GeneratorChoice[];
  /** How many choices the generator lists; `choices` keeps the first ones. */
  readonly choices_total: number;
}

export interface ColumnRule {
  readonly hint: string;
  readonly pattern: string | null;
  readonly min: number | null;
  readonly max: number | null;
  /** How many values a list rule names (the values themselves are not passed on). */
  readonly values: number;
  readonly networks: readonly string[];
  readonly ref_column: string | null;
}

export interface GuessedItem {
  readonly name: string;
  readonly semantics: ColumnSemantics;
  readonly declarable_as_data: boolean;
  readonly refusal: string | null;
  readonly generator: ColumnRule | null;
}

export interface GeneratorsData {
  readonly mode: 'list' | 'guess';
  readonly project_id: string;
  readonly count: number;
  readonly generators: readonly GeneratorItem[];
  readonly columns: readonly GuessedItem[];
}

function ruleText(rule: ColumnRule, t: Translator): string {
  const parts = [rule.hint];
  if (rule.min !== null && rule.max !== null) parts.push(`${String(rule.min)}-${String(rule.max)}`);
  else if (rule.min !== null) parts.push(t('data_get_generators.min', { value: rule.min }));
  else if (rule.max !== null) parts.push(t('data_get_generators.max', { value: rule.max }));
  if (rule.pattern !== null) parts.push(`"${rule.pattern}"`);
  if (rule.values > 0) parts.push(t.plural('data_get_generators.values', rule.values));
  if (rule.networks.length > 0) parts.push(rule.networks.join(', '));
  if (rule.ref_column !== null)
    parts.push(t('data_get_generators.ref', { column: rule.ref_column }));
  return parts.join(' ');
}

/**
 * A column the hub refuses has a refusal (and may still be declared as data of the user's own,
 * `declarable_as_data`); a column without one has its rule. The flag alone does not tell them apart:
 * the backend sets it only together with a refusal.
 */
function columnLine(item: GuessedItem, index: number, t: Translator): string {
  const what =
    item.refusal !== null
      ? t(
          item.declarable_as_data
            ? 'data_get_generators.refused_declarable'
            : 'data_get_generators.refused',
          { reason: item.refusal },
        )
      : item.generator === null
        ? t('data_get_generators.no_generator')
        : t('data_get_generators.generator', { rule: ruleText(item.generator, t) });
  return `${String(index + 1)}. ${item.name}: ${semanticsText(item.semantics, t)}; ${what}`;
}

export function renderGenerators(data: GeneratorsData, t: Translator): string {
  if (data.mode === 'guess') {
    const lines = [t.plural('data_get_generators.header_columns', data.count)];
    data.columns.forEach((item, index) => lines.push(columnLine(item, index, t)));
    return lines.join('\n');
  }
  if (data.count === 0) return t('data_get_generators.empty');
  const lines = [t.plural('data_get_generators.header', data.count)];
  data.generators.forEach((item, index) => {
    const params = item.params === 'none' ? '' : ` [${item.params}]`;
    lines.push(`${String(index + 1)}. ${item.label}${params}: ${item.hint}`);
    if (item.choices.length > 0) {
      const choices = item.choices.map((c) =>
        c.default ? t('data_get_generators.default_choice', { value: c.value }) : c.value,
      );
      const hidden = item.choices_total - item.choices.length;
      if (hidden > 0) choices.push(t('data_get_generators.more_choices', { count: hidden }));
      lines.push(`   ${t('data_get_generators.choices', { choices: choices.join(', ') })}`);
    }
  });
  return lines.join('\n');
}
