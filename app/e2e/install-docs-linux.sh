#!/usr/bin/env bash
# Runs the Linux steps of README.md and INSTALL.md as they are written, on Linux (CI's Linux jobs), with the release
# download pointed at a folder holding only this machine's file, built here: a release file can't be downloaded before
# it is released, and a step that picks the wrong file for `uname -m` finds nothing there.
#
#   app/e2e/install-docs-linux.sh <folder with herdr-anywhere-linux-amd64 or -arm64> <herdr-core>
#
# Each document runs in its own fresh home, with herdr-core in ~/.local/bin as Herdr's installer puts it and the
# keys.json Herdr writes when it first opens, so nothing outside a temp folder changes.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
files=$(cd "$1" && pwd)
core=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
download=https://github.com/jt-wang/herdr-anywhere/releases/latest/download/
fail() { echo "FAIL: $*" >&2; exit 1; }

# The first ```sh block of a file that holds $2, without the list's indent.
block() {
  awk -v want="$2" '
    /^ *```sh/ { on = 1; text = ""; next }
    /^ *```/ && on { on = 0; if (index(text, want)) { printf "%s", text; exit } next }
    on { sub(/^   /, ""); text = text $0 "\n" }' "$1"
}

# Runs shell text in a fresh home; prints what it printed, then the home's keys.json.
run() {
  [ -n "$1" ] || fail "empty block"
  case "$1" in *"curl "*"$download"*) ;; *"curl "*) fail "a download that isn't a release file: $1" ;; esac
  local work; work=$(mktemp -d)
  mkdir -p "$work/home/.local/bin" "$work/home/.config/herdr-app"
  ln -s "$core" "$work/home/.local/bin/herdr-core"
  printf '{\n  "global": {\n    "ctrl-shift-t": "tab.new"\n  }\n}\n' > "$work/home/.config/herdr-app/keys.json"
  printf '%s\n' "${1//$download/file://$files/}" > "$work/steps.sh"
  # A shell like an agent's: no hc on PATH (as with herbstluftwm's hc, Herdr's installer then links none), no Go.
  HOME="$work/home" PATH=/usr/local/bin:/usr/bin:/bin sh -eu "$work/steps.sh" 2>&1
  echo "keys.json: $(tr -d '\n ' < "$work/home/.config/herdr-app/keys.json")"
}

expect() { grep -qF -- "$2" <<<"$1" || fail "$3 did not print \"$2\":
$1"; }

[ "$(uname -s)" = Linux ] || fail "this runs the Linux steps, on Linux"
ls "$files" | grep -qx 'herdr-anywhere-linux-\(amd64\|arm64\)' || fail "$files holds no Linux release file"
[ "$(ls "$files" | wc -l)" = 1 ] || fail "$files must hold only this machine's file"

# INSTALL.md 1: herdr-core is found.
out=$(run "$(block "$root/INSTALL.md" 'herdr-core --version')")
expect "$out" "hc " "INSTALL.md step 1"
echo "ok INSTALL.md step 1"

# INSTALL.md 2 and 3: download this machine's file, check the version, then add the dialog.
out=$(run "$(block "$root/INSTALL.md" 'herdr-anywhere-linux-')
$(block "$root/INSTALL.md" 'install-dialog')")
expect "$out" "herdr-anywhere " "INSTALL.md step 2"
expect "$out" "Add phone is installed. Press ctrl-shift-m in Herdr" "INSTALL.md step 3"
expect "$out" '"ctrl-shift-m":"mod.open:add-phone"' "INSTALL.md step 3's keys.json"
echo "ok INSTALL.md steps 2 and 3 ($(ls "$files"))"

# README's "Or install it yourself", on Linux.
out=$(run "$(block "$root/README.md" 'herdr-anywhere-linux-')")
expect "$out" "Add phone is installed. Press ctrl-shift-m in Herdr" "README.md"
expect "$out" '"ctrl-shift-m":"mod.open:add-phone"' "README.md's keys.json"
echo "ok README.md"
echo PASS
