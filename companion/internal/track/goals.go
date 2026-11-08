package track

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// One kind of item, a task, that nests under another task. A project, a
// milestone and a task are only places in the tree: the user doesn't have to
// say which one a thing is.

// FileVersion 2: tasks nest by Parent; version 1 had goals and milestones.
const FileVersion = 2

// Goal and Milestone are version 1's containers, read only to convert old files.
type Goal struct {
	ID         string      `json:"id"`
	Title      string      `json:"title"`
	Std        string      `json:"std,omitempty"`
	Stage      string      `json:"stage,omitempty"`
	Milestones []Milestone `json:"milestones,omitempty"`
	Notes      []Note      `json:"notes,omitempty"`
	Created    int64       `json:"created,omitempty"`
	Updated    int64       `json:"updated,omitempty"`
}

type Milestone struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// A Note is a scope note: written on a top-level task when a task is moved out
// of it, read by whoever files the next messages.
type Note struct {
	At   int64  `json:"at"`
	Text string `json:"text"`
}

// migrate turns a version 1 file into nested tasks: each goal becomes a
// top-level task, each milestone a task under it, and each task goes under its
// milestone or goal. Containers come first, in their old order.
func (f *File) migrate() {
	if f.Version >= FileVersion {
		return
	}
	taken := map[string]bool{}
	for _, t := range f.Things {
		taken[t.ID] = true
	}
	for _, g := range f.Goals {
		taken[g.ID] = true
	}
	var out []Thing
	msID := map[string]string{} // goal/milestone → new id
	for _, g := range f.Goals {
		out = append(out, Thing{ID: g.ID, Outcome: g.Title, Std: g.Std, Stage: g.Stage, Notes: g.Notes, Created: g.Created, Updated: g.Updated})
		for _, m := range g.Milestones {
			id := m.ID
			if taken[id] {
				id = g.ID + "-" + m.ID
			}
			taken[id] = true
			msID[g.ID+"/"+m.ID] = id
			out = append(out, Thing{ID: id, Outcome: m.Title, Parent: g.ID})
		}
	}
	for _, t := range f.Things {
		switch {
		case t.Goal != "" && t.Milestone != "" && msID[t.Goal+"/"+t.Milestone] != "":
			t.Parent = msID[t.Goal+"/"+t.Milestone]
		case t.Goal != "":
			t.Parent = t.Goal
		}
		t.Goal, t.Milestone = "", ""
		out = append(out, t)
	}
	f.Things, f.Goals, f.Version = out, nil, FileVersion
}

// checkParent says whether task id may go under parent ("" is the top).
func (f *File) checkParent(id, parent string) error {
	if parent == "" {
		return nil
	}
	for p := parent; p != ""; {
		if p == id {
			return errors.New("a task can't go under itself or one of its own tasks")
		}
		t, err := f.Get(p)
		if err != nil {
			return err
		}
		p = t.Parent
	}
	return nil
}

// top is the top-level task above id (id itself when it has no parent).
func (f *File) top(id string) string {
	for i := 0; i < len(f.Things)+1; i++ {
		t, err := f.Get(id)
		if err != nil || t.Parent == "" {
			return id
		}
		id = t.Parent
	}
	return id
}

// Move puts task under another task by the user's hand ("" is the top).
// Moving a task out of another top-level task writes a scope note on that one,
// which the organizer reads next time.
func (f *File) Move(task, under string, now time.Time) error {
	t, err := f.Get(task)
	if err != nil {
		return err
	}
	if err := f.checkParent(task, under); err != nil {
		return err
	}
	from, to := f.top(task), ""
	if under != "" {
		to = f.top(under)
	}
	if t.Parent != "" && from != task && from != to {
		if old, err := f.Get(from); err == nil {
			where := "the top"
			if to != "" {
				nt, _ := f.Get(to)
				where = fmt.Sprintf("%q", nt.Outcome)
			}
			old.Notes = append(old.Notes, Note{At: now.UnixMilli(), Text: fmt.Sprintf("%q does not belong here: the user moved it to %s", t.Outcome, where)})
			old.Updated = now.UnixMilli()
		}
	}
	t, _ = f.Get(task)
	t.Parent, t.Auto = under, false
	t.Updated = now.UnixMilli()
	return nil
}

// Tree is the progress page: what needs the user, then the open top-level
// tasks with what is under them, then the closed ones.
type Tree struct {
	NeedsYou []NeedRow `json:"needs_you"`
	Tasks    []Node    `json:"tasks"`
	Closed   []Node    `json:"closed"`
	Queue    int       `json:"queue"` // items waiting for the filing pane
	// JustDone: tasks finished in the last day, newest first, for the user to look at.
	JustDone []NeedRow `json:"just_done"`
	// OrganizerWaits: items wait for the filing pane, which is up but reports no
	// status (on Claude's folder-trust dialog or a login screen, seen in companion/eval/filing).
	OrganizerWaits *OrganizerWait `json:"organizer_waits,omitempty"`
}

// A OrganizerWait is the filing pane to open.
type OrganizerWait struct {
	Addr string `json:"addr"`
}

// A NeedRow is a task waiting for the user, with the titles above it.
type NeedRow struct {
	Row
	Path []string `json:"path"`
}

// A Node is a task with the tasks under it. Done and Total count the tasks
// with nothing under them, anywhere below (Total leaves out dropped ones).
type Node struct {
	Row
	Children []Node `json:"children"`
	Done     int    `json:"done"`
	Total    int    `json:"total"`
}

func BuildTree(f File, live Live, now time.Time, quietAfter time.Duration) Tree {
	rows := Status(f, live, now, quietAfter)
	byID := map[string]Row{}
	kids := map[string][]string{}
	order := map[string]int{}
	for i, t := range f.Things {
		order[t.ID] = i
		p := t.Parent
		if _, err := f.Get(p); p != "" && err != nil {
			p = "" // its parent is gone: show it at the top
		}
		kids[p] = append(kids[p], t.ID)
	}
	for _, r := range rows {
		byID[r.ID] = r
	}
	var build func(id string, depth int) Node
	build = func(id string, depth int) Node {
		n := Node{Row: byID[id], Children: []Node{}}
		if depth > len(f.Things) {
			return n
		}
		var groups []string
		for _, k := range kids[id] {
			c := build(k, depth+1)
			n.Children = append(n.Children, c)
			n.Done += c.Done
			n.Total += c.Total
			groups = append(groups, c.Group)
		}
		if len(n.Children) == 0 {
			switch n.Group {
			case Dropped:
			case Done:
				n.Done, n.Total = 1, 1
			default:
				n.Total = 1
			}
			return n
		}
		// A parent shows its most urgent task; with all of them done it is
		// done too (version one is view only: nobody accepts it).
		if s := n.Thing.Stage; s == "" || s == Doing {
			g := groupOf(groups, Done)
			if s == Doing && stages[n.Group] < stages[g] {
				g = n.Group // its own panes need the user
			}
			n.Group = g
		}
		sort.SliceStable(n.Children, func(i, j int) bool { return order[n.Children[i].ID] < order[n.Children[j].ID] })
		return n
	}
	tr := Tree{NeedsYou: []NeedRow{}, Tasks: []Node{}, Closed: []Node{}, Queue: len(f.Queue)}
	for _, id := range kids[""] {
		n := build(id, 0)
		if n.Group == Done || n.Group == Dropped {
			tr.Closed = append(tr.Closed, n)
		} else {
			tr.Tasks = append(tr.Tasks, n)
		}
	}
	sort.SliceStable(tr.Tasks, func(i, j int) bool { return stages[tr.Tasks[i].Group] < stages[tr.Tasks[j].Group] })

	for _, r := range rows {
		if len(kids[r.ID]) > 0 || (r.Group != WaitingOnYou && r.Group != Review) {
			continue
		}
		tr.NeedsYou = append(tr.NeedsYou, NeedRow{Row: r, Path: f.pathOf(r.ID)})
	}
	sort.SliceStable(tr.NeedsYou, func(i, j int) bool { return tr.NeedsYou[i].Updated < tr.NeedsYou[j].Updated })
	tr.JustDone = []NeedRow{}
	for _, r := range rows {
		if r.Stage == Done && r.Updated > 0 && now.Sub(time.UnixMilli(r.Updated)) < justDoneFor {
			tr.JustDone = append(tr.JustDone, NeedRow{Row: r, Path: f.pathOf(r.ID)})
		}
	}
	sort.SliceStable(tr.JustDone, func(i, j int) bool { return tr.JustDone[i].Updated > tr.JustDone[j].Updated })
	return tr
}

// justDoneFor is how long a finished task stays in the page's 刚做完 list.
const justDoneFor = 24 * time.Hour

// pathOf is the titles of the tasks above id, top first.
func (f *File) pathOf(id string) []string {
	path := []string{}
	t, err := f.Get(id)
	if err != nil {
		return path
	}
	for p := t.Parent; p != "" && len(path) <= len(f.Things); {
		x, err := f.Get(p)
		if err != nil {
			break
		}
		path = append([]string{x.Outcome}, path...)
		p = x.Parent
	}
	return path
}

// groupOf is the most urgent group among unfinished ones; with none left it is
// allDone if any was done, and 放着 when there is nothing yet.
func groupOf(groups []string, allDone string) string {
	best, done := "", false
	for _, g := range groups {
		switch g {
		case Done:
			done = true
		case Dropped:
		default:
			if best == "" || stages[g] < stages[best] {
				best = g
			}
		}
	}
	switch {
	case best != "":
		return best
	case done:
		return allDone
	default:
		return Parked
	}
}

// TreeText is the progress page as text.
func TreeText(tr Tree, now time.Time) string {
	var b strings.Builder
	if tr.OrganizerWaits != nil {
		fmt.Fprintf(&b, "The filing pane (%s) has not started: it may be on a trust or login screen; open it\n\n", tr.OrganizerWaits.Addr)
	}
	if len(tr.NeedsYou) > 0 {
		b.WriteString("Needs you\n")
		for _, r := range tr.NeedsYou {
			path := strings.Join(r.Path, " › ")
			if path == "" {
				path = "top"
			}
			fmt.Fprintf(&b, "  %s  %s %s  %s\n", r.Group, r.ID, r.Outcome, path)
			if r.Waiting != "" {
				fmt.Fprintf(&b, "      %s\n", r.Waiting)
			}
		}
		b.WriteString("\n")
	}
	if tr.Queue > 0 {
		fmt.Fprintf(&b, "%d still to file\n\n", tr.Queue)
	}
	if len(tr.JustDone) > 0 {
		b.WriteString("Just done\n")
		for _, r := range tr.JustDone {
			path := strings.Join(r.Path, " › ")
			if path == "" {
				path = "top"
			}
			fmt.Fprintf(&b, "  %s %s  %s\n", r.ID, r.Outcome, path)
		}
		b.WriteString("\n")
	}
	var task func(indent string, n Node)
	task = func(indent string, n Node) {
		auto, count := "", ""
		if n.Auto {
			auto = " (filed by rule)"
		}
		if len(n.Children) > 0 {
			count = fmt.Sprintf("  %d/%d", n.Done, n.Total)
		}
		fmt.Fprintf(&b, "%s%s  %s %s%s%s\n", indent, n.Group, n.ID, n.Outcome, count, auto)
		if n.Std != "" {
			fmt.Fprintf(&b, "%s    done when: %s\n", indent, n.Std)
		}
		for _, p := range n.Panes {
			line := strings.TrimSpace(strings.Join([]string{p.ID, p.Name, p.Status}, " "))
			if p.HandedOn {
				line += " (on its next task)"
			}
			fmt.Fprintf(&b, "%s    %s\n", indent, line)
		}
		if n.Said != "" {
			fmt.Fprintf(&b, "%s    said last: %s\n", indent, n.Said)
		}
		for _, fl := range n.Flags {
			fmt.Fprintf(&b, "%s    ! %s\n", indent, fl)
		}
		for _, c := range n.Children {
			task(indent+"  ", c)
		}
	}
	for _, n := range tr.Tasks {
		task("", n)
	}
	if len(tr.Closed) > 0 {
		fmt.Fprintf(&b, "%d done\n", len(tr.Closed))
	}
	return b.String()
}
