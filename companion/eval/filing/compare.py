#!/usr/bin/env python3 -I
"""One table of matrix.sh's runs: each rule, and the time per language. Usage: compare.py OUT-DIR"""
import json, pathlib, sys

out = pathlib.Path(sys.argv[1])
reports = {d.name: json.loads((d / "report.json").read_text()) for d in sorted(out.iterdir()) if (d / "report.json").exists()}
rules = sorted({r for rep in reports.values() for r in rep["rules"]})
print("| agent · model | " + " | ".join(rules) + " | all | languages | seconds per language |")
print("|---" * (len(rules) + 4) + "|")
for name, rep in reports.items():
    cells = ["pass" if rep["rules"].get(r, {}).get("pass") else ("FAIL" if r in rep["rules"] else "-") for r in rules]
    secs = [v.get("seconds") for v in rep["languages"].values() if v.get("seconds") is not None]
    avg = f"{sum(secs) // len(secs)}" if secs else "-"
    print(f"| {rep.get('label') or name} | " + " | ".join(cells) + f" | {'PASS' if rep['pass'] else 'FAIL'} | {len(rep['languages'])} | {avg} |")
