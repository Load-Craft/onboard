// `project_create`: the project of this exact name (the one the repository is bound to, else the
// exact search hit, else a new one created with the API token's user as owner and with its first,
// default environment) and the binding of this repository to it. A repeated call finds the project
// instead of creating it twice: a project without an owner cannot be repaired through the API.

import * as z from 'zod';

import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import { listProjects, type Named } from '../api/lookup.js';
import { createProject, findProject, searchProjects } from '../api/projects.js';
import { getCompat } from '../api/status.js';
import { defineTool } from '../registry.js';
import { renderProjectCreate, type ProjectCreateData } from '../render/views/projectSetup.js';
import { readProjectBinding, writeBinding } from '../workspace/binding.js';
import { migrateState } from '../workspace/migrate.js';
import { createProcessStore, type ProcessUpdateInput } from '../workspace/reducer.js';
import { bindProject } from '../workspace/rebind.js';
import { checkDocuments, descriptionInputs, projectDescription } from './project/documents.js';
import { address, strictFields } from './project/environments.js';

/** Said when the call carries a field the tool does not know. */
const INPUT_HINT =
  'send only name, overview, description and environment; the environment takes name, api and ' +
  'frontend (its limits and headers go to project_save_env)';

const input = strictFields(INPUT_HINT, {
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe('Project name, unique in the whole LoadCraft instance (case matters).'),
  ...descriptionInputs,
  environment: strictFields(INPUT_HINT, {
    name: z.string().trim().min(1).max(100).describe('Environment name, unique in the project.'),
    api: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe('API address, http(s); a bare host such as api.perf.example.com gets https://.'),
    frontend: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Address a person opens in the browser, if the application has a frontend.'),
  }).describe(
    'The default environment: a new project is created with it (LoadCraft needs one). Pass the ' +
      'same environment to project_save_env with the others.',
  ),
});

type Input = z.infer<typeof input>;

/** Longest name of an object the process keeps for display. */
const MAX_LABEL = 120;

interface ProjectOutcome extends Named {
  readonly reused: boolean;
}

/** The one project named exactly `name`; the database does not forbid two (only the route does). */
function sameName(ctx: ToolContext, projects: readonly Named[], name: string): Named | undefined {
  const matches = projects.filter((project) => project.name === name);
  if (matches.length > 1) {
    throw new ToolError('ambiguous', {
      params: {
        kind: ctx.t('resolve.kind.project'),
        name,
        candidates: matches.map((project) => `"${project.name}" (${project.id})`).join(', '),
      },
    });
  }
  return matches[0];
}

interface FirstEnvironment {
  readonly name: string;
  readonly baseUrl: string;
  readonly frontendUrl?: string;
}

/**
 * The project of this name: the one the repository is bound to, else the exact search hit, else a
 * new one. A name the create refuses as taken is looked up once more in the full project list (the
 * search returns 50 hits at most); not there either, it belongs to a project this token cannot see.
 */
async function ensureProject(
  ctx: ToolContext,
  args: Input,
  description: string | undefined,
  first: FirstEnvironment,
): Promise<ProjectOutcome> {
  const binding = readProjectBinding(ctx);
  if (binding !== null && binding.project.name === args.name) {
    const bound = await findProject(ctx, binding.project.id);
    if (bound !== null && bound.name === args.name) return { ...bound, reused: true };
  }
  const found = sameName(ctx, await searchProjects(ctx, args.name), args.name);
  if (found !== undefined) return { ...found, reused: true };

  try {
    const created = await createProject(ctx, {
      name: args.name,
      ...(description === undefined ? {} : { description }),
      environment: first,
    });
    return { ...created, reused: false };
  } catch (error) {
    if (!(error instanceof ToolError) || error.code !== 'project_name_taken') throw error;
    const listed = sameName(ctx, await listProjects(ctx), args.name);
    if (listed === undefined) throw error;
    return { ...listed, reused: true };
  }
}

/** What the call changes in the process: the project, and the check that it exists and is bound. */
function createdUpdate(project: Named): ProcessUpdateInput {
  return {
    ids: { project_id: project.id },
    labels: { [project.id]: { name: project.name.slice(0, MAX_LABEL) } },
    checks: { project: { created: { ok: true } } },
  };
}

export const projectCreate = defineTool({
  name: 'project_create',
  title: 'Create a LoadCraft project',
  description:
    'Create a project, or adopt the one with the same name, and bind this workspace to it: finds ' +
    'the LoadCraft project with this exact name or creates it (owned by the user of the API ' +
    'token) with its default environment, and binds this repository to it ' +
    '(loadcraft/project.json). Safe to repeat: nothing is created twice. The description is the ' +
    'overview text, else the plain description. Then save every environment with ' +
    'project_save_env.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const first: FirstEnvironment = {
      name: args.environment.name,
      baseUrl: address(args.environment.api, args.environment.name, 'api'),
      ...(args.environment.frontend === undefined
        ? {}
        : {
            frontendUrl: address(args.environment.frontend, args.environment.name, 'frontend'),
          }),
    };
    // Read (and measured) before anything is written: a too long overview stops the call early.
    const description = await projectDescription(args, await checkDocuments(ctx, args));
    await getCompat(ctx);

    const project = await ensureProject(ctx, args, description, first);
    // Bound first: a call cut short later still finds its project next time.
    writeBinding(ctx.config.stateRoot, {
      url: ctx.config.appUrl,
      project: { id: project.id, name: project.name },
    });
    // What the calls before the project left under `_new` moves under it now, in one write, before the
    // log of this call does the same (the log entry of a call that fails below would otherwise wait for
    // the next call); a second move finds nothing under `_new` and writes nothing.
    await bindProject(
      createProcessStore(ctx.config.stateRoot, {
        secrets: ctx.secrets,
        clock: ctx.clock,
        migrate: (raw) =>
          migrateState(raw, { scrubDeep: <T>(value: T): T => ctx.secrets.scrubDeep(value) }),
      }),
      project.id,
    );
    const data: ProjectCreateData = {
      project: { id: project.id, name: project.name, reused: project.reused },
      created: !project.reused,
      adopted: project.reused,
      ...(project.reused ? {} : { environment: first.name }),
    };
    return { status: 'done', data, update: createdUpdate(project) };
  },
  render: renderProjectCreate,
});
