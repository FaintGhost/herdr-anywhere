package watch

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Lines in the shape Claude Code 2.1.319 writes (fields checked).
func human(text, source string) string {
	b, _ := json.Marshal(map[string]any{"type": "user", "origin": map[string]string{"kind": "human"}, "promptSource": source,
		"message": map[string]any{"role": "user", "content": text}})
	return string(b) + "\n"
}

func line(v map[string]any) string { b, _ := json.Marshal(v); return string(b) + "\n" }

func texts(ms []Msg) []string {
	var out []string
	for _, m := range ms {
		out = append(out, m.Text)
	}
	return out
}

// An assistant line: text, and how the API call ended (end_turn closes the turn).
func reply(text, stop string) string {
	return line(map[string]any{"type": "assistant", "message": map[string]any{"role": "assistant",
		"content": []any{map[string]any{"type": "text", "text": text}}, "stop_reason": stop}})
}

// What Claude Code 2.1.319 writes when the user presses Esc mid-turn.
var interrupted = line(map[string]any{"type": "user", "message": map[string]any{"role": "user",
	"content": []any{map[string]any{"type": "text", "text": "[Request interrupted by user for tool use]"}}}})

func TestEachMessageCarriesHowThePaneLastTurnEndedAndWhatTheAgentSaid(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.jsonl")
	first := human("修 total_items", "typed") + reply("先看一下代码", "tool_use") + reply("total_items 改好了，测试都过了", "end_turn")
	os.WriteFile(p, []byte(first), 0o600)
	got, off, tail, err := ReadNew(p, 0, Tail{})
	if err != nil || len(got) != 1 || got[0].PrevEnded != "" || got[0].AgentSaid != "" {
		t.Fatalf("first read: %+v %v", got, err)
	}
	if tail.Ended != "done" || tail.Said != "total_items 改好了，测试都过了" {
		t.Fatalf("tail = %+v", tail)
	}
	// The next read starts from the tail it was given.
	second := human("README 端口改成 8080", "typed") + reply("改一下", "tool_use") + interrupted + human("先别改了，换成 9090", "typed")
	appendTo(p, second)
	got, _, tail, _ = ReadNew(p, off, tail)
	want := []Msg{
		{Text: "README 端口改成 8080", PrevEnded: "done", AgentSaid: "total_items 改好了，测试都过了"},
		{Text: "先别改了，换成 9090", PrevEnded: "interrupted"},
	}
	if !reflect.DeepEqual(got, want) || tail != (Tail{}) { // the turn after the last message has not ended yet
		t.Fatalf("second read: %+v, tail %+v", got, tail)
	}
}

func TestAWholeSessionReadsAsWhatThePersonTypedAndTheLastReply(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.jsonl")
	os.WriteFile(p, []byte(human("修 total_items", "typed")+noise[1]+reply("改好了", "end_turn")+human("README 端口改成 8080", "typed")+reply("端口改好了", "end_turn")), 0o600)
	typed, last, err := ReadSession(p)
	if err != nil || !reflect.DeepEqual(typed, []string{"修 total_items", "README 端口改成 8080"}) || last != "端口改好了" {
		t.Fatalf("typed %q last %q err %v", typed, last, err)
	}
}

var noise = []string{
	human(`<hc from="t3">fix the footer</hc>`, "typed"), // handed over through hc send: the sender records it
	line(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": []any{map[string]any{"type": "tool_result", "content": "ok"}}}}),
	line(map[string]any{"type": "user", "isMeta": true, "message": map[string]any{"role": "user", "content": "Caveat: …"}}),
	line(map[string]any{"type": "user", "isCompactSummary": true, "message": map[string]any{"role": "user", "content": "This session is being continued…"}}),
	line(map[string]any{"type": "user", "origin": map[string]any{"kind": "task-notification"}, "promptSource": "system", "message": map[string]any{"role": "user", "content": "<task-notification>…"}}),
	line(map[string]any{"type": "assistant", "message": map[string]any{"role": "assistant", "content": "done"}}),
}

func TestOnlyWhatAPersonTypedIsRead(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.jsonl")
	withImage := line(map[string]any{"type": "user", "origin": map[string]string{"kind": "human"}, "promptSource": "typed",
		"message": map[string]any{"role": "user", "content": []any{map[string]any{"type": "text", "text": "看这张图"}, map[string]any{"type": "image"}}}})
	body := human("修一下登录", "typed") + noise[0] + noise[1] + human("顺便跑测试", "queued") + noise[2] + noise[3] + noise[4] + noise[5] + withImage
	os.WriteFile(p, []byte(body), 0o600)
	got, off, _, err := ReadNew(p, 0, Tail{})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"修一下登录", "顺便跑测试", "看这张图"}; !reflect.DeepEqual(texts(got), want) {
		t.Fatalf("got %q", got)
	}
	if off != int64(len(body)) {
		t.Fatalf("offset %d, want %d", off, len(body))
	}
}

func TestAHalfWrittenLineWaitsForTheNextRead(t *testing.T) {
	p := filepath.Join(t.TempDir(), "s.jsonl")
	full := human("第一句", "typed")
	half := human("第二句", "typed")
	os.WriteFile(p, []byte(full+half[:10]), 0o600)
	got, off, _, _ := ReadNew(p, 0, Tail{})
	if len(got) != 1 || off != int64(len(full)) {
		t.Fatalf("got %q at %d", got, off)
	}
	os.WriteFile(p, []byte(full+half), 0o600)
	got, _, _, _ = ReadNew(p, off, Tail{})
	if len(got) != 1 || got[0].Text != "第二句" {
		t.Fatalf("got %q", got)
	}
}

type world struct {
	home  string
	terms []Term
	filed []string
	w     *Watcher
}

func newWorld(t *testing.T) *world {
	wd := &world{home: t.TempDir()}
	wd.w = &Watcher{Home: wd.home, State: filepath.Join(t.TempDir(), "watch.json"),
		List: func() ([]Term, error) { return wd.terms, nil },
		File: func(addr string, m Msg) error { wd.filed = append(wd.filed, addr+" "+m.Text); return nil }}
	return wd
}

func (wd *world) session(t *testing.T, pid int, sid, body string) string {
	t.Helper()
	os.MkdirAll(filepath.Join(wd.home, ".claude", "sessions"), 0o700)
	b, _ := json.Marshal(map[string]any{"pid": pid, "sessionId": sid, "cwd": "/p/acme-api"})
	os.WriteFile(filepath.Join(wd.home, ".claude", "sessions", jsonName(pid)), b, 0o600)
	d := filepath.Join(wd.home, ".claude", "projects", "-p-acme-api")
	os.MkdirAll(d, 0o700)
	p := filepath.Join(d, sid+".jsonl")
	if body != "" {
		os.WriteFile(p, []byte(body), 0o600)
	}
	return p
}

func appendTo(p, s string) {
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	f.WriteString(s)
	f.Close()
}

func TestHistoryIsSkippedAndNewMessagesAreFiledOnce(t *testing.T) {
	wd := newWorld(t)
	p := wd.session(t, 501, "s1", human("很早以前的话", "typed"))
	wd.terms = []Term{{Address: "t2", Agent: "claude-code", State: "live", Turn: 7, PID: 501},
		{Address: "t5", Agent: "zsh", State: "live", Turn: 1, PID: 600}}
	if err := wd.w.Tick(); err != nil || len(wd.filed) != 0 {
		t.Fatalf("first tick filed %q (%v)", wd.filed, err)
	}
	appendTo(p, human("加一个 cancel_order", "typed")+noise[0])
	wd.terms[0].Turn = 8
	wd.w.Tick()
	wd.w.Tick()
	if want := []string{"t2 加一个 cancel_order"}; !reflect.DeepEqual(wd.filed, want) {
		t.Fatalf("filed %q", wd.filed)
	}
}

func TestStateSurvivesARestart(t *testing.T) {
	wd := newWorld(t)
	p := wd.session(t, 501, "s1", human("旧的", "typed"))
	wd.terms = []Term{{Address: "t2", Agent: "claude-code", State: "live", Turn: 1, PID: 501}}
	wd.w.Tick()
	appendTo(p, human("新的", "typed"))
	again := &Watcher{Home: wd.home, State: wd.w.State, List: wd.w.List, File: wd.w.File}
	again.Tick()
	if want := []string{"t2 新的"}; !reflect.DeepEqual(wd.filed, want) {
		t.Fatalf("filed %q", wd.filed)
	}
}

func TestANewSessionInTheSamePaneIsReadFromItsStart(t *testing.T) {
	wd := newWorld(t)
	wd.session(t, 501, "s1", human("旧会话", "typed"))
	wd.terms = []Term{{Address: "t2", Agent: "claude-code", State: "live", Turn: 3, PID: 501}}
	wd.w.Tick()
	// /clear: same process, new session id, a new file whose first line is the new message.
	wd.session(t, 501, "s2", human("清空后第一句", "typed"))
	wd.terms[0].Turn = 4
	wd.w.Tick()
	if want := []string{"t2 清空后第一句"}; !reflect.DeepEqual(wd.filed, want) {
		t.Fatalf("filed %q", wd.filed)
	}
}

func TestAClosedTerminalKeepsItsSessionLink(t *testing.T) {
	wd := newWorld(t)
	p := wd.session(t, 501, "s1", "")
	appendTo(p, human("x", "typed"))
	wd.terms = []Term{{Address: "t2", Agent: "claude-code", State: "live", Turn: 1, PID: 501}}
	wd.w.Tick()
	wd.terms = nil
	wd.w.Tick()
	links, err := LoadLinks(wd.w.State)
	if err != nil {
		t.Fatal(err)
	}
	if l, ok := links["t2"]; !ok || l.SessionID != "s1" || l.Path != p {
		t.Fatalf("links = %+v", links)
	}
}

func TestATerminalWithNoSessionFileIsSkippedNotFatal(t *testing.T) {
	wd := newWorld(t)
	wd.terms = []Term{{Address: "t2", Agent: "claude-code", State: "live", Turn: 1, PID: 999}}
	if err := wd.w.Tick(); err != nil || len(wd.filed) != 0 {
		t.Fatalf("%v %q", err, wd.filed)
	}
}
