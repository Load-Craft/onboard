// The view of `github_push` and of the lines of its consent card: which composition goes to which
// repository and branch, as a commit or a pull request, with which message, and which files change.
// The paths, the branch, the address and the message are texts of the application and of a model: they
// arrive masked and made one line (the tool does it); the code itself is never shown. No token is read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';
import { num } from '../primitives.js';

/** What the card froze. `name` and `repo` are also the slots of the log entry. */
export interface PushFacts {
  readonly name: string;
  readonly repo: string;
  readonly composition_id: string;
  /** The branch of the link (null when the backend gave none). */
  readonly branch: string | null;
  /** A pull request, not a commit on the branch. */
  readonly create_pr: boolean;
  readonly message: string;
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
  /** At most 20 paths with the lines each adds and removes. */
  readonly paths: readonly {
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
}

export interface PushData {
  /** False: the composition has nothing to push and nothing was sent. */
  readonly pushed: boolean;
  readonly composition_id: string;
  readonly repo: string;
  readonly branch: string | null;
  /** The short hash of the commit (`commit` is also the slot of the log entry); `none` when nothing was pushed, `unknown` when the backend gave none. */
  readonly commit: string;
  /** The address of the commit, built from the masked address of the repository and the hash. */
  readonly url: string | null;
  readonly files: number;
  readonly summary: string | null;
  readonly create_pr: boolean;
}

export function cardViewGithubPush(facts: PushFacts, t: Translator): CardView {
  const lines = [
    t(facts.create_pr ? 'github_push.card.pr' : 'github_push.card.commit', {
      branch: facts.branch ?? t('github_push.no_branch'),
      message: facts.message,
    }),
    t.plural('github_push.card.files', facts.files, {
      count: num(facts.files, t.locale),
      additions: num(facts.additions, t.locale),
      deletions: num(facts.deletions, t.locale),
    }),
    ...facts.paths.map(
      (file) =>
        `  ${file.path} (+${num(file.additions, t.locale)} −${num(file.deletions, t.locale)})`,
    ),
    ...(facts.files > facts.paths.length
      ? [t('github_push.card.more', { shown: facts.paths.length, total: facts.files })]
      : []),
    t('github_push.card.leaves', { repo: facts.repo }),
  ];
  return {
    title: t('github_push.card.title', { name: facts.name, repo: facts.repo }),
    lines,
    undo: t('github_push.card.undo'),
  };
}

export function renderGithubPush(data: PushData, t: Translator): string {
  if (!data.pushed) return t('github_push.nothing', { composition: data.composition_id });
  return [
    t.plural(data.create_pr ? 'github_push.done_pr' : 'github_push.done', data.files, {
      count: num(data.files, t.locale),
      repo: data.repo,
      branch: data.branch ?? t('github_push.no_branch'),
      commit: data.commit,
    }),
    ...(data.summary === null ? [] : [data.summary]),
    ...(data.url === null ? [] : [data.url]),
    t('github_push.revert'),
  ].join('\n');
}
