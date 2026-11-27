// `functional_generate_test_types` (module functional): Generate all missing base test types for the
// project; the LLM fills their expected outcomes.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the card and the start. Kind
// `process`, level 2, costly (docs/consent-card.md, docs/long-operation.md): call 1 reads the base test types
// and those the project has and makes the card (how many are missing, which, the cost); the repeat with the
// same arguments asks the person; only their yes starts the run, once (the kind is `testTypesOperation`, shared
// with `functional_suggest_test_types`). Nothing missing: the tool answers at once, no card, no run.
// The test types are created in the project when the run ends: the check `functional.test_types` is written;
// exactly one created is undone by `functional_delete` (`item_id`), several have no undo in the log.
// Log: args "Generate the missing base test types", result "{count} test types added".
// Arguments (the catalog's): include_categories (comma-separated; default: all).

import * as z from 'zod';

import {
  cardViewGenerateTestTypes,
  type GenerateFacts,
  type TestTypesRunData,
} from '../../render/functional/testTypesRun.js';
import { renderOperation, startOperation } from '../kit/operation.js';
import { projectIdOf, thirdParty } from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { listBaseTestTypes } from './getCatalog.js';
import { listProjectTestTypes } from './getTestTypes.js';
import { FUNCTIONAL_GENERATE_TEST_TYPES } from './meta.generated.js';
import { areasOf } from './suggestTestTypes.js';
import { generateTestTypesAsync, testTypesOperation } from './testTypesRun.js';

const NAME_LIMIT = 120;
const SHOWN = 20;

export const functionalGenerateTestTypes = moduleTool(FUNCTIONAL_GENERATE_TEST_TYPES, {
  title: 'Generate the missing base test types',
  input: {
    include_categories: z
      .string()
      .max(300)
      .optional()
      .describe(
        'Comma-separated categories to generate (e.g. functional, security); default: all.',
      ),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const categories = areasOf(args.include_categories).map((item) => item.toLowerCase());
    const base = (await listBaseTestTypes(ctx)).test_types.filter(
      (type) =>
        type.is_active &&
        (categories.length === 0 || categories.includes(type.category.toLowerCase())),
    );
    const have = new Set(
      (await listProjectTestTypes(ctx, { project_id: projectId })).items.map(
        (item) => item.base_type_id,
      ),
    );
    const missing = base.filter((type) => !have.has(type.id));
    if (missing.length === 0) {
      const data: TestTypesRunData = {
        mode: 'generate',
        count: 0,
        suggestions: [],
        total: 0,
        created: 0,
        skipped: base.length,
        created_types: [],
        rationale: null,
        omitted: 0,
      };
      return { unchanged: data };
    }
    const facts: GenerateFacts = {
      missing: missing.length,
      names: missing.slice(0, SHOWN).map((type) => thirdParty(ctx, type.name, NAME_LIMIT)),
      ...(categories.length === 0
        ? {}
        : { categories: thirdParty(ctx, categories.join(', '), 300) }),
    };
    return { facts };
  },
  cardView: cardViewGenerateTestTypes,
  run: (ctx, args) => {
    const projectId = projectIdOf(ctx, undefined);
    const categories = areasOf(args.include_categories);
    return startOperation(ctx, testTypesOperation, {
      matches: (run) => run.projectId === projectId && run.mode === 'generate',
      async start() {
        const answer = await generateTestTypesAsync(
          ctx,
          { project_id: projectId },
          categories.length === 0 ? {} : { include_categories: categories },
        );
        return {
          id: answer.run_id,
          saved: { projectId, mode: 'generate' as const, startedAt: ctx.clock.now() },
        };
      },
    });
  },
  render: renderOperation(testTypesOperation),
});
