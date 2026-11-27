// The view of `github_disconnect` and of the lines of its consent card: which repository the project is
// linked to, and what the removal touches. The address, the branch and the host are texts of the
// application and its users: they arrive masked and made one line (the tool does it), the address
// without userinfo, query and fragment. No token is read.

import type { Translator } from '../../context.js';
import type { CardView } from '../consentCard.js';

/** What the card froze. `repo` is also the slot of the log entry. */
export interface DisconnectFacts {
  readonly repo: string;
  /** The branch of the link (null when the backend gave none). */
  readonly branch: string | null;
  /** The link syncs by itself (a webhook), which stops with it. */
  readonly auto_sync: boolean;
}

export interface DisconnectData {
  /** False: the project was not linked and nothing was sent. */
  readonly disconnected: boolean;
  readonly repo: string | null;
}

export function cardViewGithubDisconnect(facts: DisconnectFacts, t: Translator): CardView {
  const lines = [
    facts.branch === null
      ? t('github_disconnect.card.link', { repo: facts.repo })
      : t('github_disconnect.card.link_branch', { repo: facts.repo, branch: facts.branch }),
  ];
  if (facts.auto_sync) lines.push(t('github_disconnect.card.auto_sync'));
  lines.push(t('github_disconnect.card.stays'));
  return {
    title: t('github_disconnect.card.title', { repo: facts.repo }),
    lines,
    undo: t('github_disconnect.card.undo'),
  };
}

export function renderGithubDisconnect(data: DisconnectData, t: Translator): string {
  if (!data.disconnected) return t('github_disconnect.none');
  return [
    t('github_disconnect.done', { repo: data.repo ?? '' }),
    t('github_disconnect.again'),
  ].join('\n');
}
