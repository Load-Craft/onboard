# Recipe template CONSENT

Use it in steps 10 and 11 when the tool has consent level 2 or 3 (`consent.card` in the catalog is not null). Design: `docs/consent-card.md`.
Models: `data_update_dataset` (write, undo), `data_regenerate_dataset` (cost line), `scenario_delete` (level 3, no undo). Copy their shape.
`kind: process` (long work): see `docs/recipe/templates/long-operation.md`. Out of scope, STOP `S-03`: `secret: true`, `consent.by_argument`, `target_traffic`, a reason other than `delete`, a list of targets.

## The overload

`moduleTool(META, { title, input, card, cardView, run, render })`. Without `card` the tool stays a scaffold. The model has no argument that
carries consent: add none (`confirm`, `token`, `yes` are refused). The same arguments twice = card, then the person's yes in the client dialog.

## `card(ctx, args)` - reads only

1. Rules first (`refuseRule`), before any request. A deletion takes exactly one target: `one_of` and `at_least_one` rules, no default from the state.
2. Read what the call touches (`GET`; the client refuses a write here). Add the reader beside `run`. A missing object is `not_found` by itself.
3. Nothing would change: `return { unchanged: <data of the result with changed: []> }` (no card, no question).
4. Else `return { facts }`. Facts are plain, masked (`thirdParty`), the same on every call for the same backend state: ids, names, counts, a size and a
   sha256 of a file. Never a cell, a secret, a token or the text of a file. Lists: at most 20 names plus the count.
5. The call meets an `escalate_to_3` entry of the catalog (for example `file` -> `secret_ref`): `return { facts, escalation: 'secret_ref' }`.
6. A deletion: refuse before any question when a test or an operation runs on it (`busy`, `unchecked`, `liveOperation`, `readRuns` of `src/tools/delete/checks.ts`).
7. A top-level string or number of `facts` named like a log slot (`name`, `kind`, `names`) fills the log entry of call 1.
8. Several reads: `settleAll([...])`, never `Promise.all`. A read that may fail: `null` for unknown, shown as unknown.

## `cardView(facts, t)`

`{ title, lines, cost?, undo }`, all from dictionary keys `<tool_name>.card.*` (a plural entry: `t.plural(key, count, params)`).
`cost` exactly when the catalog entry names a cost (`consent.cost` not null), never otherwise. `undo` words the way back (the block adds
"Can be undone:", "Cannot be undone:" from `undo.reversible`). The title is a sentence with the name, for example `Update dataset "{name}"`.
Lines: what changes (from -> to), what is read or sent (file path, rows, size, 12 characters of the hash), what leaves, what stays.

## `run(ctx, args, facts)` - only after the yes

Re-read what the write needs (a whole-document PUT needs the current object). A file: read again, compare its sha256 with `facts`, else a code of
the module (`data_file_changed`). Send the write. Return `{ status: 'done', data, update: { log: { values, undo_args } } }`.

- `values`: the slots of the catalog `log.result` (`{count}`, `{rows}`, `{names}`, `{kind}`).
- Undo: the catalog lists the ways. `undo_args: { undo_tool: '<way tool>', ...args }` picks one; without `undo_tool` the first way is used. A previous
  value that holds a secret (`ctx.secrets.containsSecret`): no `undo_args`, the data says `withheld`. `reversible: no`: no `undo_args`.
- Never write the process yourself; `update.unset: ['composition_id']` only when the state holds the deleted id.

## Texts and files

- View: `src/render/<module>/<tool>.ts` exports `cardView<Tool>`, `render<Tool>` and the facts and data types. Keys in both dictionaries, `.pl.ts`
  has every key (a plural has `one`, `few`, `many`, `other`). Rule keys `error.invalid_arguments.rule.<object>_<kind>` in `en.ts` and `pl.ts`.
- A code of the module needs a message and a hint in both dictionaries and a row in `skills/loadcraft-test/references/errors-<module>.md`.
- Never import `src/api`: only `kit/transitional.ts`, `../delete/checks.js`, `src/security/*` and the module's own readers.
- Fake backend: add the missing routes to `test/fake-backend/routes/<module>Writes.ts` (a 204 is `{ status: 204 }`; the fake checks answers against the contract).
- Contract: `docs/tools/<module>/<tool>.md` with sections Arguments, Operations, The card, format=data, Log and undo, State, Test cases.
- Skill sentence: one paragraph in the step file: only on the user's word; the first call is a card, tell the user what it says, call again with the same
  arguments; the user confirms in a dialog; name the undo or say it cannot be undone.

## Tests (`test/tools/<module>/<tool>.test.ts`)

Rig: `<module>Rig` with `elicit: answering(person())` from `test/helpers/consentPerson.ts` (`person`, `answering`, `writesOf`). One `it` per line:

1. the catalog entry (`expectCatalogEntry`) and `implemented`;
2. call 1: the full text of the card, no write (`writesOf` empty), nobody asked, the log entry `queued`, one card kept in `state.json` drafts;
3. call 2 with the same arguments: the write happened (the object in the fake compared), the log entry has `consent: { via: 'client_dialog' }` and
   the undo, the card is gone, the question text holds the lines of the card;
4. the undo of the entry run for real (a second card and yes), or `no undo`;
5. `unticked`, `declined`, `cancelled`: `consent_missing`, no write, no card kept;
6. other arguments after call 1: a new card (`this is a new one`), nobody asked, no write; a change of the object after the card: a new card;
7. the model cannot confirm: `confirm`, `consent`, `token` are refused (not `not_implemented`), no card, no write;
8. a client that cannot ask (`who: null`): `consent_missing` on every call, no card;
9. each rule: `invalid_arguments`, no request; unknown object `not_found`; arguments outside the catalog; Polish view; level 3 text for an escalation;
10. secret sentinel: the secret in names, descriptions and file cells never in the card, the question, the data or `state.json`; two cases in
    `test/tools/<module>/canary.ts`: `personSaysYes: true` with the card alone, and with `before: drive.once(tool, args)` for the run after the yes.

## Lessons of the module functional (six tools)

- Catalog arguments have no arrays of objects: a list of items is `items`, an object (key: the name or the id, value: its fields), counted locally (rule `<object>_items_count`).
- Free fields: one strict zod object (the union of all fields) and an allowed list per mode; a field outside it is the rule `<object>_field_unknown`. Facts show a short value as text, a long one by its size: `factOf`, `fieldLine` (`consentFields`).
- The catalog lists the undo ways in its own order: pass `undo_tool` whenever the way you mean is not the first. The undo of an addition names `functional_delete` with `kind` and `item_id`; several added at once: no `undo_args`, the view says "delete them one at a time".
- A card that reads nothing sends no request: its sentinel case needs `local: true`. A call whose operation has no such argument (`docs_id`): check it against the state before the card.
- A seed or admin route may need a server key no token has: read its auth in the backend first, else STOP `S-03` (the tool was dropped for that).
- Module codes live in `<module>.en.ts` and `.pl.ts` (not `en.ts`) and in `errors-<module>.md`; rule keys stay in `en.ts` and `pl.ts`. In the skill sentence use only known tools and arguments (`test:skills`).
- Closure: remove the tool from `debts.ts`, fix the counts of `contract.test.ts`, call it twice (`elicit: yes`) in `coverage.test.ts`, run `npm run update:shared`.
