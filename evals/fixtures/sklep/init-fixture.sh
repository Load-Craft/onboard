#!/usr/bin/env bash
# Copies the sklep fixture into a new directory and gives it the git history of the example
# session, so an agent can run `git diff`, `git log` and `git worktree` in it:
#
#   v2.13.2   previous release (prod): the shop without API documentation
#   (docs)    loadcraft/openapi.json, stamped with the v2.13.2 commit - the "old documentation"
#   v2.14.0   release under test (perf): main, the code differs from the documentation
#   develop   qa: 12 commits ahead of v2.14.0
#   dev       latest: 31 commits ahead of v2.14.0 (19 beyond develop)
#
# Usage: init-fixture.sh <target-dir>   (the directory must not exist or must be empty)

set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:?usage: init-fixture.sh <target-dir>}"

if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET")" ]; then
  echo "init-fixture.sh: $TARGET is not empty" >&2
  exit 1
fi
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

cd "$TARGET"
git init --quiet -b main
git config user.name "Sklep Developer"
git config user.email "dev@example.com"
git config commit.gpgsign false

commit() { # message
  git add -A
  git commit --quiet -m "$1"
}

copy_from_source() { # paths...
  for path in "$@"; do
    mkdir -p "$(dirname "$path")"
    cp -R "$SOURCE/$path" "$path"
  done
}

# v2.13.2: everything except the documentation, at the previous version.
copy_from_source package.json src deploy .gitignore .env.perf .env.qa .env.dev .env.prod .mcp.json nagrania \
  README.md
sed -i.bak 's/"version": "2.14.0"/"version": "2.13.2"/' package.json
sed -i.bak 's/ref: v2.14.0/ref: v2.13.2/' deploy/versions.yaml
rm -f package.json.bak deploy/versions.yaml.bak
printf '# Changelog\n\n- 2.13.2: previous release\n' > CHANGELOG.md
commit "release 2.13.2"
git tag v2.13.2
RELEASED="$(git rev-parse HEAD)"

# The old documentation, derived from v2.13.2.
mkdir -p loadcraft
cp "$SOURCE/loadcraft/openapi.json" loadcraft/openapi.json
sed -i.bak "s/\"commit\": \"[0-9a-f]*\"/\"commit\": \"$RELEASED\"/" loadcraft/openapi.json
rm -f loadcraft/openapi.json.bak
commit "docs: API description for LoadCraft"

# v2.14.0: the release under test.
copy_from_source package.json deploy/versions.yaml
printf -- '- 2.14.0: release under load test\n' >> CHANGELOG.md
commit "release 2.14.0"
git tag v2.14.0

filler() { # count prefix
  for i in $(seq 1 "$1"); do
    printf -- '- %s change %s\n' "$2" "$i" >> CHANGELOG.md
    commit "$2: change $i"
  done
}

git switch --quiet -c develop
filler 12 develop
git switch --quiet -c dev
filler 19 dev
git switch --quiet main

echo "sklep fixture ready in $TARGET (main = v2.14.0, develop = +12, dev = +31)"
