#!/bin/sh
# Package the journey-recorder extension for the marketplace: the zip unpacks
# to a single folder Chrome can "Load unpacked" directly.
set -eu
cd "$(dirname "$0")"
VERSION=$(node -p "require('./manifest.json').version")
OUT_DIR="../../dist"
STAGE="$OUT_DIR/vitrinka-recorder"
rm -rf "$STAGE" "$OUT_DIR"/vitrinka-recorder-*.zip
mkdir -p "$STAGE"
cp -R manifest.json background.js db.js version.js wire.js content.js hud.html hud.js popup.html popup.js \
      options.html options.js icons vendor INSTALL.md README.md "$STAGE/"
(cd "$OUT_DIR" && zip -qr "vitrinka-recorder-$VERSION.zip" vitrinka-recorder)
rm -rf "$STAGE"
echo "dist/vitrinka-recorder-$VERSION.zip"
