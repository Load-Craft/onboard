// `project_delete` for kind=project: the card with every project and what goes with it, the yes the
// mod hands over, and the deletion itself. A deletion of the project this repository is bound to
// also unbinds it: the binding file goes, and so does the process of every deleted project in the
// state file (one write of the state, through the store).

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import { callOperation } from '../../http/operation.js';
import type { DoneOutcome } from '../../outcome.js';
import { inline } from '../../render/primitives.js';
import {
  renderDeleteQuestion,
  type CardRenewal,
  type DeleteData,
  type DeleteFacts,
  type DeleteItem,
  type ProjectCounts,
} from '../../render/views/deletion.js';
import { removeBinding } from '../../workspace/binding.js';
import { migrateState } from '../../workspace/migrate.js';
import { forgetProjects } from '../../workspace/rebind.js';
import { createProcessStore } from '../../workspace/reducer.js';
import {
  cardFor,
  DELETE_SCOPES,
  deleteCall,
  issueDeleteCard,
  namesOf,
  PROJECTS_KEY,
  useCard,
  type DeleteCall,
  type FrozenCard,
} from './card.js';
import { confirmOnce } from '../../consent/ask.js';
import {
  boundProject,
  busy,
  counted,
  exactCount,
  listedCount,
  liveOperation,
  LIST_LIMIT,
  readRuns,
  sumCounts,
  testName,
  tooMany,
  unchecked,
} from './checks.js';

/** The kinds the catalog gives `project_delete`; only `project` is deleted by this server so far. */
export const PROJECT_DELETE_KINDS = ['project', 'env', 'member', 'note', 'token'] as const;
export type ProjectDeleteKind = (typeof PROJECT_DELETE_KINDS)[number];

export interface ProjectDeleteArgs {
  readonly kind: ProjectDeleteKind;
  readonly ids?: readonly string[] | undefined;
  readonly names?: readonly string[] | undefined;
  readonly confirm?: string | undefined;
}

/** Most projects one card names: the question to the person lists each with its numbers. */
export const MAX_PROJECTS = 5;

const SCOPE = DELETE_SCOPES.project_delete;
/** Pages of the project list read at most when a name is looked up (10 000 projects). */
const PROJECT_PAGES_MAX = 100;
const SHOWN_NAMES = 10;

const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

const opts = (ctx: ToolContext): { signal: AbortSignal; secrets: ToolContext['secrets'] } => ({
  signal: ctx.signal,
  secrets: ctx.secrets,
});

function notFound(what: string): ToolError {
  return new ToolError('not_found', { params: { available: ` ${what}` } });
}

async function projectById(ctx: ToolContext, id: string): Promise<DeleteItem> {
  try {
    const project = await callOperation(
      ctx.services.http,
      'get_project_api_v1_projects__project_id__get',
      { path: { project_id: id } },
      opts(ctx),
    );
    return { id: project.id, name: project.name };
  } catch (error) {
    if (error instanceof LoadcraftApiError && error.status === 404) {
      throw notFound(`No project has the id ${inline(id, 64)}.`);
    }
    throw error;
  }
}

async function allProjects(ctx: ToolContext): Promise<DeleteItem[]> {
  const projects: DeleteItem[] = [];
  for (let page = 0; page < PROJECT_PAGES_MAX; page += 1) {
    const data = await callOperation(
      ctx.services.http,
      'list_projects_api_v1_projects_get',
      { query: { limit: LIST_LIMIT, offset: page * LIST_LIMIT } },
      opts(ctx),
    );
    for (const item of data.projects) projects.push({ id: item.id, name: item.name });
    if (data.projects.length < LIST_LIMIT) break;
  }
  return projects;
}

type Resolved =
  | { readonly kind: 'items'; readonly items: DeleteItem[] }
  | { readonly kind: 'choice'; readonly data: DeleteData };

/** The projects of the call: by id, and by exact name (a name of several projects is a choice). */
async function resolveProjects(ctx: ToolContext, call: DeleteCall): Promise<Resolved> {
  if (call.ids.length === 0 && call.names.length === 0) {
    throw new ToolError('invalid', { params: { detail: 'name the projects: ids or names' } });
  }
  const byId = await Promise.all(call.ids.map((id) => projectById(ctx, id)));
  const all = call.names.length === 0 ? [] : await allProjects(ctx);
  const ambiguous: { name: string; matches: DeleteItem[] }[] = [];
  const byName: DeleteItem[] = [];
  for (const name of call.names) {
    const matches = all.filter((project) => same(project.name, name));
    if (matches.length === 0) {
      const shown = all.slice(0, SHOWN_NAMES).map((project) => `"${inline(project.name, 80)}"`);
      throw notFound(
        `No project is named "${inline(name, 120)}"${shown.length === 0 ? '' : `; projects: ${shown.join(', ')}`}.`,
      );
    }
    if (matches.length > 1) ambiguous.push({ name, matches });
    else byName.push(...matches);
  }
  if (ambiguous.length > 0) {
    return { kind: 'choice', data: { choice: true, kind: 'project', ambiguous } };
  }
  const seen = new Set<string>();
  const items = [...byId, ...byName].filter(
    (item) => !seen.has(item.id) && Boolean(seen.add(item.id)),
  );
  return { kind: 'items', items };
}

/** What goes with one project, each number from one cheap read (null when it cannot be read). */
async function countsOf(
  ctx: ToolContext,
  projectId: string,
  runs: Awaited<ReturnType<typeof readRuns>>,
): Promise<ProjectCounts> {
  const path = { project_id: projectId };
  const [flows, scenarios, compositions, openapi, asyncapi, environments, functional] =
    await Promise.all([
      counted(async () =>
        exactCount(
          (
            await callOperation(
              ctx.services.http,
              'list_flows_api_v1_projects__project_id__flows_get',
              { path, query: { limit: 1 } },
              opts(ctx),
            )
          ).total,
        ),
      ),
      counted(async () =>
        listedCount(
          (
            await callOperation(
              ctx.services.http,
              'list_scenarios_api_v1_projects__project_id__gatling_scenarios_get',
              { path, query: { limit: LIST_LIMIT } },
              opts(ctx),
            )
          ).scenarios.length,
        ),
      ),
      counted(async () =>
        listedCount(
          (
            await callOperation(
              ctx.services.http,
              'list_compositions_api_v1_projects__project_id__gatling_compositions_get',
              { path, query: { limit: LIST_LIMIT } },
              opts(ctx),
            )
          ).compositions.length,
        ),
      ),
      counted(async () =>
        exactCount(
          (
            await callOperation(
              ctx.services.http,
              'list_project_openapi_specs_api_v1_projects__project_id__openapi_specs_get',
              { path, query: { limit: 1 } },
              opts(ctx),
            )
          ).total,
        ),
      ),
      counted(async () =>
        exactCount(
          (
            await callOperation(
              ctx.services.http,
              'list_project_asyncapi_specs_api_v1_projects__project_id__asyncapi_specs_get',
              { path, query: { limit: 1 } },
              opts(ctx),
            )
          ).total,
        ),
      ),
      counted(async () =>
        exactCount(
          (
            await callOperation(
              ctx.services.http,
              'list_project_environments_api_v1_projects__project_id__environments_get',
              { path },
              opts(ctx),
            )
          ).total,
        ),
      ),
      counted(async () =>
        exactCount(
          (
            await callOperation(
              ctx.services.http,
              'list_executions_api_v1_projects__project_id__executions_get',
              { path, query: { limit: 1 } },
              opts(ctx),
            )
          ).total,
        ),
      ),
    ]);
  return {
    flows,
    scenarios,
    compositions,
    docs: sumCounts(openapi, asyncapi),
    environments,
    // the list of datasets carries their whole content: no cheap read counts them
    datasets: null,
    runs: sumCounts(runs.count, functional),
  };
}

/**
 * Refuses while an operation of this workspace or a test runs on one of the projects. `strict`
 * (before deleting): a list of runs that could not be read to the end refuses too.
 */
async function refuseBusy(
  ctx: ToolContext,
  items: readonly DeleteItem[],
  strict: boolean,
): Promise<{
  readonly testsUnknown: boolean;
  readonly runs: Map<string, Awaited<ReturnType<typeof readRuns>>>;
}> {
  const runs = new Map<string, Awaited<ReturnType<typeof readRuns>>>();
  let testsUnknown = false;
  for (const item of items) {
    const target = `project "${inline(item.name, 80)}"`;
    const operation = liveOperation(ctx, item.id);
    if (operation !== undefined) throw busy(operation, target);
    const read = await readRuns(ctx, item.id);
    const [test] = read.running;
    if (test !== undefined) throw busy(testName(test), target);
    if (!read.known && strict) throw unchecked(target);
    if (!read.known) testsUnknown = true;
    runs.set(item.id, read);
  }
  return { testsUnknown, runs };
}

async function issue(
  ctx: ToolContext,
  call: DeleteCall,
  renewed: CardRenewal | undefined,
): Promise<DoneOutcome<DeleteData>> {
  const resolved = await resolveProjects(ctx, call);
  if (resolved.kind === 'choice') return { status: 'done', inert: true, data: resolved.data };
  const { items } = resolved;
  if (items.length > MAX_PROJECTS) throw tooMany(MAX_PROJECTS, 'projects');
  const { testsUnknown, runs } = await refuseBusy(ctx, items, false);
  const withCounts = await Promise.all(
    items.map(async (item) => ({
      ...item,
      counts: await countsOf(
        ctx,
        item.id,
        runs.get(item.id) ?? { count: null, running: [], known: false },
      ),
    })),
  );
  const bound = boundProject(ctx);
  const facts: DeleteFacts = {
    tool: 'project_delete',
    kind: 'project',
    scope: SCOPE,
    items: withCounts,
    ...(bound !== undefined && items.some((item) => item.id === bound.id)
      ? { bound: items.find((item) => item.id === bound.id)?.name ?? bound.name }
      : {}),
    ...(testsUnknown ? { testsUnknown } : {}),
  };
  const confirm = await issueDeleteCard(ctx, PROJECTS_KEY, call, facts);
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

/**
 * The repeat with the token of a card: the busy checks again, then the question to the person (the
 * call ends there and comes again with the answer), and only after their yes the deletion.
 */
async function confirmDeletion(
  ctx: ToolContext,
  card: FrozenCard,
  token: string,
): Promise<DoneOutcome<DeleteData>> {
  const items = card.facts.items.map(({ id, name }) => ({ id, name }));
  await refuseBusy(ctx, items, true);
  const refusal = new ToolError('consent_missing', {
    params: { link: ctx.services.links.projects().url },
  });
  confirmOnce(ctx, token, renderDeleteQuestion(card.facts, ctx.t), refusal);
  await useCard(ctx, SCOPE, PROJECTS_KEY);
  const deleted = await deleteFor(ctx, items);
  return { status: 'done', ...deleted };
}

/** The deletion itself, and the unbinding of this repository from a deleted project. */
async function deleteFor(
  ctx: ToolContext,
  items: readonly DeleteItem[],
): Promise<Omit<DoneOutcome<DeleteData>, 'status'>> {
  const answer = await callOperation(
    ctx.services.http,
    'batch_delete_projects_api_v1_projects_batch_delete_post',
    { body: { project_ids: items.map((item) => item.id) } },
    opts(ctx),
  );
  const failed = new Set(answer.failed_ids ?? []);
  const deleted = items.filter((item) => !failed.has(item.id));
  const gone = deleted.map((item) => item.id);
  // From here the projects are gone for good: a failure of the clean-up is reported in the result,
  // never as an error, so nobody takes the deletion for undone and repeats it.
  let unbound = false;
  let unbindFailed = false;
  try {
    // the binding goes first: the log entry of this call is then written to the process of an
    // unbound workspace, never to the process just forgotten
    unbound = gone.some((id) => removeBinding(ctx.config.stateRoot, id, ctx.config.appUrl));
    if (gone.length > 0) {
      await forgetProjects(
        createProcessStore(ctx.config.stateRoot, {
          secrets: ctx.secrets,
          clock: ctx.clock,
          migrate: (raw) =>
            migrateState(raw, { scrubDeep: <T>(value: T): T => ctx.secrets.scrubDeep(value) }),
        }),
        gone,
      );
    }
  } catch (error) {
    unbindFailed = true;
    ctx.log.warn('repository not unbound after a deletion', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const names = namesOf(deleted);
  return {
    data: {
      kind: 'project',
      count: deleted.length,
      names,
      deleted,
      failed: [...failed],
      ...(unbound ? { unbound } : {}),
      ...(unbindFailed ? { unbindFailed } : {}),
    },
    update: { log: { values: { names: names.slice(0, 120) } } },
  };
}

export async function deleteProjects(
  ctx: ToolContext,
  args: ProjectDeleteArgs,
): Promise<DoneOutcome<DeleteData>> {
  if (args.kind !== 'project') {
    throw new ToolError('delete_kind_unsupported', {
      params: { tool: 'project_delete', kind: args.kind, supported: 'projects (kind "project")' },
    });
  }
  const call = deleteCall('project', args.ids, args.names);
  let renewed: CardRenewal | undefined;
  if (args.confirm !== undefined) {
    const found = cardFor(ctx, SCOPE, PROJECTS_KEY, args.confirm, call);
    if (found.kind === 'card') return confirmDeletion(ctx, found.card, args.confirm.trim());
    renewed = found.renewed;
  }
  return issue(ctx, call, renewed);
}
