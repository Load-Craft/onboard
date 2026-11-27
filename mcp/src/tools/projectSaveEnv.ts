// `project_save_env`: the environments of the bound project with their load limits, fixed headers
// and the default. Missing environments are created in the order of the request; an existing one
// is compared, and only its protection is tightened to the requested limit and its fixed headers
// set (addresses and a looser protection are never changed, only reported). Safe to repeat: an
// environment is never created twice, and a duplicated one cannot be repaired through the API.

import type { ToolContext } from '../context.js';
import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { needsInputCleared } from '../flow/needsInput.js';
import { mergeUpdates } from '../outcome.js';
import { defineTool } from '../registry.js';
import {
  renderSaveEnv,
  type SaveEnvData,
  type SavedEnvironment,
} from '../render/views/projectSetup.js';
import { createResolver } from '../resolve/handles.js';
import type { ProcessUpdateInput } from '../workspace/reducer.js';
import {
  ensureEnvironments,
  environmentInput,
  planEnvironments,
  strictFields,
  withHeaderValues,
  type EnvironmentState,
  type PlannedEnvironment,
} from './project/environments.js';
import { content } from './moduleCall.js';

/** Said when the call carries a field the tool does not know. */
const INPUT_HINT =
  'send only environments and env_file; an environment takes name, api, frontend, default, ' +
  'limit and headers';

const input = strictFields(INPUT_HINT, {
  environments: z
    .array(environmentInput)
    .min(1)
    .describe(
      'Every environment to test against, the default one (given to project_create) included; ' +
        'each needs a unique name and an API address. Mark the default with default: true; ' +
        'with none marked the default environment of the project stays as it is.',
    ),
  env_file: z
    .string()
    .optional()
    .describe(
      'Env file inside the project directory (.env, .env.<name> or <name>.env) that holds the ' +
        'variables named in headers[].from_env. Default: .env.',
    ),
});

/** Longest name of an object the process keeps for display. */
const MAX_LABEL = 120;

function savedEnvironment(
  ctx: ToolContext,
  state: EnvironmentState,
  headers: PlannedEnvironment['headerRefs'],
): SavedEnvironment {
  const { record } = state;
  const hasCaps = record.caps.maxVu !== undefined || record.caps.maxRps !== undefined;
  return {
    // the name is shown masked, its secrets registered (FIX-76)
    name: content(ctx, record.name, 120),
    default: record.isDefault,
    protected: record.protected,
    created: state.created,
    ...(state.protectionSet ? { protectionSet: true } : {}),
    ...(hasCaps ? { caps: record.caps } : {}),
    ...(headers.length === 0 ? {} : { headers }),
    ...(state.differs.length === 0 ? {} : { differs: state.differs }),
  };
}

/** What the call changes in the process: the default environment, the names, and the check. */
function savedUpdate(ctx: ToolContext, states: readonly EnvironmentState[]): ProcessUpdateInput {
  const fallback = states.find((state) => state.record.isDefault);
  return {
    ...(fallback === undefined ? {} : { ids: { env_id: fallback.record.id } }),
    labels: Object.fromEntries(
      states.map((state) => [
        state.record.id,
        { name: content(ctx, state.record.name, MAX_LABEL) },
      ]),
    ),
    checks: { project: { env_saved: { ok: states.length > 0 } } },
  };
}

export const projectSaveEnv = defineTool({
  name: 'project_save_env',
  title: 'Save the environments of a LoadCraft project',
  description:
    'Save the environments of the bound project (address, limits, protection, fixed headers ' +
    'read from an env file) and make one the default: adds the missing environments (a limit ' +
    'makes an environment protected) and marks the default. Safe to repeat: nothing is created ' +
    'twice. It tightens the protection of an environment to the requested limit, but never ' +
    'loosens a protection, never changes the address of an existing environment (differences ' +
    'are reported) and never deletes anything. When the documentation requires a fixed header ' +
    'in every request (an API key) or the connection test answers 400 or 401 without one, an ' +
    'environment takes headers: [{ name, from_env }]: the name of the header and the name of ' +
    'the variable in the env file (env_file, default .env) that holds its value. Ask the user ' +
    'for the variable name, never a value: the value is read from the file, sent to LoadCraft ' +
    'and shown nowhere. The headers of an environment are set to the ones listed (an ' +
    'environment without headers in the call keeps its own). Then test them with ' +
    'project_check_env.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const named = planEnvironments(args.environments);
    const planned = await withHeaderValues(ctx, args.env_file ?? '.env', named);
    await getCompat(ctx);
    const project = await createResolver(ctx).project();
    const states = await ensureEnvironments(ctx, project.id, planned);
    const data: SaveEnvData = {
      environments: states.map((state, index) =>
        savedEnvironment(ctx, state, planned[index]?.headerRefs ?? []),
      ),
    };
    // headers set here may supply a key the generator asked for: the warning about it is closed
    const headersSet = planned.some((environment) => environment.headerRefs.length > 0);
    const cleared = headersSet ? needsInputCleared(ctx.state.process()) : undefined;
    const saved = savedUpdate(ctx, states);
    return { status: 'done', data, update: mergeUpdates(saved, cleared) ?? saved };
  },
  render: renderSaveEnv,
});
