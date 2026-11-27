# functional: suggest_validators — contract

Tool: `functional_suggest_validators` (module `functional`, `moduleTool` on a consent card; costly, level 2; text view and `format: "data"`; the
description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`). Nothing is saved.
Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

- `docs_id`: UUID, required (no default from the state). The operation takes no body: the backend reads the active docs of the project, so a
  `docs_id` that is not the active docs the state knows is refused before any question (rule `suggest_docs_not_active`, `invalid_arguments`).
  The project is the bound one.
- No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat): none; the card is made from the arguments alone and sends no request, not even a read.
After the person's yes: `POST /projects/{id}/validators/discover` (one model run; 503 without a configured model, 502 on a provider failure).

## The card

Facts (hashed): `docs_id`. Lines: the docs read and the recorded runs. Cost line (the catalog names one): one LLM run, nothing is saved. Undo
line: nothing to undo.

## format=data (the result)

`proposals` (at most 20: `name`, `display_name`, `description`, `template`, `params` as JSON text, `rationale`, `bucket`, `confidence`,
`evidence_source`, `evidence_count`), `count`, `considered`, `rejected`, `already_in_project`, `basis` (`no_operations`, `schema_only`,
`recorded_responses`). All texts pass `content()`; the template and the parameters are whole enough to be passed to
`functional_save_validators` with `source: proposals` (the view says how).

## Log and undo

args `Suggest validators from the API docs and recorded runs`, result `{count} validators proposed`; call 1 is `queued`, the one that ran
carries `consent.via: client_dialog`. No undo (`reversible: nothing`).

## State

Reads `ids.project_id` and `ids.docs_id` (the active docs); writes nothing.

## Test cases

`test/tools/functional/suggestValidators.test.ts`: the card with the cost line (no request), Polish, the yes (one POST, the full text,
no undo), no proposals, more than 20, no/declined/cancelled, no confirming argument, a client without elicitation, the docs rule, a refusal
of the backend, secrets. Sentinel cases in `canary.ts`; the operation in `coverage.test.ts`.
