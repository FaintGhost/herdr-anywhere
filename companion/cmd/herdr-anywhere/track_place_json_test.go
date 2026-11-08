package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"herdr-anywhere/companion/internal/track"
)

// The filing pane answers a whole batch in one go: one JSON document, read from a
// file or from stdin (a quoted heredoc, so the shell leaves "$29" alone). Each
// item is placed on its own; the ones it can't place are named with the reason,
// and so are the ones it left out, so one more answer fixes them.
func TestTrackPlaceTakesTheWholeBatchAsJSON(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "track.json")
	os.WriteFile(file, []byte(`{"version": 2, "scan_answer": "yes",
 "things": [{"id": "P1", "outcome": "Launch 1.0", "stage": "doing"},
            {"id": "T1", "outcome": "Fix the cart", "stage": "doing", "parent": "P1", "panes": [{"side": "hc", "addr": "a1", "at": 1}]},
            {"id": "S-s1", "outcome": "Price list", "stage": "doing", "parent": "P1", "panes": [{"side": "hc", "addr": "s1", "at": 1}]}],
 "queue": [{"id": "Q1", "kind": "stop", "task": "S-s1", "text": "Is the price in entry 3 really $29?", "pane": {"side": "hc", "addr": "s1", "at": 1}, "at": 1001},
           {"id": "Q2", "kind": "session", "text": "- add a cart limit\n- and the CHANGELOG", "pane": {"side": "hc", "addr": "v1"}, "at": 1002},
           {"id": "Q3", "text": "also test it", "pane": {"side": "hc", "addr": "a1", "at": 1003}, "at": 1003},
           {"id": "Q4", "kind": "session", "text": "- hi", "pane": {"side": "hc", "addr": "v2"}, "at": 1004},
           {"id": "Q5", "text": "and the FAQ", "pane": {"side": "hc", "addr": "a1", "at": 1005}, "at": 1005}]}`), 0o600)
	hc, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}

	answer := filepath.Join(dir, "answer.json")
	os.WriteFile(answer, []byte(`{"places": [
 {"id": "Q1", "stage": "waiting", "waiting": "Is the price in entry 3 really $29?"},
 {"id": "Q2", "tasks": [{"title": "Cart limit", "under": "P1", "stage": "done"}, {"title": "Update the CHANGELOG", "under": "P1"}]},
 {"id": "Q3", "task": "T1"},
 {"id": "Q4", "task": "T99"},
 {"id": "Q9", "task": "T1"}]}`), 0o600)
	out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", answer)...)...)
	if code == 0 {
		t.Fatalf("an answer with errors passed: %s %s", out, e)
	}
	all := out + e
	for _, want := range []string{"Q4: ", "T99", "Q9: ", "not in the queue", "not placed yet: Q4, Q5", "placed 3 of 5"} {
		if !strings.Contains(all, want) {
			t.Errorf("output lacks %q:\n%s", want, all)
		}
	}
	f := loadTrack(t, file)
	if len(f.Queue) != 2 || f.Queue[0].ID != "Q4" || f.Queue[1].ID != "Q5" {
		t.Fatalf("queue: %+v", f.Queue)
	}
	var s1 *track.Thing
	var titles []string
	for i := range f.Things {
		if f.Things[i].ID == "S-s1" {
			s1 = &f.Things[i]
		}
		titles = append(titles, f.Things[i].Outcome+"/"+f.Things[i].Stage)
	}
	if s1 == nil || s1.Stage != "waiting" || s1.Waiting != "Is the price in entry 3 really $29?" {
		t.Fatalf("the stop: %+v", s1)
	}
	if j := strings.Join(titles, " "); !strings.Contains(j, "Cart limit/done") || !strings.Contains(j, "Update the CHANGELOG/doing") {
		t.Fatalf("the session's tasks: %s", j)
	}

	// The rest, from stdin: a session or small talk with nothing in it is an empty list.
	defer func(r func() *os.File) { trackStdin = r }(trackStdin)
	r, w, _ := os.Pipe()
	trackStdin = func() *os.File { return r }
	w.WriteString(`{"places": [{"id": "Q4", "tasks": []}, {"id": "Q5", "task": "new", "title": "Add the FAQ", "under": "P1"}]}`)
	w.Close()
	if out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", "-")...)...); code != 0 || !strings.Contains(out, "placed 2 of 2") {
		t.Fatalf("%d %s %s", code, out, e)
	}
	if f := loadTrack(t, file); len(f.Queue) != 0 {
		t.Fatalf("queue left: %+v", f.Queue)
	}

	// A misspelt field is named, not dropped.
	os.WriteFile(answer, []byte(`{"places": [{"id": "Q1", "stag": "done"}]}`), 0o600)
	if out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", answer)...)...); code == 0 || !strings.Contains(out+e, "stag") {
		t.Fatalf("a misspelt field: %d %s %s", code, out, e)
	}
}

func loadTrack(t *testing.T, file string) track.File {
	t.Helper()
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var f track.File
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}
