// The live gate follows an operation that ends with "call the tool again with the same arguments
// to finish" (the generation of one scenario of `scenario_generate`), and only that. `callToEnd` runs
// here against a scripted client; the whole of run 1 against the two-phase fake is in
// `liveGate.test.ts` and `liveGate.scenarios.test.ts`.

import { describe, expect, it } from 'vitest';

import {
  MAX_CONTINUATIONS,
  callToEnd,
  continuationOf,
  type CallRecord,
  type Session,
  type StepRecord,
} from '../scripts/live-gate.js';
import { en } from '../src/render/i18n/en.js';

const HANDLE = 'scenario_generation:3f9a12c4-6b7d-4e21-a8f3-0c5d9e7b1a42';
const ARGS = { name: 'gate-mix', proportions: { a: 50, b: 50 }, data_mix: 'realistic' };

/** What the plugin writes when the generation of one scenario ends: the dictionary, not a copy. */
const GENERATION_DONE = entryText('buildScenario.generationDone').replace('{flow}', 'Orders');
function entryText(key: string): string {
  const entry: unknown = (en as Record<string, unknown>)[key];
  if (typeof entry !== 'string') throw new Error(`${key} is not a plain text`);
  return entry;
}

const RUNNING = `The operation is still running in LoadCraft: ${HANDLE}.`;
const COMPOSED = 'composition "gate-mix" created · 2 scenarios';

interface Sent {
  readonly name: string;
  readonly arguments: unknown;
}

function scripted(answers: (sent: Sent, index: number) => { text: string; isError?: boolean }) {
  const sent: Sent[] = [];
  const client = {
    callTool: (request: Sent) => {
      const index = sent.length;
      sent.push(request);
      const answer = answers(request, index);
      return Promise.resolve({
        isError: answer.isError === true,
        content: [{ type: 'text', text: answer.text }],
      });
    },
  };
  const state = { calls: [] as CallRecord[], pending: undefined as string | undefined };
  const step = { calls: [] as CallRecord[], differences: [] as string[], checks: [] };
  const session = {
    client,
    config: {},
    state,
    signal: new AbortController().signal,
  } as unknown as Session;
  return { session, step: step as unknown as StepRecord, sent };
}

describe('the phrase of the plugin that asks for the same call again', () => {
  it('is read from the dictionary: the end of a generation is a continuation of scenario_generate', () => {
    expect(continuationOf(GENERATION_DONE)).toBe('scenario_generate');
  });

  it('sorts every text of the plugin that says "again with the same arguments"', () => {
    const asking = Object.entries(en)
      .filter(([, text]) => typeof text === 'string' && text.includes('again with the same'))
      .map(([key]) => key)
      .sort();
    // A new text of this kind must be sorted here: finishing an operation (the gate repeats the
    // call), or asking the user first and then trying again after a failure or a consent (the gate
    // does not repeat it: a consent card is read by `consentOf`, a failure hint is not read at all).
    expect(asking).toEqual(
      [
        'build.har.advice.retry',
        'buildScenario.generationDone',
        'data.card.next',
        'error.har_session_expired.hint',
        'error.har_split_interrupted.hint',
        'error.plan_not_received.hint',
        'error.scenario_generation_failed.hint',
      ].sort(),
    );
    for (const key of asking) {
      const text = entryText(key);
      expect(continuationOf(text) !== undefined, key).toBe(key === 'buildScenario.generationDone');
    }
  });
});

describe('callToEnd', () => {
  it('waits for the handle, then calls the same tool again with identical arguments', async () => {
    const { session, step, sent } = scripted((_request, index) => ({
      text: [RUNNING, GENERATION_DONE, COMPOSED][index] ?? 'unexpected call',
    }));
    const record = await callToEnd(session, step, 'scenario_generate', ARGS);
    expect(sent.map((request) => request.name)).toEqual([
      'scenario_generate',
      'process_wait',
      'scenario_generate',
    ]);
    expect(sent[2]?.arguments).toEqual(sent[0]?.arguments);
    expect(sent[2]?.arguments).toEqual(ARGS);
    expect(record.text).toBe(COMPOSED);
    expect(step.calls).toHaveLength(3);
    expect(step.differences.join('\n')).toContain(
      'scenario_generate called again with the same arguments',
    );
  });

  it('follows the end of a generation that came in the first result, without a handle', async () => {
    const { session, step, sent } = scripted((_request, index) => ({
      text: index === 0 ? GENERATION_DONE : COMPOSED,
    }));
    await callToEnd(session, step, 'scenario_generate', ARGS);
    expect(sent.map((request) => request.name)).toEqual(['scenario_generate', 'scenario_generate']);
  });

  it('repeats once per flow: three generations, three repeated calls', async () => {
    const texts = [
      RUNNING,
      GENERATION_DONE,
      RUNNING,
      GENERATION_DONE,
      RUNNING,
      GENERATION_DONE,
      COMPOSED,
    ];
    const { session, step, sent } = scripted((_request, index) => ({ text: texts[index] ?? 'x' }));
    const record = await callToEnd(session, step, 'scenario_generate', ARGS);
    expect(sent.filter((request) => request.name === 'scenario_generate')).toHaveLength(4);
    expect(record.text).toBe(COMPOSED);
  });

  it('does not repeat a call that ended with a result without the phrase', async () => {
    const { session, step, sent } = scripted(() => ({ text: COMPOSED }));
    await callToEnd(session, step, 'scenario_generate', ARGS);
    expect(sent).toHaveLength(1);
  });

  it('does not repeat a call whose answer is an error, even with the phrase in its hint', async () => {
    const { session, step, sent } = scripted(() => ({ text: GENERATION_DONE, isError: true }));
    await expect(callToEnd(session, step, 'scenario_generate', ARGS)).rejects.toThrow(
      /answered with an error/u,
    );
    expect(sent).toHaveLength(1);
  });

  it('does not repeat on the hint of a failure: a second try is not the end of an operation', async () => {
    for (const key of ['error.scenario_generation_failed.hint', 'error.plan_not_received.hint']) {
      const hint = entryText(key);
      const { session, step, sent } = scripted(() => ({ text: hint }));
      await callToEnd(session, step, 'scenario_generate', ARGS);
      expect(sent, key).toHaveLength(1);
    }
  });

  it('does not repeat a tool the phrase does not name', async () => {
    const { session, step, sent } = scripted(() => ({ text: GENERATION_DONE }));
    await callToEnd(session, step, 'run_start', { scenario: 'x' });
    expect(sent).toHaveLength(1);
  });

  it('gives up after MAX_CONTINUATIONS follow-up calls when the end never comes', async () => {
    const { session, step, sent } = scripted(() => ({ text: GENERATION_DONE }));
    await expect(callToEnd(session, step, 'scenario_generate', ARGS)).rejects.toThrow(
      /did not end after \d+ follow-up calls/u,
    );
    expect(sent).toHaveLength(MAX_CONTINUATIONS + 1);
  });

  it('counts waits and repeated calls together against the limit', async () => {
    const { session, step, sent } = scripted((_request, index) => ({
      text: index % 2 === 0 ? RUNNING : GENERATION_DONE,
    }));
    await expect(callToEnd(session, step, 'scenario_generate', ARGS)).rejects.toThrow(
      /did not end/u,
    );
    expect(sent).toHaveLength(MAX_CONTINUATIONS + 1);
  });
});
