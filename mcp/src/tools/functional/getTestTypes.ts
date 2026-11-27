// `functional_get_test_types` (module functional): Get the project's test types: list, one, or
// expected-outcome candidates.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. A test type is named by its id (one read) or by the name the project uses (found in the list,
// which already holds the whole record). Names, descriptions and outcomes are written by people and by
// models, so they pass the mask of a third party's text (`content`).
// Log: args "", result "{count} test types": the data carries the count.
// Arguments (the catalog's): `test_type`, `view`, `is_enabled`.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetTestTypes,
  type OutcomeCandidate,
  type TestTypeDetail,
  type TestTypeRow,
  type TestTypesData,
} from '../../render/functional/getTestTypes.js';
import { callBackend, type CallContext, type QueryOf } from '../moduleCall.js';
import { LIMITS, isUuid, projectIdOf, thirdParty } from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { pickNamed } from '../run/common.js';
import { FUNCTIONAL_GET_TEST_TYPES } from './meta.generated.js';

/** GET /projects/{project_id}/test-types (REST API v1) */
export function listProjectTestTypes(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'list_project_test_types_api_v1_projects__project_id__test_types_get'>,
): Promise<OpOutput<'list_project_test_types_api_v1_projects__project_id__test_types_get'>> {
  return callBackend(ctx, 'list_project_test_types_api_v1_projects__project_id__test_types_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

/** GET /projects/{project_id}/test-types/{test_type_id} (REST API v1) */
export function getTestType(
  ctx: CallContext,
  path: { readonly project_id: string; readonly test_type_id: string },
): Promise<OpOutput<'get_test_type_api_v1_projects__project_id__test_types__test_type_id__get'>> {
  return callBackend(
    ctx,
    'get_test_type_api_v1_projects__project_id__test_types__test_type_id__get',
    { path },
  );
}

/** GET /projects/{project_id}/test-types/expected-outcome-candidates (REST API v1) */
export function getExpectedOutcomeCandidates(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'get_expected_outcome_candidates_api_v1_projects__project_id__test_types_expected_outcome_candidates_get'>
> {
  return callBackend(
    ctx,
    'get_expected_outcome_candidates_api_v1_projects__project_id__test_types_expected_outcome_candidates_get',
    { path },
  );
}

/** The test types the data lists; the count says how many the project has. */
const ITEMS_SHOWN = 50;

type TestType =
  OpOutput<'get_test_type_api_v1_projects__project_id__test_types__test_type_id__get'>;

function rowOf(ctx: CallContext, type: TestType): TestTypeRow {
  const base = type.base_type?.name ?? type.base_type_name ?? null;
  return {
    id: type.id,
    name: thirdParty(ctx, type.effective_name, LIMITS.name),
    displayName: thirdParty(ctx, type.effective_display_name, LIMITS.name),
    category:
      type.effective_category === null
        ? null
        : thirdParty(ctx, type.effective_category, LIMITS.name),
    enabled: type.is_enabled,
    priority: type.priority,
    defaultCount: type.default_count,
    base: base === null ? null : thirdParty(ctx, base, LIMITS.name),
    expectedOutcome:
      type.effective_expected_outcome === null || type.effective_expected_outcome === undefined
        ? null
        : thirdParty(ctx, type.effective_expected_outcome, LIMITS.sentence),
  };
}

function detailOf(ctx: CallContext, type: TestType): TestTypeDetail {
  const description = type.custom_description ?? type.base_type?.description ?? null;
  return {
    ...rowOf(ctx, type),
    description: description === null ? null : thirdParty(ctx, description, LIMITS.sentence),
    examples: type.custom_example_inputs?.length ?? 0,
    pollTimeoutMs: type.poll_timeout_ms ?? null,
    pollCompletion: (type.poll_completion_values ?? []).map((value) =>
      thirdParty(ctx, value, LIMITS.name),
    ),
  };
}

const SOURCES: ReadonlySet<string> = new Set(['observed', 'spec_enum']);

export const functionalGetTestTypes = moduleTool(FUNCTIONAL_GET_TEST_TYPES, {
  title: "Get the project's test types",
  input: {
    test_type: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('One test type (name or id); without it, the list.'),
    view: z
      .enum(['list', 'expected_outcomes'])
      .default('list')
      .describe(
        "expected_outcomes: values that count as success, seen in the project's flows and its spec.",
      ),
    is_enabled: z
      .boolean()
      .optional()
      .describe('Only enabled (true) or disabled (false) test types.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.view === 'expected_outcomes') {
      const answer = await getExpectedOutcomeCandidates(ctx, path);
      const candidates: OutcomeCandidate[] = (answer.candidates ?? []).map((candidate) => ({
        value: thirdParty(ctx, candidate.value, LIMITS.name),
        source: SOURCES.has(candidate.source) ? candidate.source : 'other',
        field:
          candidate.field === null || candidate.field === undefined
            ? null
            : thirdParty(ctx, candidate.field, LIMITS.name),
      }));
      const data: TestTypesData = {
        project_id: projectId,
        view: 'expected_outcomes',
        count: candidates.length,
        shown: candidates.length,
        items: [],
        testType: null,
        outcomes: {
          statusField:
            answer.status_field === null || answer.status_field === undefined
              ? null
              : thirdParty(ctx, answer.status_field, LIMITS.name),
          candidates,
        },
      };
      return { status: 'done', data };
    }
    const given = args.test_type?.trim();
    if (given !== undefined && isUuid(given)) {
      const one = await getTestType(ctx, { ...path, test_type_id: given.toLowerCase() });
      return { status: 'done', data: single(projectId, detailOf(ctx, one)) };
    }
    const all = await listProjectTestTypes(ctx, path, {
      ...(args.is_enabled === undefined ? {} : { is_enabled: args.is_enabled }),
    });
    if (given !== undefined) {
      const picked = pickNamed(
        ctx,
        'test_type',
        given,
        all.items.map((item) => ({ id: item.id, name: item.effective_name })),
      );
      const one = all.items.find((item) => item.id === picked.id);
      if (one === undefined) throw new Error('picked test type vanished');
      return { status: 'done', data: single(projectId, detailOf(ctx, one)) };
    }
    const items = all.items.slice(0, ITEMS_SHOWN).map((item) => rowOf(ctx, item));
    const data: TestTypesData = {
      project_id: projectId,
      view: 'list',
      count: all.items.length,
      shown: items.length,
      items,
      testType: null,
      outcomes: null,
    };
    return { status: 'done', data };
  },
  render: renderGetTestTypes,
});

function single(projectId: string, detail: TestTypeDetail): TestTypesData {
  return {
    project_id: projectId,
    view: 'list',
    count: 1,
    shown: 0,
    items: [],
    testType: detail,
    outcomes: null,
  };
}
