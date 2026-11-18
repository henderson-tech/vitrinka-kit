#!/usr/bin/env bash
# Build RecorderDemo and wrap it in RecorderDemo.app with the bundle id
# dev.vitrinka.recorder-demo and an ad hoc signature (a SwiftPM executable
# has no bundle id of its own).
#
# Usage:  bundle-demo.sh [debug|release] [--out DIR]
#         The app lands in DIR/<config>/RecorderDemo.app. DIR defaults to
#         $VITRINKA_DEMO_OUT, else ${TMPDIR:-/tmp}/vitrinka-recorder-demo.
#         The last line printed is the app's path.
set -euo pipefail

config=debug
out=${VITRINKA_DEMO_OUT:-${TMPDIR:-/tmp}/vitrinka-recorder-demo}
while [ "$#" -gt 0 ]; do
  case "$1" in
    debug|release) config=$1; shift ;;
    --out) out=$2; shift 2 ;;
    *) echo "usage: $0 [debug|release] [--out DIR]" >&2; exit 2 ;;
  esac
done

root=$(cd "$(dirname "$0")/../../.." && pwd)
swift build --package-path "$root" -c "$config" --product RecorderDemo >&2
bin="$(swift build --package-path "$root" -c "$config" --show-bin-path)/RecorderDemo"

app="${out%/}/$config/RecorderDemo.app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/RecorderDemo"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.vitrinka.recorder-demo</string>
  <key>CFBundleName</key><string>RecorderDemo</string>
  <key>CFBundleDisplayName</key><string>Recorder Demo</string>
  <key>CFBundleExecutable</key><string>RecorderDemo</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force --sign - --timestamp=none "$app" >&2
echo "$app"
