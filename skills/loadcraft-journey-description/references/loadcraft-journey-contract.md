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

## File rules

- UTF-8 plain text, one journey per file.
- Lowercase hyphenated slug ending in `.txt`.
- At least 10 and at most 6000 non-whitespace characters.
- No surrounding README or manifest is required for LoadCraft input.
