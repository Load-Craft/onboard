// Consent cards of level-2 tools until the general cards of the process state exist: a tool that would
// write first returns a card and keeps here exactly what the write will do (its frozen arguments); the
// write happens only on a later call that hands back the card's token, and it takes its arguments from
// the card, never from that call. One card per tool scope and project: a new card replaces the old one.
//
//   issueCard(ctx, scope, projectId, frozen)  → token (the card is saved; valid `CARD_TTL_MINUTES`)
//   redeemCard(ctx, scope, projectId, token)  → { ok: true, frozen } | { ok: false, reason }
//   consumeCard(ctx, scope, projectId, token) → redeemCard, and a valid card is gone at once (the write)
//   discardCard(ctx, scope, projectId)        → the card is gone (after the write, a 409, a new import)
//
// The token is bound to the scope, the project and the frozen arguments, with a random part, so a card
// issued again (even with the same arguments) has another token, and a used card cannot be used twice:
// the caller discards it after the write. Cards live in the cache section `drafts` under `card:` keys.

import { createHash, randomBytes } from 'node:crypto';

import * as z from 'zod';

import type { ToolContext } from '../context.js';

/** How long a card stays valid: the grant time of a level-2 card in the tool catalog. */
export const CARD_TTL_MINUTES = 30;
const TOKEN_LENGTH = 16;

type CardContext = Pick<ToolContext, 'state' | 'clock'>;

const cardSchema = z.object({
  token: z.string(),
  issuedAt: z.number(),
  frozen: z.record(z.string(), z.unknown()),
});

const cardKey = (scope: string, projectId: string): string => `card:${scope}:${projectId}`;

/** JSON with the keys of every object sorted, so equal arguments give one text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Saves the card of `frozen` (replacing the scope's earlier card) and returns its token. */
export async function issueCard(
  ctx: CardContext,
  scope: string,
  projectId: string,
  frozen: Readonly<Record<string, unknown>>,
): Promise<string> {
  const issuedAt = ctx.clock.now();
  const token = createHash('sha256')
    .update(
      canonical({ scope, projectId, frozen, issuedAt, nonce: randomBytes(8).toString('hex') }),
    )
    .digest('hex')
    .slice(0, TOKEN_LENGTH);
  await ctx.state.set('drafts', cardKey(scope, projectId), { token, issuedAt, frozen });
  return token;
}

export type Redeemed =
  | { readonly ok: true; readonly frozen: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: 'missing' | 'expired' | 'token' };

/** The frozen arguments of the scope's card when `token` is its token and it has not expired. */
export function redeemCard(
  ctx: CardContext,
  scope: string,
  projectId: string,
  token: string,
): Redeemed {
  const parsed = cardSchema.safeParse(ctx.state.get('drafts', cardKey(scope, projectId))?.value);
  if (!parsed.success) return { ok: false, reason: 'missing' };
  if (ctx.clock.now() - parsed.data.issuedAt > CARD_TTL_MINUTES * 60_000) {
    return { ok: false, reason: 'expired' };
  }
  if (parsed.data.token !== token) return { ok: false, reason: 'token' };
  return { ok: true, frozen: parsed.data.frozen };
}

/**
 * `redeemCard` and, when the card is valid, its removal in the same step: the write that uses a card
 * uses it up, whatever happens next, so a token never writes twice.
 */
export async function consumeCard(
  ctx: CardContext,
  scope: string,
  projectId: string,
  token: string,
): Promise<Redeemed> {
  const redeemed = redeemCard(ctx, scope, projectId, token);
  if (redeemed.ok) await discardCard(ctx, scope, projectId);
  return redeemed;
}

/** Removes the scope's card, if there is one. */
export async function discardCard(
  ctx: CardContext,
  scope: string,
  projectId: string,
): Promise<void> {
  if (ctx.state.get('drafts', cardKey(scope, projectId)) === undefined) return;
  await ctx.state.delete('drafts', cardKey(scope, projectId));
}

/** Whether two argument values are the same for a card (key order and `undefined` keys aside). */
export function sameFrozen(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** Why a confirm got a new card instead of the write: no card, expired, another token, other arguments. */
export type CardRenewalReason = 'missing' | 'expired' | 'token' | 'changed';

/**
 * How many calls one yes to a card of a group of consent covers, the confirmed one included
 * (`consent.max_calls_per_card` of the tool catalog); for as long as a card stays valid.
 */
export const GRANT_CALLS = 8;

/** A call an earlier yes covered: how many calls it covered so far (the confirmed one is the first). */
export interface Granted {
  readonly used: number;
  readonly limit: number;
}

/** What a gate decided: the write goes ahead, or the user answers a card first. */
export type CardGate =
  /** `granted`: an earlier yes covered the call, no card was shown for it. */
  | { readonly write: true; readonly granted?: Granted }
  | { readonly write: false; readonly token: string; readonly renewed?: CardRenewalReason };

export interface GateOptions {
  /**
   * The group of consent of the tool in the catalog (`consent.scope.group`): a yes to one card of the
   * group covers the next calls of the group, up to `GRANT_CALLS` within `CARD_TTL_MINUTES`.
   */
  readonly group?: string | undefined;
  /**
   * The call always needs its own card and its own yes (a level-3 escalation of the catalog, such as a
   * file with secrets): no earlier yes covers it, and its yes covers nothing else.
   */
  readonly own?: boolean;
}

const grantKey = (group: string, projectId: string): string => `grant:${group}:${projectId}`;

const grantSchema = z.object({ at: z.number(), used: z.number().int() });

/** The yes of a group still covering calls: given within the card time and not used up. */
function liveGrant(ctx: CardContext, group: string, projectId: string): number | undefined {
  const parsed = grantSchema.safeParse(ctx.state.get('drafts', grantKey(group, projectId))?.value);
  if (!parsed.success) return undefined;
  const fresh = ctx.clock.now() - parsed.data.at <= CARD_TTL_MINUTES * 60_000;
  return fresh && parsed.data.used < GRANT_CALLS ? parsed.data.used : undefined;
}

/**
 * The card of one write. Without `confirm`, a new card of `frozen` (nothing is written), unless a yes
 * the user gave to a card of the same group still covers the call. With the token of the scope's card
 * and the same `frozen`, the write: the card is used up, and the yes starts covering the group. Any
 * other confirm (no card, an expired or replaced one, other arguments) gets a new card and says why.
 */
export async function cardGate(
  ctx: CardContext,
  scope: string,
  projectId: string,
  frozen: Readonly<Record<string, unknown>>,
  confirm: string | undefined,
  options: GateOptions = {},
): Promise<CardGate> {
  const group = options.own === true ? undefined : options.group;
  if (confirm === undefined && group !== undefined) {
    const used = liveGrant(ctx, group, projectId);
    if (used !== undefined) {
      const at = grantSchema.parse(ctx.state.get('drafts', grantKey(group, projectId))?.value).at;
      await ctx.state.set('drafts', grantKey(group, projectId), { at, used: used + 1 });
      return { write: true, granted: { used: used + 1, limit: GRANT_CALLS } };
    }
  }
  let renewed: CardRenewalReason | undefined;
  if (confirm !== undefined) {
    const redeemed = await consumeCard(ctx, scope, projectId, confirm.trim());
    if (redeemed.ok && sameFrozen(redeemed.frozen, frozen)) {
      if (group === undefined) return { write: true };
      await ctx.state.set('drafts', grantKey(group, projectId), { at: ctx.clock.now(), used: 1 });
      return { write: true };
    }
    renewed = redeemed.ok ? 'changed' : redeemed.reason;
  }
  const token = await issueCard(ctx, scope, projectId, frozen);
  return { write: false, token, ...(renewed === undefined ? {} : { renewed }) };
}
