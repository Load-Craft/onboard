// `scenario_save` (module scenario): Save a scenario's name, tags, active flag or SLO thresholds
// (no id: create an empty one).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// An existing scenario is read first (its name, tags, active flag and SLO thresholds are the way
// back); only the fields that differ are sent, and a save that changes nothing sends nothing. The
// undo is this tool with the previous values of the changed fields (`update.log.undo_args`); a
// created scenario's undo is `scenario_delete`, which the log takes from the data (a deletion is
// level 3: the tool never calls it). The backend cannot take a scenario's thresholds back to "none"
// by an empty object (that is the stock SLO), so inherited is `slo_from_project: true`, null on the
// wire. A new scenario's class name is made from its name: the backend requires one.
// Log: args "{scenario_id}", result "{name} saved": the data of the result carries the fields.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import { createResolver } from '../../resolve/handles.js';
import { renderSave, type SaveData, type SloState } from '../../render/scenario/save.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getScenario } from './get.js';
import { SCENARIO_SAVE } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/scenarios (REST API v1) */
export function createScenario(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'create_scenario_api_v1_projects__project_id__gatling_scenarios_post'>,
): Promise<OpOutput<'create_scenario_api_v1_projects__project_id__gatling_scenarios_post'>> {
  return callBackend(ctx, 'create_scenario_api_v1_projects__project_id__gatling_scenarios_post', {
    path,
    body,
  });
}

/** PUT /projects/{project_id}/gatling/scenarios/{scenario_id} (REST API v1) */
export function updateScenario(
  ctx: CallContext,
  path: { readonly project_id: string; readonly scenario_id: string },
  body: BodyOf<'update_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__put'>,
): Promise<
  OpOutput<'update_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__put'>
> {
  return callBackend(
    ctx,
    'update_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__put',
    { path, body },
  );
}

const NAME_LIMIT = 200;
const TAGS_MAX = 20;
const CLASS_NAME_LIMIT = 100;

const refuse = (ctx: Pick<ToolContext, 't'>, rule: string): ToolError =>
  new ToolError('scenario_save_refused', {
    params: { reason: ctx.t(`scenario_save.refuse.${rule}`) },
  });

/** The tags of a comma-separated text, trimmed, empty ones dropped. */
function tagsOf(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/** A Scala class name from a scenario name: its ASCII words in capitals (`Scenario` when none). */
export function classNameOf(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/ł/gu, 'l')
    .replace(/Ł/gu, 'L')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== '');
  const joined = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('');
  const named = /^[0-9]/u.test(joined) || joined === '' ? `Scenario${joined}` : joined;
  return named.slice(0, CLASS_NAME_LIMIT);
}

type Thresholds = Readonly<Record<string, unknown>> | null | undefined;

function sloStateOf(value: Thresholds): SloState {
  if (value === null || value === undefined) return { mode: 'inherited' };
  const entries = Object.entries(value);
  if (entries.length === 0) return { mode: 'stock' };
  return {
    mode: 'own',
    thresholds: Object.fromEntries(
      entries.filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    ),
  };
}

const canonical = (value: Thresholds): string =>
  JSON.stringify(
    value === null || value === undefined
      ? null
      : Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

export const scenarioSave = moduleTool(SCENARIO_SAVE, {
  title: "Save a scenario's name, tags, active flag or SLO thresholds",
  input: {
    scenario_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'The scenario to change (id or name); without it, a new empty scenario is created.',
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('The name; required for a new scenario.'),
    tags: z
      .string()
      .max(1000)
      .optional()
      .describe('Tags, comma-separated (at most 20); replaces the list, an empty text clears it.'),
    is_active: z.boolean().optional().describe('Whether the scenario is active.'),
    slo_thresholds: z
      .record(z.string().min(1).max(100), z.number().finite())
      .optional()
      .describe('SLO thresholds (key: number); {} sets the standard SLO.'),
    slo_from_project: z
      .boolean()
      .optional()
      .describe("true: drop the scenario's own SLO thresholds; it inherits the project's."),
  },
  async run(ctx, args) {
    const tags = args.tags === undefined ? undefined : tagsOf(args.tags);
    if (args.slo_thresholds !== undefined && args.slo_from_project === true) {
      throw refuse(ctx, 'slo_conflict');
    }
    if (tags !== undefined && tags.length > TAGS_MAX) throw refuse(ctx, 'too_many_tags');
    const projectId = projectIdOf(ctx, undefined);
    if (args.scenario_id === undefined) return create(ctx, projectId, args, tags);
    if (
      args.name === undefined &&
      tags === undefined &&
      args.is_active === undefined &&
      args.slo_thresholds === undefined &&
      args.slo_from_project !== true
    ) {
      throw refuse(ctx, 'no_fields');
    }
    const found = await createResolver(ctx).scenario(projectId, args.scenario_id);
    const before = await getScenario(ctx, { project_id: projectId, scenario_id: found.id });
    const wantSlo: Thresholds | undefined =
      args.slo_thresholds !== undefined
        ? args.slo_thresholds
        : args.slo_from_project === true
          ? null
          : undefined;
    const changes: {
      name?: { was: string; now: string };
      tags?: { was: string[]; now: string[] };
      is_active?: { was: boolean; now: boolean };
      slo?: { was: SloState; now: SloState };
    } = {};
    const body: BodyOf<'update_scenario_api_v1_projects__project_id__gatling_scenarios__scenario_id__put'> =
      {};
    const undo: Record<string, unknown> = { scenario_id: found.id };
    let undoable = true;
    const was = content(ctx, before.name, NAME_LIMIT);
    if (args.name !== undefined && args.name !== before.name) {
      changes.name = { was, now: content(ctx, args.name, NAME_LIMIT) };
      body.name = args.name;
      undo.name = before.name;
    }
    if (tags !== undefined && JSON.stringify(tags) !== JSON.stringify(before.tags)) {
      changes.tags = {
        was: before.tags.map((tag) => content(ctx, tag, NAME_LIMIT)),
        now: tags.map((tag) => content(ctx, tag, NAME_LIMIT)),
      };
      body.tags = tags;
      if (before.tags.some((tag) => tag.includes(','))) undoable = false;
      else undo.tags = before.tags.join(',');
    }
    if (args.is_active !== undefined && args.is_active !== before.is_active) {
      changes.is_active = { was: before.is_active, now: args.is_active };
      body.is_active = args.is_active;
      undo.is_active = before.is_active;
    }
    if (wantSlo !== undefined && canonical(wantSlo) !== canonical(before.assertion_thresholds)) {
      changes.slo = {
        was: sloStateOf(before.assertion_thresholds),
        now: sloStateOf(wantSlo),
      };
      body.assertion_thresholds = wantSlo === null ? null : { ...wantSlo };
      const previous = before.assertion_thresholds as Thresholds;
      if (previous === null || previous === undefined) undo.slo_from_project = true;
      else if (Object.values(previous).every((value) => typeof value === 'number')) {
        undo.slo_thresholds = previous;
      } else undoable = false;
    }
    const changed = Object.keys(changes).length > 0;
    const data: SaveData = {
      project_id: projectId,
      scenario_id: found.id,
      name: changes.name?.now ?? was,
      created: false,
      changes,
      undoable: changed && undoable,
    };
    if (!changed) {
      return {
        status: 'done',
        data,
        inert: true,
        update: { log: { values: { scenario_id: found.id } } },
      };
    }
    await updateScenario(ctx, { project_id: projectId, scenario_id: found.id }, body);
    return {
      status: 'done',
      data,
      links: [ctx.services.links.scenario(projectId, found.id)],
      update: {
        log: {
          values: { scenario_id: found.id },
          ...(undoable ? { undo_args: undo } : {}),
        },
      },
    };
  },
  render: renderSave,
});

async function create(
  ctx: ToolContext,
  projectId: string,
  args: {
    readonly name?: string | undefined;
    readonly is_active?: boolean | undefined;
    readonly slo_thresholds?: Readonly<Record<string, number>> | undefined;
    readonly slo_from_project?: boolean | undefined;
  },
  tags: readonly string[] | undefined,
) {
  if (args.name === undefined)
    throw new ToolError('missing_argument', { params: { name: 'name' } });
  if (args.is_active !== undefined) throw refuse(ctx, 'active_on_create');
  if (args.slo_from_project === true) throw refuse(ctx, 'slo_from_project_on_create');
  const made = await createScenario(
    ctx,
    { project_id: projectId },
    {
      name: args.name,
      simulation_class_name: classNameOf(args.name),
      ...(tags === undefined || tags.length === 0 ? {} : { tags: [...tags] }),
      ...(args.slo_thresholds === undefined
        ? {}
        : { assertion_thresholds: { ...args.slo_thresholds } }),
    },
  );
  const data: SaveData = {
    project_id: projectId,
    scenario_id: made.id,
    name: content(ctx, args.name, NAME_LIMIT),
    created: true,
    changes: {},
    undoable: true,
  };
  return {
    status: 'done' as const,
    data,
    links: [ctx.services.links.scenario(projectId, made.id)],
    update: { log: { values: { scenario_id: made.id } } },
  };
}
