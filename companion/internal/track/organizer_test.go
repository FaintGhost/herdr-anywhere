package track

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// A pane "api" that was handed T2 (open), in the task file.
func organizerFile() (File, Live) {
	f := taskFile()
	t2, _ := f.Get("T2")
	t2.Panes = []PaneRef{{Side: "hc", Addr: "t2", Name: "api", TurnAt: ip(3), At: ms(t0)}}
	p2, _ := f.Get("P2")
	p2.Notes = []Note{{At: ms(t0), Text: "「签名构建」不属于这里"}}
	return f, hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "idle", Turn: 4, Cwd: "/p/acme-api", Agent: "claude-code"},
		HCTerm{Address: "t9", Name: "fresh", State: "live", Status: "idle", Turn: 0, Agent: "claude-code"})
}

var api = PaneRef{Side: "hc", Addr: "api"}

func TestABareReplyGoesToTheTaskOfThePanesLastTurn(t *testing.T) {
	f, live := organizerFile()
	for _, s := range []string{"继续", "好", "可以。", "OK", "1"} {
		if d := Decide(f, live, Message{Pane: api, Text: s}); !d.Sure || d.Task != "T2" || d.By != "rule" {
			t.Fatalf("%q: %+v", s, d)
		}
	}
	// A pane with no task, or a message with content: for the filing pane.
	if d := Decide(f, live, Message{Pane: PaneRef{Side: "hc", Addr: "t9"}, Text: "继续"}); d.Sure || d.Why != "queue" {
		t.Fatalf("fresh pane: %+v", d)
	}
	if d := Decide(f, live, Message{Pane: api, Text: "好，顺便把登录页也改成深色"}); d.Sure {
		t.Fatalf("content: %+v", d)
	}
}

func TestWhatTheRulesCantTellWaitsInTheQueueWithItsHandOffPoint(t *testing.T) {
	f, live := organizerFile()
	before := len(f.Things)
	id, err := f.Take(Decide(f, live, Message{Pane: api, Text: "加一个收藏功能"}), Message{Pane: api, Text: "加一个收藏功能", PrevEnded: "done", AgentSaid: "tag 打好了"}, live, t0.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Things) != before || len(f.Queue) != 1 || f.Queue[0].ID != id {
		t.Fatalf("queue = %+v", f.Queue)
	}
	q := f.Queue[0]
	if q.Pane.Addr != "t2" || *q.Pane.TurnAt != 4 || q.Pane.At != ms(t0.Add(time.Minute)) || q.AgentSaid != "tag 打好了" {
		t.Fatalf("queued = %+v", q)
	}
	// The filing pane reads the queue with every open task and the latest notes.
	v := f.View(live)
	if len(v.Items) != 1 {
		t.Fatalf("view items = %+v", v.Items)
	}
	var p2 TaskLine
	for _, l := range v.Tasks {
		if l.ID == "P2" {
			p2 = l
		}
		if l.ID == "T5" {
			t.Fatal("a finished task is in the view")
		}
	}
	if len(p2.Notes) != 1 {
		t.Fatalf("P2 = %+v", p2)
	}
}

func TestTheFilingPanePlacesAMessageOnOneOrMoreTasks(t *testing.T) {
	f, live := organizerFile()
	m := Message{Pane: api, Text: "FAQ 加搜索框，CHANGELOG 也写上这条"}
	qid, _ := f.Take(Decision{Why: "queue"}, m, live, t0.Add(time.Minute))
	tid, err := f.Place(qid, Decision{Task: "T4", Also: []string{"T3"}, Sure: true}, live, t0.Add(2*time.Minute))
	if err != nil || tid != "T4" || len(f.Queue) != 0 {
		t.Fatalf("place: %q %v %+v", tid, err, f.Queue)
	}
	for _, id := range []string{"T4", "T3"} {
		x, _ := f.Get(id)
		if len(x.Panes) != 1 || x.Panes[0].At != ms(t0.Add(time.Minute)) || x.Log[len(x.Log)-1].Text != m.Text {
			t.Fatalf("%s = %+v", id, x)
		}
	}
	// A new task under P1b, tagged auto.
	qid, _ = f.Take(Decision{Why: "queue"}, Message{Pane: api, Text: "发版前把 README 的端口改成 8080"}, live, t0.Add(3*time.Minute))
	tid, err = f.Place(qid, Decision{Task: "new", Under: "P1b", Title: "README 端口改成 8080", Sure: true}, live, t0.Add(4*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	nt, _ := f.Get(tid)
	if nt.Parent != "P1b" || !nt.Auto || nt.Outcome != "README 端口改成 8080" || len(nt.Panes) != 1 {
		t.Fatalf("new = %+v", nt)
	}
	// Tasks that don't exist are refused and the item stays queued.
	qid, _ = f.Take(Decision{Why: "queue"}, Message{Pane: api, Text: "x"}, live, t0.Add(5*time.Minute))
	if _, err := f.Place(qid, Decision{Task: "T99", Sure: true}, live, t0); err == nil || len(f.Queue) != 1 {
		t.Fatalf("unknown task: %v %+v", err, f.Queue)
	}
	if _, err := f.Place(qid, Decision{Task: "new", Under: "P9", Sure: true}, live, t0); err == nil {
		t.Fatal("unknown parent accepted")
	}
}

// Version one is view only: the filing
// pane's best guess is filed straight away, nothing waits for the user to tick.
func TestWhatTheFilingPaneIsNotSureOfIsFiledWhereItGuessed(t *testing.T) {
	f, live := organizerFile()
	qid, _ := f.Take(Decision{Why: "queue"}, Message{Pane: api, Text: "顺便给公司账号写一条招聘帖"}, live, t0.Add(time.Minute))
	tid, err := f.Place(qid, Decision{Task: "new", Title: "写招聘帖", Sure: false, Why: "像是一件新的事"}, live, t0.Add(2*time.Minute))
	if err != nil || len(f.Queue) != 0 {
		t.Fatalf("place: %q %v queue %+v", tid, err, f.Queue)
	}
	nt, _ := f.Get(tid)
	if nt.Outcome != "写招聘帖" || nt.Parent != "" || !nt.Auto || len(nt.Panes) != 1 {
		t.Fatalf("task = %+v", nt)
	}
	// Onto a task that exists.
	qid, _ = f.Take(Decision{Why: "queue"}, Message{Pane: api, Text: "FAQ 再加一条"}, live, t0.Add(4*time.Minute))
	if tid, err := f.Place(qid, Decision{Task: "T4", Sure: false}, live, t0.Add(5*time.Minute)); err != nil || tid != "T4" {
		t.Fatalf("onto T4: %q %v", tid, err)
	}
}

func TestTheFilingPaneSeesOnlyEachTopTasksLatestScopeNotes(t *testing.T) {
	f, live := organizerFile()
	p2, _ := f.Get("P2")
	p2.Notes = nil
	for i := 1; i <= 8; i++ {
		p2.Notes = append(p2.Notes, Note{At: int64(i), Text: fmt.Sprintf("note-%d", i)})
	}
	var notes []string
	for _, l := range f.View(live).Tasks {
		if l.ID == "P2" {
			notes = l.Notes
		}
	}
	if got := strings.Join(notes, " "); got != "note-4 note-5 note-6 note-7 note-8" {
		t.Fatalf("notes = %q", got)
	}
}

// A scan queues each live pane's current session once; the filing pane turns
// a session into tasks, filed straight away and linked to the pane.
func TestAScannedSessionBecomesTasks(t *testing.T) {
	f, live := organizerFile()
	items := []SessionItem{{Pane: PaneRef{Side: "hc", Addr: "api"}, Session: "s-1", Text: "你说过：修 total_items；README 端口改成 8080。agent 最后说：端口改好了"}}
	ids, err := f.QueueSessions(items, live, t0)
	if err != nil || len(ids) != 1 || len(f.Queue) != 1 || f.Queue[0].Kind != "session" || *f.Queue[0].Pane.TurnAt != 4 {
		t.Fatalf("queued %v %v %+v", ids, err, f.Queue)
	}
	// Scanning again doesn't queue the same session twice.
	if ids, _ := f.QueueSessions(items, live, t0.Add(time.Minute)); len(ids) != 0 || len(f.Queue) != 1 {
		t.Fatalf("second scan queued %v", ids)
	}
	// --more keeps the session queued for the next task in it.
	t1, err := f.Place(ids[0], Decision{Task: "new", Title: "修 total_items", Stage: Review, Sure: true, More: true}, live, t0)
	if err != nil || len(f.Queue) != 1 {
		t.Fatalf("first: %v %+v", err, f.Queue)
	}
	nt, _ := f.Get(t1)
	if nt.Outcome != "修 total_items" || nt.Stage != Review || len(nt.Panes) != 1 || nt.Panes[0].Addr != "t2" || !nt.Auto {
		t.Fatalf("first = %+v", nt)
	}
	t2, err := f.Place(ids[0], Decision{Task: "new", Under: "P1", Title: "README 端口改成 8080"}, live, t0)
	if err != nil || len(f.Queue) != 0 {
		t.Fatalf("second: %v queue %+v", err, f.Queue)
	}
	if nt, _ := f.Get(t2); nt.Parent != "P1" || nt.Stage != Doing {
		t.Fatalf("second = %+v", nt)
	}
	// A session with nothing worth a task: "none" just takes it off the queue.
	ids, _ = f.QueueSessions([]SessionItem{{Pane: PaneRef{Side: "hc", Addr: "t9"}, Session: "s-2", Text: "你说过：hi"}}, live, t0)
	if _, err := f.Place(ids[0], Decision{Task: "none"}, live, t0); err != nil || len(f.Queue) != 0 {
		t.Fatalf("none: %v %+v", err, f.Queue)
	}
}

// A scanned session's tasks are the pane's in the order the filing pane listed
// them, oldest first: what the pane says now, and what it said before the next
// message, is about the last of them, not about whichever comes first in the file.
func TestThePanesWordsGoToTheLastTaskOfItsScannedSession(t *testing.T) {
	f, _ := organizerFile()
	live := hcLive(HCTerm{Address: "t9", Name: "fresh", State: "live", Status: "done", Turn: 2, Agent: "claude-code",
		StatusMs: ms(t0.Add(30 * time.Second)), Msg: "The posts draft is half written."})
	ids, _ := f.QueueSessions([]SessionItem{{Pane: PaneRef{Side: "hc", Addr: "t9"}, Session: "s-9", Text: "- User: release 2.1\n- User: write the posts"}}, live, t0)
	old, _ := f.Place(ids[0], Decision{Task: "new", Title: "Release 2.1", Stage: Done, More: true}, live, t0)
	last, _ := f.Place(ids[0], Decision{Task: "new", Title: "Write the posts"}, live, t0)
	said := map[string]string{}
	for _, r := range Status(f, live, t0.Add(time.Minute), time.Hour) {
		said[r.ID] = r.Said
	}
	if said[old] != "" || said[last] != "The posts draft is half written." {
		t.Fatalf("the pane's report shows under %q (old) and %q (last)", said[old], said[last])
	}
	// The next message is about something new: what the agent said before it
	// goes on the last task too.
	m := Message{Pane: PaneRef{Side: "hc", Addr: "t9"}, Text: "now fix the footer", PrevEnded: "done", AgentSaid: "The posts draft is half written."}
	if _, err := f.Take(Decision{Task: "new", Title: "Fix the footer", Sure: true, By: "organizer"}, m, live, t0.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	o, _ := f.Get(old)
	l, _ := f.Get(last)
	if o.Panes[0].Said != "" || l.Panes[0].Said != "The posts draft is half written." {
		t.Fatalf("said: old %q, last %q", o.Panes[0].Said, l.Panes[0].Said)
	}
}

// The task page shows what the agent said in full, lists and all: a report of
// a thousand characters is not cut; only a very long one is.
func TestWhatThePaneSaidIsKeptWholeForTheTaskPage(t *testing.T) {
	f, _ := organizerFile()
	long := strings.Repeat("步骤做完了。", 170) // 1020 characters
	live := hcLive(HCTerm{Address: "t9", Name: "fresh", State: "live", Status: "done", Turn: 2, Agent: "claude-code", StatusMs: ms(t0.Add(30 * time.Second)), Msg: long})
	ids, _ := f.QueueSessions([]SessionItem{{Pane: PaneRef{Side: "hc", Addr: "t9"}, Session: "s-9", Text: "- User: x"}}, live, t0)
	id, _ := f.Place(ids[0], Decision{Task: "new", Title: "X"}, live, t0)
	for _, r := range Status(f, live, t0.Add(time.Minute), time.Hour) {
		if r.ID == id && r.Said != long {
			t.Fatalf("said cut to %d characters", len([]rune(r.Said)))
		}
	}
}

// Scanning again, the filing pane may put a task already in the tree under the
// goal it belongs to. That is its filing, not the user's correction: no scope note.
func TestAScanCanPutAnExistingTaskUnderAGoal(t *testing.T) {
	f, live := organizerFile()
	ids, _ := f.QueueSessions([]SessionItem{{Pane: PaneRef{Side: "hc", Addr: "t9"}, Session: "s-9", Text: "- User: x"}}, live, t0)
	f.Add(Thing{ID: "T40", Outcome: "Release 2.1", Stage: Doing})
	f.Add(Thing{ID: "T41", Outcome: "Write the posts", Stage: Doing})
	if _, err := f.Place(ids[0], Decision{Task: "T41", Under: "T40", Stage: Done}, live, t0); err != nil {
		t.Fatal(err)
	}
	t41, _ := f.Get("T41")
	if t41.Parent != "T40" || t41.Stage != Done {
		t.Fatalf("T41 = %+v", t41)
	}
	for _, th := range f.Things {
		if len(th.Notes) > 0 && th.ID != "P2" {
			t.Fatalf("a scope note on %s: %+v", th.ID, th.Notes)
		}
	}
}
