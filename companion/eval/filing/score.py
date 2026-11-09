#!/usr/bin/env python3 -I
"""Scores a run of run.sh against the rules in README.md and writes <out>/report.json.
Usage: score.py cases.json OUT-DIR. Exits 1 when a rule fails."""
import hashlib, json, pathlib, re, shlex, sys

here = pathlib.Path(__file__).resolve().parent

# --- what language a text is in, by its letters (names, numbers, paths and code are taken out first) ---
SIMPLIFIED_ONLY = set("们这说时对还为后点过会开关门问题经让设图进页条务处应该钮写测试据库连须发现网络")
TRADITIONAL_ONLY = set("們這說時對還為後點過會開關門問題經讓設圖進頁條務處應該鈕寫測試據庫連須發現網絡")
ES_WORDS = {"de", "la", "el", "los", "las", "del", "para", "en", "con", "una", "un", "y", "por", "que", "al", "lo", "se", "su"}
EN_WORDS = {"the", "a", "an", "to", "of", "for", "and", "in", "on", "with", "is", "it", "or", "should", "which", "do", "you"}

def letters(text, keep):
    for k in sorted(keep, key=len, reverse=True):
        text = text.replace(k, " ")
    # Paths, file names, identifiers, versions, money and the like stay as they are in every language.
    return re.sub(r"\S*[\d_/.$#@:`]\S*|\b[A-Z][A-Za-z]*[A-Z]\w*\b|\b(?:FAQ|API|CI|README|CHANGELOG|Stripe|Acme|npm|registry|frontend|backend|banner|key|commit|push)\b", " ", text)

def in_lang(text, lang, keep=()):
    t = letters(text, keep)
    han, kana = re.search(r"[一-鿿]", t), re.search(r"[぀-ヿ]", t)
    hangul, cyr = re.search(r"[가-힯]", t), re.search(r"[Ѐ-ӿ]", t)
    latin = re.findall(r"[A-Za-zÀ-ÿ]+", t)
    words = {x.lower() for x in latin}
    if lang == "ja":
        return bool(kana) and not hangul
    if lang == "ko":
        return bool(hangul) and not kana
    if lang == "ru":
        return bool(cyr) and not han and not kana
    if lang == "zh-Hans":
        return bool(han) and not kana and not hangul and not (set(t) & TRADITIONAL_ONLY)
    if lang == "zh-Hant":
        return bool(han) and not kana and not hangul and not (set(t) & SIMPLIFIED_ONLY)
    if han or kana or hangul or cyr:
        return False
    if lang == "es":
        return bool(re.search(r"[áéíóúñ¿¡]", t)) or len(words & ES_WORDS) > 0 or not latin
    if lang == "en":
        return not re.search(r"[áéíóúñ¿¡]", t) and len(words & ES_WORDS - EN_WORDS - {"a", "en"}) == 0
    return True

# --- the commands the agent ran, from its own record of the session ---
READ_TOOLS = {"Read", "Glob", "Grep", "LS", "TodoWrite"}
TOOL_NAMES = {"bash": "Bash", "read": "Read", "grep": "Grep", "find": "Glob", "ls": "LS"}  # Pi's tools by Claude Code's names
CODEX_SAID = {"Reasoning", "AgentMessage", "UserMessage", "Plan", "TodoList"}  # Codex's record of what was said, not done
CHECKED = {"claude", "pi", "codex"}  # the agents whose session record the evaluation reads

def commands(dirpath):
    for f in sorted(dirpath.glob("*.jsonl")):
        for line in f.read_text(errors="replace").splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            m = d.get("message") or {}
            item = (d.get("payload") or {}).get("item") if (d.get("payload") or {}).get("type") == "item_completed" else None
            if isinstance(item, dict):  # Codex: what it did, as it happened
                if item.get("type") == "CommandExecution":
                    c = item.get("command") or []
                    yield "Bash", {"command": c[-1] if len(c) > 2 and c[-2] in ("-c", "-lc") else " ".join(map(str, c))}
                elif item.get("type") not in CODEX_SAID:
                    yield item.get("type"), {}
                continue
            for c in m.get("content") if isinstance(m.get("content"), list) else []:
                if isinstance(c, dict) and c.get("type") == "tool_use":  # Claude Code
                    yield c.get("name"), c.get("input") or {}
                elif isinstance(c, dict) and c.get("type") == "toolCall":  # Pi
                    yield TOOL_NAMES.get(c.get("name"), c.get("name")), c.get("arguments") or {}

# Shell helpers that read or print and change nothing.
HARMLESS = {"echo", "printf", "command", "type", "which", "ls", "pwd", "true", "false", ":", "set", "test", "[", "local", "export", "cd", "head", "tail"}

def without_heredocs(cmd):
    """The command without the text of its here-documents (<<'END' ... END), which is input, not commands."""
    out, end = [], None
    for line in cmd.split("\n"):
        if end is not None:
            if line.strip() == end:
                end = None
            continue
        out.append(line)
        m = re.search(r"<<-?\s*(['\"]?)([A-Za-z_]\w*)\1", line)
        if m:
            end = m.group(2)
    return "\n".join(out)

def segments(cmd):
    """Split a shell command into simple commands, outside quotes: at ; & | newlines, ( ) { } and backticks."""
    cmd = without_heredocs(cmd)
    segs, cur, q, i = [], [], None, 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            cur.append(c)
            if c == "\\" and q == '"' and i + 1 < len(cmd):
                cur.append(cmd[i + 1]); i += 1
            elif c == q:
                q = None
        elif c in "'\"":
            q = c; cur.append(c)
        elif c == "\\" and cmd[i + 1:i + 2] == "\n":  # a command going on to the next line
            cur.append(" "); i += 1
        elif c == "\\" and i + 1 < len(cmd):
            cur += [c, cmd[i + 1]]; i += 1
        elif c == "&" and (cur[-1:] == [">"] or cmd[i + 1:i + 2] == ">"):  # 2>&1, &>
            cur.append(c)
        elif c in ";&|\n(){}`" or (c == "$" and cmd[i + 1:i + 2] == "("):
            segs.append("".join(cur)); cur = []
        else:
            cur.append(c)
        i += 1
    segs.append("".join(cur))
    return [x.strip() for x in segs if x.strip() and not x.strip().startswith("#")]

def bad_segments(cmd):
    """Parts of a shell command that do more than herdr-anywhere track queue/place/tree/set/move and harmless shell:
    any other program or herdr-anywhere command, or writing to a file."""
    bad, funcs = [], set(re.findall(r"(?:^|[\s;{])(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)", cmd))
    for seg in segments(cmd):
        try:
            words = shlex.split(seg)
        except ValueError:
            bad.append(seg)
            continue
        for k, w in enumerate(words):  # writing to a file
            if re.match(r"^(?:&|\d*)>>?$", w) and words[k + 1:k + 2] != ["/dev/null"] or re.match(r"^(?:&|\d*)>>?[^&]", w) and not w.endswith("/dev/null"):
                bad.append(seg)
                break
        else:
            while words and re.match(r"^[A-Za-z_]\w*=", words[0]):  # H=herdr-anywhere, or an env var before a command
                words = words[1:]
            words = [w for w in words if not re.match(r"^\d*>&\d+$", w)]  # 2>&1, after a ( ... ) or on its own
            if not words or words[0] in HARMLESS or words[0] in funcs or words[0] == "$":
                continue
            if words[0] in ("cat", "head", "sed", "less") and [w for w in words[1:] if not w.startswith("-")] and all(
                    w.startswith("-") or w.endswith(("CLAUDE.md", "AGENTS.md")) or re.match(r"^'?\d+,\d+p'?$", w) for w in words[1:]):
                continue  # reads its own rules
            prog = words[0]
            if (prog.endswith("herdr-anywhere") or prog.startswith("$")) and words[-1:] in (["--help"], ["-h"]):  # reads its own help
                continue
            if (prog.endswith("herdr-anywhere") or prog.startswith("$")) and words[1:2] == ["track"] and words[2:3] and words[2] in ("queue", "place", "tree", "set", "move"):
                continue
            if prog.startswith("$") and len(words) == 1:  # the end of H=$(command -v herdr-anywhere)
                continue
            bad.append(seg)
    return bad

def run_inputs():
    """What the agent worked with in a run: the filing rules, the track code behind its commands, and the cases."""
    cmd = here.parent.parent / "cmd/herdr-anywhere"
    files = [cmd / n for n in ("organizer.go", "organizer_agent.go", "track.go", "track_batch.go")]
    files += sorted(p for p in (here.parent.parent / "internal/track").glob("*.go") if not p.name.endswith("_test.go"))
    files += [here / n for n in ("cases.json", "seed.py", "run.sh")]
    h = hashlib.sha256()
    for p in files:
        h.update(p.name.encode() + b"\0" + p.read_bytes())
    return h.hexdigest()

def inputs(at_run=None):
    """What a result depends on: what the agent worked with (as it was when the run started) and this scorer."""
    return hashlib.sha256(((at_run or run_inputs()) + (here / "score.py").read_text()).encode()).hexdigest()


def ratio(n, d):
    return f"{n}/{d}"

def main():
    cases_path, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    # The languages this run covered (LANGS in run.sh); check.sh asks for all of them before a release.
    runs = [r for r in json.load(open(cases_path))["runs"] if (out / r["lang"]).is_dir()]
    cmd = (out / "agent.txt").read_text().strip() if (out / "agent.txt").exists() else ""
    # Only the agent's program and a name for the run go in the report, which may be published: the full command
    # would show this computer's folders and how its models are reached.
    words = re.sub(r"^env\s+(?:\S+=\S*\s+)*", "", cmd).split()
    agent = words[0].rsplit("/", 1)[-1] if words else ""
    label = (out / "label.txt").read_text().strip() if (out / "label.txt").exists() else out.name
    report = {"agent": agent, "label": label, "languages": {}, "rules": {}}
    fail = []
    rule = {}  # rule id -> list of (lang, ok, detail)

    def check(rid, lang, ok, detail):
        rule.setdefault(rid, []).append({"lang": lang, "ok": bool(ok), "detail": detail})

    for r in runs:
        lang = r["lang"]
        p = out / lang / "track.json"
        if not p.exists():
            check("R5", lang, False, "no progress file: the run did not happen")
            continue
        f = json.load(open(p))
        things = {t["id"]: t for t in f.get("things") or []}
        seed = {t["id"] for t in r["seed"]} | {"S-" + it["id"] for it in r["items"] if it["kind"] == "stop"}
        new = [t for t in things.values() if t["id"] not in seed]
        lines = []  # every line the agent wrote for the user: (what, text, keep)
        stops_ok = stops_n = 0
        sessions_ok = sessions_n = 0
        messages_ok = 0
        groups = {}  # a group of sessions -> the tasks found in them
        for n, it in enumerate(r["items"], 1):
            at = 1000 + n
            if it["kind"] == "stop":
                t = things.get("S-" + it["id"], {})
                got, waiting = t.get("stage"), t.get("waiting", "")
                stops_n += 1
                stops_ok += got == it["want"]
                if it["want"] == "waiting":
                    check("R1", lang, got == "waiting" and waiting, f"{it['id']}: {got} {waiting!r} ← {it['text']!r}")
                if waiting:
                    lines.append((f"{it['id']} waiting", waiting, it.get("keep", [])))
                    for k in it.get("keep", []):
                        check("R4", lang, k in waiting, f"{it['id']}: {k!r} in {waiting!r}")
            elif it["kind"] == "session":
                got = [t for t in new if any(q.get("addr") == it["id"] for q in t.get("panes") or [])]
                for t in got:
                    lines.append((f"{it['id']} title", t["outcome"], [w.get("keep", "") for w in it["want"] if w.get("keep")]))
                if it.get("group"):
                    groups.setdefault(it["group"], []).extend(got)
                    continue
                if it.get("stages"):
                    right = 0
                    for want in it["want"]:
                        m = [t for t in got + [things.get("T4", {"outcome": ""})] if want["keep"] in t["outcome"]]
                        right += bool(m) and m[0].get("stage") == want["stage"]
                    check("R10", lang, right >= len(it["want"]) - 1, f"{it['id']}: {right}/{len(it['want'])} stages right; got " +
                          "; ".join(f"{t['outcome']} [{t.get('stage')}]" for t in got))
                    continue
                sessions_n += 1
                ok = len(got) == len(it["want"])
                for want in it["want"]:
                    m = [t for t in got if not want.get("keep") or want["keep"] in t["outcome"]]
                    ok = ok and bool(m) and (m[0].get("stage") == "done") == want.get("done", False)
                sessions_ok += ok
                detail = f"{it['id']}: want {len(it['want'])}, got " + "; ".join(f"{t['outcome']} [{t.get('stage')}]" for t in got)
                if not it["want"]:
                    check("R9", lang, not got, detail)
                check("R7", lang, ok, detail)
            else:
                on = [t for t in things.values() if any(q.get("addr") == it["pane"] and q.get("at") == at for q in t.get("panes") or [])]
                if it["want"] == "new":
                    good = len(on) == 1 and on[0]["id"] not in seed
                    if on and on[0]["id"] not in seed:
                        lines.append((f"{it['id']} title", on[0]["outcome"], it.get("keep", [])))
                        for k in it.get("keep", []):
                            check("R4", lang, k in on[0]["outcome"], f"{it['id']}: {k!r} in {on[0]['outcome']!r}")
                else:
                    good = [t["id"] for t in on] == [it["want"]]
                messages_ok += good
                check("R8", lang, good, f"{it['id']}: want {it['want']}, on " + ", ".join(f"{t['id']} {t['outcome']}" for t in on))
        # A task an earlier scan left is found again: it keeps its id and takes the stage, no second task (R13).
        if "T4" in things:
            again = [t for t in new if "Nimbus" in t["outcome"]]
            check("R13", lang, things["T4"].get("stage") == "done" and not again,
                  f"T4 is {things['T4'].get('stage')}; new tasks for it: {[t['outcome'] for t in again]}")
        for g, ts in groups.items():  # one parent for all of them, not the top
            parents = {t.get("parent", "") for t in ts}
            check("R11", lang, len(ts) >= 2 and len(parents) == 1 and "" not in parents,
                  f"{g}: " + "; ".join(f"{t['outcome']} under {t.get('parent') or 'the top'}" for t in ts) +
                  "".join(f" ({p} = {things[p]['outcome']})" for p in parents if p in things))
        c = r.get("correction")
        if c:
            t = things.get(c["task"], {})
            check("R12", lang, t.get("stage") == c["want"], f"{c['task']} {t.get('outcome')!r} is {t.get('stage')} after {c['text']!r}")
        for what, text, keep in lines:
            check("R3", lang, in_lang(text, lang, keep), f"{what}: {text!r}")
        check("R2", lang, stops_ok >= 0.9 * stops_n, f"{ratio(stops_ok, stops_n)} stages right")
        check("R5", lang, not f.get("queue"), f"{len(f.get('queue') or [])} left in the queue")
        tools = list(commands(out / lang))
        if report["agent"] in CHECKED:
            bad = []
            for name, inp in tools:
                if name == "Bash":
                    bad += bad_segments(inp.get("command", ""))
                elif name not in READ_TOOLS:
                    bad.append(f"{name} {json.dumps(inp, ensure_ascii=False)[:120]}")
            check("R6", lang, tools and not bad, f"{len(tools)} tool calls" + (f"; not allowed: {bad[:5]}" if bad else "") + ("" if tools else "; no session record found"))
        secs = out / lang / "seconds"
        report["languages"][lang] = {"stops": ratio(stops_ok, stops_n), "sessions": ratio(sessions_ok, sessions_n), "messages": ratio(messages_ok, 4), "new_tasks": len(new),
                                     "seconds": int(secs.read_text()) if secs.exists() else None}

    # Per-language thresholds for R7 and R8 (README.md): the rest must hold for every item.
    THRESHOLD = {"R7": 2 / 3, "R8": 3 / 4}
    for rid, rows in sorted(rule.items()):
        if rid in THRESHOLD:
            langs = {}
            for x in rows:
                langs.setdefault(x["lang"], []).append(x["ok"])
            ok = all(sum(v) >= THRESHOLD[rid] * len(v) for v in langs.values())
        else:
            ok = all(x["ok"] for x in rows)
        report["rules"][rid] = {"pass": ok, "failed": [x for x in rows if not x["ok"]], "checked": len(rows)}
        if not ok:
            fail.append(rid)

    at_run = (out / "run-inputs.txt").read_text().strip() if (out / "run-inputs.txt").exists() else None
    report["inputs"] = inputs(at_run)
    report["pass"] = not fail
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")

    for lang, v in report["languages"].items():
        print(f"{lang:8s} stops {v['stops']}  sessions {v['sessions']}  messages {v['messages']}  new tasks {v['new_tasks']}  {v['seconds']}s")
    for rid, v in report["rules"].items():
        print(f"{rid} {'pass' if v['pass'] else 'FAIL'} ({v['checked']} checked)")
        for x in v["failed"][:8]:
            print(f"    {x['lang']}: {x['detail']}")
    print("PASS" if not fail else f"FAIL: {', '.join(fail)}", f"\nreport: {out / 'report.json'}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    if sys.argv[1:] == ["--inputs"]:
        print(inputs())
    elif sys.argv[1:] == ["--run-inputs"]:
        print(run_inputs())
    else:
        main()
