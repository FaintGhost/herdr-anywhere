package testfake

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFakeHC(t *testing.T) {
	dir := t.TempDir()
	v := HC(t, dir, "hc", Spec{Version: "hc 9.9.9", Connect: "echo"})
	if out, err := exec.Command(v, "--version").Output(); err != nil || string(out) != "hc 9.9.9\n" {
		t.Fatalf("--version = %q, %v", out, err)
	}
	pidfile := filepath.Join(dir, "pid")
	cmd := exec.Command(v, "connect")
	cmd.Env = append(os.Environ(), "HM_PIDFILE="+pidfile)
	cmd.Stdin = strings.NewReader("ping")
	if out, err := cmd.Output(); err != nil || string(out) != "ping" {
		t.Fatalf("connect = %q, %v", out, err)
	}
	if b, err := os.ReadFile(pidfile); err != nil || len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("pidfile %q, %v", b, err)
	}

	bye := HC(t, filepath.Join(dir, "b"), "hc", Spec{Version: "hc 9", Connect: "print:bye"})
	if out, err := exec.Command(bye, "connect").Output(); err != nil || string(out) != "bye" {
		t.Fatalf("print connect = %q, %v", out, err)
	}
	fails := HC(t, filepath.Join(dir, "c"), "hc", Spec{Exit: 1})
	if err := exec.Command(fails, "exec").Run(); err == nil {
		t.Fatal("Exit: 1 exited 0")
	}
}

// A fake that answers by subcommand, as the companion's tests need from hc and herdr.
func TestFakeHCAnswersBySubcommand(t *testing.T) {
	dir := t.TempDir()
	d := filepath.Join(dir, "files")
	os.MkdirAll(d, 0o755)
	os.WriteFile(filepath.Join(d, "get-t1.json"), []byte(`{"address":"t1"}`), 0o644)
	hc := HC(t, dir, "hc", Spec{Version: "hc 0.1.18", Calls: filepath.Join(d, "calls"), On: map[string][]Reply{
		"ls":   {{If: filepath.Join(d, "ran"), Print: `{"terminals":[{"address":"t9"}]}`}, {Print: `{"terminals":[]}`}},
		"get":  {{Cat: filepath.Join(d, "get-{2}.json")}},
		"who":  {{Print: `{"address":"{2}"}`}},
		"run":  {{Write: filepath.Join(d, "ran"), Print: `{"address":"t9"}`}},
		"kill": {{Append: filepath.Join(d, "killed")}},
	}, Else: 1})
	out := func(args ...string) string {
		t.Helper()
		b, err := exec.Command(hc, args...).Output()
		if err != nil {
			t.Fatalf("%v: %v", args, err)
		}
		return string(b)
	}
	if got := out("--version"); got != "hc 0.1.18\n" {
		t.Fatalf("--version = %q", got)
	}
	if got := out("ls"); got != "{\"terminals\":[]}\n" {
		t.Fatalf("ls before run = %q", got)
	}
	if got := out("run", "--bg", "x y"); got != "{\"address\":\"t9\"}\n" {
		t.Fatalf("run = %q", got)
	}
	if b, _ := os.ReadFile(filepath.Join(d, "ran")); string(b) != "run --bg x y\n" {
		t.Fatalf("ran = %q", b)
	}
	if got := out("ls"); got != "{\"terminals\":[{\"address\":\"t9\"}]}\n" {
		t.Fatalf("ls after run = %q", got)
	}
	if got := out("get", "t1"); got != `{"address":"t1"}` {
		t.Fatalf("get = %q", got)
	}
	if got := out("who", "t7"); got != "{\"address\":\"t7\"}\n" {
		t.Fatalf("who = %q", got)
	}
	out("kill", "t8")
	out("kill", "t9")
	if b, _ := os.ReadFile(filepath.Join(d, "killed")); string(b) != "kill t8\nkill t9\n" {
		t.Fatalf("killed = %q", b)
	}
	if err := exec.Command(hc, "send").Run(); err == nil {
		t.Fatal("a subcommand with no reply exited 0 with Else: 1")
	}
	if b, _ := os.ReadFile(filepath.Join(d, "calls")); !strings.HasPrefix(string(b), "--version\nls\nrun --bg x y\n") || !strings.HasSuffix(string(b), "kill t9\nsend\n") {
		t.Fatalf("calls = %q", b)
	}
}
