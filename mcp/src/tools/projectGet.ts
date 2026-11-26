// `project_get`: the profile of the bound project field by field (the names `project_set_profile`
// takes), the fields the analysis was unsure of, where the applied values came from (the provenance
// the backend recorded at apply: a field applied without the user settling it is unsure too), and on
// request its statistics, the readiness of its setup and its log server. Read-only.

import * as z from 'zod';

import type { ToolContext } from '../context.js';
import { provenanceOf, unmetSteps, UNSETTLED_STATUSES } from '../contract/setupGate.js';
import { callOperation } from '../http/operation.js';
import { defineTool } from '../registry.js';
import {
  renderProjectGet,
  type ProjectGetData,
  type ProjectStats,
  type ProvenanceLine,
} from '../render/views/projectProfile.js';
import { createResolver } from '../resolve/handles.js';
import { openUncertain, readProfile, shownProfile } from './project/profile.js';

const INCLUDE = ['stats', 'setup', 'telemetry'] as const;

const input = z.strictObject({
  include: z
    .array(z.enum(INCLUDE))
    .max(INCLUDE.length)
    .optional()
    .describe(
      'Also show: stats (flows, runs, pass rate, last run), setup (what the setup gate still ' +
        'misses), telemetry (the log server). Default: the profile only.',
    ),
});

const options = (ctx: ToolContext) => ({ signal: ctx.signal, secrets: ctx.secrets });

async function statsOf(ctx: ToolContext, projectId: string): Promise<ProjectStats> {
  const data = await callOperation(
    ctx.services.http,
    'get_project_stats_api_v1_projects__project_id__stats_get',
    { path: { project_id: projectId } },
    options(ctx),
  );
  return {
    flows: data.total_flows,
    runs: data.total_executions,
    passRate: data.pass_rate,
    lastRunAt: data.last_executed_at ?? null,
  };
}

/** The readiness of the setup and where the applied profile fields came from. */
async function setupOf(
  ctx: ToolContext,
  projectId: string,
): Promise<{
  readonly setup: NonNullable<ProjectGetData['setup']>;
  readonly provenance: ProvenanceLine[];
}> {
  const data = await callOperation(
    ctx.services.http,
    'get_setup_status_api_v1_projects__project_id__setup_status_get',
    { path: { project_id: projectId } },
    options(ctx),
  );
  const provenance = provenanceOf(data.profile?.field_provenance).map((entry): ProvenanceLine => ({
    field: entry.field,
    sources: entry.sources,
    confidence: entry.confidence,
    status: entry.status,
    ...(UNSETTLED_STATUSES.has(entry.status) && entry.rationale !== null
      ? { rationale: entry.rationale }
      : {}),
  }));
  return { setup: { complete: data.setup_complete, missing: unmetSteps(data) }, provenance };
}

/** The label of the log server only: its address may carry credentials. */
async function telemetryOf(ctx: ToolContext, projectId: string): Promise<{ label: string } | null> {
  const data = await callOperation(
    ctx.services.http,
    'get_telemetry_source_api_v1_projects__project_id__telemetry_source_get',
    { path: { project_id: projectId } },
    options(ctx),
  );
  return data.telemetry_source == null ? null : { label: data.telemetry_source.label };
}

export const projectGet = defineTool({
  name: 'project_get',
  title: 'Get the profile of a LoadCraft project',
  description:
    "Get a project's profile; include adds statistics, setup readiness, log server. The fields " +
    'are listed under the names project_set_profile takes; the fields the setup analysis was ' +
    'unsure of are marked, ask the user about them. Read-only.',
  input,
  annotations: { readOnlyHint: true, openWorldHint: true },
  async run(ctx, args) {
    const project = await createResolver(ctx).project();
    const include = new Set(args.include ?? []);
    const [stored, stats, gate, telemetry] = await Promise.all([
      readProfile(ctx, project.id),
      include.has('stats') ? statsOf(ctx, project.id) : undefined,
      setupOf(ctx, project.id),
      include.has('telemetry') ? telemetryOf(ctx, project.id) : undefined,
    ]);
    const recorded = gate.provenance
      .filter((entry) => UNSETTLED_STATUSES.has(entry.status))
      .map((entry) => entry.field);
    const data: ProjectGetData = {
      project: { id: project.id, name: stored.name },
      profile: shownProfile(stored.stored),
      uncertain: [...new Set([...openUncertain(ctx.state.process()), ...recorded])],
      ...(gate.provenance.length === 0 ? {} : { provenance: gate.provenance }),
      ...(stats === undefined ? {} : { stats }),
      ...(include.has('setup') ? { setup: gate.setup } : {}),
      ...(telemetry === undefined ? {} : { telemetry }),
    };
    return {
      status: 'done',
      data,
      links: [ctx.services.links.projectProfile(project.id)],
    };
  },
  render: renderProjectGet,
});
