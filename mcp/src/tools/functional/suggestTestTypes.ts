// `functional_suggest_test_types` (module functional): Suggest custom test types from the project's API
// docs (LLM); nothing is saved until accepted.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the card and the start. Kind
// `process`, level 2, costly (docs/consent-card.md, docs/long-operation.md): call 1 makes the card (the docs,
// the focus, the cost) and sends no request; the repeat with the same arguments asks the person; only their
// yes starts the run, once, and follows it for the time of one call (the kind is `testTypesOperation`).
// Nothing is saved, so there is nothing to undo. The start takes no docs id: the backend reads the active
// docs, so a `docs_id` that is not the active docs the state knows is refused before any question.
// The suggestions come back masked with what `functional_save_test_types` needs to accept one.
// Log: args "Suggest test types from the API docs", result "{count} test types proposed".
// Arguments (the catalog's): docs_id (required), focus_areas (comma-separated).

import * as z from 'zod';

import {
  cardViewSuggestTestTypes,
  type SuggestFacts,
} from '../../render/functional/testTypesRun.js';
import { renderOperation, startOperation } from '../kit/operation.js';
import { projectIdOf, refuseRule, thirdParty } from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_SUGGEST_TEST_TYPES } from './meta.generated.js';
import { suggestTestTypesAsync, testTypesOperation } from './testTypesRun.js';

/** The areas of a comma-separated text: trimmed, without empties and repeats, at most 20. */
export function areasOf(given: string | undefined): string[] {
  if (given === undefined) return [];
  return [
    ...new Set(
      given
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
  ].slice(0, 20);
}

export const functionalSuggestTestTypes = moduleTool(FUNCTIONAL_SUGGEST_TEST_TYPES, {
  title: "Suggest custom test types from the project's API docs",
  input: {
    docs_id: uuidArgument().describe('The API docs to read (project_get_docs lists them).'),
    focus_areas: z
      .string()
      .max(300)
      .optional()
      .describe('Comma-separated areas to prioritize (e.g. security, limits); default: none.'),
  },
  card(ctx, args) {
    const docsId = args.docs_id.toLowerCase();
    const active = ctx.state.process()?.ids.docs_id;
    if (active !== undefined && active.toLowerCase() !== docsId) {
      refuseRule('suggest_docs_not_active');
    }
    const areas = areasOf(args.focus_areas);
    const facts: SuggestFacts = {
      docs_id: docsId,
      ...(areas.length === 0 ? {} : { focus: thirdParty(ctx, areas.join(', '), 300) }),
    };
    return Promise.resolve({ facts });
  },
  cardView: cardViewSuggestTestTypes,
  run: (ctx, args) => {
    const projectId = projectIdOf(ctx, undefined);
    const areas = areasOf(args.focus_areas);
    return startOperation(ctx, testTypesOperation, {
      matches: (run) => run.projectId === projectId && run.mode === 'suggest',
      async start() {
        const answer = await suggestTestTypesAsync(
          ctx,
          { project_id: projectId },
          areas.length === 0 ? {} : { focus_areas: areas },
        );
        return {
          id: answer.run_id,
          saved: { projectId, mode: 'suggest' as const, startedAt: ctx.clock.now() },
        };
      },
    });
  },
  render: renderOperation(testTypesOperation),
});
