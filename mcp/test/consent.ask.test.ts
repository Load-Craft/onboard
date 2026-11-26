// `confirmOnce`: the person's yes counts only for the question it answered, about the object it
// named, in the call that carries it; a client that cannot ask, and every answer but a ticked
// accept, end in the refusal.

import { describe, expect, it } from 'vitest';

import { confirmOnce, questionKey, QuestionForUser } from '../src/consent/ask.js';

const YES = { action: 'accept', content: { confirm: true } };
const refusal = new Error('refused');

const answered = (id: string, message: string, answer: unknown) => ({
  canAsk: true,
  inputResponses: { [questionKey(id, message)]: answer },
});

describe('confirmOnce', () => {
  it('goes on after a ticked yes to this very question about this very card', () => {
    expect(() => {
      confirmOnce(answered('t1', 'Delete "a"?', YES), 't1', 'Delete "a"?', refusal);
    }).not.toThrow();
  });

  it('asks again when the yes answered another card or other words', () => {
    for (const [id, message] of [
      ['t2', 'Delete "a"?'],
      ['t1', 'Delete "b"?'],
    ] as const) {
      expect(() => {
        confirmOnce(answered('t1', 'Delete "a"?', YES), id, message, refusal);
      }).toThrow(QuestionForUser);
    }
  });

  it('refuses after an unticked, declined or cancelled answer', () => {
    for (const answer of [
      { action: 'accept', content: { confirm: false } },
      { action: 'accept', content: {} },
      { action: 'decline' },
      { action: 'cancel' },
    ]) {
      expect(() => {
        confirmOnce(answered('t1', 'm', answer), 't1', 'm', refusal);
      }).toThrow(refusal);
    }
  });

  it('refuses at once when the client cannot ask anyone, answer or not', () => {
    expect(() => {
      confirmOnce({ canAsk: false }, 't1', 'm', refusal);
    }).toThrow(refusal);
    expect(() => {
      confirmOnce({}, 't1', 'm', refusal);
    }).toThrow(refusal);
  });
});
