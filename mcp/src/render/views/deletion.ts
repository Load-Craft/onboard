// Views of `project_delete` and `flows_delete`: the card with every item (name, id, for a flow its
// version and the time of its last change) and the numbers of what goes with it, the choice between
// flows of one name, the yes the consent window handed over, and the result. Every name and id came
// from the backend or the model, so each passes through `inline`.

import type { Translator } from '../../context.js';
import { inline, VIEW_WIDTH, wrap } from '../primitives.js';

const NAME_LIMIT = 80;
const ID_LIMIT = 64;
const INDENT = '  ';

/** A number of things, or null when it could not be read with one cheap read (shown, never guessed). */
export type DeleteCount = { readonly n: number; readonly more: boolean } | null;

/** One item to delete. */
export interface DeleteItem {
  readonly id: string;
  readonly name: string;
  /** A flow: its current version and the time of its last change. */
  readonly version?: number | undefined;
  readonly at?: string | undefined;
}

/** What goes with a project. */
export interface ProjectCounts {
  readonly flows: DeleteCount;
  readonly scenarios: DeleteCount;
  readonly compositions: DeleteCount;
  readonly docs: DeleteCount;
  readonly environments: DeleteCount;
  readonly datasets: DeleteCount;
  readonly runs: DeleteCount;
}

/** What stays behind flows, pointing at them. */
export interface FlowCounts {
  readonly scenarios: DeleteCount;
  readonly compositions: DeleteCount;
}

export type DeleteKind = 'project' | 'flow';
export type DeleteTool = 'project_delete' | 'flows_delete';
export type CardRenewal = 'missing' | 'expired' | 'token' | 'changed';

/** The facts of a card: what the user is asked about, in the window and in the chat. */
export interface DeleteFacts {
  readonly tool: DeleteTool;
  readonly kind: DeleteKind;
  readonly scope: string;
  /** Flows: the project they belong to. */
  readonly project?: { readonly id: string; readonly name: string } | undefined;
  /** Projects: each with what goes with it. */
  readonly items: readonly (DeleteItem & { readonly counts?: ProjectCounts | undefined })[];
  /** Flows: what stays behind them. */
  readonly stays?: FlowCounts | undefined;
  /** The name of the bound project of this repository, when it is among the projects. */
  readonly bound?: string | undefined;
  /** Whether a test runs could not be read. */
  readonly testsUnknown?: boolean | undefined;
}

export interface DeleteCardData extends DeleteFacts {
  readonly needsConfirmation: true;
  readonly confirm: string;
  readonly renewed?: CardRenewal;
}

/** Names that match more than one item: no card, the user picks by id. */
export interface DeleteChoiceData {
  readonly choice: true;
  readonly kind: DeleteKind;
  readonly ambiguous: readonly { readonly name: string; readonly matches: readonly DeleteItem[] }[];
}

export interface DeleteDoneData {
  readonly kind: DeleteKind;
  readonly count: number;
  readonly names: string;
  readonly deleted: readonly DeleteItem[];
  /** Ids the backend did not find. */
  readonly failed: readonly string[];
  readonly project?: { readonly id: string; readonly name: string };
  /** The repository was bound to a deleted project and is not any more. */
  readonly unbound?: boolean;
  /** The projects are deleted, but the repository could not be unbound from them. */
  readonly unbindFailed?: boolean;
}

export type DeleteData = DeleteCardData | DeleteChoiceData | DeleteDoneData;

/** `text` wrapped and moved right by `pad`; its continuation lines two more. */
function indented(text: string, pad: string): string[] {
  return wrap(text, VIEW_WIDTH - pad.length, 2).map((line) => `${pad}${line}`);
}

function countText(count: DeleteCount, t: Translator): string {
  if (count === null) return t('delete.count.unknown');
  return count.more ? t('delete.count.more', { n: count.n }) : String(count.n);
}

/**
 * A name from the backend on one line, its quotation marks turned into apostrophes: the texts put
 * names in quotes, and a name must not close them and pose as the facts that follow.
 */
export function plainName(name: string): string {
  return inline(name, NAME_LIMIT).replace(/["“”„«»]/gu, "'");
}

function itemText(kind: DeleteKind, item: DeleteItem, t: Translator): string {
  const name = plainName(item.name);
  const id = inline(item.id, ID_LIMIT);
  if (kind === 'project' || item.version === undefined) {
    return t('delete.item.project', { name, id });
  }
  return t('delete.item.flow', {
    name,
    id,
    version: item.version,
    at: inline((item.at ?? '').slice(0, 16).replace('T', ' '), 20),
  });
}

/** The lines of the items, each with what goes with it. */
function itemLines(facts: DeleteFacts, t: Translator): string[] {
  return facts.items.flatMap((item) => [
    `${INDENT}${itemText(facts.kind, item, t)}`,
    ...(item.counts === undefined
      ? []
      : indented(
          t('delete.goes.project', {
            flows: countText(item.counts.flows, t),
            scenarios: countText(item.counts.scenarios, t),
            compositions: countText(item.counts.compositions, t),
            docs: countText(item.counts.docs, t),
            environments: countText(item.counts.environments, t),
            datasets: countText(item.counts.datasets, t),
            runs: countText(item.counts.runs, t),
          }),
          `${INDENT}${INDENT}`,
        )),
  ]);
}

function renderCard(data: DeleteCardData, t: Translator): string {
  const scope = inline(data.scope, 40);
  const title =
    data.kind === 'project'
      ? t.plural('delete.card.project', data.items.length, { scope })
      : t.plural('delete.card.flow', data.items.length, {
          scope,
          project: plainName(data.project?.name ?? ''),
        });
  return [
    ...(data.renewed === undefined
      ? []
      : wrap(t(`delete.card.renewed.${data.renewed}`), VIEW_WIDTH, 2)),
    ...wrap(title, VIEW_WIDTH, 2),
    ...itemLines(data, t),
    ...(data.stays === undefined
      ? []
      : [
          ...indented(t('delete.goes.flow'), INDENT),
          ...indented(
            t('delete.stays.flow', {
              scenarios: countText(data.stays.scenarios, t),
              compositions: countText(data.stays.compositions, t),
            }),
            INDENT,
          ),
        ]),
    ...(data.bound === undefined
      ? []
      : wrap(t('delete.bound', { name: plainName(data.bound) }), VIEW_WIDTH, 2)),
    ...(data.testsUnknown === true ? wrap(t('delete.tests.unknown'), VIEW_WIDTH, 2) : []),
    ...wrap(t('delete.card.next', { confirm: inline(data.confirm, 40) }), VIEW_WIDTH, 2),
  ].join('\n');
}

function renderChoice(data: DeleteChoiceData, t: Translator): string {
  return [
    ...wrap(t.plural('delete.choice', data.ambiguous.length), VIEW_WIDTH, 2),
    ...data.ambiguous.flatMap((entry) => [
      `${INDENT}${t('delete.choice.name', {
        name: plainName(entry.name),
        count: entry.matches.length,
      })}`,
      ...entry.matches.map((item) => `${INDENT}${INDENT}${itemText(data.kind, item, t)}`),
    ]),
    `→ ${t('delete.choice.next')}`,
  ].join('\n');
}

function renderDone(data: DeleteDoneData, t: Translator): string {
  const title =
    data.kind === 'project'
      ? t.plural('delete.done.project', data.count)
      : t.plural('delete.done.flow', data.count, {
          project: plainName(data.project?.name ?? ''),
        });
  return [
    ...wrap(`${title}; ${t('delete.done.irreversible')}:`, VIEW_WIDTH, 2),
    ...data.deleted.map((item) => `${INDENT}${itemText(data.kind, item, t)}`),
    ...(data.failed.length === 0
      ? []
      : wrap(
          t('delete.done.failed', {
            ids: data.failed.map((id) => inline(id, ID_LIMIT)).join(', '),
          }),
          VIEW_WIDTH,
          2,
        )),
    ...(data.unbound === true ? wrap(t('delete.done.unbound'), VIEW_WIDTH, 2) : []),
    ...(data.unbindFailed === true ? wrap(t('delete.done.unbindFailed'), VIEW_WIDTH, 2) : []),
    ...(data.kind === 'flow' && data.count > 0
      ? wrap(t('delete.done.flows.reset'), VIEW_WIDTH, 2)
      : []),
  ].join('\n');
}

export function isDeleteCard(data: DeleteData): data is DeleteCardData {
  return 'needsConfirmation' in data;
}

export function renderDelete(data: DeleteData, t: Translator): string {
  if (isDeleteCard(data)) return renderCard(data, t);
  if ('choice' in data) return renderChoice(data, t);
  return renderDone(data, t);
}

/**
 * The question the client shows the person before a deletion: every item with its name and id (a
 * flow with its version and the time it was saved) and the numbers of what goes with it or stays,
 * on lines of their own. Plain text: the client draws it, the model never answers it.
 */
export function renderDeleteQuestion(facts: DeleteFacts, t: Translator): string {
  const title =
    facts.kind === 'project'
      ? t.plural('delete.ask.project', facts.items.length)
      : t.plural('delete.ask.flow', facts.items.length, {
          project: plainName(facts.project?.name ?? ''),
        });
  const lines = [title];
  for (const item of facts.items) {
    lines.push(`- ${itemText(facts.kind, item, t)}`);
    if (item.counts !== undefined) {
      lines.push(
        `  ${t('delete.goes.project', {
          flows: countText(item.counts.flows, t),
          scenarios: countText(item.counts.scenarios, t),
          compositions: countText(item.counts.compositions, t),
          docs: countText(item.counts.docs, t),
          environments: countText(item.counts.environments, t),
          datasets: countText(item.counts.datasets, t),
          runs: countText(item.counts.runs, t),
        })}`,
      );
    }
  }
  if (facts.stays !== undefined) {
    lines.push(t('delete.goes.flow'));
    lines.push(
      t('delete.stays.flow', {
        scenarios: countText(facts.stays.scenarios, t),
        compositions: countText(facts.stays.compositions, t),
      }),
    );
  }
  if (facts.bound !== undefined) lines.push(t('delete.bound', { name: plainName(facts.bound) }));
  lines.push(t('delete.ask.tick'));
  return lines.join('\n');
}
