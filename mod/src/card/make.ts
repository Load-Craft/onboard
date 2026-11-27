/**
 * The cards the mod makes, from facts it already reads: the last reading of an operation, how a bar
 * ended, and the status data block (`oldDocs`, `uncertainFields`). Pure: no `$`, no clock (the time
 * comes in), no exception. A card holds only what is safe to draw: a name of a flow or of a profile
 * field, a kind of operation, numbers, and a reason the server already worded and masked, each cut
 * to one clean line (`inline`). Never an argument of a call, never a value of a field.
 */

import { inline } from '../../../mcp/src/render/primitives.js';
import type { Locale } from '../i18n.js';
import type { BarEnd } from '../state/types.js';
import { kindLabel, MAX_REASON, numberParts, type OperationSnapshot } from '../view/status.js';
import { cardTexts } from './texts.js';
import { isHandle } from '../state/signal.js';
import type { Card, CardEffect } from './queue.js';
import { failedStep, type SelfCheckFacts } from '../pane/selfCheck.js';

const MINUTE = 60_000;
/** A card of news goes after this long; a failure stays longer, but not forever. */
const DONE_FOR = 10 * MINUTE;
const FAILED_FOR = 60 * MINUTE;

const MAX_NAME = 40;
const MAX_NAMES = 3;
const MAX_LINE = 120;

const PRIORITY = { failed: 1, docs: 2, profile: 3, done: 4 } as const;

type Dict = Readonly<Record<string, unknown>>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short stable fingerprint (FNV-1a), so that the same list of names is the same key. */
function fingerprint(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of parts.join('\u0000')) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const kindOfHandle = (handle: string): string => handle.slice(0, Math.max(0, handle.indexOf(':')));

// The messages for Claude are fixed English (a skill reads them like the Path tab's). Each says it
// is a question of the user and not a consent. The state holds a topic, never the text: the text is
// made here, from constants, and a handle is put in only when it is one.
const NOT_CONSENT = 'It is a question, not consent to anything that writes or costs.';

function whyMessage(handle: string): string {
  return (
    `The user asks in the LoadCraft card why the operation ${JSON.stringify(handle)} failed. ` +
    'Read it with process_get_status (operation) and explain the cause in plain words; ' +
    `do not start it again without asking. ${NOT_CONSENT}`
  );
}

const PREVIEW_MESSAGE =
  'The user asks in the LoadCraft card for a preview of moving the flows that are on an older ' +
  'version of the API documentation onto the current one. Call flows_migrate_docs with ' +
  'preview: true (it saves nothing) and show what would change. Do not apply the migration; ' +
  `that needs the user's consent in its own card. ${NOT_CONSENT}`;

/** The message an `ask` effect sends to Claude, or `undefined` when it names no handle it can trust. */
export function askMessage(effect: Extract<CardEffect, { kind: 'ask' }>): string | undefined {
  if (effect.topic === 'migrate') return PREVIEW_MESSAGE;
  return isHandle(effect.handle) ? whyMessage(effect.handle) : undefined;
}

function failedCard(
  handle: string,
  kind: string,
  reason: string | undefined,
  locale: Locale,
  now: number,
): Card {
  const t = cardTexts(locale);
  return {
    key: `end:${handle}`,
    kind: 'end',
    priority: PRIORITY.failed,
    title: t('card.end.failed', { what: kindLabel(kind, locale) }),
    lines: [reason === undefined ? t('card.end.noReason') : inline(reason, MAX_REASON)],
    actions: [
      {
        digit: '1',
        label: t('card.action.show'),
        effect: { kind: 'pane', tab: kind === 'test_run' ? 'run' : 'project' },
      },
      ...(isHandle(handle)
        ? [
            {
              digit: '2',
              label: t('card.action.ask'),
              effect: { kind: 'ask', topic: 'why', handle },
            } as const,
          ]
        : []),
      { digit: '0', label: t('card.action.close'), effect: { kind: 'close' } },
    ],
    expiresAt: now + FAILED_FOR,
  };
}

/**
 * The card for the end of an operation read by the poll: a test that finished (with its numbers),
 * or any operation that failed (with the reason, when the server gave one). A test the user stopped,
 * an operation that went well apart from a test, and one still running give none.
 */
export function cardOfSnapshot(
  snapshot: OperationSnapshot,
  locale: Locale,
  now: number,
): Card | undefined {
  if (snapshot.phase === 'failed' || snapshot.phase === 'abandoned') {
    return failedCard(snapshot.operation, snapshot.kind, snapshot.reason, locale, now);
  }
  if (snapshot.phase !== 'completed' || snapshot.kind !== 'test_run') return undefined;
  const t = cardTexts(locale);
  const numbers = inline(numberParts(snapshot, locale).join(' · '), MAX_LINE);
  return {
    key: `end:${snapshot.operation}`,
    kind: 'end',
    priority: PRIORITY.done,
    title: t('card.end.done'),
    lines: numbers === '' ? [] : [numbers],
    actions: [
      { digit: '1', label: t('card.action.show'), effect: { kind: 'pane', tab: 'results' } },
      { digit: '0', label: t('card.action.close'), effect: { kind: 'close' } },
    ],
    expiresAt: now + DONE_FOR,
  };
}

/**
 * The card for an operation whose bar ended badly (the server's `ended` list names how): the way
 * operations without a phase of their own report a failure. Any other end gives none.
 */
export function cardOfEnd(
  handle: string,
  kind: string | undefined,
  end: BarEnd,
  locale: Locale,
  now: number,
): Card | undefined {
  if (end !== 'failed') return undefined;
  return failedCard(handle, kind ?? kindOfHandle(handle), undefined, locale, now);
}

function names(list: readonly string[], more: number, locale: Locale): string {
  const t = cardTexts(locale);
  const shown = list
    .slice(0, MAX_NAMES)
    .map((name) => inline(name, MAX_NAME))
    .join(', ');
  const rest = more + Math.max(0, list.length - MAX_NAMES);
  return inline(
    rest > 0
      ? t('card.namesMore', { names: shown, count: rest })
      : t('card.names', { names: shown }),
    MAX_LINE,
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && inline(item) !== '')
    : [];
}

/** The card for flows on an older documentation version (`oldDocs` of the status), or none. */
export function docsCard(data: unknown, locale: Locale): Card | undefined {
  if (!isDict(data) || !isDict(data['oldDocs'])) return undefined;
  const flows = strings(data['oldDocs']['flows']);
  const more = data['oldDocs']['more'];
  const rest = typeof more === 'number' && Number.isInteger(more) && more > 0 ? more : 0;
  const count = flows.length + rest;
  if (count === 0) return undefined;
  const t = cardTexts(locale);
  return {
    key: `docs:${fingerprint([...[...flows].sort(), String(rest)])}`,
    kind: 'docs',
    priority: PRIORITY.docs,
    title: t.plural('card.docs.title', count),
    lines: flows.length === 0 ? [] : [names(flows, rest, locale)],
    actions: [
      {
        digit: '1',
        label: t('card.action.preview'),
        effect: { kind: 'ask', topic: 'migrate' },
      },
      { digit: '0', label: t('card.action.later'), effect: { kind: 'close' } },
    ],
  };
}

/** The card for profile fields the analysis was unsure of (`uncertainFields`), or none. */
export function profileCard(data: unknown, locale: Locale): Card | undefined {
  if (!isDict(data)) return undefined;
  const fields = strings(data['uncertainFields']);
  if (fields.length === 0) return undefined;
  const t = cardTexts(locale);
  return {
    key: `profile:${fingerprint([...fields].sort())}`,
    kind: 'profile',
    priority: PRIORITY.profile,
    title: t.plural('card.profile.title', fields.length),
    lines: [names(fields, 0, locale)],
    actions: [
      { digit: '1', label: t('card.action.fields'), effect: { kind: 'pane', tab: 'project' } },
      { digit: '0', label: t('card.action.later'), effect: { kind: 'close' } },
    ],
  };
}

const CHECK_ENDS: readonly string[] = [
  'failed',
  'interrupted',
  'target_unreachable',
  'goal_step_missing',
];

/**
 * The card for the first scenario of the view that needs a look: a step failed and the AI repairs it
 * (one card per round), or the check did not pass. Its one action shows the Run tab; nothing else.
 * Kept in step with the view: a repair that is over takes its card away.
 */
export function checkCards(facts: SelfCheckFacts | undefined, locale: Locale, now: number): Card[] {
  const scenario = facts?.scenarios.find(
    (item) => item.status === 'repairing' || CHECK_ENDS.includes(item.status),
  );
  if (facts === undefined || scenario === undefined) return [];
  const t = cardTexts(locale);
  const repairing = scenario.status === 'repairing';
  const name = inline(scenario.name, MAX_NAME);
  const reason = scenario.failure?.message ?? '';
  return [
    {
      key: `check:${facts.key}:${scenario.id}:${repairing ? `repair${String(scenario.repairs.length + 1)}` : 'end'}`,
      kind: 'check',
      priority: PRIORITY.failed,
      title: repairing
        ? t('card.check.repair', { name, step: failedStep(scenario).step ?? '?' })
        : t('card.check.failed', { name }),
      lines: reason === '' ? [] : [inline(reason, MAX_LINE)],
      actions: [
        { digit: '1', label: t('card.action.show'), effect: { kind: 'pane', tab: 'run' } },
        { digit: '0', label: t('card.action.close'), effect: { kind: 'close' } },
      ],
      expiresAt: now + FAILED_FOR,
    },
  ];
}
