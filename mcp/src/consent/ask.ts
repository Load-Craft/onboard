// The user's own yes, asked by the client and not by the model: an MCP elicitation (form mode). The
// tool returns `input_required` with one question; the client shows it to the person (in Claude
// Code, a dialog of its own), and repeats the same call with the answer in `inputResponses`, which
// travel outside the arguments of the call. The model writes only arguments, so it can neither
// answer the question nor make an answer up: a call of the model, with any arguments, reads as "not
// asked yet" and gets the question. An answer is good for the one call that carries it; nothing is
// kept, so every call asks again. A client that cannot show the question (no elicitation, a run
// without a person) answers no or never answers: either way nothing is done.
//
//   confirmOnce(ctx, id, message, refusal) → returns after the person's yes to exactly this question
//                                           about `id` (a card token) in this call; else asks or throws
//   answerOf(ctx, key)                    → 'yes' | 'no' | 'unasked'
//   askUser(ctx, key, message, refusal)   → throws `QuestionForUser` (the registry turns it into
//                                           input_required), or `refusal` when the client cannot ask

import { createHash } from 'node:crypto';

import { inputRequired, inputResponse, type InputRequests } from '@modelcontextprotocol/server';
import * as z from 'zod';

import type { ToolContext } from '../context.js';

/** The form of every question: one box the person ticks. */
const confirmation = z.object({
  confirm: z.boolean().describe('Tick to confirm; leave it to refuse.'),
});

export type Answer = 'yes' | 'no' | 'unasked';

/**
 * What the person answered to question `key` in this call: `yes` only for an accepted form with the
 * box ticked; a declined, cancelled or unticked form is `no`; no answer at all is `unasked`.
 */
export function answerOf(ctx: Pick<ToolContext, 'inputResponses'>, key: string): Answer {
  const view = inputResponse(ctx.inputResponses, key);
  if (view.kind === 'missing') return 'unasked';
  if (view.kind !== 'elicit' || view.action !== 'accept') return 'no';
  const content = confirmation.safeParse(view.content);
  return content.success && content.data.confirm ? 'yes' : 'no';
}

/** Thrown by a tool that needs the person's yes; caught by the registry, never shown as an error. */
export class QuestionForUser extends Error {
  override readonly name = 'QuestionForUser';
  readonly requests: InputRequests;

  constructor(key: string, message: string) {
    super(key);
    this.requests = {
      [key]: inputRequired.elicit({ message, requestedSchema: confirmation }),
    };
  }
}

/**
 * Asks the person `message`; the call ends here and comes again with the answer. A client that
 * declares no form elicitation cannot ask anyone: then the call ends with `refusal`.
 */
export function askUser(
  ctx: Pick<ToolContext, 'canAsk'>,
  key: string,
  message: string,
  refusal: Error,
): never {
  if (ctx.canAsk !== true) throw refusal;
  throw new QuestionForUser(key, message);
}

/** Whether client capabilities declare form elicitation (an empty `elicitation` is form). */
export function declaresForm(capabilities: unknown): boolean {
  if (typeof capabilities !== 'object' || capabilities === null) return false;
  const elicitation = (capabilities as { elicitation?: unknown }).elicitation;
  if (typeof elicitation !== 'object' || elicitation === null) return false;
  const modes = Object.keys(elicitation);
  return modes.length === 0 || modes.includes('form');
}

/** The result the client fulfils by asking the person. */
export function questionResult(question: QuestionForUser): ReturnType<typeof inputRequired> {
  return inputRequired({ inputRequests: question.requests });
}

/**
 * The key of a question about `id` worded `message`: an answer is read back only for the same object
 * and the same words, so a yes given to one card or one wording never counts for another.
 */
export function questionKey(id: string, message: string): string {
  const digest = createHash('sha256').update(message).digest('hex').slice(0, 16);
  return `confirm:${createHash('sha256').update(id).digest('hex').slice(0, 16)}:${digest}`;
}

/**
 * Goes on only after the person's yes to `message` about `id` (a card token) in this very call: a
 * call without that answer asks (and ends here), a no or a client that cannot ask ends with
 * `refusal`. Nothing is kept, so every call asks again.
 */
export function confirmOnce(
  ctx: Pick<ToolContext, 'canAsk' | 'inputResponses'>,
  id: string,
  message: string,
  refusal: Error,
): void {
  const key = questionKey(id, message);
  const answer = answerOf(ctx, key);
  if (answer === 'yes') return;
  if (answer === 'no') throw refusal;
  askUser(ctx, key, message, refusal);
}
