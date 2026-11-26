// `project_import_docs`: sends a new version of the project's OpenAPI documentation, also from another
// working tree of the same repository (the checkout of the branch an environment runs). A file
// whose content is already the project's current documentation is not sent again. After the upload
// the tool reads what the new version changed: the operation count, the flows still pinned to an
// earlier version (by name, also two versions back; the warning `flows_on_old_docs` of the state
// follows them) and, for the environment named in the call, the conformance probe.

import * as z from 'zod';

import { getApiMap } from '../api/apiMap.js';
import { getTestTypesSource, uploadOpenapi } from '../api/documentation.js';
import { flowsOnOldDocs, listFlowsWithTotal } from '../api/flows.js';
import { listEnvironmentRecords, runConformance } from '../api/environments.js';
import { getStoredOpenapi } from '../api/setup.js';
import { getCompat } from '../api/status.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { oldDocsUpdate } from '../flow/oldDocs.js';
import { discardMigrationCards } from './flowsMigrateDocs.js';
import { defineTool } from '../registry.js';
import type { EnvironmentConformance } from '../render/views/projectSetup.js';
import {
  renderUpdateOpenapi,
  type UpdateOpenapiData,
  type UpdateOpenapiNote,
} from '../render/views/updateOpenapi.js';
import { createResolver } from '../resolve/handles.js';
import {
  openAllowed,
  parseDocument,
  readBytesAllowed,
  type AllowedFile,
} from '../workspace/uploads.js';
import { openInOtherWorktree } from '../workspace/worktrees.js';
import { conformanceResult, fixedHeaderNames } from './project/setup.js';

/** Time one call may take before the client moves it to the background (Claude Code: 120 s). */
const CALL_BUDGET_MS = 100_000;
/** The least time the conformance probe gets, whatever the upload took. */
const MIN_PROBE_MS = 5_000;

/** Time the conformance probe may take, given the time the call has used so far. */
export const probeBudgetMs = (elapsedMs: number): number =>
  Math.max(MIN_PROBE_MS, CALL_BUDGET_MS - elapsedMs);

const input = z.object({
  openapi: z
    .string()
    .min(1)
    .describe(
      'OpenAPI document (.json): a path inside the project directory, or inside another working ' +
        'tree of the same repository (e.g. ../sklep-qa/loadcraft/openapi.json).',
    ),
  environment: z
    .string()
    .optional()
    .describe(
      'Environment to check the new documentation against (read-only requests); a protected ' +
        'environment is not checked.',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or id; default: the project this directory is bound to.'),
});

/** The file in the project directory, else in another working tree of the repository. */
async function openDocument(ctx: ToolContext, path: string): Promise<AllowedFile> {
  const root = ctx.config.workspaceRoot;
  try {
    return await openAllowed(root, path, 'openapi');
  } catch (error) {
    if (!(error instanceof ToolError) || error.code !== 'path_outside_workspace') throw error;
  }
  return openInOtherWorktree(root, path, 'openapi', ctx.signal);
}

/** Deep equality of parsed JSON, whatever the order of the keys. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
  );
}

interface Target {
  readonly id: string;
  readonly name: string;
  readonly protected: boolean;
  /** Names of the fixed headers of the project's environments, for the report of the probe. */
  readonly headerNames: ReadonlySet<string>;
}

/** The environment named in the call; a name LoadCraft does not know fails before anything is sent. */
async function findTarget(
  ctx: ToolContext,
  projectId: string,
  name: string | undefined,
): Promise<Target | undefined> {
  if (name === undefined) return undefined;
  const handle = await createResolver(ctx).environment(projectId, name);
  const records = await listEnvironmentRecords(ctx, projectId);
  const record = records.find((item) => item.id === handle.id);
  return {
    id: handle.id,
    name: handle.name,
    protected: record?.protected !== false,
    headerNames: fixedHeaderNames(records),
  };
}

/**
 * Conformance of `target` against the new documentation. A protected environment is not probed
 * (the check sends real requests to it). The probe is an extra: one that did not answer in the
 * time left of the call is reported as failed, and the upload stays done.
 */
async function checkTarget(
  ctx: ToolContext,
  projectId: string,
  target: Target,
  startedAt: number,
): Promise<{ environment: string; result: EnvironmentConformance } | undefined> {
  if (target.protected) return { environment: target.name, result: { state: 'skipped' } };
  const left = probeBudgetMs(ctx.clock.now() - startedAt);
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(left)]);
  try {
    const result = conformanceResult(
      await runConformance({ ...ctx, signal }, projectId, target.id),
      target.headerNames,
    );
    return result === undefined ? undefined : { environment: target.name, result };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return { environment: target.name, result: { state: 'failed' } };
  }
}

export const projectImportDocs = defineTool({
  name: 'project_import_docs',
  title: 'Update the API documentation',
  description:
    'Import an OpenAPI document from a file as the active version; replaces the docs of an ' +
    "existing project. Sends a new version of the project's OpenAPI documentation to LoadCraft: " +
    'a .json file in the project directory or in another working tree of the same repository. ' +
    'The previous version stays in the history. A file with the same content as the current ' +
    'version is not sent. ' +
    'Reports the operation count and its change, the flows still on an older version (by name; ' +
    'flows_migrate_docs moves them) and, ' +
    'with `environment`, whether that environment serves the documented operations (GET only; ' +
    'a protected environment is not checked). The profile and the test types are not refreshed.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const startedAt = ctx.clock.now();
    await getCompat(ctx);
    const project = await createResolver(ctx).project(args.project);
    const target = await findTarget(ctx, project.id, args.environment);
    const file = await openDocument(ctx, args.openapi);
    const bytes = await readBytesAllowed(file);
    const document = parseDocument(bytes, file.name, 'openapi');

    const stored = await getStoredOpenapi(ctx, project.id);
    const previous =
      stored === null
        ? {}
        : {
            ...(stored.commit === null ? {} : { previousCommit: stored.commit }),
            previousVersion: stored.version,
          };
    const before = stored === null ? null : await getApiMap(ctx, project.id);

    if (stored !== null && sameJson(stored.content, document)) {
      const data: UpdateOpenapiData = {
        changed: false,
        operations: before?.operations ?? stored.operations,
        delta: null,
        ...previous,
        flowsOnPrevious: 0,
        flowsOnPreviousPartial: false,
        notes: [],
      };
      return { status: 'done', data };
    }

    const specId = await uploadOpenapi(ctx, project.id, file, bytes);
    // a card or a preview of a migration was made against the version before this one
    await discardMigrationCards(ctx, project.id);
    const after = await getApiMap(ctx, project.id);
    const old =
      stored === null
        ? { flows: [], partial: false }
        : await flowsOnOldDocs(
            ctx,
            project.id,
            await listFlowsWithTotal(ctx, project.id),
            specId ?? undefined,
          );
    const conformance =
      target === undefined ? undefined : await checkTarget(ctx, project.id, target, startedAt);
    const madeFrom = await getTestTypesSource(ctx, project.id);
    const notes: UpdateOpenapiNote[] =
      madeFrom !== null && specId !== null && madeFrom !== specId
        ? ['profile_and_test_types_not_refreshed']
        : [];

    const data: UpdateOpenapiData = {
      changed: true,
      operations: after?.operations ?? null,
      delta: before === null || after === null ? null : after.operations - before.operations,
      ...previous,
      flowsOnPrevious: old.flows.length,
      flowsOnPreviousPartial: old.partial,
      ...(old.flows.length === 0 ? {} : { oldFlows: old.flows.map((flow) => flow.name) }),
      ...(conformance === undefined ? {} : { conformance }),
      notes,
    };
    const update =
      stored === null
        ? undefined
        : oldDocsUpdate(ctx.state.process(), old.flows, 'project_import_docs', old.partial);
    return {
      status: 'done',
      data,
      ...(notes.length === 0 ? {} : { links: [ctx.services.links.projectProfile(project.id)] }),
      ...(update === undefined ? {} : { update }),
    };
  },
  render: renderUpdateOpenapi,
});
