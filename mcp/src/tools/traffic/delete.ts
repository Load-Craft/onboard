// `traffic_delete` (module traffic): Delete traffic snapshots or revoke push tokens (kind + item_id).
// Runs using a snapshot are not checked.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 3, `delete` (docs/consent-card.md). The first call reads what goes and makes
// the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// One object per card: `kind` says what `item_id` is, never a default from the state. A snapshot
// card names its window, what it holds and who pushed it; a token card its label and its use (the
// token itself is never read: the list gives a label and a prefix, only the label is shown). A token
// that is revoked already changes nothing: no card, an answer saying so. The catalog says runs that
// use a snapshot are not checked: the card says it too. A deleted snapshot that is the choice for
// runs of the workspace (`choices.run.traffic_snapshot_id`) is dropped from the choice. No undo.
// Log: args "Delete {kind}: {names}", result "{count} {kind} deleted".
// Arguments (the catalog's): kind (snapshot, token), item_id.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewTrafficDelete,
  renderTrafficDelete,
  type TrafficDeleteData,
  type TrafficDeleteFacts,
} from '../../render/traffic/delete.js';
import { span } from '../../render/traffic/time.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { ToolError } from '../../errors.js';
import { listIngestTokens } from './getPushSetup.js';
import { getSnapshot } from './getSnapshot.js';
import { TRAFFIC_DELETE } from './meta.generated.js';

/** DELETE /projects/{project_id}/production-traffic/snapshots/{snapshot_id} (REST API v1) */
export function deleteSnapshot(
  ctx: CallContext,
  path: { readonly project_id: string; readonly snapshot_id: string },
): Promise<
  OpOutput<'delete_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_snapshot_api_v1_projects__project_id__production_traffic_snapshots__snapshot_id__delete',
    { path },
  );
}

/** DELETE /projects/{project_id}/production-traffic/tokens/{token_id} (REST API v1) */
export function revokeIngestToken(
  ctx: CallContext,
  path: { readonly project_id: string; readonly token_id: string },
): Promise<
  OpOutput<'revoke_ingest_token_api_v1_projects__project_id__production_traffic_tokens__token_id__delete'>
> {
  return callBackend(
    ctx,
    'revoke_ingest_token_api_v1_projects__project_id__production_traffic_tokens__token_id__delete',
    { path },
  );
}

export const trafficDelete = moduleTool(TRAFFIC_DELETE, {
  title: 'Delete traffic snapshots or revoke push tokens',
  input: {
    kind: z
      .enum(['snapshot', 'token'])
      .describe('What to delete: a traffic snapshot or a push token (revoked).'),
    item_id: uuidArgument().describe('The snapshot or token to delete.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const id = args.item_id.toLowerCase();
    if (args.kind === 'snapshot') {
      const snapshot = await getSnapshot(ctx, { project_id: projectId, snapshot_id: id });
      const facts: TrafficDeleteFacts = {
        kind: 'snapshot',
        names: span(snapshot.window_start, snapshot.window_end),
        id,
        window_start: snapshot.window_start,
        window_end: snapshot.window_end,
        rows: snapshot.rows_count,
        routes: snapshot.routes_count,
        sender:
          snapshot.token_label === null || snapshot.token_label === undefined
            ? null
            : thirdParty(ctx, snapshot.token_label, LIMITS.name),
        chosen: ctx.state.process()?.choices.run.traffic_snapshot_id === id,
      };
      return { facts };
    }
    const listed = await listIngestTokens(ctx, { project_id: projectId });
    const token = (listed.tokens ?? []).find((one) => one.id.toLowerCase() === id);
    if (token === undefined) {
      throw new ToolError('not_found', { params: { available: '' } });
    }
    const names = thirdParty(ctx, token.label, LIMITS.name);
    if (token.revoked_at !== null && token.revoked_at !== undefined) {
      const data: TrafficDeleteData = { kind: 'token', id, names, count: 0 };
      return { unchanged: data };
    }
    const facts: TrafficDeleteFacts = {
      kind: 'token',
      names,
      id,
      created: token.created_at,
      last_used: token.last_used_at ?? null,
    };
    return { facts };
  },
  cardView: cardViewTrafficDelete,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    if (facts.kind === 'snapshot') {
      await deleteSnapshot(ctx, { project_id: projectId, snapshot_id: facts.id });
    } else {
      await revokeIngestToken(ctx, { project_id: projectId, token_id: facts.id });
    }
    const data: TrafficDeleteData = {
      kind: facts.kind,
      id: facts.id,
      names: facts.names,
      count: 1,
    };
    const forget =
      facts.kind === 'snapshot' &&
      ctx.state.process()?.choices.run.traffic_snapshot_id === facts.id;
    return {
      status: 'done',
      data,
      update: {
        ...(forget ? { choices: { run: { traffic_snapshot_id: undefined } } } : {}),
        log: { values: { names: facts.names, kind: facts.kind, count: 1 } },
      },
    };
  },
  render: renderTrafficDelete,
});
