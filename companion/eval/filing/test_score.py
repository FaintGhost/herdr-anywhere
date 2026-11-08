#!/usr/bin/env python3 -I
"""The scorer itself, without a model: a made-up run that does everything right passes, and each way of getting it
wrong fails the rule it breaks. Run: python3 -I companion/eval/filing/test_score.py"""
import copy, json, pathlib, subprocess, sys, tempfile

here = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(here))
cases = json.load(open(here / "cases.json"))

# What a right answer to the question in another language (s8) says, in each phone language.
PRICE = {"en": "Is the price in entry 3 really $29?", "zh-Hans": "第 3 条的价格是 $29 吗？", "zh-Hant": "第 3 條的價格是 $29 嗎？",
         "es": "¿El precio de la entrada 3 es de verdad $29?", "ja": "3 番目の価格は本当に $29 ですか？", "ko": "3번 항목 가격이 정말 $29인가요?",
         "ru": "Цена в пункте 3 точно $29?"}
FAQ = {"en": "Add how to reset a password to the FAQ", "zh-Hans": "FAQ 加一条怎么重置密码", "zh-Hant": "FAQ 加一條怎麼重設密碼",
       "es": "Añadir a las FAQ cómo restablecer la contraseña", "ja": "FAQ にパスワードの再設定方法を足す", "ko": "FAQ에 비밀번호 재설정 방법 추가",
       "ru": "Добавить в FAQ, как сбросить пароль"}

def right(run):
    """The progress file a perfect filing agent leaves for one language."""
    things = {t["id"]: {"id": t["id"], "outcome": t["title"], "stage": "doing", **({"parent": t["under"]} if t.get("under") else {}),
                        "panes": [{"side": "hc", "addr": "a" + t["id"][1:], "at": 1}]} for t in run["seed"]}
    n_new = 0
    for n, it in enumerate(run["items"], 1):
        at = 1000 + n
        if it["kind"] == "stop":
            t = {"id": "S-" + it["id"], "outcome": it["title"], "stage": it["want"], "parent": "P1", "panes": [{"side": "hc", "addr": it["id"], "at": 1}]}
            if it["want"] == "waiting":
                t["waiting"] = PRICE[run["lang"]] if it["other"] else it["text"]
            things[t["id"]] = t
        elif it["kind"] == "session":
            titles = {1: [it["said"][0]], 2: it["said"][:2], 3: []}[int(it["id"][1:])]
            for i, title in enumerate(titles):
                n_new += 1
                done = it["want"][i].get("done", False)
                things[f"T{50 + n_new}"] = {"id": f"T{50 + n_new}", "outcome": title, "stage": "done" if done else "doing", "parent": "P1", "panes": [{"side": "hc", "addr": it["id"]}]}
        else:
            ref = {"side": "hc", "addr": it["pane"], "at": at}
            if it["want"] == "new":
                n_new += 1
                things[f"T{50 + n_new}"] = {"id": f"T{50 + n_new}", "outcome": it["text"], "stage": "doing", "parent": "P1", "panes": [ref]}
            else:
                things[it["want"]]["panes"].append(ref)
    return {"version": 2, "things": list(things.values()), "queue": []}

def write(files, agent="claude --model claude-haiku-5-5", tools=None):
    d = pathlib.Path(tempfile.mkdtemp())
    (d / "agent.txt").write_text(agent)
    for lang, f in files.items():
        (d / lang).mkdir()
        (d / lang / "track.json").write_text(json.dumps(f, ensure_ascii=False))
        calls = tools if tools is not None else [("Bash", {"command": "H=herdr-anywhere\n$H track queue --json\n$H track place Q1 --stage done && $H track place Q2 --stage waiting --waiting \"x\""})]
        lines = [json.dumps({"message": {"content": [{"type": "tool_use", "name": n, "input": i}]}}) for n, i in calls]
        (d / lang / "s.jsonl").write_text("\n".join(lines))
    return d

def score(d):
    r = subprocess.run([sys.executable, "-I", str(here / "score.py"), str(here / "cases.json"), str(d)], capture_output=True, text=True)
    return r.returncode, json.loads((d / "report.json").read_text())

def failed(rep):
    return sorted(k for k, v in rep["rules"].items() if not v["pass"])

good = {r["lang"]: right(r) for r in cases["runs"]}
code, rep = score(write(good))
assert code == 0 and rep["pass"], json.dumps(rep["rules"], ensure_ascii=False, indent=1)
print("a run that does everything right: pass")

def broken(lang, change):
    files = copy.deepcopy(good)
    change(files[lang])
    return failed(score(write(files))[1])

def thing(f, id):
    return next(t for t in f["things"] if t["id"] == id)

def done_instead(f):  # a question filed as done
    t = thing(f, "S-s3"); t["stage"] = "done"; t.pop("waiting")
assert "R1" in broken("ko", done_instead), "R1"
def wrong_lang(f):  # the question left in English on a Japanese phone
    thing(f, "S-s8")["waiting"] = "Is the price in entry 3 really $29?"
assert broken("ja", wrong_lang) == ["R3"], broken("ja", wrong_lang)
def traditional(f):  # Traditional Chinese on a Simplified Chinese phone
    thing(f, "S-s5")["waiting"] = "兩種做法：A 改前端，B 改後端。你選哪個？"
assert broken("zh-Hans", traditional) == ["R3"]
def dropped_term(f):
    thing(f, "S-s2")["waiting"] = "要不要顺便把说明里的端口也改了？"
assert "R4" in broken("zh-Hans", dropped_term)
def left(f):
    f["queue"] = [{"id": "Q9"}]
assert broken("ru", left) == ["R5"]
def chat_task(f):  # a task made from small talk
    f["things"].append({"id": "T99", "outcome": "Saludar", "stage": "done", "panes": [{"side": "hc", "addr": "v3"}]})
assert "R9" in broken("es", chat_task)
def two_wrong(f):  # two of four messages on the wrong task
    for m in ("T1", "T2"):
        t = thing(f, m); t["panes"] = [p for p in t["panes"] if p.get("at", 0) < 1000]
        thing(f, "T3")["panes"].append({"side": "hc", "addr": "a" + m[1:], "at": 1013 + int(m[1:])})
assert broken("en", two_wrong) == ["R8"], broken("en", two_wrong)
code, rep = score(write(good, tools=[("Bash", {"command": "herdr-anywhere track queue --json | python3 -c 'print(1)'"}), ("Edit", {"file_path": "x"})]))
assert failed(rep) == ["R6"], failed(rep)
print("a question filed as done, the wrong language or script, a dropped name, items left, a task from small talk,")
print("messages on the wrong task, and other commands each fail their rule")

from score import in_lang
yes = {"en": "Change the README port to 8080", "zh-Hans": "改 README 的端口说明", "zh-Hant": "改 README 的埠說明", "es": "Cambiar el puerto del README",
       "ja": "README のポートを変える", "ko": "README 포트 바꾸기", "ru": "Поменять порт в README"}
for lang, text in yes.items():
    assert in_lang(text, lang), (lang, text)
    for other, t2 in yes.items():
        if other != lang and not {lang, other} <= {"zh-Hans", "zh-Hant"} - set():
            assert not in_lang(t2, lang) or (lang, other) in {("es", "en")}, (lang, other, t2)
assert not in_lang("改 README 的埠說明", "zh-Hans") and not in_lang("改 README 的端口说明", "zh-Hant")
print("the language check tells the seven languages apart")

# The report may be published: it names the agent's program and the run, never the command, which would show this
# computer's folders and how its models are reached.
d = write(good, agent="env HOME=/Users/someone /opt/tools/bin/pi --model some-router/model-x")
(d / "label.txt").write_text("Pi · Model X")
text = (score(d), (d / "report.json").read_text())[1]
rep = json.loads(text)
assert rep["agent"] == "pi" and rep["label"] == "Pi · Model X", (rep["agent"], rep["label"])
assert "/Users" not in text and "some-router" not in text and "/opt" not in text, text[:300]
print("the report names the agent and the run only")

# R6 reads shell the way the shell does: quoted text is not a command, read-only helpers are fine, anything else
# (another program, another herdr-anywhere command, writing a file) is not.
from score import bad_segments
for c in ['H=$(command -v herdr-anywhere)\n$H track place Q5 --stage waiting --waiting "A (frontend) or B (backend); it leans to B."',
          'command -v $H >/dev/null 2>&1 || H=herdr-anywhere\n$H track queue --json',
          'run(){ echo "\\$ $*"; herdr-anywhere track place "$@"; }\nrun Q1 --stage done',
          "herdr-anywhere track place Q2 --waiting 'it'\\''s $29'", "herdr-anywhere track --help",
          "B=herdr-anywhere; \\\n$B track place Q1 --stage done && \\\n$B track place Q2 --stage doing",
          "cat CLAUDE.md", "sed -n '1,80p' AGENTS.md",
          "cd /tmp/x && (herdr-anywhere track place --batch - <<'END'\n{}\nEND\n) 2>&1 || herdr-anywhere track queue --json",
          "herdr-anywhere track place --batch - <<'END'\n{\"places\": [{\"id\": \"Q1\", \"waiting\": \"rm -rf $x; ok?\"}]}\nEND"]:
    assert not bad_segments(c), (c, bad_segments(c))
for c in ["herdr-anywhere track queue --json | python3 -c 'print(1)'", "echo hi > notes.txt", "echo hi &> notes.txt",
          "herdr-anywhere track add T9 x", "hc send t1 hi", "rm -rf x", "find / -name track.json", "env", "cat ~/.ssh/config",
          "herdr-anywhere track report --json", "herdr-anywhere track place --batch - <<'END'\n{}\nEND\nrm -rf x"]:
    assert bad_segments(c), c
print("the command check tells allowed commands from the rest")

# Pi's session record has its own shape; R6 reads it too.
d = write(good, agent="pi --model x", tools=[])
for lang in good:
    (d / lang / "s.jsonl").write_text(json.dumps({"type": "message", "message": {"role": "assistant", "content": [
        {"type": "toolCall", "id": "1", "name": "bash", "arguments": {"command": "herdr-anywhere track queue --json > /tmp/q.json"}}]}}))
assert failed(score(d)[1]) == ["R6"]
print("Pi's commands are checked as well")

# Codex's record: the commands it ran, and anything else it did (a file change) counts against R6.
def codex(items):
    d = write(good, agent="codex", tools=[])
    for lang in good:
        (d / lang / "s.jsonl").write_text("\n".join(json.dumps({"type": "event_msg", "payload": {"type": "item_completed", "item": it}}) for it in items))
    return failed(score(d)[1])
ran = {"type": "CommandExecution", "command": ["/bin/zsh", "-lc", "herdr-anywhere track place Q1 --stage done"], "status": "completed"}
assert codex([{"type": "AgentMessage"}, ran]) == [], codex([ran])
assert codex([ran, {"type": "CommandExecution", "command": ["/bin/zsh", "-lc", "cat ~/.ssh/config"]}]) == ["R6"]
assert codex([ran, {"type": "FileChange", "changes": []}]) == ["R6"]
print("Codex's commands are checked as well")

# The filing rules teach with examples of their own: no line of a case appears in them, or the evaluation would
# test what the rules spell out.
import re as _re
rules = (here.parent.parent / "cmd/herdr-anywhere/organizer.go").read_text()
rules = rules[rules.index("const organizerRules"):]
rules = rules[:rules.index("\n`\n")]
for r in cases["runs"]:
    for it in r["items"]:
        for text in [it.get("text"), it.get("title"), it.get("last"), it.get("agent_said"), *it.get("said", [])]:
            assert not (isinstance(text, str) and len(text) > 12 and text in rules), (r["lang"], text)
print("the filing rules quote no case")
