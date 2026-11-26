// What a started run keeps in the workspace, and the profile of the input it is built from.

import * as z from 'zod';

import type { StateCache } from '../../workspace/cache.js';
import { PROFILE_TYPES, type Profile } from '../../profiles/presets.js';

/** Range of `vusers`, `ramp` and `hold` the backend accepts (`WorkloadBody`). */
const MAX_USERS = 1_000_000;
const MAX_SECONDS = 86_400;

export const profileSchema = z.strictObject({
  type: z.enum(PROFILE_TYPES),
  vusers: z.number().int().min(1).max(MAX_USERS),
  ramp: z.number().int().min(0).max(MAX_SECONDS).optional(),
  hold: z.number().int().min(0).max(MAX_SECONDS).optional(),
});

const thresholdSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('responseTime'), percentile: z.literal(95), max_ms: z.number() }),
  z.object({ type: z.literal('failedRequests'), max_percent: z.number() }),
]);

const capsSchema = z.object({ maxVu: z.number().optional(), maxRps: z.number().optional() });

/**
 * What a started run keeps in the workspace (`operations["test_run:<id>"].saved`): enough for
 * waiting in a later session and for the report to say the plugin clamped the load.
 */
export const testRunSaved = z.object({
  project: z.object({ id: z.string(), name: z.string() }),
  target: z.object({
    kind: z.enum(['composition', 'scenario']),
    id: z.string(),
    name: z.string(),
  }),
  environment: z.object({
    id: z.string(),
    name: z.string(),
    protected: z.boolean(),
    caps: capsSchema,
  }),
  label: z.string(),
  requested: profileSchema,
  effective: profileSchema,
  clamped: z.boolean(),
  note: z.enum(['second_burst_doubles', 'stress_step_floor']).optional(),
  thresholds: z.array(thresholdSchema),
  dataCheck: z.array(
    z.object({
      slot: z.string(),
      dataset: z.string().nullable(),
      have: z.number().nullable(),
      need: z.number().nullable(),
    }),
  ),
  startedAt: z.number(),
});
export type TestRunSaved = z.infer<typeof testRunSaved>;

export function asProfile(input: z.infer<typeof profileSchema>): Profile {
  return {
    type: input.type,
    vusers: input.vusers,
    ...(input.ramp === undefined ? {} : { ramp: input.ramp }),
    ...(input.hold === undefined ? {} : { hold: input.hold }),
  };
}

// ---- the load of a started run, kept after the run is over -----------------------------------

/** How many runs keep their load; the oldest entries are dropped past this. */
export const RUN_LOADS_KEPT = 50;

const runLoad = z.object({
  execution_id: z.string(),
  requested_vu: z.number(),
  effective_vu: z.number(),
});

/** What `state.json → runLoads[execution id]` holds: users asked for and users sent. */
export type RunLoad = z.infer<typeof runLoad>;

type LoadsWrite = Pick<StateCache, 'set' | 'delete' | 'entries'>;

/**
 * Keeps the load of a run the plugin clamped, unlike the `test_run` operation, which goes when
 * the run ends: a report read later, by another process or session, still says the load was cut.
 * Only the last `RUN_LOADS_KEPT` runs are kept.
 */
export async function recordRunLoad(state: LoadsWrite, load: RunLoad): Promise<void> {
  await state.set('runLoads', load.execution_id, load satisfies RunLoad);
  const kept = state.entries('runLoads');
  const surplus = kept.length - RUN_LOADS_KEPT;
  if (surplus <= 0) return;
  const oldest = kept
    .map(([key, entry], order) => ({ key, savedAt: entry.savedAt, order }))
    .sort((a, b) => a.savedAt - b.savedAt || a.order - b.order)
    .slice(0, surplus);
  for (const { key } of oldest) await state.delete('runLoads', key);
}

/** The load kept for a run, when the plugin clamped it. */
export function readRunLoad(
  state: Pick<StateCache, 'get'>,
  executionId: string,
): RunLoad | undefined {
  const checked = runLoad.safeParse(state.get('runLoads', executionId)?.value);
  return checked.success ? checked.data : undefined;
}
