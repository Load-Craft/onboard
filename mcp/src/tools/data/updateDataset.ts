// `data_update_dataset` (module data): Update a dataset's definition or replace its rows from a
// file. Direct edit, only on the user's request; normally use data_ask_copilot.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2 on a card (docs/consent-card.md); a `file` makes it level 3 (`secret_ref`:
// the rows may hold secrets). The first call reads the dataset (and the file) and makes the card; a
// repeat with the same arguments asks the person; only their yes sends anything.
// Operations: the definition is one whole-document PUT of the dataset (the backend takes the whole
// document, so the call re-sends the cells it read; they never reach the model); the rows are one
// PUT of the content (the backend keeps the old rows as an earlier revision; a dataset several
// consumers share is cloned and the answer names the clone).
// Log: args "Update dataset {name}", result "dataset {name} updated".
// Undo (`update.log.undo_args`): rows replaced -> `data_restore_dataset`; only the definition ->
// this tool with the previous name and description (not kept when one holds a secret).
// Arguments (the catalog's): dataset_id (default: the only dataset of the workspace), name,
// description (an empty text clears it), file; at least one of name, description, file.

import { createHash } from 'node:crypto';

import * as z from 'zod';

import type { ToolContext } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { OpOutput } from '../../http/operation.js';
import {
  cardViewUpdateDataset,
  renderUpdateDataset,
  type UpdateDatasetData,
  type UpdateDatasetFacts,
  type UpdatedPart,
  type UpdateFileFacts,
} from '../../render/data/updateDataset.js';
import { csvRows } from '../../security/datasetCells.js';
import { isSecretField } from '../../security/secretFields.js';
import { relativeToWorkspace } from '../../workspace/paths.js';
import { openAllowed, readTextAllowed } from '../../workspace/uploads.js';
import {
  callBackend,
  LIMITS,
  projectIdOf,
  refuseRule,
  thirdParty,
  thirdPartyOrNull,
  type BodyOf,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { separatorOf } from './accountsFile.js';
import { datasetIdOf } from './datasetId.js';
import { DATA_UPDATE_DATASET } from './meta.generated.js';

/** GET /projects/{project_id}/gatling/feeders/{feeder_id} (REST API v1) */
export function getFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
): Promise<OpOutput<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>> {
  return callBackend(
    ctx,
    'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get',
    {
      path,
    },
  );
}

/** PUT /projects/{project_id}/gatling/feeders/{feeder_id} (REST API v1) */
export function updateFeeder(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  body: BodyOf<'update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put'>,
): Promise<OpOutput<'update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put'>> {
  return callBackend(
    ctx,
    'update_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__put',
    { path, body },
  );
}

/** PUT /projects/{project_id}/gatling/feeders/{feeder_id}/content (REST API v1) */
export function replaceFeederContent(
  ctx: CallContext,
  path: { readonly project_id: string; readonly feeder_id: string },
  body: BodyOf<'replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put'>,
): Promise<
  OpOutput<'replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put'>
> {
  return callBackend(
    ctx,
    'replace_feeder_content_api_v1_projects__project_id__gatling_feeders__feeder_id__content_put',
    { path, body },
  );
}

type Feeder = OpOutput<'get_feeder_api_v1_projects__project_id__gatling_feeders__feeder_id__get'>;

const NAME_LIMIT = 120;
const COLUMNS_SHOWN = 20;
/** The types of dataset whose rows are text the call can re-send as they are. */
const EDITABLE_TYPES: readonly string[] = ['csv', 'tsv', 'ssv', 'json'];

/** A rows file read for the card and for the write: what is shown, and what is sent. */
interface PreparedFile {
  readonly facts: UpdateFileFacts;
  readonly fileName: string;
  /** The text as read: sent by the write, never shown. */
  readonly text: string;
}

/** Reads the file, registers every secret cell of it, and describes it by size, hash and header. */
async function prepareFile(ctx: ToolContext, given: string): Promise<PreparedFile> {
  const root = ctx.config.workspaceRoot;
  const file = await openAllowed(root, given, 'accounts');
  const shown = relativeToWorkspace(root, file.path);
  const text = await readTextAllowed(file);
  const [header = [], ...body] = csvRows(text, separatorOf(text));
  const columns = header.map((name) => name.trim()).filter((name) => name !== '');
  const rows = body.filter((row) => row.some((cell) => cell !== ''));
  header.forEach((name, position) => {
    if (!isSecretField(name)) return;
    for (const row of rows) {
      const cell = row[position];
      if (cell !== undefined && cell !== '') ctx.secrets.add(cell);
    }
  });
  return {
    facts: {
      path: thirdParty(ctx, shown, LIMITS.name),
      size: Buffer.byteLength(text, 'utf8'),
      sha256: createHash('sha256').update(text).digest('hex'),
      rows: rows.length,
      columns: columns.slice(0, COLUMNS_SHOWN).map((name) => thirdParty(ctx, name, NAME_LIMIT)),
      columnCount: columns.length,
    },
    fileName: file.name,
    text,
  };
}

/** The dataset of a call, read; refused when its rows are not text the call can re-send. */
async function readDataset(
  ctx: ToolContext,
  datasetId: string | undefined,
): Promise<{ path: { project_id: string; feeder_id: string }; feeder: Feeder }> {
  const path = {
    project_id: projectIdOf(ctx, undefined),
    feeder_id: datasetIdOf(ctx, datasetId),
  };
  const feeder = await getFeeder(ctx, path);
  if (!EDITABLE_TYPES.includes(feeder.feeder_type)) {
    throw new ToolError('data_update_kind', {
      params: { name: thirdParty(ctx, feeder.name, NAME_LIMIT), type: feeder.feeder_type },
    });
  }
  return { path, feeder };
}

/** What the call changes in the definition; each field undefined when it is already as given. */
function definitionChange(
  args: { readonly name?: string | undefined; readonly description?: string | undefined },
  feeder: Feeder,
): { readonly name?: string; readonly description?: string } {
  return {
    ...(args.name !== undefined && args.name !== feeder.name ? { name: args.name } : {}),
    ...(args.description !== undefined && args.description !== (feeder.description ?? '')
      ? { description: args.description }
      : {}),
  };
}

const dataOf = (
  ctx: ToolContext,
  datasetId: string,
  now: {
    readonly name: string;
    readonly description: string | null;
    readonly record_count: number;
    readonly columns: readonly string[];
  },
  rest: Pick<UpdateDatasetData, 'changed' | 'previous' | 'undo'>,
): UpdateDatasetData => ({
  dataset_id: datasetId,
  name: thirdParty(ctx, now.name, NAME_LIMIT),
  description: thirdPartyOrNull(ctx, now.description, LIMITS.sentence),
  rows: now.record_count,
  columns: now.columns.slice(0, COLUMNS_SHOWN).map((name) => thirdParty(ctx, name, NAME_LIMIT)),
  columnCount: now.columns.length,
  ...rest,
});

export const dataUpdateDataset = moduleTool(DATA_UPDATE_DATASET, {
  title: "Update a dataset's definition or replace its rows from a file",
  input: {
    dataset_id: uuidArgument()
      .optional()
      .describe('The dataset; default: the only one in this workspace.'),
    name: z.string().min(1).max(255).optional().describe('The new name.'),
    description: z
      .string()
      .max(500)
      .optional()
      .describe('The new description; an empty text clears it.'),
    file: z
      .string()
      .min(1)
      .max(260)
      .optional()
      .describe(
        "A CSV file of the project directory (relative path, up to 2 MB) whose rows replace the dataset's; the server reads it.",
      ),
  },
  async card(ctx, args) {
    if (args.name === undefined && args.description === undefined && args.file === undefined) {
      refuseRule('update_dataset_at_least_one');
    }
    const { feeder } = await readDataset(ctx, args.dataset_id);
    const change = definitionChange(args, feeder);
    const file = args.file === undefined ? undefined : await prepareFile(ctx, args.file);
    if (change.name === undefined && change.description === undefined && file === undefined) {
      return {
        unchanged: dataOf(
          ctx,
          feeder.id,
          { ...feeder },
          { changed: [], previous: {}, undo: 'none' },
        ),
      };
    }
    const facts: UpdateDatasetFacts = {
      dataset_id: feeder.id,
      name: thirdParty(ctx, feeder.name, NAME_LIMIT),
      ...(change.name === undefined ? {} : { to_name: thirdParty(ctx, change.name, NAME_LIMIT) }),
      ...(change.description === undefined
        ? {}
        : { to_description: thirdParty(ctx, change.description, LIMITS.sentence) }),
      ...(file === undefined ? {} : { file: file.facts }),
    };
    // rows from a file may hold secrets: the escalation of the catalog entry (level 3)
    return file === undefined ? { facts } : { facts, escalation: 'secret_ref' };
  },
  cardView: cardViewUpdateDataset,
  async run(ctx, args, facts) {
    const { path, feeder } = await readDataset(ctx, args.dataset_id);
    const change = definitionChange(args, feeder);
    const file = args.file === undefined ? undefined : await prepareFile(ctx, args.file);
    // the person said yes to the file the card showed: a file that changed since is a new card
    if (file !== undefined && file.facts.sha256 !== facts.file?.sha256) {
      throw new ToolError('data_file_changed', { params: { file: file.facts.path } });
    }
    let now: {
      name: string;
      description: string | null;
      record_count: number;
      columns: readonly string[];
    } = feeder;
    let datasetId = feeder.id;
    const changed: UpdatedPart[] = [];
    const previous: { name?: string; description?: string | null } = {};
    if (change.name !== undefined || change.description !== undefined) {
      const updated = await updateFeeder(ctx, path, {
        name: change.name ?? feeder.name,
        description:
          change.description === undefined ? feeder.description : change.description || null,
        feeder_type: feeder.feeder_type,
        strategy: feeder.strategy,
        content: feeder.content ?? '',
        record_count: feeder.record_count,
        columns: feeder.columns,
        file_name: feeder.file_name,
        separator: feeder.separator,
        feed_records_count: feeder.feed_records_count,
        feeder_options: feeder.feeder_options,
      });
      now = updated;
      if (change.name !== undefined) {
        changed.push('name');
        previous.name = thirdParty(ctx, feeder.name, NAME_LIMIT);
      }
      if (change.description !== undefined) {
        changed.push('description');
        previous.description = thirdPartyOrNull(ctx, feeder.description, LIMITS.sentence);
      }
    }
    if (file !== undefined) {
      const saved = await replaceFeederContent(ctx, path, {
        content: file.text,
        file_name: file.fileName,
      });
      datasetId = saved.id;
      changed.push('rows');
      now = {
        name: saved.name,
        description: now.description,
        record_count: saved.record_count,
        columns: file.facts.columns,
      };
    }
    const undoArgs =
      file !== undefined
        ? { undo_tool: 'data_restore_dataset', dataset_id: datasetId }
        : {
            undo_tool: 'data_update_dataset',
            dataset_id: datasetId,
            ...(change.name === undefined ? {} : { name: feeder.name }),
            ...(change.description === undefined ? {} : { description: feeder.description ?? '' }),
          };
    // a previous value the secret mask would change is not kept: it would reach the state file
    const clean = file !== undefined || !ctx.secrets.containsSecret(undoArgs);
    const data = dataOf(ctx, datasetId, now, {
      changed,
      previous,
      undo: !clean ? 'withheld' : file === undefined ? 'definition' : 'rows',
    });
    return {
      status: 'done',
      data,
      update: {
        log: { values: { name: data.name }, ...(clean ? { undo_args: undoArgs } : {}) },
      },
    };
  },
  render: renderUpdateDataset,
});
