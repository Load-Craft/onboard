# functional_save_template — contract

Tool: `functional_save_template` (module `functional`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`). Matches the catalog: yes.

## Arguments (the catalog's)

- `template_id`: uuid; without it a new template is created.
- `name`: 1 to 255 characters; required for a new template.
- `docs_id`: uuid of the API docs version the template belongs to (new template only; the backend cannot move an existing one); no default from the state.
- `fields`: object, strict keys: `api_description` (10 to 5000 characters, the backend's rule), `flow_definition` (object), `assertions` (list of objects), `endpoint_ids`
  (list of texts), `tags` (list of texts), `description`, `is_active`. An unknown key is refused locally. Their values are the backend's to check (422 → `invalid`).
- Refused locally (`invalid_arguments`, no request): a new template with no `name`, or without `api_description` and `flow_definition` in `fields`
  (`functional_template_new_needs`); a change with nothing in it (`functional_template_nothing`); `docs_id` together with `template_id`
  (`functional_template_docs_new_only`).

## Operations

New: `POST /test-templates`. Change: `GET /test-templates/{id}` once, before the write (the values now: the way back and the comparison; an auxiliary read the
catalog lists in `also_calls`), then `PUT /test-templates/{id}` with only the fields that differ. The values equal to the template's: nothing is sent (inert, no undo).
An unknown template is the backend's 404; an unknown docs version a 500 the backend gives plain-text (shown as the backend's error).

## format=data

`template` (`id`), `name` (masked), `created`, `changed` (the names of the fields written), `assertions` (how many the template holds), `not_undoable` (changed fields the backend
cannot put back: it ignores a null, so a description that was empty cannot be cleared again), `undo` (`kept`, `partial`, `none`, `withheld`, `too_large`).
**Third party:** the name passes `content()`; descriptions, the flow definition and the assertions are never shown, only counted or named.

## Text view

```
Functional template "Smoke" created [3f2a…].
```

Changed: `Functional template "Smoke" updated: name, tags.` and, when it applies, a line for what the undo cannot restore. Unchanged: `Functional template "Smoke": nothing to change.`

## Undo

- New: `undo: {tool: "functional_delete", args: {kind: "template", item_id: <id>}}` (level 3, a card and the person's yes; the entry only names it: the way is chosen with `undo_tool` in `undo_args`).
- Change: `undo: {tool: "functional_save_template", args: {template_id, name?, fields: <the previous values of the fields written>}}`. A field that was empty before (a null description) is
  not restorable (`not_undoable`); when nothing is restorable there is no undo. A previous value the secret mask would change is not kept (`withheld`), and a way back over 20000
  characters of JSON is not kept (`too_large`).

## State

Reads `ids.project_id`. Writes nothing. No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: create with a name and the two required fields (the template is in the fake, the read tools see it); change a name, tags, assertions (only the changed fields are sent); the docs version on a new one.
- Undo: create → the entry names `functional_delete` with the id, applying the deletion on the fake leaves the templates as before; change → undo restores the template (the object compared).
- Edge: nothing differs (no PUT, no undo); the local refusals; an unknown key in `fields`; a null description (not restorable, said in the view); unknown template (404); an unknown docs version (500, nothing written, no undo entry); no bound project; Polish view; log entry.
- Adversary: sentinel in the name and a previous value; instruction in the name; control sequences; a previous value with a secret gets no undo.

## Out of scope

Deleting a template (`functional_delete`), running one (`functional_start_run`).
