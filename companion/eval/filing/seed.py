#!/usr/bin/env python3 -I
"""Writes one language's starting progress file: the user's tasks, a task per stopped pane, and the batch queued
as the companion queues it (a stop, a scanned session, a typed message). Usage: seed.py cases.json LANG track.json"""
import json, sys

cases, lang, path = sys.argv[1:4]
run = next(r for r in json.load(open(cases))["runs"] if r["lang"] == lang)
# Ids the scorer reads back: a stop's task is S-<item>, a message's pane is its own, at 1000 + its place in the batch.
things = [{"id": t["id"], "outcome": t["title"], "stage": "doing", **({"parent": t["under"]} if t.get("under") else {}),
           **({"panes": [{"side": "hc", "addr": ("v" if t["id"] == "T4" else "a") + t["id"][1:], "at": 1}]} if t["id"] != "P1" else {})} for t in run["seed"]]
# T4 came from an earlier scan of the long session's pane (v4).
queue = []
for n, it in enumerate(run["items"], 1):
    at, qid = 1000 + n, f"Q{n}"
    if it["kind"] == "stop":
        things.append({"id": "S-" + it["id"], "outcome": it["title"], "stage": "doing", "parent": "P1", "panes": [{"side": "hc", "addr": it["id"], "at": 1}]})
        queue.append({"id": qid, "kind": "stop", "task": "S-" + it["id"], "text": it["text"], "pane": {"side": "hc", "addr": it["id"], "at": 1}, "at": at})
    elif it["kind"] == "session":
        # As scanItems (companion/cmd/herdr-anywhere/organizer.go) writes it.
        text = "What the user said in this pane's current session, oldest first, each with the agent's answer (long ones cut short; no Agent line: it had not answered):\n"
        text += "".join(f"- User: {u}\n" + (f"  Agent: {a}\n" if a else "") for u, a in it["turns"])
        queue.append({"id": qid, "kind": "session", "text": text, "pane": {"side": "hc", "addr": it["id"]}, "at": at})
    else:
        queue.append({"id": qid, "text": it["text"], "pane": {"side": "hc", "addr": it["pane"], "at": at}, "agent_said": it["agent_said"], "at": at})
json.dump({"version": 2, "things": things, "queue": queue, "scan_answer": "yes"}, open(path, "w"), ensure_ascii=False, indent=1)
