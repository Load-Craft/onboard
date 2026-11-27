# flows_merge — contract

Tool: `flows_merge` (module `flows`; level 1, class write, `readOnlyHint: false`, `destructiveHint: false`, no card; text view and
`format: "data"`; description, annotations, log templates and undo are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes.

## Arguments

- `flow_ids`: the flows to merge, ids or names, comma-separated, 1 to 4000 characters; 2 to 20 of them (otherwise refused locally,
  `invalid_arguments`, rule `flows_merge_count`, no request). A name that matches several flows, or none, is the resolver's refusal
  (`ambiguous`, `not_found`). The same flow twice is the backend's refusal.
- `name`: the name of the merged flow, 1 to 200 characters; default: the source names joined with " + " (the backend's).
- The project is the bound one (`projectIdOf`, else `no_project`).

## Operations

1. The flows are looked up by id or name (the list of flows).
2. `POST /projects/{id}/flows/merge` with `{flow_ids, name?}`: the first flow whole, the later ones without their leading reads. The
   backend refuses a graph that branches, loops, has no entry or fails its lint (400): nothing is written then.

## format=data

`project_id`, `flow` (`id`), `name` (the new flow's name, masked), `count` (how many flows were merged), `version`, `sources` (the ids merged),
`warnings` (the backend's, masked, at most 10).
**Third party:** the name and the warnings pass `content()`.

## Text view

```
Checkout + Search created from 2 flows.
Warning: step "Log in" of the second flow was dropped as a leading read.
```

## Undo

The merge creates a flow and changes no source: `undo: {tool: "flows_delete", args: {kind: "flow", ids: [<the new flow>]}}` (the tool names the way with `undo_tool` in `undo_args`). `flows_delete` is a
level 3 tool (a card, the person's yes): the entry only names it, no tool calls it. A refused or failed merge leaves no entry with an undo.

## State

Reads `ids.project_id`, `ids.flow_ids`. Writes `ids.flow_ids`: the new flow is added. No invalidation row names this tool.

## UI

Text only.

## Test cases

- Ordinary: merge two flows (ids, names); the flow is in the fake with the first flow whole and the later ones without the leading block;
  default and given name; `ids.flow_ids` holds the new flow.
- Undo: merge, take the undo from the log, apply the deletion it names (the fake's delete), the flows are as before; the sources were
  never changed.
- Edge: one flow, 21 flows (refused before any request); a name matching nothing; a flow twice (400, nothing written, no undo entry);
  warnings; unknown argument; no bound project; Polish view; log entry.
- Adversary: sentinel in the names and warnings; instruction in a name; control sequences.

## Out of scope

Deleting the merged flow (`flows_delete`), copying flows (`flows_duplicate`).
