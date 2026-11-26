// What the project tools read from the project directory about the application: the overview or
// the plain description (the description of a new project, and the text the setup analysis reads)
// and the API documents the analysis is sent. Every file is checked (inside the project, type,
// size, content) before the tool writes or sends anything.

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import {
  openAllowed,
  readDocumentAllowed,
  readTextAllowed,
  type AllowedFile,
} from '../../workspace/uploads.js';

/** Longest project description (`PROJECT_DESCRIPTION_MAX_LENGTH`, `domain/contracts/projects.py`). */
const DESCRIPTION_MAX = 8000;

/** The inputs that describe the application, shared by the tools that send a description. */
export const descriptionInputs = {
  overview: z
    .string()
    .optional()
    .describe(
      'Markdown overview (.md) of the application; its text becomes the project description ' +
        'and is read by the analysis (at most 8000 characters).',
    ),
  description: z
    .string()
    .optional()
    .describe('Plain description of the application, used when there is no overview file.'),
};

export interface DescriptionArgs {
  readonly overview?: string | undefined;
  readonly description?: string | undefined;
}

export interface DocumentArgs extends DescriptionArgs {
  readonly openapi?: string | undefined;
  readonly asyncapi?: string | undefined;
}

/** Length as the backend counts it (Python `len`: code points, not UTF-16 units). */
const codePoints = (text: string): number => [...text].length;

function checkDescriptionLength(text: string, source: string): string {
  const length = codePoints(text);
  if (length > DESCRIPTION_MAX) {
    throw new ToolError('init_project_description_too_long', {
      params: { source, length, limit: DESCRIPTION_MAX },
    });
  }
  return text;
}

export interface Documents {
  readonly openapi?: AllowedFile;
  readonly asyncapi?: AllowedFile;
  readonly overview?: AllowedFile;
}

/** Every file named in the call is checked (inside the project, type, size) before any write. */
export async function checkDocuments(ctx: ToolContext, args: DocumentArgs): Promise<Documents> {
  const root = ctx.config.workspaceRoot;
  // A plain description is measured first: a too long one stops the call before any file is read.
  if (args.overview === undefined && args.description !== undefined) {
    checkDescriptionLength(args.description.trim(), 'description');
  }
  const documents = {
    ...(args.openapi === undefined
      ? {}
      : { openapi: await openAllowed(root, args.openapi, 'openapi') }),
    ...(args.asyncapi === undefined
      ? {}
      : { asyncapi: await openAllowed(root, args.asyncapi, 'asyncapi') }),
    ...(args.overview === undefined
      ? {}
      : { overview: await openAllowed(root, args.overview, 'overview') }),
  };
  // The content is checked here, before anything is written or sent: a file that is not an API
  // document never leaves the project directory.
  if (documents.openapi !== undefined) await readDocumentAllowed(documents.openapi);
  if (documents.asyncapi !== undefined) await readDocumentAllowed(documents.asyncapi);
  return documents;
}

/**
 * The description of the application: the overview text, else the description given. A new project
 * is created with it and the analysis reads it. Read (and measured) before anything is written: a
 * too long overview stops the call early.
 */
export async function projectDescription(
  args: DescriptionArgs,
  documents: Documents,
): Promise<string | undefined> {
  if (documents.overview !== undefined && args.overview !== undefined) {
    const text = (await readTextAllowed(documents.overview)).trim();
    return text === '' ? undefined : checkDescriptionLength(text, args.overview);
  }
  const text = args.description?.trim() ?? '';
  return text === '' ? undefined : text;
}
