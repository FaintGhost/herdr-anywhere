#!/bin/sh
# The Android app on an emulator against a computer somewhere else, over Tailcat's real relays: CI's Windows runner,
# with the invite decoded from the Herdr dialog's QR code there (windows-add-phone.ps1). Both computers need the
# internet only.
#
#   ANDROID_SERIAL=emulator-5554 e2e/android-remote.sh open <apk>
#       installs the app with no data and opens it on the pairing screen
#   ANDROID_SERIAL=emulator-5554 e2e/android-remote.sh pair <invite file> <screenshot folder>
#       types the invite, pairs, and passes when home lists acme-api (the computer's terminal), a command sent from the
#       terminal's input box runs there (the computer's job checks), and then, once the computer removes this phone, the app asks to
#       pair again
#
# Nothing printed holds the invite: the screen is only read for ids and the texts below, and pairing codes are masked.
set -eu
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to the device to use}"
app=$(cd "$(dirname "$0")/.." && pwd)
adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$app/nsh.json")
readonly id
fail() { echo "FAIL: $*"; exit 1; }

xml() { "$adb" shell uiautomator dump /sdcard/hm.xml >/dev/null 2>&1; "$adb" shell cat /sdcard/hm.xml; }
# The centre of the view with this resource-id (an NSH testID).
at() {
  xml | tr '>' '\n' | grep -F "resource-id=\"$1\"" | head -1 |
    sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}
tap() {
  xy=""; for _ in 1 2 3 4 5 6 7 8 9 10; do xy=$(at "$1"); [ -n "$xy" ] && break; sleep 1; done
  [ -n "$xy" ] || fail "no view $1 on screen"
  "$adb" shell input tap $xy
}
screen_has() { xml | grep -qF "$1"; }
# For a failure: the screen's ids and texts, any invite or pairing link masked.
screen() {
  echo "--- on the phone's screen:"
  xml | tr '>' '\n' | grep -oE '(resource-id|text)="[^"]+"' | head -40 | sed -E 's/herdr1:[A-Za-z0-9_-]+/herdr1:…/g; s/#pair=[A-Za-z0-9_-]+/#pair=…/g'
}

case "${1:-}" in
  open)
    apk=$2
    "$adb" install -r "$apk" >/dev/null 2>&1 || { "$adb" uninstall "$id" >/dev/null; "$adb" install "$apk" >/dev/null; }
    "$adb" shell pm clear "$id" >/dev/null
    "$adb" shell pm grant "$id" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
    "$adb" shell am start -W -n "$id/.MainActivity" >/dev/null
    for _ in $(seq 1 30); do screen_has 'resource-id="pair-link"' && break; sleep 1; done
    screen_has 'resource-id="pair-link"' || { screen; fail "the app did not open on the pairing screen"; }
    echo "ok: the app is open on the pairing screen"
    ;;
  pair)
    invite=$(cat "$2")
    shots=$3
    mkdir -p "$shots"
    case $invite in herdr1:*) ;; *) fail "$2 holds no invite" ;; esac
    # The check that home lists the computer's project, seen failing: before pairing it doesn't.
    screen_has acme-api && fail "the screen shows acme-api before pairing"
    echo "ok: before pairing, the screen shows no acme-api"
    # What the link field holds: pair-link is the field's wrapper; the text is its child's.
    typed() { xml | tr '>' '\n' | sed -n '/resource-id="pair-link"/,$p' | grep -oE 'text="[^"]+"' | head -1 | sed -E 's/^text="(.*)"$/\1/'; }
    # One long `adb shell input text` keeps only its first ~200 characters, and CI's emulator types ~11 characters a
    # second and drops some: in 150-character pieces most (on CI), in 40-character pieces now and then. The
    # code expires 2 minutes after it shows, so a retry keeps what is right: it deletes from the first wrong character
    # and types the rest (a CI run that cleared the field first saw the code expire).
    send() {
      rest=$1
      while [ -n "$rest" ]; do
        piece=$(printf %s "$rest" | cut -c1-40); rest=$(printf %s "$rest" | cut -c41-)
        "$adb" shell input text "'$piece'" </dev/null
      done
    }
    started=$(date +%s)
    tap pair-link
    send "$invite"
    for _ in 1 2 3 4 5; do
      got=$(typed); [ "$got" = "$invite" ] && break
      same=$(python3 -c 'import os,sys; print(len(os.path.commonprefix(sys.argv[1:3])))' "$got" "$invite")
      echo "the field holds ${#got} of the invite's ${#invite} characters, the first $same right; typing from there"
      # The field keeps focus and its cursor stays after the last character typed.
      [ "${#got}" -gt "$same" ] && "$adb" shell input keyevent $(printf 'KEYCODE_DEL %.0s' $(seq 1 $((${#got} - same))))
      send "$(printf %s "$invite" | cut -c$((same + 1))-)"
    done
    got=$(typed)
    echo "typed in $(($(date +%s) - started)) s"
    [ "$got" = "$invite" ] || fail "the field never held the whole invite"
    started=$(date +%s)
    tap pair
    ok=""
    for _ in $(seq 1 120); do screen_has acme-api && { ok=1; break; }; sleep 1; done
    # No screenshot before home shows: until then the field on screen holds the invite.
    if [ -z "$ok" ]; then
      xml | tr '>' '\n' | grep 'resource-id="pair-error"' | sed -E 's/.*text="([^"]*)".*/  phone says: \1/' || true
      screen; fail "within 120 s of the tap on Pair, home does not list acme-api"
    fi
    "$adb" exec-out screencap -p > "$shots/1-home.png"
    echo "ok: paired over Tailcat; home lists the Windows computer's acme-api $(($(date +%s) - started)) s after the tap on Pair"

    tap space-spwin
    sleep 3
    tap compose-input
    # Spaces around >: Windows' terminal here is pwsh, which reads `phone>` as a word (on CI's Windows runner); cmd and pwsh
    # both write the file this way.
    "$adb" shell input text "'echo phone > hm-typed'"
    tap compose-send
    "$adb" shell input keyevent 4 # the keyboard away, so the terminal's rows show
    sleep 3
    "$adb" exec-out screencap -p > "$shots/2-terminal.png"
    echo "ok: sent 'echo phone > hm-typed' from the terminal's input box (the computer checks that it ran)"

    # The computer's job removes this phone once it has seen the file; the app is then told on its connection.
    gone=""
    for _ in $(seq 1 600); do screen_has 'This computer no longer knows this phone' && { gone=1; break; }; sleep 1; done
    "$adb" exec-out screencap -p > "$shots/3-removed.png"
    [ -n "$gone" ] || { screen; fail "the app never said the computer no longer knows this phone"; }
    echo "ok: removed on the computer, the app asks to pair again"
    echo PASS
    ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
