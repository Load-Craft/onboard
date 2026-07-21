#!/usr/bin/env bash
# Pakuje każdy skill z skills/ do osobnego ZIP-a w dist/ — gotowego do pobrania.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/*.zip

for dir in skills/*/; do
  name="$(basename "$dir")"
  (cd skills && zip -rq "../dist/${name}.zip" "$name")
  echo "dist/${name}.zip"
done
