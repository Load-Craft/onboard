// The profile of a project as the model reads and corrects it: `project_get` shows it, and
// `project_set_profile` changes chosen fields after the user agreed to a consent card. A card shows
// every field with its current and its new value; it freezes the fields, the values before and after
// and a digest of the stored profile (`consent/confirmCard.ts`) and prints a one-use token. The
// repeat of the call with that token writes what the card froze, and only while the stored profile
// is still the one the card showed and the call asks for the same fields; otherwise it gets a new
// card and nothing is written. A used card is gone, so an old token never writes again, also when an
// undo brought the profile back to what the card showed. The write reads the whole profile, changes the fields and sends it back whole, because the backend replaces the stored
// profile with the one it is sent. The warning `profile_fields_uncertain` (the analysis was unsure
// of some fields) is kept here: the analysis opens it; applying the setup takes out the fields its
// result listed for the user, setting a field takes that field out, and the last one closes it.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import { consumeCard, discardCard, issueCard, sameFrozen } from '../../consent/confirmCard.js';
import type { ToolContext } from '../../context.js';
import type { components } from '../../http/generated/api.js';
import { callOperation } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import type { ProcessUpdateInput } from '../../workspace/reducer.js';
import type { Process } from '../../workspace/processState.js';
import type {
  CardRenewal,
  FieldChange,
  SetProfileData,
} from '../../render/views/projectProfile.js';
import { content } from '../moduleCall.js';

export type { UncertainField } from '../../render/views/projectProfile.js';

/**
 * A proposal of the analysis below this confidence leaves its field uncertain: the user is asked
 * about it. Lower than the threshold of the fields to check (`HIGH_CONFIDENCE`), which also lists
 * every value a model wrote.
 */
export const PROFILE_CONFIDENCE_MIN = 0.7;

/** The warning of a profile whose analysis was unsure of some fields. */
export const UNCERTAIN_CODE = 'profile_fields_uncertain';

/** The group of consent a card of this tool belongs to. */
export const PROFILE_SCOPE = 'project:profile';

/** Most field names one warning keeps (the state schema's limit). */
const FIELD_PATHS_MAX = 40;

// ---- the warning ----------------------------------------------------------------------------

function warningMessage(fields: readonly string[]): string {
  return `The analysis was unsure of profile fields ${fields.join(', ')}: check them with the user and correct them with project_set_profile.`.slice(
    0,
    300,
  );
}

/**
 * The problems part of an update that replaces the warning: closed, and opened again for `fields`
 * when there are any.
 */
export function uncertainProblems(
  fields: readonly string[],
  tool: string,
): NonNullable<ProcessUpdateInput['problems']> {
  const kept = [...new Set(fields)].slice(0, FIELD_PATHS_MAX);
  return {
    close: [{ code: UNCERTAIN_CODE }],
    open:
      kept.length === 0
        ? []
        : [
            {
              module: 'project',
              tool,
              code: UNCERTAIN_CODE,
              severity: 'warning',
              message: warningMessage(kept),
              field_paths: kept,
            },
          ],
  };
}

/** The fields the open warning names; empty when there is none. */
export function openUncertain(process: Process | undefined): string[] {
  const found = process?.problems.find((problem) => problem.code === UNCERTAIN_CODE);
  return [...(found?.field_paths ?? [])];
}

// ---- the profile as the contract has it -----------------------------------------------------

type Schemas = components['schemas'];
/** The profile as the backend sends and takes it; a field left out takes its default there. */
export type StoredProfile = Schemas['ProjectProfile'];

/**
 * Every value of an enum of the contract, no more and no less: a list that misses one, or names one
 * the contract does not have, does not compile.
 */
function contractEnum<T extends string>() {
  return <const L extends readonly [T, ...T[]]>(
    values: L &
      ([Exclude<T, L[number]>] extends [never] ? unknown : { missing: Exclude<T, L[number]> }),
  ) => z.enum(values);
}

const endpoint = z.string().trim().min(1).max(500).nullable();
const domains = z.array(z.string().trim().min(1).max(253)).max(50);

/**
 * The fields `project_set_profile` takes. The values of an enum are the contract's (`contractEnum`),
 * so a value the backend does not know is refused before anything is sent.
 */
export const SETTABLE = {
  app_architecture: contractEnum<Schemas['AppArchitecture']>()([
    'spa',
    'mpa',
    'ssr',
    'mobile',
    'mixed',
    'unknown',
  ]),
  api_protocol: contractEnum<Schemas['APIProtocol']>()([
    'rest',
    'graphql',
    'grpc_web',
    'soap',
    'mixed',
  ]),
  auth_method: contractEnum<Schemas['AuthMethod']>()([
    'bearer_jwt',
    'session_cookie',
    'oauth2_code',
    'oauth2_pkce',
    'api_key',
    'basic',
    'saml',
    'none',
  ]),
  auth_token_endpoint: endpoint,
  graphql_endpoint: endpoint,
  has_async_operations: z.boolean(),
  has_file_uploads: z.boolean(),
  has_mfa: z.boolean(),
  has_multi_tenant: z.boolean(),
  has_pagination: z.boolean(),
  has_presigned_urls: z.boolean(),
  has_sse: z.boolean(),
  has_websockets: z.boolean(),
  uses_csrf: z.boolean(),
  self_check_enabled: z.boolean(),
  idp_domains: domains,
  known_third_party_domains: domains,
  additional_notes: z.string().max(2000).nullable(),
} as const;

export type SettableField = keyof typeof SETTABLE;
export type SettableValues = {
  readonly [K in SettableField]?: z.infer<(typeof SETTABLE)[K]> | undefined;
};

const settable = (field: string): field is SettableField => Object.hasOwn(SETTABLE, field);

/**
 * The value the backend gives a field it does not store (the `default` of each field of the
 * contract's ProjectProfile; a test compares the two). Only for showing a profile: what is sent is
 * the stored profile with the fields changed, and the backend fills the rest itself.
 */
export const PROFILE_DEFAULTS = {
  app_architecture: 'spa',
  api_protocol: 'rest',
  auth_method: 'bearer_jwt',
  auth_token_endpoint: null,
  graphql_endpoint: null,
  has_async_operations: false,
  has_file_uploads: false,
  has_mfa: false,
  has_multi_tenant: false,
  has_pagination: false,
  has_presigned_urls: false,
  has_sse: false,
  has_websockets: false,
  uses_csrf: false,
  self_check_enabled: true,
  idp_domains: [],
  known_third_party_domains: [],
  additional_notes: null,
} as const satisfies { readonly [K in SettableField]: z.infer<(typeof SETTABLE)[K]> };

/** Every field `project_set_profile` takes, as the profile has it (its default when not stored). */
export type ShownProfile = { readonly [K in SettableField]: z.infer<(typeof SETTABLE)[K]> };

/** The stored profile with the defaults of the fields it does not store. */
export function shownProfile(stored: StoredProfile | null | undefined): ShownProfile {
  const shown: Record<string, unknown> = { ...PROFILE_DEFAULTS };
  for (const field of Object.keys(PROFILE_DEFAULTS)) {
    const value = stored?.[field as SettableField];
    if (value !== undefined) shown[field] = value;
  }
  return shown as ShownProfile;
}

/** `GET /api/v1/projects/{project_id}`: the name and the profile as stored (null: none yet). */
export async function readProfile(
  ctx: ToolContext,
  projectId: string,
): Promise<{ readonly name: string; readonly stored: StoredProfile | null }> {
  const project = await callOperation(
    ctx.services.http,
    'get_project_api_v1_projects__project_id__get',
    { path: { project_id: projectId } },
    { signal: ctx.signal, secrets: ctx.secrets },
  );
  // the name is shown masked, its secrets registered (FIX-76)
  return { name: content(ctx, project.name, 120), stored: project.project_profile ?? null };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every field asked for, in the order of the call, with its current value. */
function changesOf(profile: ShownProfile, fields: SettableValues): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, value] of Object.entries(fields) as [string, unknown][]) {
    if (settable(field) && value !== undefined) {
      changes.push({ field, current: profile[field], value });
    }
  }
  return changes;
}

/** Keys in order, so equal records give equal text. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** A digest of the stored profile: a card is good only while the profile is the one it showed. */
function profileHash(profile: StoredProfile | null): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(profile)))
    .digest('hex')
    .slice(0, 16);
}

/** What a card of this tool freezes: the call's fields, the change it showed, the profile it read. */
const frozenSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  changes: z.array(z.object({ field: z.string(), current: z.unknown(), value: z.unknown() })),
  profile: z.string(),
});

// ---- the call -------------------------------------------------------------------------------

export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
}

/** What a call that sets `named` fields does to the warning; undefined when none is open. */
function warningUpdate(
  process: Process | undefined,
  named: readonly string[],
): { readonly problems?: NonNullable<ProcessUpdateInput['problems']>; readonly left: string[] } {
  const open = openUncertain(process);
  const left = open.filter((field) => !named.includes(field));
  if (open.length === 0 || left.length === open.length) return { left };
  return { problems: uncertainProblems(left, 'project_set_profile'), left };
}

/**
 * `project_set_profile`: without `confirm`, the card (nothing is written); with the token of the
 * card, the write. Fields that already have the value are confirmed without a write.
 */
export async function setProfile(
  ctx: ToolContext,
  project: ProjectInfo,
  fields: SettableValues,
  confirm: string | undefined,
): Promise<DoneOutcome<SetProfileData>> {
  const { stored } = await readProfile(ctx, project.id);
  const asked = changesOf(shownProfile(stored), fields);
  const changes = asked.filter((item) => !same(item.current, item.value));
  const unchanged = asked.filter((item) => same(item.current, item.value)).map((i) => i.field);
  const named = asked.map((item) => item.field);
  const warning = warningUpdate(ctx.state.process(), named);
  const hash = profileHash(stored);

  // A confirm writes what its card froze and uses the card up. No card, an expired or replaced one,
  // other fields than the card's or a profile changed since: a new card, nothing written.
  let renewed: CardRenewal | undefined;
  let expiredIssuedAt: number | undefined;
  if (confirm !== undefined) {
    const redeemed = await consumeCard(ctx, PROFILE_SCOPE, project.id, confirm.trim());
    const frozen = redeemed.ok ? frozenSchema.safeParse(redeemed.frozen) : undefined;
    if (frozen?.success === true) {
      if (sameFrozen(frozen.data.fields, fields) && frozen.data.profile === hash) {
        return write(ctx, project, stored, frozen.data.changes, unchanged, warning);
      }
      renewed = 'changed';
    } else {
      renewed = redeemed.ok ? 'missing' : redeemed.reason;
      if (!redeemed.ok && redeemed.reason === 'expired') expiredIssuedAt = redeemed.issuedAt;
    }
  }

  if (changes.length === 0) {
    // the user confirmed the values the profile has: nothing to write, the warning still shrinks
    await discardCard(ctx, PROFILE_SCOPE, project.id);
    return {
      status: 'done',
      inert: true,
      data: { project, n: 0, fields: [], changes, unchanged, stillUncertain: warning.left },
      ...(warning.problems === undefined ? {} : { update: { problems: warning.problems } }),
    };
  }
  const token = await issueCard(ctx, PROFILE_SCOPE, project.id, {
    fields,
    changes,
    profile: hash,
  });
  return {
    status: 'done',
    inert: true,
    data: {
      needsConfirmation: true,
      project,
      scope: PROFILE_SCOPE,
      changes,
      unchanged,
      stillUncertain: warning.left,
      confirm: token,
      ...(renewed === undefined ? {} : { renewed }),
      ...(expiredIssuedAt === undefined
        ? {}
        : { expiredIssuedAt: new Date(expiredIssuedAt).toISOString() }),
    },
  };
}

/** The write of a card: the whole stored profile goes back with the frozen fields changed. */
async function write(
  ctx: ToolContext,
  project: ProjectInfo,
  stored: StoredProfile | null,
  changes: readonly FieldChange[],
  unchanged: readonly string[],
  warning: ReturnType<typeof warningUpdate>,
): Promise<DoneOutcome<SetProfileData>> {
  // the backend replaces the stored profile with this (each value passed its schema in SETTABLE
  // when the card was made, so it has the type of its field)
  const changed = Object.fromEntries(
    changes.map((item) => [item.field, item.value]),
  ) as Partial<ShownProfile>;
  const next: StoredProfile = { ...stored, ...shownProfile(stored), ...changed };
  await callOperation(
    ctx.services.http,
    'update_project_api_v1_projects__project_id__put',
    { path: { project_id: project.id }, body: { project_profile: next } },
    { signal: ctx.signal, secrets: ctx.secrets },
  );
  const previous = Object.fromEntries(changes.map((item) => [item.field, item.current]));
  return {
    status: 'done',
    data: {
      project,
      n: changes.length,
      fields: changes.map((item) => item.field),
      changes,
      unchanged,
      stillUncertain: warning.left,
    },
    links: [ctx.services.links.projectProfile(project.id)],
    update: {
      ...(warning.problems === undefined ? {} : { problems: warning.problems }),
      log: { undo_args: { fields: previous } },
    },
  };
}
