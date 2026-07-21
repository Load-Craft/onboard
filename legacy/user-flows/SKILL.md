---
name: user-flows
description: Analyze a frontend codebase and produce simple, step-by-step descriptions of the paths a user can take through the system ("open the Reports tab", "click the 'Add user' button") — written to guide an AI that will drive Playwright (or Cypress/Selenium) tests. Maps routes, screens, and interactive elements from the actual code, treats each user journey as a separate deep-dive task, grounds every step in real visible labels and selectors, and outputs numbered plain-language scenarios plus machine-readable selector hints. On re-runs it verifies existing journeys against the current code and fixes drifted steps. Use whenever the user asks to map user flows, user journeys, navigation paths, clickpaths, or screens of a web app, wants scenarios or steps for E2E/UI/Playwright test generation, asks "what can a user do in this app", or asks whether existing journey docs still match the frontend. Trigger even for a single flow.
---

# Frontend Journey Mapper

Turn a frontend codebase into a catalog of user journeys written so simply that an AI
armed with Playwright can execute them without reading the code.

**Core principle: EVERY STEP MUST BE CLICKABLE.** A step may only reference things that
verifiably exist in the code: visible text of a link/button, a field label/placeholder,
a tab name, a menu item. If you can't find the label or a stable selector in code,
mark the step `[TODO: <what's missing> — <file>:<line>]` — never invent UI text.
The acceptance test for every journey is: *could an AI perform it in Playwright using
only these steps, without access to the source?*

**Self-containment rule: ONE FILE = ONE RUNNABLE SCENARIO.** The downstream system
may be fed a single journey file with nothing else — no catalog, no other journey
files, no source. Every journey therefore starts from a fresh browser at the app's
entry point and inlines ALL prerequisite steps (login, creating the data it needs)
as ordinary numbered steps with selector hints. The `**Start:**` line describes the
precondition, but the steps themselves must establish it. Never write "run JRN-00X
first" or "start logged in" as a substitute for the actual steps. Environment-level
preconditions that no UI action can establish (seeded data, a reset endpoint) go in
"Variants & failure paths" as an explicit note.

**Step language rules (the whole point of this skill):**
- One action per step. Imperative, present tense, ≤ 12 words.
- Only five verbs (plus their obvious variants): **open / click / type / select / check**.
  ("Open the 'Reports' tab", "Click the 'Add user' button",
  "Type the email into the 'E-mail' field", "Select 'Admin' from the 'Role' list",
  "Check that the message 'User created' is visible").
- Quote UI text exactly as it appears in code (including the language of the UI —
  if the app is in Polish, steps quote the Polish labels).
- No jargon, no component names, no CSS talk. A step must make sense to a non-developer.
- Every journey ends with at least one **Check** step — the observable result that
  proves the journey succeeded.

**Mode detection.** If `journeys-workspace/state.json` exists, this is a maintenance
run: skip to the Maintenance section at the bottom. Otherwise run Phases 0–3.

---

## Phase 0 — Frontend reconnaissance

Read `references/frontend-detection.md` for the checklist. Establish:

1. **Stack & router** — framework (React/Vue/Angular/Svelte/plain/server-rendered),
   routing (react-router, Next.js pages/app dir, Vue Router, Angular routes, backend
   templates), and where views/pages live.
2. **How the UI names things** — i18n files (the goldmine: all visible labels in one
   place), hardcoded strings, component libraries. Note the UI language(s).
3. **Selector strategy** — do components carry `data-testid`/`data-cy`? Are labels and
   roles usable (`aria-label`, semantic buttons)? This determines the quality of the
   machine hints; report gaps to the user (and optionally propose adding test ids).
4. **Existing E2E tests** (Playwright/Cypress/Selenium) — inventory them; they are
   evidence of intended journeys, but verify against current code, don't copy blindly.
5. **Auth & roles** — login flow location, user roles that see different navigation.
   Ask the user for test credentials handling (never record real credentials; steps
   say "Type the test user's email…").

Report findings and confirm scope with the user: which app(s), which roles, are
admin/internal areas included?

## Phase 1 — Screen & navigation inventory

One pass to build the map, no journey-writing yet.

1. List every route/screen: path, entry component/template, guard/role requirement.
2. For each screen, extract its interactive elements from code: links (with visible
   text and target route), buttons (visible text, what they trigger), forms (fields
   with labels, submit action, success/error feedback), tabs, menus, modals.
3. Write `journeys-workspace/screens.json` (one entry per screen: route, name, role,
   elements with `label`, `kind`, `selector_hint`, `leads_to`/`triggers`).
4. Derive the **navigation graph** (screen → screen edges) and propose the journey
   list to the user: happy paths per core resource (create/view/edit/delete),
   the login journey, plus any flows evidenced by existing E2E tests. The user
   confirms/edits the list before Phase 2.

## Phase 2 — Per-journey deep dive (one journey = one task)

Each journey is analyzed as its own isolated task — with subagents (one per journey,
3–5 in parallel) where available, strictly one-at-a-time otherwise. Give each task
ONLY its journey definition, `screens.json`, and `references/journey-analysis.md`.

The task walks the journey through the code screen by screen, verifying every step's
label and selector, and writes `journeys-workspace/journeys/<id>.md` in this format:

```markdown
# JRN-003 — Create a new user
**One sentence:** An administrator adds a new user account and confirms it appears
in the user list.
**Role:** admin · **Start:** fresh browser, logged out · **Screens:** /login → /users → /users/new → /users

## Steps
1. Open the app's start page.
2. Type the admin's email into the "E-mail" field.
3. Type the admin's password into the "Password" field.
4. Click the "Sign in" button.
5. Open the "Users" tab.
6. Click the "Add user" button.
7. Type the user's name into the "Full name" field.
8. Type the user's email into the "E-mail" field.
9. Select "Editor" from the "Role" list.
10. Click the "Save" button.
11. Check that the message "User created" is visible.
12. Check that the new user's name appears in the user list.

## Selector hints (for the test runner, not for humans)
| Step | Preferred locator | Fallback |
|---|---|---|
| 5 | getByRole('tab', { name: 'Users' }) | [data-testid="nav-users"] |
| 6 | getByRole('button', { name: 'Add user' }) | — |
...

## Variants & failure paths
- Submitting with an empty "E-mail" field → Check that "E-mail is required" is visible.
- [TODO: duplicate-email behavior unverifiable — no visible handling found, see users/form.tsx:88]
```

## Phase 3 — Assemble, verify, deliver

1. Write `journeys-workspace/JOURNEYS.md` — the catalog: journey id, the one-sentence
   description, role, and link to the step file. This is the index an AI (or human)
   scans to pick a scenario.
2. **Acceptance review** (write `acceptance-report.md`):
   - Language check: every step uses the five verbs, quotes real UI text, ≤ 12 words.
   - Grounding check: re-verify a sample of steps' labels/selectors against code.
   - **Cold-run check:** for 2–3 sampled journeys, draft the Playwright code from
     that SINGLE file's steps + hints ALONE (no source access, no other journey
     files, no catalog). If any step is ambiguous (which button? which screen am I
     on?) or the scenario can't start from a fresh browser, the journey fails and
     goes back to Phase 2.
   - Every journey ends with a Check step; every TODO is listed for the user.
3. Deliver: JOURNEYS.md + per-journey files + screens.json. Offer next step: generate
   actual Playwright specs from the journeys (separate task, not part of this skill).

---

## Maintenance runs

When `state.json` exists: re-run the Phase 1 inventory, then detect drift with three
detectors — (D1) screen/element diff: new screens or elements not covered by any
journey, journeys referencing labels/routes that no longer exist; (D2) git diff since
`state.json.last_commit`, mapping changed view/i18n/router files to affected journeys;
(D3) a random re-verification of 20% of untouched journeys' steps against code.
Re-analyze affected journeys via the Phase 2 protocol (full journey, not just the
broken step — a changed screen usually shifts neighboring steps too), remove journeys
whose screens are gone, propose new journeys for new screens, re-run the Phase 3
acceptance on everything, and write `drift-report.md`. Update `state.json`
(strategy n/a here: record `last_commit`, journey count, open TODOs).

## Failure modes to avoid

- Steps referencing component names ("click UserFormSubmitButton") instead of visible text.
- Steps invented from what the UI "probably" has, rather than traced labels.
- Ten-action mega-steps ("fill in the form and save") — split them.
- Journeys without a final Check step — the runner can't know it succeeded.
- Journeys that assume state built by another journey ("start logged in", "cart
  already filled") instead of inlining those steps — a single file must run alone.
- Copying stale flows from old E2E tests without verifying against current code.
- Recording real credentials or personal data in steps — always "the test user's…".
