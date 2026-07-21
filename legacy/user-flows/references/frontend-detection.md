# Frontend detection checklist

Goal: identify (1) framework & router, (2) where screens live, (3) where visible
labels come from, (4) usable selector strategy, (5) auth/roles, (6) existing E2E tests.

## 1. Framework & router

| Evidence | Stack | Screens live in |
|---|---|---|
| `react`, `react-router-dom` in package.json | React SPA | route config / `<Route>` elements |
| `next` | Next.js | `pages/` or `app/` directory (file = route) |
| `vue`, `vue-router` | Vue | router config, `views/` |
| `nuxt` | Nuxt | `pages/` |
| `@angular/core` | Angular | route modules, `*-routing.module.ts` |
| `svelte`, `@sveltejs/kit` | Svelte(Kit) | `src/routes/` |
| Django/Rails/Laravel/Spring templates, no SPA framework | Server-rendered | template dirs + backend URL confs |
| Mixed (SPA + server pages) | Hybrid | map both; note which URLs belong to which |

Also detect layout shells: the persistent nav (sidebar/topbar/tabs) usually lives in a
layout component — this is where most "Open the X tab" steps come from. Find it early.

## 2. Where labels come from

- **i18n files** (`locales/*.json`, `*.po`, `messages.*`, `i18n/`): best source —
  enumerate them and map keys to usage. Steps must quote the label in the UI's actual
  display language (ask the user which locale to use if several exist).
- Hardcoded strings in JSX/templates: grep per component when writing steps.
- Component libraries (MUI, Ant, Vuetify, Bootstrap): labels come via props
  (`label=`, `title=`, children) — trace the prop, and note the library's DOM
  patterns for selector hints (e.g. Ant tabs render `role="tab"`).
- Icon-only buttons: usable only if they have `aria-label`/`title`; otherwise flag as
  a TODO and recommend adding one (an AI runner can't "click the pencil icon" reliably).

## 3. Selector strategy audit

Check, in order of preference for the hints table:
1. Role + accessible name — `getByRole('button', { name: '…' })`; works when the app
   uses semantic elements and visible labels. Verify buttons are real `<button>`s.
2. `data-testid` / `data-cy` / `data-test` attributes — grep for them; note coverage %.
3. Labels/placeholders for form fields — `getByLabel`, `getByPlaceholder`.
4. Stable ids/classes — last resort; flag as fragile in the hints table.

If coverage is poor (icon buttons without aria-labels, divs-as-buttons, generated
class names only), report this to the user as a finding: journeys will carry TODOs
until test ids or aria-labels are added. Optionally offer to add `data-testid`s as a
separate task.

## 4. Auth & roles

- Locate the login screen/flow and describe it as journey JRN-001 (every other
  journey's precondition references it: "Start: logged in as <role>").
- Find route guards / role checks (guards, middleware, `requireAuth`, conditional nav
  rendering) — they decide which journeys exist per role. List roles and what each
  can see; confirm with the user which roles to cover.
- Credentials: steps never contain real values — "Type the test user's email into…".
  Where env-based test accounts exist (e.g. `E2E_USER` in CI config), note the
  variable names in the journey preconditions, not the values.

## 5. Existing E2E tests

Grep for `@playwright/test`, `cypress`, `selenium`, `testcafe`, `webdriverio`.
Existing specs are a map of intended journeys and often contain good selectors —
harvest journey candidates and selector patterns from them, but every step still gets
re-verified against the CURRENT components. Mismatch between an old spec and the code
is a finding to report (the old tests are stale), not something to propagate.

## 6. What to write down

Record all of the above in `journeys-workspace/frontend-audit.md`, including explicit
answers to: which framework/router, where the nav shell is, which locale to quote,
what the selector strategy is (and its gaps), which roles exist, and whether existing
E2E tests were found. Per-journey tasks read this file instead of rediscovering it.
