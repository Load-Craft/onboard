// View of `run_plan`: the nine load profiles for the number of users the user named, what the
// limits of the environment do to each, and (on request) whether the data is enough for it.

import type { Translator } from '../../context.js';
import type { DataDemand } from '../../api/data.js';
import type { ClampNote, ClampRefusal, EnvironmentCaps } from '../../profiles/caps.js';
import type { Profile, ProfileType } from '../../profiles/presets.js';
import { columns, inline, num, VIEW_WIDTH, visibleWidth, wrap } from '../primitives.js';
import { slotRef } from '../slotRef.js';

export interface ProfileEntry {
  readonly n: number;
  readonly type: ProfileType;
  /** Product name of the profile, as the run wizard shows it. */
  readonly label: string;
  readonly isDefault: boolean;
  /** What `run_start` takes as `profile`; as the user would run it, before any limit. */
  readonly profile: Profile;
  /** What the environment lets through; equal to `profile` when `clamped` is false. */
  readonly applied: Profile;
  readonly clamped: boolean;
  readonly note?: ClampNote;
  readonly refusal?: ClampRefusal;
  /** Seconds of injection; null for a smoke test. */
  readonly plannedSeconds: number | null;
  /** The data check with the profile as applied; absent unless asked for (or refused). */
  readonly data?: DataDemand;
}

export interface ProfilesData {
  readonly target: { readonly kind: 'composition' | 'scenario'; readonly name: string };
  readonly environment: {
    readonly name: string;
    readonly protected: boolean;
    readonly caps: EnvironmentCaps;
  };
  readonly targetUsers: number;
  /** `off`: not asked for; `done`: checked per profile; `composition_only`: the target is a scenario. */
  readonly dataCheck: 'off' | 'done' | 'composition_only';
  readonly profiles: ProfileEntry[];
}

const INDENT = '  ';
const SEP = '  ';

/** Profiles whose `vusers` is an arrival rate (users per second), not a number of users. */
const RATE_TYPES: ReadonlySet<ProfileType> = new Set(['constant', 'stress']);

/** The stairs climb by `max(vusers / 5, 1)`: the top is `5 × step` (`config_generator.py:676-683`). */
const STRESS_LEVELS = 5;

/** `15 min`, `2 h`, `1 h 30 min`, `45 s`: whole units, largest first. */
function duration(totalSeconds: number, t: Translator): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [
    ...(hours > 0 ? [t('profiles.dur.h', { n: num(hours, t.locale) })] : []),
    ...(minutes > 0 ? [t('profiles.dur.min', { n: minutes })] : []),
    ...(seconds > 0 || totalSeconds === 0 ? [t('profiles.dur.s', { n: seconds })] : []),
  ];
  return parts.join(' ');
}

function describe(entry: ProfileEntry, t: Translator): string {
  const { profile } = entry;
  const users = num(profile.vusers, t.locale);
  const ramp = duration(profile.ramp ?? 0, t);
  const hold = duration(profile.hold ?? 0, t);
  switch (profile.type) {
    case 'smoke':
      return t.plural('profiles.desc.smoke', profile.vusers);
    case 'ramp':
      return t('profiles.desc.ramp', { users, ramp });
    case 'constant':
      return t('profiles.desc.constant', { rate: users, hold });
    case 'ramp_hold':
      return t('profiles.desc.ramp_hold', { users, ramp, rate: users, hold });
    case 'stress':
      return t('profiles.desc.stress', {
        step: duration(Math.max(profile.ramp ?? 0, 1), t),
        peak: num(Math.max(profile.vusers, STRESS_LEVELS), t.locale),
      });
    case 'constant_concurrency':
      return t('profiles.desc.constant_concurrency', { users, hold });
    case 'ramp_concurrency':
      return t('profiles.desc.ramp_concurrency', { users, ramp });
    case 'spike':
      return t('profiles.desc.spike', {
        users,
        hold: duration(Math.max(profile.hold ?? 0, 1), t),
        peak: num(profile.vusers * 2, t.locale),
      });
    case 'soak':
      return t('profiles.desc.soak', { users, hold });
  }
}

/** What the environment does to the profile, in words; empty when nothing. */
function clampMarkers(entry: ProfileEntry, caps: EnvironmentCaps, t: Translator): string[] {
  const { applied, type } = entry;
  const to = RATE_TYPES.has(type)
    ? t('profiles.cap.rate', { value: num(applied.vusers, t.locale) })
    : num(applied.vusers, t.locale);
  const markers: string[] = [];
  if (entry.refusal !== undefined) {
    markers.push(t('profiles.marker.refused', { limit: num(caps.maxVu ?? 0, t.locale) }));
  } else if (entry.clamped && entry.note === 'second_burst_doubles') {
    // Spike rule: the second burst is twice the first, so `max_vu` bounds `vusers` at half of it
    // (`injection_builder.py`, `SPIKE_PEAK_MULTIPLIER`).
    markers.push(t('profiles.marker.spike', { to, limit: num(caps.maxVu ?? 0, t.locale) }));
  } else if (entry.clamped) {
    markers.push(t('profiles.marker.clamped', { to }));
  }
  if (entry.note === 'stress_step_floor') {
    markers.push(t('profiles.marker.stressFloor', { peak: num(STRESS_LEVELS, t.locale) }));
  }
  return markers;
}

function dataMarker(entry: ProfileEntry, t: Translator): string[] {
  if (entry.data === undefined) return [];
  if (entry.data.ready) return [t('profiles.data.ready')];
  const short = entry.data.slots
    .filter((slot) => slot.blocking)
    .map((slot) =>
      slot.have === null || slot.need === null
        ? t('profiles.data.slotNone', { label: slotRef(slot.label, slot.slot, t) })
        : t('profiles.data.slot', {
            label: slotRef(slot.label, slot.slot, t),
            have: num(slot.have, t.locale),
            need: num(slot.need, t.locale),
          }),
    );
  if (short.length === 0) {
    return [t('profiles.data.refused', { reason: inline(entry.data.refusal ?? '—') })];
  }
  return [t('profiles.data.short', { slots: short.join(', ') })];
}

function limitLine(data: ProfilesData, t: Translator): string {
  const { caps } = data.environment;
  const name = inline(data.environment.name);
  const parts = [
    ...(caps.maxVu === undefined ? [] : [t.plural('profiles.cap.users', caps.maxVu)]),
    ...(caps.maxRps === undefined
      ? []
      : [t('profiles.cap.rate', { value: num(caps.maxRps, t.locale) })]),
  ];
  if (parts.length > 0) {
    return t('profiles.limit.caps', { environment: name, caps: parts.join(' / ') });
  }
  return t(data.environment.protected ? 'profiles.limit.protectedNoCaps' : 'profiles.limit.none', {
    environment: name,
  });
}

/** The `profile` argument of `run_start` as one JSON line: the model copies it, it cannot be rebuilt from the words. */
export function profileJson(profile: Profile): string {
  return JSON.stringify({
    type: profile.type,
    vusers: profile.vusers,
    ...(profile.ramp === undefined ? {} : { ramp: profile.ramp }),
    ...(profile.hold === undefined ? {} : { hold: profile.hold }),
  });
}

export function renderRunPlan(data: ProfilesData, t: Translator): string {
  const header = [
    ...wrap(
      t.plural('profiles.title', data.targetUsers, {
        environment: inline(data.environment.name),
      }),
      VIEW_WIDTH,
      INDENT.length,
    ),
    ...wrap(limitLine(data, t), VIEW_WIDTH, INDENT.length),
  ];

  const rows = data.profiles.map((entry) => [
    `${INDENT}${entry.n}. ${entry.label}`,
    describe(entry, t) + (entry.isDefault ? ` ${t('profiles.default')}` : ''),
  ]);
  const aligned = columns(rows, { gap: SEP.length });
  // Where the description starts, so a marker that does not fit goes under it.
  const descriptionAt = Math.max(...rows.map((row) => visibleWidth(row[0] ?? ''))) + SEP.length;

  const list = data.profiles.flatMap((entry, index) => {
    const line = aligned[index] ?? '';
    const markers = [...clampMarkers(entry, data.environment.caps, t), ...dataMarker(entry, t)];
    if (markers.length === 0) return [line];
    const text = markers.join(' ');
    if (visibleWidth(line) + SEP.length + visibleWidth(text) <= VIEW_WIDTH) {
      return [`${line}${SEP}${text}`];
    }
    return [
      line,
      ...wrap(text, VIEW_WIDTH - descriptionAt).map((part) => ' '.repeat(descriptionAt) + part),
    ];
  });

  const profileLines = [
    INDENT + t('profiles.json.title'),
    ...data.profiles.map((entry) => `${INDENT}${INDENT}${entry.n}. ${profileJson(entry.profile)}`),
  ];

  const footer = [
    ...profileLines,
    ...(data.dataCheck === 'composition_only'
      ? wrap(
          t('profiles.data.compositionOnly', { name: inline(data.target.name) }),
          VIEW_WIDTH,
          INDENT.length,
        )
      : []),
    ...wrap(t('profiles.next'), VIEW_WIDTH, INDENT.length),
  ];
  return [...header, ...list, ...footer].join('\n');
}
