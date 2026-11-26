#!/usr/bin/env bash
# Builds the sklep fixture, with its git history, and binds it to its LoadCraft project the way
# the project setup leaves it: the repository of a session that already set the project up.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/../run1-docs/scaffold.sh"
mkdir -p loadcraft
cat > loadcraft/project.json <<'JSON'
{
  "schema": 1,
  "url": "https://app.loadcraft.io",
  "project": {
    "id": "5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61",
    "name": "sklep"
  }
}
JSON
