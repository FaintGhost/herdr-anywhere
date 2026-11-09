// Package track keeps the user's expected results ("things") in one JSON file
// and works out, with no model call, where each one stands: the state of the
// panes doing it in herdr-core and in old Herdr, how many turns they ran since
// work was handed to them, and which ones went quiet after a hand-off.
//
// Only the things are stored. Pane state, turns since a hand-off and the
// "quiet" flag are computed from one `hc ls --all` and one list from old Herdr
// each time, so they can't go stale in the file.
package track

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Stages, as codes: the phone words them in its own language.
const (
	WaitingOnYou = "waiting"
	Stuck        = "stuck" // computed only: a pane blocked, gone or quiet after a hand-off
	Review       = "review"
	Doing        = "doing"
	Parked       = "parked"
	Done         = "done"
	Dropped      = "dropped"
)

var stages = map[string]int{WaitingOnYou: 0, Stuck: 1, Review: 2, Doing: 3, Parked: 4, Done: 5, Dropped: 6}

// PaneRef says which pane works on a thing. Side is "hc" (herdr-core: Addr is
// an address or a name) or "herdr" (old Herdr: PaneID, or Name).
// TurnAt and At are the pane's turn (hc) or completion counter (herdr) and the
// time when work was last handed to it.
type PaneRef struct {
	Side   string `json:"side"`
	Addr   string `json:"addr,omitempty"`
	PaneID string `json:"pane_id,omitempty"`
	Name   string `json:"name,omitempty"`
	TurnAt *int   `json:"turn_at,omitempty"`
	At     int64  `json:"at,omitempty"`
	// Ended is how this task's last turn in the pane ended, written when the
	// pane's next message started another task: "done", "interrupted", or "".
	Ended string `json:"ended,omitempty"`
	// What the agent said when that turn ended (its status report), kept so an
	// earlier task shows its own last words after the pane moved on.
	Said string `json:"said,omitempty"`
	// Judged is the status time (hc status_ms) of the pane's last stop already
	// handed to the filing pane, so each stop is judged once.
	Judged int64 `json:"judged,omitempty"`
}

func (p PaneRef) String() string {
	switch {
	case p.Side == "hc":
		return "hc:" + p.Addr
	case p.PaneID != "":
		return "herdr:" + p.PaneID
	default:
		return "herdr:" + p.Name
	}
}

type LogEntry struct {
	At   int64  `json:"at"`
	To   string `json:"to,omitempty"`
	Text string `json:"text"`
}

type Thing struct {
	ID       string     `json:"id"`
	Outcome  string     `json:"outcome"`
	Stage    string     `json:"stage"`
	Next     string     `json:"next,omitempty"`
	Waiting  string     `json:"waiting,omitempty"`
	Evidence []string   `json:"evidence,omitempty"`
	Panes    []PaneRef  `json:"panes,omitempty"`
	Log      []LogEntry `json:"log,omitempty"`
	Created  int64      `json:"created,omitempty"`
	Updated  int64      `json:"updated,omitempty"`
	Parent   string     `json:"parent,omitempty"` // the task this one is under; "" at the top
	Std      string     `json:"std,omitempty"`    // when it counts as done, in the user's words
	Notes    []Note     `json:"notes,omitempty"`  // scope notes, on top-level tasks
	Auto     bool       `json:"auto,omitempty"`   // filed by the organizer, not by the user
	// Version 1 only, read to convert old files.
	Goal      string `json:"goal,omitempty"`
	Milestone string `json:"milestone,omitempty"`
}

type File struct {
	Version int       `json:"version,omitempty"`
	Goals   []Goal    `json:"goals,omitempty"` // version 1 only
	Things  []Thing   `json:"things"`
	Queue   []Pending `json:"queue,omitempty"`   // waiting for the filing pane
	Scanned []string  `json:"scanned,omitempty"` // session ids already queued by a scan
	// The scan format the sessions were scanned with: a file scanned with an
	// older one is scanned once more (ScanFormat).
	ScanFormat int `json:"scan_format,omitempty"`
	// The user's answer to sorting the panes' sessions: "", "yes" or "no".
	ScanAnswer string `json:"scan_answer,omitempty"`
}

// ScanFormat is what a scan gives the filing pane: 2 is each thing the user
// said with the agent's answer to it. Raise it when that changes enough that
// sessions scanned before should be scanned again.
const ScanFormat = 2

func validStage(s string) bool {
	_, ok := stages[s]
	return ok && s != Stuck
}

func (f *File) Add(t Thing) error {
	if strings.TrimSpace(t.ID) == "" {
		return errors.New("a thing needs an id")
	}
	if err := f.checkParent(t.ID, t.Parent); err != nil {
		return err
	}
	if t.Stage == "" {
		t.Stage = Doing
	}
	if !validStage(t.Stage) {
		return fmt.Errorf("unknown stage %q (use %s)", t.Stage, stageList())
	}
	if _, err := f.Get(t.ID); err == nil {
		return fmt.Errorf("thing %s already exists", t.ID)
	}
	f.Things = append(f.Things, t)
	return nil
}

func stageList() string {
	return strings.Join([]string{WaitingOnYou, Review, Doing, Parked, Done, Dropped}, " / ")
}

// Get returns a pointer into f, so changes stick.
func (f *File) Get(id string) (*Thing, error) {
	for i := range f.Things {
		if f.Things[i].ID == id {
			return &f.Things[i], nil
		}
	}
	return nil, fmt.Errorf("no thing %s", id)
}

func (t *Thing) SetStage(s string) error {
	if !validStage(s) {
		return fmt.Errorf("unknown stage %q (use %s)", s, stageList())
	}
	t.Stage = s
	if s != WaitingOnYou {
		t.Waiting = ""
	}
	return nil
}

// Mark records that work was handed to pane p now: it links p if it isn't yet,
// remembers p's current turn or counter, and logs the text.
func (t *Thing) Mark(p PaneRef, live Live, now time.Time, text string) error {
	i := t.find(p, live)
	if i < 0 {
		t.Panes = append(t.Panes, p)
		i = len(t.Panes) - 1
	}
	if pr := live.pane(t.Panes[i]); pr.Found {
		n := pr.counter
		t.Panes[i].TurnAt = &n
	}
	t.Panes[i].At = now.UnixMilli()
	t.Panes[i].Ended, t.Panes[i].Said = "", "" // talked to again: open
	t.Log = append(t.Log, LogEntry{At: now.UnixMilli(), To: p.String(), Text: text})
	t.Updated = now.UnixMilli()
	return nil
}

// find matches p against the linked panes by identity: the same live pane
// counts once whether it was named by address or name.
func (t *Thing) find(p PaneRef, live Live) int {
	want := live.pane(p)
	for i, q := range t.Panes {
		if q.Side != p.Side {
			continue
		}
		if q == p || (q.Addr != "" && q.Addr == p.Addr) || (q.PaneID != "" && q.PaneID == p.PaneID) || (q.Name != "" && q.Name == p.Name) {
			return i
		}
		if want.Found && live.pane(q).id == want.id {
			return i
		}
	}
	return -1
}

// Live is one reading of both servers. HCOK / HerdrOK are false when that list
// couldn't be read; its panes then show "unknown", not "missing".
type Live struct {
	HC      []HCTerm
	Herdr   []HerdrAgent
	HCOK    bool
	HerdrOK bool
}

type HCTerm struct {
	Address string `json:"address"`
	Name    string `json:"name"`
	State   string `json:"state"`
	Status  string `json:"status"`
	Turn    int    `json:"turn"`
	Cwd     string `json:"cwd"`
	Agent   string `json:"agent"` // claude-code, pi, kimi-code, zsh, …
	// When the status last changed (hc get status_ms), unix ms; 0 unknown.
	StatusMs int64  `json:"-"`
	Msg      string `json:"-"` // what its status report says (hc get status.msg): a blocked pane's question, a done pane's result
}

type HerdrAgent struct {
	PaneID  string
	Name    string
	Status  string
	Seq     int
	Cwd     string
	Agent   string // claude, pi, …
	Session string // agent_session.value, set by the agent's Herdr hook
}

func ParseHCList(b []byte) ([]HCTerm, error) {
	var v struct {
		Terminals []HCTerm `json:"terminals"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, fmt.Errorf("hc ls: %w", err)
	}
	return v.Terminals, nil
}

func ParseHerdrList(b []byte) ([]HerdrAgent, error) {
	var v struct {
		Result struct {
			Agents []struct {
				PaneID        string `json:"pane_id"`
				Name          string `json:"name"`
				AgentStatus   string `json:"agent_status"`
				CompletionSeq *int   `json:"completion_seq"`
				StateSeq      int    `json:"state_change_seq"`
				Cwd           string `json:"cwd"`
				Agent         string `json:"agent"`
				Session       *struct {
					Value string `json:"value"`
				} `json:"agent_session"`
			} `json:"agents"`
		} `json:"result"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, fmt.Errorf("old Herdr's agent list: %w", err)
	}
	var out []HerdrAgent
	for _, a := range v.Result.Agents {
		// completion_seq moves only when a turn finishes; it is absent until the first one.
		seq := 0
		if a.CompletionSeq != nil {
			seq = *a.CompletionSeq
		}
		h := HerdrAgent{PaneID: a.PaneID, Name: a.Name, Status: a.AgentStatus, Seq: seq, Cwd: a.Cwd, Agent: a.Agent}
		if a.Session != nil {
			h.Session = a.Session.Value
		}
		out = append(out, h)
	}
	return out, nil
}

type livePane struct {
	Found    bool
	id       string
	state    string
	status   string
	counter  int
	cwd      string
	name     string
	agent    string
	msg      string
	statusMs int64
}

func (l Live) pane(p PaneRef) livePane {
	switch p.Side {
	case "hc":
		if !l.HCOK {
			return livePane{state: "unknown"}
		}
		for _, t := range l.HC {
			if t.Address == p.Addr || (t.Name != "" && t.Name == p.Addr) {
				return livePane{Found: true, id: t.Address, state: t.State, status: t.Status, counter: t.Turn, cwd: t.Cwd, name: t.Name, agent: t.Agent, msg: t.Msg, statusMs: t.StatusMs}
			}
		}
	case "herdr":
		if !l.HerdrOK {
			return livePane{state: "unknown"}
		}
		for _, a := range l.Herdr {
			if (p.PaneID != "" && a.PaneID == p.PaneID) || (p.PaneID == "" && p.Name != "" && a.Name == p.Name) {
				return livePane{Found: true, id: a.PaneID, state: "live", status: a.Status, counter: a.Seq, cwd: a.Cwd, name: a.Name}
			}
		}
	}
	return livePane{state: "missing"}
}

// Exists says whether p names a live or finished pane in live.
func Exists(p PaneRef, live Live) bool { return live.pane(p).Found }

// Canonical is p as stored: hc by address plus name, old Herdr by pane id plus name.
func Canonical(p PaneRef, live Live) PaneRef {
	lp := live.pane(p)
	if !lp.Found {
		return p
	}
	if p.Side == "hc" {
		return PaneRef{Side: "hc", Addr: lp.id, Name: lp.name}
	}
	return PaneRef{Side: "herdr", PaneID: lp.id, Name: lp.name}
}

// PaneRow is a pane's computed state under a thing.
type PaneRow struct {
	Ref        PaneRef `json:"ref"`
	ID         string  `json:"id,omitempty"` // hc address or herdr pane id it resolved to
	Found      bool    `json:"found"`
	State      string  `json:"state"` // live, finished, missing, unknown
	Status     string  `json:"status,omitempty"`
	Cwd        string  `json:"cwd,omitempty"`
	Name       string  `json:"name,omitempty"` // the live pane's name
	TurnsSince int     `json:"turns_since"`    // hc only: turns since the last hand-off
	Moved      bool    `json:"moved"`          // its turn or counter changed since the hand-off
	Quiet      bool    `json:"quiet"`          // no new turn for longer than the threshold after a hand-off
	QuietForMs int64   `json:"quiet_for_ms,omitempty"`
	HandedOn   bool    `json:"handed_on,omitempty"` // the pane was given another task after this one
	NoStatus   bool    `json:"no_status,omitempty"` // an agent that has reported no status since the hand-off
	Msg        string  `json:"msg,omitempty"`       // what a blocked pane asks, for the phone to word in its language
}

type Row struct {
	Thing
	Group string    `json:"group"`
	Panes []PaneRow `json:"pane_rows"`
	Flags []string  `json:"flags,omitempty"`
	Said  string    `json:"said,omitempty"` // what the agent said last about this task, in its own words
}

// Status works out every thing's group and its panes' state. quietAfter is how
// long after a hand-off a pane may go without a new turn before it is flagged.
func Status(f File, live Live, now time.Time, quietAfter time.Duration) []Row {
	var rows []Row
	for _, t := range f.Things {
		r := Row{Thing: t, Group: t.Stage}
		active := t.Stage == Doing || t.Stage == WaitingOnYou || t.Stage == Review
		anyLive, blocked, stuck := false, false, false
		var saidAt int64 = -1
		for _, p := range t.Panes {
			lp := live.pane(p)
			pr := PaneRow{Ref: p, ID: lp.id, Found: lp.Found, State: lp.state, Status: lp.status, Cwd: lp.cwd, Name: lp.name}
			// A later hand-off to the same pane ends this task's window: turns
			// after it, and the pane's state now, belong to the later task.
			later := laterHandOff(f, live, p)
			pr.HandedOn = later != nil
			if lp.Found && p.TurnAt != nil {
				counter := lp.counter
				if later != nil && later.TurnAt != nil && *later.TurnAt < counter {
					counter = *later.TurnAt
				}
				if p.Side == "hc" {
					pr.TurnsSince = counter - *p.TurnAt
				}
				pr.Moved = counter != *p.TurnAt
				age := now.Sub(time.UnixMilli(p.At))
				if !pr.HandedOn && !pr.Moved && lp.status != "working" && lp.state == "live" && p.At > 0 && age > quietAfter {
					pr.Quiet, pr.QuietForMs = true, age.Milliseconds()
				}
			}
			// An agent that never reported a status is usually on a trust
			// dialog or a login screen, which only the user can get past.
			if !pr.HandedOn && p.Side == "hc" && lp.state == "live" && lp.status == "" && isAgent(lp.agent) && p.At > 0 && now.Sub(time.UnixMilli(p.At)) > noStatusAfter {
				pr.NoStatus = true
			}
			name := paneName(p, lp)
			switch {
			case pr.HandedOn:
			case lp.state == "live" && lp.status == "blocked":
				blocked = true
				if lp.msg != "" {
					pr.Msg = clip(lp.msg, 120)
					r.Flags = append(r.Flags, name+" asks: "+pr.Msg)
				} else {
					r.Flags = append(r.Flags, name+" blocked")
				}
			case lp.state == "live" && lp.status == "error":
				stuck = true
				r.Flags = append(r.Flags, name+" error")
			case pr.Quiet:
				stuck = true
				r.Flags = append(r.Flags, fmt.Sprintf("%s: no new turn %s after the hand-off", name, short(time.Duration(pr.QuietForMs)*time.Millisecond)))
			case pr.NoStatus:
				stuck = true
				r.Flags = append(r.Flags, name+": no status a minute after the hand-off; it may be on a trust or login screen")
			case lp.state == "missing":
				r.Flags = append(r.Flags, name+" not found")
			}
			if lp.state == "live" || lp.state == "unknown" || pr.HandedOn {
				anyLive = true
			}
			// What the agent said last about this task: the pane's report now
			// while the pane is still on it, else what it said when it moved on.
			// A pane stopping is not the task done; the task stays where it is.
			said := p.Said
			// The watcher records a hand-off after the turn started, so the turn
			// counter may not move when that turn ends: a status that changed
			// after the hand-off counts too.
			if !pr.HandedOn && lp.state == "live" && lp.status != "blocked" && (pr.Moved || lp.statusMs > p.At) {
				said = lp.msg
			}
			if said != "" && p.At > saidAt {
				r.Said, saidAt = clip(said, 2000), p.At
			}
			r.Panes = append(r.Panes, pr)
		}
		if active {
			switch {
			case t.Stage == WaitingOnYou || blocked:
				r.Group = WaitingOnYou
			case stuck || (t.Stage == Doing && len(t.Panes) > 0 && !anyLive):
				r.Group = Stuck
			}
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool { return stages[rows[i].Group] < stages[rows[j].Group] })
	return rows
}

const noStatusAfter = time.Minute

// clip keeps the first n characters of s.
func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

var shells = map[string]bool{"sh": true, "bash": true, "zsh": true, "fish": true, "nu": true, "dash": true, "ksh": true, "tcsh": true, "pwsh": true}

// isAgent says whether hc's "agent" field names a program that reports status
// (claude-code, pi, kimi-code, …): not a shell, not unknown.
func isAgent(a string) bool { return a != "" && !shells[a] }

func paneKey(p PaneRef, live Live) string {
	if lp := live.pane(p); lp.Found {
		return p.Side + ":" + lp.id
	}
	return p.String()
}

// laterHandOff is the first hand-off, in any thing, to the same pane after p's.
func laterHandOff(f File, live Live, p PaneRef) *PaneRef {
	if p.At == 0 {
		return nil
	}
	key := paneKey(p, live)
	var best *PaneRef
	consider := func(q PaneRef) {
		if q.At > p.At && (best == nil || q.At < best.At) && paneKey(q, live) == key {
			best = &q
		}
	}
	for _, t := range f.Things {
		for _, q := range t.Panes {
			consider(q)
		}
	}
	// A message waiting for the filing pane started a turn in the pane; a
	// scanned session or a stop waiting there did not.
	for _, c := range f.Queue {
		if c.Kind == "" {
			consider(c.Pane)
		}
	}
	return best
}

func paneName(p PaneRef, lp livePane) string {
	switch {
	case p.Side == "hc":
		return p.Addr
	case p.Name != "":
		return p.Name
	default:
		return p.PaneID
	}
}

func short(d time.Duration) string {
	switch {
	case d >= time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
}

func ago(now time.Time, at int64) string {
	if at == 0 {
		return ""
	}
	return short(now.Sub(time.UnixMilli(at))) + " ago"
}

// Board is the text view: one block per group, most urgent first.
func Board(rows []Row, now time.Time) string {
	var b strings.Builder
	group := ""
	for _, r := range rows {
		if r.Group != group {
			group = r.Group
			fmt.Fprintf(&b, "%s\n", group)
		}
		fmt.Fprintf(&b, "  %s  %s", r.ID, r.Outcome)
		if r.Waiting != "" {
			fmt.Fprintf(&b, "  — asks: %s", r.Waiting)
		}
		if r.Next != "" {
			fmt.Fprintf(&b, "  — next: %s", r.Next)
		}
		if a := ago(now, r.Updated); a != "" {
			fmt.Fprintf(&b, "  (updated %s)", a)
		}
		b.WriteString("\n")
		for _, p := range r.Panes {
			word := p.State
			if p.State == "live" && p.Status != "" {
				word = p.Status
			}
			fmt.Fprintf(&b, "      %s %s: %s", p.Ref.Side, labelOf(p), word)
			if p.Ref.TurnAt != nil {
				if p.Ref.Side == "hc" {
					fmt.Fprintf(&b, ", %d turns since the hand-off", p.TurnsSince)
				} else if p.Moved {
					b.WriteString(", moved since the hand-off")
				} else {
					b.WriteString(", nothing since the hand-off")
				}
			}
			b.WriteString("\n")
		}
		for _, fl := range r.Flags {
			fmt.Fprintf(&b, "      ! %s\n", fl)
		}
	}
	return b.String()
}

// labelOf names a pane by its id and live name, e.g. "t2 api" or "w1:p1 web".
func labelOf(p PaneRow) string {
	id, name := p.ID, p.Name
	if id == "" {
		id = p.Ref.Addr + p.Ref.PaneID
	}
	if name == "" {
		name = p.Ref.Name
	}
	if name != "" && name != id {
		return id + " " + name
	}
	return id
}

// Store is track.json plus its lock file beside it. Every change takes an
// exclusive flock, re-reads the file and replaces it with a temp file + rename,
// so separate processes (the filing pane, other agents, the user) don't lose writes.
type Store struct{ path string }

func Open(path string) *Store { return &Store{path: path} }

func (s *Store) Load() (File, error) {
	var f File
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return f, err
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return f, fmt.Errorf("%s: %w", s.path, err)
	}
	f.migrate()
	return f, nil
}

func (s *Store) Update(change func(*File) error) error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	lock, err := os.OpenFile(s.path+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := lockFile(lock); err != nil {
		return err
	}
	defer unlockFile(lock)
	f, err := s.Load()
	if err != nil {
		return err
	}
	if err := change(&f); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".track-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path)
}
