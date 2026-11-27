// `functional_suggest_validators` (module functional): Suggest project-specific validators from the
// API docs and recorded runs (LLM); nothing is saved.
// The name, the description, the class, the consent level, the annotations and the card and log
// templates are the catalog's (meta.generated.ts); this file holds the input, the reads and the
// view. Consent: level 2, costly (docs/consent-card.md): one run of the model. The first call makes
// the card (the docs, the cost line) and reads nothing; a repeat with the same arguments asks the
// person; only their yes sends the one POST. Nothing is saved, so there is nothing to undo.
// The operation takes no body: the backend reads the active docs of the project. So `docs_id` is
// the docs the person is told about, and a `docs_id` that is not the active docs the state knows is
// refused before any question (`suggest_docs_not_active`).
// The proposals come back masked, whole enough (template, parameters) to be handed to
// `functional_save_validators` with `source: proposals`.
// Log: args "Suggest validators from the API docs and recorded runs", result "{count} validators
// proposed".
// Arguments (the catalog's): docs_id (required).

import type { OpOutput } from '../../http/operation.js';
import {
  cardViewSuggestValidators,
  renderSuggestValidators,
  type ProposalView,
  type SuggestValidatorsData,
} from '../../render/functional/suggestValidators.js';
import {
  callBackend,
  projectIdOf,
  refuseRule,
  thirdParty,
  type CallContext,
} from '../kit/transitional.js';
import { moduleTool, uuidArgument } from '../moduleTool.js';
import { FUNCTIONAL_SUGGEST_VALIDATORS } from './meta.generated.js';

/** POST /projects/{project_id}/validators/discover (REST API v1) */
export function discoverValidators(
  ctx: CallContext,
  path: { readonly project_id: string },
): Promise<OpOutput<'discover_validators_api_v1_projects__project_id__validators_discover_post'>> {
  return callBackend(
    ctx,
    'discover_validators_api_v1_projects__project_id__validators_discover_post',
    { path },
  );
}

const SHOWN = 20;
const NAME_LIMIT = 120;
const TEXT_LIMIT = 600;
const PARAMS_LIMIT = 800;

export const functionalSuggestValidators = moduleTool(FUNCTIONAL_SUGGEST_VALIDATORS, {
  title: 'Suggest validators from the API docs and recorded runs',
  input: {
    docs_id: uuidArgument().describe('The API docs to read (project_get_docs lists them).'),
  },
  card(ctx, args) {
    const docsId = args.docs_id.toLowerCase();
    const active = ctx.state.process()?.ids.docs_id;
    if (active !== undefined && active.toLowerCase() !== docsId) {
      refuseRule('suggest_docs_not_active');
    }
    return Promise.resolve({ facts: { docs_id: docsId } });
  },
  cardView: cardViewSuggestValidators,
  async run(ctx) {
    const answer = await discoverValidators(ctx, { project_id: projectIdOf(ctx, undefined) });
    const proposals = answer.proposals.slice(0, SHOWN).map((item): ProposalView => ({
      name: thirdParty(ctx, item.name, NAME_LIMIT),
      display_name: thirdParty(ctx, item.display_name, NAME_LIMIT),
      description: thirdParty(ctx, item.description, TEXT_LIMIT),
      template: thirdParty(ctx, item.template, TEXT_LIMIT),
      params: thirdParty(ctx, JSON.stringify(item.params), PARAMS_LIMIT),
      rationale: thirdParty(ctx, item.rationale, TEXT_LIMIT),
      bucket: thirdParty(ctx, item.bucket, 20),
      confidence: item.confidence,
      evidence_source: thirdParty(ctx, item.evidence_source, 30),
      evidence_count: item.evidence_count,
    }));
    const data: SuggestValidatorsData = {
      proposals,
      count: answer.proposals.length,
      considered: answer.considered_count,
      rejected: answer.rejected_count,
      already_in_project: answer.already_in_project,
      basis: answer.evidence_summary.basis,
    };
    return {
      status: 'done',
      data,
      update: { log: { values: { count: data.count } } },
    };
  },
  render: renderSuggestValidators,
});
