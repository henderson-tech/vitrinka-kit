#!/bin/sh
# Package the journey-recorder extension: the marketplace zip unpacks to a
# single folder Chrome can "Load unpacked" directly, and the store zip is the
# same folder with the manifest `key` stripped — the Chrome Web Store rejects
# a first upload whose manifest contains `key` (the store signs with its own).
# The store zip lands in dist/webstore/ so release-extension.yaml's
# `dist/vitrinka-recorder-*.zip` artifact glob still matches exactly one file.
set -eu
cd "$(dirname "$0")"
VERSION=$(node -p "require('./manifest.json').version")
OUT_DIR="../../dist"
STAGE="$OUT_DIR/vitrinka-recorder"
STORE_DIR="$OUT_DIR/webstore"
rm -rf "$STAGE" "$STORE_DIR" "$OUT_DIR"/vitrinka-recorder-*.zip
mkdir -p "$STAGE" "$STORE_DIR"
cp -R manifest.json background.js db.js version.js wire.js content.js hud.html hud.js popup.html popup.js \
      options.html options.js icons vendor INSTALL.md README.md "$STAGE/"
(cd "$OUT_DIR" && zip -qr "vitrinka-recorder-$VERSION.zip" vitrinka-recorder)
node -e 'const fs=require("fs"),p=process.argv[1],m=JSON.parse(fs.readFileSync(p,"utf8"));delete m.key;fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")' \
      "$STAGE/manifest.json"
(cd "$OUT_DIR" && zip -qr "webstore/vitrinka-recorder-store-$VERSION.zip" vitrinka-recorder)
rm -rf "$STAGE"
echo "dist/vitrinka-recorder-$VERSION.zip"
echo "dist/webstore/vitrinka-recorder-store-$VERSION.zip (Web Store upload: key stripped)"
