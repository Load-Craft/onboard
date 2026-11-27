// Views of the project profile: `project_get` (the profile field by field, under the names
// `project_set_profile` takes, with the fields the analysis was unsure of and where the applied
// values came from), the consent card and
// the result of `project_set_profile`, and the block of unsure fields the result of
// `project_analyze_setup` shows before anything is applied.

import { CARD_TTL_MINUTES } from '../../consent/confirmCard.js';
import type { Translator } from '../../context.js';
import type { SetupStep } from '../../contract/setupGate.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

/** A profile field the analysis proposed with too little confidence, or in conflict. */
export interface UncertainField {
  readonly field: string;
  readonly value: unknown;
  /** 0..1 */
  readonly confidence: number;
  /** Sources of the analysis disagreed about the value. */
  readonly conflicted: boolean;
  /** The backend keeps the proposal out of the profile until the user confirms it. */
  readonly needsConfirmation?: true;
}

/** Where an applied field's value came from, as the backend recorded it. */
export interface ProvenanceLine {
  readonly field: string;
  readonly sources: readonly string[];
  /** 0..1; null when the value is the user's. */
  readonly confidence: number | null;
  readonly status: string;
  /** Shown for a field applied without the user settling it. */
  readonly rationale?: string;
}

/** One field of a card or of a write: the value before and the value asked for. */
export interface FieldChange {
  readonly field: string;
  readonly current: unknown;
  readonly value: unknown;
}

/** Why a confirm got a new card instead of the write: no card, expired, another token, other fields or profile. */
export type CardRenewal = 'missing' | 'expired' | 'token' | 'changed';

/** The hour and minute of an ISO time on the clock of this machine (`18:56`). */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The consent card of `project_set_profile`: nothing was written. */
export interface ProfileCardData {
  readonly needsConfirmation: true;
  readonly project: { readonly id: string; readonly name: string };
  readonly scope: string;
  /** Fields whose value changes. */
  readonly changes: readonly FieldChange[];
  /** Fields asked for that already have the value. */
  readonly unchanged: readonly string[];
  /** The fields the analysis was unsure of that this call does not set. */
  readonly stillUncertain: readonly string[];
  readonly confirm: string;
  /** The call had a token, but it did not write: this card replaces the earlier one. */
  readonly renewed?: CardRenewal;
  /** With `renewed: "expired"`: when the earlier card was issued (ISO time). */
  readonly expiredIssuedAt?: string;
}

/** The write of `project_set_profile`, or a call that had nothing to change. */
export interface ProfileSetData {
  readonly project: { readonly id: string; readonly name: string };
  readonly n: number;
  /** Names of the fields written. */
  readonly fields: readonly string[];
  readonly changes: readonly FieldChange[];
  readonly unchanged: readonly string[];
  readonly stillUncertain: readonly string[];
}

export type SetProfileData = ProfileCardData | ProfileSetData;

export const isProfileCard = (data: SetProfileData): data is ProfileCardData =>
  'needsConfirmation' in data;

const INDENT = '  ';
const NAME_LIMIT = 80;
const VALUE_LIMIT = 80;
/** Longest list of field names a line quotes. */
const FIELDS_LIMIT = 400;

/** What `GET …/stats` counts for a project. */
export interface ProjectStats {
  readonly flows: number;
  readonly runs: number;
  /** 0..100 */
  readonly passRate: number;
  readonly lastRunAt: string | null;
}

/** The result of `project_get`. */
export interface ProjectGetData {
  readonly project: { readonly id: string; readonly name: string };
  /** Every field `project_set_profile` takes, by its name, as the profile has it. */
  readonly profile: { readonly [field: string]: unknown };
  /** Fields the open warning names and those the backend recorded as not settled by the user. */
  readonly uncertain: readonly string[];
  /** Where the applied values came from; absent when the backend recorded none. */
  readonly provenance?: readonly ProvenanceLine[];
  readonly stats?: ProjectStats;
  readonly setup?: { readonly complete: boolean; readonly missing: readonly SetupStep[] };
  /** The log server; null when none is connected. Absent when not asked for. */
  readonly telemetry?: { readonly label: string } | null;
}

/** A value as one line: text as it is, null as a dash, anything else as JSON. */
function valueText(value: unknown, t: Translator): string {
  if (value === null || value === undefined) return t('projectProfile.none');
  if (typeof value === 'string') return inline(value, VALUE_LIMIT);
  if (Array.isArray(value) && value.length === 0) return t('projectProfile.none');
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return inline(value.join(', '), VALUE_LIMIT);
  }
  return inline(JSON.stringify(value) ?? '', VALUE_LIMIT);
}

const fieldList = (fields: readonly string[]): string => inline(fields.join(', '), FIELDS_LIMIT);

/** Longest rationale of a provenance line (the backend keeps at most 500 characters). */
const RATIONALE_LIMIT = 200;

/** A value, with what `unknown` of the architecture means. */
function fieldValueText(field: string, value: unknown, t: Translator): string {
  const text = valueText(value, t);
  return field === 'app_architecture' && value === 'unknown'
    ? `${text} (${t('projectProfile.architecture.unknown')})`
    : text;
}

/** The fields shown one per line, in this order; the flags follow on two lines. */
const VALUE_FIELDS = [
  'app_architecture',
  'api_protocol',
  'auth_method',
  'auth_token_endpoint',
  'graphql_endpoint',
  'idp_domains',
  'known_third_party_domains',
  'additional_notes',
] as const;

const FLAG_FIELDS = [
  'has_async_operations',
  'has_file_uploads',
  'has_mfa',
  'has_multi_tenant',
  'has_pagination',
  'has_presigned_urls',
  'has_sse',
  'has_websockets',
  'uses_csrf',
  'self_check_enabled',
] as const;

/** One profile field per line, the unsure ones marked; the flags as two lists. */
function profileLines(
  profile: ProjectGetData['profile'],
  uncertain: readonly string[],
  t: Translator,
): string[] {
  const mark = (field: string): string =>
    uncertain.includes(field) ? ` ${t('projectProfile.unsureMark')}` : '';
  const lines = VALUE_FIELDS.map(
    (field) => `${INDENT}${field}: ${fieldValueText(field, profile[field], t)}${mark(field)}`,
  );
  const on = FLAG_FIELDS.filter((field) => profile[field] === true).map(
    (field) => `${field}${mark(field)}`,
  );
  const off = FLAG_FIELDS.filter((field) => profile[field] !== true).map(
    (field) => `${field}${mark(field)}`,
  );
  for (const [key, fields] of [
    ['projectProfile.on', on],
    ['projectProfile.off', off],
  ] as const) {
    if (fields.length === 0) continue;
    lines.push(...wrap(`${INDENT}${t(key, { fields: fields.join(', ') })}`, VIEW_WIDTH, 4));
  }
  return lines;
}

/** `auth_method: openapi · 95% · accepted`, with the rationale of a field the user did not settle. */
function provenanceLines(provenance: readonly ProvenanceLine[], t: Translator): string[] {
  if (provenance.length === 0) return [];
  return [
    t('projectProfile.provenance.heading'),
    ...provenance.flatMap((item) => {
      const parts = [
        item.sources.length === 0
          ? t('projectProfile.none')
          : inline(item.sources.join(', '), VALUE_LIMIT),
        ...(item.confidence === null ? [] : [`${String(Math.round(item.confidence * 100))}%`]),
        inline(item.status, 40),
      ];
      const why =
        item.rationale === undefined ? '' : ` — ${inline(item.rationale, RATIONALE_LIMIT)}`;
      return wrap(
        `${INDENT}${inline(item.field, NAME_LIMIT)}: ${parts.join(' · ')}${why}`,
        VIEW_WIDTH,
        4,
      );
    }),
  ];
}

export function renderProjectGet(data: ProjectGetData, t: Translator): string {
  const lines = [
    t('projectProfile.header', { name: inline(data.project.name, NAME_LIMIT) }),
    ...profileLines(data.profile, data.uncertain, t),
    ...provenanceLines(data.provenance ?? [], t),
  ];
  if (data.uncertain.length > 0) {
    lines.push(
      ...wrap(t('projectProfile.uncertain', { fields: fieldList(data.uncertain) }), VIEW_WIDTH, 2),
    );
  }
  if (data.stats !== undefined) {
    lines.push(
      t('projectProfile.stats', {
        flows: data.stats.flows,
        runs: data.stats.runs,
        passRate: Math.round(data.stats.passRate),
        lastRun:
          data.stats.lastRunAt === null
            ? t('projectProfile.none')
            : inline(data.stats.lastRunAt.slice(0, 16).replace('T', ' '), 20),
      }),
    );
  }
  if (data.setup !== undefined) {
    lines.push(
      ...wrap(
        data.setup.complete
          ? t('projectProfile.setup.complete')
          : t('status.setup.incomplete', {
              missing: data.setup.missing
                .map((step) => t(`error.setup_incomplete.part.${step}`))
                .join(', '),
            }),
        VIEW_WIDTH,
        2,
      ),
    );
  }
  if (data.telemetry !== undefined) {
    lines.push(
      data.telemetry === null
        ? t('projectProfile.telemetry.off')
        : t('projectProfile.telemetry.on', { label: inline(data.telemetry.label, NAME_LIMIT) }),
    );
  }
  return lines.join('\n');
}

const changeLine = (item: FieldChange, t: Translator): string =>
  `${INDENT}${t('projectProfile.change', {
    field: inline(item.field, NAME_LIMIT),
    current: valueText(item.current, t),
    value: valueText(item.value, t),
  })}`;

export function renderSetProfile(data: SetProfileData, t: Translator): string {
  const name = inline(data.project.name, NAME_LIMIT);
  const tail = [
    ...(data.unchanged.length === 0
      ? []
      : wrap(t('projectProfile.unchanged', { fields: fieldList(data.unchanged) }), VIEW_WIDTH, 2)),
    ...(data.stillUncertain.length === 0
      ? []
      : wrap(
          t('projectProfile.stillUncertain', { fields: fieldList(data.stillUncertain) }),
          VIEW_WIDTH,
          2,
        )),
  ];
  if (isProfileCard(data)) {
    return [
      ...(data.renewed === undefined
        ? []
        : wrap(
            data.renewed === 'expired' && data.expiredIssuedAt !== undefined
              ? t('projectProfile.card.renewed.expired_at', {
                  time: clockTime(data.expiredIssuedAt),
                  minutes: CARD_TTL_MINUTES,
                })
              : t(`projectProfile.card.renewed.${data.renewed}`),
            VIEW_WIDTH,
            2,
          )),
      ...wrap(
        t.plural('projectProfile.card.title', data.changes.length, {
          name,
          scope: inline(data.scope, 40),
        }),
        VIEW_WIDTH,
        2,
      ),
      ...data.changes.map((item) => changeLine(item, t)),
      ...tail,
      ...wrap(t('projectProfile.card.next', { confirm: inline(data.confirm, 40) }), VIEW_WIDTH, 2),
    ].join('\n');
  }
  if (data.n === 0) {
    return [...wrap(t('projectProfile.set.nothing', { name }), VIEW_WIDTH, 2), ...tail].join('\n');
  }
  return [
    ...wrap(t.plural('projectProfile.set.title', data.n, { name }), VIEW_WIDTH, 2),
    ...data.changes.map((item) => changeLine(item, t)),
    ...tail,
    ...wrap(t('projectProfile.set.reset'), VIEW_WIDTH, 2),
  ].join('\n');
}

/**
 * The fields the analysis was unsure of, for the result of `project_analyze_setup`: one line each
 * with the proposed value and why, and how to correct one after applying. Empty when there are none.
 */
export function uncertainLines(uncertain: readonly UncertainField[], t: Translator): string[] {
  if (uncertain.length === 0) return [];
  const confidence = (item: UncertainField): string =>
    t('projectProfile.analysis.confidence', { pct: Math.round(item.confidence * 100) });
  return [
    ...wrap(t.plural('projectProfile.analysis.uncertain', uncertain.length), VIEW_WIDTH, 2),
    ...uncertain.map((item) => {
      const why =
        item.field === 'app_architecture' && item.value === 'unknown'
          ? t('projectProfile.architecture.unknown')
          : item.conflicted
            ? t('projectProfile.analysis.conflicted')
            : item.needsConfirmation === true
              ? t('projectProfile.analysis.needsConfirmation', { confidence: confidence(item) })
              : confidence(item);
      return `${INDENT}${inline(item.field, NAME_LIMIT)}: ${valueText(item.value, t)} (${why})`;
    }),
    ...(uncertain.some((item) => item.needsConfirmation === true)
      ? wrap(t('projectProfile.analysis.confirm'), VIEW_WIDTH, 2)
      : []),
    t('projectProfile.analysis.fix'),
  ];
}
