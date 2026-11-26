---
type: tool_order
before: mcp__plugin_loadcraft_lc__data_check_readiness
after: { tool: mcp__plugin_loadcraft_lc__data_create_accounts, input_match: '^(?:(?!"confirm_protected"\s*:\s*true)[\s\S])*$' }
---
