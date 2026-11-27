// The debts of module project: the tools of the catalog that the module layer has not written, with why.

import type { ToolDebts } from '../../helpers/moduleClosure.js';

/**
 * The tools of the catalog that are not written in the module layer. A tool of consent level 2 or 3 asks
 * with a card (the card mechanism of the modules does not exist yet: such a tool stays out of the module
 * layer; today's tool of the same name, where there is one, keeps its registration); a costly one sends
 * model calls or traffic. The level 1 reads left are deferred: `project_get` is
 * today's tool (the module layer takes it over later).
 */
export const PROJECT_DEBTS: ToolDebts = {
  project_get: 'deferred',
  project_create: 'consent_card',
  project_set_profile: 'consent_card',
  project_delete: 'consent_card',
  project_save_env: 'consent_card',
  project_check_env: 'consent_card',
  project_import_docs: 'consent_card',
  project_analyze_setup: 'costly',
  project_apply_setup: 'consent_card',
  project_connect_telemetry: 'consent_card',
};
