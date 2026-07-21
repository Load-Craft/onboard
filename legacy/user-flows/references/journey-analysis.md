# Per-journey analysis protocol

You are analyzing EXACTLY ONE user journey. Inputs: the journey definition (name,
role, goal), `journeys-workspace/screens.json`, `frontend-audit.md`, and the codebase.
Output: one journey file. Do not write or edit any other journey.

## Method

1. **Walk the code, screen by screen.** Start at the journey's entry screen. For each
   step, open the component/template and confirm: the element exists, its visible text
   is what you'll quote, clicking/submitting leads where the journey assumes
   (follow the handler: navigation call, form action, mutation + redirect).
2. **Verify feedback.** For every mutating action find the observable result in code:
   success toast/message text, redirect target, new row rendered. That becomes the
   final "Check" step(s). If the code shows no observable feedback, that's a TODO
   (and worth reporting — it's also a UX bug).
3. **Trace the labels.** Quote UI text exactly as rendered (resolve i18n keys to the
   chosen locale). Never quote an i18n key, a component name, or your own paraphrase.
4. **Fill the hints table** using the selector strategy from `frontend-audit.md`, best
   available locator first (role+name > testid > label > css). Mark fragile locators.
5. **Cover the interesting deviations, briefly.** 1–3 variants max: the most likely
   validation error, cancel/back, and permission-denied if roles matter here. This is
   a journey map, not exhaustive test design — the test-generating AI will expand it.

## Step-writing rules (repeat of the contract — follow strictly)

- One action per step; imperative; ≤ 12 words.
- Verbs: **open, click, type, select, check** (+ obvious variants: "go to", "press").
- Quote real UI text in the UI's language, in double quotes.
- No component names, no CSS, no jargon. Readable by a non-developer.
- Placeholders for data, never real values: "the test user's email", "a unique name".
- Preconditions go in the header ("Start: logged in as admin, at least one project
  exists"), not buried in steps.
- The journey ends with ≥ 1 Check step proving success.

## Output template

Write `journeys-workspace/journeys/<id>.md`:

```markdown
# JRN-<nnn> — <Short journey name>
**One sentence:** <who> <does what> and <observable outcome>.
**Role:** <role> · **Start:** <preconditions> · **Screens:** <route → route → route>

## Steps
1. ...
n. Check that ...

## Selector hints (for the test runner, not for humans)
| Step | Preferred locator | Fallback |
|---|---|---|

## Variants & failure paths
- <one-line variant with its own Check>
- [TODO: ...] (if any)
```

Then update this journey's entry in `journeys-workspace/journeys.json`:
`status: done` (or `blocked` + reason), plus the list of files the steps were
verified against (needed by maintenance-mode git diffing).

## Self-check before marking done

- [ ] Every quoted label found verbatim in code/i18n for the chosen locale
- [ ] Every step's target element exists on the screen the previous steps lead to
- [ ] Navigation between consecutive steps traced (no teleporting between screens)
- [ ] Hints table filled for every interactive step
- [ ] Final Check step(s) traced to real feedback in code
- [ ] No real credentials/PII; preconditions in header
- [ ] TODOs for everything unverifiable — zero invented UI text
