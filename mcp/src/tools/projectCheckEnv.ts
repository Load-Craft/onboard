// `project_check_env`: the connection test of the environments of the bound project, from
// LoadCraft's servers: one probe of the API address and one of the frontend address of each
// environment (or of the one named), a few at a time. A private address LoadCraft refuses
// (`blocked`) or a host that does not answer is a result, not an error.

import * as z from 'zod';

import { listEnvironmentRecords, testConnection } from '../api/environments.js';
import { getSetupSnapshot } from '../api/setup.js';
import { getCompat } from '../api/status.js';
import { defineTool } from '../registry.js';
import {
  renderCheckEnv,
  type CheckEnvData,
  type CheckedEnvironment,
} from '../render/views/projectSetup.js';
import { createResolver } from '../resolve/handles.js';
import type { ProcessUpdateInput } from '../workspace/reducer.js';
import { inBatches, PROBES_AT_ONCE } from './project/environments.js';
import { checkConformance, conformanceNote } from './project/setup.js';

const input = z.strictObject({
  environment: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Environment to test; default: every environment of the project.'),
});

/**
 * What the call changes in the process: whether every tested environment answers and, when the
 * default environment was probed against the documentation, serves every documented GET operation.
 */
function checkedUpdate(
  environments: readonly CheckedEnvironment[],
  probed: ReturnType<typeof conformanceNote>,
): ProcessUpdateInput {
  // a project without environments has nothing that answers
  const answer =
    environments.length > 0 && environments.every((environment) => environment.api.status === 'ok');
  return {
    checks: {
      project: {
        env_checked: {
          // an environment that answers but confirmed no documented GET stays undecided (null)
          ok: !answer ? false : probed === undefined ? true : probed.ok,
          ...(probed === undefined ? {} : { note: probed.note }),
        },
      },
    },
  };
}

export const projectCheckEnv = defineTool({
  name: 'project_check_env',
  title: 'Test the connection of LoadCraft environments',
  description:
    'Check an environment: probe its address; conformance with the docs only once they exist. ' +
    'Sends requests to the target. LoadCraft probes the API address and the frontend address of ' +
    'every environment of the bound project (or of the one named) from its servers and reports ' +
    'whether each answers (blocked: a private address LoadCraft cannot reach; unreachable, a TLS ' +
    'error or too many redirects: the address does not answer properly). When the project has ' +
    'documentation, the default environment is also checked for the documented GET operations ' +
    '(skipped when it is protected). No test can run on an environment that does not answer.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    await getCompat(ctx);
    const resolver = createResolver(ctx);
    const project = await resolver.project();
    const named =
      args.environment === undefined
        ? undefined
        : await resolver.environment(project.id, args.environment);
    const records = (await listEnvironmentRecords(ctx, project.id)).filter(
      (record) => named === undefined || record.id === named.id,
    );
    const checks = await inBatches(records, PROBES_AT_ONCE, (record) =>
      testConnection(ctx, project.id, record.id),
    );
    // The documentation is probed on the default environment once the project has it; a project
    // being set up gets it with the analysis, and `project_apply_setup` probes it then.
    const probeDocs =
      records.some((record) => record.isDefault) &&
      (await getSetupSnapshot(ctx, project.id)).hasOpenapi;
    const conformance = probeDocs ? await checkConformance(ctx, project.id, records) : undefined;
    const environments = records.map((record, index): CheckedEnvironment => {
      const check = checks[index];
      if (check === undefined) throw new Error(`no connection test for ${record.name}`);
      const hasCaps = record.caps.maxVu !== undefined || record.caps.maxRps !== undefined;
      return {
        name: record.name,
        default: record.isDefault,
        protected: record.protected,
        ...(hasCaps ? { caps: record.caps } : {}),
        api: check.api,
        ...(check.frontend === undefined ? {} : { frontend: check.frontend }),
        ...(conformance?.environment === record.name ? { conformance: conformance.result } : {}),
      };
    });
    const data: CheckEnvData = { environments };
    return {
      status: 'done',
      data,
      // the check is about the project: a test of one named environment leaves it as it is
      ...(named === undefined
        ? { update: checkedUpdate(environments, conformanceNote(conformance)) }
        : {}),
    };
  },
  render: renderCheckEnv,
});
