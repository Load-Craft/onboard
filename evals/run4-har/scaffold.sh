#!/usr/bin/env bash
# Builds the sklep fixture, with its git history, in the empty workspace of the run, and takes the
# API description out of the repository: this customer has none.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
"$here/../fixtures/sklep/init-fixture.sh" "$build/sklep" >/dev/null
cp -a "$build/sklep/." .
rm -rf "$build"
git rm -q loadcraft/openapi.json
git commit -q -m "remove the API description"
