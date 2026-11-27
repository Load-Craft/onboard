// The debts of module functional: the tools of the catalog that are not written, with why.

import type { ToolDebts } from '../../helpers/moduleClosure.js';

/**
 * The tools of the catalog that are not written. A tool of consent level 2 or 3 asks with a card (the
 * card mechanism of the modules does not exist yet: such a tool stays out of the plugin); a costly one
 * sends model calls or traffic. The two of level 1 are deferred.
 */
export const FUNCTIONAL_DEBTS: ToolDebts = {
  // the seed routes need the administrator key of the server (ADMIN_API_KEY), which no user's API token
  // carries: the tool could only ever be refused, so it is not written
  functional_import_catalog: 'consent_card',
  functional_start_run: 'costly',
};
