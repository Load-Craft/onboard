// `github_disconnect` (module github): Disconnect the project from its GitHub repository.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Without `run` and `render` the tool is registered but not offered to the client, and a call
// answers `not_implemented` (docs/module-tools.md: how to write it).
// Log: args "Disconnect the project from {repo}", result "disconnected": the data of the result
// carries the fields.
// Consent: level 3, `delete` (docs/consent-card.md). The first call reads the link and makes the card; a
// repeat with the same arguments asks the person; only their yes sends the disconnection. A project
// that is not linked: nothing to ask and nothing sent. Nothing is sent while an operation of this
// workspace still runs on the project (`delete_busy`). The card names the repository (the address
// without userinfo, query and fragment) and the branch; no token is read. No undo is kept: linking
// again needs a token, which the log does not keep (`github_connect`).

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewGithubDisconnect,
  renderGithubDisconnect,
  type DisconnectData,
  type DisconnectFacts,
} from '../../render/github/disconnect.js';
import { busy, liveOperation } from '../delete/checks.js';
import {
  address,
  callBackend,
  LIMITS,
  projectIdOf,
  thirdPartyOrNull,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool } from '../moduleTool.js';
import { getGithubStatus } from './getStatus.js';
import { GITHUB_DISCONNECT } from './meta.generated.js';

/** POST /projects/{project_id}/github/disconnect (REST API v1) */
export function disconnectGithub(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'disconnect_github_api_v1_projects__project_id__github_disconnect_post'>> {
  return callBackend(ctx, 'disconnect_github_api_v1_projects__project_id__github_disconnect_post', {
    path,
  });
}

export const githubDisconnect = moduleTool(GITHUB_DISCONNECT, {
  title: 'Disconnect the project from its GitHub repository',
  input: {},
  async card(ctx) {
    const projectId = projectIdOf(ctx, undefined);
    const status = await getGithubStatus(ctx, { project_id: projectId });
    const repo = address(ctx, status.repo_url);
    if (!status.connected || status.sync_status === 'not_configured' || repo === null) {
      const data: DisconnectData = { disconnected: false, repo: null };
      return { unchanged: data };
    }
    const operation = liveOperation(ctx, projectId);
    if (operation !== undefined) throw busy(operation, `repository ${repo}`);
    const facts: DisconnectFacts = {
      repo,
      branch: thirdPartyOrNull(ctx, status.branch, LIMITS.label),
      auto_sync: status.auto_sync_enabled === true,
    };
    return { facts };
  },
  cardView: cardViewGithubDisconnect,
  async run(ctx, _args, facts) {
    await disconnectGithub(ctx, { project_id: projectIdOf(ctx, undefined) });
    const data: DisconnectData = { disconnected: true, repo: facts.repo };
    return {
      status: 'done',
      data,
      update: {
        // the link is gone: the checks that stood on it no longer hold (`steps.github.connected`, `pushed`)
        checks: { github: { connected: { ok: false }, pushed: { ok: null } } },
        log: { values: { repo: facts.repo } },
      },
    };
  },
  render: renderGithubDisconnect,
});
