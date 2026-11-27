// Texts of the tools of module github, English: the key set of github.pl.ts. A key starts with the
// name of a tool of the module (`github_list.`) or with `github.` for a text its tools share.

import type { Entry } from './core.js';

export const githubEn = {
  'github_get_status.linked': 'GitHub link of the project: linked',
  'github_get_status.signed_in': 'GitHub link of the project: signed in, no repository chosen yet',
  'github_get_status.not_linked':
    'GitHub link of the project: not linked; a repository is linked in the LoadCraft application, not by this plugin.',
  'github_get_status.repository': 'repository: {url}{where}',
  'github_get_status.branch_host': ' (branch {branch} on {host})',
  'github_get_status.branch': ' (branch {branch})',
  'github_get_status.sync': 'sync: {status}{last}; {auto}; {secret}',
  'github_get_status.last': ', last {at}',
  'github_get_status.last_commit': ', last {at} at commit {commit}',
  'github_get_status.status.not_configured': 'not configured',
  'github_get_status.status.idle': 'idle',
  'github_get_status.status.syncing': 'syncing',
  'github_get_status.status.error': 'error',
  'github_get_status.auto_on': 'auto-sync on',
  'github_get_status.auto_off': 'auto-sync off',
  'github_get_status.secret_set': 'webhook secret set',
  'github_get_status.secret_unset': 'no webhook secret',
  'github_get_status.history': 'recent syncs ({shown} of {total}):',
  'github_get_status.history_none': 'recent syncs: none yet',
  'github_get_status.history_unavailable': 'recent syncs: unavailable',
  'github_get_status.op.push': 'push',
  'github_get_status.op.pull': 'pull',
  'github_get_status.ok': 'ok',
  'github_get_status.failed': 'failed',
  'github_get_status.files': { one: '{count} file', other: '{count} files' },
  'github_get_status.commit': 'commit {commit}',
  'github_plan_push.header':
    'Push plan of composition {composition}: {files} files would change {changes}',
  'github_plan_push.nothing': 'Push plan of composition {composition}: nothing would change.',
  'github_plan_push.status.new': 'new',
  'github_plan_push.status.modified': 'modified',
  'github_plan_push.more': 'showing the first {shown} of {total} files',
  'error.github_not_linked.message':
    'The project is not linked to a GitHub repository, so {reason}.',
  'error.github_not_linked.rule.push': 'there is nothing to push to',
  'error.github_not_linked.rule.read': 'there is no repository to read changes from',
  'error.github_not_linked.hint':
    "Tell the user: a repository is linked in the LoadCraft application (the project's GitHub settings), not by this plugin. github_get_status shows the link. Do not retry until it is linked.",
  // github_get_changes
  'github_get_changes.header': {
    one: '{count} file changed since the last sync:',
    other: '{count} files changed since the last sync:',
  },
  'github_get_changes.none': 'No file changed in the repository since the last sync.',
  'github_get_changes.more': '  … {shown} of {total} files listed',
  'github_get_changes.marker':
    'The sync marker now stands at commit {commit}: a second call returns nothing until the repository changes again.',
  'github_get_changes.change.added': 'added',
  'github_get_changes.change.modified': 'modified',
  'github_get_changes.change.deleted': 'deleted',
  'github_get_changes.change.other': 'changed',
  // github_disconnect
  'github_disconnect.card.title': 'Disconnect the project from {repo}',
  'github_disconnect.card.link': 'removes the link of the project to the repository {repo}',
  'github_disconnect.card.link_branch':
    'removes the link of the project to the repository {repo} (branch {branch})',
  'github_disconnect.card.auto_sync': 'the automatic sync of the link stops',
  'github_disconnect.card.stays':
    'the repository and its files are not touched; the flows and scenarios in LoadCraft stay',
  'github_disconnect.card.undo':
    'the user links it again in the LoadCraft application; a token is needed, none is kept',
  'github_disconnect.none':
    'The project is not linked to a GitHub repository; nothing to disconnect.',
  'github_disconnect.done': 'Disconnected the project from {repo}.',
  'github_disconnect.again':
    'To link it again the user goes to the LoadCraft application (a token is needed; none is kept).',
  // github_push
  'github_push.no_branch': 'the default branch',
  'github_push.card.title': 'Push composition "{name}" to {repo}',
  'github_push.card.commit': 'a commit on branch {branch} with the message "{message}"',
  'github_push.card.pr':
    'opens a pull request instead of a commit on branch {branch}; message "{message}"',
  'github_push.card.files': {
    one: '{count} file changes (+{additions} −{deletions}):',
    other: '{count} files change (+{additions} −{deletions}):',
  },
  'github_push.card.more': '  … {shown} of {total} files listed',
  'github_push.card.leaves': 'the generated test code is sent to {repo}, outside LoadCraft',
  'github_push.card.undo':
    'not from here: the commit stays in the repository, the user reverts it there',
  'github_push.nothing':
    'Nothing to push: composition {composition} has no file that differs from the repository.',
  'github_push.done': {
    one: 'Pushed {count} file to {repo} (branch {branch}): commit {commit}.',
    other: 'Pushed {count} files to {repo} (branch {branch}): commit {commit}.',
  },
  'github_push.done_pr': {
    one: 'Opened a pull request in {repo} with {count} file (branch {branch}): commit {commit}.',
    other: 'Opened a pull request in {repo} with {count} files (branch {branch}): commit {commit}.',
  },
  'github_push.revert':
    'The plugin does not undo it: to take it back, the user reverts the commit in the repository.',
} as const satisfies Readonly<Record<string, Entry>>;
