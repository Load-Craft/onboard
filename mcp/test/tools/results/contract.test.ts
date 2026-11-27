// The closure of module results against the catalog: every tool of the catalog is a written tool of
// the module with its catalog entry, or is named as a debt with the reason; no tool outside the
// catalog is registered in the module and none answers `not_implemented`.

import { describe, expect, it } from 'vitest';

import { expectModuleContract, moduleEntries } from '../../helpers/moduleClosure.js';
import { RESULTS_DEBTS } from './debts.js';

describe('module results: the catalog and the registry agree', () => {
  it('every tool of the catalog is written or a named debt; none outside the catalog; none unwritten', () => {
    expectModuleContract('results', RESULTS_DEBTS);
  });

  it('the module has the 10 tools of the catalog: 6 written, 4 debts', () => {
    expect(moduleEntries('results')).toHaveLength(10);
    expect(Object.keys(RESULTS_DEBTS)).toHaveLength(4);
  });
});
