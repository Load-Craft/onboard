// `scenario_get_composition` (module scenario): Get a composition: members, weights, pinned
// versions, load profile, status, drift. Header values masked.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The answer holds secrets (the values of the default headers): `callBackend` registers them
// and nothing reads them, only the names of the headers go to the data. A composition's texts (name,
// description, the members' names and labels, the messages of the check) pass `content`; the load
// profile is a recorded body and passes `body`. The members' artifacts, contracts and digests are
// never read.
// Log: args "{composition_id}", result "{name}: {members} members, {status}": the log values carry
// the id as resolved and the three fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderComposition,
  type CompositionData,
  type CompositionView,
  type LoadProfileView,
  type MemberView,
  type TestTypeView,
  type ValidationView,
} from '../../render/scenario/getComposition.js';
import { body, callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { compositionIdOf } from './compositionRef.js';
import { SCENARIO_GET_COMPOSITION } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/compositions/{composition_id} (REST API v1) */
export function getComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get'>
> {
  return callBackend(
    ctx,
    'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get',
    { path },
  );
}

const TEXT_LIMIT = 200;
const MEMBERS_SHOWN = 50;
const HEADERS_SHOWN = 40;
const MESSAGES_SHOWN = 10;
const PROFILE_LIMIT = 600;

type Detail =
  OpOutput<'get_composition_api_v1_projects__project_id__gatling_compositions__composition_id__get'>;
type Member = Detail['scenarios'][number];

const text = (ctx: CallContext, value: string, max = TEXT_LIMIT): string =>
  content(ctx, value, max);

function memberOf(ctx: CallContext, member: Member): MemberView {
  return {
    link_id: member.link_id,
    scenario_id: member.scenario_id,
    scenario_name: member.scenario_name === null ? null : text(ctx, member.scenario_name, 120),
    variant_label: text(ctx, member.variant_label, 80),
    proportion: member.proportion,
    enabled: member.enabled,
    pinned_version: member.pinned_version,
    current_version: member.current_version,
    has_drift: member.has_drift,
    drift_fields: member.drift_fields.slice(),
    think_time_ms: member.think_time_ms,
    own_injection: member.injection_override !== null,
    datasets: member.feeder_bindings.length,
  };
}

function profileOf(ctx: CallContext, profile: Readonly<Record<string, unknown>>): LoadProfileView {
  if (Object.keys(profile).length === 0) return { kind: 'none' };
  const shown = body(ctx, JSON.stringify(profile), 'application/json');
  if (shown.kind === 'hidden') return { kind: 'hidden', bytes: shown.bytes };
  const cut = shown.text.length > PROFILE_LIMIT;
  return {
    kind: 'shown',
    text: cut ? shown.text.slice(0, PROFILE_LIMIT) : shown.text,
    truncated: cut,
  };
}

function validationOf(ctx: CallContext, detail: Detail): ValidationView | null {
  const v = detail.validation;
  if (v === undefined) return null;
  return {
    is_valid: v.is_valid,
    authoring_valid: v.authoring_valid,
    effective_status: v.effective_status,
    last_validated_at: v.last_validated_at,
    total_proportion: v.total_proportion,
    errors: v.errors.slice(0, MESSAGES_SHOWN).map((message) => text(ctx, message)),
    warnings: v.warnings.slice(0, MESSAGES_SHOWN).map((message) => text(ctx, message)),
    missing_bound_feeders: v.missing_bound_feeders
      .slice(0, MESSAGES_SHOWN)
      .map((name) => text(ctx, name, 80)),
  };
}

const PARAMS_SHOWN = 20;

/** The type of the test and its plain parameters; nested values are not read. */
function testTypeOf(
  ctx: CallContext,
  spec: Readonly<Record<string, unknown>> | null,
): TestTypeView | null {
  if (spec === null) return null;
  const params: Record<string, string | number | boolean> = {};
  for (const [name, value] of Object.entries(spec).slice(0, PARAMS_SHOWN + 1)) {
    if (name === 'type' || Object.keys(params).length >= PARAMS_SHOWN) continue;
    if (typeof value === 'number' || typeof value === 'boolean')
      params[text(ctx, name, 60)] = value;
    else if (typeof value === 'string') params[text(ctx, name, 60)] = text(ctx, value, 60);
  }
  const type = spec['type'];
  return { type: typeof type === 'string' ? text(ctx, type, 60) : null, params };
}

function viewOf(ctx: CallContext, detail: Detail): CompositionView {
  const headers = Object.keys(detail.global_headers ?? {});
  return {
    id: detail.id,
    name: text(ctx, detail.name, 120),
    description:
      detail.description === null || detail.description === ''
        ? null
        : text(ctx, detail.description, 300),
    status: detail.status,
    mode: detail.composition_mode,
    updated_at: detail.updated_at,
    members: detail.scenarios.slice(0, MEMBERS_SHOWN).map((member) => memberOf(ctx, member)),
    test_type: testTypeOf(ctx, detail.test_type_spec),
    load_profile: profileOf(ctx, detail.injection_config),
    header_names: headers.slice(0, HEADERS_SHOWN).map((name) => text(ctx, name, 60)),
    header_count: headers.length,
    think_time_ms: detail.global_think_time_ms,
    pause_distribution: detail.pause_distribution,
    throttle_steps: detail.throttle_steps.length,
    bound_slots: Object.keys(detail.slot_bindings).length,
    validation: validationOf(ctx, detail),
  };
}

export const scenarioGetComposition = moduleTool(SCENARIO_GET_COMPOSITION, {
  title: 'Get a composition',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const compositionId = await compositionIdOf(ctx, projectId, args.composition_id);
    const detail = await getComposition(ctx, {
      project_id: projectId,
      composition_id: compositionId,
    });
    const composition = viewOf(ctx, detail);
    const data: CompositionData = { project_id: projectId, composition };
    return {
      status: 'done',
      data,
      update: {
        log: {
          values: {
            composition_id: compositionId,
            name: composition.name,
            members: detail.scenarios.length,
            status: composition.status,
          },
        },
      },
    };
  },
  render: renderComposition,
});
