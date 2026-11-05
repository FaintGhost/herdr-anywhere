#!/bin/sh
# Makes the icon's PNGs from assets/brand/*.svg: the home screen's small image and the iOS app icon.
# Android draws the same shapes from res/drawable/app_icon_foreground.xml, so change them there too.
# Usage: scripts/gen-icon.sh   Needs Google Chrome (to render the SVG) and sips.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
shot() { # svg, png, background colour for Chrome (8 hex digits)
  printf '<!doctype html><body style="margin:0;background:transparent"><img src="file://%s" width=1024 height=1024 style="display:block"></body>' "$1" > "$work/p.html"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$work/profile" \
    --default-background-color="$3" --window-size=1024,1024 --screenshot="$2" "file://$work/p.html" >/dev/null 2>&1
}
shot "$root/assets/brand/herdr-anywhere.svg" "$work/tile.png" 00000000
sips -z 160 160 "$work/tile.png" --out "$root/assets/brand/herdr-anywhere.png" >/dev/null
# App icons must have no alpha channel, and a JPEG has none: render opaque, then go through JPEG at top quality.
shot "$root/assets/brand/herdr-anywhere-full.svg" "$work/full.png" 3C4046FF
sips -s format jpeg -s formatOptions best "$work/full.png" --out "$work/full.jpg" >/dev/null
sips -s format png "$work/full.jpg" --out "$root/ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png" >/dev/null
