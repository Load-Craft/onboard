#!/usr/bin/env bash
# The bound sklep repository (see resume/scaffold.sh).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/../resume/scaffold.sh"
