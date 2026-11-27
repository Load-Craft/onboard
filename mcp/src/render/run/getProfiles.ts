// The view of `run_get_profiles`: the stored load profiles of the project, one line each, or one
// profile with its injection steps. Names, descriptions and step values are texts of a third party:
// they arrive in the data masked and made one line.

import type { Translator } from '../../context.js';
import { columns, num } from '../primitives.js';

export interface ProfileRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly users: number;
  readonly durationS: number;
  readonly rampS: number | null;
  readonly isDefault: boolean;
  readonly createdAt: string | null;
}

/** A step of a custom profile: the plain fields the backend stores for it. */
export type StepFields = Readonly<Record<string, string | number | boolean | null>>;

export interface ProfileDetail extends ProfileRow {
  readonly steps: readonly StepFields[];
  /** How many steps the profile has; `steps` holds at most the first of them. */
  readonly stepCount: number;
}

export interface ProfilesData {
  readonly project_id: string;
  /** The profiles of the project, or 1 for one asked by id or name. */
  readonly count: number;
  readonly shown: number;
  readonly items: readonly ProfileRow[];
  /** Set when one profile was asked for. */
  readonly profile: ProfileDetail | null;
}

function loadOf(row: ProfileRow, t: Translator): string {
  const ramp =
    row.rampS === null ? '' : t('run_get_profiles.ramp', { seconds: num(row.rampS, t.locale) });
  return `${num(row.users, t.locale)} ${t('run_get_profiles.users')} · ${num(row.durationS, t.locale)} s${ramp}`;
}

function stepLine(step: StepFields, index: number): string {
  const fields = Object.entries(step).map(
    ([key, value]) => `${key}=${value === null ? '—' : String(value)}`,
  );
  return `  ${String(index + 1)}. ${fields.join(' ')}`;
}

export function renderGetProfiles(data: ProfilesData, t: Translator): string {
  const { profile } = data;
  if (profile !== null) {
    const lines = [
      t('run_get_profiles.one', {
        name: profile.name,
        type: profile.type,
        load: loadOf(profile, t),
        flag: profile.isDefault ? ` · ${t('run_get_profiles.default')}` : '',
      }),
    ];
    if (profile.description !== null) lines.push(profile.description);
    if (profile.steps.length === 0) {
      lines.push(t('run_get_profiles.steps.none'));
    } else {
      lines.push(t.plural('run_get_profiles.steps', profile.stepCount));
      lines.push(...profile.steps.map(stepLine));
      if (profile.steps.length < profile.stepCount) {
        lines.push(
          t('run_get_profiles.steps.more', {
            shown: profile.steps.length,
            total: profile.stepCount,
          }),
        );
      }
    }
    return lines.join('\n');
  }
  if (data.count === 0) return t('run_get_profiles.none');
  const lines = [t.plural('run_get_profiles.header', data.count)];
  lines.push(
    ...columns(
      data.items.map((row) => [
        row.name,
        row.type,
        loadOf(row, t),
        row.isDefault ? t('run_get_profiles.default') : '',
      ]),
    ).map((row) => `  ${row}`),
  );
  if (data.shown < data.count) {
    lines.push(t('run_get_profiles.more', { shown: data.shown, total: data.count }));
  }
  return lines.join('\n');
}
