package main

import (
	"encoding/json"
	"herdr-anywhere/companion/internal/testfake"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Turning the progress page on, the user picks which agent does the filing.
// Offered: the agents on this computer that report their status to herdr-core,
// which the companion needs to know the filing pane is free. Measured on
// live panes (hc ls/get, read only): claude-code,
// pi and kimi-code report; Codex reports only from 0.163.
func TestTheFilingAgentIsPickedFromTheOnesThatReportTheirStatus(t *testing.T) {
	state := t.TempDir()
	t.Setenv("HERDR_ANYWHERE_STATE", state)
	defer func(f func() map[string]string, v func(string) string) { agentPaths, agentVersion = f, v }(agentPaths, agentVersion)
	agentPaths = func() map[string]string {
		return map[string]string{"claude": "/x/claude", "pi": "/x/pi", "codex": "/x/codex"} // no kimi
	}
	agentVersion = func(path string) string { return "codex-cli 0.150.0" }
	var out strings.Builder
	if err := progressCommand([]string{"agents"}, &out, &out); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Agents []agentChoice `json:"agents"`
		Chosen string        `json:"chosen"`
	}
	if err := json.Unmarshal([]byte(out.String()), &got); err != nil {
		t.Fatalf("%v %s", err, out.String())
	}
	var ids []string
	for _, a := range got.Agents {
		ids = append(ids, a.ID+":"+map[bool]string{true: "ok", false: "no"}[a.Usable])
	}
	if strings.Join(ids, " ") != "claude-code:ok pi:ok codex:no" || got.Chosen != "" {
		t.Fatalf("agents = %v chosen %q", ids, got.Chosen)
	}
	if c := got.Agents[2]; !strings.Contains(c.Note, "0.163") || !strings.Contains(c.Note, "0.150.0") {
		t.Fatalf("codex note = %q", c.Note)
	}
	// The phone writes the note in its own language from these two.
	if c := got.Agents[2]; c.Needs != "0.163" || c.Version != "0.150.0" {
		t.Fatalf("codex needs %q, has %q", c.Needs, c.Version)
	}
	if c := got.Agents[0]; c.Name != "Claude Code" || c.Cmd != "claude --model claude-haiku-5-5" {
		t.Fatalf("claude = %+v", c)
	}

	// Picking one: its command runs the filing pane from then on, and a filing
	// pane already running another agent is closed, so the next pass starts the new one.
	d := t.TempDir()
	hc := testfake.HC(t, d, "hc", testfake.Spec{Version: "hc 0.1.18", On: map[string][]testfake.Reply{
		"ls":   {{Print: `{"terminals":[{"address":"t8","name":"herdr-organizer","state":"live","status":"idle","turn":1,"agent":"claude-code"}]}`}},
		"get":  {{Print: `{"address":"t8","state":"live","labels":{"herdr.role":"organizer"},"status":{"state":"idle"}}`}},
		"kill": {{Append: filepath.Join(d, "killed")}},
	}})
	out.Reset()
	if err := progressCommand([]string{"organizer", "--agent", "pi", "--hc", hc}, &out, &out); err != nil {
		t.Fatalf("%v %s", err, out.String())
	}
	if cfg := loadOrganizer(state); cfg.Cmd != "pi" || cfg.Agent != "pi" {
		t.Fatalf("cfg = %+v", cfg)
	}
	if b, _ := os.ReadFile(filepath.Join(d, "killed")); strings.TrimSpace(string(b)) != "kill t8" {
		t.Fatalf("killed: %q", b)
	}
	// The same pick again leaves the pane alone.
	os.Remove(filepath.Join(d, "killed"))
	progressCommand([]string{"organizer", "--agent", "pi", "--hc", hc}, &out, &out)
	if _, err := os.Stat(filepath.Join(d, "killed")); err == nil {
		t.Fatal("killed the pane for the same pick")
	}
	for _, bad := range []string{"codex", "kimi-code", "nope"} {
		if err := progressCommand([]string{"organizer", "--agent", bad, "--hc", hc}, &out, &out); err == nil {
			t.Fatalf("picked %s", bad)
		}
	}
	out.Reset()
	progressCommand([]string{"agents"}, &out, &out)
	if !strings.Contains(out.String(), `"chosen": "pi"`) {
		t.Fatalf("chosen not shown: %s", out.String())
	}
}

// Codex as the filing agent (measured in companion/eval/filing): without these it
// stops at an update prompt whose default installs a new Codex for the whole
// computer, and asks before each track command. It may write only in the filing
// folder and the progress file's folder, a path that may hold spaces.
func TestCodexFilesWithoutPromptsAndWritesOnlyWhereItMust(t *testing.T) {
	var cmd string
	for _, a := range knownAgents {
		if a.id == "codex" {
			cmd = a.cmd
		}
	}
	for _, want := range []string{"--no-daemon", "check_for_update_on_startup=false", "-a never", "-s workspace-write"} {
		if !strings.Contains(cmd, want) {
			t.Errorf("codex command %q lacks %s", cmd, want)
		}
	}
	state := filepath.Join(t.TempDir(), "with space")
	argv, err := organizerPane(organizerConfig{Agent: "codex", Cmd: cmd, Dir: "/x"}, state).argv()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(argv[len(argv)-2:], "|"); got != "--add-dir|"+state {
		t.Errorf("codex argv ends %q", got)
	}
	argv, _ = organizerPane(organizerConfig{Agent: "pi", Cmd: "pi", Dir: "/x"}, state).argv()
	if strings.Join(argv, " ") != "pi" {
		t.Errorf("pi argv %q", argv)
	}
}
