// The view of `github_get_status`: whether the project is linked to a repository, which one and
// how its sync stands, optionally the latest syncs (push or pull, whether it worked, files, commit).

import type { Translator } from '../../context.js';
import { num } from '../primitives.js';
import { minute } from '../traffic/time.js';

export interface SyncEntry {
  readonly at: string;
  readonly operation: 'push' | 'pull';
  readonly ok: boolean;
  readonly files: number;
  /** The first 7 characters of the commit; null when there is none. */
  readonly commit: string | null;
  readonly message: string | null;
}

export interface GithubStatusData {
  readonly project_id: string;
  /** A record exists, a repository is chosen and the sync is configured (the log slot `{linked}`). */
  readonly linked: boolean;
  /** A record exists, also while the sign-in is pending. */
  readonly connected: boolean;
  readonly repository: string | null;
  readonly branch: string | null;
  readonly hostname: string | null;
  readonly sync_status: 'not_configured' | 'idle' | 'syncing' | 'error';
  readonly auto_sync: boolean;
  /** Whether a webhook secret is set; never its value. */
  readonly webhook_secret: boolean;
  readonly last_synced_at: string | null;
  readonly last_commit: string | null;
  readonly history_state: 'none' | 'read' | 'unavailable';
  readonly history: { readonly total: number; readonly entries: readonly SyncEntry[] } | null;
}

function repositoryLine(data: GithubStatusData, t: Translator): string | null {
  if (data.repository === null) return null;
  const where =
    data.branch !== null && data.hostname !== null
      ? t('github_get_status.branch_host', { branch: data.branch, host: data.hostname })
      : data.branch !== null
        ? t('github_get_status.branch', { branch: data.branch })
        : '';
  return t('github_get_status.repository', { url: data.repository, where });
}

function syncLine(data: GithubStatusData, t: Translator): string {
  const last =
    data.last_synced_at === null
      ? ''
      : data.last_commit === null
        ? t('github_get_status.last', { at: minute(data.last_synced_at) })
        : t('github_get_status.last_commit', {
            at: minute(data.last_synced_at),
            commit: data.last_commit,
          });
  return t('github_get_status.sync', {
    status: t(`github_get_status.status.${data.sync_status}`),
    last,
    auto: t(data.auto_sync ? 'github_get_status.auto_on' : 'github_get_status.auto_off'),
    secret: t(
      data.webhook_secret ? 'github_get_status.secret_set' : 'github_get_status.secret_unset',
    ),
  });
}

function entryLine(entry: SyncEntry, t: Translator): string {
  const detail = !entry.ok
    ? ''
    : `: ${t.plural('github_get_status.files', entry.files, { count: num(entry.files, t.locale) })}${
        entry.commit === null ? '' : `, ${t('github_get_status.commit', { commit: entry.commit })}`
      }`;
  const message = entry.message === null ? '' : ` — ${entry.message}`;
  return `  ${minute(entry.at)} ${t(`github_get_status.op.${entry.operation}`)} ${t(
    entry.ok ? 'github_get_status.ok' : 'github_get_status.failed',
  )}${detail}${message}`;
}

export function renderGetStatus(data: GithubStatusData, t: Translator): string {
  if (!data.connected) return t('github_get_status.not_linked');
  const lines = [
    t(data.repository === null ? 'github_get_status.signed_in' : 'github_get_status.linked'),
  ];
  const repository = repositoryLine(data, t);
  if (repository !== null) lines.push(repository);
  lines.push(syncLine(data, t));
  if (data.history_state === 'unavailable') lines.push(t('github_get_status.history_unavailable'));
  else if (data.history !== null) {
    if (data.history.entries.length === 0) lines.push(t('github_get_status.history_none'));
    else {
      lines.push(
        t('github_get_status.history', {
          shown: data.history.entries.length,
          total: data.history.total,
        }),
      );
      for (const entry of data.history.entries) lines.push(entryLine(entry, t));
    }
  }
  return lines.join('\n');
}
