// Clamps every phase of a load profile to the limits of an environment before a run is started,
// and tells the user what a limit will do to each profile.
//
// The rule is the backend's own, copied so both sides agree: `clamp_workload` and
// `_applicable_vuser_ceilings` of the backend's injection builder, with the spike rule of
// `SPIKE_PEAK_MULTIPLIER` in the same file: a spike bursts to twice its `vusers`, so `max_vu` bounds `vusers` at `max_vu // 2`,
// and a limit of one user fits no spike.

import type { Profile, ProfileType } from './presets.js';

export interface EnvironmentCaps {
  readonly maxVu?: number;
  readonly maxRps?: number;
}

/** What a clamped or tiny profile still does that the limit does not bound. */
export type ClampNote =
  /** The second burst of a spike is twice the first, so the limit was halved for `vusers`. */
  | 'second_burst_doubles'
  /** A stress profile climbs by `max(vusers / 5, 1)` per level: below 5 users/s the top is 5. */
  | 'stress_step_floor';

export type ClampRefusal = 'spike_needs_two_users';

export interface ClampResult {
  readonly profile: Profile;
  readonly clamped: boolean;
  readonly note?: ClampNote;
  /** The environment cannot run this profile at all; `profile` is the input, unchanged. */
  readonly refusal?: ClampRefusal;
}

/** Spike bursts `vusers`, then `vusers * 2`. */
const SPIKE_PEAK_MULTIPLIER = 2;

/** Stress steps `incrementUsersPerSec(max(vusers / 5, 1))` five times. */
const STRESS_LEVELS = 5;

const VU_CAPPED: ReadonlySet<ProfileType> = new Set([
  'smoke',
  'ramp',
  'spike',
  'soak',
  'ramp_concurrency',
  'constant_concurrency',
]);
const RPS_CAPPED: ReadonlySet<ProfileType> = new Set(['constant', 'stress']);
const BOTH_CAPPED: ReadonlySet<ProfileType> = new Set(['ramp_hold']);

/** The limits that bound `vusers` of this type. */
function ceilings(type: ProfileType, caps: EnvironmentCaps): number[] {
  const found: number[] = [];
  if (type === 'spike' && caps.maxVu !== undefined) {
    found.push(Math.floor(caps.maxVu / SPIKE_PEAK_MULTIPLIER));
  } else if ((VU_CAPPED.has(type) || BOTH_CAPPED.has(type)) && caps.maxVu !== undefined) {
    found.push(Math.floor(caps.maxVu));
  }
  if ((RPS_CAPPED.has(type) || BOTH_CAPPED.has(type)) && caps.maxRps !== undefined) {
    found.push(Math.floor(caps.maxRps));
  }
  return found;
}

/**
 * Lowers `vusers` to the smallest limit that applies to the profile's type; `ramp` and `hold` are
 * never touched. A spike under a limit of one user is refused,
 * as the backend refuses it before the run, not clamped to nobody.
 */
export function clampProfile(profile: Profile, caps: EnvironmentCaps): ClampResult {
  const ceiling = Math.min(...ceilings(profile.type, caps), Number.POSITIVE_INFINITY);
  if (profile.type === 'spike' && ceiling < 1) {
    return { profile, clamped: false, refusal: 'spike_needs_two_users' };
  }
  const clamped = profile.vusers > ceiling;
  const result = clamped ? { ...profile, vusers: ceiling } : profile;
  const note = noteFor(result, clamped);
  return { profile: result, clamped, ...(note === undefined ? {} : { note }) };
}

function noteFor(profile: Profile, clamped: boolean): ClampNote | undefined {
  if (profile.type === 'spike' && clamped) return 'second_burst_doubles';
  if (profile.type === 'stress' && profile.vusers < STRESS_LEVELS) return 'stress_step_floor';
  return undefined;
}
