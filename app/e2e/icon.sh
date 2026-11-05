#!/bin/sh
# The app's icon is Herdr Anywhere's own drawing: nothing in the repository carries Herdr's ram, and each platform has it.
# Usage: e2e/icon.sh [apk]   Needs git and sips. With an APK, also looks inside it.
set -u
cd "$(dirname "$0")/.."
bad=0
fail() { echo "FAIL: $*"; bad=1; }

# The start of the path in Herdr's assets/logo.svg, and the note that went with it. Built here so this file does not match itself.
ram="M2794 ""3710"
note="Ram path ""adapted"
git grep -lqF -e "$ram" -e "$note" -- .. && fail "Herdr's ram path is still in: $(git grep -lF -e "$ram" -e "$note" -- .. | tr '\n' ' ')"
grep -q 'Herdr mark' ../NOTICE && fail "NOTICE still lists the Herdr mark"
for old in assets/brand/herdr.png assets/herdr-ui-icon-clean.svg assets/herdr-ui-icon-clean.png; do
  [ -e "$old" ] && fail "$old is still here"
done

for f in assets/brand/herdr-anywhere.svg assets/brand/herdr-anywhere-full.svg assets/brand/herdr-anywhere.png; do
  [ -f "$f" ] || fail "$f is missing"
done
grep -q "assets/brand/herdr-anywhere.png" src/ui/home.tsx || fail "the home screen does not use the new icon"

# Android: an adaptive icon, so the launcher's mask shapes it. minSdk is above 26, so no PNG is needed.
res=android/app/src/main/res
grep -q 'android:icon="@mipmap/app_icon"' android/app/src/main/AndroidManifest.xml || fail "manifest has no launcher icon"
grep -q '<adaptive-icon' "$res/mipmap-anydpi-v26/app_icon.xml" 2>/dev/null || fail "no adaptive launcher icon"
[ -f "$res/drawable/app_icon_foreground.xml" ] || fail "no adaptive foreground"
[ -f "$res/drawable/ic_notify.xml" ] || fail "no notification icon"
git check-ignore -q "$res/mipmap-anydpi-v26/app_icon.xml" && fail "the adaptive icon is git-ignored"

# iOS: one opaque 1024 px image in an asset catalog the project names. App icons must have no alpha.
png=ios/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon.png
if [ -f "$png" ]; then
  [ "$(sips -g pixelWidth "$png" | awk '/pixelWidth/{print $2}')" = 1024 ] || fail "iOS icon is not 1024 px"
  [ "$(sips -g hasAlpha "$png" | awk '/hasAlpha/{print $2}')" = no ] || fail "iOS icon has an alpha channel"
else
  fail "no iOS icon"
fi
grep -q 'ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon' ios/project.yml || fail "project.yml does not name the app icon"

if [ -n "${1:-}" ]; then
  names=$(unzip -l "$1" | awk '{print $4}')
  echo "$names" | grep -q 'ic_launcher.*\.png' && fail "the APK still holds a PNG launcher icon"
  echo "$names" | grep -q 'brand.herdr\.' && fail "the APK still holds the Herdr mark"
fi

[ "$bad" = 0 ] && echo PASS || exit 1
