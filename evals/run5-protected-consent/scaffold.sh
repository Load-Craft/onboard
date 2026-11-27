#!/usr/bin/env bash
# Same workspace as run5-protected: the sklep fixture with loadcraft/openapi.next.json.
set -euo pipefail

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../run5-protected/scaffold.sh"
