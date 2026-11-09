// Package watch notices what the user types straight into Claude Code panes
// in herdr-core and hands each message to an organizer. It reads only: hc's
// terminal list, ~/.claude/sessions/<pid>.json and the session's .jsonl; it
// writes only its own state file.
//
// herdr-core forgets a terminal once it is removed, so the watcher keeps the
// terminal → session link itself, also after the terminal closes.
package watch

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Term is one herdr-core terminal: hc ls plus the foreground pid from hc get.
type Term struct {
	Address string
	Agent   string
	State   string
	Turn    int
	PID     int
}

// Link is what the watcher remembers about a terminal, also after it closes.
type Link struct {
	Address   string `json:"address"`
	PID       int    `json:"pid"`
	SessionID string `json:"session_id"`
	Path      string `json:"path"`
	Offset    int64  `json:"offset"`
	Turn      int    `json:"turn"`
	Tail      Tail   `json:"tail"`
}

// Msg is one message a person typed, with how the pane's turn before it ended
// ("done", "interrupted", or "" unknown) and what the agent said then.
type Msg struct {
	Text      string
	PrevEnded string
	AgentSaid string
}

// Tail is how the transcript read so far ends: the last turn's ending and
// the agent's last words in it.
type Tail struct {
	Ended string `json:"ended,omitempty"`
	Said  string `json:"said,omitempty"`
}

type Watcher struct {
	Home  string                         // where .claude lives
	State string                         // the watcher's own file
	List  func() ([]Term, error)         // herdr-core's terminals
	File  func(addr string, m Msg) error // the organizer
}

func jsonName(pid int) string { return strconv.Itoa(pid) + ".json" }

// entry is the part of a Claude Code transcript line the watcher reads.
type entry struct {
	Type   string `json:"type"`
	Origin *struct {
		Kind string `json:"kind"`
	} `json:"origin"`
	PromptSource     string          `json:"promptSource"`
	IsMeta           bool            `json:"isMeta"`
	IsCompactSummary bool            `json:"isCompactSummary"`
	IsSidechain      bool            `json:"isSidechain"`
	Message          json.RawMessage `json:"message"`
}

// typed returns the text of a message a person typed (or queued while the
// agent worked), and false for everything else: tool results, notes,
// summaries, notifications, and text handed over through hc send.
func typed(b []byte) (string, bool) {
	var e entry
	if json.Unmarshal(b, &e) != nil || e.Type != "user" || e.IsMeta || e.IsCompactSummary {
		return "", false
	}
	if e.Origin == nil || e.Origin.Kind != "human" || (e.PromptSource != "typed" && e.PromptSource != "queued") {
		return "", false
	}
	var m struct {
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(e.Message, &m) != nil {
		return "", false
	}
	var text string
	if json.Unmarshal(m.Content, &text) != nil {
		var parts []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(m.Content, &parts) != nil {
			return "", false
		}
		var ts []string
		for _, p := range parts {
			if p.Type == "text" {
				ts = append(ts, p.Text)
			}
		}
		text = strings.Join(ts, "\n")
	}
	text = strings.TrimSpace(text)
	if text == "" || strings.HasPrefix(text, "<hc ") {
		return "", false
	}
	return text, true
}

// ReadNew returns the typed messages after offset, each with how the turn
// before it ended, the offset after the last complete line, and the tail to
// pass to the next read. A line still being written is left for the next read.
func ReadNew(path string, offset int64, tail Tail) ([]Msg, int64, Tail, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, offset, tail, err
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return nil, offset, tail, err
	}
	r := bufio.NewReaderSize(f, 1<<16)
	var out []Msg
	for {
		b, err := r.ReadBytes('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				return out, offset, tail, nil
			}
			return out, offset, tail, err
		}
		offset += int64(len(b))
		b = bytes.TrimSpace(b)
		if t, ok := typed(b); ok {
			out = append(out, Msg{Text: t, PrevEnded: tail.Ended, AgentSaid: tail.Said})
			tail = Tail{}
			continue
		}
		tail = step(b, tail)
	}
}

// step moves the tail past one line that isn't a typed message: an assistant
// reply that ends its turn, or an interrupt.
func step(b []byte, tail Tail) Tail {
	var e entry
	if json.Unmarshal(b, &e) != nil || e.IsSidechain {
		return tail
	}
	var m struct {
		Content    json.RawMessage `json:"content"`
		StopReason string          `json:"stop_reason"`
	}
	if json.Unmarshal(e.Message, &m) != nil {
		return tail
	}
	text := contentText(m.Content)
	switch {
	case e.Type == "user" && strings.HasPrefix(text, "[Request interrupted by user"):
		return Tail{Ended: "interrupted"}
	case e.Type == "assistant" && m.StopReason == "end_turn":
		if text == "" {
			text = tail.Said
		}
		return Tail{Ended: "done", Said: text}
	}
	return tail
}

func contentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return strings.TrimSpace(text)
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var ts []string
	for _, p := range parts {
		if p.Type == "text" {
			ts = append(ts, p.Text)
		}
	}
	return strings.TrimSpace(strings.Join(ts, "\n"))
}

// A Turn is one message the person typed and how the agent answered it: its
// last words before the person typed again ("" while it is still at it).
type Turn struct {
	Typed string
	Reply string
}

// ReadSession reads a whole transcript as the person's messages, in order,
// each with the agent's answer to it.
func ReadSession(path string) ([]Turn, error) {
	msgs, _, tail, err := ReadNew(path, 0, Tail{})
	turns := make([]Turn, len(msgs))
	for i, m := range msgs {
		turns[i].Typed = m.Text
		if i+1 < len(msgs) {
			turns[i].Reply = msgs[i+1].AgentSaid
		} else {
			turns[i].Reply = tail.Said
		}
	}
	return turns, err
}

// Current is each live Claude Code terminal's session transcript right now.
func (w *Watcher) Current() (map[string]string, error) {
	terms, err := w.List()
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, t := range terms {
		if t.State != "live" || t.Agent != "claude-code" || t.PID == 0 {
			continue
		}
		if _, path, ok := w.session(t.PID); ok && path != "" {
			out[t.Address] = path
		}
	}
	return out, nil
}

// session finds the transcript of the Claude Code process pid.
func (w *Watcher) session(pid int) (sid, path string, ok bool) {
	b, err := os.ReadFile(filepath.Join(w.Home, ".claude", "sessions", jsonName(pid)))
	if err != nil {
		return "", "", false
	}
	var s struct {
		SessionID string `json:"sessionId"`
	}
	if json.Unmarshal(b, &s) != nil || s.SessionID == "" || strings.ContainsAny(s.SessionID, `/\`) {
		return "", "", false
	}
	m, _ := filepath.Glob(filepath.Join(w.Home, ".claude", "projects", "*", s.SessionID+".jsonl"))
	if len(m) == 0 {
		return s.SessionID, "", true // the file appears with the first message
	}
	return s.SessionID, m[0], true
}

func size(p string) int64 {
	if fi, err := os.Stat(p); err == nil {
		return fi.Size()
	}
	return 0
}

func LoadLinks(path string) (map[string]Link, error) {
	links := map[string]Link{}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return links, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, &links); err != nil {
		return nil, err
	}
	return links, nil
}

func saveLinks(path string, links map[string]Link) error {
	b, err := json.MarshalIndent(links, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Tick reads the terminal list once, files what was typed since last time and
// saves where it stopped. A terminal seen for the first time starts at the end
// of its transcript: history is not filed. A new session in a known terminal
// (after /clear) is read from its start.
func (w *Watcher) Tick() error {
	terms, err := w.List()
	if err != nil {
		return err
	}
	links, err := LoadLinks(w.State)
	if err != nil {
		return err
	}
	var firstErr error
	for _, t := range terms {
		if t.State != "live" || t.Agent != "claude-code" || t.PID == 0 {
			continue
		}
		sid, path, ok := w.session(t.PID)
		if !ok {
			continue
		}
		l, known := links[t.Address]
		switch {
		case !known || l.PID != t.PID:
			l = Link{Address: t.Address, PID: t.PID, SessionID: sid, Path: path, Offset: size(path), Turn: t.Turn}
		case l.SessionID != sid || l.Path != path:
			l.SessionID, l.Path, l.Offset, l.Tail = sid, path, 0, Tail{}
		}
		if l.Path != "" && size(l.Path) > l.Offset {
			msgs, off, tail, err := ReadNew(l.Path, l.Offset, l.Tail)
			l.Tail = tail
			for _, m := range msgs {
				if err := w.File(t.Address, m); err != nil && firstErr == nil {
					firstErr = err
				}
			}
			l.Offset = off
			if err != nil && firstErr == nil {
				firstErr = err
			}
		}
		l.Turn = t.Turn
		links[t.Address] = l
	}
	if err := saveLinks(w.State, links); err != nil {
		return err
	}
	return firstErr
}
