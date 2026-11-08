package main

import (
	"encoding/json"
	"herdr-anywhere/companion/internal/testfake"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTrackWatchFilesWhatWasTypedIntoAClaudePane(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)
	d := t.TempDir()
	file := filepath.Join(d, "track.json")
	// hc: one Claude pane t2 (foreground pid 4242) and a shell.
	hc := testfake.HC(t, d, "hc", testfake.Spec{Version: "hc 0.1.18", On: map[string][]testfake.Reply{
		"ls":  {{Print: `{"terminals":[{"address":"t2","name":"api","state":"live","status":"idle","turn":3,"cwd":"/p/acme-api","agent":"claude-code"},{"address":"t5","state":"live","turn":1,"agent":"zsh"}]}`}},
		"get": {{Print: `{"address":"{2}","foreground":{"pid":4242,"name":"claude"}}`}},
	}})
	os.MkdirAll(filepath.Join(home, ".claude", "sessions"), 0o700)
	os.WriteFile(filepath.Join(home, ".claude", "sessions", "4242.json"), []byte(`{"pid":4242,"sessionId":"s1"}`), 0o600)
	proj := filepath.Join(home, ".claude", "projects", "-p-acme-api")
	os.MkdirAll(proj, 0o700)
	session := filepath.Join(proj, "s1.jsonl")
	line := func(text string) string {
		b, _ := json.Marshal(map[string]any{"type": "user", "origin": map[string]string{"kind": "human"}, "promptSource": "typed", "message": map[string]any{"role": "user", "content": text}})
		return string(b) + "\n"
	}
	os.WriteFile(session, []byte(line("历史里的话")), 0o600)
	common := []string{"--file", file, "--hc", hc, "--herdr", "-", "--state", d}
	if _, e, c := runTrack(t, append([]string{"watch", "--once"}, common...)...); c != 0 {
		t.Fatalf("first watch: %d %s", c, e)
	}
	f, _ := os.OpenFile(session, os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(line("加一个 cancel_order，带测试"))
	f.Close()
	out, e, c := runTrack(t, append([]string{"watch", "--once"}, common...)...)
	if c != 0 {
		t.Fatalf("second watch: %d %s", c, e)
	}
	b, _ := os.ReadFile(file)
	if !strings.Contains(string(b), "cancel_order") || strings.Contains(string(b), "历史里的话") || !strings.Contains(out, "t2") {
		t.Fatalf("file:\n%s\nout: %s", b, out)
	}
	if _, err := os.Stat(filepath.Join(d, "watch.json")); err != nil {
		t.Fatalf("no watch state: %v", err)
	}
}

// A pane Herdr started for itself (it carries a herdr.role label, as the filing
// pane does) holds Herdr's own conversation, not the user's work: nothing typed
// there is filed as a task, whatever the role.
func TestTrackWatchSkipsHerdrsOwnPanes(t *testing.T) {
	for _, role := range []string{"organizer", "any-other-role"} {
		t.Run(role, func(t *testing.T) {
			home := t.TempDir()
			setHome(t, home)
			d := t.TempDir()
			file := filepath.Join(d, "track.json")
			hc := testfake.HC(t, d, "hc", testfake.Spec{Version: "hc 0.1.18", On: map[string][]testfake.Reply{
				"ls":  {{Print: `{"terminals":[{"address":"t9","name":"herdr-organizer","state":"live","status":"idle","turn":1,"agent":"claude-code"}]}`}},
				"get": {{Print: `{"address":"{2}","labels":{"herdr.role":"` + role + `"},"foreground":{"pid":4343,"name":"claude"}}`}},
			}})
			os.MkdirAll(filepath.Join(home, ".claude", "sessions"), 0o700)
			os.WriteFile(filepath.Join(home, ".claude", "sessions", "4343.json"), []byte(`{"pid":4343,"sessionId":"s9"}`), 0o600)
			proj := filepath.Join(home, ".claude", "projects", "-organizer")
			os.MkdirAll(proj, 0o700)
			session := filepath.Join(proj, "s9.jsonl")
			os.WriteFile(session, nil, 0o600)
			common := []string{"--file", file, "--hc", hc, "--herdr", "-", "--state", d}
			runTrack(t, append([]string{"watch", "--once"}, common...)...)
			b, _ := json.Marshal(map[string]any{"type": "user", "origin": map[string]string{"kind": "human"}, "promptSource": "typed", "message": map[string]any{"role": "user", "content": "Acme 到哪了"}})
			os.WriteFile(session, append(b, '\n'), 0o600)
			if _, e, c := runTrack(t, append([]string{"watch", "--once"}, common...)...); c != 0 {
				t.Fatalf("watch: %d %s", c, e)
			}
			if got, _ := os.ReadFile(file); strings.Contains(string(got), "Acme 到哪了") {
				t.Fatalf("a message in a %s pane was filed:\n%s", role, got)
			}
		})
	}
}
