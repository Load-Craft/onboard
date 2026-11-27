// `data_delete` (module data): Delete a dataset; force=true also deletes one still in use.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 3, `delete` (docs/consent-card.md). The first call reads what goes and makes
// the card; a repeat with the same arguments asks the person; only their yes sends the DELETE.
// One dataset per card, never a default from the state (a deletion names its target).
// A dataset that scenarios or compositions still read is refused before any card
// (`data_dataset_in_use`, with their names) unless `force` is true; then the card names them.
// The card holds the name, the row count and who reads it: never a cell.
// Log: args "Delete dataset: {names}", result "{count} datasets deleted". No undo (permanent).
// Arguments (the catalog's): dataset_id, force.

import * as z from 'zod';

import type { OpOutput } from '../../http/operation.js';
import { ToolError } from '../../errors.js';
import {
  cardViewDataDelete,
  renderDataDelete,
  type DataDeleteData,
  type DataDeleteFacts,
} from '../../render/data/delete.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  settleAll,
  thirdParty,
  type CallContext,
  type QueryOf,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { getFeeder } from './updateDataset.js';
import { DATA_DELETE } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/feeders/{feeder_id}/used-in (REST API v1) */
export function getFeederUsedIn(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<
  OpOutput<'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get'>
> {
  return callBackend(
    ctx,
    'get_feeder_used_in_api_v1_projects__project_id__gatling_feeders__feeder_id__used_in_get',
    { path },
  );
}

const SHOWN = 20;

/** DELETE /projects/{project_id}/gatling/feeders/{feeder_id} (REST API v1) */
export function deleteFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  query?: QueryOf<'delete_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__delete'>,
): Promise<
  OpOutput<'delete_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__delete'>
> {
  return callBackend(
    ctx,
    'delete_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__delete',
    { path, ...(query === undefined ? {} : { query }) },
  );
}

export const dataDelete = moduleTool(DATA_DELETE, {
  title: 'Delete a dataset',
  input: {
    dataset_id: uuidArgument().describe('The dataset to delete.'),
    force: z
      .boolean()
      .default(false)
      .describe('Also delete it when scenarios or compositions still use it.'),
  },
  async card(ctx, args) {
    const projectId = projectIdOf(ctx, undefined);
    const id = args.dataset_id.toLowerCase();
    const path = { project_id: projectId, feeder_id: id };
    const feeder = await getFeeder(ctx, path);
    const names = thirdParty(ctx, feeder.name, LIMITS.name);
    const [used] = await settleAll([
      getFeederUsedIn(ctx, path).then(
        (value) => value,
        () => null,
      ),
    ]);
    const consumers = used === null ? null : used.consumers;
    const users =
      consumers === null
        ? null
        : consumers.slice(0, SHOWN).map((consumer) => thirdParty(ctx, consumer.name, LIMITS.name));
    if (consumers !== null && consumers.length > 0 && !args.force) {
      const refused = new ToolError('data_dataset_in_use', {
        params: {
          name: names,
          count: consumers.length,
          users: (users ?? []).join(', ') + (consumers.length > SHOWN ? ', …' : ''),
        },
      });
      throw refused;
    }
    const facts: DataDeleteFacts = {
      names,
      id,
      rows: feeder.record_count,
      force: args.force,
      users,
      ...(consumers === null ? {} : { users_count: consumers.length }),
    };
    return { facts };
  },
  cardView: cardViewDataDelete,
  async run(ctx, args, facts) {
    const projectId = projectIdOf(ctx, undefined);
    await deleteFeeder(
      ctx,
      { project_id: projectId, feeder_id: facts.id },
      facts.force ? { force: true } : {},
    );
    const data: DataDeleteData = {
      id: facts.id,
      names: facts.names,
      count: 1,
      forced: facts.force,
    };
    return {
      status: 'done',
      data,
      update: {
        remove: { dataset_ids: [facts.id] },
        log: { values: { names: facts.names, count: 1 } },
      },
    };
  },
  render: renderDataDelete,
});
