package track

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Filing: which task does a message the user typed into a pane belong to?
// The companion files only what its rules can tell without a model. Everything
// else goes to the Queue, which the filing pane (an agent in its own pane,
// any harness, any model) works through with `track queue` and `track place`.
// The filing pane's best guess is filed straight away: version one is view
// only, the user ticks nothing.

// A Message is what the user typed into a pane.
type Message struct {
	Pane PaneRef `json:"pane"`
	Text string  `json:"text"`
	// How the pane's turn before this message ended: "done", "interrupted",
	// or "" when unknown.
	PrevEnded string `json:"prev_ended,omitempty"`
	// What the agent said at the end of that turn (its status report).
	AgentSaid string `json:"agent_said,omitempty"`
}

// A Decision says where a message belongs: Task is an existing task or "new"
// (then Title, under Under, "" being the top); Also lists more existing tasks
// the same message is about.
type Decision struct {
	Task    string   `json:"task,omitempty"`
	Also    []string `json:"also,omitempty"`
	Under   string   `json:"under,omitempty"`
	Title   string   `json:"title,omitempty"`
	Stage   string   `json:"stage,omitempty"`   // a scanned task: the stage the filing pane saw; a stop: the task's new stage
	Waiting string   `json:"waiting,omitempty"` // a stop judged waiting: the question for the user
	More    bool     `json:"more,omitempty"`    // a scanned session: more tasks to come from it
	Sure    bool     `json:"sure"`
	By      string   `json:"by"`            // rule, organizer (the filing pane) or user
	Why     string   `json:"why,omitempty"` // why it was not filed
}

// Pending is a message, or a past session to sort out, waiting in the Queue
// for the filing pane. Pane carries the hand-off point taken when the message
// came in.
type Pending struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind,omitempty"` // "" a message; "session" a past session from a scan; "stop" a pane stopped on Task
	Task      string  `json:"task,omitempty"` // a stop: the task the pane was on
	Text      string  `json:"text"`
	Pane      PaneRef `json:"pane"`
	PrevEnded string  `json:"prev_ended,omitempty"`
	AgentSaid string  `json:"agent_said,omitempty"`
	At        int64   `json:"at"`
}

// maxNotes is how many of a top-level task's latest scope notes the filing
// pane reads: what every call reads stays small, and old notes keep piling up.
const maxNotes = 5

// Messages with nothing in them but "go on" or "yes", in the app's languages:
// they belong to the task the pane's last turn was about. Anything else goes to
// the filing pane, which reads every language. allow: user words
var bare = map[string]bool{
	"继续": true, "接着": true, "继续做": true, "接着做": true, "跑一下测试": true, "再跑一次": true, "再试一次": true, "重试": true,
	"好": true, "好的": true, "可以": true, "行": true, "嗯": true, "对": true, "是": true, "要": true, "不要": true, "做吧": true,
	"continue": true, "go on": true, "keep going": true, "retry": true, "try again": true, "run the tests": true,
	"ok": true, "okay": true, "yes": true, "no": true, "y": true, "n": true, "1": true, "2": true, "3": true,
	"続けて": true, "はい": true, "いいえ": true, "계속": true, "네": true, "아니요": true,
	"sí": true, "si": true, "continúa": true, "да": true, "нет": true, "продолжай": true,
}

func bareContinuation(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimRight(s, "。.!！ ，,")
	return bare[s]
}

// paneTask is the open task the pane's last turn was handed for, if any.
func paneTask(f File, live Live, p PaneRef) *Thing {
	key := paneKey(p, live)
	var best *Thing
	var at int64 = -1
	for i := range f.Things {
		t := &f.Things[i]
		if t.Stage == Done || t.Stage == Dropped {
			continue
		}
		for _, q := range t.Panes {
			if paneKey(q, live) == key && q.At > at {
				best, at = t, q.At
			}
		}
	}
	return best
}

// Decide files by rule what it can: a bare reply goes to the task the pane's
// last turn was about. Anything else is for the filing pane (Why "queue").
func Decide(f File, live Live, m Message) Decision {
	if cur := paneTask(f, live, m.Pane); cur != nil && bareContinuation(m.Text) {
		return Decision{Task: cur.ID, Sure: true, By: "rule"}
	}
	return Decision{By: "rule", Why: "queue"}
}

// Take files m: a sure decision onto its tasks, anything else into the Queue.
// It returns the task or queue id.
func (f *File) Take(d Decision, m Message, live Live, now time.Time) (string, error) {
	if d.Sure {
		return f.apply(d, m.Pane, m.Text, m.PrevEnded, m.AgentSaid, live, now)
	}
	ref := handOff(m.Pane, live, now)
	id := f.nextPendingID("Q")
	f.Queue = append(f.Queue, Pending{ID: id, Text: m.Text, Pane: ref, PrevEnded: m.PrevEnded, AgentSaid: m.AgentSaid, At: now.UnixMilli()})
	return id, nil
}

// Place is the filing pane's answer for a queued item, filed into the tree
// sure or not. It returns the task id.
func (f *File) Place(id string, d Decision, live Live, now time.Time) (string, error) {
	k := -1
	for i, p := range f.Queue {
		if p.ID == id {
			k = i
		}
	}
	if k < 0 {
		return "", fmt.Errorf("nothing queued with id %s", id)
	}
	p := f.Queue[k]
	if d.By == "" {
		d.By = "organizer"
	}
	switch p.Kind {
	case "session":
		return f.placeSession(k, d, live, now)
	case "stop":
		return f.placeStop(k, d, now)
	}
	if err := f.check(d); err != nil {
		return "", err
	}
	f.Queue = append(f.Queue[:k], f.Queue[k+1:]...)
	return f.applyAt(d, p, live, now)
}

// placeSession turns one task the filing pane found in a scanned session into
// a candidate for the user: scanned tasks never go into the tree unasked.
// "none" means the session has nothing (more) worth a task.
func (f *File) placeSession(k int, d Decision, live Live, now time.Time) (string, error) {
	p := f.Queue[k]
	if d.Task == "none" {
		f.Queue = append(f.Queue[:k], f.Queue[k+1:]...)
		return "", nil
	}
	if d.Stage != "" && !validStage(d.Stage) {
		return "", fmt.Errorf("unknown stage %q (use %s)", d.Stage, stageList())
	}
	if err := f.check(d); err != nil {
		return "", err
	}
	// A task found in a past session: linked to the pane, no turn closed.
	tid, err := f.addOrGet(d, p.Text, now)
	if err != nil {
		return "", err
	}
	t, _ := f.Get(tid)
	t.link(p.Pane, live, "found in a scan")
	if !d.More {
		f.Queue = append(f.Queue[:k], f.Queue[k+1:]...)
	}
	return tid, nil
}

// A SessionItem is a pane's current session, summed up for the filing pane.
type SessionItem struct {
	Pane    PaneRef
	Session string // the session id, so a session is queued once
	Text    string
}

// QueueSessions queues sessions not scanned before; it returns the queue ids.
func (f *File) QueueSessions(items []SessionItem, live Live, now time.Time) ([]string, error) {
	seen := map[string]bool{}
	for _, s := range f.Scanned {
		seen[s] = true
	}
	ids := []string{}
	for _, it := range items {
		if it.Session == "" || seen[it.Session] {
			continue
		}
		id := f.nextPendingID("Q")
		f.Queue = append(f.Queue, Pending{ID: id, Kind: "session", Text: it.Text, Pane: handOff(it.Pane, live, now), At: now.UnixMilli()})
		f.Scanned = append(f.Scanned, it.Session)
		seen[it.Session] = true
		ids = append(ids, id)
	}
	return ids, nil
}

// check says whether a decision names tasks that exist.
func (f *File) check(d Decision) error {
	if d.Task == "" {
		return errors.New("a decision needs a task id or new")
	}
	for _, id := range append([]string{d.Task}, d.Also...) {
		if id == "new" {
			continue
		}
		if _, err := f.Get(id); err != nil {
			return err
		}
	}
	if d.Task == "new" && d.Under != "" {
		if _, err := f.Get(d.Under); err != nil {
			return fmt.Errorf("under: %w", err)
		}
	}
	return nil
}

func handOff(p PaneRef, live Live, now time.Time) PaneRef {
	ref := Canonical(p, live)
	if lp := live.pane(ref); lp.Found {
		n := lp.counter
		ref.TurnAt = &n
	}
	ref.At = now.UnixMilli()
	return ref
}

func (f *File) apply(d Decision, pane PaneRef, text, prevEnded, said string, live Live, now time.Time) (string, error) {
	return f.applyAt(d, Pending{Text: text, Pane: handOff(pane, live, now), PrevEnded: prevEnded, AgentSaid: said, At: now.UnixMilli()}, live, now)
}

// applyAt writes a sure decision for message p, handed to its pane at p.Pane.
func (f *File) applyAt(d Decision, p Pending, live Live, now time.Time) (string, error) {
	if err := f.check(d); err != nil {
		return "", err
	}
	id, err := f.addOrGet(d, p.Text, now)
	if err != nil {
		return "", err
	}
	owners := append([]string{id}, d.Also...)
	f.closePrev(p.Pane, live, p.PrevEnded, p.AgentSaid, owners)
	for _, o := range owners {
		t, _ := f.Get(o)
		t.link(p.Pane, live, p.Text)
		// The user answered, or said more about a finished task: it is being worked on again.
		if t.Stage == WaitingOnYou || t.Stage == Review || t.Stage == Done {
			t.SetStage(Doing)
		}
	}
	return id, nil
}

// addOrGet is the decision's task, made first when it is new (tagged auto).
func (f *File) addOrGet(d Decision, text string, now time.Time) (string, error) {
	if d.Task != "new" {
		return d.Task, nil
	}
	id := f.newTaskID()
	stage := d.Stage
	if stage == "" {
		stage = Doing
	}
	if err := f.Add(Thing{ID: id, Outcome: titleOr(d.Title, text), Stage: stage, Parent: d.Under, Auto: d.By != "user",
		Created: now.UnixMilli(), Updated: now.UnixMilli()}); err != nil {
		return "", err
	}
	return id, nil
}

// link records a hand-off point already taken (ref carries TurnAt and At).
func (t *Thing) link(ref PaneRef, live Live, text string) {
	i := t.find(ref, live)
	if i < 0 {
		t.Panes = append(t.Panes, ref)
		i = len(t.Panes) - 1
	}
	t.Panes[i].TurnAt, t.Panes[i].At, t.Panes[i].Ended, t.Panes[i].Said = ref.TurnAt, ref.At, "", ""
	t.Log = append(t.Log, LogEntry{At: ref.At, To: ref.String(), Text: text})
	if ref.At > t.Updated {
		t.Updated = ref.At
	}
}

// closePrev records how the pane's previous turn ended, and what the agent
// said then, on the task that turn was for, when the new message is about
// other tasks (owners).
func (f *File) closePrev(ref PaneRef, live Live, ended, said string, owners []string) {
	key := paneKey(ref, live)
	bi, bj := -1, -1
	for i := range f.Things {
		for j, q := range f.Things[i].Panes {
			if paneKey(q, live) == key && q.At < ref.At && (bi < 0 || q.At > f.Things[bi].Panes[bj].At) {
				bi, bj = i, j
			}
		}
	}
	if bi < 0 || f.Things[bi].Panes[bj].Ended != "" {
		return
	}
	for _, o := range owners {
		if f.Things[bi].ID == o {
			return
		}
	}
	f.Things[bi].Panes[bj].Ended, f.Things[bi].Panes[bj].Said = ended, said
	if ended == "" {
		f.Things[bi].Panes[bj].Ended = "unknown"
	}
}

// A QueueView is what the filing pane reads: the queued items and every task
// that isn't finished, each top-level task with its latest scope notes.
type QueueView struct {
	Items []Pending  `json:"items"`
	Tasks []TaskLine `json:"tasks"`
}

type TaskLine struct {
	ID     string   `json:"id"`
	Title  string   `json:"title"`
	Under  string   `json:"under,omitempty"`
	Stage  string   `json:"stage,omitempty"`
	Panes  []string `json:"panes,omitempty"`
	Notes  []string `json:"notes,omitempty"`
	Recent string   `json:"recent,omitempty"` // the last thing the user said about it
}

func (f File) View(live Live) QueueView {
	v := QueueView{Items: append([]Pending{}, f.Queue...), Tasks: []TaskLine{}}
	for _, t := range f.Things {
		if t.Stage == Done || t.Stage == Dropped {
			continue
		}
		l := TaskLine{ID: t.ID, Title: t.Outcome, Under: t.Parent, Stage: t.Stage}
		for _, p := range t.Panes {
			l.Panes = append(l.Panes, paneKey(p, live))
		}
		if t.Parent == "" {
			for i := max(0, len(t.Notes)-maxNotes); i < len(t.Notes); i++ {
				l.Notes = append(l.Notes, t.Notes[i].Text)
			}
		}
		if len(t.Log) > 0 {
			l.Recent = clip(t.Log[len(t.Log)-1].Text, 120)
		}
		v.Tasks = append(v.Tasks, l)
	}
	return v
}

func titleOr(title, text string) string {
	if strings.TrimSpace(title) != "" {
		return title
	}
	r := []rune(strings.TrimSpace(text))
	if len(r) > 40 {
		return string(r[:40]) + "…"
	}
	return string(r)
}

func (f *File) newTaskID() string {
	return nextID("T", len(f.Things), func(id string) bool { _, err := f.Get(id); return err == nil })
}

func (f *File) nextPendingID(prefix string) string {
	return nextID(prefix, len(f.Queue), func(id string) bool {
		for _, p := range f.Queue {
			if p.ID == id {
				return true
			}
		}
		return false
	})
}

// nextID is prefix plus the first number past n that isn't taken.
func nextID(prefix string, n int, taken func(string) bool) string {
	for i := n + 1; ; i++ {
		if id := prefix + strconv.Itoa(i); !taken(id) {
			return id
		}
	}
}
