# Consent card of module tools

A module tool of consent level 2 or 3 is written on the block `src/tools/kit/consent.ts`. Without it
such a tool stays a scaffold: `moduleTool` is fail-closed. Tests: `test/tools/kit/consent.test.ts`,
`test/genTools/contract.test.ts`. Recipe for one tool: `docs/recipe/templates/consent.md`.

## Rules

1. The decision comes only from the person, in a dialog of the client. The model has no argument
   and no tool that carries it.
2. One call, one card, one yes. No consent for a group of calls, none "in advance" in a skill.
3. A card is bound to its arguments and to the facts it showed. A change of either is a new card.
4. A card expires (30 minutes, `grant_ttl_minutes` of the catalog) and is used once.
5. A card says: what will happen, on what, the cost when the tool has one, whether it can be undone.
6. A tool with a card is never on the pre-allowed install list (`install_allow`).
7. Secrets never pass through the model: a card and the state file hold no secret value.

## The flow

```
call 1  args ──► card(ctx, args)   reads only: the HTTP client it gets refuses a write
                 no saved card, an expired one, or one for other arguments or facts
                 ──► the card is saved; the answer is its text: "nothing was done yet"
call 2  the same args ──► card(ctx, args) again ──► the saved card matches
                 ──► the server asks the person (MCP elicitation, a dialog of the client);
                     the client repeats call 2 with the answer, outside the arguments
                 yes ──► the card is removed ──► run(ctx, args, facts) ──► the result
                 no, closed, or a client that cannot ask ──► [consent_missing]; the card is removed
```

- Call 1 writes nothing to LoadCraft (`inert`). Its log entry has the status `queued`.
- The model repeats the call with the same arguments. It sends no token and no flag: the card is
  found by the tool, the project and the hash of the arguments (`format` is left out).
- The question shows the lines of the card. The answer is read under the key of the card token and
  of the question text (`questionKey`): a yes to another card or another wording is no answer.
- The card is removed before `run`: a failed `run` leaves no card. The call that ran logs
  `consent.via: client_dialog`; its undo is the entry's `undo`, as for a level-1 write.
- A client that cannot ask (no form elicitation) gets `consent_missing` on call 1, and no card.
- `card` may answer `{ unchanged: data }` (nothing would be sent): the tool answers at once, no card.

## One mechanism, reused

The block adds no second mechanism. It joins the two files today's tools use, the way
`src/tools/delete/card.ts` does for `project_delete` and `flows_delete`:

| Need                            | Existing code                                                   |
| ------------------------------- | --------------------------------------------------------------- |
| save a card, its age, its token | `issueCard`, `discardCard` (`src/consent/confirmCard.ts`)       |
| read the saved card of a scope  | `currentCard` (new, in the same file: it reads without a token) |
| compare what a card froze       | `sameFrozen`, `canonical`                                       |
| ask the person, read the answer | `confirmOnce`, `QuestionForUser` (`src/consent/ask.ts`)         |
| refuse                          | `consent_missing` (its text now speaks of any call)             |

Differences from the legacy tools, on purpose: no `confirm` argument (the legacy level-2 card,
`cardGate`, takes its token from the model, so the model can confirm itself; here the token never
leaves the server and only keys the question); no group grant (`GateOptions.group`); the card keeps
two hashes (arguments, facts) and no value, so the state file holds no text of the card.

## The seam: where the decision comes from

`personSaysYes(ctx, token, question, refusal)` in `consent.ts` is the only function that knows the
channel. Today it calls `confirmOnce`. Another channel changes that function and no tool.

Debt, for the owner to decide: `pending[]`, `Decision`, `DecisionInput` (`catalog/stan-procesu.ts`)
and the catalog tools `process_set_decision` and `process_answer` describe an earlier design (a card
in the process state, a decision written by a panel). Nothing writes or reads them; they stay in the
schema, unused. A decision kept in the state file can be written by anything that writes the file;
an answer of the dialog is kept nowhere.

## API

```ts
// src/tools/moduleTool.ts, the third overload: for a `ConsentMeta` only
moduleTool(META, { title, input, card, cardView, run, render }): ModuleTool // onCard: true

card(ctx, args): Promise<Card<C> | Unchanged<D>> // reads only; throw to refuse before any question
cardView(facts: C, t): CardView                  // { title, lines, cost?, undo }
run(ctx, args, facts: C): Promise<ToolOutcome<D>> // only after the yes to exactly this card
render(data: D, t, args): string

interface Card<C> {
  facts: C; // shown and hashed: masked by the tool, the same on every call
  escalation?: string; // one of consent.escalate_to_3 of the catalog entry, when this call meets it
  link?: Link; // where the person can do it by hand; default: the list of projects
}
```

The block draws the card (`src/render/consentCard.ts`): the title and the lines of the tool, then
`Cost:` (exactly when the catalog entry names a cost), the undo line worded by `undo.reversible`
(yes, no, nothing), the reason of level 3, and the next step. Call 1 answers the data
`ConsentCardData<C>`: `consent: "needed"`, `tool`, `level`, `card`, `costly`, `reversible`, `why`,
`valid_minutes`, `renewed`; `format: "data"` prints it as it is.

Fail-closed by type and at run time: `run` without `card` does not compile for a tool that asks; a
cast round the types leaves the tool a scaffold (`not_implemented`, not offered).

## Level 2 and level 3

Both take the two calls and the dialog. Level 3 adds:

- the reason, on the card and in the question: `delete`, or the escalation `card` named
  (`secret_ref`, `protected_env`, `scheduled_run`), which makes a level-2 tool ask at level 3;
- `anthropic/requiresUserInteraction` on the tool (from the catalog): the client's own permission
  prompt cannot be pre-allowed either;
- one object per card: a level-3 tool takes one target, never a list;
- for a deletion, `card` refuses before any question when what depends on the object is unknown or
  busy (`delete_unchecked`, `delete_busy`).

## A level-1 tool that asks for some calls

`ConditionalMeta` (`asksConditionally` at run time): level 1, `by_argument` at level 3, a non-empty
`escalate_to_3`, no secret, no traffic to the target. The tool is written with the overload for it
(`moduleTool(meta, { card, cardView, run, render })`, spec `ConditionalToolSpec`):

- `card` answers `{ proceed: true }` when the call does not meet the escalation: the tool then runs at once
  as any level-1 tool (no card, no question, no consent in the log), and `run` gets `null` facts and checks
  again what it must. Otherwise `card` answers the facts with the `escalation`, which is always level 3; a card
  without it is a mistake of the tool (a level-1 tool never asks at level 2).
- `proceed` may be answered only from facts `card` read from the backend (the stored object has a schedule, the
  call touches this field), never from an argument the model may leave out or set: the model has no argument
  that skips the card. A tool that always asks gets a `TypeError` at run time when its card answers `proceed`.
- `card` may also answer `volatile` values (the next start of a schedule): the view shows them, the hash that
  binds the card leaves them out, so a value that moves by itself between the card and the yes does not make a
  new card. Every other fact is in the hash as before. `cardView(facts, t, volatile)`.
- the reasons of a card now include `schedule` and `external` (one sentence each, EN and PL, in the question
  and on the card); `scheduled_run`, `secret_ref` and `protected_env` stay escalations.

## Out of scope

`ConsentMeta` (`asksOnACard` at run time) is what is in scope: level 2 or 3, `by_argument: null`,
`secret: false`, `target_traffic: null`, `level3_reason` null, `delete`, `schedule` or `external`; and the
conditional tools above.

| Tools                                                              | Why not                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| secret tools (`traffic_create_token`, `github_connect`, `+secret`) | the secret must bypass the model: a channel of its own, not a card                         |
| traffic to the target (`target_traffic`, reason `traffic`)         | need the checks of a run (protected environment, clamped load)                             |
| level by argument other than 1 -> 3 (`consent.by_argument`)        | the block, not the tool, must decide which arguments ask                                   |
| reason `stop`                                                      | not piloted                                                                                |
| long operations (`kind: process`)                                  | no module block for an operation with a handle yet (the card itself does not exclude them) |
