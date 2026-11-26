---
type: regex
pattern: '"name"\s*:\s*"mcp__plugin_loadcraft_lc__(?:flows_generate_from_suggestions|flows_generate_from_endpoints|flows_generate_from_har|flows_describe_journeys|flows_record_journeys|flows_import_har)"'
match: not_contains
target: trace
---
