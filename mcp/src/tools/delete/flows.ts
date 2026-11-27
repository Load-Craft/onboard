// `flows_delete` for kind=flow: flows of one project by id or by exact name. A name that more than one
// flow has (a build that saved a journey twice) makes no card: the answer lists each of those flows
// with its id, version and time, and the user picks by id. The card names every flow and what stays
// behind them pointing at a deleted flow (scenarios built on them, compositions with those
// scenarios); the deletion takes the flows out of the process and recounts the warning of flows on an
// older docs version. The reducer resets what the catalog says a flow change resets.

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { OLD_DOCS_CODE, oldDocsUpdate } from '../../flow/oldDocs.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { callOperation, settleAll } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import { inline } from '../../render/primitives.js';
import { content } from '../moduleCall.js';
import {
  renderDeleteQuestion,
  type CardRenewal,
  type DeleteCount,
  type DeleteData,
  type DeleteFacts,
  type DeleteItem,
  type FlowCounts,
} from '../../render/views/deletion.js';
import { createResolver } from '../../resolve/handles.js';
import type { ProcessUpdateInput } from '../../workspace/reducer.js';
import {
  cardFor,
  DELETE_SCOPES,
  deleteCall,
  issueDeleteCard,
  namesOf,
  useCard,
  type DeleteCall,
  type FrozenCard,
} from './card.js';
import { confirmOnce } from '../../consent/ask.js';
import {
  busy,
  liveOperation,
  LIST_LIMIT,
  readRuns,
  testName,
  tooMany,
  unchecked,
} from './checks.js';
import { shownChoice, shownName } from './card.js';

/** The kinds the catalog gives `flows_delete`; only `flow` is deleted by this server so far. */
export const FLOWS_DELETE_KINDS = ['flow', 'walk_note', 'review'] as const;
export type FlowsDeleteKind = (typeof FLOWS_DELETE_KINDS)[number];

export interface FlowsDeleteArgs {
  readonly kind: FlowsDeleteKind;
  readonly project?: string | undefined;
  readonly flow_ids?: readonly string[] | undefined;
  readonly names?: readonly string[] | undefined;
  readonly confirm?: string | undefined;
}

/** Most flows one card names: the question to the person lists each by name, id, version and time. */
export const MAX_FLOWS = 20;

const SCOPE = DELETE_SCOPES.flows_delete;
const SHOWN_NAMES = 10;

const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

const opts = (ctx: ToolContext): { signal: AbortSignal; secrets: ToolContext['secrets'] } => ({
  signal: ctx.signal,
  secrets: ctx.secrets,
});

interface Project {
  readonly id: string;
  readonly name: string;
}

interface FlowRow {
  readonly id: string;
  readonly name: string;
  readonly current_version: number;
  readonly updated_at: string;
}

const itemOf = (flow: FlowRow): DeleteItem => ({
  id: flow.id,
  name: flow.name,
  version: flow.current_version,
  at: flow.updated_at,
});

function notFound(what: string): ToolError {
  return new ToolError('not_found', { params: { available: ` ${what}` } });
}

async function flowById(ctx: ToolContext, projectId: string, id: string): Promise<DeleteItem> {
  try {
    return itemOf(
      await callOperation(
        ctx.services.http,
        'get_flow_api_v1_projects__project_id__flows__flow_id__get',
        { path: { project_id: projectId, flow_id: id } },
        opts(ctx),
      ),
    );
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw notFound(`No flow of this project has the id ${inline(id, 64)}.`);
    }
    throw error;
  }
}

type Resolved =
  | { readonly kind: 'items'; readonly items: DeleteItem[] }
  | { readonly kind: 'choice'; readonly data: DeleteData };

/** The flows of the call, from the newest page of the project's flows (a flow by id also outside it). */
async function resolveFlows(
  ctx: ToolContext,
  project: Project,
  call: DeleteCall,
): Promise<Resolved> {
  if (call.ids.length === 0 && call.names.length === 0) {
    throw new ToolError('invalid', { params: { detail: 'name the flows: flow_ids or names' } });
  }
  const list = await callOperation(
    ctx.services.http,
    'list_flows_api_v1_projects__project_id__flows_get',
    { path: { project_id: project.id }, query: { limit: LIST_LIMIT } },
    opts(ctx),
  );
  const partial = list.total > list.flows.length;
  // The list has no next page: past its newest 100 flows a name could match one more flow that the
  // list does not show, so a duplicate would pass for the only one. Names are then refused.
  if (partial && call.names.length > 0) {
    throw new ToolError('invalid', {
      params: {
        detail: `the project has ${String(list.total)} flows, more than one list shows; name the flows by flow_ids`,
      },
    });
  }
  const listed = new Map(list.flows.map((flow) => [flow.id, flow]));
  const byId = await settleAll(
    call.ids.map(async (id) => {
      const flow = listed.get(id);
      return flow === undefined ? flowById(ctx, project.id, id) : itemOf(flow);
    }),
  );
  const ambiguous: { name: string; matches: DeleteItem[] }[] = [];
  const byName: DeleteItem[] = [];
  for (const name of call.names) {
    const matches = list.flows.filter((flow) => same(flow.name, name)).map(itemOf);
    if (matches.length === 0) {
      // names from the backend are a third party's text (FIX-74): masked, secrets registered
      const shown = list.flows
        .slice(0, SHOWN_NAMES)
        .map((flow) => `"${content(ctx, flow.name, 80)}"`);
      throw notFound(
        `No flow is named "${content(ctx, name, 120)}"${shown.length === 0 ? '' : `; flows: ${shown.join(', ')}`}.`,
      );
    }
    if (matches.length > 1) ambiguous.push({ name, matches });
    else byName.push(...matches);
  }
  if (ambiguous.length > 0) {
    return { kind: 'choice', data: { choice: true, kind: 'flow', ambiguous } };
  }
  const seen = new Set<string>();
  const items = [...byId, ...byName].filter(
    (item) => !seen.has(item.id) && Boolean(seen.add(item.id)),
  );
  return { kind: 'items', items };
}

interface Dependents {
  readonly counts: FlowCounts;
  readonly scenarios: ReadonlySet<string> | null;
  readonly compositions: ReadonlySet<string> | null;
}

/** Scenarios built on the flows and compositions with those scenarios: they stay, pointing at a deleted flow. */
async function dependentsOf(
  ctx: ToolContext,
  projectId: string,
  flowIds: ReadonlySet<string>,
): Promise<Dependents> {
  const path = { project_id: projectId };
  let scenarios: Set<string> | null;
  let scenarioCount: DeleteCount = null;
  try {
    const data = await callOperation(
      ctx.services.http,
      'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get',
      { path, query: { limit: LIST_LIMIT } },
      opts(ctx),
    );
    scenarios = new Set(
      data.scenarios.filter((row) => flowIds.has(row.source_flow_id ?? '')).map((row) => row.id),
    );
    scenarioCount = { n: scenarios.size, more: data.scenarios.length >= LIST_LIMIT };
    // a full page may hide a scenario of these flows: which tests use them is not known
    if (scenarioCount.more) scenarios = null;
  } catch {
    scenarios = null;
  }
  let compositions: Set<string> | null = null;
  let compositionCount: DeleteCount = null;
  if (scenarios !== null) {
    const built = scenarios;
    try {
      const data = await callOperation(
        ctx.services.http,
        'list_compositions_api_v1_projects__project_id__gatling_compositions_get',
        { path, query: { limit: LIST_LIMIT } },
        opts(ctx),
      );
      compositions = new Set(
        data.compositions
          .filter((row) => row.scenarios.some((member) => built.has(member.scenario_id)))
          .map((row) => row.id),
      );
      const more = data.compositions.length >= LIST_LIMIT || scenarioCount?.more === true;
      compositionCount = { n: compositions.size, more };
      if (more) compositions = null;
    } catch {
      compositions = null;
    }
  }
  return {
    counts: { scenarios: scenarioCount, compositions: compositionCount },
    scenarios,
    compositions,
  };
}

/**
 * Refuses while an operation of this workspace runs on the project or a test runs on the flows.
 * `strict` (before deleting): a list of runs that could not be read to the end refuses too.
 */
async function refuseBusy(
  ctx: ToolContext,
  project: Project,
  dependents: Dependents,
  strict: boolean,
): Promise<boolean> {
  const target = `project "${shownName(ctx, project.name)}"`;
  const operation = liveOperation(ctx, project.id);
  if (operation !== undefined) throw busy(operation, target);
  const runs = await readRuns(ctx, project.id);
  // with no list of what is built on the flows, any test of the project may use them
  const onFlows = runs.running.find(
    (test) =>
      dependents.scenarios === null ||
      dependents.compositions === null ||
      (test.scenarioId !== null && dependents.scenarios.has(test.scenarioId)) ||
      (test.compositeId !== null && dependents.compositions.has(test.compositeId)),
  );
  if (onFlows !== undefined) throw busy(testName(onFlows), target);
  if (!runs.known && strict) throw unchecked(target);
  return !runs.known;
}

async function issue(
  ctx: ToolContext,
  project: Project,
  call: DeleteCall,
  renewed: CardRenewal | undefined,
): Promise<DoneOutcome<DeleteData>> {
  const resolved = await resolveFlows(ctx, project, call);
  if (resolved.kind === 'choice') {
    return { status: 'done', inert: true, data: shownChoice(ctx, resolved.data) };
  }
  const { items } = resolved;
  if (items.length > MAX_FLOWS) throw tooMany(MAX_FLOWS, 'flows');
  const dependents = await dependentsOf(ctx, project.id, new Set(items.map((item) => item.id)));
  const testsUnknown = await refuseBusy(ctx, project, dependents, false);
  const facts: DeleteFacts = {
    tool: 'flows_delete',
    kind: 'flow',
    scope: SCOPE,
    // the card shows the names masked, the same on every call, so the frozen card still matches
    project: { ...project, name: shownName(ctx, project.name) },
    items: items.map((item) => ({ ...item, name: shownName(ctx, item.name) })),
    stays: dependents.counts,
    ...(testsUnknown ? { testsUnknown } : {}),
  };
  const confirm = await issueDeleteCard(ctx, project.id, call, facts);
  return {
    status: 'done',
    inert: true,
    data: {
      ...facts,
      needsConfirmation: true,
      confirm,
      ...(renewed === undefined ? {} : { renewed }),
    },
  };
}

/** What the deletion changes in the process: the flows leave it, and the warning is recounted. */
function processUpdate(
  ctx: ToolContext,
  gone: readonly string[],
  names: string,
): ProcessUpdateInput {
  const process = ctx.state.process();
  const removed = new Set(gone);
  const open = (process?.problems ?? []).filter((problem) => problem.code === OLD_DOCS_CODE);
  const left = open
    .flatMap((problem) => problem.flow_ids ?? [])
    .filter((id) => !removed.has(id))
    .map((id) => ({ id }));
  const warning = open.length === 0 ? undefined : oldDocsUpdate(process, left, 'flows_delete');
  return {
    ...(gone.length === 0 ? {} : { remove: { flow_ids: [...gone] } }),
    ...(warning?.problems === undefined ? {} : { problems: warning.problems }),
    log: { values: { names: names.slice(0, 120) } },
  };
}

/**
 * The repeat with the token of a card: the busy checks again, then the question to the person (the
 * call ends there and comes again with the answer), and only after their yes the deletion.
 */
async function confirmDeletion(
  ctx: ToolContext,
  project: Project,
  card: FrozenCard,
  token: string,
): Promise<DoneOutcome<DeleteData>> {
  const items = card.facts.items.map(({ id, name, version, at }) => ({
    id,
    name,
    ...(version === undefined ? {} : { version }),
    ...(at === undefined ? {} : { at }),
  }));
  const dependents = await dependentsOf(ctx, project.id, new Set(items.map((item) => item.id)));
  await refuseBusy(ctx, project, dependents, true);
  const refusal = new ToolError('consent_missing', {
    params: { link: ctx.services.links.flows(project.id).url },
  });
  confirmOnce(ctx, token, renderDeleteQuestion(card.facts, ctx.t), refusal);
  await useCard(ctx, SCOPE, project.id, token);
  const deletion = await callOperation(
    ctx.services.http,
    'batch_delete_flows_api_v1_projects__project_id__flows_batch_delete_post',
    { path: { project_id: project.id }, body: { flow_ids: items.map((item) => item.id) } },
    opts(ctx),
  );
  const failed = new Set(deletion.failed_ids ?? []);
  const deleted = items.filter((item) => !failed.has(item.id));
  const names = namesOf(deleted);
  return {
    status: 'done',
    data: { kind: 'flow', count: deleted.length, names, deleted, failed: [...failed], project },
    links: [ctx.services.links.flows(project.id)],
    update: processUpdate(
      ctx,
      deleted.map((item) => item.id),
      names,
    ),
  };
}

export async function deleteFlows(
  ctx: ToolContext,
  args: FlowsDeleteArgs,
): Promise<DoneOutcome<DeleteData>> {
  if (args.kind !== 'flow') {
    throw new ToolError('delete_kind_unsupported', {
      params: { tool: 'flows_delete', kind: args.kind, supported: 'flows (kind "flow")' },
    });
  }
  const found = await createResolver(ctx).project(args.project?.trim() ?? '');
  const project: Project = { id: found.id, name: found.name };
  const call = deleteCall('flow', args.flow_ids, args.names);
  let renewed: CardRenewal | undefined;
  if (args.confirm !== undefined) {
    const state = cardFor(ctx, SCOPE, project.id, args.confirm, call);
    if (state.kind === 'card')
      return confirmDeletion(ctx, project, state.card, args.confirm.trim());
    renewed = state.renewed;
  }
  return issue(ctx, project, call, renewed);
}
