package track

import (
	"strings"
	"testing"
	"time"
)

// Version one is view only: when a pane on a task stops, the filing pane reads
// what the agent said and sets the task's stage itself.
func stopLive(status, msg string, at time.Time) Live {
	return hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: status, Turn: 5, Agent: "claude-code", Msg: msg, StatusMs: ms(at)})
}

func TestAPaneThatStopsOnATaskIsQueuedForTheFilingPaneOnce(t *testing.T) {
	f, _ := organizerFile()
	// Still working, or a status from before the hand-off: nothing to judge.
	if ids := f.QueueStops(stopLive("working", "", t0.Add(time.Minute)), t0.Add(time.Minute)); len(ids) != 0 {
		t.Fatalf("working queued %v", ids)
	}
	if ids := f.QueueStops(stopLive("done", "旧的", t0.Add(-time.Minute)), t0.Add(time.Minute)); len(ids) != 0 {
		t.Fatalf("old status queued %v", ids)
	}
	live := stopLive("done", "端口改好了，要不要顺便改 README？", t0.Add(2*time.Minute))
	ids := f.QueueStops(live, t0.Add(2*time.Minute))
	if len(ids) != 1 || len(f.Queue) != 1 || f.Queue[0].Kind != "stop" || f.Queue[0].Task != "T2" || !strings.Contains(f.Queue[0].Text, "要不要顺便改 README") {
		t.Fatalf("queued %v %+v", ids, f.Queue)
	}
	// The same stop is judged once.
	if ids := f.QueueStops(live, t0.Add(3*time.Minute)); len(ids) != 0 {
		t.Fatalf("queued twice %v", ids)
	}
	// A blocked pane already shows as waiting on the user: not queued.
	g, _ := organizerFile()
	if ids := g.QueueStops(stopLive("blocked", "Allow edit?", t0.Add(2*time.Minute)), t0.Add(2*time.Minute)); len(ids) != 0 {
		t.Fatalf("blocked queued %v", ids)
	}
}

func TestTheFilingPaneSetsTheStageOfAStoppedTask(t *testing.T) {
	for _, c := range []struct{ stage, waiting string }{{Done, ""}, {WaitingOnYou, "要不要顺便改 README？"}, {Doing, ""}} {
		f, _ := organizerFile()
		live := stopLive("done", "端口改好了，要不要顺便改 README？", t0.Add(2*time.Minute))
		ids := f.QueueStops(live, t0.Add(2*time.Minute))
		if _, err := f.Place(ids[0], Decision{Stage: c.stage, Waiting: c.waiting}, live, t0.Add(3*time.Minute)); err != nil || len(f.Queue) != 0 {
			t.Fatalf("%s: %v %+v", c.stage, err, f.Queue)
		}
		t2, _ := f.Get("T2")
		if t2.Stage != c.stage || t2.Waiting != c.waiting || t2.Updated != ms(t0.Add(3*time.Minute)) {
			t.Fatalf("%s: %+v", c.stage, t2)
		}
	}
	f, _ := organizerFile()
	live := stopLive("done", "x", t0.Add(2*time.Minute))
	ids := f.QueueStops(live, t0.Add(2*time.Minute))
	if _, err := f.Place(ids[0], Decision{Stage: Dropped}, live, t0); err == nil {
		t.Fatal("a stop judged as dropped")
	}
	if _, err := f.Place(ids[0], Decision{Stage: WaitingOnYou}, live, t0); err == nil {
		t.Fatal("waiting on the user without the question")
	}
}

// The user answering, or saying more about a finished task, puts it back to 在做.
func TestAMessageOnAWaitingOrFinishedTaskPutsItBackToDoing(t *testing.T) {
	for _, s := range []string{WaitingOnYou, Done, Review} {
		f, live := organizerFile()
		t2, _ := f.Get("T2")
		t2.Stage, t2.Waiting = s, "要不要顺便改 README？"
		if s != WaitingOnYou {
			t2.Waiting = ""
		}
		qid, _ := f.Take(Decision{Why: "queue"}, Message{Pane: api, Text: "要，顺便改"}, live, t0.Add(time.Minute))
		if _, err := f.Place(qid, Decision{Task: "T2"}, live, t0.Add(2*time.Minute)); err != nil {
			t.Fatal(err)
		}
		if t2, _ := f.Get("T2"); t2.Stage != Doing || t2.Waiting != "" {
			t.Fatalf("%s: %+v", s, t2)
		}
	}
}

// The progress page lists what finished lately, newest first, for the user to look at.
func TestTheTreeListsWhatFinishedInTheLastDay(t *testing.T) {
	f, live := organizerFile()
	for id, at := range map[string]time.Time{"T2": t0.Add(-2 * time.Hour), "T4": t0.Add(-time.Hour), "P1a": t0.Add(-30 * time.Hour)} {
		x, _ := f.Get(id)
		x.Stage, x.Updated = Done, ms(at)
	}
	tr := BuildTree(f, live, t0, 10*time.Minute)
	var got []string
	for _, r := range tr.JustDone {
		got = append(got, r.ID+":"+strings.Join(r.Path, ">"))
	}
	if strings.Join(got, " ") != "T4:"+pathText(f, "T4")+" T2:"+pathText(f, "T2") {
		t.Fatalf("just done = %v", got)
	}
}

func pathText(f File, id string) string {
	var p []string
	t, _ := f.Get(id)
	for q := t.Parent; q != ""; {
		x, _ := f.Get(q)
		p = append([]string{x.Outcome}, p...)
		q = x.Parent
	}
	return strings.Join(p, ">")
}

// A scanned session waiting in the queue is not a hand-off: the pane is still on
// its task, so its stop is judged (seen in the Android flow's setup).
func TestAQueuedScanDoesNotHideAPanesStop(t *testing.T) {
	f, _ := organizerFile()
	live := stopLive("done", "端口改好了", t0.Add(2*time.Minute))
	f.QueueSessions([]SessionItem{{Pane: PaneRef{Side: "hc", Addr: "t2"}, Session: "s-1", Text: "你说过：改端口"}}, live, t0.Add(time.Minute))
	if ids := f.QueueStops(live, t0.Add(2*time.Minute)); len(ids) != 1 {
		t.Fatalf("stop not queued: %v %+v", ids, f.Queue)
	}
}
