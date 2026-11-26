// Views of the data tools: the data plan (one row per slot, then what must happen before the test
// and the calls that do it), the data hub's suggestion, the consent cards and what a write did.

import type { Translator } from '../../context.js';
import { slotRef } from '../slotRef.js';
import type { CardRenewalReason } from '../../consent/confirmCard.js';
import type { ProposedAction, SlotStatus } from '../../api/data.js';
import { hangingRows, inline, VIEW_WIDTH, num, visibleWidth, wrap } from '../primitives.js';

export interface PlanColumn {
  readonly name: string;
  /** What the slot's spec adds to the name: card networks, a numeric range. */
  readonly qualifier: string | null;
}

export interface PlanSlot {
  readonly slot: string;
  readonly label: string;
  readonly state: SlotStatus;
  readonly columns: PlanColumn[];
  /** Generators the slot's rows come from, for columns the spec does not already describe. */
  readonly sources: string[];
  /** Every consumer takes its own rows. */
  readonly exclusive: boolean;
  /** Scenarios of the target that read the slot; empty for a single scenario. */
  readonly usedBy: string[];
}

export type PlanFix =
  | {
      readonly kind: 'accounts_must_exist';
      readonly slot: string;
      readonly label: string;
      /** Name of the dataset the accounts belong to; absent when nothing names it. */
      readonly dataset?: string;
      readonly environment: string;
    }
  | {
      readonly kind: 'dataset_missing' | 'data_missing' | 'data_generate' | SlotFault;
      readonly slot: string;
      readonly label: string;
    }
  | {
      /** A slot of plain data no tool can make the rows of: a file with its columns can fill it. */
      readonly kind: 'data_from_file';
      readonly slot: string;
      readonly label: string;
      readonly reason: 'no_source' | 'secret_columns' | 'refused';
      readonly columns: string[];
      /** What the backend said when it refused to generate the rows. */
      readonly detail?: string;
      /** The data hub's reason (a model's words), when it said one. */
      readonly hub?: string;
    };

/** Statuses that block the test besides a missing dataset. */
export type SlotFault = 'column_mismatch' | 'stale_pin' | 'empty_column' | 'parse_error';

export interface DataPlanView {
  readonly target: { readonly kind: 'scenario' | 'composition'; readonly name: string };
  /** Environment the accounts must exist on; null when the project has no default and none was named. */
  readonly environment: string | null;
  readonly slots: PlanSlot[];
  readonly fixes: PlanFix[];
  /** No slot is missing, mismatched, stale, empty or unreadable. */
  readonly ready: boolean;
  readonly proposed: ProposedAction[];
  /** The calls that fill the slots, in their order, with their exact arguments. */
  readonly steps: PlanStep[];
}

/** A call a data result names as the way on; its arguments are to be passed as they are. */
export interface PlanStep {
  readonly tool: 'data_set_bindings' | 'data_create_dataset' | 'data_check_readiness';
  readonly args: Readonly<Record<string, unknown>>;
}

/** The most of a backend's refusal a fix or a skipped line quotes. */
const DETAIL_LIMIT = 200;

const GAP = '  ';
/** The detail column starts one space further than the state column ends. */
const STATE_PAD = ' ';
const SEPARATOR = ' · ';
const CONTINUATION = '  ';

function columnText(column: PlanColumn): string {
  const name = inline(column.name);
  return column.qualifier === null ? name : `${name} ${inline(column.qualifier)}`;
}

/** Plain names are listed with commas; a name with a qualifier (which has commas) with dots. */
function columnsText(columns: readonly PlanColumn[]): string {
  const qualified = columns.some((column) => column.qualifier !== null);
  return columns.map(columnText).join(qualified ? SEPARATOR : ', ');
}

function detailParts(slot: PlanSlot, t: Translator): string[] {
  return [
    ...(slot.columns.length === 0 ? [] : [columnsText(slot.columns)]),
    ...slot.sources.map((source) => inline(source)),
    ...(slot.exclusive ? [t('data.exclusive')] : []),
  ];
}

/** The row's detail; every part is kept, the scenarios last. */
function detailText(slot: PlanSlot, t: Translator): string {
  const users = slot.usedBy.map((name) => inline(name)).join(', ');
  return [...detailParts(slot, t), ...(slot.usedBy.length === 0 ? [] : [users])].join(SEPARATOR);
}

/** Names of a label that lists columns (`a & b & c`) shown before `+N more`. */
const LABEL_NAMES = 3;
/** A label longer than this is cut; the slot key next to it is not. */
const LABEL_LIMIT = 36;

/**
 * The label of a slot as the plan shows it. The backend joins the column names of a generated
 * slot with ` & `; a long list is cut to its first names and a count, the full list stays in the
 * row's detail. The key after it is whole.
 */
function slotName(slot: { readonly label: string; readonly slot: string }, t: Translator): string {
  const names = inline(slot.label).split(' & ');
  const label =
    names.length > LABEL_NAMES + 1
      ? `${names.slice(0, LABEL_NAMES).join(' & ')} ${t('data.label.more', {
          count: names.length - LABEL_NAMES,
        })}`
      : slot.label;
  return slotRef(label, slot.slot, t, LABEL_LIMIT);
}

function slotLines(slots: readonly PlanSlot[], t: Translator): string[] {
  return hangingRows(
    slots.map((slot) => ({
      cells: [slotName(slot, t), t(`data.state.${slot.state}`) + STATE_PAD],
      detail: detailText(slot, t),
    })),
    { gap: GAP.length, width: VIEW_WIDTH },
  );
}

function fixText(fix: PlanFix, t: Translator): string {
  if (fix.kind === 'accounts_must_exist') {
    return t('data.fix.accounts_must_exist', {
      dataset: inline(fix.dataset ?? fix.label),
      environment: inline(fix.environment),
    });
  }
  if (fix.kind === 'data_from_file') {
    return t('data.fix.data_from_file', {
      label: slotName(fix, t),
      reason: t(`data.fix.data_from_file.${fix.reason}`, {
        detail: inline(fix.detail ?? '', DETAIL_LIMIT),
      }),
      columns: fix.columns.map((column) => inline(column)).join(', '),
      hub:
        fix.hub === undefined
          ? ''
          : t('data.fix.data_from_file.hub', { reply: inline(fix.hub, DETAIL_LIMIT) }),
    });
  }
  return t(`data.fix.${fix.kind}`, { label: slotName(fix, t) });
}

/** The last lines of a plan: that the test can start, or what must be fixed first. */
function planClosing(data: DataPlanView, t: Translator): string[] {
  return data.ready
    ? [t(data.slots.length === 0 ? 'data.ready.noSlots' : 'data.ready')]
    : wrap(
        t.plural('data.fixes', data.fixes.length, {
          fixes: data.fixes.map((fix) => fixText(fix, t)).join('; '),
        }),
        VIEW_WIDTH,
        // Continuation lines are indented: a line at column 0 that starts with `↗` reads as a link.
        CONTINUATION.length,
      );
}

/**
 * The pieces of a call as a model types it: the tool, then each argument as JSON. A piece is never
 * cut, so a line break falls only between two arguments or two entries of a map, never inside a
 * value (a dataset name keeps its spaces).
 */
/** A value as JSON, every text in it on one line first (a name from the backend is a model's input). */
function jsonOf(value: unknown): string {
  const clean = (item: unknown): unknown =>
    typeof item === 'string'
      ? inline(item)
      : Array.isArray(item)
        ? item.map(clean)
        : typeof item === 'object' && item !== null
          ? Object.fromEntries(
              Object.entries(item).map(([key, inner]) => [inline(key), clean(inner)]),
            )
          : item;
  return JSON.stringify(clean(value)) ?? 'null';
}

function callPieces(step: PlanStep): string[] {
  const args = Object.entries(step.args);
  const pieces: string[] = [inline(step.tool)];
  args.forEach(([key, value], index) => {
    const comma = index < args.length - 1 ? ',' : '';
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        pieces.push(`${inline(key)}: {}${comma}`);
        return;
      }
      entries.forEach(([inner, item], at) => {
        const head = at === 0 ? `${inline(key)}: {` : '';
        const tail = at === entries.length - 1 ? `}${comma}` : ',';
        pieces.push(`${head}${jsonOf(inner)}: ${jsonOf(item)}${tail}`);
      });
      return;
    }
    pieces.push(`${inline(key)}: ${jsonOf(value)}${comma}`);
  });
  return pieces;
}

/** The call on lines of at most `width`, the first after `lead`, the others indented by `indent`. */
function callLines(step: PlanStep, lead: string, width: number, indent: number): string[] {
  const lines: string[] = [];
  let current = lead;
  let room = width;
  for (const piece of callPieces(step)) {
    const joined =
      current === lead || current.endsWith(' ') ? current + piece : `${current} ${piece}`;
    if (visibleWidth(joined) <= room || current === lead || current.trim() === '') {
      current = joined;
      continue;
    }
    lines.push(current);
    current = ' '.repeat(indent) + piece;
    room = width;
  }
  lines.push(current);
  return lines;
}

/** A call as one line, for a structured view or a log. */
export const stepText = (step: PlanStep): string => callPieces(step).join(' ');

/** The calls of a plan, numbered, each wrapped under its number. */
function stepLines(steps: readonly PlanStep[], header: string): string[] {
  if (steps.length === 0) return [];
  return [
    header,
    ...steps.flatMap((step, index) => {
      const number = `${String(index + 1)}. `;
      return callLines(step, number, VIEW_WIDTH, number.length);
    }),
  ];
}

/** The line that names the next call. */
export function nextLines(step: PlanStep | undefined, t: Translator): string[] {
  if (step === undefined) return [];
  const lead = t('data.steps.next', { call: '' });
  return callLines(step, lead, VIEW_WIDTH, CONTINUATION.length);
}

function planLines(data: DataPlanView, t: Translator): string[] {
  const header =
    data.slots.length === 0 ? t('data.title.none') : t.plural('data.title', data.slots.length);
  return [
    header,
    ...(data.slots.length === 0 ? [] : slotLines(data.slots, t)),
    ...planClosing(data, t),
  ];
}

export function renderDataPlan(data: DataPlanView, t: Translator): string {
  return [
    ...planLines(data, t),
    ...stepLines(data.steps, t.plural('data.steps', data.steps.length)),
  ].join('\n');
}

/** What `data_create_accounts` did. Passwords are not part of it, only the fact they are masked. */
export interface ProvisionView {
  readonly slot: string;
  /** Name of the dataset the accounts were appended to. */
  readonly dataset: string;
  /** Accounts the call was asked for: the dataset should end with this many from this provisioning. */
  readonly requested: number;
  /** Accounts created by this call. */
  readonly created: number;
  /** Accounts of the same provisioning that an earlier, interrupted call had created. */
  readonly earlier: number;
  readonly failed: number;
  /** Batches that created accounts. */
  readonly batches: number;
  readonly batchSize: number;
  /** `METHOD:/path` of the register operation, as the backend names it; null when nothing was sent. */
  readonly registerOperation: string | null;
  /** Environment the accounts were created on, when the call chose one; null for the default. */
  readonly environment: string | null;
  readonly masked: true;
  /** The series stopped before the count was reached (a run of failures at the target). */
  readonly aborted: boolean;
  /** Every account asked for exists and every slot of the target is filled. */
  readonly ready: boolean;
  /** Accounts the target refused, counted by the HTTP status it answered with. */
  readonly failures: { readonly status: number | null; readonly count: number }[];
  /** The plan of the target after the accounts were created. */
  readonly plan: DataPlanView;
}

/** Accounts that would be created on a protected environment; nothing was sent, the user must agree first. */
export interface ProvisionConfirmView {
  readonly needsConfirmation: true;
  readonly slot: string;
  readonly environment: string;
  readonly count: number;
  /** The scenario or composition the accounts are for. */
  readonly target: string;
}

export function renderProvisionConfirm(data: ProvisionConfirmView, t: Translator): string {
  return wrap(
    t('data.provision.confirm', {
      count: num(data.count, t.locale),
      environment: inline(data.environment),
      target: inline(data.target),
    }),
  ).join('\n');
}

/** `POST:/auth/register` as `POST /auth/register`. */
function operationText(operation: string): string {
  const at = operation.indexOf(':');
  const clean = inline(operation);
  return at > 0 && at < 8 ? `${clean.slice(0, at)} ${clean.slice(at + 1)}` : clean;
}

function provisionHead(data: ProvisionView, t: Translator): string {
  if (data.created === 0 && data.batches === 0) {
    return t('data.provision.nothing', { count: num(data.earlier, t.locale) });
  }
  const exact = data.created === data.batches * data.batchSize;
  return [
    t.plural('data.provision.created', data.created, { count: num(data.created, t.locale) }),
    data.registerOperation === null
      ? ''
      : t('data.provision.through', { operation: operationText(data.registerOperation) }),
    data.environment === null
      ? ''
      : t('data.provision.on', { environment: inline(data.environment) }),
    exact
      ? t('data.provision.batches.exact', { batches: data.batches, size: data.batchSize })
      : t.plural('data.provision.batches', data.batches, {
          batches: data.batches,
          size: data.batchSize,
        }),
  ].join('');
}

function provisionDetails(data: ProvisionView, t: Translator): string[] {
  return [
    ...(data.earlier === 0
      ? []
      : [t('data.provision.earlier', { count: num(data.earlier, t.locale) })]),
    ...(data.failed === 0
      ? []
      : [t('data.provision.failed', { count: num(data.failed, t.locale) })]),
    ...data.failures.map((failure) =>
      t('data.provision.failure', {
        status: failure.status === null ? '–' : failure.status,
        count: num(failure.count, t.locale),
      }),
    ),
    ...(data.aborted ? [t('data.provision.aborted')] : []),
    ...(data.failed > 0 || data.aborted ? [t('data.provision.next')] : []),
    t('data.provision.masked'),
  ];
}

export function renderProvision(data: ProvisionView, t: Translator): string {
  const label = inline(data.dataset);
  const prefix = visibleWidth(label) + GAP.length;
  const lines = [provisionHead(data, t), ...provisionDetails(data, t)].flatMap((line) =>
    wrap(line, VIEW_WIDTH - prefix),
  );
  const [first = '', ...rest] = lines;
  const total = data.earlier + data.created;
  const closing =
    total < data.requested
      ? wrap(
          t('data.provision.incomplete', {
            done: num(total, t.locale),
            total: num(data.requested, t.locale),
          }),
        )
      : planClosing(data.plan, t);
  return [label + GAP + first, ...rest.map((line) => ' '.repeat(prefix) + line), ...closing].join(
    '\n',
  );
}

/**
 * A provisioning whose series stopped before anyone saw it end: `process_cancel` stopped it, or the server
 * process that ran it ended. Read from the dataset and the bindings; nothing was created to tell it.
 */
export interface ProvisionStoppedView {
  readonly stopped: 'cancelled' | 'restart';
  readonly slot: string;
  readonly dataset: string;
  /** Accounts the provisioning was asked for. */
  readonly requested: number;
  /** Accounts of this provisioning the dataset holds. */
  readonly exist: number;
  /** The dataset is the pick of every scenario that reads the slot; null when that is unknown. */
  readonly pinned: boolean | null;
  readonly masked: true;
}

export function renderProvisionStopped(data: ProvisionStoppedView, t: Translator): string {
  const label = inline(data.dataset);
  const prefix = visibleWidth(label) + GAP.length;
  const counts = { done: num(data.exist, t.locale), total: num(data.requested, t.locale) };
  const lines = [
    t(`data.provision.stopped.${data.stopped}`, counts),
    t('data.provision.masked'),
  ].flatMap((line) => wrap(line, VIEW_WIDTH - prefix));
  const [first = '', ...rest] = lines;
  const complete = data.exist >= data.requested && data.pinned === true;
  const closing = wrap(
    complete
      ? t('data.provision.stopped.complete')
      : t('data.provision.stopped.next', {
          slot: inline(data.slot),
          count: data.requested,
        }),
  );
  return [label + GAP + first, ...rest.map((line) => ' '.repeat(prefix) + line), ...closing].join(
    '\n',
  );
}

/** The line in front of the progress of a provisioning that goes on after the call returns. */
export function renderProvisionRunning(
  data: { readonly slot: string; readonly joined: boolean; readonly operation: string },
  t: Translator,
): string {
  return wrap(
    t(data.joined ? 'data.provision.running.joined' : 'data.provision.running', {
      slot: inline(data.slot),
      operation: data.operation,
    }),
  ).join('\n');
}

// ---- the data hub's suggestion ----------------------------------------------------------------

/** Why an action of the data hub's suggestion is not one of its calls. */
export type SkipReason =
  | 'separate_call'
  | 'secret_columns'
  | 'no_rules'
  | 'exists'
  | 'dataset_gone'
  | 'slot_gone'
  | 'not_applied'
  | 'over_limit';

export interface SkippedAction {
  readonly reason: SkipReason;
  /** The action's kind as the backend names it. */
  readonly kind: string;
  readonly name: string | null;
  readonly slot: string | null;
  /** For `over_limit`: how many actions of the hub were left out. */
  readonly count?: number;
}

/** What `data_suggest_actions` returns: the plan with the hub's proposals and the calls that apply them. */
export interface SuggestionView extends DataPlanView {
  /** The data hub was asked (a slot was missing). */
  readonly asked: boolean;
  /** The hub's actions that are not calls of the data tools, with why. */
  readonly skipped: SkippedAction[];
}

function skippedLines(skipped: readonly SkippedAction[], t: Translator): string[] {
  if (skipped.length === 0) return [];
  return [
    t('data.skipped', { count: skipped.length }),
    ...skipped.flatMap((action) =>
      wrap(
        t(`data.skip.${action.reason}`, {
          name: inline(action.name ?? ''),
          slot: inline(action.slot ?? ''),
          kind: inline(action.kind),
          count: num(action.count ?? 0, t.locale),
        }),
        VIEW_WIDTH - CONTINUATION.length,
      ).map((line) => CONTINUATION + line),
    ),
  ];
}

export function renderSuggestion(data: SuggestionView, t: Translator): string {
  return [
    ...planLines(data, t),
    ...(data.asked && data.steps.length === 0 && data.skipped.length === 0
      ? [t('data.suggest.none')]
      : []),
    ...stepLines(data.steps, t.plural('data.steps.suggested', data.steps.length)),
    ...skippedLines(data.skipped, t),
  ].join('\n');
}

// ---- consent cards ----------------------------------------------------------------------------

interface CardBase {
  readonly needsConfirmation: true;
  /** The token the repeat of the call carries after the user's yes. */
  readonly confirm: string;
  /** The call had a token, but it did nothing: this card replaces the earlier one. */
  readonly renewed?: CardRenewalReason;
}

/** The card of `data_suggest_actions`: the data hub is asked only after the user's yes. */
export interface SuggestCardView extends CardBase {
  readonly target: { readonly kind: 'scenario' | 'composition'; readonly name: string };
  /** The plan without the hub: which slots are missing. */
  readonly plan: DataPlanView;
}

/** Where the rows of a dataset `data_create_dataset` makes come from. */
export type DatasetSource =
  | {
      readonly kind: 'file';
      readonly file: string;
      readonly size: number;
      readonly sha256: string;
      readonly rows: number;
    }
  | { readonly kind: 'rules'; readonly handle: string }
  | { readonly kind: 'slot' };

/** The card of `data_create_dataset`: nothing is saved before the user's yes. */
export interface CreateCardView extends CardBase {
  readonly name: string;
  readonly source: DatasetSource;
  /** The slot whose columns the dataset gets, with the target that reads it. */
  readonly slot: { readonly slot: string; readonly target: string } | null;
  /** Rows to make; null when the source decides (a file). */
  readonly rows: number | null;
  /** The dataset of that name exists and gets the file as a new revision. */
  readonly revision: boolean;
}

function cardClosing(data: CardBase, tool: string, t: Translator): string[] {
  return wrap(
    t('data.card.next', { tool, confirm: inline(data.confirm, 40) }),
    VIEW_WIDTH,
    CONTINUATION.length,
  );
}

function renewedLines(data: CardBase, t: Translator): string[] {
  return data.renewed === undefined
    ? []
    : wrap(t(`data.card.renewed.${data.renewed}`), VIEW_WIDTH, CONTINUATION.length);
}

const fieldLines = (fields: readonly string[]): string[] =>
  fields.flatMap((field) =>
    wrap(field, VIEW_WIDTH - CONTINUATION.length).map((line) => CONTINUATION + line),
  );

export function renderSuggestCard(data: SuggestCardView, t: Translator): string {
  const target = inline(data.target.name);
  return [
    ...renewedLines(data, t),
    ...planLines(data.plan, t),
    t('data.card.suggest', { target }),
    ...fieldLines([t('data.card.for', { target }), t('data.card.cost')]),
    ...cardClosing(data, 'data_suggest_actions', t),
  ].join('\n');
}

function sourceText(source: DatasetSource, slot: string | null, t: Translator): string {
  if (source.kind === 'file') {
    return t('data.card.source.file', {
      file: inline(source.file),
      size: num(source.size, t.locale),
      sha: inline(source.sha256.slice(0, 16)),
    });
  }
  if (source.kind === 'rules')
    return t('data.card.source.rules', { handle: inline(source.handle) });
  return t('data.card.source.slot', { slot: inline(slot ?? '') });
}

export function renderCreateCard(data: CreateCardView, t: Translator): string {
  return [
    ...renewedLines(data, t),
    t('data.card.create', { name: inline(data.name) }),
    ...fieldLines([
      sourceText(data.source, data.slot?.slot ?? null, t),
      ...(data.source.kind === 'file'
        ? [
            t.plural('data.file.rows', data.source.rows, {
              count: num(data.source.rows, t.locale),
              file: inline(data.source.file),
            }),
          ]
        : []),
      ...(data.rows === null ? [] : [t('data.card.rows', { rows: num(data.rows, t.locale) })]),
      ...(data.slot === null
        ? []
        : [
            t('data.card.slot', {
              slot: inline(data.slot.slot),
              target: inline(data.slot.target),
            }),
          ]),
      ...(data.revision ? [t('data.card.revision')] : []),
      ...(data.source.kind === 'slot' ? [t('data.card.cost.slot')] : []),
    ]),
    ...cardClosing(data, 'data_create_dataset', t),
  ].join('\n');
}

// ---- what a write did -------------------------------------------------------------------------

/** What `data_create_dataset` saved. The rows of a file are never part of it. */
export interface CreatedView {
  readonly source: 'file' | 'rules' | 'slot';
  /** Name of the dataset that now holds the rows. */
  readonly name: string;
  readonly rows: number;
  /** The slot whose columns the dataset has; null for rules the target does not read. */
  readonly slot: string | null;
  /** The file the rows came from, as the workspace shows it. */
  readonly file?: string;
  /** The dataset existed and got the file as a new revision. */
  readonly revision?: boolean;
  /** Secret cells of the file were kept out of every output. */
  readonly masked?: true;
  /** The pin of the dataset to its slot, with the target's other picks. */
  readonly next?: PlanStep;
}

export function renderCreated(data: CreatedView, t: Translator): string {
  const name = inline(data.name);
  const lines: string[] = [];
  if (data.source === 'file') {
    const prefix = visibleWidth(name) + GAP.length;
    const detail = [
      t.plural('data.file.rows', data.rows, {
        count: num(data.rows, t.locale),
        file: inline(data.file ?? ''),
      }),
      ...(data.revision === true ? [t('data.file.revision')] : []),
      t('data.provision.masked'),
    ].join(SEPARATOR);
    const [first = '', ...rest] = wrap(detail, VIEW_WIDTH - prefix);
    lines.push(name + GAP + first, ...rest.map((line) => ' '.repeat(prefix) + line));
  } else if (data.source === 'rules') {
    lines.push(...wrap(t('data.created.rules', { name, rows: num(data.rows, t.locale) })));
  } else {
    lines.push(
      ...wrap(
        t('data.created.slot', {
          slot: inline(data.slot ?? ''),
          name,
          rows: num(data.rows, t.locale),
        }),
      ),
    );
  }
  return [...lines, ...nextLines(data.next, t)].join('\n');
}

/** One slot of the map `data_set_bindings` saved. */
export interface BoundSlot {
  readonly slot: string;
  readonly dataset: string;
  /** For a composition: member scenarios that hold the pick afterwards; absent for a scenario. */
  readonly scenarios?: number;
}

/** What `data_set_bindings` saved. */
export interface BindingsView {
  readonly target: { readonly kind: 'scenario' | 'composition'; readonly name: string };
  readonly bound: BoundSlot[];
  /** Slots that had a pick and lost it. */
  readonly cleared: string[];
  /** The target had these picks: nothing was sent. */
  readonly unchanged: boolean;
  /** How many slots the target's map holds now. */
  readonly count: number;
  /** The readiness check of the target. */
  readonly next: PlanStep;
}

export function renderBindings(data: BindingsView, t: Translator): string {
  const target = inline(data.target.name);
  const header =
    data.bound.length === 0
      ? t('data.bindings.none', { target })
      : t.plural('data.bindings.title', data.bound.length, { target, count: data.bound.length });
  return [
    header,
    ...data.bound.flatMap((item) =>
      wrap(
        `${inline(item.slot)} → ${inline(item.dataset)}` +
          (item.scenarios === undefined
            ? ''
            : t('data.bindings.scenarios', { count: num(item.scenarios, t.locale) })),
        VIEW_WIDTH - CONTINUATION.length,
      ).map((line) => CONTINUATION + line),
    ),
    ...(data.cleared.length === 0
      ? []
      : [
          t('data.bindings.cleared', {
            slots: data.cleared.map((slot) => inline(slot)).join(', '),
          }),
        ]),
    ...(data.unchanged ? [t('data.bindings.unchanged')] : []),
    ...nextLines(data.next, t),
  ].join('\n');
}
