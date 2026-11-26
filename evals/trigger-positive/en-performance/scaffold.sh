#!/usr/bin/env bash
# The sklep fixture with its git history, not bound to any LoadCraft project (run1-docs/scaffold.sh).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/../../run1-docs/scaffold.sh"
