// `project_analyze_setup`: the analysis of the documentation (or of the description) of the bound
// project with the LLM, as a long operation. It runs only when the project has material for it and
// is not analysed and set up yet; a document sent to it becomes the project's documentation. The
// result counts the profile fields it proposes and names those a person should look at; nothing
// is applied until `project_apply_setup`.

import * as z from 'zod';

import { getCompat } from '../api/status.js';
import { maxWaitInput } from '../ops/operation.js';
import { defineTool } from '../registry.js';
import { renderAnalyzeSetup } from '../render/views/projectSetup.js';
import { createResolver } from '../resolve/handles.js';
import { checkDocuments, descriptionInputs, projectDescription } from './project/documents.js';
import { strictFields } from './project/environments.js';
import { analyzeSetup } from './project/setup.js';
/** Said when the call carries a field the tool does not know. */
const INPUT_HINT = 'send only openapi, asyncapi, overview, description and max_wait_s';

const input = strictFields(INPUT_HINT, {
  openapi: z
    .string()
    .optional()
    .describe(
      'OpenAPI document (.json) inside the project directory, e.g. loadcraft/openapi.json.',
    ),
  asyncapi: z
    .string()
    .optional()
    .describe('AsyncAPI document (.json) inside the project directory.'),
  ...descriptionInputs,
  max_wait_s: maxWaitInput('the analysis of the documentation'),
});

export const projectAnalyzeSetup = defineTool({
  name: 'project_analyze_setup',
  title: 'Analyze the setup of a LoadCraft project',
  description:
    'Analyze the project setup with the LLM: imports the docs, then proposes profile fields with ' +
    "confidence. The documentation sent here becomes the project's documentation. " +
    'While the analysis runs the call reports progress and, after max_wait_s, returns a handle ' +
    'for process_wait. Without documentation and description it skips the analysis (the ' +
    'recording of a HAR session fills the profile later); a project already analysed and set ' +
    'up is not analysed again. The result counts the proposed fields, names those the analysis ' +
    'was unsure of and gives the handle for project_apply_setup, which applies them.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const documents = await checkDocuments(ctx, args);
    const description = await projectDescription(args, documents);
    await getCompat(ctx);
    const project = await createResolver(ctx).project();
    return analyzeSetup(ctx, {
      projectId: project.id,
      ...(documents.openapi === undefined ? {} : { openapi: documents.openapi }),
      ...(documents.asyncapi === undefined ? {} : { asyncapi: documents.asyncapi }),
      ...(description === undefined ? {} : { description }),
      maxWaitS: args.max_wait_s,
    });
  },
  render: renderAnalyzeSetup,
});
