// Names and short handles in, backend identifiers out. A tool takes what the user said ("sklep",
// "perf", "zakupy", "e-3f9a12c4"); the backend wants UUIDs. A name that matches nothing or more
// than one item is an error with the candidates, never a guess.
//
// One resolver serves one tool call: the lists it reads are remembered until the call ends.

import {
  getProject,
  listCompositions,
  listEnvironments,
  listExecutions,
  listFlows,
  listScenarios,
  listProjects,
  type ExecutionRef,
  type Named,
} from '../api/lookup.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { settleAll } from '../http/operation.js';
import { inline } from '../render/primitives.js';
import { readProjectBinding } from '../workspace/binding.js';

export interface Handle {
  readonly id: string;
  readonly name: string;
}

export interface RunTarget extends Handle {
  readonly kind: 'composition' | 'scenario';
}

export interface Resolver {
  /** No input: the project the workspace is bound to. A UUID or a name otherwise. */
  project(input?: string): Promise<Handle>;
  environment(project: string, name: string): Promise<Handle>;
  flow(project: string, name: string): Promise<Handle>;
  scenario(project: string, name: string): Promise<Handle>;
  composition(project: string, name: string): Promise<Handle>;
  /** `e-<8 characters>`, a prefix of at least 8 characters, or a UUID. */
  execution(project: string, input: string): Promise<Handle>;
  shortExecution(id: string): string;
  /** A composition or a scenario by name; the same name in both is ambiguous. */
  runScenarioTarget(project: string, name: string): Promise<RunTarget>;
}

export type ResolverContext = Pick<ToolContext, 'config' | 'secrets' | 'services' | 'signal' | 't'>;

/** How many names an error lists. */
const LISTED = 10;
/** A name quoted in an error, in characters: what the model typed or a name from the backend. */
const NAME_LIMIT = 120;
const SHORT_LENGTH = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTION_PREFIX = /^(?:e-)?([0-9a-f][0-9a-f-]*)$/i;

type Kind =
  'project' | 'environment' | 'flow' | 'scenario' | 'composition' | 'execution' | 'target';

const same = (a: string, b: string): boolean =>
  a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();

export function createResolver(ctx: ResolverContext): Resolver {
  const { t } = ctx;
  const remembered = new Map<string, Promise<unknown>>();

  /** Runs `read` once per key; a failed read is forgotten so a retry asks again. */
  function once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const known = remembered.get(key);
    if (known !== undefined) return known as Promise<T>;
    const pending = read();
    remembered.set(key, pending);
    pending.catch(() => remembered.delete(key));
    return pending;
  }

  function listed(names: readonly string[]): string {
    const shown = names
      .slice(0, LISTED)
      .map((name) => inline(name))
      .join(', ');
    const more = names.length - LISTED;
    return more > 0 ? t('resolve.more', { names: shown, count: more }) : shown;
  }

  function notFound(kind: Kind, raw: string, names: readonly string[]): ToolError {
    const subject = t(`resolve.kind.${kind}`);
    const input = inline(raw, NAME_LIMIT);
    const sentence =
      names.length === 0
        ? t('resolve.notFound.empty', { kind: subject, name: input })
        : t('resolve.notFound', { kind: subject, name: input, names: listed(names) });
    return new ToolError('not_found', {
      message: sentence,
      params: { available: ` ${sentence}` },
    });
  }

  function ambiguous(kind: Kind, raw: string, candidates: readonly string[]): ToolError {
    const input = inline(raw, NAME_LIMIT);
    return new ToolError('ambiguous', {
      message: `More than one ${kind} matches "${input}".`,
      params: { kind: t(`resolve.kind.${kind}`), name: input, candidates: listed(candidates) },
    });
  }

  const describe = (item: Handle): string => `"${inline(item.name, NAME_LIMIT)}" (${item.id})`;

  /** The one item with this name (or id); zero or several is an error with the names. */
  function pick(kind: Kind, input: string, items: readonly Handle[]): Handle {
    const wanted = input.trim();
    const byId = UUID.test(wanted) ? items.filter((item) => same(item.id, wanted)) : [];
    const matches = byId.length > 0 ? byId : items.filter((item) => same(item.name, wanted));
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) return { id: only.id, name: only.name };
    if (matches.length > 1) throw ambiguous(kind, wanted, matches.map(describe));
    throw notFound(
      kind,
      wanted,
      items.map((item) => item.name),
    );
  }

  const handle = (item: Named): Handle => ({ id: item.id, name: item.name });

  async function projectByName(input: string): Promise<Handle> {
    const wanted = input.trim();
    const all = await once('projects', () => listProjects(ctx));
    return pick('project', wanted, all);
  }

  function projectByBinding(): Handle {
    const binding = readProjectBinding(ctx);
    if (binding === null) throw new ToolError('no_project');
    return handle(binding.project);
  }

  const shortExecution = (id: string): string => `e-${id.slice(0, SHORT_LENGTH).toLowerCase()}`;

  async function execution(project: string, input: string): Promise<Handle> {
    const wanted = input.trim();
    if (UUID.test(wanted)) {
      const id = wanted.toLowerCase();
      return { id, name: shortExecution(id) };
    }
    const recent = await once<ExecutionRef[]>(`execution:${project}`, () =>
      listExecutions(ctx, project),
    );
    const items = recent.map((item) => ({ id: item.id, name: shortExecution(item.id) }));
    const prefix = EXECUTION_PREFIX.exec(wanted)?.[1]?.toLowerCase();
    if (prefix === undefined || prefix.length < SHORT_LENGTH) {
      throw notFound(
        'execution',
        wanted,
        items.map((item) => item.name),
      );
    }
    const matches = items.filter((item) => item.id.toLowerCase().startsWith(prefix));
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) return only;
    if (matches.length > 1) {
      throw ambiguous(
        'execution',
        wanted,
        matches.map((item) => `${item.name} (${item.id})`),
      );
    }
    throw notFound(
      'execution',
      wanted,
      items.map((item) => item.name),
    );
  }

  /** The list of one kind, read once; `named` is what the tool call searches in. */
  const named = (kind: Kind, project: string, read: () => Promise<readonly Named[]>) =>
    once(`${kind}:${project}`, read);

  async function runScenarioTarget(project: string, input: string): Promise<RunTarget> {
    const wanted = input.trim();
    const [compositions, scenarios] = await settleAll([
      named('composition', project, () => listCompositions(ctx, project)),
      named('scenario', project, () => listScenarios(ctx, project)),
    ]);
    const found: RunTarget[] = [
      ...compositions
        .filter((item) => same(item.name, wanted))
        .map((item) => ({ kind: 'composition' as const, ...handle(item) })),
      ...scenarios
        .filter((item) => same(item.name, wanted))
        .map((item) => ({ kind: 'scenario' as const, ...handle(item) })),
    ];
    const [only] = found;
    if (found.length === 1 && only !== undefined) return only;
    if (found.length > 1) {
      throw ambiguous(
        'target',
        wanted,
        found.map((item) => `${t(`resolve.kind.${item.kind}`)} ${describe(item)}`),
      );
    }
    const names = [...new Set([...compositions, ...scenarios].map((item) => item.name))];
    throw notFound('target', wanted, names);
  }

  return {
    project: async (input) => {
      const wanted = input?.trim() ?? '';
      if (wanted === '') return projectByBinding();
      if (!UUID.test(wanted)) return projectByName(wanted);
      const id = wanted.toLowerCase();
      return handle(await once(`project-id:${id}`, () => getProject(ctx, id)));
    },
    environment: async (project, name) =>
      pick(
        'environment',
        name,
        await named('environment', project, () => listEnvironments(ctx, project)),
      ),
    flow: async (project, name) =>
      pick('flow', name, await named('flow', project, () => listFlows(ctx, project))),
    scenario: async (project, name) =>
      pick('scenario', name, await named('scenario', project, () => listScenarios(ctx, project))),
    composition: async (project, name) =>
      pick(
        'composition',
        name,
        await named('composition', project, () => listCompositions(ctx, project)),
      ),
    execution,
    shortExecution,
    runScenarioTarget,
  };
}
