// Sentinel cases of the tools of module traffic (test/security/canaryCases.ts finds them here): a
// secret in an answer of the backend never reaches the model, the log or the state file.

import type { Case } from '../../security/canaryCases.js';
import {
  SAMPLE_RECIPE,
  sampleSnapshot,
  seedTrafficRecipe,
  seedTrafficSnapshots,
  seedTrafficTokens,
} from '../../fake-backend/routes/traffic.js';
import type { Fake } from '../../fake-backend/server.js';
import { SKLEP_IDS } from '../../golden/index.js';
import { BACKEND_CANARY, HEADER_CANARY, SHAPE_CANARY } from '../../helpers/canary.js';

/** A recipe and a token whose texts carry credentials only the mask finds. */
function recipeSecrets(fake: Fake): void {
  seedTrafficRecipe(fake.store, SKLEP_IDS.project, {
    ...SAMPLE_RECIPE,
    curl: `curl -H "Authorization: Bearer ${SHAPE_CANARY}" https://lc.example.test/push`,
    warning: `password=${BACKEND_CANARY}`,
    excluded_windows: [
      {
        start: '2026-11-20T10:00:00Z',
        end: '2026-11-20T10:30:00Z',
        reason: `api_key=${HEADER_CANARY}`,
      },
    ],
    scripts: [
      {
        name: 'push.sh',
        purpose: `Pushes with token=${HEADER_CANARY}`,
        script: `TOKEN = "${BACKEND_CANARY}"\n`,
        command: `sh push.sh --password ${BACKEND_CANARY}`,
      },
    ],
  });
  seedTrafficTokens(fake.store, SKLEP_IDS.project, [
    {
      id: '0d0c7034-0005-4000-8000-000000000001',
      label: `secret=${SHAPE_CANARY}`,
      prefix: 'lcp_ab12',
      created_at: '2026-11-21T08:00:00Z',
      created_by: 'user-1',
      last_used_at: null,
      last_outcome: null,
      last_refusal_codes: [],
      revoked_at: null,
    },
  ]);
}

/** A snapshot whose label, timezone, source and checksum carry credentials only the mask finds. */
function snapshotSecrets(fake: Fake): void {
  seedTrafficSnapshots(fake.store, SKLEP_IDS.project, [
    sampleSnapshot({
      token_label: `token=${HEADER_CANARY}`,
      timezone: `password=${BACKEND_CANARY}`,
      entry_route: `GET /reset?token=${SHAPE_CANARY}`,
      source: { kind: `Bearer ${SHAPE_CANARY}`, query: `x{api_key="${HEADER_CANARY}"}` },
      excluded_windows: [
        {
          start: '2026-11-26T05:00:00Z',
          end: '2026-11-26T06:00:00Z',
          reason: `password=${BACKEND_CANARY}`,
        },
      ],
      series: [
        {
          route: `GET /a?session=${SHAPE_CANARY}`,
          points: [{ bucket_start: '2026-11-26T00:00:00Z', count: 1, quality: 'ok' }],
        },
      ],
    }),
  ]);
}

const SNAPSHOT = sampleSnapshot().id;

export const CANARY_CASES: readonly Case[] = [
  {
    tool: 'traffic_list_snapshots',
    label: 'snapshots of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: snapshotSecrets,
  },
  {
    tool: 'traffic_list_snapshots',
    label: 'format data with the format sample',
    stage: 'project',
    args: () => ({ format: 'data', include: ['format_sample'] }),
    setup: snapshotSecrets,
  },
  {
    tool: 'traffic_get_push_setup',
    label: 'recipe and tokens of the bound project',
    stage: 'project',
    args: () => ({}),
    setup: recipeSecrets,
  },
  {
    tool: 'traffic_get_push_setup',
    label: 'format data',
    stage: 'project',
    args: () => ({ format: 'data' }),
    setup: recipeSecrets,
  },
  {
    tool: 'traffic_get_snapshot',
    label: 'one snapshot, summary',
    stage: 'project',
    args: () => ({ snapshot_id: SNAPSHOT }),
    setup: snapshotSecrets,
  },
  {
    tool: 'traffic_get_snapshot',
    label: 'one snapshot, points, format data',
    stage: 'project',
    args: () => ({ snapshot_id: SNAPSHOT, series: 'points', format: 'data' }),
    setup: snapshotSecrets,
  },
  {
    tool: 'traffic_delete',
    label: 'the card of a snapshot whose label and texts carry credentials',
    stage: 'project',
    personSaysYes: true,
    args: () => ({ kind: 'snapshot', item_id: SNAPSHOT }),
    setup: snapshotSecrets,
  },
  {
    tool: 'traffic_delete',
    label: 'the card of a token whose label carries a credential',
    stage: 'project',
    personSaysYes: true,
    args: () => ({ kind: 'token', item_id: '0d0c7034-0005-4000-8000-000000000001' }),
    setup: recipeSecrets,
  },
  {
    tool: 'traffic_delete',
    label: 'the deletion of a snapshot after the yes of the person',
    stage: 'project',
    personSaysYes: true,
    before: async (drive) => {
      await drive.once('traffic_delete', { kind: 'snapshot', item_id: SNAPSHOT });
      return {};
    },
    args: () => ({ kind: 'snapshot', item_id: SNAPSHOT }),
    setup: snapshotSecrets,
  },
];
