**English** | [Polski](USAGE.pl.md)

# Using the LoadCraft plugin

You have installed the plugin and `/loadcraft:doctor` is green ([INSTALL.md](INSTALL.md)). This page shows how a
test goes from one sentence to a result.

## Start with one sentence

Open Claude Code in your project and ask in your own words:

> Run a load test of this application with LoadCraft.

or, more specific:

> Will the checkout handle 500 users at once?

Claude picks up the `loadcraft-test` skill and leads you through the whole path.

## What happens: eight steps

Claude first writes the eight steps as a task list and ticks them off as they are done.

1. **Check the API description.** Claude looks for `loadcraft/openapi.json` in your repository and checks
   that it describes the code you are testing. When it is missing or stale, Claude prepares it with the
   `loadcraft-openapi` skill. Nothing is sent to LoadCraft yet.
2. **Create the project.** Claude finds the addresses of your environments in the repository, asks which
   one is the default and which are shared (and need limits), and creates the project in LoadCraft. It never
   picks the environment to test for you.
3. **Build the flows.** A flow is a path a user takes through your application. You choose how to build them (see
   below).
4. **Compose the scenario.** Claude proposes how to split the traffic between flows and waits for your
   approval. A flow that fails its check is reported as it is, never hidden.
5. **Prepare the test data.** Test accounts and other data the scenario needs. Creating accounts in your system
   is always a question to you.
6. **Run the test.** Claude names the environment, the load profile, the thresholds and the code version deployed
   there, and starts the test only after your approval.
7. **Read the report.** The verdict against your thresholds, in your language, with what the verdict does not
   prove and a note when the load was capped.
8. **Find the cause and fix the code.** When the test fails, LoadCraft analyses the run and Claude looks for the
   cause in your code and proposes a fix. After you deploy it, you can run the same test and compare.

## Four ways to build the flows

Claude asks which one you want:

- **From the API description.** LoadCraft proposes user journeys from the description, you pick the ones that
  matter. The default for most projects.
- **By hand, from chosen endpoints.** You name the calls and their order. For when you know exactly what to test.
- **From a recording (HAR).** You record a session in the browser's developer tools and save it as a `.har` file in
  the repository; the plugin sends it. The recording holds a real session, so Claude asks first.
- **From a description, walked by a browser.** You describe the journey in words and the LoadCraft browser walks it
  in your application.

How the last method goes. Claude proposes a description of the journeys and you correct it until it is right. You
choose where the application is walked: in the LoadCraft browser, or in your own browser with a HAR recording when
the environment is behind a VPN or runs locally. Then you choose the test account the browser signs in with. The
plugin reads it from a file in your repository, so the password never passes through the model, but LoadCraft
receives it and keeps it with the run to walk the paths again: use a test account, never a personal one.

LoadCraft splits the description into paths and Claude shows them to you. Nothing is walked until you approve the
paths; only a plan with a single path starts at once. The browser then walks each path and records the API calls,
and the flows are saved at the end. Claude gives you a link to the live preview: if the browser gets stuck on a
one-time code or a CAPTCHA, only you can help, by taking over the browser there in the LoadCraft app. A step that a
load test cannot pass, such as a CAPTCHA or a payment with 3-D Secure, is named in the result, and Claude asks how
to get around it before composing the scenario.

## What Claude will ask you

Claude asks short questions, with choices where possible, in the language you write in. Expect these:

- whether to write or refresh the API description when it is missing or older than the code;
- which environments are shared and what limits to put on them;
- which environment to test on;
- how to build the flows, and which journeys to keep;
- for flows from a description: whether the description is right, which test account the browser uses and which
  paths it walks;
- the traffic split and the data mix of the scenario;
- where the test accounts come from, and whether it may create them;
- which load profile to run and what thresholds count as success;
- whether to run with the load reduced to the environment's limits, when it applies.

You never need to type a password into the chat. When an account's password is needed, point Claude to the file
that holds it; the plugin reads that file itself and the model does not see the value. See
[SECURITY.md](SECURITY.md).

## Commands

| Command | What it does |
|---|---|
| `/loadcraft:status` | Shows the project, flows, scenarios, recent runs, operations in progress and the next step. |
| `/loadcraft:doctor` | Checks the installation (Node, connection, token, backend) and says how to fix each problem. |
| `/loadcraft-panel` | Opens the side panel of the mod: the run in progress, with a **Stop test** button. See [the mod guide](../../mod/docs/USER.md). |

The four preparation skills (API description, journeys, event API, project overview) also work on their own: see
[the skills guide](../../skills/README.md).

## Coming back to interrupted work

You can close Claude Code at any point. The project and its progress live in LoadCraft, and the repository keeps the
link to the project in `loadcraft/project.json`. In a new session run `/loadcraft:status` or just say
*"continue the load test"*: Claude reads the state, ticks off what is done and continues from the first
unfinished step. A test that was already running keeps running in LoadCraft while you are away; ask for its
result when you come back.

Pressing Esc while Claude waits for a test does not stop the test. Claude asks whether to stop it, and only
then cancels.

## Lines starting with ↗

Under many results Claude copies a line that starts with `↗` and holds a web address, for example the page of a
flow, a scenario or a report in LoadCraft. It is a link to your own LoadCraft instance: open it in your browser to
see the same thing in the full interface. Claude never opens it for you.

## Where the full detail is

- Installation and permission rules: [INSTALL.md](INSTALL.md).
- What leaves your computer and what stays: [SECURITY.md](SECURITY.md).
