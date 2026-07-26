# LoadCraft journey text contract

Each `.txt` file is direct input to LoadCraft scenario generation. Nothing in the file is hidden metadata.

## One coherent journey per file

A journey expresses one business goal from a reachable starting point to an observable result. Split unrelated outcomes into separate files.

Shared authentication is setup handled separately by LoadCraft. Do not create a standalone login journey or repeat sign-in steps unless authentication is itself the behavior under test. Account registration can be its own goal.

Do not make one file depend on another. Avoid phrases such as “run the previous journey first” or references to journey IDs and filenames.

## Direct-input dialect

Write short, ordered, imperative sentences in plain text. Use verified UI labels when they help the browser agent identify the action.

Good:

```text
Open the "Orders" page.
Click "Create order".
Type a unique name into the "Order name" field.
Click "Save".
Check that the new order appears in the orders list.
```

Bad content includes:

- Markdown headings, bullet lists, tables, code fences, frontmatter, or an evidence appendix;
- Playwright, Cypress, Selenium, CSS, XPath, `data-testid`, or other locator syntax;
- source paths, line numbers, confidence scores, IDs, tags, priorities, or owner fields;
- alternative flows, failure-path catalogs, and test implementation notes;
- TODOs or guessed labels;
- usernames, passwords, tokens, cookies, API keys, or production data.
- literal test-account emails and pre-filled passwords copied from source.

Keep evidence and audit metadata in the delivery report, not in the file.

## Actions and selection

Use ordinary UI actions such as open, click, type, select, upload, drag, confirm, and wait when the implementation supports them. Name the user's intent and the visible control; do not constrain the text to a test-runner command vocabulary.

When choosing an item affects generated correlations, explicitly say whether to use the `first`, a `random`, or `all` matching items. Do not leave important selection semantics implicit.

Use data requirements such as “a unique order name” or “an available item” rather than hard-coded customer values. The journey should be repeatable without embedding a secret or a production identifier.

For dynamic UI strings such as `Cart (N items)` or `Status: value`, quote only the static fragment verified in source and describe the dynamic value outside quotation marks. A disjunctive wait is acceptable when every branch is grounded and both branches prove the same state transition, such as an item count increasing or an existing quantity increasing.

## Asynchronous behavior

An async trigger alone is not a complete journey. State what to wait for and what terminal UI state proves success.

Good:

```text
Click "Process order".
Wait until processing finishes and the status becomes "Ready".
Verify that the completed order is visible in the order details.
```

Do not use an arbitrary fixed sleep when the implementation exposes a status, progress indicator, notification, or read-back result.

Frontend source proves what the UI triggers and renders. It does not by itself prove a backend invariant such as inventory decreasing. Inspect backend source only when it is explicitly included in scope; otherwise withhold that cross-system assertion and report it as a candidate.

## Finish condition

End every file with an observable result. Use a clear phrase such as:

- `Check that ...`
- `Verify that ...`
- `Confirm that ...`
- `Finish when ...`
- `Stop when ...`

The result must be grounded in a route transition, visible content, status, notification, or persisted read-back present in source.

### The verification must be answered by the service

LoadCraft generates load tests, not interface acceptance tests. A journey is captured as traffic, and the generated test can only assert on what the service sent. So the closing verification must be something **the service had to answer for** — a value it computed, a state it stored, a status it decided.

A verification the browser could satisfy on its own produces a journey that reads perfectly and generates nothing. It fails at generation time, and the failure looks like a defect in the tooling rather than in the text.

Passes, because the service must answer:

- an identifier, total or timestamp that came back in a response — an order number, a report duration, a stored version;
- a list or count re-read after a change, where the service decides the contents;
- a status that only the service can move — queued becoming completed;
- one figure cross-checked against another the service serves through a different call.

Fails, because the browser already knows:

- a rendering decision made from data the page holds — a dash instead of a number because that path measures nothing, a control switching to a disabled state;
- a value computed in the page from constants compiled into it — a size label, a per-item description, a formatted range;
- a locally derived elapsed time or freshness, computed from timestamps the page already has;
- a number compared against the length of the very list it was derived from, which is true whatever the service replied;
- an input echoed back on screen after being typed.

A goal whose whole point is the absence of activity — watching something go quiet, decay, or stop — cannot be closed this way and does not belong in a journey. Report it as a candidate withheld rather than dressing it up.

When the natural end of a goal is client-side, do not abandon the goal: keep the client-side observation as an intermediate step and close on the read-back that proves it reached the service. Sending two messages and checking which timing fields render is a client-side end; sending two messages and checking that the session's message count rose by four is the same journey with a verifiable close.

## File rules

- UTF-8 plain text, one journey per file.
- Lowercase hyphenated slug ending in `.txt`.
- At least 10 and at most 6000 characters after trimming surrounding whitespace.
- No surrounding README or manifest is required for LoadCraft input.
- The output directory may additionally contain one `.provenance.json` maintenance stamp (`commit`, `dirty` — validated by the bundled validator). It records which repository state the journeys were derived from; it is not LoadCraft input and must never be pasted into a scenario description.
