// `scenario_set_composition_type` (module scenario): Set a composition's load test type; members
// are re-linked and data re-sized.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// The composition is read first (the test type it has now, which is the way back; the same type and
// spec write nothing); the spec is the backend's to check (a 422 writes nothing). The datasets are not
// touched by this tool: the backend's `feeder_advice` says which ones now need more rows, and the view
// says so. The checks that depend on the composition are reset by the reducer (the table of the
// catalog), not here. The names are the application's own text and pass `content`.
// Log: args "{composition_id} {type}" (`update.log.values`: composition_id), result "type {type}; data
// re-sized": `type` is the argument's; the arguments of the undo are the previous type and its
// parameters (`update.log.undo_args`).
// Arguments: composition_id (id or name; default: the one of the workspace), type, spec.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderSetCompositionType,
  type DataAdvice,
  type SetCompositionTypeData,
} from '../../render/scenario/setCompositionType.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getComposition } from './updatePins.js';
import { SCENARIO_SET_COMPOSITION_TYPE } from './meta.generated.js';

/** PUT /projects/{project_id}/gatling/compositions/{composition_id}/test-type (REST API v1) */
export function updateCompositionTestType(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
  body: BodyOf<'update_composition_test_type_api_v1_projects__project_id__gatling_compositions__composition_id__test_type_put'>,
): Promise<
  OpOutput<'update_composition_test_type_api_v1_projects__project_id__gatling_compositions__composition_id__test_type_put'>
> {
  return callBackend(
    ctx,
    'update_composition_test_type_api_v1_projects__project_id__gatling_compositions__composition_id__test_type_put',
    { path, body },
  );
}

const NAME_LIMIT = 100;
const ADVICE_SHOWN = 20;
const REFUSAL_LIMIT = 1500;
const TYPES = [
  'load_test',
  'stress_test',
  'soak_test',
  'spike_test',
  'breakpoint_test',
  'capacity_test',
] as const;

/** The composition the call means: the argument, else the one of the workspace, else `missing_argument`. */
function compositionRefOf(ctx: ToolContext, given: string | undefined): string {
  const kept = given ?? ctx.state.process()?.ids.composition_id;
  if (kept === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'composition_id' } });
  }
  return kept;
}

/** The text of a value with its keys in order, so two specs that say the same compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The validator's "For further information visit <url>" lines point at its docs, not at anything to fix. */
function withoutDocLinks(message: string): string {
  return message
    .replace(/^[ \t]*For further information visit \S+[ \t]*\r?\n?/gmu, '')
    .replace(/\s*For further information visit https?:\/\/errors\.pydantic\.dev\S*/gu, '')
    .replace(/https?:\/\/errors\.pydantic\.dev\S*/gu, '');
}

export const scenarioSetCompositionType = moduleTool(SCENARIO_SET_COMPOSITION_TYPE, {
  title: "Set a composition's load test type",
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
    type: z.enum(TYPES).describe('The kind of test the composition runs.'),
    spec: z
      .record(z.string(), z.unknown())
      .describe(
        'The parameters of that kind; LoadCraft checks them. All kinds take target_users and duration_seconds (positive whole numbers, required) and optionally ' +
          'ramp_up_seconds, think_time_ms, max_duration_seconds. By kind: load_test ramp_down_seconds; stress_test stress_multiplier (above 1); ' +
          'spike_test spike_users (required) and spike_duration_seconds; breakpoint_test step_users, step_duration_seconds, max_steps; capacity_test target_rps. ' +
          'Do not repeat type here; other fields are refused.',
      ),
  },
  async run(ctx, args) {
    if (Object.hasOwn(args.spec, 'type')) {
      throw new ToolError('invalid_arguments', {
        message: 'the kind of test goes in type: leave type out of spec',
        params: { rule: 'composition_spec_type' },
      });
    }
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).composition(
      projectId,
      compositionRefOf(ctx, args.composition_id),
    );
    const path = { project_id: projectId, composition_id: found.id };
    const before = await getComposition(ctx, path);
    const name = content(ctx, before.name, NAME_LIMIT);
    const wanted = { type: args.type, ...args.spec };
    const had = before.test_type_spec ?? null;
    const previousType = typeof had?.['type'] === 'string' ? had['type'] : null;
    const logValues = { composition_id: found.id };
    const base = { project_id: projectId, composition: { id: found.id }, type: args.type };
    if (had !== null && stable(had) === stable(wanted)) {
      const data: SetCompositionTypeData = {
        ...base,
        name,
        previous_type: previousType,
        changed: false,
        short: 0,
        advice: [],
        undo: 'none',
      };
      return { status: 'done', data, inert: true, update: { log: { values: logValues } } };
    }
    // a refused spec is shown whole (every field the backend names), masked, with the fields each kind takes
    const after = await updateCompositionTestType(ctx, path, { test_type_spec: wanted }).catch(
      (error: unknown) => {
        const refused =
          error instanceof LoadcraftApiError && error.status === 422
            ? new ToolError('scenario_composition_spec_refused', {
                params: { detail: content(ctx, withoutDocLinks(error.message), REFUSAL_LIMIT) },
              })
            : error;
        throw refused;
      },
    );
    const advice: DataAdvice[] = after.feeder_advice.flatMap((member) =>
      member.feeder_bindings
        .filter((binding) => binding.required_row_count > binding.row_count)
        .map((binding) => ({
          scenario: content(
            ctx,
            before.scenarios.find((link) => link.link_id === member.link_id)?.scenario_name ??
              member.scenario_id,
            NAME_LIMIT,
          ),
          dataset: content(ctx, binding.feeder_name, NAME_LIMIT),
          required: binding.required_row_count,
          rows: binding.row_count,
          strategy: binding.strategy ?? null,
          refusal:
            binding.required_row_count_refusal === undefined ||
            binding.required_row_count_refusal === null
              ? null
              : content(ctx, binding.required_row_count_refusal, NAME_LIMIT),
        })),
    );
    // the way back is the type the composition had, with its parameters; none when it had none
    const hadType = TYPES.find((type) => type === previousType);
    const hadSpec = Object.fromEntries(Object.entries(had ?? {}).filter(([key]) => key !== 'type'));
    const data: SetCompositionTypeData = {
      ...base,
      name: content(ctx, after.name, NAME_LIMIT),
      previous_type: previousType,
      changed: true,
      short: advice.length,
      advice: advice.slice(0, ADVICE_SHOWN),
      undo: hadType !== undefined ? 'kept' : had === null ? 'no_previous' : 'unknown_previous',
    };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: logValues,
          ...(hadType === undefined
            ? {}
            : { undo_args: { composition_id: found.id, type: hadType, spec: hadSpec } }),
        },
      },
    };
  },
  render: renderSetCompositionType,
});
