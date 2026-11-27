# project_list_team — contract

Tool: `project_list_team` (module `project`; level 1, class read, `readOnlyHint: true`, no card, no undo; text view and
`format: "data"`; the description, the annotations and the log templates are the catalog's, through `meta.generated.ts`).
Matches the catalog: yes (argument added to the catalog entry together with this tool).

## Arguments (exactly the catalog's)

- `me?`: boolean, default false. true returns the caller's own role and permissions instead of the list.

The project is the bound one (`projectIdOf`, else `no_project`). An unknown argument is refused (strict schema).

## Operations

| call | request                      |
| ---- | ---------------------------- |
| list | `GET /projects/{id}/team`    |
| `me` | `GET /projects/{id}/team/me` |

One request, no auxiliary reads. A project the backend does not know, and a caller who is not a member (`me`), are `not_found`;
a token pinned to another project is the backend's refusal (403) as the registry reports it.

## format=data

List: `mode: "list"`, `project_id`, `count`, `shown` (at most 50), `members[]`: `id`, `user_id`, `role`, `added_by` (the user id
of whoever added the member, or null), `joined_at` (as the backend gave it).
Me: `mode: "me"`, `project_id`, `count: 1`, `me`: `user_id`, `role`, `permissions` (`admin`, `edit`, `execute`, booleans).

**Personal data:** the answers of the backend carry user ids, roles and dates only: no e-mail address and no name of a person.
The tool reads no other field, so none can reach the model. Roles and ids pass `content()`.

## Text view

```
2 members:
1. owner 3f2a9c1e-7b45-4d68-a0e2-9c1d5b8f3e70, since 2026-11-20
2. editor 8c1d4e72-2b50-49a3-b6f1-0d7e9a3c5b18, since 2026-11-21, added by 3f2a9c1e-7b45-4d68-a0e2-9c1d5b8f3e70
```

`me`: `Your role in this project: owner (3f2a…); you can administer, edit, run tests.` (a viewer: `you can only read`).

## State

None. The log carries the data's `count`.

## UI

Text only: the team is a read for the model that explains why a call was refused; the mod shows no members.

## Test cases

- Ordinary: the list, `me` for an owner, an editor and a viewer, `format: "data"`, Polish view, log entry, one request.
- Edge: a team with no members, 60 members (50 shown), the caller not a member (`me`, not_found), unknown project, no bound
  project, an unknown argument refused, a role with control sequences.
- Adversary: sentinel in the role text and in the fields the tool does not read (an e-mail address planted in an extra field of
  the answer never appears in the view or the data); a 401/500 quoting a secret; level 1, so it is offered.

## Out of scope

Adding or removing members and changing roles.
