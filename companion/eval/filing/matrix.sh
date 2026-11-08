#!/bin/sh
# Runs the evaluation once per agent and model, then compares them.
# Usage: companion/eval/filing/matrix.sh LIST OUT-DIR
#   LIST has one line per run: a short name, a tab, and the filing agent's command, for example
#     Claude Code · Haiku 5.5<TAB>claude --model claude-haiku-5-5
#     Pi · DeepSeek V4.1 Flash<TAB>pi --model <the id your Pi uses for it>
#   The name goes in the report; the command stays on this computer.
#   Lines starting with # are skipped. LANGS works as in run.sh.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
list=$1 out=$2
mkdir -p "$out"
grep -v '^#' "$list" | grep . | while IFS="$(printf '\t')" read -r name cmd; do
  dir=$(printf '%s' "$name" | tr -cs 'A-Za-z0-9.' '-')
  echo "== $name"
  AGENT=$cmd LABEL=$name "$here/run.sh" "$out/$dir" > "$out/$dir.log" 2>&1 || true
  grep -E '^(PASS|FAIL)' "$out/$dir.log" || tail -1 "$out/$dir.log"
done
python3 -I "$here/compare.py" "$out"
