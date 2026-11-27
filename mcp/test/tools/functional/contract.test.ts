// The closure of module functional against the catalog: every tool of the catalog is written and
// registered with its catalog entry, or is named here as a debt with the reason; no tool outside the
// catalog is registered and none answers `not_implemented`.

import { describe, expect, it } from 'vitest';

import { expectModuleContract, moduleEntries } from '../../helpers/moduleClosure.js';
import { FUNCTIONAL_DEBTS } from './debts.js';

describe('module functional: the catalog and the registry agree', () => {
  it('every tool of the catalog is written or a named debt; none outside the catalog; none unwritten', () => {
    expectModuleContract('functional', FUNCTIONAL_DEBTS);
  });

  it('the module has the 22 tools of the catalog: 20 written, 2 debts', () => {
    const entries = moduleEntries('functional');
    expect(entries).toHaveLength(22);
    expect(Object.keys(FUNCTIONAL_DEBTS)).toHaveLength(2);
  });
});
