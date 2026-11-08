package main

import (
	"bytes"
	"encoding/json"
	"herdr-anywhere/companion/internal/testfake"
	"herdr-anywhere/companion/internal/track"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeLists writes an hc that prints hcJSON for `ls` and a herdr that prints
// herdrJSON for `agent list`, both in the real tools' field layout.
func fakeLists(t *testing.T, hcJSON, herdrJSON string) (hc, herdr string) {
	t.Helper()
	d := t.TempDir()
	os.WriteFile(filepath.Join(d, "ls.json"), []byte(hcJSON), 0o600)
	os.WriteFile(filepath.Join(d, "agents.json"), []byte(herdrJSON), 0o600)
	hc = testfake.HC(t, d, "hc", testfake.Spec{Version: "hc 0.1.18", On: map[string][]testfake.Reply{"ls": {{Cat: filepath.Join(d, "ls.json")}}}, Else: 1})
	herdr = testfake.HC(t, d, "herdr", testfake.Spec{On: map[string][]testfake.Reply{"agent": {{Cat: filepath.Join(d, "agents.json")}}}, Else: 1})
	return hc, herdr
}

func runTrack(t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	var out, errb bytes.Buffer
	code := run(append([]string{"track"}, args...), &out, &errb)
	return out.String(), errb.String(), code
}

// handedTo links pane to task id and records a hand-off there, as the filing
// pane's place does, for tests that start from a pane already on a task.
func handedTo(t *testing.T, common []string, id, pane, text string) {
	t.Helper()
	flag := func(name string) string {
		for i := 0; i+1 < len(common); i++ {
			if common[i] == name {
				return common[i+1]
			}
		}
		return ""
	}
	ref, err := parsePaneRef(pane)
	if err != nil {
		t.Fatal(err)
	}
	live := readLive(flag("--hc"), flag("--herdr"))
	if !track.Exists(ref, live) {
		t.Fatalf("no live pane %s", pane)
	}
	if err := track.Open(flag("--file")).Update(func(f *track.File) error {
		th, err := f.Get(id)
		if err != nil {
			return err
		}
		return th.Mark(track.Canonical(ref, live), live, time.Now(), text)
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTrackAddSentStatus(t *testing.T) {
	file := filepath.Join(t.TempDir(), "track.json")
	hc, herdr := fakeLists(t,
		`{"terminals":[{"address":"t2","name":"api","state":"live","status":"idle","turn":3,"cwd":"/tmp/p/acme-api"}]}`,
		`{"result":{"agents":[{"agent_status":"idle","name":"web","pane_id":"w1:p1","state_change_seq":4,"completion_seq":2}]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}

	if _, e, c := runTrack(t, append([]string{"add"}, append(common, "A1", "total_items counts items")...)...); c != 0 {
		t.Fatalf("add: %d %s", c, e)
	}
	handedTo(t, common, "A1", "hc:api", "fix total_items")
	if _, e, c := runTrack(t, append([]string{"add"}, append(common, "--stage", "waiting", "--waiting", "push?", "A7", "push web")...)...); c != 0 {
		t.Fatalf("add A7: %d %s", c, e)
	}
	handedTo(t, common, "A7", "herdr:web", "commit the footer")

	b, _ := os.ReadFile(file)
	var f struct {
		Things []struct {
			ID    string
			Panes []struct {
				Side   string
				Addr   string
				PaneID string `json:"pane_id"`
				TurnAt *int   `json:"turn_at"`
			}
		}
	}
	if err := json.Unmarshal(b, &f); err != nil || len(f.Things) != 2 {
		t.Fatalf("file: %s %v", b, err)
	}
	if p := f.Things[0].Panes; len(p) != 1 || p[0].TurnAt == nil || *p[0].TurnAt != 3 {
		t.Fatalf("A1 panes: %s", b)
	}
	if p := f.Things[1].Panes; len(p) != 1 || p[0].PaneID != "w1:p1" || *p[0].TurnAt != 2 {
		t.Fatalf("herdr pane is stored by pane id, with its counter: %s", b)
	}

	out, e, c := runTrack(t, append([]string{"status"}, common...)...)
	if c != 0 || !strings.Contains(out, "waiting") || !strings.Contains(out, "A1") || !strings.Contains(out, "t2 api") {
		t.Fatalf("status: %d %s\n%s", c, e, out)
	}
	js, _, c := runTrack(t, append([]string{"status", "--json"}, common...)...)
	var rows []map[string]any
	if c != 0 || json.Unmarshal([]byte(js), &rows) != nil || len(rows) != 2 || rows[0]["group"] != "waiting" {
		t.Fatalf("status --json: %d %s", c, js)
	}
}

func TestTrackSetStage(t *testing.T) {
	file := filepath.Join(t.TempDir(), "track.json")
	hc, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}
	runTrack(t, append([]string{"add"}, append(common, "A1", "x")...)...)
	if _, e, c := runTrack(t, append([]string{"set"}, append(common, "--stage", "review", "--evidence", "abc123", "A1")...)...); c != 0 {
		t.Fatalf("set: %d %s", c, e)
	}
	if _, _, c := runTrack(t, append([]string{"set"}, append(common, "--stage", "完成了", "A1")...)...); c == 0 {
		t.Fatal("unknown stage accepted")
	}
	out, _, _ := runTrack(t, append([]string{"status"}, common...)...)
	if !strings.Contains(out, "review") {
		t.Fatalf("status:\n%s", out)
	}
}

// report must ask the same hc that --hc names, never whatever hc is on PATH:
// on PATH it may be the user's own core.
func TestTrackReportUsesTheGivenHc(t *testing.T) {
	file := filepath.Join(t.TempDir(), "track.json")
	_, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	// The fake hc answers get with a status only it knows.
	hc := testfake.HC(t, t.TempDir(), "hc", testfake.Spec{Version: "hc 0.1.18", On: map[string][]testfake.Reply{
		"ls":  {{Print: `{"terminals":[{"address":"t2","name":"api","state":"live","status":"done","turn":1,"cwd":"/nonexistent"}]}`}},
		"get": {{Print: `{"foreground":{"pid":1},"status":{"app":"fake-app","msg":"from the given hc"}}`}},
	}})
	t.Setenv("PATH", "/usr/bin:/bin") // no other hc to fall back to
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}
	if _, e, c := runTrack(t, append([]string{"add"}, append(common, "A1", "x")...)...); c != 0 {
		t.Fatalf("add: %s", e)
	}
	handedTo(t, common, "A1", "hc:api", "x")
	out, e, c := runTrack(t, append([]string{"report"}, common...)...)
	if c != 0 || !strings.Contains(out, "fake-app") || !strings.Contains(out, "from the given hc") {
		t.Fatalf("report: %d %s\n%q", c, e, out)
	}
}

// An agent may write `track set A2 --stage 做完待验收`: flags after the id must work too.
func TestTrackFlagsAfterArguments(t *testing.T) {
	file := filepath.Join(t.TempDir(), "track.json")
	hc, herdr := fakeLists(t, `{"terminals":[]}`, `{"result":{"agents":[]}}`)
	common := []string{"--file", file, "--hc", hc, "--herdr", herdr}
	if _, e, c := runTrack(t, append([]string{"add", "A1", "x"}, common...)...); c != 0 {
		t.Fatalf("add with flags last: %d %s", c, e)
	}
	if _, e, c := runTrack(t, append([]string{"set", "A1", "--stage", "review"}, common...)...); c != 0 {
		t.Fatalf("set with flags last: %d %s", c, e)
	}
	out, _, _ := runTrack(t, append([]string{"status"}, common...)...)
	if !strings.Contains(out, "review") {
		t.Fatalf("status:\n%s", out)
	}
}
