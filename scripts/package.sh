#!/usr/bin/env bash
# Packages each stand-alone skill from skills/ into its own downloadable ZIP in dist/.
# Skills that need the MCP server (the guiding skill and the two commands) are left out:
# a ZIP without the server would not work. They ship only with the plugin.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/*.zip

STANDALONE=(loadcraft-openapi loadcraft-journeys loadcraft-asyncapi loadcraft-overview)

for name in "${STANDALONE[@]}"; do
  (cd skills && zip -rq "../dist/${name}.zip" "$name")
  echo "dist/${name}.zip"
done
