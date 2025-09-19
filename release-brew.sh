#!/bin/bash

VERSION=$(jq -r '.version' ./package.json)

# TARBALL_URL=$(curl -s https://registry.npmjs.org/spectrum-cli/$VERSION | jq -r '.dist.tarball')
# TMPFILE=$(mktemp)
# curl -sL "$TARBALL_URL" -o "$TMPFILE"
# SHA256=$(shasum -a 256 "$TMPFILE" | awk '{print $1}')
# rm -f "$TMPFILE"

cd ../homebrew-spectrum-cli

# # Обновить Formula/spectrum-cli.rb (совместимо с macOS sed)
# sed -i '' -E "s/spectrum-cli-[0-9.]*\\.tgz/spectrum-cli-$VERSION.tgz/" Formula/spectrum-cli.rb
# sed -i '' -E "s/sha256 \"[^\"]*\"/sha256 \"$SHA256\"/" Formula/spectrum-cli.rb

# Коммит и пуш
git add Formula/spectrum-cli.rb
git commit -m "Update spectrum-cli to v$VERSION"
git push origin main