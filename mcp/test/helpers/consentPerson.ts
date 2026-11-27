// The person behind the client in the tests of tools on a consent card (docs/consent-card.md): what
// they answer to the server's question, and what they were asked. Plus the writes the backend saw.

import type { Elicitor } from './mcp.js';
import type { ToolRig } from './rig.js';

export interface Person {
  answer: 'yes' | 'unticked' | 'declined' | 'cancelled';
  /** The questions the client showed, in order. */
  readonly asked: string[];
  /** Happens while the question is on the screen. */
  during?: () => void;
}

export const person = (answer: Person['answer'] = 'yes'): Person => ({ answer, asked: [] });

export const answering =
  (who: Person): Elicitor =>
  ({ message }) => {
    who.asked.push(message);
    who.during?.();
    if (who.answer === 'declined') return { action: 'decline' };
    if (who.answer === 'cancelled') return { action: 'cancel' };
    return { action: 'accept', content: { confirm: who.answer === 'yes' } };
  };

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The requests that change something, as `METHOD path` without the project prefix. */
export const writesOf = (r: ToolRig, project: string): string[] =>
  r.fake.calls
    .filter((call) => WRITES.has(call.method))
    .map((call) => `${call.method} ${call.path.replace(`/api/v1/projects/${project}`, '')}`);
