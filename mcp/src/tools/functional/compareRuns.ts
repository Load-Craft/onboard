// `functional_compare_runs` (module functional): Compare two functional runs block by block: status,
// response shape, timing.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. `run_id` is the first run (the backend's `a`), `other` the second (`b`); both are UUIDs and
// required (the state keeps no functional run). The same run twice is refused locally. Block names,
// field paths and warnings pass `content`; the data carries the differing blocks first, then the same
// ones, at most 100 in all.
// Log: args "{run_id} vs {other}", result "{changed} blocks differ": the data carries `changed`.
// Arguments (the catalog's): `run_id`, `other`.

import type { OpOutput } from '../../http/operation.js';
import {
  renderCompareRuns,
  type BlockDiff,
  type CompareData,
  type FieldChange,
} from '../../render/functional/compareRuns.js';
import { LIMITS, projectIdOf, refuseRule, thirdParty } from '../kit/transitional.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_COMPARE_RUNS } from './meta.generated.js';

/** GET /projects/{project_id}/executions/compare (REST API v1) */
export function compareFunctionalExecutions(
  ctx: CallContext,
  path: { readonly project_id: string },
  query: QueryOf<'compare_functional_executions_api_v1_projects__project_id__executions_compare_get'>,
): Promise<
  OpOutput<'compare_functional_executions_api_v1_projects__project_id__executions_compare_get'>
> {
  return callBackend(
    ctx,
    'compare_functional_executions_api_v1_projects__project_id__executions_compare_get',
    { path, query },
  );
}

const BLOCKS_SHOWN = 100;
const FIELDS_SHOWN = 10;

const VERDICTS: ReadonlySet<string> = new Set([
  'same',
  'status_changed',
  'shape_changed',
  'timing_only',
  'only_in_a',
  'only_in_b',
]);

type Entry =
  OpOutput<'compare_functional_executions_api_v1_projects__project_id__executions_compare_get'>['blocks'] extends
    readonly (infer E)[] | undefined
    ? E
    : never;

function fields(
  ctx: CallContext,
  pairs: readonly (readonly string[])[] | undefined,
): FieldChange[] {
  return (pairs ?? []).slice(0, FIELDS_SHOWN).map((pair) => ({
    path: thirdParty(ctx, pair[0] ?? '', LIMITS.name),
    type: thirdParty(ctx, pair[1] ?? '', LIMITS.name),
    to: pair[2] === undefined ? null : thirdParty(ctx, pair[2], LIMITS.name),
  }));
}

function blockOf(ctx: CallContext, entry: Entry): BlockDiff {
  const word = (value: string | null | undefined): string | null =>
    value === null || value === undefined ? null : thirdParty(ctx, value, LIMITS.name);
  return {
    id: thirdParty(ctx, entry.block_id, LIMITS.name),
    name: word(entry.block_name),
    verdict: VERDICTS.has(entry.verdict) ? entry.verdict : 'other',
    status: { run: word(entry.status_a), other: word(entry.status_b) },
    httpStatus: { run: entry.status_code_a ?? null, other: entry.status_code_b ?? null },
    durationMs: { run: entry.duration_ms_a ?? null, other: entry.duration_ms_b ?? null },
    appeared: fields(ctx, entry.shape_diff?.only_in_b),
    disappeared: fields(ctx, entry.shape_diff?.only_in_a),
    typeChanged: fields(ctx, entry.shape_diff?.type_changed),
  };
}

export const functionalCompareRuns = moduleTool(FUNCTIONAL_COMPARE_RUNS, {
  title: 'Compare two functional runs block by block',
  input: {
    run_id: uuidArgument().describe('The functional run.'),
    other: uuidArgument().describe('The run to compare with.'),
  },
  async run(ctx, args) {
    const run = args.run_id.toLowerCase();
    const other = args.other.toLowerCase();
    if (run === other) {
      refuseRule('compare_same_functional_run');
    }
    const projectId = projectIdOf(ctx, undefined);
    const answer = await compareFunctionalExecutions(
      ctx,
      { project_id: projectId },
      { a: run, b: other },
    );
    const all = (answer.blocks ?? []).map((entry) => blockOf(ctx, entry));
    const differing = all.filter((block) => block.verdict !== 'same');
    const same = all.filter((block) => block.verdict === 'same');
    const blocks = [...differing, ...same].slice(0, BLOCKS_SHOWN);
    const data: CompareData = {
      run_id: run,
      other,
      changed: differing.length,
      same: same.length,
      sameFlowVersions: answer.same_flow_versions,
      environments: {
        run: answer.environment_a_id ?? null,
        other: answer.environment_b_id ?? null,
      },
      warnings: (answer.warnings ?? [])
        .slice(0, 5)
        .map((warning) => thirdParty(ctx, warning, LIMITS.sentence)),
      count: all.length,
      shown: blocks.length,
      blocks,
    };
    return { status: 'done', data };
  },
  render: renderCompareRuns,
});
