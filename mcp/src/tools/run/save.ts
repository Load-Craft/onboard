// `run_save` (module run): Save a run definition for reuse (target, load, environment, data
// bindings; id: update).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "{name}", result "saved run {name}": the data of the result carries the fields.
// Consent: level 1, and level 3 (`scheduled_run`) for the calls that change the load, the environment or
// the target address of a saved run that has a schedule that is on and not paused: its next start would
// use the change without another question (docs/consent-card.md, a level-1 tool that asks for some
// calls). A new saved run is unscheduled, and a change of the name or of the data bindings leaves the
// schedule as it is: they run at once. The escalation is decided from the saved run `card` reads, never
// from an argument; `run` reads it again and refuses (`run_save_schedule_started`) when a schedule
// started meanwhile. The card shows the cron expression, what the load, the environment and the address
// were and become, and the next start (shown, not bound).
// Create: exactly one of scenario_id and composition_id, a name. Update (saved_run_id): the target and
// the source run never change; name, environment_id, target_base_url, workload and feeder_bindings are
// replaced as given (the environment and the address can be changed, never cleared). The environment is
// never taken from the state: it is chosen, not guessed.
// Undo: a new saved run is removed (`run_delete`, kind saved_run); a change is this tool with the
// previous values. Not kept (`withheld`): an environment or an address that had no value (the backend
// cannot clear them), a load that was not stored or is a production plan (the spec it was fitted from is
// gone), a previous value that would carry a secret.
// Log: args "{name}", result "saved run {name}": the data carries `name`.

import * as z from 'zod';

import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSave,
  renderSave,
  type FromTo,
  type LoadFacts,
  type SaveData,
  type SaveFacts,
  type SavedPart,
} from '../../render/run/save.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { workloadOf } from './common.js';
import { getSavedRun } from './getSaved.js';
import { RUN_SAVE } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/saved-runs (REST API v1) */
export function createSavedRun(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'create_saved_run_api_v1_projects__project_id__gatling_saved_runs_post'>,
): Promise<OpOutput<'create_saved_run_api_v1_projects__project_id__gatling_saved_runs_post'>> {
  return callBackend(ctx, 'create_saved_run_api_v1_projects__project_id__gatling_saved_runs_post', {
    path,
    body,
  });
}

/** PUT /projects/{project_id}/gatling/saved-runs/{saved_run_id} (REST API v1) */
export function updateSavedRun(
  ctx: CallContext,
  path: { readonly project_id: string; readonly saved_run_id: string },
  body: BodyOf<'update_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__put'>,
): Promise<
  OpOutput<'update_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__put'>
> {
  return callBackend(
    ctx,
    'update_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__put',
    { path, body },
  );
}

type Saved =
  OpOutput<'get_saved_run_api_v1_projects__project_id__gatling_saved_runs__saved_run_id__get'>;
type Workload = NonNullable<
  BodyOf<'create_saved_run_api_v1_projects__project_id__gatling_saved_runs_post'>['workload']
>;

const workloadInput = z.strictObject({
  type: z.string().min(1).max(20),
  vusers: z.number().int().min(1),
  ramp: z.number().int().min(0).max(86_400).default(0),
  hold: z.number().int().min(0).max(86_400).default(0),
  thresholds: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  production: z.record(z.string(), z.unknown()).optional(),
});
type WorkloadArgs = z.infer<typeof workloadInput>;

const NAME_LIMIT = 120;

/** The load as the backend stores it, without what the server writes (the digests). */
function storedLoad(saved: Saved): Record<string, unknown> | null {
  const stored = saved.workload;
  if (stored === null || stored === undefined) return null;
  return Object.fromEntries(
    Object.entries(stored).filter(([key]) => key !== 'steps_digest' && key !== 'think_time_digest'),
  );
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

/** Whether the given load replaces the stored one with something else. */
function loadChanges(saved: Saved, given: WorkloadArgs): boolean {
  const stored = storedLoad(saved);
  const now = {
    type: given.type,
    vusers: given.vusers,
    ramp: given.ramp,
    hold: given.hold,
    thresholds: given.thresholds ?? [],
    production: given.production ?? null,
  };
  const before = {
    type: stored?.['type'] ?? null,
    vusers: stored?.['vusers'] ?? null,
    ramp: stored?.['ramp'] ?? 0,
    hold: stored?.['hold'] ?? 0,
    thresholds: stored?.['thresholds'] ?? [],
    production: stored?.['production'] ?? null,
  };
  return canonical(now) !== canonical(before);
}

function checkWorkload(workload: WorkloadArgs | undefined): void {
  if (workload === undefined) return;
  const production = workload.type === 'production';
  if (production !== (workload.production !== undefined)) refuseRule('run_save_production_only');
  if (production && (workload.ramp !== 0 || workload.hold !== 0)) {
    refuseRule('run_save_production_only');
  }
}

/** What a call changes of a stored saved run, each part only when the given value differs. */
interface Changes {
  readonly name: boolean;
  readonly workload: boolean;
  readonly environment: boolean;
  readonly target: boolean;
  readonly feeder: boolean;
}

function changesOf(
  saved: Saved,
  args: {
    readonly name?: string | undefined;
    readonly environment_id?: string | undefined;
    readonly target_base_url?: string | undefined;
    readonly workload?: WorkloadArgs | undefined;
    readonly feeder_bindings?: Readonly<Record<string, string>> | undefined;
  },
): Changes {
  return {
    name: args.name !== undefined && args.name !== saved.name,
    workload: args.workload !== undefined && loadChanges(saved, args.workload),
    environment:
      args.environment_id !== undefined &&
      args.environment_id.toLowerCase() !== (saved.environment_id ?? '').toLowerCase(),
    target:
      args.target_base_url !== undefined &&
      args.target_base_url.trim() !== (saved.target_base_url ?? ''),
    feeder:
      args.feeder_bindings !== undefined &&
      canonical(args.feeder_bindings) !== canonical(saved.feeder_bindings),
  };
}

/** The schedule is on and not paused: its next start uses what is stored. */
const scheduled = (saved: Saved): boolean => saved.schedule_enabled && !saved.paused;
/** What the escalation is about: the load, the environment and the address. */
const touchesTheStart = (changes: Changes): boolean =>
  changes.workload || changes.environment || changes.target;

const partsOf = (changes: Changes): SavedPart[] => [
  ...(changes.name ? (['name'] as const) : []),
  ...(changes.workload ? (['workload'] as const) : []),
  ...(changes.environment ? (['environment'] as const) : []),
  ...(changes.target ? (['target'] as const) : []),
  ...(changes.feeder ? (['feeder_bindings'] as const) : []),
];

function loadFacts(
  ctx: CallContext,
  workload: Readonly<Record<string, unknown>> | null,
): LoadFacts | null {
  return workloadOf(ctx, workload);
}

const unchangedData = (ctx: CallContext, saved: Saved): SaveData => ({
  saved_run_id: saved.id,
  name: thirdParty(ctx, saved.name, NAME_LIMIT),
  created: false,
  changed: [],
  undo: 'none',
});

export const runSave = moduleTool(RUN_SAVE, {
  title: 'Save a run definition for reuse',
  input: {
    saved_run_id: uuidArgument()
      .optional()
      .describe('The saved run to change; without it, a new one is created.'),
    name: z.string().min(1).max(120).optional().describe('The name; required for a new saved run.'),
    scenario_id: uuidArgument()
      .optional()
      .describe('The scenario a new saved run starts (give this or composition_id; new only).'),
    composition_id: uuidArgument()
      .optional()
      .describe('The composition a new saved run starts (give this or scenario_id; new only).'),
    environment_id: uuidArgument()
      .optional()
      .describe('The environment; set or change, never clear.'),
    target_base_url: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe('The target address; set or change, never clear.'),
    workload: workloadInput
      .optional()
      .describe('The load {type, vusers, ramp, hold, thresholds}; replaced as a whole.'),
    feeder_bindings: z
      .record(z.string().min(1).max(100), uuidArgument())
      .optional()
      .describe('Slot -> dataset id; replaced as a whole.'),
    source_execution_id: uuidArgument()
      .optional()
      .describe('The run this saved run is made from (new only).'),
  },
  async card(ctx, args) {
    checkWorkload(args.workload);
    if (args.saved_run_id === undefined) {
      if (args.name === undefined) refuseRule('run_save_name_required');
      if ((args.scenario_id === undefined) === (args.composition_id === undefined)) {
        refuseRule('run_save_target_one_of');
      }
      // a new saved run is unscheduled: nothing it sets starts anything by itself
      return { proceed: true };
    }
    if (
      args.scenario_id !== undefined ||
      args.composition_id !== undefined ||
      args.source_execution_id !== undefined
    ) {
      refuseRule('run_save_target_fixed');
    }
    if (
      args.name === undefined &&
      args.environment_id === undefined &&
      args.target_base_url === undefined &&
      args.workload === undefined &&
      args.feeder_bindings === undefined
    ) {
      refuseRule('run_save_at_least_one');
    }
    const projectId = projectIdOf(ctx, undefined);
    const saved = await getSavedRun(ctx, {
      project_id: projectId,
      saved_run_id: args.saved_run_id.toLowerCase(),
    });
    const changes = changesOf(saved, args);
    if (partsOf(changes).length === 0) return { unchanged: unchangedData(ctx, saved) };
    // from the saved run the backend holds, not from what the call leaves out
    if (!scheduled(saved) || !touchesTheStart(changes)) return { proceed: true };
    const facts: SaveFacts = {
      name: thirdParty(ctx, saved.name, NAME_LIMIT),
      saved_run_id: saved.id,
      cron: thirdPartyOrNull(ctx, saved.cron_expression, LIMITS.word),
      ...(changes.workload && args.workload !== undefined
        ? {
            workload: {
              from: loadFacts(ctx, saved.workload),
              to: loadFacts(ctx, args.workload),
            } satisfies FromTo<LoadFacts | null>,
          }
        : {}),
      ...(changes.environment && args.environment_id !== undefined
        ? {
            environment: {
              from: saved.environment_id,
              to: args.environment_id.toLowerCase(),
            } satisfies FromTo<string | null>,
          }
        : {}),
      ...(changes.target && args.target_base_url !== undefined
        ? {
            target: {
              from: thirdPartyOrNull(ctx, saved.target_base_url, LIMITS.url),
              to: thirdParty(ctx, args.target_base_url.trim(), LIMITS.url),
            } satisfies FromTo<string | null>,
          }
        : {}),
    };
    return {
      facts,
      escalation: 'scheduled_run',
      volatile: { next_start: saved.next_run_at ?? null },
    };
  },
  cardView: cardViewSave,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.saved_run_id === undefined) {
      const created = await createSavedRun(ctx, path, {
        name: args.name ?? '',
        ...(args.scenario_id === undefined ? {} : { scenario_id: args.scenario_id.toLowerCase() }),
        ...(args.composition_id === undefined
          ? {}
          : { composite_id: args.composition_id.toLowerCase() }),
        ...(args.environment_id === undefined
          ? {}
          : { environment_id: args.environment_id.toLowerCase() }),
        ...(args.target_base_url === undefined
          ? {}
          : { target_base_url: args.target_base_url.trim() }),
        ...(args.source_execution_id === undefined
          ? {}
          : { source_execution_id: args.source_execution_id.toLowerCase() }),
        ...(args.feeder_bindings === undefined ? {} : { feeder_bindings: args.feeder_bindings }),
        ...(args.workload === undefined ? {} : { workload: args.workload as Workload }),
      });
      const data: SaveData = {
        saved_run_id: created.id,
        name: thirdParty(ctx, created.name, NAME_LIMIT),
        created: true,
        changed: [],
        undo: 'removal',
      };
      return {
        status: 'done',
        data,
        update: {
          log: {
            values: { name: data.name },
            undo_args: { undo_tool: 'run_delete', kind: 'saved_run', item_id: created.id },
          },
        },
      };
    }
    const savedRunId = args.saved_run_id.toLowerCase();
    const saved = await getSavedRun(ctx, { ...path, saved_run_id: savedRunId });
    const changes = changesOf(saved, args);
    // a call that went on without a card must still not touch the start of a schedule that began since
    if (facts === null && scheduled(saved) && touchesTheStart(changes)) {
      throw new ToolError('run_save_schedule_started');
    }
    const parts = partsOf(changes);
    if (parts.length === 0) {
      const data = unchangedData(ctx, saved);
      return { status: 'done', data, update: { log: { values: { name: data.name } } } };
    }
    const updated = await updateSavedRun(
      ctx,
      { ...path, saved_run_id: savedRunId },
      {
        ...(changes.name ? { name: args.name ?? '' } : {}),
        ...(changes.environment && args.environment_id !== undefined
          ? { environment_id: args.environment_id.toLowerCase() }
          : {}),
        ...(changes.target && args.target_base_url !== undefined
          ? { target_base_url: args.target_base_url.trim() }
          : {}),
        ...(changes.workload && args.workload !== undefined
          ? { workload: args.workload as Workload }
          : {}),
        ...(changes.feeder && args.feeder_bindings !== undefined
          ? { feeder_bindings: args.feeder_bindings }
          : {}),
      },
    );
    const previous = storedLoad(saved);
    const production = previous !== null && previous['production'] != null;
    // the backend cannot set an environment or an address back to nothing, nor a load that was not stored
    const restorable =
      !(changes.environment && saved.environment_id === null) &&
      !(changes.target && saved.target_base_url === null) &&
      !(changes.workload && (previous === null || production));
    const undoArgs: Record<string, unknown> = {
      undo_tool: 'run_save',
      saved_run_id: savedRunId,
      ...(changes.name ? { name: saved.name } : {}),
      ...(changes.environment && saved.environment_id !== null
        ? { environment_id: saved.environment_id }
        : {}),
      ...(changes.target && saved.target_base_url !== null
        ? { target_base_url: saved.target_base_url }
        : {}),
      ...(changes.workload && previous !== null
        ? {
            workload: {
              type: previous['type'],
              vusers: previous['vusers'],
              ramp: previous['ramp'] ?? 0,
              hold: previous['hold'] ?? 0,
              ...(Array.isArray(previous['thresholds'])
                ? { thresholds: previous['thresholds'] }
                : {}),
            },
          }
        : {}),
      ...(changes.feeder ? { feeder_bindings: saved.feeder_bindings } : {}),
    };
    // a previous value the secret mask would change is not kept: it would reach the state file
    const clean = !ctx.secrets.containsSecret(undoArgs);
    const data: SaveData = {
      saved_run_id: updated.id,
      name: thirdParty(ctx, updated.name, NAME_LIMIT),
      created: false,
      changed: parts,
      undo: !restorable || !clean ? 'withheld' : 'values',
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: { name: data.name },
          ...(restorable && clean ? { undo_args: undoArgs } : {}),
        },
      },
    };
  },
  render: renderSave,
});
