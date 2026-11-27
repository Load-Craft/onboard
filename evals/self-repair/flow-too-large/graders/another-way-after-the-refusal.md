---
type: regex
pattern: '"name"\s*:\s*"mcp__plugin_loadcraft_lc__(?:flows_describe_journeys|flows_import_har|flows_generate_from_endpoints|flows_generate_from_har)"|"name"\s*:\s*"mcp__plugin_loadcraft_lc__flows_generate_from_suggestions"[^\n]*"suggestions"\s*:\s*\[(?:(?!"zakupy")[^\]])*\]'
match: contains
target: trace
---
