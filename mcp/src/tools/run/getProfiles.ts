// `run_get_profiles` (module run): Get stored load profiles: the list, or one with its injection
// steps.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A profile is named by its id or its name (a name matches without regard to case): a name is
// found in the list first, so asking for one profile is two requests, the list and the profile.
// Names, descriptions and step values are written by people and by models, so they pass the mask of
// a third party's text (`content`).
// Log: args "", result "{count} profiles": the data of the result carries the fields.
// Arguments (the catalog's): `profile`, an id or a name; none lists them.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetProfiles,
  type ProfileDetail,
  type ProfileRow,
  type ProfilesData,
  type StepFields,
} from '../../render/run/getProfiles.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { pickNamed } from './common.js';
import { RUN_GET_PROFILES } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/configurations (REST API v1) */
export function listConfigurations(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'list_configurations_api_v1_projects__project_id__gatling_configurations_get'>
> {
  return callBackend(
    ctx,
    'list_configurations_api_v1_projects__project_id__gatling_configurations_get',
    { path },
  );
}

/** GET /projects/{project_id}/gatling/configurations/{config_id} (REST API v1) */
export function getConfiguration(
  ctx: CallContext,
  path: { readonly project_id: string; readonly config_id: string },
): Promise<
  OpOutput<'get_configuration_api_v1_projects__project_id__gatling_configurations__config_id__get'>
> {
  return callBackend(
    ctx,
    'get_configuration_api_v1_projects__project_id__gatling_configurations__config_id__get',
    { path },
  );
}

/** The profiles the data lists; the count says how many the project has. */
const PROFILES_SHOWN = 50;
/** The steps of one profile the data carries, the fields of a step, and the longest text of one. */
const STEPS_SHOWN = 30;
const STEP_FIELDS = 8;
const TEXT_LIMIT = 200;
const VALUE_LIMIT = 60;

type Item =
  OpOutput<'list_configurations_api_v1_projects__project_id__gatling_configurations_get'>['configurations'][number];

function rowOf(ctx: CallContext, item: Item): ProfileRow {
  return {
    id: item.id,
    name: thirdParty(ctx, item.name, TEXT_LIMIT),
    description: item.description === null ? null : thirdParty(ctx, item.description, TEXT_LIMIT),
    type: item.injection_profile,
    users: item.users,
    durationS: item.duration_seconds,
    rampS: item.ramp_duration_seconds,
    isDefault: item.is_default,
    createdAt: item.created_at,
  };
}

/** The plain fields of a step; a nested value (a list, an object) is not read. */
function stepOf(ctx: CallContext, step: Readonly<Record<string, unknown>>): StepFields {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(step).slice(0, STEP_FIELDS)) {
    const name = thirdParty(ctx, key, LIMITS.word);
    if (typeof value === 'string') fields[name] = thirdParty(ctx, value, VALUE_LIMIT);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      fields[name] = value;
    }
  }
  return fields;
}

export const runGetProfiles = moduleTool(RUN_GET_PROFILES, {
  title: 'Get stored load profiles',
  input: {
    profile: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('One load profile with its injection steps (name or id); without it, the list.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const all = await listConfigurations(ctx, path);
    const items = all.configurations.slice(0, PROFILES_SHOWN).map((item) => rowOf(ctx, item));
    if (args.profile === undefined) {
      const data: ProfilesData = {
        project_id: projectId,
        count: all.configurations.length,
        shown: items.length,
        items,
        profile: null,
      };
      return { status: 'done', data };
    }
    const picked = pickNamed(ctx, 'profile', args.profile, all.configurations);
    const one = await getConfiguration(ctx, { ...path, config_id: picked.id });
    const detail: ProfileDetail = {
      ...rowOf(ctx, one),
      steps: one.injection_steps.slice(0, STEPS_SHOWN).map((step) => stepOf(ctx, step)),
      stepCount: one.injection_steps.length,
    };
    const data: ProfilesData = {
      project_id: projectId,
      count: 1,
      shown: 0,
      items: [],
      profile: detail,
    };
    return { status: 'done', data };
  },
  render: renderGetProfiles,
});
