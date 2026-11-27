# Review of the mod: safety, degradation, hostile input

An adversary review of the mod as built on 2026-11-23 (Claude Code 2.1.325): try to make it break its
rules (it only shows and asks the user, never decides, never rewrites a result, never talks to
anything but the plugin's own server through a closed list of read-only calls, and the plugin works in
full without it). Each finding has a severity, a decision and the test that holds it.

The rules are checked on the code by `mod/test/safety.spec.ts` (sources and the built
`mod/register.js`), the hostile inputs by `mod/test/adversary.spec.ts` (pure drawings, questions and
refusals) and `mod/tests/adversary.test.ts` (hooks in Claude Code's test kit). The configurations are
in [matrix.md](matrix.md).

Severity: **high** — the mod acts against the user or leaks a secret; **medium** — a safeguard can be
skipped, or the session can lose the mod or a drawing in a way the user notices; **low** — a nuisance
or a defect without effect outside the drawing; **info** — by design, written down.

## Fixed in this review

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | medium | The user closes the consent dialog and `$.session.surfaces()` then fails: the hook threw, its `.catch` passed the call on, and the tool ran although the user had just been asked. | When it cannot be read who could answer, a closed dialog counts as a no (`{ deny }`), never as "nobody to ask". | `adversary.test.ts`: "a closed dialog refuses the call even when the surfaces cannot be read" |
| 2 | medium | A flow with many steps and many long names took about 20 s to draw (every step and every name went through the one-line cleaning in full, before the cut). A hook that runs past its budget is skipped, and one that blocks the shared hooks worker can get the mod unloaded. | Only the steps that fit (`MAX_ROWS`) are read; a value is sliced before it is cleaned (`short`); a list of names stops once the notes are full; at most 40 flows are drawn, the rest counted in one line. | `adversary.spec.ts`: "a flow of very many steps reads only the steps it can draw", "a flow of many steps with long paths and names …", "a build of very many flows …" |
| 3 | low | The step number and the expected statuses of a flow outline were drawn as the data had them: a control character, an escape sequence or a line break in them reached the terminal. | They go through `inline` (one clean line, cut) like every other name. | `adversary.spec.ts`: "flows_generate_from_suggestions: every drawing stays clean …" |
| 4 | low | The band cleaned names with its own rule: C0/C1 controls became spaces, but bidi overrides, zero-width marks and tag characters stayed, and the visible rest of an escape sequence (`[31m`) was drawn. | The band uses `inline`, the rule of every view of the server. | `adversary.spec.ts`: "the band and the VS Code status line stay one clean line"; `band.spec.ts` now expects the sequence to go whole |
| 5 | low | No piece of text in a result drawing had an upper bound: a 20 000-character message was one Text, and a few of them could pass Claude Code's 100 000 characters per tree (the drawing is then refused). | Every Text of a drawing is cut at 1 000 grapheme clusters (`bounded` in `view/tree.ts`); cells, paths, notes and names have tighter limits. | `adversary.spec.ts`: every drawing, every tab of the panel |
| 6 | low | After `/resume` of a long session every report, diagnosis and flow block was read again from the server, one after another, also the blocks far outside the viewport. | A block drawn outside the viewport (`onScreen: null`) is read when it scrolls into view; at most 8 reads wait, an older waiting block keeps Claude Code's drawing. | `adversary.test.ts`: "a flood of result blocks reads only a few, and none for a block off screen" |
| 7 | low | A second `session.start` in one load started a second poll timer (reads twice as often) and registered the listeners twice. | `session.start` sets the mod up once per load. | `adversary.test.ts`: "a second session.start starts no second poll and registers the command once" |

## Tried and held

| Attempt | What happened |
| --- | --- |
| Hostile text in every string field of the data block of `process_get_status` (operation, preflight, result, project): OSC 8 link to `javascript:`, colour and screen-clear sequences, bell, NUL, line breaks, a fake `↗ javascript:` link line, bidi override, zero width, tag characters; 20 000-character strings; absurd numbers (−1, 1e308, `MAX_SAFE_INTEGER`) | After the fixes above, every Text of every drawing, the band, the status line, the notices, the live line, the panel, the consent question and the refusal the model reads is one clean line within its limit. A link is drawn only when it is `https`, lower-case host, no space, no `@`; a run link only from exactly one `↗` line that names a run. |
| Hostile arguments of the model in a guarded call (environment, slot, account file, operation) | The question and the refusal carry them through `inline`, at most 80 or 140 characters; the refusal always starts with `[user_declined]`. |
| An operation that never ends | Polled every 5 s as long as the server says it runs; a read that fails backs off up to a minute and is given up after 6 failures, with one notice. See "Known limitations and proposals". |
| A hook that throws everywhere (every mods API call fails) | Each tool result goes back as it came, every drawing is Claude Code's own, the consent hook steps aside. |
| The API token | Read by nobody: the module reads only `options.locale` (checked on the source and the built file). No atom of `$.state` and no key of `$.store` holds the token after a session that writes each of them. |
| Replace or rewrite a result or an argument | No `tool.call` hook builds a `{ result }`, every `next` passes the event as it came, the state hook returns exactly what `await next(e)` gave. Only the consent hook can refuse. |
| Call the server outside the list | Every `$.mcp.call` names `plugin:loadcraft:lc` and `process_get_status` or `process_cancel` as literals (constants resolved); `run_start` is never called; `$.mcp` is never kept or passed on; `process_cancel` only after `$.ui.ask` and `if (settle(…) !== 'allow') return`. |

Each rule above was checked by breaking it on purpose (an inserted `$.http.fetch`, `$.env.get`,
`fetch`, `run_start` call, `return { result }`, a removed consent check, a rewritten `next`, a second
writer of an atom, the token copied into the store, `$` destructured or copied (`const { mcp } = $`), …): every such change fails the tests.

## Known limitations and proposals

| Limitation | Severity | Proposal |
| --- | --- | --- |
| The mod takes the first `<kind>:<id>` it finds in the text of any LoadCraft tool. A name a customer chose that spells a handle (a flow called `test_run:…`) makes the mod follow it until the status read answers (with an older server that has no data channel: until six reads fail and a "state unknown" notice), and can open the panel by itself. | low | Read a handle only from the tools that start or follow an operation, at the place their text names it, and keep the operation kinds in one list shared with the server (see "Other known limitations"). |
| An operation the server keeps reporting as running is read every 5 s for the whole session. | low | After the planned time plus a margin, read every 30–60 s and say so in the status line. |

## By design (info)

- **Consent fails open.** Whenever the facts cannot be read (older server, an error) or the hook fails
  before it asks, the call goes on and the server's own safeguards hold: clamping to the environment's
  limits, `confirm_capped` / `confirm_protected`, and Claude Code's own permission prompt for
  `run_start`. The mod must never be the reason a tool is blocked. A dialog the user saw and closed is
  always a no (finding 1).
- **Another mod can see the question.** `$.ui.ask` is Claude Code's AskUserQuestion; another mod the
  user installed can see or answer it. Nothing a mod can prevent; the server's safeguards stay.
- **Only this plugin's tool names are guarded.** The consent hook matches
  `mcp__plugin_loadcraft_lc__…`. The same server configured by hand under another name gets no
  question from the mod; its own safeguards hold.
- **`claude plugin validate` does not name the tools of `$.mcp.call`.** The closed list is in
  [USER.md](USER.md) and checked by `safety.spec.ts`.

## Other known limitations

- The panel's chart of requests per second is filled only while a `run_start` call holds the test; a
  test sent to the background has an empty chart, and `process_wait` has no live line.
- The mod keeps its own copy of the list of operation kinds (`state/signal.ts`, `view/status.ts`);
  it is not kept in step with the server's list and does not know the HAR kinds (`har_generation`,
  `har_split`), so handles of those kinds are not followed.
- The pure drawings of the `flows_generate_*` tools and the two scenario tools exist but are not fed: their text does not
  name every flow or composition by id.
