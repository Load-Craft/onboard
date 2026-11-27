**English** | [Polski](SECURITY.pl.md)

# Security of the LoadCraft plugin

What the plugin sends out of your computer, what the AI assistant never sees, where the token lives and how to
take access away.

## What leaves your computer

The plugin sends data only to your LoadCraft instance (`loadcraft_url`), and only when a step needs it. Your
source code is never sent. These kinds of files can leave, each only from inside your project directory and
within a size limit:

| File | What it is | Limit |
|---|---|---|
| `.json` | API description (OpenAPI) and event API description (AsyncAPI) | 10 MB each |
| `.har` | A browser recording, for building flows from a recording | 100 MB |
| `.md` | The project overview | 64 KB |
| `.csv` | A list of test accounts | 2 MB |

Besides files, the plugin sends what you decide in the conversation: environment addresses, load limits,
the choice of flows, the scenario and the load profile. A file outside the project directory is refused, also
when it is reached through a link. A file of another type is refused too.

A recording (`.har`) holds a real session of whoever recorded it: cookies, tokens, form values. LoadCraft takes
the recording to build flows, so record with a test account, never with a real person's, and Claude asks
before sending one.

## What the assistant does not see

- **Your API token.** It is passed to the plugin's server as a protected value, sent only in a request header and
  masked in every log and result. Claude Code keeps it in your system's credential store, not in a settings file.
  The assistant is told never to print it, and the plugin hides its value (also encoded) in anything that would
  reach the assistant.
- **Passwords from files.** For test accounts, Claude gives the plugin the path of a file and the names of the
  keys; the plugin reads the values itself. The model sees file names and key names, never the values.
- **Passwords and secrets from recordings.** What a `.har` file holds is read by the plugin, not by the model.
- **Error bodies.** When your LoadCraft instance or your application answers with a server error (5xx) or with
  "not authorized" (401), the text of that answer is not passed on to the assistant. It gets a short
  description of the problem instead.
- **Test account lists that the backend returns** are cleaned of secret values the moment they arrive.

The assistant treats texts it reads, from your repository and from answers of services, as data, not as
instructions.

## What LoadCraft does with the test account

LoadCraft uses the test accounts you give it to sign in as a test user while the test runs. Use dedicated test
accounts, with the least rights that the flows need, never accounts of real people. Creating accounts in your
system (`data_create_accounts`) is possible only after your explicit approval in the dialog each time; that approval
is not covered by any permission rule.

## Production and protected environments

Load tests can hurt a system that real people use. The plugin is built to make that hard to do by accident:

- Claude never chooses the environment to test; you do.
- You can mark an environment as protected and give it limits (virtual users, requests per second). `project_save_env`
  only ever tightens that protection, never loosens it.
- A test on a protected environment is cut down to its limits, and it starts only after you approve the reduced
  numbers. Claude says plainly in the report that the load was capped.
- `run_start` asks for your approval every time, whatever your permission rules say, and is refused in a
  non-interactive session (`claude -p`).

## Where the token lives, and how to revoke it

The token is stored by Claude Code in your operating system's credential store when you configure the plugin
(`api_token`). It is not written into your repository and not into `.claude/settings.json`.

The token acts as you, with your role. In LoadCraft, under **Account → API tokens**, you can:

- limit it to one project and set an expiry date when you create it;
- revoke it at any moment. Revoking takes effect at once: the next call of the plugin is refused, and
  `/loadcraft:doctor` says that the token is no longer accepted.

If you think the token was exposed (pasted into a chat, committed, lost with a laptop): revoke it first, then
create a new one and enter it with the loadcraft settings in `/plugin`.

## Deleting projects and flows

A deletion (`project_delete`, `flows_delete`) goes ahead only after a yes in the Claude Code dialog: the
assistant cannot give it in your place. Claude Code lets hooks answer that dialog, though: an `Elicitation` or
`ElicitationResult` hook, yours or one that another plugin brings, can answer or change the answer for you. Do
not set up hooks that answer the questions of the LoadCraft server by themselves. In `bypassPermissions` mode
the assistant can also change settings and hooks without asking, so there the dialog guards tool calls, not a
session without limits; for deletions, use a mode that asks.

## The mod

The optional mod does not read the token, does not open the network and does not change tool calls or results. See
[the mod guide](../../mod/docs/USER.md) for exactly what it does and how to turn it off.

## Reporting a security problem

Please do not open a public issue. Report it privately: on the repository's **Security** tab on GitHub choose
**Report a vulnerability** ([Load-Craft/onboard](https://github.com/Load-Craft/onboard/security)). Say what you found, how to
reproduce it and which version of the plugin you use (`/plugin` shows it). Do not include a real token in the report.
