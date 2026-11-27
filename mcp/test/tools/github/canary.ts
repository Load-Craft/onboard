// Sentinel cases of the tools of module github (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import {
  LINKED,
  seedGithubPull,
  seedGithubDiff,
  seedGithubHistory,
  seedGithubStatus,
} from '../../fake-backend/routes/github.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_WORLD_IDS } from '../../fake-backend/worlds/sklep.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

/** A link whose address, branch and history carry credentials only the mask finds. */
function linkSecrets(fake: Fake): void {
  seedGithubStatus(fake.store, SKLEP_IDS.project, {
    ...LINKED,
    repo_url: `https://x-access-token:${SHAPE_CANARY}@github.com/acme/shop-load.git`,
    branch: `token=${HEADER_CANARY}`,
  });
  seedGithubHistory(fake.store, SKLEP_IDS.project, [
    {
      timestamp: '2026-11-25T09:00:00Z',
      operation: 'push',
      status: 'error',
      user: null,
      commit_hash: null,
      files_changed: 0,
      message: `remote: password=${BACKEND_CANARY} rejected`,
    },
  ]);
}

// the composition of the world: the tool finds it in the list of the project, by id or by name
const COMPOSITION = SKLEP_WORLD_IDS.composition;

/** A push preview whose paths and lines carry credentials only the mask finds. */
function diffSecrets(fake: Fake): void {
  // a push is planned only for a project linked to a repository
  seedGithubStatus(fake.store, SKLEP_IDS.project, LINKED);
  seedGithubDiff(fake.store, COMPOSITION, {
    total_additions: 2,
    total_deletions: 0,
    files: [
      {
        path: `conf/token=${HEADER_CANARY}.scala`,
        status: 'new',
        additions: 2,
        deletions: 0,
        diff: `+  .header("Authorization", "Bearer ${SHAPE_CANARY}")\n+  val password = "${BACKEND_CANARY}"`,
      },
    ],
  });
}

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'github_plan_push',
    label: 'file list of a composition',
    stage: 'scenario',
    args: () => ({ composition_id: COMPOSITION }),
    setup: diffSecrets,
  },
  {
    tool: 'github_plan_push',
    label: 'with diffs, format data',
    stage: 'scenario',
    args: () => ({ composition_id: COMPOSITION, diffs: true, format: 'data' }),
    setup: diffSecrets,
  },
  {
    tool: 'github_get_status',
    label: 'link of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: linkSecrets,
  },
  {
    tool: 'github_get_status',
    label: 'with history, format data',
    stage: 'project',
    args: () => ({ include: ['history'], format: 'data' }),
    setup: linkSecrets,
  },
  {
    tool: 'github_get_changes',
    label: 'files changed since the last sync, paths that hold credentials',
    stage: 'project',
    args: () => ({}),
    setup: (fake) => {
      seedGithubStatus(fake.store, SKLEP_IDS.project, LINKED);
      seedGithubPull(fake.store, SKLEP_IDS.project, {
        last_commit: `password=${BACKEND_CANARY}`,
        files_processed: 1,
        changes: [
          {
            file_path: `conf/token=${HEADER_CANARY}/Authorization: Bearer ${SHAPE_CANARY}.scala`,
            change_type: 'added',
            has_content: true,
          },
        ],
      });
    },
  },
  {
    tool: 'github_disconnect',
    label: 'the card of a link whose address and branch carry credentials',
    stage: 'project',
    personSaysYes: true,
    names: true,
    args: () => ({}),
    setup: linkSecrets,
  },
  {
    tool: 'github_disconnect',
    label: 'a link disconnected after the yes of the person, its address and branch tainted',
    stage: 'project',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('github_disconnect', {});
      return {};
    },
    args: () => ({}),
    setup: linkSecrets,
  },
  {
    tool: 'github_push',
    label: 'the card of a push whose link, branch, paths and composition carry credentials',
    stage: 'scenario',
    personSaysYes: true,
    names: true,
    args: () => ({ composition_id: COMPOSITION, message: 'Update scenarios' }),
    setup: (fake) => {
      linkSecrets(fake);
      diffSecrets(fake);
    },
  },
  {
    tool: 'github_push',
    label: 'a push after the yes of the person, the link and the paths tainted',
    stage: 'scenario',
    personSaysYes: true,
    names: true,
    before: async (drive) => {
      await drive.once('github_push', { composition_id: COMPOSITION, message: 'Update scenarios' });
      return {};
    },
    args: () => ({ composition_id: COMPOSITION, message: 'Update scenarios' }),
    setup: (fake) => {
      linkSecrets(fake);
      diffSecrets(fake);
    },
  },
];
