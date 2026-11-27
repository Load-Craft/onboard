// The contract and the fixture must be valid AsyncAPI 3.0 for the official parser, not only for
// the profile validator of the skill (which does not check where an operation's messages live).
// The parser is a dev dependency of the tests; nothing of it reaches dist.

import { readFileSync } from 'node:fs';

import { Parser } from '@asyncapi/parser';
import { describe, expect, it } from 'vitest';

/** Severity 0 of a Spectral diagnostic: an error (1 and 2 are warnings and hints). */
const ERROR = 0;

const FILES = {
  'contracts/loadcraft-asyncapi.json': new URL(
    '../../contracts/loadcraft-asyncapi.json',
    import.meta.url,
  ),
  'the generator fixture': new URL('./fixtures/gen-clients/mini.asyncapi.json', import.meta.url),
};

describe('official AsyncAPI parser', () => {
  it.each(Object.entries(FILES))(
    'accepts %s without errors',
    async (_name, url) => {
      const { document, diagnostics } = await new Parser().parse(readFileSync(url, 'utf8'));
      const errors = diagnostics
        .filter((d) => Number(d.severity) === ERROR)
        .map((d) => `${d.code} ${JSON.stringify(d.path)} ${d.message}`);
      expect(errors).toEqual([]);
      expect(document).toBeDefined();
    },
    60_000,
  );

  it('rejects an operation message that is not a message of its channel', async () => {
    const doc = JSON.parse(readFileSync(FILES['contracts/loadcraft-asyncapi.json'], 'utf8')) as {
      operations: Record<string, { messages: { $ref: string }[] }>;
    };
    const op = Object.values(doc.operations)[0];
    if (op === undefined) throw new Error('no operation');
    op.messages = [{ $ref: '#/components/messages/RefineProgress' }];
    const { diagnostics } = await new Parser().parse(JSON.stringify(doc));
    expect(diagnostics.some((d) => Number(d.severity) === ERROR)).toBe(true);
  }, 60_000);
});
