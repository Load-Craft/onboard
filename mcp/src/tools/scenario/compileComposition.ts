// `scenario_compile_composition` (module scenario): Compile the Gatling project a run would ship,
// without running it (up to 2 min).
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Compile composition {name}", result "compiled: {ok}": the data of the result carries
// the fields.
// Consent: level 2, costly, on a card (docs/consent-card.md). The first call reads the composition and
// makes the card (its name and how many members a build takes, the cost line); a repeat with the same
// arguments asks the person; only their yes starts the build. The build is a synchronous Gradle build on
// the backend, up to 2 minutes, nothing stored: the call may take that long (`callBackendFor`). The
// answer is how it ended: compiled, the generated code did not compile, the build environment failed
// (not the code), or no member was enabled. The build output is never read into the answer. State: the
// check `compiled` and, when it failed, one open problem (cleared when a later build passes).
// Arguments (the catalog's): composition_id (default: the one of the workspace).

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import { LoadcraftApiError } from '../../http/apiError.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewCompileComposition,
  renderCompileComposition,
  type CompileCompositionData,
  type CompileKind,
} from '../../render/scenario/compileComposition.js';
import { createResolver } from '../../resolve/handles.js';
import { callBackendFor, projectIdOf, thirdParty, type CallContext } from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getComposition } from './getComposition.js';
import { SCENARIO_COMPILE_COMPOSITION } from './meta.generated.js';

/** POST /projects/{project_id}/gatling/compositions/{composition_id}/dry-run (REST API v1) */
export function dryRunComposition(
  ctx: CallContext,
  path: { readonly project_id: string; readonly composition_id: string },
): Promise<
  OpOutput<'dry_run_composition_api_v1_projects__project_id__gatling_compositions__composition_id__dry_run_post'>
> {
  return callBackendFor(
    ctx,
    BUILD_TIMEOUT_MS,
    'dry_run_composition_api_v1_projects__project_id__gatling_compositions__composition_id__dry_run_post',
    { path },
  );
}

/** The backend builds for up to 120 s; the call may take that and a little more. */
const BUILD_TIMEOUT_MS = 150_000;
const NAME_LIMIT = 120;
const MESSAGES_SHOWN = 5;
const TEXT_LIMIT = 200;
const INFRASTRUCTURE = /^Build environment failure/iu;
const PROBLEM_CODE = 'composition_compile_failed';

/** The composition the call means: the argument, else the one of the workspace, else `missing_argument`. */
function compositionRefOf(ctx: ToolContext, given: string | undefined): string {
  const kept = given ?? ctx.state.process()?.ids.composition_id;
  if (kept === undefined) {
    throw new ToolError('missing_argument', { params: { name: 'composition_id' } });
  }
  return kept;
}

/** How a finished build ended, from what the backend answered. */
function kindOf(answer: { is_valid: boolean; errors: string[]; raw_output?: string }): CompileKind {
  if (answer.is_valid) return 'compiled';
  if (answer.raw_output === undefined) return 'no_enabled_member';
  return answer.errors.some((text) => INFRASTRUCTURE.test(text))
    ? 'environment_failed'
    : 'code_failed';
}

export const scenarioCompileComposition = moduleTool(SCENARIO_COMPILE_COMPOSITION, {
  title: 'Compile the Gatling project a run would ship',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const found = await createResolver(ctx).composition(
      projectId,
      compositionRefOf(ctx, args.composition_id),
    );
    const composition = await getComposition(ctx, {
      project_id: projectId,
      composition_id: found.id,
    });
    return {
      facts: {
        composition_id: composition.id,
        name: thirdParty(ctx, composition.name, NAME_LIMIT),
        members: composition.scenarios.length,
        enabled: composition.scenarios.filter((member) => member.enabled).length,
      },
    };
  },
  cardView: cardViewCompileComposition,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    let answer: Awaited<ReturnType<typeof dryRunComposition>>;
    try {
      answer = await dryRunComposition(ctx, {
        project_id: projectId,
        composition_id: facts.composition_id,
      });
    } catch (error) {
      // an enabled member with no modular build, or a plan field the build refuses: nothing was built
      if (error instanceof LoadcraftApiError && error.status === 409) {
        throw new ToolError('scenario_compile_refused', {
          params: { name: facts.name },
          cause: error,
        });
      }
      throw error;
    }
    const kind = kindOf(answer);
    const data: CompileCompositionData = {
      composition_id: facts.composition_id,
      name: facts.name,
      ok: answer.is_valid,
      kind,
      duration_s: answer.duration_seconds,
      errors: answer.errors
        .slice(0, MESSAGES_SHOWN)
        .map((text) => thirdParty(ctx, text, TEXT_LIMIT)),
      error_count: answer.errors.length,
      warnings: answer.warnings
        .slice(0, MESSAGES_SHOWN)
        .map((text) => thirdParty(ctx, text, TEXT_LIMIT)),
      warning_count: answer.warnings.length,
      output_lines:
        answer.raw_output === undefined || answer.raw_output === ''
          ? 0
          : answer.raw_output.split('\n').length,
    };
    return {
      status: 'done',
      data,
      update: {
        checks: { scenario: { compiled: { ok: data.ok } } },
        problems: data.ok
          ? { close: [{ code: PROBLEM_CODE, ref_id: facts.composition_id }] }
          : {
              open: [
                {
                  module: 'scenario',
                  tool: 'scenario_compile_composition',
                  code: PROBLEM_CODE,
                  severity: kind === 'code_failed' ? 'blocker' : 'warning',
                  message: ctx.t(`scenario_compile_composition.problem.${kind}`, {
                    name: data.name,
                  }),
                  ref: { kind: 'composition', id: facts.composition_id },
                },
              ],
            },
        log: { values: { ok: String(data.ok) } },
      },
    };
  },
  render: renderCompileComposition,
});
