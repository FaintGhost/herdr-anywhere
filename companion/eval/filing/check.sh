#!/bin/sh
# Before a release: the filing agent's last evaluation (last-report.json, from run.sh) passed, on the rules and code
# as they are now. Any change to the filing rules, the track code or the evaluation needs a new run first.
# Usage: companion/eval/filing/check.sh [report.json]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
report=${1:-$here/last-report.json}
[ -f "$report" ] || { echo "FAIL: no evaluation report ($report). Run companion/eval/filing/run.sh, then copy its report.json there."; exit 1; }
now=$(python3 -I "$here/score.py" --inputs)
python3 -I - "$report" "$now" "$here/cases.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
missing = [x["lang"] for x in json.load(open(sys.argv[3]))["runs"] if x["lang"] not in r.get("languages", {})]
if missing:
    sys.exit("FAIL: the last evaluation left out " + ", ".join(missing) + "; run run.sh with every language")
if r.get("inputs") != sys.argv[2]:
    sys.exit("FAIL: the filing rules, the track code or the evaluation changed since the last run; run run.sh again")
if not r.get("pass"):
    sys.exit("FAIL: the last evaluation failed: " + ", ".join(k for k, v in r["rules"].items() if not v["pass"]))
print(f"ok: the filing agent's evaluation passed on the current rules ({r.get('label', '?')})")
PY
