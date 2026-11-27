// The closure of module project against the catalog: every tool of the catalog is written and registered
// with its catalog entry, or is named in `debts.ts` with the reason; no tool outside the catalog is
// registered and none answers `not_implemented`.

import { describe, expect, it } from 'vitest';

import { expectModuleContract, moduleEntries } from '../../helpers/moduleClosure.js';
import { PROJECT_DEBTS } from './debts.js';

describe('module project: the catalog and the registry agree', () => {
  it('every tool of the catalog is written or a named debt; none outside the catalog; none unwritten', () => {
    expectModuleContract('project', PROJECT_DEBTS);
  });

  it('the module has the 26 tools of the catalog: 16 written, 10 debts', () => {
    const entries = moduleEntries('project');
    expect(entries).toHaveLength(26);
    expect(Object.keys(PROJECT_DEBTS)).toHaveLength(10);
  });
});
