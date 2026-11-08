#!/usr/bin/env bash
# Hands a pairing invite from one CI job to another through the run's artifacts, which anyone can download from a
# public repo: the phone's job makes a key pair and shares only the public half; the computer's job seals the invite
# to it; only the phone's job can open it. Nothing here prints the invite.
#
#   sealed-invite.sh key  <dir>                  makes <dir>/phone.key (private, stays) and <dir>/phone.pub (shared)
#   sealed-invite.sh seal <phone.pub> <invite file> <out dir>   writes <out dir>/key.sealed and <out dir>/invite.sealed
#   sealed-invite.sh open <phone.key> <sealed dir>              prints the invite
#   sealed-invite.sh wait <artifact> <dir> [seconds]            downloads this run's artifact once a job has uploaded it
#
# RSA-OAEP (SHA-256) seals a random AES-256 key; the key encrypts the invite. openssl is on GitHub's Linux and Windows
# runners (Windows: Git's).
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }

case "${1:-}" in
  key)
    mkdir -p "$2"
    (umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$2/phone.key" 2>/dev/null)
    openssl pkey -in "$2/phone.key" -pubout -out "$2/phone.pub"
    ;;
  seal)
    [ -s "$3" ] || fail "no invite in $3"
    mkdir -p "$4"
    secret=$(mktemp -d)
    trap 'rm -rf "$secret"' EXIT
    # No line end: Windows' openssl ends its lines with \r\n, and the key must read the same on Linux (otherwise:
    # bad decrypt).
    (umask 077; openssl rand -hex 32 | tr -d '\r\n' > "$secret/key")
    openssl pkeyutl -encrypt -pubin -inkey "$2" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
      -in "$secret/key" -out "$4/key.sealed"
    # The key on stdin: Windows' openssl can't open a Git Bash path given as file:/tmp/… (seen on CI).
    tr -d '\r\n' < "$secret/key" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass stdin -in "$3" -out "$4/invite.sealed"
    ;;
  open)
    secret=$(mktemp -d)
    trap 'rm -rf "$secret"' EXIT
    (umask 077; openssl pkeyutl -decrypt -inkey "$2" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 \
      -in "$3/key.sealed" -out "$secret/key")
    tr -d '\r\n' < "$secret/key" | openssl enc -d -aes-256-cbc -pbkdf2 -pass stdin -in "$3/invite.sealed"
    ;;
  wait)
    : "${GITHUB_RUN_ID:?}" "${GITHUB_REPOSITORY:?}" "${GH_TOKEN:?}"
    end=$(($(date +%s) + ${4:-1200}))
    until gh run download "$GITHUB_RUN_ID" -R "$GITHUB_REPOSITORY" -n "$2" -D "$3" >/dev/null 2>&1; do
      [ "$(date +%s)" -lt "$end" ] || fail "no artifact $2 within ${4:-1200} s"
      sleep 5
    done
    echo "got $2"
    ;;
  *) sed -n '2,13p' "$0" >&2; exit 2 ;;
esac
