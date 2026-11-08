package track

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// One kind of item, a task, that nests: a project, a milestone and a task are
// only places in the tree.

func taskFile() File {
	return File{Version: FileVersion, Things: []Thing{
		{ID: "P1", Outcome: "Acme 1.0 发布", Std: "release 页能打开"},
		{ID: "P1a", Outcome: "修完已知问题", Parent: "P1"},
		{ID: "P1b", Outcome: "发版", Parent: "P1"},
		{ID: "T1", Outcome: "total_items 修好", Stage: Done, Parent: "P1a"},
		{ID: "T2", Outcome: "打 tag 并 push", Stage: WaitingOnYou, Waiting: "要 push 吗？", Parent: "P1b", Updated: ms(t0)},
		{ID: "T3", Outcome: "写 CHANGELOG", Stage: Review, Parent: "P1b", Updated: ms(t0.Add(-time.Hour))},
		{ID: "P2", Outcome: "文档改版"},
		{ID: "T4", Outcome: "FAQ", Stage: Doing, Parent: "P2"},
		{ID: "T5", Outcome: "旧的一件", Stage: Done},
	}}
}

func node(t *testing.T, nodes []Node, id string) Node {
	t.Helper()
	for _, n := range nodes {
		if n.ID == id {
			return n
		}
		if len(n.Children) > 0 {
			for _, c := range n.Children {
				if c.ID == id {
					return c
				}
			}
		}
	}
	t.Fatalf("no node %s in %+v", id, nodes)
	return Node{}
}

func TestAGoalFileLoadsAsNestedTasks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "track.json")
	old := `{"goals":[
	  {"id":"G1","title":"Acme 1.0 发布","std":"release 页能打开","milestones":[{"id":"M1","title":"修完已知问题"},{"id":"M2","title":"发版"}],
	   "notes":[{"at":1,"text":"「招聘帖」不属于这件事"}]},
	  {"id":"G2","title":"文档改版","stage":"parked","milestones":[{"id":"M1","title":"FAQ"}]}],
	 "things":[
	  {"id":"T1","outcome":"total_items 修好","stage":"done","goal":"G1","milestone":"M1"},
	  {"id":"T2","outcome":"FAQ 第一版","stage":"doing","goal":"G2","milestone":"M1"},
	  {"id":"T3","outcome":"没归类的","stage":"doing"}]}`
	if err := os.WriteFile(path, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := Open(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if f.Version != FileVersion || len(f.Goals) != 0 {
		t.Fatalf("version %d, goals left %d", f.Version, len(f.Goals))
	}
	get := func(id string) Thing {
		t.Helper()
		x, err := f.Get(id)
		if err != nil {
			t.Fatalf("%s: %v (things %+v)", id, err, f.Things)
		}
		return *x
	}
	g1 := get("G1")
	if g1.Parent != "" || g1.Outcome != "Acme 1.0 发布" || g1.Std != "release 页能打开" || len(g1.Notes) != 1 || g1.Stage != "" {
		t.Fatalf("G1 = %+v", g1)
	}
	// A goal's stage was the user's call; it stays.
	if g2 := get("G2"); g2.Stage != Parked {
		t.Fatalf("G2 = %+v", g2)
	}
	if m := get("M1"); m.Parent != "G1" || m.Outcome != "修完已知问题" {
		t.Fatalf("M1 = %+v", m)
	}
	// Milestone ids repeat across goals; the second one gets its goal in front.
	if m := get("G2-M1"); m.Parent != "G2" || m.Outcome != "FAQ" {
		t.Fatalf("G2-M1 = %+v", m)
	}
	if t1, t2, t3 := get("T1"), get("T2"), get("T3"); t1.Parent != "M1" || t2.Parent != "G2-M1" || t3.Parent != "" || t1.Goal != "" || t1.Milestone != "" {
		t.Fatalf("tasks = %+v %+v %+v", t1, t2, t3)
	}
	// Containers first, in the old order, so the tree keeps the user's order.
	var ids []string
	for _, x := range f.Things {
		ids = append(ids, x.ID)
	}
	if got := strings.Join(ids, " "); got != "G1 M1 M2 G2 G2-M1 T1 T2 T3" {
		t.Fatalf("order = %s", got)
	}
}

func TestATaskGoesOnlyUnderAnExistingTaskAndNeverUnderItself(t *testing.T) {
	f := taskFile()
	if err := f.Add(Thing{ID: "X1", Parent: "P9"}); err == nil {
		t.Fatal("unknown parent accepted")
	}
	if err := f.Add(Thing{ID: "X2", Parent: "P1b"}); err != nil {
		t.Fatal(err)
	}
	if err := f.Move("P1", "T2", t0); err == nil {
		t.Fatal("moved a task under its own child")
	}
	if err := f.Move("P1", "P1", t0); err == nil {
		t.Fatal("moved a task under itself")
	}
}

func TestTheTreeNestsTasksAndAParentShowsItsMostUrgentChild(t *testing.T) {
	tr := BuildTree(taskFile(), hcLive(), t0, time.Hour)
	var top []string
	for _, n := range tr.Tasks {
		top = append(top, n.ID)
	}
	// Open top-level tasks, most urgent first; finished ones go to Closed.
	if got := strings.Join(top, " "); got != "P1 P2" {
		t.Fatalf("top = %s", got)
	}
	if len(tr.Closed) != 1 || tr.Closed[0].ID != "T5" {
		t.Fatalf("closed = %+v", tr.Closed)
	}
	p1 := node(t, tr.Tasks, "P1")
	if p1.Group != WaitingOnYou || len(p1.Children) != 2 || p1.Children[0].ID != "P1a" || p1.Children[1].ID != "P1b" {
		t.Fatalf("P1 = %+v", p1)
	}
	// Done and total count leaf tasks anywhere below.
	if p1.Done != 1 || p1.Total != 3 {
		t.Fatalf("P1 %d/%d", p1.Done, p1.Total)
	}
	if a := p1.Children[0]; a.Group != Done || a.Done != 1 || a.Total != 1 {
		t.Fatalf("P1a = %+v", a)
	}
}

// Version one is view only: nobody accepts a parent, so one whose tasks are
// all done is done.
func TestAParentWhoseTasksAreAllDoneIsDone(t *testing.T) {
	f := taskFile()
	for _, id := range []string{"T2", "T3"} {
		x, _ := f.Get(id)
		x.Stage = Done
	}
	tr := BuildTree(f, hcLive(), t0, time.Hour)
	if len(tr.Tasks) != 1 || tr.Tasks[0].ID != "P2" {
		t.Fatalf("open = %+v", tr.Tasks)
	}
	p1 := node(t, tr.Closed, "P1")
	if p1.Group != Done || p1.Done != 3 || p1.Total != 3 {
		t.Fatalf("P1 = %+v", p1)
	}
}

func TestNeedsYouCarriesWhereTheTaskSits(t *testing.T) {
	tr := BuildTree(taskFile(), hcLive(), t0, time.Hour)
	if len(tr.NeedsYou) != 2 || tr.NeedsYou[0].ID != "T3" || tr.NeedsYou[1].ID != "T2" {
		t.Fatalf("needs you = %+v", tr.NeedsYou)
	}
	if got := strings.Join(tr.NeedsYou[1].Path, " › "); got != "Acme 1.0 发布 › 发版" {
		t.Fatalf("path = %q", got)
	}
	// A parent shows the user's call through its child; only leaves are listed.
	for _, n := range tr.NeedsYou {
		if n.ID == "P1" || n.ID == "P1b" {
			t.Fatalf("parent listed: %+v", n)
		}
	}
}

func TestMovingATaskOutWritesAScopeNoteOnItsOldTopTask(t *testing.T) {
	f := taskFile()
	x, _ := f.Get("T4")
	x.Auto = true
	if err := f.Move("T4", "P1b", t0); err != nil {
		t.Fatal(err)
	}
	x, _ = f.Get("T4")
	if x.Parent != "P1b" || x.Auto {
		t.Fatalf("T4 = %+v", x)
	}
	p2, _ := f.Get("P2")
	if len(p2.Notes) != 1 || !strings.Contains(p2.Notes[0].Text, "FAQ") || !strings.Contains(p2.Notes[0].Text, "Acme 1.0 发布") {
		t.Fatalf("notes = %+v", p2.Notes)
	}
	// Moving within the same top task, or a top-level task, writes none.
	if err := f.Move("T4", "P1a", t0); err != nil {
		t.Fatal(err)
	}
	if err := f.Move("T5", "P2", t0); err != nil {
		t.Fatal(err)
	}
	p1, _ := f.Get("P1")
	p2, _ = f.Get("P2")
	if len(p1.Notes) != 0 || len(p2.Notes) != 1 {
		t.Fatalf("notes: %+v %+v", p1.Notes, p2.Notes)
	}
	// "" moves a task to the top.
	if err := f.Move("T4", "", t0); err != nil {
		t.Fatal(err)
	}
	if x, _ := f.Get("T4"); x.Parent != "" {
		t.Fatalf("T4 = %+v", x)
	}
}

// A pane stopping is not the task done: the task stays
// 在做 and shows what the agent said, until the user or the judge says more.
func TestAPaneStoppingShowsWhatTheAgentSaidAndDoesNotFinishTheTask(t *testing.T) {
	f := File{Version: FileVersion, Things: []Thing{{ID: "A1", Outcome: "total_items", Stage: Doing,
		Panes: []PaneRef{{Side: "hc", Addr: "t2", TurnAt: ip(3), At: ms(t0)}}}}}
	live := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "done", Turn: 4, Msg: "total_items 改好了，测试都过了"})
	r := one(t, Status(f, live, t0.Add(time.Minute), time.Hour), "A1")
	if r.Group != Doing || r.Said != "total_items 改好了，测试都过了" {
		t.Fatalf("row = %+v", r)
	}
}

// When the pane went on to another task, the earlier task keeps what the agent
// said at the end of its own turn, not what it says now.
func TestAnEarlierTaskKeepsWhatTheAgentSaidWhenItsTurnEnded(t *testing.T) {
	f := &File{Version: FileVersion}
	live := onePane(1, "working")
	a := filed(t, f, "new", "修 total_items", live, t0, "")
	b := filed(t, f, "new", "README 端口改成 8080", onePane(2, "working"), t0.Add(time.Minute), "done", "total_items 改好了")
	now := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "done", Turn: 2, Agent: "claude-code", Msg: "端口改好了", StatusMs: ms(t0.Add(90 * time.Second))})
	if r := one(t, Status(*f, now, t0.Add(2*time.Minute), time.Hour), a); r.Said != "total_items 改好了" || r.Group != Doing {
		t.Fatalf("earlier = %+v", r)
	}
	if r := one(t, Status(*f, now, t0.Add(2*time.Minute), time.Hour), b); r.Said != "端口改好了" {
		t.Fatalf("later = %+v", r)
	}
}

func TestTurnWindowEndsAtTheNextHandOffToTheSamePane(t *testing.T) {
	f := File{Things: []Thing{
		{ID: "A1", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t2", TurnAt: ip(3), At: ms(t0)}}},
		{ID: "A4", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "api", TurnAt: ip(4), At: ms(t0.Add(10 * time.Minute))}}},
	}}
	live := hcLive(HCTerm{Address: "t2", Name: "api", State: "live", Status: "blocked", Turn: 6, Agent: "claude-code"})
	rows := Status(f, live, t0.Add(20*time.Minute), time.Hour)
	a1, a4 := one(t, rows, "A1"), one(t, rows, "A4")
	if p := a1.Panes[0]; p.TurnsSince != 1 || !p.HandedOn || p.Quiet {
		t.Fatalf("A1 pane = %+v", p)
	}
	if a1.Group != Doing || len(a1.Flags) != 0 {
		t.Fatalf("A1 = %q %v: the block belongs to A4", a1.Group, a1.Flags)
	}
	if p := a4.Panes[0]; p.TurnsSince != 2 || p.HandedOn {
		t.Fatalf("A4 pane = %+v", p)
	}
	if a4.Group != WaitingOnYou {
		t.Fatalf("A4 group = %q", a4.Group)
	}
}

func TestAgentPaneWithNoStatusIsFlaggedAfterAMinute(t *testing.T) {
	f := File{Things: []Thing{
		{ID: "A1", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t3", TurnAt: ip(0), At: ms(t0)}}},
		{ID: "A2", Stage: Doing, Panes: []PaneRef{{Side: "hc", Addr: "t4", TurnAt: ip(1), At: ms(t0)}}},
	}}
	live := hcLive(
		HCTerm{Address: "t3", State: "live", Turn: 0, Agent: "claude-code"}, // trust dialog: no OSC 7501 yet
		HCTerm{Address: "t4", State: "live", Turn: 1, Agent: "zsh"},         // a shell never reports status
	)
	rows := Status(f, live, t0.Add(30*time.Second), time.Hour)
	if r := one(t, rows, "A1"); r.Group != Doing || len(r.Flags) != 0 {
		t.Fatalf("too early: %+v", r)
	}
	rows = Status(f, live, t0.Add(90*time.Second), time.Hour)
	r := one(t, rows, "A1")
	if r.Group != Stuck || len(r.Flags) != 1 || !strings.Contains(r.Flags[0], "no status") || !r.Panes[0].NoStatus {
		t.Fatalf("A1 = %+v", r)
	}
	if r := one(t, rows, "A2"); r.Group != Doing || len(r.Flags) != 0 {
		t.Fatalf("shell flagged: %+v", r)
	}
}
