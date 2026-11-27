// The view of `data_get_slots`: one line per data slot with its columns and whether a dataset is bound,
// then the datasets that fit it. Texts arrive made one line and masked by the tool (`content` of
// tools/moduleCall.ts); no cell of a dataset is read.

import type { Translator } from '../../context.js';

export interface SlotOption {
  readonly id: string;
  readonly name: string;
  readonly rows: number;
}

export type BindingState = 'bound' | 'stale' | 'unbound' | 'unknown';

export interface SlotBinding {
  readonly state: BindingState;
  readonly dataset_id: string | null;
  /** The name of the bound dataset when it is among the datasets that fit the slot. */
  readonly dataset_name: string | null;
}

export interface SlotItem {
  readonly slot: string;
  readonly label: string | null;
  readonly role: string;
  /** `existing`: logins of real accounts; `fresh`: sign-ups that mint accounts; null: plain data. */
  readonly identity_kind: 'existing' | 'fresh' | null;
  readonly columns: readonly string[];
  readonly columns_total: number;
  /** Columns the hub must never make up (logins, credentials, ids of existing things). */
  readonly never_fabricated_columns: readonly string[];
  /** The rows ride in the scenario and a run uses them until a dataset is bound. */
  readonly generated: boolean;
  readonly generated_rows: number | null;
  readonly binding: SlotBinding;
  readonly options: readonly SlotOption[];
  readonly options_total: number;
}

export interface SlotsData {
  readonly project_id: string;
  readonly target: { readonly kind: 'scenario' | 'composition'; readonly id: string };
  /** How many slots there are. */
  readonly count: number;
  /** How many slots have a binding; null when the bindings could not be read. */
  readonly bound: number | null;
  readonly bindings: 'read' | 'unknown';
  readonly slots: readonly SlotItem[];
}

function headerOf(data: SlotsData, t: Translator): string {
  const params = {
    kind: t(`data_get_slots.kind.${data.target.kind}`),
    id: data.target.id,
  };
  const slots = t.plural('data_get_slots.slots', data.count);
  return data.bound === null
    ? t('data_get_slots.header_unknown', { ...params, slots })
    : t('data_get_slots.header', { ...params, slots, bound: data.bound });
}

function bindingText(item: SlotItem, t: Translator): string | null {
  const { binding } = item;
  if (binding.state === 'unknown') return null;
  if (binding.state === 'bound') {
    return binding.dataset_name === null
      ? t('data_get_slots.bound_id', { id: binding.dataset_id ?? '' })
      : t('data_get_slots.bound', { name: binding.dataset_name });
  }
  if (binding.state === 'stale') return t('data_get_slots.stale');
  return t('data_get_slots.unbound');
}

function slotLine(item: SlotItem, index: number, t: Translator): string {
  const label = item.label === null ? '' : ` "${item.label}"`;
  const kind =
    item.identity_kind === null ? [] : [t(`data_get_slots.identity.${item.identity_kind}`)];
  const columns = item.columns.join(', ');
  const hidden = item.columns_total - item.columns.length;
  const more = hidden > 0 ? `, ${t('data_get_slots.more', { count: hidden })}` : '';
  const parts = [
    t('data_get_slots.columns', { columns: columns + more }),
    ...[bindingText(item, t)].filter((text): text is string => text !== null),
  ];
  if (item.never_fabricated_columns.length > 0) {
    parts.push(t('data_get_slots.never', { columns: item.never_fabricated_columns.join(', ') }));
  }
  if (item.generated === true && item.binding.state !== 'bound') {
    parts.push(t.plural('data_get_slots.generated_rows', item.generated_rows ?? 0));
  }
  return `${String(index + 1)}. ${item.slot}${label} (${[item.role, ...kind].join(', ')}): ${parts.join('; ')}`;
}

function optionsLine(item: SlotItem, t: Translator): string {
  if (item.options_total === 0) return `   ${t('data_get_slots.options_none')}`;
  const shown = item.options.map(
    (option) =>
      `"${option.name}" [${option.id}] ${t.plural('data_get_slots.option_rows', option.rows)}`,
  );
  const hidden = item.options_total - item.options.length;
  if (hidden > 0) shown.push(t('data_get_slots.more', { count: hidden }));
  return `   ${t('data_get_slots.options', { count: item.options_total, items: shown.join('; ') })}`;
}

export function renderSlots(data: SlotsData, t: Translator): string {
  if (data.count === 0) return t(`data_get_slots.empty.${data.target.kind}`);
  const lines = [headerOf(data, t)];
  data.slots.forEach((item, index) => {
    lines.push(slotLine(item, index, t));
    lines.push(optionsLine(item, t));
  });
  return lines.join('\n');
}
