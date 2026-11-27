// `github_get_changes` (module github): Get repository changes since the last sync: the file list
// only. Moves the sync marker: a second call returns nothing.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. The backend lists changed files only (nothing is imported into LoadCraft) and advances the
// project's last synced commit to the head of the branch, so the call is a read with one effect: it
// is not repeated by the tool, and the view says so. The link of the project is read first, as for
// `github_plan_push`: a project with no repository is refused with `github_not_linked` and the
// marker is not touched. File paths come from the repository, so they pass `content()`; no content of
// a file is read, and the commit is shown only when it is hex.
// Log: args "", result "{files} files changed since the last sync": the data carries `files`.
// Arguments (the catalog's): `limit`, how many files the data lists.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  renderGetChanges,
  type ChangeType,
  type GetChangesData,
} from '../../render/github/getChanges.js';
import { callBackend, content, type BodyOf, type CallContext } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { requireGithubLink } from './link.js';
import { moduleTool } from '../moduleTool.js';
import { GITHUB_GET_CHANGES } from './meta.generated.js';

/** POST /projects/{project_id}/github/pull (REST API v1) */
export function pullFromGithub(
  ctx: CallContext,
  path: { readonly project_id: string },
  body?: BodyOf<'pull_from_github_api_v1_projects__project_id__github_pull_post'>,
): Promise<OpOutput<'pull_from_github_api_v1_projects__project_id__github_pull_post'>> {
  return callBackend(ctx, 'pull_from_github_api_v1_projects__project_id__github_pull_post', {
    path,
    ...(body === undefined ? {} : { body }),
  });
}

const PATH_LIMIT = 200;
const COMMIT = /^[0-9a-f]{7,40}$/iu;

/** The kind of change as the contract names it; a word it does not know is `other`. */
function changeOf(type: string): ChangeType {
  return type === 'added' || type === 'modified' || type === 'deleted' ? type : 'other';
}

export const githubGetChanges = moduleTool(GITHUB_GET_CHANGES, {
  title: 'Get repository changes since the last sync',
  input: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .describe('How many changed files to list (1-200); the count is always the whole number.'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    await requireGithubLink(ctx, projectId, 'read');
    const answer = await pullFromGithub(ctx, { project_id: projectId });
    const changes = answer.changes.slice(0, args.limit).map((file) => ({
      path: content(ctx, file.file_path, PATH_LIMIT),
      change: changeOf(file.change_type),
      hasContent: file.has_content,
    }));
    const data: GetChangesData = {
      files: answer.changes.length,
      shown: changes.length,
      limit: args.limit,
      processed: answer.files_processed,
      lastCommit: COMMIT.test(answer.last_commit)
        ? answer.last_commit.slice(0, 7).toLowerCase()
        : null,
      changes,
    };
    return { status: 'done', data };
  },
  render: renderGetChanges,
});
