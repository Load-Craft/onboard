# Known limits

## Subagent `tools` list and MCP tools

Checked on 2026-11-25 with Claude Code 2.1.325 in `claude -p --plugin-dir <copy> --no-session-persistence` mode, using `mcp/scripts/probe-subagent-tools.mjs` (a throw-away plugin with a stub MCP server and one subagent, run from an empty working directory). The documentation does not say whether the `tools` field of a plugin subagent takes full MCP names; in all three runs it did.

A subagent whose `tools` listed only `mcp__plugin_<plugin>_<server>__<tool>` called that tool successfully, and a call of the second tool of the same server, left off the list, failed with "No such tool available", so both halves are proven: the full name is accepted and the list restricts. Not covered: interactive mode, a model other than the default, and servers whose tools Claude Code defers (tool search); re-run the script after a Claude Code upgrade.
