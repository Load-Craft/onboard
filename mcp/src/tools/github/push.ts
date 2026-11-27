// `github_push` (module github): Push a composition's generated Gatling project to the linked
// repository.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Push composition {name} to {repo}", result "pushed: {commit}": the data of the result
// carries the fields.
// Consent: level 3, `external` (docs/consent-card.md). The first call reads the link, the composition and
// the diff a push would make, and makes the card; a repeat with the same arguments asks the person; only
// their yes sends the push. The card names the repository and the branch, whether it is a commit or a
// pull request, the message, the files with the lines each adds and removes, and that the generated
// code leaves LoadCraft; the code itself and the token are never read. Nothing to push (an empty
// diff): no card, nothing sent. A project that is not linked: `github_not_linked`. No undo: the commit
// stays in the repository, the user reverts it there. The check `github.pushed` follows a push.
// Arguments (the catalog's): composition_id (an id or a name; default the one of the workspace),
// message (required), create_pr.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewGithubPush,
  renderGithubPush,
  type PushData,
  type PushFacts,
} from '../../render/github/push.js';
import { createResolver } from '../../resolve/handles.js';
import {
  address,
  callBackend,
  LIMITS,
  thirdParty,
  thirdPartyOrNull,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { idOf, projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { getGithubStatus } from './getStatus.js';
import { ToolError } from '../../errors.js';
import { isLinked } from './link.js';
import { GITHUB_PUSH } from './meta.generated.js';
import { getDiffPreview } from './planPush.js';

/** POST /projects/{project_id}/github/push (REST API v1) */
export function pushToGithub(
  ctx: CallContext,
  path: { readonly project_id: string },
  body: BodyOf<'push_to_github_api_v1_projects__project_id__github_push_post'>,
): Promise<OpOutput<'push_to_github_api_v1_projects__project_id__github_push_post'>> {
  return callBackend(ctx, 'push_to_github_api_v1_projects__project_id__github_push_post', {
    path,
    body,
  });
}

const PATHS_SHOWN = 20;
const MESSAGE_LIMIT = 200;
const COMMIT = /^[0-9a-f]{7,40}$/iu;

export const githubPush = moduleTool(GITHUB_PUSH, {
  title: "Push a composition's generated Gatling project to the repository",
  input: {
    composition_id: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('The composition: its id or name; default: the one of this workspace.'),
    message: z.string().min(1).max(200).describe('The commit message.'),
    create_pr: z
      .boolean()
      .default(false)
      .describe('true: open a pull request instead of committing to the branch.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const status = await getGithubStatus(ctx, { project_id: projectId });
    if (!isLinked(status)) throw new ToolError('github_not_linked', { params: { rule: 'push' } });
    const ref = idOf(ctx, 'composition_id', args.composition_id, 'ids.composition_id');
    const composition = await createResolver(ctx).composition(projectId, ref);
    const preview = await getDiffPreview(
      ctx,
      { project_id: projectId },
      { composite_id: composition.id },
    );
    if (preview.files.length === 0) {
      const data: PushData = {
        pushed: false,
        composition_id: composition.id,
        repo: address(ctx, status.repo_url) ?? '',
        branch: thirdPartyOrNull(ctx, status.branch, LIMITS.label),
        commit: 'none',
        url: null,
        files: 0,
        summary: null,
        create_pr: args.create_pr,
      };
      return { unchanged: data };
    }
    const facts: PushFacts = {
      name: thirdParty(ctx, composition.name, LIMITS.name),
      repo: address(ctx, status.repo_url) ?? '',
      composition_id: composition.id,
      branch: thirdPartyOrNull(ctx, status.branch, LIMITS.label),
      create_pr: args.create_pr,
      message: thirdParty(ctx, args.message, MESSAGE_LIMIT),
      files: preview.files.length,
      additions: preview.total_additions,
      deletions: preview.total_deletions,
      paths: preview.files.slice(0, PATHS_SHOWN).map((file) => ({
        path: thirdParty(ctx, file.path, LIMITS.url),
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
    return { facts };
  },
  cardView: cardViewGithubPush,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    const pushed = await pushToGithub(
      ctx,
      { project_id: projectId },
      { composite_id: facts.composition_id, message: args.message, create_pr: args.create_pr },
    );
    // a commit is shown only when it is hex; anything else is not echoed
    const commit = COMMIT.test(pushed.commit_hash)
      ? pushed.commit_hash.slice(0, 7).toLowerCase()
      : 'unknown';
    const data: PushData = {
      pushed: true,
      composition_id: facts.composition_id,
      repo: facts.repo,
      branch: thirdPartyOrNull(ctx, pushed.branch, LIMITS.label),
      commit,
      // the address of the commit is built from the masked address and the hex hash: a backend's own url
      // is not echoed (a hash in a path is taken for a secret by the mask)
      url: commit === 'unknown' ? null : `${facts.repo.replace(/\/$/u, '')}/commit/${commit}`,
      files: pushed.files_changed,
      summary: thirdPartyOrNull(ctx, pushed.diff_summary, LIMITS.label),
      create_pr: args.create_pr,
    };
    return {
      status: 'done',
      data,
      update: {
        checks: { github: { pushed: { ok: true } } },
        log: { values: { name: facts.name, repo: facts.repo, commit } },
      },
    };
  },
  render: renderGithubPush,
});
