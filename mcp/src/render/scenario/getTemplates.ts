// The view of `scenario_get_templates`: the list of the templates, one line each with its
// description under it; or one template with its scenarios, its data files and, with `include`, its
// draft composition. The texts arrive masked and made one line by the tool; the view adds no text of
// the backend of its own.

import type { Translator } from '../../context.js';
import { idTag, partLines, quoted, type Page, type Part } from '../../tools/kit/transitional.js';

export interface TemplateItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly difficulty: string;
  readonly scenario_count: number;
  /** null when the template has no description. */
  readonly description: string | null;
}

export interface TemplateScenarioItem {
  readonly name: string;
  readonly description: string | null;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

export interface TemplateFileItem {
  readonly name: string;
  readonly columns: readonly string[];
}

export interface TemplateOne {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly difficulty: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly scenario_count: number;
  readonly file_count: number;
  /** The first scenarios of the template. */
  readonly scenarios: readonly TemplateScenarioItem[];
  /** The first data files of the template. */
  readonly files: readonly TemplateFileItem[];
}

export interface DraftView {
  readonly name: string | null;
  readonly load: {
    readonly type: string;
    readonly users: number;
    readonly seconds: number;
    /** All the users start without a ramp, and they are many (100 or more): the view warns. */
    readonly sudden: boolean;
  } | null;
  readonly mix: readonly { readonly scenario: string; readonly weight: number }[];
  readonly thresholds: readonly { readonly name: string; readonly value: number }[];
}

export type ScenarioGetTemplatesData =
  | {
      readonly mode: 'list';
      readonly project_id: string;
      readonly templates: Page<TemplateItem>;
    }
  | {
      readonly mode: 'one';
      readonly project_id: string;
      readonly template: TemplateOne;
      /** Present with `include: ["draft"]`. */
      readonly draft: Part<DraftView>;
    };

function listOrNone(values: readonly string[], t: Translator): string {
  return values.length === 0 ? t('scenario_get_templates.none') : values.join(', ');
}

function listLines(list: Page<TemplateItem>, t: Translator): string[] {
  if (list.fetched === 0) return [t('scenario_get_templates.empty')];
  const lines = [t.plural('scenario_get_templates.header', list.count)];
  list.items.forEach((item, index) => {
    lines.push(
      `${String(index + 1)}. ${t('scenario_get_templates.line', {
        name: quoted(item.name),
        id: idTag(item.id),
        category: item.category,
        difficulty: item.difficulty,
        scenarios: item.scenario_count,
      })}`,
    );
    if (item.description !== null) {
      lines.push(`   ${t('scenario_get_templates.about', { description: item.description })}`);
    }
  });
  if (list.shown < list.count) {
    lines.push(t('scenario_get_templates.more', { shown: list.shown, count: list.count }));
  }
  return lines;
}

function draftLines(draft: DraftView, t: Translator): string[] {
  const lines: string[] = [];
  if (draft.name !== null) {
    lines.push(t('scenario_get_templates.draft.name', { name: quoted(draft.name) }));
  }
  if (draft.load !== null) {
    lines.push(
      t('scenario_get_templates.draft.load', {
        type: draft.load.type,
        users: draft.load.users,
        seconds: draft.load.seconds,
      }),
    );
    if (draft.load.sudden) {
      lines.push(t('scenario_get_templates.draft.sudden', { users: draft.load.users }));
    }
  }
  if (draft.mix.length > 0) {
    const mix = draft.mix
      .map((entry) => `${quoted(entry.scenario)} ${String(entry.weight)}`)
      .join(', ');
    lines.push(t('scenario_get_templates.draft.mix', { mix }));
    lines.push(t('scenario_get_templates.draft.mix_note'));
  }
  if (draft.thresholds.length > 0) {
    const thresholds = draft.thresholds
      .map((entry) => `${entry.name} ${String(entry.value)}`)
      .join(', ');
    lines.push(t('scenario_get_templates.draft.thresholds', { thresholds }));
  }
  return lines;
}

function oneLines(item: TemplateOne, draft: Part<DraftView>, t: Translator): string[] {
  const lines = [
    t('scenario_get_templates.one.header', {
      name: quoted(item.name),
      id: idTag(item.id),
      category: item.category,
      difficulty: item.difficulty,
    }),
  ];
  if (item.description !== null) {
    lines.push(t('scenario_get_templates.about', { description: item.description }));
  }
  if (item.tags.length > 0) {
    lines.push(t('scenario_get_templates.one.tags', { tags: item.tags.join(', ') }));
  }
  lines.push(t('scenario_get_templates.one.scenarios', { count: item.scenario_count }));
  item.scenarios.forEach((scenario, index) => {
    lines.push(
      `${String(index + 1)}. ${t('scenario_get_templates.one.scenario', {
        name: quoted(scenario.name),
        inputs: listOrNone(scenario.inputs, t),
        outputs: listOrNone(scenario.outputs, t),
      })}`,
    );
    if (scenario.description !== null) {
      lines.push(`   ${t('scenario_get_templates.about', { description: scenario.description })}`);
    }
  });
  lines.push(t('scenario_get_templates.one.files', { count: item.file_count }));
  item.files.forEach((file, index) => {
    lines.push(
      `${String(index + 1)}. ${t('scenario_get_templates.one.file', {
        name: quoted(file.name),
        columns: listOrNone(file.columns, t),
      })}`,
    );
  });
  lines.push(
    ...partLines(t, 'scenario', t('scenario_get_templates.draft'), draft, (value) =>
      draftLines(value, t),
    ),
  );
  return lines;
}

export function renderScenarioGetTemplates(data: ScenarioGetTemplatesData, t: Translator): string {
  return data.mode === 'list'
    ? listLines(data.templates, t).join('\n')
    : oneLines(data.template, data.draft, t).join('\n');
}
