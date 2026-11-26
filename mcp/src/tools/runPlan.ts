// `run_plan`: the nine load profiles for the number of users the user named, with what the
// limits of the chosen environment do to each. Read-only; `run_start` takes the `profile` of an entry.

import * as z from 'zod';

import { preflightCompositionFor, type DataDemand } from '../api/data.js';
import { listEnvironmentStates } from '../api/status.js';
import { ToolError } from '../errors.js';
import { clampProfile } from '../profiles/caps.js';
import { plannedDurationSeconds } from '../profiles/duration.js';
import { buildPresets } from '../profiles/presets.js';
import { defineTool } from '../registry.js';
import { renderRunPlan, type ProfileEntry, type ProfilesData } from '../render/views/runPlan.js';
import { createResolver } from '../resolve/handles.js';

/** Range the backend accepts for `vusers` (`WorkloadBody`). */
const MAX_USERS = 1_000_000;

const input = z.strictObject({
  scenario: z.string().min(1).describe('Name of the composition or scenario the test will run.'),
  environment: z.string().min(1).describe('Name of the environment the test will run on.'),
  target_users: z
    .number()
    .int()
    .min(1)
    .max(MAX_USERS)
    .describe('How many users the user wants to test with (for example 2000).'),
  include_data: z
    .boolean()
    .default(false)
    .describe(
      'Also check, for every profile, whether the composition has enough data for it ' +
        '(nine data checks; slower, off by default).',
    ),
});

export const runPlan = defineTool({
  name: 'run_plan',
  title: 'Load profiles',
  description:
    'Step 06, before run_start: the nine load profiles (Smoke first, the default) for a number of ' +
    'users, with what the limits of the environment do to each one (clamped, or not possible), ' +
    'and optionally whether the data is enough. The text prints the ready `profile` object of every entry, ' +
    'one JSON line each, to pass to run_start as it is. Read-only: it starts nothing and changes nothing.',
  input,
  annotations: { readOnlyHint: true },
  async run(ctx, args) {
    const resolver = createResolver(ctx);
    const { id: projectId } = await resolver.project();
    const [target, environment] = await Promise.all([
      resolver.runScenarioTarget(projectId, args.scenario),
      resolver.environment(projectId, args.environment),
    ]);
    const states = await listEnvironmentStates(ctx, projectId);
    const state = states.find((candidate) => candidate.name === environment.name);
    if (state === undefined) {
      throw new ToolError('not_found', { params: { available: '' } });
    }

    const checkData = args.include_data && target.kind === 'composition';
    const profiles: ProfileEntry[] = await Promise.all(
      buildPresets(args.target_users).map(async (preset): Promise<ProfileEntry> => {
        const result = clampProfile(preset.profile, state.caps);
        // A refused profile cannot run, so there is nothing to check data for.
        const data: DataDemand | undefined =
          checkData && result.refusal === undefined
            ? await preflightCompositionFor(ctx, projectId, target.id, result.profile)
            : undefined;
        return {
          n: preset.n,
          type: preset.type,
          label: preset.label,
          isDefault: preset.type === 'smoke',
          profile: preset.profile,
          applied: result.profile,
          clamped: result.clamped,
          ...(result.note === undefined ? {} : { note: result.note }),
          ...(result.refusal === undefined ? {} : { refusal: result.refusal }),
          plannedSeconds: plannedDurationSeconds(result.profile),
          ...(data === undefined ? {} : { data }),
        };
      }),
    );

    const data: ProfilesData = {
      target: { kind: target.kind, name: target.name },
      environment: { name: state.name, protected: state.protected, caps: state.caps },
      targetUsers: args.target_users,
      dataCheck: !args.include_data ? 'off' : checkData ? 'done' : 'composition_only',
      profiles,
    };
    return { status: 'done', data };
  },
  render: renderRunPlan,
});
