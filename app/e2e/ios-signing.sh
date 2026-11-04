#!/bin/sh
# Someone else builds the app under their own Apple account: what they put in ios/Signing.local.xcconfig is what the
# project signs with, and a clone of this repository signs with no team of ours. Runs no compile and needs no account.
# Needs xcodegen and Xcode. Usage: e2e/ios-signing.sh
set -eu
ios=$(cd "$(dirname "$0")/../ios" && pwd)
local=$ios/Signing.local.xcconfig
saved=
if [ -e "$local" ]; then saved=$(mktemp); cp "$local" "$saved"; fi
restore() { if [ -n "$saved" ]; then mv "$saved" "$local"; else rm -f "$local"; fi; }
trap restore EXIT
setting() { xcodebuild -project "$ios/Herdr.xcodeproj" -scheme Herdr -configuration Release -showBuildSettings 2>/dev/null | sed -n "s/^ *$1 = //p" | head -1; }
fail=0
expect() { if [ "$2" = "$3" ]; then echo "✓ $1 is $3"; else echo "✗ $1 is '$2', wanted '$3'"; fail=1; fi; }
(cd "$ios" && mkdir -p nsh && xcodegen generate --quiet)

rm -f "$local"
expect 'with nothing set, the team' "$(setting DEVELOPMENT_TEAM)" ''
expect 'with nothing set, signing' "$(setting CODE_SIGN_STYLE)" Automatic

printf 'DEVELOPMENT_TEAM = TESTTEAM00\nBUNDLE_ID_PREFIX = com.example.builder\n' > "$local"
expect 'the team' "$(setting DEVELOPMENT_TEAM)" TESTTEAM00
expect 'the bundle id' "$(setting PRODUCT_BUNDLE_IDENTIFIER)" com.example.builder.herdranywhere
expect 'signing' "$(setting CODE_SIGN_STYLE)" Automatic
exit $fail
