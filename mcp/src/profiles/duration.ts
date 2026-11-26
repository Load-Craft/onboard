// How long a profile injects load, from the shapes the backend bakes into `Environment.scala`
// (`backend/domain/services/gatling/codegen/config_generator.py`, commit 6f9a42e45). Open steps and the two closed soak steps run one after the other, so the
// window is the sum of the steps.

import type { Profile } from './presets.js';

/**
 * Seconds from the first injected user to the end of the last step, or null when there is no
 * window (a smoke test starts its users at once and ends with the journey).
 *
 * Per type, with `config_generator.py` lines:
 * - ramp, ramp_concurrency: `ramp` (:667, :746)
 * - constant, constant_concurrency: `hold` (:669, :748)
 * - ramp_hold: `ramp + hold`, two steps in a row (:671-675); the backend's own safety floor
 *   (`injection_builder.py:799-800`) takes `max(ramp, hold)`, a bound and not the plan
 * - stress: five levels of `max(ramp, 1)` s (:676-683); `hold` is ignored
 * - spike: `max(ramp, 1) + max(hold, 1)`, the two pauses (:689-697)
 * - soak: `max(ramp, 1) + hold` (:760-765)
 */
export function plannedDurationSeconds(profile: Profile): number | null {
  const ramp = profile.ramp ?? 0;
  const hold = profile.hold ?? 0;
  switch (profile.type) {
    case 'smoke':
      return null;
    case 'ramp':
    case 'ramp_concurrency':
      return ramp;
    case 'constant':
    case 'constant_concurrency':
      return hold;
    case 'ramp_hold':
      return ramp + hold;
    case 'stress':
      return 5 * Math.max(ramp, 1);
    case 'spike':
      return Math.max(ramp, 1) + Math.max(hold, 1);
    case 'soak':
      return Math.max(ramp, 1) + hold;
  }
}
