#!/usr/bin/env bash
# Packages each skill from skills/ into its own downloadable ZIP in dist/.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/*.zip

for dir in skills/*/; do
  name="$(basename "$dir")"
  (cd skills && zip -rq "../dist/${name}.zip" "$name")
  echo "dist/${name}.zip"
done
