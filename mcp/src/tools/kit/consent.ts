// The consent card of a module tool (docs/consent-card.md). A tool of consent level 2 or 3 never
// runs on the word of the model: its first call makes a card (what will happen, on what, the cost,
// whether it can be undone) and does nothing; a repeat with the same arguments finds the card, the
// server asks the person in a dialog of the client, and only their yes there runs the tool, once.
//
// The block joins the two mechanisms today's tools already have and adds none: the saved card of
// `consent/confirmCard.ts` (up to five per tool and project, 30 minutes, each used once) and the question of
// `consent/ask.ts` (an MCP elicitation, answered outside the arguments the model writes).
//
//   runOnACard(meta, spec, ctx, args) → the card (`consent: "needed"`), or the outcome of `run`
//   asksOnACard(meta)                 → whether the catalog entry is one this block may ask for
//
// What keeps the rules: the card holds two hashes (arguments, facts) and no value, so the state file
// has nothing of the card to leak or to mask; `card` gets an HTTP client that refuses a write; the
// token of a card never reaches the model; `personSaysYes` is the only place that knows the channel
// of the decision.

import { createHash } from 'node:crypto';

import { confirmOnce } from '../../consent/ask.js';
import {
  CARD_TTL_MINUTES,
  canonical,
  currentCard,
  discardCard,
  issueCard,
  sameFrozen,
} from '../../consent/confirmCard.js';
import type { ToolContext, Translator } from '../../context.js';
import { ToolError } from '../../errors.js';
import type { HttpClient } from '../../http/client.js';
import type { Link, ToolOutcome } from '../../outcome.js';
import {
  renderConsentQuestion,
  type CardRenewed,
  type CardView,
  type ConsentCardData,
} from '../../render/consentCard.js';
import { projectIdOf } from '../moduleState.js';

export type { CardView, ConsentCardData } from '../../render/consentCard.js';

/** What the block reads of a catalog entry (a part of `ToolMeta`). */
export interface CardMeta {
  readonly name: string;
  readonly class: string;
  readonly secret: boolean;
  readonly consent: {
    readonly level: 1 | 2 | 3;
    readonly level3_reason: string | null;
    readonly target_traffic: string | null;
    readonly cost: string | null;
    readonly [key: string]: unknown;
  };
  readonly undo: { readonly reversible: string | null };
  readonly install_allow: boolean | null;
}

/** The reasons of level 3 a card may carry; a tool of any other reason is out of scope. */
const CARD_REASONS: readonly (string | null)[] = [null, 'delete', 'schedule', 'external'];

/**
 * Whether a tool may be written on the card: level 2 or 3, the level fixed (not by argument), no
 * secret in or out, no traffic to the target, a reason the card knows, and never pre-allowed at
 * install. Any other tool stays a scaffold.
 */
export function asksOnACard(meta: CardMeta): boolean {
  const { consent } = meta;
  return (
    (consent.level === 2 || consent.level === 3) &&
    consent['by_argument'] === null &&
    Array.isArray(consent['escalate_to_3']) &&
    consent.target_traffic === null &&
    CARD_REASONS.includes(consent.level3_reason) &&
    !meta.secret &&
    !meta.class.includes('secret') &&
    meta.install_allow !== true
  );
}

/**
 * Whether a tool of level 1 may be written on the card for the calls that meet an escalation of the
 * catalog (`consent.by_argument`, `consent.escalate_to_3`): such a call asks at level 3, every other
 * runs at once like any level-1 tool. The rest of the rules of `asksOnACard` hold.
 */
export function asksConditionally(meta: CardMeta): boolean {
  const { consent } = meta;
  const byArgument = consent['by_argument'];
  const escalations = consent['escalate_to_3'];
  return (
    consent.level === 1 &&
    typeof byArgument === 'object' &&
    byArgument !== null &&
    'level' in byArgument &&
    byArgument.level === 3 &&
    Array.isArray(escalations) &&
    escalations.length > 0 &&
    consent.target_traffic === null &&
    consent.level3_reason === null &&
    !meta.secret &&
    !meta.class.includes('secret') &&
    meta.install_allow !== true
  );
}

/** Facts a card shows and is not bound to: a value that moves by itself (the next start of a schedule). */
export type Volatile = Readonly<Record<string, string | number | boolean | null>>;

/** What a call would do, read before anything is asked. */
export interface Card<C> {
  /**
   * The facts the card shows and is bound to: masked by the tool, the same on every call for the
   * same state of the backend. A fact that changes between the card and the yes makes a new card.
   */
  readonly facts: C;
  /** An escalation of the catalog entry (`consent.escalate_to_3`) this call meets: a level-3 card. */
  readonly escalation?: string;
  /**
   * Values the card shows that move by themselves: they are in the view, not in the hash that binds
   * the card, so a start of a schedule between the card and the yes does not make a new card.
   */
  readonly volatile?: Volatile;
  /** Where the person can do it by hand, for the refusal; default: the list of projects. */
  readonly link?: Link;
}

/** The values are already as given: nothing would be sent, so nothing is asked. */
export interface Unchanged<D> {
  readonly unchanged: D;
}

/**
 * The call does not meet the escalation: it runs at once as a level-1 tool, without a card. Only a tool
 * of `asksConditionally` may answer it, and only from facts `card` read from the backend, never from an
 * argument the model chose to leave out.
 */
export interface Proceed {
  readonly proceed: true;
}

/** The three functions of a tool on a card. */
export interface CardSpec<A, C, D> {
  /** Reads only (the HTTP client it gets refuses a write). Throws to refuse before any question. */
  card(ctx: ToolContext, args: A): Promise<Card<C> | Unchanged<D> | Proceed>;
  /** The card in words, from the facts: what will happen, on what, the cost, the undo. */
  cardView(facts: C, t: Translator, volatile: Volatile): CardView;
  /**
   * Runs only after the person's yes to exactly this card; `null` facts: the call went on without a
   * card (`Proceed`), so `run` reads again what it must check.
   */
  run(ctx: ToolContext, args: A, facts: C | null): Promise<ToolOutcome<D>>;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE']);

function refuseWrite(tool: string, method: string): never {
  throw new TypeError(
    `${tool}: the card of a tool only reads; ${method} was refused before the person's yes`,
  );
}

/** The context `card` works in: the same call, with an HTTP client that sends reads only. */
function readOnly(tool: string, ctx: ToolContext): ToolContext {
  type Request = (method: string, ...rest: unknown[]) => unknown;
  const http = new Proxy(ctx.services.http, {
    get(target, property, receiver): unknown {
      if (property === 'request') {
        const request = Reflect.get(target, property, receiver) as Request;
        return (method: string, ...rest: unknown[]): unknown =>
          READ_METHODS.has(method.toUpperCase())
            ? Reflect.apply(request, target, [method, ...rest])
            : refuseWrite(tool, method.toUpperCase());
      }
      if (typeof property === 'string' && WRITE_METHODS.has(property)) {
        return (): never => refuseWrite(tool, property);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) satisfies HttpClient;
  return { ...ctx, services: { ...ctx.services, http } };
}

/** The key the card of a call is kept under when the workspace has no project yet. */
const NO_PROJECT = '_new';

function projectKey(ctx: ToolContext): string {
  try {
    return projectIdOf(ctx, undefined);
  } catch (error) {
    if (error instanceof ToolError && error.code === 'no_project') return NO_PROJECT;
    throw error;
  }
}

const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value)).digest('hex');

/** The arguments a card is bound to: all but `format`, which only chooses the view. */
function boundArguments(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return args;
  return Object.fromEntries(Object.entries(args).filter(([name]) => name !== 'format'));
}

/** The reason of a level-3 card: the escalation the call met, else the reason of a level-3 tool. */
function reasonOf(meta: CardMeta, escalation: string | undefined): string | null {
  if (escalation === undefined) return meta.consent.level === 3 ? meta.consent.level3_reason : null;
  const known = meta.consent['escalate_to_3'];
  if (!Array.isArray(known) || !known.includes(escalation)) {
    throw new TypeError(
      `${meta.name}: escalation ${JSON.stringify(escalation)} is none of consent.escalate_to_3 of its catalog entry`,
    );
  }
  return escalation;
}

function reversibleOf(meta: CardMeta): ConsentCardData<unknown>['reversible'] {
  const { reversible } = meta.undo;
  if (reversible === 'yes' || reversible === 'no' || reversible === 'nothing') return reversible;
  throw new TypeError(`${meta.name}: a tool on a card says whether it can be undone`);
}

type LogValues = Record<string, string | number | boolean>;

/** The plain fields of the facts, for the slots of the log entry of the card (`{name}`). */
function logValues(facts: unknown): LogValues {
  if (typeof facts !== 'object' || facts === null) return {};
  const values: LogValues = {};
  for (const [key, value] of Object.entries(facts)) {
    if (key === '' || key.length > 32) continue;
    if (typeof value === 'string') values[key] = value.slice(0, 120);
    if (typeof value === 'number' || typeof value === 'boolean') values[key] = value;
  }
  return values;
}

/**
 * Where the decision comes from: the one function to change when the channel changes. Today the
 * server asks the person in a dialog of the client (`confirmOnce`): the call ends with the question
 * and comes again with the answer, which travels outside the arguments. Returns after a yes to
 * exactly `question` about the card `token`; throws `refusal` for a no and for a client that cannot ask.
 */
function personSaysYes(ctx: ToolContext, token: string, question: string, refusal: Error): void {
  confirmOnce(ctx, token, question, refusal);
}

/** One call of a tool on a card: the card, or (after the person's yes to it) the tool's own outcome. */
export async function runOnACard<A, C, D>(
  meta: CardMeta,
  spec: CardSpec<A, C, D>,
  ctx: ToolContext,
  args: A,
): Promise<ToolOutcome<D | ConsentCardData<C>>> {
  const read = await spec.card(readOnly(meta.name, ctx), args);
  if ('unchanged' in read) return { status: 'done', data: read.unchanged, inert: true };
  const conditional = asksConditionally(meta);
  if ('proceed' in read) {
    // fail closed: a tool that always asks never goes on without a card
    if (!conditional) {
      throw new TypeError(
        `${meta.name}: only a tool that asks by argument may go on without a card`,
      );
    }
    return spec.run(ctx, args, null);
  }
  const { facts } = read;
  // a level-1 tool never asks at level 2: its card is the escalation, or it is no card
  if (conditional && read.escalation === undefined) {
    throw new TypeError(
      `${meta.name}: a card of a tool that asks by argument names its escalation`,
    );
  }
  const why = reasonOf(meta, read.escalation);
  const volatile = read.volatile ?? {};
  const shared = {
    tool: meta.name,
    costly: meta.consent.cost !== null,
    reversible: reversibleOf(meta),
    why,
  } as const;
  const frozen = { args: digest(boundArguments(args)), facts: digest({ facts, why }) };
  const scope = meta.name;
  const key = projectKey(ctx);
  const refusal = new ToolError('consent_missing', {
    params: { link: (read.link ?? ctx.services.links.projects()).url },
  });
  const kept = currentCard(ctx, scope, key, frozen);
  if (kept.ok && sameFrozen(kept.frozen, frozen)) {
    const question = ctx.secrets.scrub(
      renderConsentQuestion(shared, spec.cardView(facts, ctx.t, volatile), ctx.t),
    );
    try {
      personSaysYes(ctx, kept.token, question, refusal);
    } catch (error) {
      // a no, or nobody to ask: the card is gone, so the next call starts from a card again
      if (error === refusal) await discardCard(ctx, scope, key, kept.token);
      throw error;
    }
    // used before anything is sent: a card never runs twice, whatever `run` meets
    await discardCard(ctx, scope, key, kept.token);
    const outcome = await spec.run(ctx, args, facts);
    return outcome.status === 'done' ? { ...outcome, consent: 'given' } : outcome;
  }
  // a client that cannot ask the person can never get a yes: no card is made for it
  if (ctx.canAsk !== true) throw refusal;
  const renewed: CardRenewed | undefined = kept.ok
    ? 'changed'
    : kept.reason === 'expired'
      ? 'expired'
      : undefined;
  await issueCard(ctx, scope, key, frozen);
  const data: ConsentCardData<C> = {
    consent: 'needed',
    ...shared,
    level: why === null ? 2 : 3,
    card: facts,
    ...(Object.keys(volatile).length === 0 ? {} : { volatile }),
    valid_minutes: CARD_TTL_MINUTES,
    ...(renewed === undefined ? {} : { renewed }),
  };
  return {
    status: 'done',
    data,
    inert: true,
    consent: 'asked',
    update: { log: { values: logValues(facts) } },
  };
}
