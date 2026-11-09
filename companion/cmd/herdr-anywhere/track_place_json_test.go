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

// Things from several panes that serve one bigger outcome go under one goal,
// made in the same answer: "goals" names it with a key that any under in the
// answer may use. A goal nobody puts anything under is not made.
func TestOneAnswerPutsTasksFromSeveralPanesUnderANewGoal(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "track.json")
	os.WriteFile(file, []byte(`{"version": 2, "scan_answer": "yes",
 "things": [{"id": "T1", "outcome": "Acme shop", "stage": "doing"}],
 "queue": [{"id": "Q1", "kind": "session", "text": "- User: write the 2.0 release notes", "pane": {"side": "hc", "addr": "v1"}, "at": 1001},
           {"id": "Q2", "kind": "session", "text": "- User: fix the login bug before 2.0", "pane": {"side": "hc", "addr": "v2"}, "at": 1002},
           {"id": "Q3", "text": "and tag 2.0", "pane": {"side": "hc", "addr": "a1", "at": 1003}, "at": 1003}]}`), 0o600)
	hc, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}
	answer := filepath.Join(dir, "answer.json")
	os.WriteFile(answer, []byte(`{"goals": [{"key": "G1", "title": "Release 2.0", "under": "T1"}, {"key": "G2", "title": "Nothing here"}],
 "places": [
 {"id": "Q1", "tasks": [{"title": "Write the 2.0 release notes", "under": "G1"}]},
 {"id": "Q2", "tasks": [{"title": "Fix the login bug", "under": "G1", "stage": "done"}]},
 {"id": "Q3", "task": "new", "title": "Tag 2.0", "under": "G1"}]}`), 0o600)
	if out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", answer)...)...); code != 0 || !strings.Contains(out, "placed 3 of 3") {
		t.Fatalf("%d %s %s", code, out, e)
	}
	f := loadTrack(t, file)
	goal := ""
	under := map[string]string{}
	for _, th := range f.Things {
		under[th.Outcome] = th.Parent
		if th.Outcome == "Release 2.0" {
			goal = th.ID
		}
	}
	if goal == "" || under["Release 2.0"] != "T1" {
		t.Fatalf("no goal under T1: %+v", f.Things)
	}
	for _, title := range []string{"Write the 2.0 release notes", "Fix the login bug", "Tag 2.0"} {
		if under[title] != goal {
			t.Errorf("%q is under %q, want the goal %s", title, under[title], goal)
		}
	}
	if _, made := under["Nothing here"]; made {
		t.Error("made a goal with nothing under it")
	}

	// A key that names no goal, or one that is a task's id, is named, not guessed.
	os.WriteFile(file, []byte(`{"version": 2, "things": [{"id": "T1", "outcome": "Acme shop", "stage": "doing"}],
 "queue": [{"id": "Q1", "kind": "session", "text": "- User: x", "pane": {"side": "hc", "addr": "v1"}, "at": 1001}]}`), 0o600)
	os.WriteFile(answer, []byte(`{"goals": [{"key": "T1", "title": "Clash"}], "places": [{"id": "Q1", "tasks": [{"title": "X", "under": "G7"}]}]}`), 0o600)
	out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", answer)...)...)
	if code == 0 || !strings.Contains(out+e, "T1") || !strings.Contains(out+e, "G7") {
		t.Fatalf("bad keys: %d %s %s", code, out, e)
	}
}

// A scanned task whose agent asks the user something waits on the user, with
// the question; a task already in the tree that the session shows finished
// takes the stage the filing pane saw.
func TestAScannedTaskCanWaitOnTheUserOrFinishAnOldOne(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "track.json")
	os.WriteFile(file, []byte(`{"version": 2,
 "things": [{"id": "T1", "outcome": "Release 2.1", "stage": "doing"}],
 "queue": [{"id": "Q1", "kind": "session", "text": "- User: release 2.1\n  Agent: 2.1 is out.\n- User: update the CHANGELOG\n  Agent: Shall I write it now?", "pane": {"side": "hc", "addr": "v1"}, "at": 1001}]}`), 0o600)
	hc, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}
	answer := filepath.Join(dir, "answer.json")
	os.WriteFile(answer, []byte(`{"places": [{"id": "Q1", "tasks": [{"task": "T1", "stage": "done"}, {"title": "Update the CHANGELOG", "stage": "waiting", "waiting": "Write the CHANGELOG now?"}]}]}`), 0o600)
	if out, e, code := runTrack(t, append([]string{"place"}, append(common, "--batch", answer)...)...); code != 0 {
		t.Fatalf("%d %s %s", code, out, e)
	}
	got := map[string]string{}
	for _, th := range loadTrack(t, file).Things {
		got[th.Outcome] = th.Stage + "/" + th.Waiting
	}
	if got["Release 2.1"] != "done/" || got["Update the CHANGELOG"] != "waiting/Write the CHANGELOG now?" {
		t.Fatalf("stages: %v", got)
	}
}
