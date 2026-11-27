// `run_save_profile` (module run): Save a stored load profile (users, ramp, duration, default flag;
// no id: create).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `profile` it creates one (a name and a type are needed); with it, it reads the
// profile first (the values before, which the undo restores), sends only the fields that differ, and
// says nothing was changed when none does (no write, no undo). The backend leaves a field that is
// not sent, or is sent as null, as it is, so the tool never sends null: a description that was empty
// is restored as an empty text, and a ramp that was not set cannot be restored, so that change is
// not offered for undo. Making a profile the default takes the flag from the one that had it, which
// an undo would not give back, so that change is not offered either. The undo of a creation is the
// deletion of the new profile (run_delete with kind=profile, level 3, on its own card).
// Log: args "{name}", result "profile {name} saved": the data carries `name`; the arguments of the
// undo are the id and the previous values of the changed fields (`update.log.undo_args`).

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderSaveProfile,
  type ProfileField,
  type SaveProfileData,
} from '../../render/run/saveProfile.js';
import {
  LIMITS,
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { pickNamed } from './common.js';
import { getConfiguration, listConfigurations } from './getProfiles.js';
import { RUN_SAVE_PROFILE } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/configurations (REST API v1) */
export function createConfiguration(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'create_configuration_api_v1_projects__project_id__gatling_configurations_post'>,
): Promise<
  OpOutput<'create_configuration_api_v1_projects__project_id__gatling_configurations_post'>
> {
  return callBackend(
    ctx,
    'create_configuration_api_v1_projects__project_id__gatling_configurations_post',
    { path, body },
  );
}

/** PUT /projects/{project_id}/gatling/configurations/{config_id} (REST API v1) */
export function updateConfiguration(
  ctx: CallContext,
  path: { readonly project_id: string; readonly config_id: string },
  body: BodyOf<'update_configuration_api_v1_projects__project_id__gatling_configurations__config_id__put'>,
): Promise<
  OpOutput<'update_configuration_api_v1_projects__project_id__gatling_configurations__config_id__put'>
> {
  return callBackend(
    ctx,
    'update_configuration_api_v1_projects__project_id__gatling_configurations__config_id__put',
    { path, body },
  );
}

type Args = {
  readonly name?: string | undefined;
  readonly type?: ProfileType | undefined;
  readonly users?: number | undefined;
  readonly duration_seconds?: number | undefined;
  readonly ramp_duration_seconds?: number | undefined;
  readonly description?: string | undefined;
  readonly is_default?: boolean | undefined;
};
type ProfileType = NonNullable<
  BodyOf<'create_configuration_api_v1_projects__project_id__gatling_configurations_post'>
>['injection_profile'];
type Path = { readonly project_id: string };

const FIELDS: readonly ProfileField[] = [
  'name',
  'type',
  'users',
  'duration_seconds',
  'ramp_duration_seconds',
  'description',
  'is_default',
];

/** The backend's names of the fields the arguments set. */
function bodyOf(args: Args): Record<string, unknown> {
  return {
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.type === undefined ? {} : { injection_profile: args.type }),
    ...(args.users === undefined ? {} : { users: args.users }),
    ...(args.duration_seconds === undefined ? {} : { duration_seconds: args.duration_seconds }),
    ...(args.ramp_duration_seconds === undefined
      ? {}
      : { ramp_duration_seconds: args.ramp_duration_seconds }),
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.is_default === undefined ? {} : { is_default: args.is_default }),
  };
}

async function create(
  ctx: CallContext,
  path: Path,
  args: Args,
): Promise<{
  status: 'done';
  data: SaveProfileData;
  update: { log: { undo_args: Record<string, unknown> } };
}> {
  if (args.name === undefined || args.type === undefined) {
    refuseRule('save_profile_create_needs_name_and_type');
  }
  const body = bodyOf(args);
  const created = await createConfiguration(ctx, path, {
    ...body,
    name: args.name,
    injection_profile: args.type,
  } as BodyOf<'create_configuration_api_v1_projects__project_id__gatling_configurations_post'>);
  const data: SaveProfileData = {
    project_id: path.project_id,
    id: created.id,
    name: thirdParty(ctx, args.name, LIMITS.name),
    created: true,
    changed: FIELDS.filter((field) => fieldSent(field, args)),
    type: args.type,
    // what the backend sets when the call leaves a field out
    users: args.users ?? DEFAULT_USERS,
    durationS: args.duration_seconds ?? DEFAULT_DURATION_S,
    rampS: args.ramp_duration_seconds ?? null,
    isDefault: args.is_default ?? false,
    previous: {},
    undoable: true,
    notUndoable: null,
  };
  // the catalog's way back of a creation: the deletion of the new profile, run_delete (kind=profile),
  // a tool of level 3 that asks on its own card before it deletes
  return {
    status: 'done',
    data,
    update: {
      log: { undo_args: { undo_tool: 'run_delete', kind: 'profile', item_id: created.id } },
    },
  };
}

const DEFAULT_USERS = 10;
const DEFAULT_DURATION_S = 60;

function fieldSent(field: ProfileField, args: Args): boolean {
  switch (field) {
    case 'name':
      return args.name !== undefined;
    case 'type':
      return args.type !== undefined;
    case 'users':
      return args.users !== undefined;
    case 'duration_seconds':
      return args.duration_seconds !== undefined;
    case 'ramp_duration_seconds':
      return args.ramp_duration_seconds !== undefined;
    case 'description':
      return args.description !== undefined;
    case 'is_default':
      return args.is_default !== undefined;
  }
}

async function change(
  ctx: CallContext,
  path: Path,
  profile: string,
  args: Args,
): Promise<{
  status: 'done';
  data: SaveProfileData;
  inert?: true;
  update?: { log: { undo_args: Record<string, unknown> } };
}> {
  if (!FIELDS.some((field) => fieldSent(field, args))) {
    refuseRule('save_profile_without_fields');
  }
  const all = await listConfigurations(ctx, path);
  const picked = pickNamed(ctx, 'profile', profile, all.configurations);
  const before = await getConfiguration(ctx, { ...path, config_id: picked.id });
  const was: Record<ProfileField, string | number | boolean | null> = {
    name: before.name,
    type: before.injection_profile,
    users: before.users,
    duration_seconds: before.duration_seconds,
    ramp_duration_seconds: before.ramp_duration_seconds,
    description: before.description ?? '',
    is_default: before.is_default,
  };
  const now: Partial<Record<ProfileField, string | number | boolean>> = {
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.type === undefined ? {} : { type: args.type }),
    ...(args.users === undefined ? {} : { users: args.users }),
    ...(args.duration_seconds === undefined ? {} : { duration_seconds: args.duration_seconds }),
    ...(args.ramp_duration_seconds === undefined
      ? {}
      : { ramp_duration_seconds: args.ramp_duration_seconds }),
    ...(args.description === undefined ? {} : { description: args.description }),
    ...(args.is_default === undefined ? {} : { is_default: args.is_default }),
  };
  const changed = FIELDS.filter((field) => now[field] !== undefined && now[field] !== was[field]);
  const shown = (after: Partial<Record<ProfileField, string | number | boolean>>) => ({
    type: String(after.type ?? was.type),
    users: Number(after.users ?? was.users),
    durationS: Number(after.duration_seconds ?? was.duration_seconds),
    rampS:
      after.ramp_duration_seconds === undefined
        ? before.ramp_duration_seconds
        : Number(after.ramp_duration_seconds),
    isDefault: Boolean(after.is_default ?? was.is_default),
  });
  if (changed.length === 0) {
    const data: SaveProfileData = {
      project_id: path.project_id,
      id: picked.id,
      name: thirdParty(ctx, before.name, LIMITS.name),
      created: false,
      changed,
      ...shown({}),
      previous: {},
      undoable: false,
      notUndoable: null,
    };
    return { status: 'done', data, inert: true };
  }
  const sent: Record<string, unknown> = {};
  const body = bodyOf(args);
  for (const field of changed) {
    const key = field === 'type' ? 'injection_profile' : field;
    sent[key] = body[key];
  }
  await updateConfiguration(ctx, { ...path, config_id: picked.id }, sent);
  const previous: Partial<Record<ProfileField, string | number | boolean | null>> = {};
  const undoValues: Record<string, unknown> = { profile: picked.id };
  for (const field of changed) {
    previous[field] =
      typeof was[field] === 'string' && (field === 'name' || field === 'description')
        ? thirdParty(ctx, String(was[field]), field === 'name' ? LIMITS.name : LIMITS.sentence)
        : was[field];
    undoValues[field] = was[field];
  }
  const secret = ['name', 'description'].some(
    (field) =>
      changed.includes(field as ProfileField) &&
      ctx.secrets.scrub(String(was[field as ProfileField])) !== String(was[field as ProfileField]),
  );
  const wasEmptyRamp =
    changed.includes('ramp_duration_seconds') && before.ramp_duration_seconds === null;
  const defaultMoved = changed.includes('is_default') && args.is_default === true;
  const notUndoable = secret
    ? 'secret'
    : wasEmptyRamp
      ? 'was_empty'
      : defaultMoved
        ? 'default_moved'
        : null;
  const data: SaveProfileData = {
    project_id: path.project_id,
    id: picked.id,
    name: thirdParty(ctx, args.name ?? before.name, LIMITS.name),
    created: false,
    changed,
    ...shown(now),
    previous,
    undoable: notUndoable === null,
    notUndoable,
  };
  return {
    status: 'done',
    data,
    ...(notUndoable === null ? { update: { log: { undo_args: undoValues } } } : {}),
  };
}

export const runSaveProfile = moduleTool(RUN_SAVE_PROFILE, {
  title: 'Save a stored load profile',
  input: {
    profile: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('The load profile to change (name or id); without it, a new one is created.'),
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('The profile name (needed to create; renames on change).'),
    type: z
      .enum([
        'at_once',
        'ramp',
        'constant',
        'stress',
        'spike',
        'soak',
        'ramp_concurrency',
        'constant_concurrency',
        'custom',
      ])
      .optional()
      .describe('The load shape (needed to create).'),
    users: z.number().int().min(1).max(1000000).optional().describe('Virtual users.'),
    duration_seconds: z
      .number()
      .int()
      .min(1)
      .max(86400)
      .optional()
      .describe('How long the load lasts.'),
    ramp_duration_seconds: z
      .number()
      .int()
      .min(0)
      .max(86400)
      .optional()
      .describe('How long the ramp lasts.'),
    description: z.string().min(1).max(500).optional().describe('A short description.'),
    is_default: z
      .boolean()
      .optional()
      .describe('true: make it the default profile of the project.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.profile === undefined) return create(ctx, path, args);
    return change(ctx, path, args.profile, args);
  },
  render: renderSaveProfile,
});
