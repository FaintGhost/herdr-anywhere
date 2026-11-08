package track

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 7, 14, 0, 0, 0, time.UTC)

func ms(t time.Time) int64 { return t.UnixMilli() }
func ip(n int) *int        { return &n }

func hcLive(terms ...HCTerm) Live {
	return Live{HC: terms, HCOK: true, HerdrOK: true}
}

func one(t *testing.T, rows []Row, id string) Row {
	t.Helper()
	for _, r := range rows {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("no row %s in %+v", id, rows)
	return Row{}
}

func TestTurnsSinceHandOffAndNotQuietOnceAPaneAnswered(t *testing.T) {
	f := File{Things: []Thing{{ID: "A1", Outcome: "total_items counts items", Stage: Doing,
		Panes: []PaneRef{{Side: "hc", Addr: "api", TurnAt: ip(3), At: ms(t0)}}}}}
	live := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "done", Turn: 4})
	r := one(t, Status(f, live, t0.Add(3*time.Hour), time.Hour), "A1")
	p := r.Panes[0]
	if !p.Found || p.Status != "done" || p.TurnsSince != 1 || p.Quiet {
		t.Fatalf("pane = %+v", p)
	}
	// A pane stopping is not the task done.
	if r.Group != Doing {
		t.Fatalf("group = %q", r.Group)
	}
	// A done left over from before the hand-off (no new turn) is not a result.
	live = hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "done", Turn: 3})
	if r := one(t, Status(f, live, t0.Add(time.Minute), time.Hour), "A1"); r.Group != Doing {
		t.Fatalf("stale done: group = %q", r.Group)
	}
}

func TestBlockedFlagSaysWhatThePaneAsks(t *testing.T) {
	f := File{Things: []Thing{{ID: "A2", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t2"}}}}}
	live := hcLive(HCTerm{Address: "t2", Name: "web", State: "live", Status: "blocked", Turn: 1, Msg: "approve Bash: cat README.md"})
	r := one(t, Status(f, live, t0, time.Hour), "A2")
	if !strings.Contains(strings.Join(r.Flags, " "), "t2 asks: approve Bash: cat README.md") {
		t.Fatalf("flags = %v", r.Flags)
	}
	// The phone words the flag in its own language from the pane's row.
	if len(r.Panes) != 1 || r.Panes[0].Msg != "approve Bash: cat README.md" || r.Panes[0].Status != "blocked" {
		t.Fatalf("pane rows = %+v", r.Panes)
	}
}

func TestQuietWhenNoNewTurnLongAfterHandOff(t *testing.T) {
	f := File{Things: []Thing{{ID: "A1", Stage: Doing,
		Panes: []PaneRef{{Side: "hc", Addr: "t2", TurnAt: ip(3), At: ms(t0)}}}}}
	live := hcLive(HCTerm{Address: "t2", State: "live", Status: "idle", Turn: 3})
	r := one(t, Status(f, live, t0.Add(90*time.Minute), time.Hour), "A1")
	if !r.Panes[0].Quiet || r.Group != Stuck {
		t.Fatalf("row = %+v", r)
	}
	// Not yet past the threshold: not quiet.
	r = one(t, Status(f, live, t0.Add(30*time.Minute), time.Hour), "A1")
	if r.Panes[0].Quiet || r.Group != Doing {
		t.Fatalf("early row = %+v", r)
	}
}

func TestWorkingIsNeverQuiet(t *testing.T) {
	f := File{Things: []Thing{{ID: "A1", Stage: Doing,
		Panes: []PaneRef{{Side: "hc", Addr: "t2", TurnAt: ip(3), At: ms(t0)}}}}}
	live := hcLive(HCTerm{Address: "t2", State: "live", Status: "working", Turn: 3})
	r := one(t, Status(f, live, t0.Add(5*time.Hour), time.Hour), "A1")
	if r.Panes[0].Quiet {
		t.Fatalf("working pane flagged quiet: %+v", r.Panes[0])
	}
}

func TestBlockedPaneMovesTheThingToWaitingOnYou(t *testing.T) {
	f := File{Things: []Thing{{ID: "A2", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t2"}}}}}
	live := hcLive(HCTerm{Address: "t2", State: "live", Status: "blocked", Turn: 1})
	r := one(t, Status(f, live, t0, time.Hour), "A2")
	if r.Group != WaitingOnYou {
		t.Fatalf("group = %q", r.Group)
	}
	if !strings.Contains(strings.Join(r.Flags, " "), "t2 blocked") {
		t.Fatalf("flags = %v", r.Flags)
	}
}

func TestMissingAndFinishedPanes(t *testing.T) {
	f := File{Things: []Thing{{ID: "A3", Stage: Doing, Panes: []PaneRef{
		{Side: "hc", Addr: "gone"}, {Side: "hc", Addr: "t9"}}}}}
	live := hcLive(HCTerm{Address: "t9", State: "finished", Turn: 2})
	r := one(t, Status(f, live, t0, time.Hour), "A3")
	if r.Panes[0].Found || r.Panes[0].State != "missing" {
		t.Fatalf("missing pane = %+v", r.Panes[0])
	}
	if r.Panes[1].State != "finished" {
		t.Fatalf("finished pane = %+v", r.Panes[1])
	}
	if r.Group != Stuck {
		t.Fatalf("a thing in progress with no live pane should be stuck, got %q", r.Group)
	}
}

func TestUnknownWhenTheListCouldNotBeRead(t *testing.T) {
	f := File{Things: []Thing{{ID: "A4", Stage: Doing, Panes: []PaneRef{{Side: "herdr", PaneID: "w1:p1"}}}}}
	r := one(t, Status(f, Live{HCOK: true, HerdrOK: false}, t0, time.Hour), "A4")
	if r.Panes[0].State != "unknown" || r.Group != Doing {
		t.Fatalf("row = %+v", r)
	}
}

func TestOldHerdrSeqMovedOrQuiet(t *testing.T) {
	f := File{Things: []Thing{
		{ID: "W1", Stage: Doing, Panes: []PaneRef{{Side: "herdr", PaneID: "w1:p1", TurnAt: ip(7), At: ms(t0)}}},
		{ID: "W2", Stage: Doing, Panes: []PaneRef{{Side: "herdr", Name: "web2", TurnAt: ip(9), At: ms(t0)}}},
	}}
	live := Live{HCOK: true, HerdrOK: true, Herdr: []HerdrAgent{
		{PaneID: "w1:p1", Name: "web", Status: "done", Seq: 9},
		{PaneID: "w1:p2", Name: "web2", Status: "idle", Seq: 9},
	}}
	rows := Status(f, live, t0.Add(2*time.Hour), time.Hour)
	if p := one(t, rows, "W1").Panes[0]; !p.Moved || p.Quiet {
		t.Fatalf("W1 pane = %+v", p)
	}
	if p := one(t, rows, "W2").Panes[0]; p.Moved || !p.Quiet {
		t.Fatalf("W2 pane = %+v", p)
	}
}

func TestGroupsSortMostUrgentFirst(t *testing.T) {
	f := File{Things: []Thing{
		{ID: "D", Stage: Done},
		{ID: "R", Stage: Review},
		{ID: "W", Stage: WaitingOnYou, Waiting: "push?"},
		{ID: "G", Stage: Doing},
		{ID: "P", Stage: Parked},
	}}
	rows := Status(f, hcLive(), t0, time.Hour)
	var got []string
	for _, r := range rows {
		got = append(got, r.ID)
	}
	if strings.Join(got, ",") != "W,R,G,P,D" {
		t.Fatalf("order = %v", got)
	}
}

func TestParseLists(t *testing.T) {
	hc := `{"hidden_finished":0,"terminals":[{"address":"t2","agent":"claude","cwd":"/tmp/x","name":"api","state":"live","status":"done","turn":4},{"address":"t3","state":"finished","turn":0}]}`
	terms, err := ParseHCList([]byte(hc))
	if err != nil || len(terms) != 2 || terms[0].Name != "api" || terms[0].Status != "done" || terms[0].Turn != 4 || terms[1].State != "finished" {
		t.Fatalf("hc = %+v, %v", terms, err)
	}
	herdr := `{"id":"cli:agent:list","result":{"agents":[{"agent":"claude","agent_status":"idle","name":"web","pane_id":"w1:p1","state_change_seq":2,"completion_seq":5}],"type":"agent_list"}}`
	ags, err := ParseHerdrList([]byte(herdr))
	if err != nil || len(ags) != 1 || ags[0].PaneID != "w1:p1" || ags[0].Status != "idle" || ags[0].Seq != 5 {
		t.Fatalf("herdr = %+v, %v", ags, err)
	}
	// Without completion_seq no turn has finished yet: the counter is 0. state_change_seq also
	// moves on a restart or a login screen (seen in testing), so it can't stand in.
	ags, _ = ParseHerdrList([]byte(`{"result":{"agents":[{"agent_status":"idle","pane_id":"w1:p2","state_change_seq":6}]}}`))
	if ags[0].Seq != 0 {
		t.Fatalf("seq = %d", ags[0].Seq)
	}
	if _, err := ParseHCList([]byte(`not json`)); err == nil {
		t.Fatal("accepted bad JSON")
	}
}

func TestStoreConcurrentAddsLoseNothing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "track.json")
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			s := Open(path) // a separate open per writer, as separate processes have
			if err := s.Update(func(f *File) error { return f.Add(Thing{ID: fmt.Sprintf("T%d", i), Stage: Doing}) }); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	f, err := Open(path).Load()
	if err != nil || len(f.Things) != 20 {
		t.Fatalf("things = %d, %v", len(f.Things), err)
	}
}

func TestAddRejectsDuplicatesAndLinkNeedsAThing(t *testing.T) {
	var f File
	if err := f.Add(Thing{ID: "A1"}); err != nil {
		t.Fatal(err)
	}
	if err := f.Add(Thing{ID: "A1"}); err == nil {
		t.Fatal("duplicate id accepted")
	}
	if err := f.Add(Thing{ID: ""}); err == nil {
		t.Fatal("empty id accepted")
	}
	if _, err := f.Get("nope"); err == nil {
		t.Fatal("unknown id found")
	}
	if err := f.Add(Thing{ID: "A2", Stage: "whatever"}); err == nil {
		t.Fatal("unknown stage accepted")
	}
}

func TestMarkRecordsTheHandOffPointOnTheRightPane(t *testing.T) {
	f := File{Things: []Thing{{ID: "A1", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "api"}}}}}
	live := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "idle", Turn: 6})
	th, _ := f.Get("A1")
	if err := th.Mark(PaneRef{Side: "hc", Addr: "t2"}, live, t0, "fix total_items"); err != nil {
		t.Fatal(err)
	}
	// t2 and api are the same terminal: the existing ref is updated, not a second one added.
	if len(th.Panes) != 1 || th.Panes[0].TurnAt == nil || *th.Panes[0].TurnAt != 6 || th.Panes[0].At != ms(t0) {
		t.Fatalf("panes = %+v", th.Panes)
	}
	if len(th.Log) != 1 || th.Log[0].Text != "fix total_items" || th.Log[0].To != "hc:t2" {
		t.Fatalf("log = %+v", th.Log)
	}
}

func TestBoardTextShowsGroupsAndFlags(t *testing.T) {
	f := File{Things: []Thing{
		{ID: "A1", Outcome: "fix total_items", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t2", TurnAt: ip(3), At: ms(t0)}}},
		{ID: "A7", Outcome: "push web", Stage: WaitingOnYou, Waiting: "approve push in web"},
	}}
	live := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "idle", Turn: 3})
	out := Board(Status(f, live, t0.Add(2*time.Hour), time.Hour), t0.Add(2*time.Hour))
	for _, want := range []string{"waiting", "A7", "approve push in web", "stuck", "A1", "api", "no new turn 2h after the hand-off"} {
		if !strings.Contains(out, want) {
			t.Fatalf("board lacks %q:\n%s", want, out)
		}
	}
	if strings.Index(out, "A7") > strings.Index(out, "A1") {
		t.Fatalf("waiting-on-you should come first:\n%s", out)
	}
}

func TestCanonicalStoresIdsAndNames(t *testing.T) {
	live := Live{HCOK: true, HerdrOK: true,
		HC:    []HCTerm{{Address: "t2", Name: "api", State: "live"}},
		Herdr: []HerdrAgent{{PaneID: "w1:p1", Name: "web"}}}
	if got := Canonical(PaneRef{Side: "hc", Addr: "api"}, live); got.Addr != "t2" || got.Name != "api" {
		t.Fatalf("hc = %+v", got)
	}
	if got := Canonical(PaneRef{Side: "herdr", Name: "web"}, live); got.PaneID != "w1:p1" || got.Name != "web" {
		t.Fatalf("herdr = %+v", got)
	}
	if !Exists(PaneRef{Side: "hc", Addr: "api"}, live) || Exists(PaneRef{Side: "hc", Addr: "nope"}, live) {
		t.Fatal("Exists")
	}
}

func TestParseHerdrSession(t *testing.T) {
	ags, err := ParseHerdrList([]byte(`{"result":{"agents":[{"agent":"claude","agent_status":"done","pane_id":"w1:p1","state_change_seq":3,"agent_session":{"agent":"claude","kind":"id","source":"herdr:claude","value":"sid-1"}}]}}`))
	if err != nil || ags[0].Agent != "claude" || ags[0].Session != "sid-1" {
		t.Fatalf("%+v %v", ags, err)
	}
}
