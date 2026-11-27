# project_disconnect_telemetry — contract

Tool: `project_disconnect_telemetry` (module `project`, `moduleTool` on a consent card; destructive, level 3, reason `delete`; text view and
`format: "data"`; the description, the annotations, the card and log templates are the catalog's, through `meta.generated.ts`;
`anthropic/requiresUserInteraction`). Design of the card: `docs/consent-card.md`. Matches the catalog: yes.

## Arguments

None (the project is the bound one). No argument carries consent: `confirm`, `consent`, `token` are refused as unknown arguments.

## Operations

Card (call 1 and the repeat; reads only): `GET …/telemetry-source` (which log server the project is connected to). None connected: no card, no
question, nothing sent. An operation of this workspace that still runs on the project is `delete_busy` (an analysis may be reading that
server), raised before any question. After the person's yes: `DELETE …/telemetry-source` (204).

## The card

Facts (hashed): `label` (masked), `host` (the host of the address only: the path and the query of an MCP endpoint may carry a token, so they
are never shown), `tools` (how many tools of the server are enabled for the project). Lines: the connection that goes, the tools that stop being
available, that the server itself is not touched. No cost line (the catalog names none); the undo line says connecting again needs credentials,
none are kept; level 3 `delete`.

## format=data (the result)

`disconnected` (false when no server was connected), `label`, `host` (null then).

## Log and undo

args `Disconnect the log server`, result `disconnected`; the entry of call 1 is `queued`, the one that ran carries `consent.via: client_dialog`.
No undo is kept: `project_connect_telemetry` connects again, with credentials that never reach the log.

## State

Reads `ids.project_id`. Writes nothing.

## Test cases

`test/tools/project/disconnectTelemetry.test.ts`: the card (full text, none connected, Polish), the yes (one DELETE, the fake compared, the entry with the
dialog and no undo, the same call again), no/declined/cancelled, a server that changed after the card, no confirming argument, a client without
elicitation, `delete_busy`, secrets in the label and in the address. Sentinel cases in `test/tools/project/canary.ts`.
