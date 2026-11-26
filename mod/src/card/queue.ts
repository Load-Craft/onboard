/**
 * The cards above the prompt: what the user is told with actions under the digits `1`, `2` and `0`.
 * Pure: no `$`, no clock (the time comes in), no exception. A function that has nothing to change
 * hands back the same object, so the caller does not write.
 *
 * - One card is drawn at a time, the head of the queue; the rest wait and are counted.
 * - A key stands for one event (an operation handle, a list of flows); the same key is never queued
 *   twice, and a key the user closed never comes back.
 * - A card that is a fact of the server (flows on an older documentation version) is kept in step
 *   with it by `syncKind`: it goes when the fact is gone.
 */

import type { PaneTab } from '../pane/tabs.js';

export type CardKind = 'end' | 'docs' | 'profile' | 'check';

/**
 * What a digit does. Only harmless things: show something in the panel, close the card, or say
 * something to Claude that is a question and never a decision (a consent is given in its own
 * dialog, never under a digit).
 */
export type CardEffect =
  | { readonly kind: 'pane'; readonly tab: PaneTab }
  /** A question for Claude on a fixed topic; the text is made from the topic (`askMessage`). */
  | { readonly kind: 'ask'; readonly topic: 'why'; readonly handle: string }
  | { readonly kind: 'ask'; readonly topic: 'migrate' }
  | { readonly kind: 'close' };

export interface CardAction {
  readonly digit: '0' | '1' | '2';
  readonly label: string;
  readonly effect: CardEffect;
}

export interface Card {
  /** One event: `end:<handle>`, `docs:<fingerprint>`, `profile:<fingerprint>`. */
  readonly key: string;
  readonly kind: CardKind;
  /** 1 first: a failure, then a problem to fix, then news. */
  readonly priority: number;
  readonly title: string;
  /** At most two lines under the title, already made fit for one line each. */
  readonly lines: readonly string[];
  readonly actions: readonly CardAction[];
  /** Epoch milliseconds after which the card is gone; absent: it stays until closed or settled. */
  readonly expiresAt?: number;
}

export interface CardsState {
  readonly queue: readonly Card[];
  /** Keys closed by the user, the newest last, at most `MAX_CLOSED`. */
  readonly closed: readonly string[];
}

export const EMPTY_CARDS: CardsState = { queue: [], closed: [] };

/** Cards waiting at most; a newer one past this is dropped (the panel is where the rest lives). */
export const MAX_QUEUE = 8;
/** Closed keys remembered. */
export const MAX_CLOSED = 100;

function sorted(queue: readonly Card[]): Card[] {
  // `sort` is stable: cards of one priority keep the order they came in.
  return [...queue].sort((a, b) => a.priority - b.priority);
}

/**
 * The card with `card.key` joins the queue, unless it is queued or was closed. With the queue full,
 * a card that is more urgent than the least urgent one (the newest of its priority) takes its place;
 * a card that is not is dropped, the panel lists what is queued.
 */
export function enqueue(state: CardsState, card: Card): CardsState {
  if (state.closed.includes(card.key) || state.queue.some((item) => item.key === card.key)) {
    return state;
  }
  if (state.queue.length < MAX_QUEUE) return { ...state, queue: sorted([...state.queue, card]) };
  const last = state.queue.at(-1);
  if (last === undefined || card.priority >= last.priority) return state;
  return { ...state, queue: sorted([...state.queue.slice(0, -1), card]) };
}

/**
 * The action under `digit` of the card with `key`, or `undefined` when that card is not queued any
 * more (it was closed, or went with its fact): a digit never acts on another card than the one that was
 * drawn when it was pressed.
 */
export function actionOf(
  state: CardsState,
  key: string,
  digit: CardAction['digit'],
): CardAction | undefined {
  return state.queue.find((item) => item.key === key)?.actions.find((a) => a.digit === digit);
}

/** The keys of two sessions together, the newest last, at most `MAX_CLOSED`: nothing one session knew is lost. */
export function mergeKeys(stored: unknown, added: readonly string[]): string[] {
  const old = Array.isArray(stored)
    ? (stored as readonly unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  return [...new Set([...old, ...added])].slice(-MAX_CLOSED);
}

/** The user closed the card: it leaves the queue and its key is remembered. */
export function dismiss(state: CardsState, key: string): CardsState {
  if (!state.queue.some((item) => item.key === key)) return state;
  return {
    queue: state.queue.filter((item) => item.key !== key),
    closed: [...state.closed.filter((item) => item !== key), key].slice(-MAX_CLOSED),
  };
}

/** The keys the store remembers from an earlier session join the closed ones. */
export function withClosed(state: CardsState, keys: readonly string[]): CardsState {
  const merged = [...new Set([...keys, ...state.closed])].slice(-MAX_CLOSED);
  return merged.length === state.closed.length && merged.every((k, i) => k === state.closed[i])
    ? state
    : { ...state, closed: merged };
}

/** Cards past their time leave the queue; they are not remembered as closed. */
export function expire(state: CardsState, now: number): CardsState {
  const kept = state.queue.filter((item) => item.expiresAt === undefined || item.expiresAt > now);
  return kept.length === state.queue.length ? state : { ...state, queue: kept };
}

/**
 * The cards of `kind` become `wanted`: one the state no longer asks for leaves, a new one joins
 * (unless it was closed). The facts of the server go through here after every status read.
 */
export function syncKind(state: CardsState, kind: CardKind, wanted: readonly Card[]): CardsState {
  const keys = new Set(wanted.map((item) => item.key));
  const kept = state.queue.filter((item) => item.kind !== kind || keys.has(item.key));
  let next: CardsState = kept.length === state.queue.length ? state : { ...state, queue: kept };
  for (const item of wanted) next = enqueue(next, item);
  return next;
}

/** The card that is drawn. */
export function head(state: CardsState): Card | undefined {
  return state.queue[0];
}

/** How many cards wait behind the head. */
export function waiting(state: CardsState): number {
  return Math.max(0, state.queue.length - 1);
}
