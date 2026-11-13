#!/usr/bin/env bash
# Fail a build whose binary links the live vitrinka recorder.
#
# The live recorder sends the canary "vitrinka-macos-live/1" in every
# request's User-Agent, so the linker keeps the string whenever the live code
# is linked. Release builds compile VitrinkaRecorder to empty stubs and must
# not contain it. Run this on every Release binary (or .app).
#
# Usage:  check-release-binary.sh <binary | Name.app>
# Exit:   0  clean: no live recorder in the binary (what a Release build must give)
#         1  the canary is present: the live recorder is linked (a Debug build gives this)
#         2  usage error, or the file does not exist
set -uo pipefail

canary='vitrinka-macos-live/1'

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <binary | Name.app>" >&2
  exit 2
fi

target=$1
if [ -d "$target" ] && [ -d "$target/Contents/MacOS" ]; then
  exe=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$target/Contents/Info.plist" 2>/dev/null || true)
  [ -n "$exe" ] || exe=$(basename "$target" .app)
  target="$target/Contents/MacOS/$exe"
fi

if [ ! -f "$target" ]; then
  echo "error: no such binary: $target" >&2
  exit 2
fi

# grep without -q reads all of its input, so strings never dies of SIGPIPE
# and pipefail cannot turn a match into a false "clean".
if command -v strings >/dev/null 2>&1; then
  hits=$(strings -a "$target" | grep -cF "$canary")
else
  hits=$(LC_ALL=C grep -acF "$canary" "$target")
fi

if [ "${hits:-0}" -gt 0 ]; then
  echo "error: $target contains the live vitrinka recorder ($canary). Release builds must not link it." >&2
  exit 1
fi
echo "ok: $target has no live vitrinka recorder"
exit 0
