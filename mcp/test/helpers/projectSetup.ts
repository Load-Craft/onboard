// The setup of a project the way the skill runs it: `project_create`, `project_save_env`,
// `project_check_env`, `project_analyze_setup` (continued with `process_wait` while the analysis
// runs) and `project_apply_setup` with the handle of the analysis. Tests that are about the whole
// setup call this; tests of one tool call that tool.

import { projectAnalyzeSetup } from '../../src/tools/projectAnalyzeSetup.js';
import { projectApplySetup } from '../../src/tools/projectApplySetup.js';
import { projectCheckEnv } from '../../src/tools/projectCheckEnv.js';
import { projectCreate } from '../../src/tools/projectCreate.js';
import { projectSaveEnv } from '../../src/tools/projectSaveEnv.js';
import { processWait } from '../../src/tools/processWait.js';
import { settleClock } from './clock.js';
import type { RigCallResult, ToolRig } from './rig.js';

/** The five setup tools and `process_wait`. */
export const SETUP_TOOLS = [
  projectCreate,
  projectSaveEnv,
  projectCheckEnv,
  projectAnalyzeSetup,
  projectApplySetup,
  processWait,
] as const;

export interface SetupEnvironment {
  readonly name: string;
  readonly api: string;
  readonly frontend?: string;
  readonly default?: boolean;
  readonly [field: string]: unknown;
}

/** Everything the setup is given: what each tool takes, in one record. */
export interface SetupArgs {
  readonly name: string;
  readonly openapi?: string;
  readonly asyncapi?: string;
  readonly overview?: string;
  readonly description?: string;
  readonly environments: readonly SetupEnvironment[];
  readonly env_file?: string;
  readonly max_wait_s?: number;
}

export interface SetupCalls {
  readonly create: RigCallResult;
  readonly saveEnv?: RigCallResult;
  readonly checkEnv?: RigCallResult;
  readonly analyze?: RigCallResult;
  readonly apply?: RigCallResult;
}

/** The environment a new project is created with: the one marked default, else the first. */
export function defaultEnvironment(args: SetupArgs): SetupEnvironment {
  const marked = args.environments.find((environment) => environment.default === true);
  const chosen = marked ?? args.environments[0];
  if (chosen === undefined) throw new Error('setUpProject: no environment');
  return chosen;
}

const given = <K extends keyof SetupArgs>(args: SetupArgs, ...keys: K[]): Partial<SetupArgs> =>
  Object.fromEntries(keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));

/** The handle the analysis result names for `project_apply_setup`, if it ran. */
export function analysisHandle(result: RigCallResult): string | undefined {
  const data = result.outcome?.data as { operation?: unknown } | undefined;
  return typeof data?.operation === 'string' ? data.operation : undefined;
}

/**
 * Calls the setup tools in the order of the skill, each until it settles; stops at the first one
 * that fails and returns what was called so far.
 */
export async function setUpProject(r: ToolRig, args: SetupArgs): Promise<SetupCalls> {
  const settle = (call: Promise<RigCallResult>): Promise<RigCallResult> =>
    settleClock(r, call, { limitMs: 600_000 });
  const first = defaultEnvironment(args);
  const create = await settle(
    r.call('project_create', {
      name: args.name,
      ...given(args, 'overview', 'description'),
      environment: {
        name: first.name,
        api: first.api,
        ...(first.frontend === undefined ? {} : { frontend: first.frontend }),
      },
    }),
  );
  if (create.isError) return { create };
  const saveEnv = await settle(
    r.call('project_save_env', { environments: args.environments, ...given(args, 'env_file') }),
  );
  if (saveEnv.isError) return { create, saveEnv };
  const checkEnv = await settle(r.call('project_check_env', {}));
  if (checkEnv.isError) return { create, saveEnv, checkEnv };
  let analyze = await settle(
    r.call(
      'project_analyze_setup',
      given(args, 'openapi', 'asyncapi', 'overview', 'description', 'max_wait_s'),
    ),
  );
  while (!analyze.isError && analyze.outcome?.status === 'running') {
    const operation = analyze.outcome.operation;
    analyze = await settle(r.call('process_wait', { operation }));
  }
  if (analyze.isError) return { create, saveEnv, checkEnv, analyze };
  const handle = analysisHandle(analyze);
  const apply = await settle(
    r.call('project_apply_setup', handle === undefined ? {} : { analysis: handle }),
  );
  return { create, saveEnv, checkEnv, analyze, apply };
}
