package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"herdr-anywhere/companion/internal/track"
)

// trackStdin is where place --batch - reads; tests swap it.
var trackStdin = func() *os.File { return os.Stdin }

// batchPlace is one item of the filing pane's answer. A stop takes stage (and
// waiting); a message takes task (an id, new or none) with title and under for a
// new one; a scanned session takes tasks, one per thing in it, empty for none.
type batchPlace struct {
	ID      string       `json:"id"`
	Task    string       `json:"task,omitempty"`
	Also    []string     `json:"also,omitempty"`
	Under   string       `json:"under,omitempty"`
	Title   string       `json:"title,omitempty"`
	Stage   string       `json:"stage,omitempty"`
	Waiting string       `json:"waiting,omitempty"`
	Why     string       `json:"why,omitempty"`
	Tasks   *[]batchTask `json:"tasks,omitempty"`
}

type batchTask struct {
	Task  string `json:"task,omitempty"` // an existing task the session worked on; "" or new for a new one
	Title string `json:"title,omitempty"`
	Under string `json:"under,omitempty"`
	Stage string `json:"stage,omitempty"`
}

// placeBatch places every item of one answer on its own, and names each one it
// could not place, and each one still queued that the answer left out, so the
// filing pane can fix them in one more answer.
func placeBatch(st *track.Store, from string, live track.Live, now time.Time, stdout io.Writer) error {
	var b []byte
	var err error
	if from == "-" {
		b, err = io.ReadAll(trackStdin())
	} else {
		b, err = os.ReadFile(from)
	}
	if err != nil {
		return err
	}
	var doc struct {
		Places []batchPlace `json:"places"`
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return fmt.Errorf(`the answer is not {"places": [...]} as the rules show: %v`, err)
	}
	var problems []string
	placed := 0
	err = st.Update(func(f *track.File) error {
		queued := map[string]bool{}
		for _, q := range f.Queue {
			queued[q.ID] = true
		}
		for _, p := range doc.Places {
			if !queued[p.ID] {
				problems = append(problems, fmt.Sprintf("%s: not in the queue (placed already, or no such item)", p.ID))
				continue
			}
			if err := placeOne(f, p, live, now); err != nil {
				problems = append(problems, fmt.Sprintf("%s: %v", p.ID, err))
				continue
			}
			placed++
		}
		var left []string
		for _, q := range f.Queue {
			left = append(left, q.ID)
		}
		fmt.Fprintf(stdout, "placed %d of %d\n", placed, len(doc.Places))
		for _, p := range problems {
			fmt.Fprintln(stdout, p)
		}
		if len(left) > 0 {
			fmt.Fprintf(stdout, "not placed yet: %s\n", strings.Join(left, ", "))
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(problems) > 0 {
		return errReported
	}
	return nil
}

func placeOne(f *track.File, p batchPlace, live track.Live, now time.Time) error {
	if p.Tasks == nil {
		_, err := f.Place(p.ID, track.Decision{Task: p.Task, Also: p.Also, Under: p.Under, Title: p.Title, Stage: p.Stage, Waiting: p.Waiting, Why: p.Why, By: "organizer"}, live, now)
		return err
	}
	ts := *p.Tasks
	if len(ts) == 0 {
		_, err := f.Place(p.ID, track.Decision{Task: "none", By: "organizer"}, live, now)
		return err
	}
	for i, t := range ts {
		task := t.Task
		if task == "" {
			task = "new"
		}
		if task == "new" && strings.TrimSpace(t.Title) == "" {
			return errors.New("a new task needs a title")
		}
		d := track.Decision{Task: task, Under: t.Under, Title: t.Title, Stage: t.Stage, More: i < len(ts)-1, By: "organizer"}
		if _, err := f.Place(p.ID, d, live, now); err != nil {
			return err
		}
	}
	return nil
}
