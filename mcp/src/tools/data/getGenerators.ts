// `data_get_generators` (module data): Get the column generators for dataset rules, or guesses for
// given column names.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `columns` the tool lists the generators (GET); with them (comma-separated, at most 50)
// it asks what the data hub would make of each column (POST guess). Nothing is created and no model
// is called. Every label, hint, refusal, name and pattern passes `content`; the values of a list rule
// are only counted. The backend's `credential` meaning is reported as `secret` (semantics.ts).
// Log: args "", result "{count} generators": the data of the result carries the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGenerators,
  type GeneratorItem,
  type GeneratorsData,
  type GuessedItem,
} from '../../render/data/getGenerators.js';
import { ToolError } from '../../errors.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { guessedSemantics } from './semantics.js';
import { DATA_GET_GENERATORS } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/feeders/generators (REST API v1) */
export function listRecipeGenerators(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<
  OpOutput<'list_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_get'>
> {
  return callBackend(
    ctx,
    'list_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_get',
    { path },
  );
}

/** POST /projects/{project_id}/gatling/feeders/generators/guess (REST API v1) */
export function guessRecipeGenerators(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'guess_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_guess_post'>,
): Promise<
  OpOutput<'guess_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_guess_post'>
> {
  return callBackend(
    ctx,
    'guess_recipe_generators_api_v1_projects__project_id__gatling_feeders_generators_guess_post',
    { path, body },
  );
}

const MAX_COLUMNS = 50;
const CHOICES_SHOWN = 20;
const TEXT_LIMIT = 300;
const NAME_LIMIT = 100;

export const dataGetGenerators = moduleTool(DATA_GET_GENERATORS, {
  title: 'Get the column generators for dataset rules',
  input: {
    columns: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe(
        'Column names to guess generators for, comma-separated (at most 50); without it, the list of all generators.',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    if (args.columns === undefined) {
      const answer = await listRecipeGenerators(ctx, path);
      const generators: GeneratorItem[] = answer.generators.map((entry) => ({
        label: content(ctx, entry.label, TEXT_LIMIT),
        hint: content(ctx, entry.hint, TEXT_LIMIT),
        params: entry.params,
        choices_total: (entry.choices ?? []).length,
        choices: (entry.choices ?? []).slice(0, CHOICES_SHOWN).map((choice) => ({
          label: content(ctx, choice.label, NAME_LIMIT),
          value: content(ctx, choice.value, NAME_LIMIT),
          default: choice.default,
        })),
      }));
      const data: GeneratorsData = {
        mode: 'list',
        project_id: projectId,
        count: generators.length,
        generators,
        columns: [],
      };
      return { status: 'done', data };
    }
    const names = args.columns
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
    if (names.length === 0 || names.length > MAX_COLUMNS) {
      throw new ToolError('invalid', {
        params: { detail: `give 1 to ${String(MAX_COLUMNS)} column names, separated by commas` },
      });
    }
    const answer = await guessRecipeGenerators(ctx, path, {
      columns: names.map((name) => ({ name })),
    });
    const columns: GuessedItem[] = answer.columns.map((column) => ({
      name: content(ctx, column.name, NAME_LIMIT),
      semantics: guessedSemantics(column.semantics),
      declarable_as_data: column.declarable_as_data,
      refusal: column.refusal === null ? null : content(ctx, column.refusal, TEXT_LIMIT),
      generator:
        column.rule === null
          ? null
          : {
              hint: content(ctx, column.rule.generation_hint, NAME_LIMIT),
              pattern:
                column.rule.pattern == null ? null : content(ctx, column.rule.pattern, NAME_LIMIT),
              min: column.rule.min_value ?? null,
              max: column.rule.max_value ?? null,
              values: (column.rule.enum_values ?? []).length,
              networks: column.rule.card_networks ?? [],
              ref_column:
                column.rule.ref_column == null
                  ? null
                  : content(ctx, column.rule.ref_column, NAME_LIMIT),
            },
    }));
    const data: GeneratorsData = {
      mode: 'guess',
      project_id: projectId,
      count: columns.length,
      generators: [],
      columns,
    };
    return { status: 'done', data };
  },
  render: renderGenerators,
});
