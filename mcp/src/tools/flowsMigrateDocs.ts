// `flows_migrate_docs`: moves flows pinned to an older version of the project's documentation onto the
// current one (or another version) in place. LoadCraft keeps the flow id, rebinds the request steps
// to the endpoints of the target version, gives the flow a new version and pins it to the target; its
// scenarios stay attached and go stale. Three ways of a call:
//
// - `preview: true` asks LoadCraft what would change and saves nothing there (level 1);
// - without `preview` and without `confirm` the tool returns the consent card of the catalog entry
//   and sends nothing that writes; the card freezes the whole write (`consent/confirmCard.ts`): the
//   explicit flows with the versions the preview showed, the target version, the values to adopt and
//   allow_unmatched, and gives a one-time token, valid 30 minutes;
// - `confirm: "<token>"`, only after the user's yes, writes what the card froze, not the arguments of
//   that call. A confirm without a valid card, or with arguments other than the card's, gets a new
//   card and sends nothing.
//
// An omitted `flow_ids` is resolved here to the flows on an older version, and the target is the card's
// (also when another version was imported since): the server's defaults are never used. The write
// sends the versions as `expected_versions`, so a flow that changed since the preview refuses the whole
// request (409). The card and the preview are dropped after the write, after a 409 and when another
// docs version is imported. The server needs the capability `flows_spec_migration`.

import * as z from 'zod';

import {
  CARD_TTL_MINUTES,
  consumeCard,
  discardCard,
  issueCard,
  sameFrozen,
} from '../consent/confirmCard.js';

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { OLD_DOCS_CODE, oldDocsUpdate, outdatedFlows, specStatusOf } from '../flow/oldDocs.js';
import { LoadcraftApiError } from '../http/apiError.js';
import { requireCapability } from '../http/compat.js';
import { callOperation, type OpOutput } from '../http/operation.js';
import type { DoneOutcome } from '../outcome.js';
import { defineTool } from '../registry.js';
import {
  renderMigrateDocs,
  type AdoptChoice,
  type DocsVersionView,
  type FlowPlanView,
  type FlowResultView,
  type MigrateDocsData,
  type ValueView,
} from '../render/views/migrateDocs.js';
import { createResolver, type Resolver } from '../resolve/handles.js';
import type { ProcessUpdateInput } from '../workspace/reducer.js';

const TOOL = 'flows_migrate_docs';
const CAPABILITY = 'flows_spec_migration';
const LIST_FLOWS = 'list_flows_api_v1_projects__project_id__flows_get';
const LIST_DOCS = 'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get';
const PREVIEW =
  'preview_flows_spec_migration_api_v1_projects__project_id__flows_spec_migration_preview_post';
const MIGRATE = 'migrate_flows_to_spec_api_v1_projects__project_id__flows_spec_migration_post';
/** The flow list has no paging; 100 is its maximum `limit`, and the most flows one migration takes. */
const LIST_LIMIT = 100;
const MAX_FLOWS = 100;
const MAX_VALUE_IDS = 500;
/** Flow names an error quotes. */
const NAMED = 10;

type FlowRow = OpOutput<typeof LIST_FLOWS>['flows'][number];
type DocsList = OpOutput<typeof LIST_DOCS>;
type Plan = OpOutput<typeof PREVIEW>['flows'][number];
type Result = OpOutput<typeof MIGRATE>['results'][number];

const input = z.object({
  flow_ids: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(MAX_FLOWS)
    .optional()
    .describe('Flows to move (names or UUIDs); omitted: every flow on an older docs version.'),
  target_spec_id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe("Id of the docs version to move to; omitted: the project's current version."),
  preview: z
    .boolean()
    .optional()
    .describe('true: what would change per flow (steps, values, stale scenarios); saves nothing.'),
  adopt_values: z
    .enum(['none', 'all'])
    .optional()
    .describe('all: adopt every adoptable value difference; none (default): values stay.'),
  adopt_value_ids: z
    .array(z.string().trim().min(1).max(400))
    .max(MAX_VALUE_IDS)
    .optional()
    .describe('Ids of value differences from the preview to adopt (with adopt_values none).'),
  allow_unmatched: z
    .boolean()
    .optional()
    .describe(
      'Also move flows with steps whose endpoint the target version lacks; those steps keep ' +
        'their request but lose the link to the docs.',
    ),
  confirm: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Only after the user said yes to the card: the token the card gave, with the same arguments. ' +
        'Never on the first call.',
    ),
  project: z
    .string()
    .optional()
    .describe('Project name or UUID; default: the project this repository is bound to.'),
});

type Args = z.infer<typeof input>;

/** What a preview showed: the target and the versions of its flows, for the card after it. */
const previewSchema = z.object({
  target: z.string(),
  versions: z.record(z.string(), z.number().int()),
  at: z.number(),
});
type Preview = z.infer<typeof previewSchema>;

const previewKey = (projectId: string): string => `${TOOL}:preview:${projectId}`;

function readPreview(ctx: ToolContext, projectId: string, target: string): Preview | undefined {
  const parsed = previewSchema.safeParse(ctx.state.get('drafts', previewKey(projectId))?.value);
  if (!parsed.success || parsed.data.target !== target) return undefined;
  return ctx.clock.now() - parsed.data.at > CARD_TTL_MINUTES * 60_000 ? undefined : parsed.data;
}

/**
 * Drops the card and the preview of the migration of a project: after the write, after a refusal of
 * the whole request (409), and when another docs version is imported (`project_import_docs`).
 */
export async function discardMigrationCards(ctx: ToolContext, projectId: string): Promise<void> {
  await discardCard(ctx, TOOL, projectId);
  if (ctx.state.get('drafts', previewKey(projectId)) !== undefined) {
    await ctx.state.delete('drafts', previewKey(projectId));
  }
}

/** What the card froze: the migration exactly as the write sends it, plus the names it showed. */
const frozenSchema = z.object({
  flow_ids: z.array(z.string()).min(1),
  names: z.record(z.string(), z.string()),
  target_spec_id: z.string(),
  adopt_values: z.enum(['none', 'all']),
  adopt_value_ids: z.array(z.string()),
  allow_unmatched: z.boolean(),
  expected_versions: z.record(z.string(), z.number().int()),
});
type Frozen = z.infer<typeof frozenSchema>;

/** Why a confirm got a new card instead of the write. */
type Renewed = 'missing' | 'expired' | 'token' | 'changed';

async function listFlowPage(
  ctx: ToolContext,
  projectId: string,
): Promise<{ flows: FlowRow[]; total: number }> {
  const data = await callOperation(
    ctx.services.http,
    LIST_FLOWS,
    { path: { project_id: projectId }, query: { limit: LIST_LIMIT } },
    { signal: ctx.signal, secrets: ctx.secrets },
  );
  return { flows: data.flows, total: data.total };
}

async function listDocs(ctx: ToolContext, projectId: string): Promise<DocsList> {
  return callOperation(
    ctx.services.http,
    LIST_DOCS,
    { path: { project_id: projectId } },
    { signal: ctx.signal, secrets: ctx.secrets },
  );
}

function versionOf(docs: DocsList, id: string): DocsVersionView {
  const found = docs.specs.find((spec) => spec.id === id);
  return { id, version: found?.version ?? null, createdAt: found?.created_at ?? null };
}

function currentOf(docs: DocsList): string | null {
  return docs.current_spec_id ?? docs.specs.find((spec) => spec.is_current === true)?.id ?? null;
}

const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

/** The flows the user named, by id or name in the list; anything else goes to the resolver's errors. */
async function namedFlows(
  resolver: Resolver,
  projectId: string,
  names: readonly string[],
  rows: readonly FlowRow[],
): Promise<{ id: string; name: string; version: number | null }[]> {
  const picked = await Promise.all(
    names.map(async (wanted) => {
      const hits = rows.filter((row) => same(row.id, wanted) || same(row.name, wanted));
      const [only] = hits;
      if (hits.length === 1 && only !== undefined) return only;
      const handle = await resolver.flow(projectId, wanted);
      return rows.find((row) => row.id === handle.id) ?? { ...handle, current_version: null };
    }),
  );
  const unique = picked.filter(
    (flow, index) => picked.findIndex((other) => other.id === flow.id) === index,
  );
  return unique.map((flow) => ({
    id: flow.id,
    name: flow.name,
    version: flow.current_version ?? null,
  }));
}

/** Flows pinned to a docs version other than `target` (for the current version: `spec_status`). */
function onOtherDocs(rows: readonly FlowRow[], target: string, current: string | null): FlowRow[] {
  if (target === current) return outdatedFlows(rows, current);
  return rows
    .filter((row) => specStatusOf(row, current) !== 'unpinned' && row.openapi_spec_id !== target)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const json = (value: unknown): string | undefined =>
  value === undefined ? undefined : JSON.stringify(value);

function planView(plan: Plan): FlowPlanView {
  const report = plan.report ?? null;
  const entries = report?.entries ?? [];
  const values: ValueView[] = entries.flatMap((entry) =>
    (entry.value_diffs ?? []).map((value) => {
      const from = json(value.current_value);
      const to = json(value.target_value);
      return {
        id: value.id,
        step: entry.block_name,
        location: value.location,
        field: value.field,
        kind: value.kind,
        action: value.action,
        adoptable: value.adoptable,
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      };
    }),
  );
  return {
    name: plan.flow_name ?? plan.flow_id,
    version: plan.current_version ?? null,
    source: plan.source_spec_version ?? null,
    ...(plan.refusal === null || plan.refusal === undefined
      ? {}
      : { refusal: { code: plan.refusal.code, message: plan.refusal.message } }),
    needsAllowUnmatched: plan.requires_allow_unmatched ?? false,
    ...(report === null
      ? {}
      : {
          counts: {
            total: report.total_request_blocks,
            matched: report.matched_count,
            changed: report.changed_count,
            unmatched: report.unmatched_count,
          },
        }),
    unmatched: entries
      .filter((entry) => entry.status === 'unmatched')
      .map((entry) => ({
        step: entry.block_name,
        request: `${entry.method} ${entry.path}`,
        reason: entry.unmatched_reason ?? null,
      })),
    values,
    checks: entries.flatMap((entry) =>
      (entry.correlation_warnings ?? []).map((check) => ({
        step: entry.block_name,
        selector: check.selector,
        variable: check.variable ?? null,
      })),
    ),
    dropped: report?.dropped_source_endpoints ?? [],
    scenarios: (plan.scenarios ?? []).map((scenario) => scenario.name),
  };
}

function resultView(result: Result): FlowResultView {
  return {
    ...planView(result),
    outcome: result.outcome,
    previousVersion: result.previous_version ?? null,
    currentVersion: result.current_version ?? null,
    adopted: (result.adopted_value_ids ?? []).length,
  };
}

function adoptChoice(args: Args): AdoptChoice {
  if (args.adopt_values === 'all') return { kind: 'all' };
  const picked = args.adopt_value_ids?.length ?? 0;
  return picked > 0 ? { kind: 'picked', count: picked } : { kind: 'none' };
}

/** A 409 of the migration as an error that names the flows or the ids and says to preview again. */
function conflictError(
  error: LoadcraftApiError,
  names: ReadonlyMap<string, string>,
): ToolError | undefined {
  if (error.status !== 409) return undefined;
  const details = (
    typeof error.details === 'object' && error.details !== null ? error.details : {}
  ) as { flow_ids?: unknown; value_ids?: unknown };
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  // preview_stale: a flow or the target changed since the preview; write_conflict: a flow changed or
  // vanished while LoadCraft wrote, and the whole request was rolled back. Nothing was written either way.
  if (error.code === 'preview_stale' || error.code === 'write_conflict') {
    const flows = list(details.flow_ids).map((id) => names.get(id) ?? id);
    const code =
      error.code === 'write_conflict' ? 'flows_migration_conflict' : 'flows_migration_stale';
    return new ToolError(code, {
      params: { flows: flows.slice(0, NAMED).join(', ') || '?' },
      cause: error,
    });
  }
  if (error.code === 'unknown_value_ids') {
    return new ToolError('flows_migration_values_unknown', {
      params: { ids: list(details.value_ids).slice(0, NAMED).join(', ') || '?' },
      cause: error,
    });
  }
  return undefined;
}

/** Whether the arguments a confirm repeats are the card's (an argument it leaves out is the card's). */
async function sameCall(
  resolver: Resolver,
  projectId: string,
  args: Args,
  rows: readonly FlowRow[],
  frozen: Frozen,
): Promise<boolean> {
  if (args.target_spec_id !== undefined && args.target_spec_id !== frozen.target_spec_id) {
    return false;
  }
  if (args.adopt_values !== undefined && args.adopt_values !== frozen.adopt_values) return false;
  if (
    args.adopt_value_ids !== undefined &&
    !sameFrozen([...new Set(args.adopt_value_ids)].sort(), frozen.adopt_value_ids)
  ) {
    return false;
  }
  if (args.allow_unmatched !== undefined && args.allow_unmatched !== frozen.allow_unmatched) {
    return false;
  }
  if (args.flow_ids === undefined) return true;
  const named = await namedFlows(resolver, projectId, args.flow_ids, rows);
  return sameFrozen(named.map((flow) => flow.id).sort(), [...frozen.flow_ids].sort());
}

/** The write of a card: exactly its frozen arguments; the card and the preview go after it or a 409. */
async function migrate(
  ctx: ToolContext,
  projectId: string,
  frozen: Frozen,
  current: string | null,
  docs: DocsList,
): Promise<DoneOutcome<MigrateDocsData>> {
  const names = new Map(Object.entries(frozen.names));
  let answer: OpOutput<typeof MIGRATE>;
  try {
    answer = await callOperation(
      ctx.services.http,
      MIGRATE,
      {
        path: { project_id: projectId },
        body: {
          flow_ids: frozen.flow_ids,
          target_spec_id: frozen.target_spec_id,
          adopt_values: frozen.adopt_values,
          adopt_value_ids: frozen.adopt_value_ids,
          allow_unmatched: frozen.allow_unmatched,
          expected_versions: frozen.expected_versions,
        },
      },
      { signal: ctx.signal, secrets: ctx.secrets },
    );
  } catch (error) {
    if (error instanceof LoadcraftApiError) {
      const refused = conflictError(error, names);
      if (refused !== undefined) {
        await discardMigrationCards(ctx, projectId);
        throw refused;
      }
    }
    throw error;
  }
  await discardMigrationCards(ctx, projectId);
  const flows = answer.results.map(resultView);
  const migrated = flows.filter((flow) => flow.outcome === 'migrated');
  const sum = (key: 'matched' | 'changed' | 'unmatched'): number =>
    migrated.reduce((total, flow) => total + (flow.counts?.[key] ?? 0), 0);
  // The flows are written: a failed reading of the list after it must not turn the call into a failure
  // (its log entry would then invalidate nothing). Without the list the warning follows the results.
  let update: ProcessUpdateInput | undefined;
  let refreshed = true;
  try {
    const after = await listFlowPage(ctx, projectId);
    update = oldDocsUpdate(
      ctx.state.process(),
      outdatedFlows(after.flows, current),
      TOOL,
      after.total > after.flows.length,
    );
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    refreshed = false;
    const moved = new Set(
      answer.results.filter((result) => result.outcome === 'migrated').map((r) => r.flow_id),
    );
    const before = (ctx.state.process()?.problems ?? [])
      .filter((problem) => problem.code === OLD_DOCS_CODE)
      .flatMap((problem) => problem.flow_ids ?? []);
    const left = [...new Set([...before, ...frozen.flow_ids])].filter((id) => !moved.has(id));
    update = oldDocsUpdate(
      ctx.state.process(),
      left.map((id) => ({ id })),
      TOOL,
    );
  }
  const data: MigrateDocsData = {
    kind: 'migrated',
    target: {
      id: answer.target_spec_id,
      version: answer.target_spec_version,
      createdAt: answer.target_spec_created_at ?? versionOf(docs, frozen.target_spec_id).createdAt,
    },
    n: flows.length,
    count: answer.migrated_count,
    matched: sum('matched'),
    changed: sum('changed'),
    unmatched: sum('unmatched'),
    flows,
    ...(refreshed ? {} : { listNotRefreshed: true as const }),
  };
  return {
    status: 'done',
    data,
    ...(update === undefined ? {} : { update }),
    // every flow refused: nothing was written, nothing to invalidate
    ...(answer.migrated_count === 0 ? { inert: true as const } : {}),
  };
}

export const flowsMigrateDocs = defineTool({
  name: TOOL,
  title: 'Move flows to the current docs version',
  description:
    'Migrate flows to the current docs version in place; preview=true saves nothing, ' +
    'adopt_values adopts new example values. Each flow keeps its id and gets a new version; its ' +
    'scenarios stay attached and go stale (build them again with scenario_generate). Call it with ' +
    'preview: true first and show the result. Without preview and without confirm it returns ' +
    "the consent card and changes nothing; only after the user's yes call it again with the " +
    'same arguments and confirm set to the token of the card. Values change only when adopted ' +
    '(adopt_value_ids from ' +
    'the preview, or adopt_values: "all"). The result names the version of each flow that undoes it.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async run(ctx, args) {
    await requireCapability(ctx.services.http, CAPABILITY, ctx.t('migrateDocs.capabilityAdvice'));
    const resolver = createResolver(ctx);
    const project = await resolver.project(args.project);
    const [docs, listed] = await Promise.all([
      listDocs(ctx, project.id),
      listFlowPage(ctx, project.id),
    ]);
    const rows = listed.flows;
    const partial = listed.total > rows.length;
    const current = currentOf(docs);
    const warning = oldDocsUpdate(ctx.state.process(), outdatedFlows(rows, current), TOOL, partial);
    const done = <D>(data: D, inert: boolean) => ({
      status: 'done' as const,
      data,
      ...(warning === undefined ? {} : { update: warning }),
      ...(inert ? { inert: true as const } : {}),
    });

    // A confirm writes only what its card froze, and uses the card up. Anything else (no card, an expired
    // or replaced card, arguments other than the card's) gets a new card for the call as it came, and
    // nothing is sent. A preview never writes: with `preview: true` the confirm and its token are ignored.
    let renewed: Renewed | undefined;
    if (args.confirm !== undefined && args.preview !== true) {
      const redeemed = await consumeCard(ctx, TOOL, project.id, args.confirm);
      const frozen = redeemed.ok ? frozenSchema.safeParse(redeemed.frozen) : undefined;
      if (frozen?.success === true) {
        if (await sameCall(resolver, project.id, args, rows, frozen.data)) {
          return migrate(ctx, project.id, frozen.data, current, docs);
        }
        renewed = 'changed';
      } else {
        renewed = redeemed.ok ? 'missing' : redeemed.reason;
      }
    }

    const target = args.target_spec_id ?? current;
    if (target === null) throw new ToolError('no_openapi_spec');
    if (args.target_spec_id !== undefined && !docs.specs.some((spec) => spec.id === target)) {
      throw new ToolError('flows_migration_target_unknown', {
        params: { target: target.slice(0, 64) },
      });
    }
    const targetView = versionOf(docs, target);
    const shown = readPreview(ctx, project.id, target);
    const names = new Map(rows.map((row) => [row.id, row.name]));
    const chosen =
      args.flow_ids !== undefined
        ? await namedFlows(resolver, project.id, args.flow_ids, rows)
        : shown !== undefined
          ? Object.keys(shown.versions).map((id) => ({
              id,
              name: names.get(id) ?? id,
              version: shown.versions[id] ?? null,
            }))
          : onOtherDocs(rows, target, current).map((row) => ({
              id: row.id,
              name: row.name,
              version: row.current_version,
            }));

    if (chosen.length === 0) {
      const data: MigrateDocsData = { kind: 'nothing', target: targetView };
      return done(data, true);
    }
    const flowIds = chosen.map((flow) => flow.id).slice(0, MAX_FLOWS);

    if (args.preview === true) {
      const preview = await callOperation(
        ctx.services.http,
        PREVIEW,
        { path: { project_id: project.id }, body: { flow_ids: flowIds, target_spec_id: target } },
        { signal: ctx.signal, secrets: ctx.secrets },
      );
      // a preview replaces the card: the user is to agree to what they see now
      await discardCard(ctx, TOOL, project.id);
      const versions = Object.fromEntries(
        preview.flows
          .filter((plan) => plan.refusal === null || plan.refusal === undefined)
          .flatMap((plan) =>
            plan.current_version === null || plan.current_version === undefined
              ? []
              : [[plan.flow_id, plan.current_version] as const],
          ),
      );
      await ctx.state.set('drafts', previewKey(project.id), {
        target,
        versions,
        at: ctx.clock.now(),
      } satisfies Preview);
      const data: MigrateDocsData = {
        kind: 'preview',
        target: {
          id: preview.target_spec_id,
          version: preview.target_spec_version,
          createdAt: preview.target_spec_created_at ?? targetView.createdAt,
        },
        flows: preview.flows.map(planView),
        migratable: preview.migratable_count,
        refused: preview.refused_count,
      };
      return done(data, true);
    }

    // The card freezes the whole write: the flows with the versions of the preview the user saw (or, with
    // no preview, as the list has them now), the target, the values and allow_unmatched.
    const frozen: Frozen = {
      flow_ids: flowIds,
      names: Object.fromEntries(chosen.map((flow) => [flow.id, flow.name])),
      target_spec_id: target,
      adopt_values: args.adopt_values ?? 'none',
      adopt_value_ids: [...new Set(args.adopt_value_ids ?? [])].sort(),
      allow_unmatched: args.allow_unmatched === true,
      expected_versions: Object.fromEntries(
        chosen.flatMap((flow) => {
          const version = shown?.versions[flow.id] ?? flow.version;
          return version === null || version === undefined ? [] : [[flow.id, version] as const];
        }),
      ),
    };
    const token = await issueCard(ctx, TOOL, project.id, frozen);
    const data: MigrateDocsData = {
      kind: 'card',
      n: chosen.length,
      flows: chosen.map((flow) => flow.name),
      target: targetView,
      current: current === null ? null : versionOf(docs, current),
      adopt: adoptChoice(args),
      allowUnmatched: frozen.allow_unmatched,
      outdated: outdatedFlows(rows, current).length,
      token,
      ...(renewed === undefined ? {} : { renewed }),
    };
    return done(data, true);
  },
  render: renderMigrateDocs,
});
