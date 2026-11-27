// `github_plan_push` (module github): Plan a push: the diff a composition's push would produce;
// writes nothing.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view.
// Log: args "{composition_id}", result "{files} files would change": the data of the result carries
// the fields.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { createResolver } from '../../resolve/handles.js';
import { moduleTool } from '../moduleTool.js';
import { renderPlanPush, type PlanPushData } from '../../render/github/planPush.js';
import { idOf, projectIdOf } from '../moduleState.js';
import { requireGithubLink } from './link.js';
import { GITHUB_PLAN_PUSH } from './meta.generated.js';

/** GET /projects/{project_id}/github/diff-preview (REST API v1) */
export function getDiffPreview(
  ctx: CallContext,
  path: { readonly project_id: string },
  query: QueryOf<'get_diff_preview_api_v1_projects__project_id__github_diff_preview_get'>,
): Promise<OpOutput<'get_diff_preview_api_v1_projects__project_id__github_diff_preview_get'>> {
  return callBackend(ctx, 'get_diff_preview_api_v1_projects__project_id__github_diff_preview_get', {
    path,
    query,
  });
}

type Preview = OpOutput<'get_diff_preview_api_v1_projects__project_id__github_diff_preview_get'>;

const FILES_SHOWN = 50;
const DIFF_FILES = 10;
const DIFF_LINES = 40;
const PATH_LIMIT = 200;
const LINE_LIMIT = 200;

/**
 * One line of a diff, masked and made one line: its marker (`+`, `-`, ` `) and the indentation of the
 * code after it are kept (tabs as two spaces), `content()` would fold them into one space.
 */
function lineOf(ctx: CallContext, line: string): string {
  const [, marker = '', indent = '', rest = ''] = /^([-+ ]?)([ \t]*)(.*)$/su.exec(line) ?? [];
  const code = rest === '' ? '' : content(ctx, rest, LINE_LIMIT);
  return `${marker}${indent.replaceAll('\t', '  ').slice(0, 40)}${code}`;
}

/** The data of the preview: paths and, with `diffs`, the first lines of the first files, masked. */
function dataOf(
  ctx: CallContext,
  compositionId: string,
  preview: Preview,
  diffs: boolean,
): PlanPushData {
  const files = preview.files.slice(0, FILES_SHOWN).map((file, index) => {
    const base = {
      path: content(ctx, file.path, PATH_LIMIT),
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    };
    if (!diffs || index >= DIFF_FILES) return base;
    const lines = file.diff
      .split(/\r?\n/u)
      .filter((line) => line !== '')
      .slice(0, DIFF_LINES)
      .map((line) => lineOf(ctx, line));
    return { ...base, diff: lines };
  });
  return {
    composition_id: compositionId,
    files: preview.files.length,
    additions: preview.total_additions,
    deletions: preview.total_deletions,
    shown: files.length,
    file_list: files,
  };
}

export const githubPlanPush = moduleTool(GITHUB_PLAN_PUSH, {
  title: 'Plan a push',
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
    diffs: z
      .boolean()
      .default(false)
      .describe(
        'true: a short diff per file (up to 10 files, 40 lines each); without it, the file list.',
      ),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    await requireGithubLink(ctx, projectId, 'push');
    // an id or a name, like the other composition tools: one list read, not_found and ambiguous masked
    const ref = idOf(ctx, 'composition_id', args.composition_id, 'ids.composition_id');
    const compositionId = (await createResolver(ctx).composition(projectId, ref)).id;
    const preview = await getDiffPreview(
      ctx,
      { project_id: projectId },
      { composite_id: compositionId },
    );
    return { status: 'done', data: dataOf(ctx, compositionId, preview, args.diffs) };
  },
  render: renderPlanPush,
});
