// `github_get_status` (module github): Get the project's GitHub link status; include=history adds
// recent pushes and pulls.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view.
// Log: args "", result "linked: {linked}": the data carries `linked`; the check
// `steps.github.connected` follows it.
// The address of the repository can hold a token as userinfo: userinfo, query and fragment are dropped
// before `content()`; branch, hostname and the messages of the history pass `content()`; a commit is
// shown only when it is hex (docs/tools/github/get-status.md).

import * as z from 'zod';

import { LoadcraftApiError } from '../../http/apiError.js';
import { settleAll, type OpOutput } from '../../http/operation.js';
import {
  renderGetStatus,
  type GithubStatusData,
  type SyncEntry,
} from '../../render/github/getStatus.js';
import { callBackend, content, type CallContext, type QueryOf } from '../moduleCall.js';
import { projectIdOf } from '../moduleState.js';
import { moduleTool } from '../moduleTool.js';
import { GITHUB_GET_STATUS } from './meta.generated.js';

/** GET /projects/{project_id}/github/status (REST API v1) */
export function getGithubStatus(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'get_github_status_api_v1_projects__project_id__github_status_get'>> {
  return callBackend(ctx, 'get_github_status_api_v1_projects__project_id__github_status_get', {
    path,
  });
}

/** GET /projects/{project_id}/github/history (REST API v1) */
export function getSyncHistory(
  ctx: CallContext,
  path: { readonly project_id: string },
  query?: QueryOf<'get_sync_history_api_v1_projects__project_id__github_history_get'>,
): Promise<OpOutput<'get_sync_history_api_v1_projects__project_id__github_history_get'>> {
  return callBackend(ctx, 'get_sync_history_api_v1_projects__project_id__github_history_get', {
    path,
    ...(query === undefined ? {} : { query }),
  });
}

type Status = OpOutput<'get_github_status_api_v1_projects__project_id__github_status_get'>;
type History = OpOutput<'get_sync_history_api_v1_projects__project_id__github_history_get'>;

const NAME_LIMIT = 120;
const URL_LIMIT = 200;
const MESSAGE_LIMIT = 200;
const COMMIT = /^[0-9a-f]{7,40}$/iu;

/** An address without userinfo, query and fragment, masked; a text that is no URL is masked whole. */
function addressOf(ctx: CallContext, raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return content(ctx, `${url.origin}${path}`, URL_LIMIT);
  } catch {
    return content(ctx, raw.split(/[?#]/u)[0]?.replace(/^[^@/]*@/u, '') ?? '', URL_LIMIT);
  }
}

const commitOf = (hash: string | null | undefined): string | null =>
  hash != null && COMMIT.test(hash) ? hash.slice(0, 7).toLowerCase() : null;

const textOf = (ctx: CallContext, value: string | null | undefined, max: number): string | null =>
  value == null || value.trim() === '' ? null : content(ctx, value, max);

async function readHistory(
  ctx: CallContext,
  path: { readonly project_id: string },
  limit: number,
): Promise<History | null> {
  try {
    return await getSyncHistory(ctx, path, { limit });
  } catch (error) {
    if (error instanceof LoadcraftApiError) return null;
    throw error;
  }
}

function entryOf(ctx: CallContext, entry: History['entries'][number]): SyncEntry {
  return {
    at: entry.timestamp,
    operation: entry.operation,
    ok: entry.status === 'success',
    files: entry.files_changed,
    commit: commitOf(entry.commit_hash),
    message: textOf(ctx, entry.message, MESSAGE_LIMIT),
  };
}

function dataOf(
  ctx: CallContext,
  projectId: string,
  status: Status,
  history: History | null,
  wantsHistory: boolean,
): GithubStatusData {
  const repository =
    textOf(ctx, status.repo_url, URL_LIMIT) === null ? null : addressOf(ctx, status.repo_url ?? '');
  const linked = status.connected && repository !== null && status.sync_status !== 'not_configured';
  return {
    project_id: projectId,
    linked,
    connected: status.connected,
    repository,
    branch: textOf(ctx, status.branch, NAME_LIMIT),
    hostname: textOf(ctx, status.hostname, NAME_LIMIT),
    sync_status: status.sync_status,
    auto_sync: status.auto_sync_enabled === true,
    webhook_secret: status.has_webhook_secret === true,
    last_synced_at: status.last_synced_at ?? null,
    last_commit: commitOf(status.last_synced_commit),
    history_state: !wantsHistory ? 'none' : history === null ? 'unavailable' : 'read',
    history:
      history === null
        ? null
        : { total: history.total, entries: history.entries.map((entry) => entryOf(ctx, entry)) },
  };
}

export const githubGetStatus = moduleTool(GITHUB_GET_STATUS, {
  title: "Get the project's GitHub link status",
  input: {
    include: z
      .array(z.enum(['history']))
      .max(1)
      .optional()
      .describe('"history": the latest syncs.'),
    history_limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('With include history: how many syncs (1-50).'),
  },
  async run(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const path = { project_id: projectId };
    const wantsHistory = args.include?.includes('history') === true;
    const [status, history] = await settleAll([
      getGithubStatus(ctx, path),
      wantsHistory ? readHistory(ctx, path, args.history_limit) : Promise.resolve(null),
    ]);
    const data = dataOf(ctx, projectId, status, history, wantsHistory);
    return {
      status: 'done',
      data,
      update: { checks: { github: { connected: { ok: data.linked } } } },
    };
  },
  render: renderGetStatus,
});
