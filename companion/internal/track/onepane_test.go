package track

import (
	"testing"
	"time"
)

// Most users talk to one pane about many things in a row.
// A message about another task records how the pane's previous turn ended and
// what the agent said then, on the task that turn was for. A pane stopping
// doesn't finish a task: that is the user's call (or, later, the judge's).

func onePane(turn int, status string) Live {
	return hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: status, Turn: turn, Agent: "claude-code"})
}

func filed(t *testing.T, f *File, task, text string, live Live, at time.Time, prev string, said ...string) string {
	t.Helper()
	m := Message{Pane: PaneRef{Side: "hc", Addr: "t2"}, Text: text, PrevEnded: prev}
	if len(said) > 0 {
		m.AgentSaid = said[0]
	}
	id, err := f.Take(Decision{Task: task, Title: text, Sure: true, By: "organizer"}, m, live, at)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func paneOf(t *testing.T, f File, id string) PaneRef {
	t.Helper()
	x, err := f.Get(id)
	if err != nil || len(x.Panes) != 1 {
		t.Fatalf("%s: %+v %v", id, x, err)
	}
	return x.Panes[0]
}

func TestTheNextTaskInAPaneRecordsHowThePreviousTurnEnded(t *testing.T) {
	for _, c := range []struct{ prev, want string }{{"done", "done"}, {"interrupted", "interrupted"}, {"", "unknown"}} {
		f := &File{Version: FileVersion}
		a := filed(t, f, "new", "修 total_items", onePane(1, "working"), t0, "")
		b := filed(t, f, "new", "README 端口改成 8080", onePane(2, "working"), t0.Add(time.Minute), c.prev, "total_items 改好了")
		if p := paneOf(t, *f, a); p.Ended != c.want || p.Said != "total_items 改好了" {
			t.Fatalf("prev %q: %+v", c.prev, p)
		}
		for _, id := range []string{a, b} {
			if g := one(t, Status(*f, onePane(2, "working"), t0.Add(2*time.Minute), time.Hour), id).Group; g != Doing {
				t.Fatalf("prev %q: %s is %s", c.prev, id, g)
			}
		}
	}
}

func TestGoingBackToAnEarlierTaskReopensIt(t *testing.T) {
	f := &File{Version: FileVersion}
	a := filed(t, f, "new", "修 total_items", onePane(1, "working"), t0, "")
	filed(t, f, "new", "README 端口改成 8080", onePane(2, "working"), t0.Add(time.Minute), "done", "total_items 改好了")
	filed(t, f, a, "回到 total_items，空购物车也要测", onePane(3, "working"), t0.Add(2*time.Minute), "done", "端口改好了")
	if p := paneOf(t, *f, a); p.Ended != "" || p.Said != "" || *p.TurnAt != 3 {
		t.Fatalf("reopened: %+v", p)
	}
	// Once the pane answers, the reopened task shows the new words.
	now := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "done", Turn: 4, Agent: "claude-code", Msg: "空购物车也测过了"})
	if r := one(t, Status(*f, now, t0.Add(3*time.Minute), time.Hour), a); r.Said != "空购物车也测过了" {
		t.Fatalf("said = %q", r.Said)
	}
}

func TestAQueuedMessageClosesThePreviousTaskOnlyOnceItIsPlacedElsewhere(t *testing.T) {
	f := &File{Version: FileVersion}
	a := filed(t, f, "new", "修 total_items", onePane(1, "working"), t0, "")
	m := Message{Pane: PaneRef{Side: "hc", Addr: "t2"}, Text: "顺便写条招聘帖", PrevEnded: "done", AgentSaid: "total_items 改好了"}
	qid, _ := f.Take(Decision{Why: "queue"}, m, onePane(2, "working"), t0.Add(time.Minute))
	if p := paneOf(t, *f, a); p.Ended != "" {
		t.Fatalf("closed before placing: %+v", p)
	}
	if _, err := f.Place(qid, Decision{Task: "new", Title: "招聘帖", Sure: true}, onePane(2, "working"), t0.Add(2*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if p := paneOf(t, *f, a); p.Ended != "done" || p.Said != "total_items 改好了" {
		t.Fatalf("after placing: %+v", p)
	}
}

func TestContinuingTheSameTaskKeepsItOpen(t *testing.T) {
	f := &File{Version: FileVersion}
	a := filed(t, f, "new", "修 total_items", onePane(1, "working"), t0, "")
	filed(t, f, a, "继续", onePane(2, "working"), t0.Add(time.Minute), "done")
	if p := paneOf(t, *f, a); p.Ended != "" || *p.TurnAt != 2 {
		t.Fatalf("continued: %+v", p)
	}
}
