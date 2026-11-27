// The load profile a test run takes: the four numbers the backend's `workload` carries.
// `vusers` means a different thing per type (a user total, an arrival rate or a concurrency target);
// `duration.ts` and `caps.ts` hold the per-type rules.

/** Every type of `WorkloadBody` the plugin starts a run with (`production` plans are not offered). */
export const PROFILE_TYPES = [
  'smoke',
  'ramp',
  'constant',
  'ramp_hold',
  'stress',
  'ramp_concurrency',
  'constant_concurrency',
  'spike',
  'soak',
] as const;

export type ProfileType = (typeof PROFILE_TYPES)[number];

export interface Profile {
  readonly type: ProfileType;
  readonly vusers: number;
  /** Seconds; read by ramp, ramp_hold, stress (step length), ramp_concurrency, spike, soak. */
  readonly ramp?: number;
  /** Seconds; read by constant, ramp_hold, constant_concurrency, spike, soak. */
  readonly hold?: number;
}

/** A profile on the list the user picks from. */
export interface Preset {
  /** Position on the list, from 1; the order of the run wizard's presets. */
  readonly n: number;
  /** Product name of the profile (never translated). */
  readonly label: string;
  readonly type: ProfileType;
  readonly profile: Profile;
}

// PRODUCT RULE OF THE PLUGIN: it comes from the plugin's session specification, not from LoadCraft
// code. The run wizard of the frontend offers the same
// nine profiles in the same order and under the same names, but only with fixed defaults; it has no
// formula that turns "N users" into a profile. For 2 000 users this rule gives 2 000 spread over
// 10 min, 4 new/s for 15 min, 5 steps of 3 min up to 10 new/s, and so on. If the wizard or the
// backend ever get such a rule, take it from there and delete this one.

const MINUTE = 60;
const HOUR = 3600;

/** Users the profile asks for, spread or held: the number the user named. */
const PEAK = 1;
/** Arrival rate of the open profiles: one new user per second for every 500 users named. */
const RATE_DIVISOR = 500;
/** Peak of the stress stairs: one new user per second for every 200 users named, at least 5. */
const STRESS_DIVISOR = 200;
const STRESS_MIN_PEAK = 5;
/** The spike and the soak work with half of the users named (the spike's second burst doubles it). */
const HALF = 2;

const atLeastOne = (value: number): number => Math.max(1, Math.round(value));

/**
 * The nine profiles for `targetUsers` users, in the order of the run wizard. `targetUsers` is
 * clamped to 1 … 1 000 000, the range the backend accepts for `vusers`.
 */
export function buildPresets(targetUsers: number): Preset[] {
  const users = Math.min(1_000_000, Math.max(1, Math.round(targetUsers)));
  const rate = atLeastOne(users / RATE_DIVISOR);
  const half = atLeastOne(users / HALF);
  const profiles: [string, Profile][] = [
    ['Smoke', { type: 'smoke', vusers: 1 }],
    ['Ramp', { type: 'ramp', vusers: users * PEAK, ramp: 10 * MINUTE }],
    ['Constant rate', { type: 'constant', vusers: rate, hold: 15 * MINUTE }],
    ['Ramp + hold', { type: 'ramp_hold', vusers: rate, ramp: MINUTE, hold: 15 * MINUTE }],
    [
      'Stress stairs',
      {
        type: 'stress',
        vusers: Math.max(STRESS_MIN_PEAK, Math.round(users / STRESS_DIVISOR)),
        ramp: 3 * MINUTE,
      },
    ],
    ['Constant load (closed)', { type: 'constant_concurrency', vusers: users, hold: 15 * MINUTE }],
    ['Ramp load (closed)', { type: 'ramp_concurrency', vusers: users, ramp: 10 * MINUTE }],
    ['Spike', { type: 'spike', vusers: half, ramp: MINUTE, hold: MINUTE }],
    ['Soak', { type: 'soak', vusers: half, ramp: MINUTE, hold: 2 * HOUR }],
  ];
  return profiles.map(([label, profile], index) => ({
    n: index + 1,
    label,
    type: profile.type,
    profile,
  }));
}
