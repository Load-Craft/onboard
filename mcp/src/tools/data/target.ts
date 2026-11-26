// The target of the data tools: a composition or a scenario of the project, by name, with the
// project and (where the tool takes one) the environment. Every data tool resolves it the same way.

import * as z from 'zod/v4';

import { getCompat } from '../../api/status.js';
import type { ToolContext } from '../../context.js';
import { createResolver, type Handle, type RunTarget } from '../../resolve/handles.js';

export const scenarioField = z
  .string()
  .describe('Name of a composition or a scenario of the project.');

export const environmentField = z
  .string()
  .optional()
  .describe('Environment the data is for; default: the default environment.');

export const projectField = z
  .string()
  .optional()
  .describe('Project name or UUID; default: the project this repository is bound to.');

export interface ResolvedTarget {
  readonly projectId: string;
  readonly target: RunTarget;
  readonly environment?: Handle;
}

/** The backend's version is checked first; then the project, the target and the environment. */
export async function resolveTarget(
  ctx: ToolContext,
  args: {
    readonly scenario: string;
    readonly environment?: string | undefined;
    readonly project?: string | undefined;
  },
): Promise<ResolvedTarget> {
  await getCompat(ctx);
  const resolver = createResolver(ctx);
  const { id: projectId } = await resolver.project(args.project?.trim() ?? '');
  const target = await resolver.runScenarioTarget(projectId, args.scenario);
  const environment =
    args.environment === undefined
      ? undefined
      : await resolver.environment(projectId, args.environment);
  return { projectId, target, ...(environment === undefined ? {} : { environment }) };
}

/** The arguments every call a data tool names carries besides its own: the project when one was given. */
export const projectArgs = (project: string | undefined): Record<string, string> =>
  project === undefined ? {} : { project };
