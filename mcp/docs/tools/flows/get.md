# flows_get — contract

Tool: `flows_get` (module `flows`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and `format: "data"`;
the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
It replaces the tool of the same name that took `flow` and `project`; the view of the outline and of the open questions is the
one that tool drew (`render/views/flowOutline.ts`).
Matches the catalog: yes (argument added to the catalog entry together with `flows_list`).

## Arguments (exactly the catalog's)

- `flow_id?`: 1–200 characters: the id of the flow or its name. Without it the only flow of the workspace (`ids.flow_ids` holding
  exactly one); none or several: `missing_argument`, no request. A name is looked up in the list of the project (`not_found`
  names the flows there are, `ambiguous` the matches).

The project is the bound one (`projectIdOf`, else `ids.project_id`, else `no_project`). The `project` argument of the earlier tool
is gone: an unknown argument is refused (strict schema).

## Operations

`GET /projects/{id}/flows` (only to find a flow by name), then `GET /projects/{id}/flows/{flow_id}`. One read of the flow, no
auxiliary reads.

## format=data

`project` (`id`), `outline` (the flow as the Outline screen numbers it: `flowId`, `name`, `version`, `stepCount`, `requestCount`,
`pauseCount`, `steps[]`, `truncated`; each step has its number, kind, method, path, the variables it uses and produces, the
expected statuses, the validators and the pause), `questions[]` (`field`, `question`, `why`, `kind`, `steps`, `definite`).
The project carries no `name`: a name under it would be read as the `{name}` of the log entry, which is the flow's.
The steps are not paged: the catalog's page of 150 steps applies once the state schema defines the item.

**Third party:** the names of steps, their paths, the variables and the field of a question come from the flow, which may come
from a recording: they pass `content()`. The question and the reason are sentences of LoadCraft's generator, read as
documentation (a plain word after a keyword is a word), so `which token should "Checkout" carry?` does not hide the step.

## Text view

The numbered outline with its pauses and expected statuses, the questions of the generator under it with the next step, the
version and the link to the flow (see `test/tools.getFlow.test.ts` for the wording).

## State

Writes the warning `flows_need_input` of `problems` for this flow (a read of one flow changes only that flow), as the earlier
tool did. The log carries `flow_id` (as given), `name`, `version`, `steps`, `needs_input` and `definite`.

## UI

The mod draws the outline from the result as before; it reads `outline` and `questions` only.

## Test cases

- Ordinary: by name, by id, the only flow of the workspace, the log entry, the questions and the credential warning
  (`test/tools.getFlow.test.ts`, `test/tools.flowsNeedInput.test.ts`).
- Edge: no flow named and none or several in the state, an unknown name, an argument outside the catalog (`flow`, `project`).
- Adversary: sentinel in a step name and in a question; level 1, so it is offered.

## Out of scope

Versions of the flow (`flows_get_versions`), the copilot conversation (`flows_get_copilot_history`).
