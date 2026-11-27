import { describe, expect, it } from 'vitest';
import { clampProfile } from '../src/profiles/caps.js';
import { plannedDurationSeconds } from '../src/profiles/duration.js';
import {
  buildPresets,
  PROFILE_TYPES,
  type Profile,
  type ProfileType,
} from '../src/profiles/presets.js';

const profile = (type: ProfileType, vusers: number, ramp?: number, hold?: number): Profile => ({
  type,
  vusers,
  ...(ramp === undefined ? {} : { ramp }),
  ...(hold === undefined ? {} : { hold }),
});

describe('plannedDurationSeconds', () => {
  // Shapes of `Environment.scala`.
  const table: [string, Profile, number | null][] = [
    ['smoke is one instant pass', profile('smoke', 1), null],
    ['ramp lasts the ramp', profile('ramp', 2000, 600), 600],
    ['constant lasts the hold', profile('constant', 4, undefined, 900), 900],
    ['ramp_hold runs ramp, then hold', profile('ramp_hold', 4, 60, 900), 960],
    ['stress is five levels of the step', profile('stress', 10, 180), 900],
    ['stress step floors at one second', profile('stress', 10, 0), 5],
    [
      'constant_concurrency lasts the hold',
      profile('constant_concurrency', 2000, undefined, 900),
      900,
    ],
    ['ramp_concurrency lasts the ramp', profile('ramp_concurrency', 2000, 600), 600],
    ['spike is the pause, then the gap', profile('spike', 1000, 60, 60), 120],
    ['spike pauses floor at one second', profile('spike', 5, 0, 0), 2],
    ['soak ramps, then holds', profile('soak', 1000, 60, 7200), 7260],
    ['soak ramp floors at one second', profile('soak', 10, 0, 3600), 3601],
  ];
  it.each(table)('%s', (_name, input, seconds) => {
    expect(plannedDurationSeconds(input)).toBe(seconds);
  });

  it('knows every profile type', () => {
    for (const type of PROFILE_TYPES) {
      expect(() => plannedDurationSeconds(profile(type, 10, 30, 60))).not.toThrow();
    }
  });
});

describe('clampProfile', () => {
  const caps = {
    none: {},
    vu: { maxVu: 100 },
    rps: { maxRps: 20 },
    both: { maxVu: 100, maxRps: 20 },
  };

  // type, vusers in, then the vusers out under (no caps, max_vu 100, max_rps 20, both)
  // Families (+ the spike halving).
  const table: [ProfileType, number, number, number, number, number][] = [
    ['smoke', 500, 500, 100, 500, 100],
    ['ramp', 2000, 2000, 100, 2000, 100],
    ['constant', 500, 500, 500, 20, 20],
    ['ramp_hold', 500, 500, 100, 20, 20],
    ['stress', 500, 500, 500, 20, 20],
    ['ramp_concurrency', 2000, 2000, 100, 2000, 100],
    ['constant_concurrency', 2000, 2000, 100, 2000, 100],
    ['spike', 1000, 1000, 50, 1000, 50],
    ['soak', 1000, 1000, 100, 1000, 100],
  ];
  it.each(table)('%s: %i users', (type, vusers, none, vu, rps, both) => {
    const input = profile(type, vusers, 30, 60);
    const expected = { none, vu, rps, both };
    for (const key of ['none', 'vu', 'rps', 'both'] as const) {
      const result = clampProfile(input, caps[key]);
      expect(result.profile).toEqual({ ...input, vusers: expected[key] });
      expect(result.clamped).toBe(expected[key] !== vusers);
    }
  });

  it('leaves ramp and hold alone', () => {
    const result = clampProfile(profile('ramp_hold', 500, 60, 900), caps.vu);
    expect(result.profile).toEqual({ type: 'ramp_hold', vusers: 100, ramp: 60, hold: 900 });
  });

  it('does not clamp a profile already within the limit', () => {
    for (const type of PROFILE_TYPES) {
      const input = profile(type, 10, 30, 60);
      expect(clampProfile(input, caps.both)).toEqual({ profile: input, clamped: false });
    }
  });

  it('does not clamp a profile exactly at the limit', () => {
    const input = profile('ramp', 100, 60);
    expect(clampProfile(input, caps.vu)).toEqual({ profile: input, clamped: false });
  });

  it('keeps the peak of a spike within the limit (second burst is twice the first)', () => {
    const result = clampProfile(profile('spike', 1000, 60, 60), caps.vu);
    expect(result).toEqual({
      profile: { type: 'spike', vusers: 50, ramp: 60, hold: 60 },
      clamped: true,
      note: 'second_burst_doubles',
    });
  });

  it('halves an odd limit down for a spike', () => {
    expect(clampProfile(profile('spike', 1000, 60, 60), { maxVu: 101 }).profile.vusers).toBe(50);
  });

  it('refuses a spike at a limit of one user, which fits no second burst', () => {
    const input = profile('spike', 10, 10, 30);
    expect(clampProfile(input, { maxVu: 1 })).toEqual({
      profile: input,
      clamped: false,
      refusal: 'spike_needs_two_users',
    });
  });

  it('ignores max_rps for a spike', () => {
    const input = profile('spike', 10, 10, 30);
    expect(clampProfile(input, { maxRps: 1 })).toEqual({ profile: input, clamped: false });
  });

  it('warns that a stress under 5 users/s still climbs to 5', () => {
    const result = clampProfile(profile('stress', 50, 20), { maxRps: 3 });
    expect(result).toEqual({
      profile: { type: 'stress', vusers: 3, ramp: 20 },
      clamped: true,
      note: 'stress_step_floor',
    });
  });

  it('does not warn about the stress floor at 5 users/s', () => {
    expect(clampProfile(profile('stress', 5, 20), caps.none).note).toBeUndefined();
  });

  it('does not touch the input', () => {
    const input = profile('ramp', 2000, 600);
    clampProfile(input, caps.vu);
    expect(input.vusers).toBe(2000);
  });
});

describe('buildPresets', () => {
  const NAMES = [
    'Smoke',
    'Ramp',
    'Constant rate',
    'Ramp + hold',
    'Stress stairs',
    'Constant load (closed)',
    'Ramp load (closed)',
    'Spike',
    'Soak',
  ];

  // Product rule of the plugin (see presets.ts), pinned at the edges: the `max(1, …)` floors, the
  // stress peak of at least 5, and the 1 000 000 ceiling of `vusers`.
  const table: [number, Profile[]][] = [
    [
      2000,
      [
        profile('smoke', 1),
        profile('ramp', 2000, 600),
        profile('constant', 4, undefined, 900),
        profile('ramp_hold', 4, 60, 900),
        profile('stress', 10, 180),
        profile('constant_concurrency', 2000, undefined, 900),
        profile('ramp_concurrency', 2000, 600),
        profile('spike', 1000, 60, 60),
        profile('soak', 1000, 60, 7200),
      ],
    ],
    [
      1,
      [
        profile('smoke', 1),
        profile('ramp', 1, 600),
        profile('constant', 1, undefined, 900),
        profile('ramp_hold', 1, 60, 900),
        profile('stress', 5, 180),
        profile('constant_concurrency', 1, undefined, 900),
        profile('ramp_concurrency', 1, 600),
        profile('spike', 1, 60, 60),
        profile('soak', 1, 60, 7200),
      ],
    ],
    [
      20,
      [
        profile('smoke', 1),
        profile('ramp', 20, 600),
        profile('constant', 1, undefined, 900),
        profile('ramp_hold', 1, 60, 900),
        profile('stress', 5, 180),
        profile('constant_concurrency', 20, undefined, 900),
        profile('ramp_concurrency', 20, 600),
        profile('spike', 10, 60, 60),
        profile('soak', 10, 60, 7200),
      ],
    ],
    [
      100,
      [
        profile('smoke', 1),
        profile('ramp', 100, 600),
        profile('constant', 1, undefined, 900),
        profile('ramp_hold', 1, 60, 900),
        profile('stress', 5, 180),
        profile('constant_concurrency', 100, undefined, 900),
        profile('ramp_concurrency', 100, 600),
        profile('spike', 50, 60, 60),
        profile('soak', 50, 60, 7200),
      ],
    ],
    [
      10_000,
      [
        profile('smoke', 1),
        profile('ramp', 10_000, 600),
        profile('constant', 20, undefined, 900),
        profile('ramp_hold', 20, 60, 900),
        profile('stress', 50, 180),
        profile('constant_concurrency', 10_000, undefined, 900),
        profile('ramp_concurrency', 10_000, 600),
        profile('spike', 5000, 60, 60),
        profile('soak', 5000, 60, 7200),
      ],
    ],
  ];

  it.each(table)('for %i users', (users, expected) => {
    const presets = buildPresets(users);
    expect(presets.map((preset) => preset.profile)).toEqual(expected);
    expect(presets.map((preset) => preset.type)).toEqual(expected.map((p) => p.type));
    expect(presets.map((preset) => preset.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(presets.map((preset) => preset.label)).toEqual(NAMES);
  });

  it('keeps the users within what the backend accepts', () => {
    expect(buildPresets(5_000_000)[1]?.profile.vusers).toBe(1_000_000);
    expect(buildPresets(0)[1]?.profile.vusers).toBe(1);
  });

  it('offers every profile type once', () => {
    expect(
      buildPresets(2000)
        .map((preset) => preset.type)
        .sort(),
    ).toEqual([...PROFILE_TYPES].sort());
  });
});

describe('clamped presets never exceed the limits', () => {
  const limits = [
    { maxVu: 1 },
    { maxVu: 7 },
    { maxVu: 100 },
    { maxRps: 3 },
    { maxRps: 20 },
    { maxVu: 100, maxRps: 20 },
    { maxVu: 50, maxRps: 1 },
  ];
  const users = [1, 2, 5, 19, 20, 99, 100, 101, 2000, 9999, 10_000, 1_000_000];

  it.each(limits)('limits %o', (caps) => {
    for (const target of users) {
      for (const preset of buildPresets(target)) {
        const result = clampProfile(preset.profile, caps);
        if (result.refusal !== undefined) {
          expect(preset.type).toBe('spike');
          continue;
        }
        const { type, vusers } = result.profile;
        const perUser = [
          'smoke',
          'ramp',
          'ramp_hold',
          'ramp_concurrency',
          'constant_concurrency',
          'soak',
        ];
        if (caps.maxVu !== undefined && perUser.includes(type)) {
          expect(vusers).toBeLessThanOrEqual(caps.maxVu);
        }
        if (caps.maxVu !== undefined && type === 'spike') {
          expect(vusers * 2).toBeLessThanOrEqual(caps.maxVu);
        }
        if (caps.maxRps !== undefined && ['constant', 'ramp_hold', 'stress'].includes(type)) {
          // The stairs of a stress profile climb to at least 5 per second whatever the limit.
          if (type === 'stress' && caps.maxRps < 5) {
            expect(result.note).toBe('stress_step_floor');
          } else {
            expect(vusers).toBeLessThanOrEqual(caps.maxRps);
          }
        }
      }
    }
  });
});
