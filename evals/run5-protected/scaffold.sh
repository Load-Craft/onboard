#!/usr/bin/env bash
# Builds the sklep fixture, with its git history, in the empty workspace of the run, and adds the
# next revision of the API description, stamped with the commit that runs on qa (develop).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
"$here/../fixtures/sklep/init-fixture.sh" "$build/sklep" >/dev/null
cp -a "$build/sklep/." .
rm -rf "$build"
sed "s/DEVELOP_COMMIT/$(git rev-parse develop)/" "$here/openapi.next.json" > loadcraft/openapi.next.json
