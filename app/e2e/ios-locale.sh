#!/bin/sh
# The phone's language on iOS: for each language the app is launched in it and its pairing screen says its first line in
# that language. Then the phone's own language is changed and the simulator restarted: the app follows it too.
# Usage: SIM_UDID=<udid> e2e/ios-locale.sh [app] [screenshots-dir]
set -eu
: "${SIM_UDID:?set SIM_UDID to the simulator to use}"
root=$(cd "$(dirname "$0")/.." && pwd)
bundle=${1:-$root/ios/build/Herdr.app}
shots=${2:-}
id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$root/nsh.json")
xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null
xcrun simctl uninstall "$SIM_UDID" "$id" 2>/dev/null || true
xcrun simctl install "$SIM_UDID" "$bundle"
screen() { perl -e 'alarm 60; exec @ARGV' idb ui describe-all --udid "$SIM_UDID" 2>/dev/null; }
says() { # tag title
  for _ in $(seq 1 30); do
    sleep 1
    case $(screen || true) in *"$2"*) echo "ok: $1 says \"$2\""; return 0 ;; esac
  done
  echo "FAIL: $1 doesn't say \"$2\""; return 1
}
fail=0
while IFS='|' read -r tag title; do
  xcrun simctl terminate "$SIM_UDID" "$id" 2>/dev/null || true
  xcrun simctl launch "$SIM_UDID" "$id" -AppleLanguages "($tag)" >/dev/null
  says "$tag" "$title" || fail=1
  if [ -n "$shots" ]; then xcrun simctl io "$SIM_UDID" screenshot "$shots/ios-$tag.png" >/dev/null 2>&1; fi
done <<'LANGS'
zh-Hans|手机上的 agent
zh-Hant|手機上的 agent
es|Tus agentes, en tu teléfono
ko|휴대폰으로 만나는 에이전트
ja|エージェントをスマホで
ru|Ваши агенты на телефоне
en|Your agents, on your phone
LANGS
xcrun simctl terminate "$SIM_UDID" "$id" 2>/dev/null || true
xcrun simctl spawn "$SIM_UDID" defaults write -g AppleLanguages -array ja
xcrun simctl shutdown "$SIM_UDID"
xcrun simctl boot "$SIM_UDID"
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null
xcrun simctl launch "$SIM_UDID" "$id" >/dev/null
says 'the phone in Japanese' 'エージェントをスマホで' || fail=1
xcrun simctl spawn "$SIM_UDID" defaults delete -g AppleLanguages 2>/dev/null || true
[ "$fail" = 0 ] && echo "PASS: seven languages on the pairing screen, and the phone's own language"
exit $fail
