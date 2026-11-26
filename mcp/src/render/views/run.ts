// View of `run_start` when the run has started: what the limit of the environment did to the load,
// the data check under the load that was sent, and the profile the run started with. The texts of
// the refusals before a start (confirmation, data, limits) are filled from here as well.

import type { Translator } from '../../context.js';
import type { DataDemand } from '../../api/data.js';
import type { SlaThreshold } from '../../api/executions.js';
import type { ClampNote, EnvironmentCaps } from '../../profiles/caps.js';
import type { Profile, ProfileType } from '../../profiles/presets.js';
import { clock, decimal, inline, ms, num, percent, VIEW_WIDTH, wrap } from '../primitives.js';
import { slotRef } from '../slotRef.js';

/** One data slot of the check made with the load that was sent. */
export interface RunDataSlot {
  /** Label of the slot, from LoadCraft. */
  readonly slot: string;
  /** Name of the dataset the run reads for it; null when none is bound. */
  readonly dataset: string | null;
  readonly have: number | null;
  /** Rows the load needs; null when the slot does not consume rows one by one. */
  readonly need: number | null;
}

export interface RunStartData {
  readonly execution: { readonly id: string; readonly handle: string };
  readonly target: { readonly kind: 'composition' | 'scenario'; readonly name: string };
  readonly environment: {
    readonly name: string;
    readonly protected: boolean;
    readonly caps: EnvironmentCaps;
  };
  /** Product name of the profile, as the run wizard shows it. */
  readonly label: string;
  /** The profile as asked for. */
  readonly requested: Profile;
  /** The profile the run was started with, after the limits of the environment. */
  readonly effective: Profile;
  readonly clamped: boolean;
  readonly note?: ClampNote;
  readonly thresholds: readonly SlaThreshold[];
  readonly dataCheck: readonly RunDataSlot[];
  /** Live page of the run. */
  readonly link: string;
  /** The open warning of flows with open generator questions, when the state has one. */
  readonly needsInput?: { readonly flows: number; readonly definite: number };
}

/** The answer when the run needs the user's consent first; nothing was sent. */
export interface RunConfirmData {
  readonly needsConfirmation: true;
  readonly target: { readonly kind: 'composition' | 'scenario'; readonly name: string };
  readonly environment: {
    readonly name: string;
    readonly protected: boolean;
    readonly caps: EnvironmentCaps;
  };
  /** Product name of the profile, as the run wizard shows it. */
  readonly label: string;
  readonly requested: Profile;
  /** What the run would be started with after the user's consent. */
  readonly effective: Profile;
  readonly clamped: boolean;
  readonly note?: ClampNote;
  /** The open warning of flows with open generator questions, when the state has one. */
  readonly needsInput?: { readonly flows: number; readonly definite: number };
}

/** Profiles whose `vusers` is an arrival rate (users per second), not a number of users. */
const RATE_TYPES: ReadonlySet<ProfileType> = new Set(['constant', 'stress']);

/** The stairs climb by `max(vusers / 5, 1)`, so the top is at least 5 (`config_generator.py:676-683`). */
const STRESS_LEVELS = 5;

/** Longest name from LoadCraft drawn in a line; a refusal sentence may be longer. */
const NAME_LIMIT = 80;
const SENTENCE_LIMIT = 300;

/** `2 000` for a number of users, `4 nowych/s` for an arrival rate. */
function amount(profile: Profile, t: Translator): string {
  const value = num(profile.vusers, t.locale);
  return RATE_TYPES.has(profile.type) ? t('profiles.cap.rate', { value }) : value;
}

/** `100 użytkowników / 20 nowych/s`: the limits the environment sets. */
function capsText(caps: EnvironmentCaps, t: Translator): string {
  return [
    ...(caps.maxVu === undefined ? [] : [t.plural('profiles.cap.users', caps.maxVu)]),
    ...(caps.maxRps === undefined
      ? []
      : [t('profiles.cap.rate', { value: num(caps.maxRps, t.locale) })]),
  ].join(' / ');
}

/** Why the run needs the user's confirmation before it starts. */
function confirmationReason(
  environment: string,
  isProtected: boolean,
  clamped: boolean,
  t: Translator,
): string {
  const name = inline(environment, NAME_LIMIT);
  if (isProtected && clamped) return t('runStart.confirm.both', { environment: name });
  if (isProtected) return t('runStart.confirm.protected', { environment: name });
  return t('runStart.confirm.clamped', { environment: name });
}

/** The slots the data check stops the run on, with their numbers; or the refusal sentence. */
export function dataShortage(demand: DataDemand, t: Translator): string {
  const short = demand.slots
    .filter((slot) => slot.blocking)
    .map((slot) =>
      slot.have === null || slot.need === null
        ? t('runStart.data.slotNone', {
            label: slotRef(slot.label, slot.slot, t, NAME_LIMIT),
            status: slot.status,
          })
        : t('runStart.data.slotShort', {
            label: slotRef(slot.label, slot.slot, t, NAME_LIMIT),
            have: num(slot.have, t.locale),
            need: num(slot.need, t.locale),
          }),
    );
  if (short.length > 0) return short.join('; ');
  return demand.refusal === null
    ? t('runStart.data.notReady')
    : inline(demand.refusal, SENTENCE_LIMIT);
}

/** What the run injects, in a few words; durations stay in the later lines of the run. */
export function shape(profile: Profile, t: Translator): string {
  const users = num(profile.vusers, t.locale);
  switch (profile.type) {
    case 'smoke':
      return t.plural('profiles.desc.smoke', profile.vusers);
    case 'ramp':
      return t('runStart.shape.ramp', { users });
    case 'constant':
      return t('runStart.shape.constant', { rate: users });
    case 'ramp_hold':
      return t('runStart.shape.ramp_hold', { users, rate: users });
    case 'stress':
      return t('runStart.shape.stress', {
        peak: num(Math.max(profile.vusers, STRESS_LEVELS), t.locale),
      });
    case 'constant_concurrency':
      return t('runStart.shape.constant_concurrency', { users });
    case 'ramp_concurrency':
      return t('runStart.shape.ramp_concurrency', { users });
    case 'spike':
      return t('runStart.shape.spike', { users, peak: num(profile.vusers * 2, t.locale) });
    case 'soak':
      return t('runStart.shape.soak', { users });
  }
}

function clampLine(data: RunStartData, t: Translator): string[] {
  if (!data.clamped) return [];
  const params = {
    to: amount(data.effective, t),
    environment: inline(data.environment.name, NAME_LIMIT),
  };
  const key = data.note === 'second_burst_doubles' ? 'runStart.clamped.spike' : 'runStart.clamped';
  return wrap(t(key, params), VIEW_WIDTH, 2);
}

function dataLine(data: RunStartData, t: Translator): string[] {
  const counted = data.dataCheck
    .filter((slot) => slot.have !== null && slot.need !== null)
    .map((slot) =>
      t('runStart.data.slot', {
        name: inline(slot.dataset ?? slot.slot, NAME_LIMIT),
        have: num(slot.have ?? 0, t.locale),
        need: num(slot.need ?? 0, t.locale),
      }),
    );
  return wrap([t('runStart.data.ok'), ...counted].join(' · '), VIEW_WIDTH, 2);
}

export function renderRunStarted(data: RunStartData, t: Translator): string {
  return [
    ...clampLine(data, t),
    ...dataLine(data, t),
    ...wrap(
      t('runStart.started', { label: data.label, shape: shape(data.effective, t) }),
      VIEW_WIDTH,
      2,
    ),
  ].join('\n');
}

/** The consent request: why, the numbers (asked for, would run with, limit) and the next step. */
export function renderRunConfirm(data: RunConfirmData, t: Translator): string {
  const environment = inline(data.environment.name, NAME_LIMIT);
  return [
    ...wrap(
      t('runStart.confirm.head', {
        target: inline(data.target.name, NAME_LIMIT),
        reason: confirmationReason(
          data.environment.name,
          data.environment.protected,
          data.clamped,
          t,
        ),
      }),
      VIEW_WIDTH,
      2,
    ),
    ...wrap(
      t('runStart.confirm.numbers', {
        profile: data.label,
        requested: amount(data.requested, t),
        effective: amount(data.effective, t),
        environment,
        // Never empty here: a protected environment without limits is refused before this.
        limit: capsText(data.environment.caps, t),
      }),
      VIEW_WIDTH,
      2,
    ),
    ...wrap(t('runStart.confirm.next'), VIEW_WIDTH, 2),
  ].join('\n');
}

// ---- the run under way and its end ---------------------------------------------------------------

/** The numbers of a run, as far as the metrics store has them; `null` for one it has not. */
export interface RunLiveNumbers {
  /** Requests per second now. */
  readonly rps: number | null;
  /** Estimate from the histogram of the run, in ms. */
  readonly p95Ms: number | null;
  /** A fraction, 0 to 1. */
  readonly errorRate: number | null;
}

/** Where a run stands while it is followed; the progress line is drawn from it. */
export interface RunProgress {
  readonly phase: 'building' | 'running';
  /** Seconds since the start while the project is built. */
  readonly waitedS: number;
  /** Seconds of load so far; null while building. */
  readonly elapsedS: number | null;
  /** Planned seconds of load; null for a profile without a window (a smoke test). */
  readonly plannedS: number | null;
  /** Null while the numbers are not there: the line then carries the time alone. */
  readonly numbers: RunLiveNumbers | null;
}

/** Width of the chart: a longer series is averaged into this many columns. */
export const CHART_WIDTH = 14;

/** Below this share of the peak, a series counts as flat. */
const FLAT_SHARE = 0.1;

const CHART_BLOCKS = '▁▂▃▄▅▆▇█';

/**
 * The shape of a series in `CHART_WIDTH` columns at most, each the average of its share of the
 * series. The lowest block is the lowest value and the highest block the highest; a series that
 * varies by less than a tenth of its peak is drawn flat, on the lowest block.
 */
export function shapeChart(values: readonly number[]): string {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return '';
  const width = Math.min(CHART_WIDTH, finite.length);
  const columns = Array.from({ length: width }, (_, index) => {
    const from = Math.floor((index * finite.length) / width);
    const to = Math.max(from + 1, Math.floor(((index + 1) * finite.length) / width));
    const part = finite.slice(from, to);
    return part.reduce((sum, value) => sum + value, 0) / part.length;
  });
  const low = Math.min(...columns);
  const high = Math.max(...columns);
  const top = CHART_BLOCKS.length - 1;
  if (!(high > 0) || high - low <= high * FLAT_SHARE) return CHART_BLOCKS.charAt(0).repeat(width);
  return columns
    .map((value) => CHART_BLOCKS.charAt(Math.round(((value - low) / (high - low)) * top)))
    .join('');
}

/** `18 s`; the build of a project takes seconds to minutes. */
function duration(totalSeconds: number, t: Translator): string {
  return t('runStart.progress.seconds', {
    n: num(Math.max(0, Math.round(totalSeconds)), t.locale),
  });
}

function rate(value: number, t: Translator): string {
  const rounded = value >= 10 ? num(Math.round(value), t.locale) : decimal(value, 1, t.locale);
  return t('runStart.progress.rps', { value: rounded });
}

/** `6:40 / 10:00`, or `0:42` for a profile with no planned end. */
export function testTime(elapsedS: number, plannedS: number | null): string {
  return plannedS === null ? clock(elapsedS) : `${clock(elapsedS)} / ${clock(plannedS)}`;
}

export function numberParts(
  numbers: RunLiveNumbers | null,
  withRate: boolean,
  t: Translator,
): string[] {
  if (numbers === null) return [];
  return [
    ...(withRate && numbers.rps !== null ? [rate(numbers.rps, t)] : []),
    ...(numbers.p95Ms === null
      ? []
      : [t('runStart.progress.p95', { value: ms(numbers.p95Ms, t.locale) })]),
    ...(numbers.errorRate === null
      ? []
      : [
          t('runStart.progress.errors', {
            value: percent(numbers.errorRate * 100, 1, t.locale),
          }),
        ]),
  ];
}

/** One self-contained line: `6:40 / 10:00 · 690 requests/s · p95≈ 910 ms · errors 0.6%`. */
export function renderRunProgress(progress: RunProgress, t: Translator): string {
  if (progress.phase === 'building') {
    return t('runStart.progress.building', { time: duration(progress.waitedS, t) });
  }
  return [
    testTime(progress.elapsedS ?? 0, progress.plannedS),
    ...numberParts(progress.numbers, true, t),
  ].join(' · ');
}

export interface RunEnd {
  /** `cancelled`: the run was stopped before its planned end. */
  readonly outcome: 'completed' | 'cancelled';
  /** Seconds from the start of the run to the start of the load; null when not known. */
  readonly buildS: number | null;
  /** Measured seconds of load; null when the backend gave none. */
  readonly elapsedS: number | null;
  readonly plannedS: number | null;
  /** Final numbers; null when the metrics store gave none. */
  readonly numbers: RunLiveNumbers | null;
  /** Requests per second over the run, oldest first. */
  readonly series: readonly number[];
}

/** What a finished run shows: the start lines, the numbers, the chart and the next step. */
export interface RunDoneData extends RunStartData {
  readonly end: RunEnd;
}

function endLine(end: RunEnd, t: Translator): string[] {
  const parts = [
    ...(end.buildS === null ? [] : [t('runStart.done.build', { time: duration(end.buildS, t) })]),
    ...(end.elapsedS === null
      ? []
      : [t('runStart.progress.test', { time: testTime(end.elapsedS, end.plannedS) })]),
    ...numberParts(end.numbers, false, t),
  ];
  return parts.length === 0 ? [] : wrap(parts.join(' · '), VIEW_WIDTH, 2);
}

/**
 * The text of a finished run: the lines of the start, the link of the live page, the line of
 * times and numbers, the chart, and the closing line with the handle of the report.
 */
export function renderRunDone(data: RunDoneData, t: Translator): string {
  const chart = shapeChart(data.end.series);
  return [
    renderRunStarted(data, t),
    `↗ ${inline(data.link)}`,
    ...endLine(data.end, t),
    ...(chart === '' ? [] : [chart]),
    ...(data.clamped
      ? wrap(t('runStart.done.clamped', { to: amount(data.effective, t) }), VIEW_WIDTH, 2)
      : []),
    ...wrap(
      t(`runStart.done.${data.end.outcome}`, { handle: inline(data.execution.handle, NAME_LIMIT) }),
      VIEW_WIDTH,
      2,
    ),
  ].join('\n');
}

// ---- the dry run: facts before a test, nothing started -----------------------------------------

/** One data slot of the check, with what decides whether it blocks a run. */
export interface DryRunSlot extends RunDataSlot {
  /** Key of the slot, the value of the `slot` parameter of the data tools. */
  readonly key: string;
  /** Status of the slot in the check (`ok`, `short_rows`, `missing`, …). */
  readonly status: string;
  readonly blocking: boolean;
}

/** A test that holds the environment: the handle to follow it with. */
export interface DryRunBusy {
  readonly handle: string;
}

/**
 * What `run_start` answers with `dry_run: true`. The data is language-free (it is also what
 * `format: "data"` returns, as it is); the view below draws the one line from it.
 */
export interface DryRunData {
  readonly dry_run: true;
  readonly target: { readonly kind: 'composition' | 'scenario'; readonly name: string };
  readonly environment: {
    readonly name: string;
    readonly protected: boolean;
    /** The limits of the environment; absent when it sets none. */
    readonly limit?: { readonly max_vu?: number; readonly max_rps?: number };
  };
  /** Product name of the profile, as the run wizard shows it. */
  readonly profile_label: string;
  readonly profile_requested: Profile;
  /** What a real run would start with after the limits of the environment. */
  readonly profile_effective: Profile;
  readonly capped: boolean;
  /** A real call would first ask the user (a protected environment or a clamped profile). */
  readonly consent_required: boolean;
  readonly data: {
    /** Rows needed and rows there are, of the slot with the least to spare; null with no such slot. */
    readonly needed: number | null;
    readonly available: number | null;
    readonly ready: boolean;
    readonly slots: readonly DryRunSlot[];
    /** The sentence the data check refused with, when it carried one. */
    readonly refusal: string | null;
  };
  /** Planned seconds of load; null for a profile without a window (a smoke test). */
  readonly planned_s: number | null;
  /** A test that runs on the environment now; null when it is free. */
  readonly busy: DryRunBusy | null;
}

function dryRunShortage(data: DryRunData['data'], t: Translator): string {
  const short = data.slots
    .filter((slot) => slot.blocking)
    .map((slot) =>
      slot.have === null || slot.need === null
        ? t('runStart.data.slotNone', {
            label: slotRef(slot.slot, slot.key, t, NAME_LIMIT),
            status: inline(slot.status, NAME_LIMIT),
          })
        : t('runStart.data.slotShort', {
            label: slotRef(slot.slot, slot.key, t, NAME_LIMIT),
            have: num(slot.have, t.locale),
            need: num(slot.need, t.locale),
          }),
    );
  if (short.length > 0) return short.join('; ');
  return data.refusal === null ? t('runStart.data.notReady') : inline(data.refusal, SENTENCE_LIMIT);
}

/** One line, parts joined with ` · `: the line a model reads before it decides to start a test. */
export function renderRunDryRun(data: DryRunData, t: Translator): string {
  const caps: EnvironmentCaps = {
    ...(data.environment.limit?.max_vu === undefined
      ? {}
      : { maxVu: data.environment.limit.max_vu }),
    ...(data.environment.limit?.max_rps === undefined
      ? {}
      : { maxRps: data.environment.limit.max_rps }),
  };
  const limits =
    capsText(caps, t) === ''
      ? t('status.preflight.noLimit')
      : t('status.preflight.limit', { caps: capsText(caps, t) });
  const environment = data.environment.protected
    ? `${t('status.preflight.protected')}, ${limits}`
    : limits;
  const load = data.capped
    ? t('status.preflight.loadClamped', {
        label: data.profile_label,
        requested: amount(data.profile_requested, t),
        effective: amount(data.profile_effective, t),
      })
    : t('status.preflight.load', {
        label: data.profile_label,
        requested: amount(data.profile_requested, t),
      });
  return [
    t('status.preflight.head', {
      target: inline(data.target.name, NAME_LIMIT),
      environment: inline(data.environment.name, NAME_LIMIT),
    }),
    environment,
    load,
    t(data.consent_required ? 'status.preflight.consent' : 'status.preflight.noConsent'),
    data.data.ready
      ? t('status.preflight.dataReady')
      : t('status.preflight.dataShort', { rows: dryRunShortage(data.data, t) }),
    ...(data.planned_s === null
      ? []
      : [t('status.preflight.planned', { time: clock(data.planned_s) })]),
    data.busy === null
      ? t('status.preflight.free')
      : t('status.preflight.busy', { handle: inline(data.busy.handle, NAME_LIMIT) }),
  ].join(' · ');
}
