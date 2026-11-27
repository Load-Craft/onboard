// `scenario_save_composition` (module scenario): Save a composition (members, weights, load
// profile; no id: create), validating it. Direct edit, only on request; see scenario_suggest_split.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Save composition {name}", result "composition {name} saved; valid: {valid}": the data
// of the result carries the fields.
// Consent: level 2 on a card (docs/consent-card.md). The first call reads the composition and the
// scenarios and makes the card (the name, each member's share before and after, the load profile);
// a repeat with the same arguments asks the person; only their yes writes. The members are a map
// scenario -> share in percent that REPLACES the member list: a member that stays keeps what the
// composition holds of it (its variant, enabled flag, think time, datasets and overrides), a new one
// gets the defaults, one left out is removed. The save is then validated by the backend, and that
// verdict is the answer and the state's `composition_valid`.
// Undo (`update.log.undo_args`): this tool with the previous name, members and profile of the parts
// that changed (a removed member comes back with defaults); a new composition's is `scenario_delete`
// (level 3, named only in the log). A previous value the secret mask would change is not kept.
// Arguments (the catalog's): composition_id, name, members, profile.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSaveComposition,
  renderSaveComposition,
  type MemberFact,
  type SaveCompositionData,
  type SaveCompositionFacts,
  type SavedPart,
} from '../../render/scenario/saveComposition.js';
import { createResolver } from '../../resolve/handles.js';
import {
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getComposition } from './getComposition.js';
import { SCENARIO_SAVE_COMPOSITION } from './meta.generated.js';
import { slotCollisions } from './slotCollisions.js';

/** POST /projects/{project_id}/gatling/compositions (REST API v1) */
export function createComposition(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'create_composition_api_v1_projects__project_id__gatling_compositions_post'>,
): Promise<OpOutput<'create_composition_api_v1_projects__project_id__gatling_compositions_post'>> {
  return callBackend(
    ctx,
    'create_composition_api_v1_projects__project_id__gatling_compositions_post',
    { path, body },
  );
}

/** PUT /projects/{project_id}/gatling/compositions/{composition_id} (REST API v1) */
export function updateComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
  body: BodyOf<'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put'>,
): Promise<
  OpOutput<'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put'>
> {
  return callBackend(
    ctx,
    'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put',
    { path, body },
  );
}

/** POST /projects/{project_id}/gatling/compositions/{composition_id}/validate (REST API v1) */
export function validateComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post'>
> {
  return callBackend(
    ctx,
    'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post',
    { path },
  );
}

type Composition =
  OpOutput<'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get'>;
type Member = Composition['scenarios'][number];
type Link = NonNullable<
  BodyOf<'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put'>['scenarios']
>[number];

const NAME_LIMIT = 120;
const SHOWN = 20;
const MESSAGES_SHOWN = 5;
const TEXT_LIMIT = 200;
const PROFILE_LIMIT = 200;

/** A share as the backend holds it (a fraction) in percent, to two decimals. */
const percentOf = (proportion: number): number => Math.round(proportion * 10000) / 100;

/** The JSON of a value with its keys in order: equal values give equal texts. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, one]) => `${JSON.stringify(key)}:${canonical(one)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const isEmpty = (profile: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(profile).length === 0;

const profileText = (
  ctx: CallContext,
  profile: Readonly<Record<string, unknown>>,
): string | null =>
  isEmpty(profile) ? null : thirdParty(ctx, JSON.stringify(profile), PROFILE_LIMIT);

interface Wanted {
  /** The scenario, resolved, and the share asked for in percent. */
  readonly id: string;
  readonly name: string;
  readonly percent: number;
}

/** The members a composition holds now, as the collisions read them (id and name). */
function membersOfSaved(composition: Composition): { id: string; name: string }[] {
  return composition.scenarios.map((member) => ({
    id: member.scenario_id,
    name: member.scenario_name ?? member.scenario_id,
  }));
}

/** The scenarios of `members`, by id or name, each once. */
async function wantedOf(
  ctx: Parameters<typeof createResolver>[0],
  projectId: string,
  members: Readonly<Record<string, number>>,
): Promise<Wanted[]> {
  const resolver = createResolver(ctx);
  const found: Wanted[] = [];
  for (const [ref, share] of Object.entries(members)) {
    const scenario = await resolver.scenario(projectId, ref);
    if (found.some((one) => one.id === scenario.id))
      refuseRule('composition_save_duplicate_member');
    found.push({ id: scenario.id, name: scenario.name, percent: share });
  }
  return found;
}

/** What a call changes of a composition (the composition as it is, then what is asked). */
interface Plan {
  readonly renamed: boolean;
  readonly members: Wanted[] | undefined;
  readonly membersChanged: boolean;
  readonly profileChanged: boolean;
}

function planOf(
  before: Composition,
  args: {
    readonly name?: string | undefined;
    readonly profile?: Readonly<Record<string, unknown>> | undefined;
  },
  wanted: Wanted[] | undefined,
): Plan {
  const have = new Map<string, number>();
  for (const member of before.scenarios) have.set(member.scenario_id, percentOf(member.proportion));
  const membersChanged =
    wanted !== undefined &&
    (wanted.length !== have.size ||
      wanted.some((one) => have.get(one.id) === undefined || have.get(one.id) !== one.percent));
  return {
    renamed: args.name !== undefined && args.name !== before.name,
    members: wanted,
    membersChanged,
    profileChanged:
      args.profile !== undefined && canonical(args.profile) !== canonical(before.injection_config),
  };
}

function membersFacts(
  ctx: CallContext,
  before: Composition | null,
  wanted: Wanted[],
): MemberFact[] {
  const rows: MemberFact[] = wanted.map((one) => ({
    scenario_id: one.id,
    name: thirdParty(ctx, one.name, NAME_LIMIT),
    was: percentOf(
      before?.scenarios.find((member) => member.scenario_id === one.id)?.proportion ?? NaN,
    ),
    now: one.percent,
  }));
  const normalised = rows.map((row) => ({ ...row, was: Number.isNaN(row.was) ? null : row.was }));
  const removed = (before?.scenarios ?? [])
    .filter((member) => !wanted.some((one) => one.id === member.scenario_id))
    .map((member) => ({
      scenario_id: member.scenario_id,
      name: thirdParty(ctx, member.scenario_name ?? member.scenario_id, NAME_LIMIT),
      was: percentOf(member.proportion),
      now: null,
    }));
  return [...normalised, ...removed];
}

/** The link a PUT sends for a member that stays: what the composition holds of it, with the new share. */
function linkOf(member: Member, share: number): Link {
  return {
    scenario_id: member.scenario_id,
    proportion: share / 100,
    variant_label: member.variant_label,
    enabled: member.enabled,
    feeder_bindings: member.feeder_bindings,
    injection_override: member.injection_override,
    load_profile: member.load_profile,
    think_time_ms: member.think_time_ms,
  };
}

function linksOf(before: Composition | null, wanted: readonly Wanted[]): Link[] {
  return wanted.map((one) => {
    const kept = before?.scenarios.find((member) => member.scenario_id === one.id);
    return kept === undefined
      ? { scenario_id: one.id, proportion: one.percent / 100, enabled: true, variant_label: '' }
      : linkOf(kept, one.percent);
  });
}

/** One composition in the project, by id or name. */
async function readComposition(
  ctx: Parameters<typeof createResolver>[0],
  projectId: string,
  ref: string,
): Promise<Composition> {
  const found = await createResolver(ctx).composition(projectId, ref);
  return getComposition(ctx, { project_id: projectId, composition_id: found.id });
}

/** A member ref of the arguments as the schema takes it: a name or an id, a share of 0 to 100. */
const MEMBERS = z.record(z.string().min(1).max(200), z.number().min(0).max(100));

export const scenarioSaveComposition = moduleTool(SCENARIO_SAVE_COMPOSITION, {
  title: 'Save a composition',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition to change (id or name); without it, a new one is created.'),
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The name; required for a new composition.'),
    members: MEMBERS.optional().describe(
      'Scenario (id or name) -> its share in percent (0-100); replaces the member list, a member that stays keeps its settings. Required for a new composition.',
    ),
    profile: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "The composition's load profile (users, ramp, duration), as scenario_get_composition shows it.",
      ),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    if (args.composition_id === undefined) {
      if (args.name === undefined)
        throw new ToolError('missing_argument', { params: { name: 'name' } });
      if (args.members === undefined || Object.keys(args.members).length === 0) {
        refuseRule('composition_save_create_needs_members');
      }
      const wanted = await wantedOf(ctx, projectId, args.members);
      const facts: SaveCompositionFacts = {
        composition_id: null,
        name: thirdParty(ctx, args.name, NAME_LIMIT),
        name_was: null,
        create: true,
        members: membersFacts(ctx, null, wanted).slice(0, SHOWN),
        member_count: wanted.length,
        profile:
          args.profile === undefined || isEmpty(args.profile)
            ? null
            : { was: null, now: profileText(ctx, args.profile) },
        slot_collisions: await slotCollisions(ctx, projectId, wanted),
      };
      return { facts };
    }
    if (args.name === undefined && args.members === undefined && args.profile === undefined) {
      refuseRule('composition_save_at_least_one');
    }
    const before = await readComposition(ctx, projectId, args.composition_id);
    const wanted =
      args.members === undefined ? undefined : await wantedOf(ctx, projectId, args.members);
    if (
      wanted !== undefined &&
      before.scenarios.length !== new Set(before.scenarios.map((m) => m.scenario_id)).size
    ) {
      refuseRule('composition_save_variants');
    }
    const plan = planOf(before, args, wanted);
    const name = thirdParty(
      ctx,
      plan.renamed && args.name !== undefined ? args.name : before.name,
      NAME_LIMIT,
    );
    if (!plan.renamed && !plan.membersChanged && !plan.profileChanged) {
      return { unchanged: unchangedData(ctx, before) };
    }
    const rows =
      plan.members === undefined || !plan.membersChanged
        ? []
        : membersFacts(ctx, before, plan.members);
    const facts: SaveCompositionFacts = {
      composition_id: before.id,
      name,
      name_was: plan.renamed ? thirdParty(ctx, before.name, NAME_LIMIT) : null,
      create: false,
      members: rows.slice(0, SHOWN),
      member_count: rows.length,
      profile: plan.profileChanged
        ? {
            was: profileText(ctx, before.injection_config),
            now: profileText(ctx, args.profile ?? {}),
          }
        : null,
      slot_collisions: await slotCollisions(
        ctx,
        projectId,
        plan.membersChanged && plan.members !== undefined ? plan.members : membersOfSaved(before),
      ),
    };
    return { facts };
  },
  cardView: cardViewSaveComposition,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    if (facts.create) return runCreate(ctx, projectId, args);
    const before = await readComposition(ctx, projectId, args.composition_id ?? '');
    const wanted =
      args.members === undefined ? undefined : await wantedOf(ctx, projectId, args.members);
    const plan = planOf(before, args, wanted);
    const body: BodyOf<'update_composition_api_v1_projects__project_id__gatling_compositions__composition_id__put'> =
      {
        ...(plan.renamed ? { name: args.name ?? before.name } : {}),
        ...(plan.membersChanged && wanted !== undefined
          ? { scenarios: linksOf(before, wanted) }
          : {}),
        ...(plan.profileChanged ? { injection_config: { ...args.profile } } : {}),
      };
    await updateComposition(ctx, { project_id: projectId, composition_id: before.id }, body);
    const changed: SavedPart[] = [
      ...(plan.renamed ? (['name'] as const) : []),
      ...(plan.membersChanged ? (['members'] as const) : []),
      ...(plan.profileChanged ? (['profile'] as const) : []),
    ];
    const undoArgs: Record<string, unknown> = {
      composition_id: before.id,
      ...(plan.renamed ? { name: before.name } : {}),
      ...(plan.membersChanged
        ? {
            members: Object.fromEntries(
              before.scenarios.map((member) => [member.scenario_id, percentOf(member.proportion)]),
            ),
          }
        : {}),
      ...(plan.profileChanged ? { profile: before.injection_config } : {}),
    };
    // a previous value the secret mask would change is not kept: it would reach the state file
    const clean = !ctx.secrets.containsSecret(undoArgs);
    const verdict = await verdictOf(ctx, projectId, before.id);
    const data = dataOf(ctx, {
      id: before.id,
      name: args.name ?? before.name,
      created: false,
      changed,
      members:
        plan.membersChanged && wanted !== undefined ? wanted.length : before.scenarios.length,
      verdict,
      collisions: await slotCollisions(
        ctx,
        projectId,
        plan.membersChanged && wanted !== undefined ? wanted : membersOfSaved(before),
      ),
      undo: clean ? 'previous' : 'withheld',
    });
    return outcome(data, before.id, verdict, clean ? undoArgs : undefined);
  },
  render: renderSaveComposition,
});

type Verdict =
  OpOutput<'validate_composition_api_v1_projects__project_id__gatling_compositions__composition_id__validate_post'> | null;

/** The backend's verdict on the saved composition; null when it cannot be asked (a retired mode, a 5xx). */
async function verdictOf(ctx: CallContext, projectId: string, id: string): Promise<Verdict> {
  try {
    return await validateComposition(ctx, { project_id: projectId, composition_id: id });
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status !== 401) return null;
    throw error;
  }
}

function dataOf(
  ctx: CallContext,
  parts: {
    readonly id: string;
    readonly name: string;
    readonly created: boolean;
    readonly changed: readonly SavedPart[];
    readonly members: number;
    readonly verdict: Verdict;
    readonly collisions: SaveCompositionData['slot_collisions'];
    readonly undo: SaveCompositionData['undo'];
  },
): SaveCompositionData {
  const { verdict } = parts;
  return {
    composition_id: parts.id,
    name: thirdParty(ctx, parts.name, NAME_LIMIT),
    created: parts.created,
    changed: parts.changed,
    members: parts.members,
    total_percent: verdict === null ? null : percentOf(verdict.total_proportion),
    valid: verdict === null ? 'unknown' : verdict.is_valid,
    authoring_valid: verdict === null ? null : verdict.authoring_valid,
    errors: (verdict?.errors ?? [])
      .slice(0, MESSAGES_SHOWN)
      .map((text) => thirdParty(ctx, text, TEXT_LIMIT)),
    warnings: (verdict?.warnings ?? [])
      .slice(0, MESSAGES_SHOWN)
      .map((text) => thirdParty(ctx, text, TEXT_LIMIT)),
    slot_collisions: parts.collisions,
    undo: parts.undo,
  };
}

function outcome(
  data: SaveCompositionData,
  id: string,
  verdict: Verdict,
  undoArgs: Record<string, unknown> | undefined,
) {
  return {
    status: 'done' as const,
    data,
    update: {
      ids: { composition_id: id },
      ...(verdict === null
        ? {}
        : { checks: { scenario: { composition_valid: { ok: verdict.is_valid } } } }),
      log: {
        values: { name: data.name, valid: String(data.valid) },
        ...(undoArgs === undefined ? {} : { undo_args: undoArgs }),
      },
    },
  };
}

/** The data of a call that changes nothing: the composition as it is. */
function unchangedData(ctx: CallContext, before: Composition): SaveCompositionData {
  return dataOf(ctx, {
    id: before.id,
    name: before.name,
    created: false,
    changed: [],
    members: before.scenarios.length,
    verdict: null,
    collisions: [],
    undo: 'none',
  });
}

async function runCreate(
  ctx: Parameters<typeof createResolver>[0] & CallContext,
  projectId: string,
  args: {
    readonly name?: string | undefined;
    readonly members?: Readonly<Record<string, number>> | undefined;
    readonly profile?: Readonly<Record<string, unknown>> | undefined;
  },
) {
  if (args.name === undefined || args.members === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'name' } });
  }
  const wanted = await wantedOf(ctx, projectId, args.members);
  const created = await createComposition(
    ctx,
    { project_id: projectId },
    {
      name: args.name,
      composition_mode: 'parallel',
      normal_pause_std_dev_percent: 20,
      pause_distribution: 'uniform',
      scenarios: linksOf(null, wanted),
      ...(args.profile === undefined ? {} : { injection_config: { ...args.profile } }),
    },
  );
  const verdict = await verdictOf(ctx, projectId, created.id);
  const data = dataOf(ctx, {
    id: created.id,
    name: created.name,
    created: true,
    changed: [],
    members: wanted.length,
    verdict,
    collisions: await slotCollisions(ctx, projectId, wanted),
    undo: 'delete',
  });
  return outcome(data, created.id, verdict, {
    undo_tool: 'scenario_delete',
    composition_id: created.id,
  });
}
