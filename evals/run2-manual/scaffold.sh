#!/usr/bin/env bash
# Builds the sklep fixture, with its git history, in the empty workspace of the run.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
"$here/../fixtures/sklep/init-fixture.sh" "$build/sklep" >/dev/null
cp -a "$build/sklep/." .
rm -rf "$build"
