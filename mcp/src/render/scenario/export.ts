// The view of `scenario_export`: where the ZIP was saved and how large it is, and what the project needs
// that the ZIP does not hold: the dataset files (left out on purpose, they hold real values) and the
// environment variables of its configuration, as names; never a value of a dataset. The same recipe is
// written beside the ZIP as a Markdown file (`renderRecipeFile`). Nothing of the ZIP itself is shown but
// the names the recipe is made of.

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';

/** A dataset file the project reads: its name, the columns it must have (names only) and its role. */
export interface ExportDataset {
  readonly file: string;
  readonly columns: readonly string[];
  /** `auth`: the accounts that sign in; `data`: other data; null when unknown. */
  readonly role: 'auth' | 'data' | null;
}

export interface ExportData {
  readonly project_id: string;
  readonly scenario_id: string;
  /** `loadcraft/exports/scenario-<id8>.zip`, relative to the workspace. */
  readonly path: string;
  readonly bytes: number;
  /** The ZIP holds no dataset file: they are left out on purpose. */
  readonly datasets_omitted: true;
  /** Whether the project's `application.conf` could be read (its dataset files and variables are then complete). */
  readonly conf_read: boolean;
  /** The folder of `application.conf` inside the project, where the dataset files go; null when unknown. */
  readonly folder: string | null;
  readonly datasets: readonly ExportDataset[];
  /** Environment variables the project reads (names only). */
  readonly env_vars: readonly string[];
  /** `loadcraft/exports/scenario-<id8>.run.md`; null when it could not be written. */
  readonly recipe: string | null;
}

const KIB = 1024;

function datasetLine(item: ExportDataset, t: Translator): string {
  const role = item.role === 'auth' ? ` ${t('scenario_export.role.auth')}` : '';
  const columns =
    item.columns.length === 0
      ? t('scenario_export.columns_unknown')
      : t('scenario_export.columns', { names: item.columns.join(', ') });
  return `- ${item.file}${role}: ${columns}`;
}

/** The lines of the recipe: what to bring, in what folder, and which variables to set. */
function recipeLines(data: ExportData, t: Translator): string[] {
  const lines: string[] = [];
  if (!data.conf_read) lines.push(t('scenario_export.conf_unread'));
  if (data.datasets.length > 0) {
    lines.push(
      t.plural('scenario_export.add_datasets', data.datasets.length, {
        folder: data.folder ?? t('scenario_export.folder_unknown'),
      }),
      ...data.datasets.map((item) => datasetLine(item, t)),
    );
  }
  if (data.env_vars.length > 0) {
    lines.push(
      t.plural('scenario_export.set_env', data.env_vars.length),
      ...data.env_vars.map((name) => `- ${name}`),
    );
  }
  if (data.conf_read && data.datasets.length === 0 && data.env_vars.length === 0) {
    lines.push(t('scenario_export.nothing_to_add'));
  }
  return lines;
}

export function renderScenarioExport(data: ExportData, t: Translator): string {
  return [
    t('scenario_export.saved', {
      id: data.scenario_id,
      kb: num(Math.max(1, Math.ceil(data.bytes / KIB)), t.locale),
    }),
    t('scenario_export.omitted'),
    ...recipeLines(data, t),
    ...(data.recipe === null ? [] : [t('scenario_export.recipe', { path: data.recipe })]),
    t('scenario_export.ignored'),
    t('scenario_export.open', { path: data.path }),
  ].join('\n');
}

/** The Markdown file written beside the ZIP: the same recipe and the commands that start the project. */
export function renderRecipeFile(data: ExportData, t: Translator): string {
  return [
    `# ${t('scenario_export.file_title', { id: data.scenario_id })}`,
    '',
    t('scenario_export.omitted'),
    '',
    ...recipeLines(data, t),
    '',
    t('scenario_export.file_steps'),
    '',
    '```',
    './gradlew gatlingClasses',
    './gradlew gatlingRun',
    '```',
    '',
    t('scenario_export.file_readme'),
    '',
  ].join('\n');
}
