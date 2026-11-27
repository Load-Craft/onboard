// `flows_get_versions` (module flows): Get a flow's stored versions: the list, or one version as an
// outline.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A version is a snapshot of the flow: its blocks, edges and entry block build the outline as
// `flows_get` draws it. The auth evidence, the derived data, the input configuration and the
// variables of the snapshot are not read. Names, paths and the reason of a change pass the mask of a
// third party's text (`content`).
// Log: args "{flow_id}", result "{count} versions": the data carries `count`.

import * as z from 'zod';

import { maskOutline, maskQuestion } from '../../flow/maskOutline.js';
import { buildOutline } from '../../flow/outline.js';
import type { FlowQuestion } from '../../flow/questions.js';
import type { OpOutput } from '../../http/operation.js';
import {
  renderGetVersions,
  type VersionRow,
  type VersionsData,
} from '../../render/flows/getVersions.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackend, content, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { FLOWS_GET_VERSIONS } from './meta.generated.js';
import { flowRefOf, mask, TEXT_LIMIT } from './shared.js';

/** GET /projects/{project_id}/flows/{flow_id}/versions (REST API v1) */
export function listFlowVersions(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string },
): Promise<
  OpOutput<'list_flow_versions_api_v1_projects__project_id__flows__flow_id__versions_get'>
> {
  return callBackend(
    ctx,
    'list_flow_versions_api_v1_projects__project_id__flows__flow_id__versions_get',
    { path },
  );
}

/** GET /projects/{project_id}/flows/{flow_id}/versions/{version} (REST API v1) */
export function getFlowVersion(
  ctx: CallContext,
  path: { readonly project_id: string; readonly flow_id: string; readonly version: number },
): Promise<
  OpOutput<'get_flow_version_api_v1_projects__project_id__flows__flow_id__versions__version__get'>
> {
  return callBackend(
    ctx,
    'get_flow_version_api_v1_projects__project_id__flows__flow_id__versions__version__get',
    { path },
  );
}

type VersionSummary =
  OpOutput<'list_flow_versions_api_v1_projects__project_id__flows__flow_id__versions_get'>['versions'][number];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The open questions a version kept: the snapshot holds them as stored, so each field is read by its type. */
function questionsOf(items: readonly Readonly<Record<string, unknown>>[]): FlowQuestion[] {
  return items.flatMap((item): FlowQuestion[] => {
    const question = text(item['question']);
    if (question === '') return [];
    const steps = Array.isArray(item['steps'])
      ? item['steps'].filter((step): step is string => typeof step === 'string' && step !== '')
      : [];
    return [
      {
        field: text(item['field']),
        question,
        why: text(item['why']),
        kind: text(item['kind']) || text(item['kind_raw']),
        ...(steps.length === 0 ? {} : { steps }),
        ...(item['definite'] === true ? { definite: true } : {}),
      },
    ];
  });
}

function rowOf(ctx: CallContext, version: VersionSummary): VersionRow {
  return {
    version: version.version,
    created_at: content(ctx, version.created_at, 40),
    created_by: version.created_by === null ? null : content(ctx, version.created_by, 80),
    change_reason:
      version.change_reason === null || version.change_reason === ''
        ? null
        : mask(ctx, version.change_reason, TEXT_LIMIT),
  };
}

export const flowsGetVersions = moduleTool(FLOWS_GET_VERSIONS, {
  title: "Get a flow's stored versions",
  input: {
    flow_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The flow: its id or name; default: the only flow of this workspace.'),
    version: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .optional()
      .describe('One version as an outline; without it, the list (newest first).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('How many versions of the list to return (1-100).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).flow(projectId, flowRefOf(ctx, args.flow_id));
    const flow = { id: found.id, name: mask(ctx, found.name) };
    const path = { project_id: projectId, flow_id: found.id };
    const logValues = { flow_id: args.flow_id ?? '' };
    if (args.version !== undefined) {
      const snapshot = await getFlowVersion(ctx, { ...path, version: args.version });
      const outline = maskOutline(
        ctx,
        buildOutline({
          id: found.id,
          name: found.name,
          current_version: snapshot.version,
          blocks: snapshot.blocks_snapshot,
          edges: snapshot.edges_snapshot,
          entry_block_id: snapshot.entry_block_id_snapshot ?? null,
        }),
      );
      const questions = questionsOf(snapshot.needs_input_snapshot ?? []).map((item) =>
        maskQuestion(ctx, item),
      );
      const row = rowOf(ctx, snapshot);
      const data: VersionsData = {
        mode: 'version',
        project_id: projectId,
        flow,
        count: 1,
        shown: 1,
        versions: [],
        detail: { row, outline, questions },
      };
      return { status: 'done', data, update: { log: { values: logValues } } };
    }
    const list = await listFlowVersions(ctx, path);
    const rows = list.versions.slice(0, args.limit).map((version) => rowOf(ctx, version));
    const data: VersionsData = {
      mode: 'list',
      project_id: projectId,
      flow,
      count: list.versions.length,
      shown: rows.length,
      versions: rows,
      detail: null,
    };
    return { status: 'done', data, update: { log: { values: logValues } } };
  },
  render: renderGetVersions,
});
