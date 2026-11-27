// `data_create_dataset`: one dataset of the project, from one source. `file` with `scenario` and
// `slot` loads a CSV file of the workspace in the slot's columns (accounts a customer already has:
// the server reads the file, passwords never pass through the model; a dataset of the same name gets
// the file as a new revision). `rules` makes a dataset from the column rules of a data hub's
// suggestion, without a model. `scenario` and `slot` alone make the rows of a slot of plain data from
// its columns. Nothing is sent to the target system. The first call returns a consent card and saves
// nothing; the repeat with the card's token saves the dataset. The pin to the slot is a call of its
// own (`data_set_bindings`), which the result names with its exact map.

import * as z from 'zod/v4';

import {
  generateDatasetFromRules,
  RULE_ROWS_DEFAULT,
  type Dataset,
  type SavedDataset,
} from '../api/data.js';
import { getCompat } from '../api/status.js';
import { CATALOG } from '../catalog.generated.js';
import { cardGate, type CardGate } from '../consent/confirmCard.js';
import type { ToolContext } from '../context.js';
import { ToolError } from '../errors.js';
import type { DoneOutcome } from '../outcome.js';
import { defineTool } from '../registry.js';
import {
  renderCreateCard,
  renderCreated,
  type CreateCardView,
  type CreatedView,
  type DatasetSource,
} from '../render/views/data.js';
import { createResolver } from '../resolve/handles.js';
import { prepareAccountsFile, saveAccountsFile } from './data/accountsFile.js';
import { readTarget } from './data/readPlan.js';
import { makeSlotData, planSlotData } from './data/slotData.js';
import { namedPicks, pinStep, readsSlot, type StepBase } from './data/steps.js';
import { rulesProblem, suggestedRules } from './data/suggestion.js';
import { projectArgs, projectField, resolveTarget } from './data/target.js';

/** The card of this tool. */
const SCOPE = 'data_create_dataset';
const CONSENT = CATALOG.data_create_dataset.consent;
/**
 * No yes covers another call yet: the consent of the catalog's group (`consent.scope.group`) waits
 * for the consent channel of the server, so every call shows its own card.
 */
const GROUP = {};
/** A file of accounts is a file with secrets: the catalog asks for its own card every time. */
const FILE_GATE = { own: CONSENT.escalate_to_3.includes('secret_ref') };
const ROWS_MAX = 20_000;

const input = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Name of the new dataset; default: the suggestion's name, or the slot's label for a file. " +
        'The rows of a slot are always named "<slot> data" by LoadCraft.',
    ),
  scenario: z
    .string()
    .optional()
    .describe(
      'Composition or scenario whose slot the dataset is for (with file, or alone with slot).',
    ),
  slot: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Key of the data slot whose columns the dataset gets, as the data plan shows it.'),
  file: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'CSV file of the project directory (path relative to it, .csv up to 2 MB) whose header holds ' +
        'the columns of the slot; the server reads it, the passwords never pass through you.',
    ),
  rules: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Handle of column rules a data_suggest_actions result printed (data_suggestion:<id>/<n>).',
    ),
  rows: z
    .number()
    .int()
    .min(1)
    .max(ROWS_MAX)
    .optional()
    .describe(
      'Rows to make from rules or from the slot; default: what the suggestion or the slot needs.',
    ),
  project: projectField,
  confirm: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Leave it out in the first call: the answer is the consent card for the user. Only after ' +
        'the user said yes to that card, repeat the call with the same arguments and the token ' +
        'the card printed.',
    ),
});

type Args = z.infer<typeof input>;
type Data = CreatedView | CreateCardView;
const isCard = (data: Data): data is CreateCardView => 'needsConfirmation' in data;

/** How the pin names the new dataset: by name, unless another dataset of the project has it. */
const refOf = (datasets: readonly Dataset[], saved: SavedDataset): string =>
  datasets.some((item) => item.name === saved.name && item.id !== saved.id) ? saved.id : saved.name;

function card(
  gate: Extract<CardGate, { write: false }>,
  view: Omit<CreateCardView, 'needsConfirmation' | 'confirm' | 'renewed'>,
): DoneOutcome<Data> {
  const data: CreateCardView = {
    needsConfirmation: true,
    confirm: gate.token,
    ...(gate.renewed === undefined ? {} : { renewed: gate.renewed }),
    ...view,
  };
  return { status: 'done', inert: true, data };
}

type Source = 'file' | 'rules' | 'slot';

/** The one source the call names; anything else is refused before a read. */
function sourceOf(args: Args): Source {
  const withTarget = args.scenario !== undefined && args.slot !== undefined;
  if (args.rules !== undefined) {
    if (args.file === undefined && args.scenario === undefined && args.slot === undefined) {
      return 'rules';
    }
  } else if (args.file !== undefined) {
    if (withTarget && args.rows === undefined) return 'file';
  } else if (withTarget) return 'slot';
  throw new ToolError('dataset_source');
}

async function fromRules(ctx: ToolContext, args: Args, handle: string): Promise<DoneOutcome<Data>> {
  await getCompat(ctx);
  const { id: projectId } = await createResolver(ctx).project(args.project?.trim() ?? '');
  const rules = suggestedRules(ctx, projectId, handle);
  const read = await readTarget(ctx, projectId, rules.target);
  const problem = rulesProblem(rules, read);
  if (problem !== undefined) {
    throw new ToolError('suggestion_rules_unusable', {
      params: {
        handle: rules.handle,
        reason: ctx.t(`error.suggestion_rules_unusable.reason.${problem}`),
      },
    });
  }
  const name = args.name ?? rules.name;
  if (read.datasets.some((dataset) => dataset.name === name)) {
    throw new ToolError('dataset_name_taken', { params: { name } });
  }
  const rows = args.rows ?? rules.rows;
  const pinned = rules.slot !== null && readsSlot(read, rules.slot) ? rules.slot : null;
  const gate = await cardGate(
    ctx,
    SCOPE,
    projectId,
    { source: 'rules', handle: rules.handle, name, rows },
    args.confirm,
    GROUP,
  );
  if (!gate.write) {
    return card(gate, {
      name,
      source: { kind: 'rules', handle: rules.handle },
      slot: pinned === null ? null : { slot: pinned, target: rules.target.name },
      rows: rows ?? RULE_ROWS_DEFAULT,
      revision: false,
    });
  }
  const created = await generateDatasetFromRules(ctx, projectId, {
    name,
    columns: rules.columns,
    rows,
  });
  const base: StepBase = { scenario: rules.target.name, ...projectArgs(args.project) };
  const data: CreatedView = {
    source: 'rules',
    name: created.name,
    rows: created.rows ?? rows ?? RULE_ROWS_DEFAULT,
    slot: pinned,
    ...(pinned === null
      ? {}
      : { next: pinStep(base, namedPicks(read), pinned, refOf(read.datasets, created)) }),
  };
  return { status: 'done', data };
}

async function fromFile(
  ctx: ToolContext,
  args: Args & { scenario: string; slot: string; file: string },
): Promise<DoneOutcome<Data>> {
  const { projectId, target } = await resolveTarget(ctx, args);
  const prepared = await prepareAccountsFile(ctx, {
    projectId,
    target,
    slot: args.slot,
    path: args.file,
    ...(args.name === undefined ? {} : { name: args.name }),
  });
  const source: DatasetSource = {
    kind: 'file',
    file: prepared.file,
    size: prepared.size,
    sha256: prepared.sha256,
    rows: prepared.rows,
  };
  const gate = await cardGate(
    ctx,
    SCOPE,
    projectId,
    {
      source: 'file',
      target: target.id,
      slot: args.slot,
      file: prepared.file,
      sha256: prepared.sha256,
      name: prepared.name,
      revision: prepared.existing?.id ?? null,
    },
    args.confirm,
    FILE_GATE,
  );
  if (!gate.write) {
    return card(gate, {
      name: prepared.name,
      source,
      slot: { slot: args.slot, target: target.name },
      rows: null,
      revision: prepared.existing !== undefined,
    });
  }
  const saved = await saveAccountsFile(ctx, projectId, prepared);
  const base: StepBase = { scenario: args.scenario, ...projectArgs(args.project) };
  const data: CreatedView = {
    source: 'file',
    name: saved.name,
    rows: prepared.rows,
    slot: args.slot,
    file: prepared.file,
    revision: prepared.existing !== undefined,
    masked: true,
    next: pinStep(
      base,
      namedPicks(prepared.slots),
      args.slot,
      refOf(prepared.slots.datasets, saved),
    ),
  };
  return { status: 'done', data };
}

async function fromSlot(
  ctx: ToolContext,
  args: Args & { scenario: string; slot: string },
): Promise<DoneOutcome<Data>> {
  const { projectId, target } = await resolveTarget(ctx, args);
  const request = {
    projectId,
    target,
    slot: args.slot,
    ...(args.rows === undefined ? {} : { rows: args.rows }),
  };
  const plan = await planSlotData(ctx, request);
  const gate = await cardGate(
    ctx,
    SCOPE,
    projectId,
    { source: 'slot', target: target.id, slot: args.slot, rows: plan.rows },
    args.confirm,
    GROUP,
  );
  if (!gate.write) {
    return card(gate, {
      name: plan.name,
      source: plan.fresh ? { kind: 'slot', fresh: true } : { kind: 'slot' },
      slot: { slot: args.slot, target: target.name },
      rows: plan.rows ?? RULE_ROWS_DEFAULT,
      revision: plan.slots.datasets.some((dataset) => dataset.name === plan.name),
    });
  }
  const saved = await makeSlotData(ctx, request, plan);
  const base: StepBase = { scenario: args.scenario, ...projectArgs(args.project) };
  const data: CreatedView = {
    source: 'slot',
    name: saved.name,
    rows: saved.rows ?? plan.rows ?? RULE_ROWS_DEFAULT,
    slot: args.slot,
    next: pinStep(base, namedPicks(plan.slots), args.slot, refOf(plan.slots.datasets, saved)),
  };
  return { status: 'done', data };
}

export const dataCreateDataset = defineTool<typeof input, Data>({
  name: 'data_create_dataset',
  title: 'Create a dataset',
  description:
    'Create a dataset from a local file, from column rules or from the columns of a slot. Sources: `file` with ' +
    "`scenario` and `slot` (a CSV of the project directory in the slot's columns, e.g. accounts the " +
    'customer already has; the server reads it, passwords never pass through you; a dataset of ' +
    'the same name gets it as a new revision), `rules` (a handle data_suggest_actions printed) or ' +
    "`scenario` and `slot` alone (rows from the slot's columns; LoadCraft may use its model and " +
    "the project's budget for datasets). Sends nothing to the target. The first call saves " +
    'nothing and returns a consent card; after the user says yes, repeat the call with confirm ' +
    'set to its token; every call shows its own card. The result names the data_set_bindings ' +
    'call that pins the dataset.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  // names and texts of LoadCraft's answers in the data are shown masked (FIX-76)
  maskNames: true,
  async run(ctx, args) {
    const source = sourceOf(args);
    const { scenario, slot, file, rules } = args;
    if (source === 'rules' && rules !== undefined) return fromRules(ctx, args, rules);
    if (scenario === undefined || slot === undefined) throw new ToolError('dataset_source');
    if (source === 'file' && file !== undefined)
      return fromFile(ctx, { ...args, scenario, slot, file });
    return fromSlot(ctx, { ...args, scenario, slot });
  },
  render: (data, t) => (isCard(data) ? renderCreateCard(data, t) : renderCreated(data, t)),
});
