// The questions the generator left open on a flow (`needs_input` of its detail) and how many of them
// there are: pure readings of a flow, shared by the tools that show one (`flows_get`, the status).

import type { components } from '../http/generated/api.js';
import type { FlowNeeds } from './needsInput.js';

export type FlowDetail = components['schemas']['FlowDetail'];

/** A gap the generator could not fill: an item of `needs_input` of the flow. */
export interface FlowQuestion {
  field: string;
  question: string;
  why: string;
  /** The kind as the backend names it; a kind it does not type is given as it was stored. */
  kind: string;
  /** The steps the item is about (`credential_scheme`: the steps that carry the token). */
  steps?: string[];
  /** The documentation proves the steps fail: they get 401 as built. */
  definite?: boolean;
}

type NeedsInputItem = components['schemas']['NeedsInputItem'];

function questionOf(item: NeedsInputItem): FlowQuestion | undefined {
  const steps = (item.steps ?? []).filter((step) => step !== '');
  const question: FlowQuestion = {
    field: item.field ?? '',
    question: item.question ?? '',
    why: item.why ?? '',
    kind: item.kind ?? item.kind_raw ?? '',
    ...(steps.length === 0 ? {} : { steps }),
    ...(item.definite === true ? { definite: true } : {}),
  };
  return question.question === '' ? undefined : question;
}

/** The items the generator left open on a flow (`needs_input` of its detail), with a question. */
export function flowQuestions(flow: Pick<FlowDetail, 'needs_input'>): FlowQuestion[] {
  return (flow.needs_input ?? [])
    .map(questionOf)
    .filter((item): item is FlowQuestion => item !== undefined);
}

/** The open items of a flow read in full. */
export function needsOfDetail(flow: Pick<FlowDetail, 'id' | 'needs_input'>): FlowNeeds {
  const items = flow.needs_input ?? [];
  return {
    id: flow.id,
    count: items.length,
    definite: items.filter((item) => item.definite === true).length,
  };
}
