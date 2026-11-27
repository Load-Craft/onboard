// The outline of a flow and the generator's questions as a tool shows them: every name, path and
// text in them is a third party's (the recording, the documentation, the generator), masked by shape
// with its secrets registered and made one line (`content()`). One place for every tool that shows a
// flow: flows_get, the builders and the recording walk (FIX-76).

import type { FlowOutline, OutlineStep } from './outline.js';
import type { FlowQuestion } from './questions.js';
import { inline } from '../render/primitives.js';
import { maskText } from '../security/traceMask.js';
import { content, type CallContext } from '../tools/moduleCall.js';

const NAME_LIMIT = 200;
const TEXT_LIMIT = 300;

const mask = (ctx: CallContext, text: string, max = NAME_LIMIT, documentation = false): string =>
  content(ctx, text, max, { documentation });

function maskStep(ctx: CallContext, step: OutlineStep): OutlineStep {
  return {
    ...step,
    name: mask(ctx, step.name),
    ...(step.description === undefined
      ? {}
      : { description: mask(ctx, step.description, TEXT_LIMIT) }),
    ...(step.path === undefined ? {} : { path: mask(ctx, step.path, TEXT_LIMIT) }),
    uses: step.uses.map((name) => mask(ctx, name, 80)),
    produces: step.produces.map((name) => mask(ctx, name, 80)),
    feederVars: step.feederVars.map((name) => mask(ctx, name, 80)),
    validators: step.validators.map((name) => mask(ctx, name, 80)),
  };
}

export function maskOutline(ctx: CallContext, outline: FlowOutline): FlowOutline {
  return {
    ...outline,
    name: mask(ctx, outline.name),
    steps: outline.steps.map((step) => maskStep(ctx, step)),
  };
}

/**
 * The question and the reason are sentences LoadCraft's generator wrote (`Which token should "Checkout"
 * carry?`), not text of the target: they are read as documentation, where a plain word after a keyword
 * is a word. Read as a third party's text the mask would take `Checkout` for a token, register it, and
 * the whole answer would lose the name of that step. The field and the steps are names from the flow.
 */
export function maskQuestion(ctx: CallContext, item: FlowQuestion): FlowQuestion {
  return {
    ...item,
    field: mask(ctx, item.field, 100),
    question: mask(ctx, item.question, TEXT_LIMIT, true),
    why: mask(ctx, item.why, TEXT_LIMIT, true),
    ...(item.steps === undefined ? {} : { steps: item.steps.map((step) => mask(ctx, step, 100)) }),
  };
}

/**
 * The name a view showed for a name the model may give back as a choice (a proposal, a path of a
 * plan): masked by shape the way `content()` shows it, without registering anything. A choice is
 * matched by the raw name and by this one, so a masked name still picks its item.
 */
export function shownNameOf(name: string): string {
  return inline(maskText(name).text);
}
