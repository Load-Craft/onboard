// The OpenAPI skill rule: tokens with different powers get separate security schemes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACK_ROOT } from './helpers.ts';

const SKILL_DIR = join(PACK_ROOT, 'skills', 'loadcraft-openapi');
const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const contract = readFileSync(join(SKILL_DIR, 'references', 'loadcraft-contract.md'), 'utf8');

describe('security schemes for tokens of different power', () => {
  it('SKILL.md says a handed-over token is a security scheme of its own', () => {
    expect(skill).toMatch(
      /token[^.]*(different|narrower)[^.]*(power|permission)[^.]*own security scheme/i,
    );
    expect(skill).toMatch(/declares in `security` only the scheme it (actually )?accepts/i);
  });

  it('the contract states the rule and the description duty', () => {
    expect(contract).toMatch(/each kind of token gets its own security scheme/i);
    expect(contract).toMatch(/only the scheme it (actually )?accepts/i);
    expect(contract).toMatch(/names the operation that issues it[^.]*response field[^.]*exchanged/i);
    expect(contract).toMatch(/never share one scheme between tokens that are not interchangeable/i);
  });

  it('the contract example defines two schemes and the exchange operations', () => {
    expect(contract).toMatch(/pendingToken:\s*\n\s+type: http/);
    expect(contract).toMatch(/sessionToken:\s*\n\s+type: http/);
    expect(contract).toMatch(/security:\s*\n\s+- pendingToken: \[\]/);
    expect(contract).toMatch(/security:\s*\n\s+- sessionToken: \[\]/);
  });
});
