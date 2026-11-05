package hcbin

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func fake(t *testing.T, dir, out string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "hc")
	script := "#!/bin/sh\n[ \"$1\" = --version ] && printf '%s\\n' '" + out + "'\n"
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func noPath(string) (string, error) { return "", exec.ErrNotFound }

func TestVersionMustStartWithHc(t *testing.T) {
	d := t.TempDir()
	good := fake(t, filepath.Join(d, "a"), "hc 0.1.13")
	bad := fake(t, filepath.Join(d, "b"), "hashcat 6.2")
	if v, err := Version(good); err != nil || v != "hc 0.1.13" {
		t.Fatalf("Version(good) = %q, %v", v, err)
	}
	if _, err := Version(bad); err == nil {
		t.Fatal("Version accepted a program that is not herdr-core's hc")
	}
	if _, err := Version(filepath.Join(d, "missing")); err == nil {
		t.Fatal("Version accepted a missing file")
	}
}

func TestResolveOrder(t *testing.T) {
	d := t.TempDir()
	home := filepath.Join(d, "home")
	homeHc := fake(t, filepath.Join(home, ".local", "bin"), "hc 0.1.1")
	pathHc := fake(t, filepath.Join(d, "path"), "hc 0.1.2")
	flagHc := fake(t, filepath.Join(d, "flag"), "hc 0.1.3")
	wrong := fake(t, filepath.Join(d, "wrong"), "hc-other 1")
	onPath := func(p string) func(string) (string, error) {
		return func(string) (string, error) { return p, nil }
	}

	cases := []struct {
		name, explicit string
		look           func(string) (string, error)
		want, version  string
	}{
		{"flag wins", flagHc, onPath(pathHc), flagHc, "hc 0.1.3"},
		{"then PATH", "", onPath(pathHc), pathHc, "hc 0.1.2"},
		{"then ~/.local/bin", "", noPath, homeHc, "hc 0.1.1"},
		{"a foreign hc on PATH is skipped", "", onPath(wrong), homeHc, "hc 0.1.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, v, err := Resolve(c.explicit, c.look, home)
			if err != nil || p != c.want || v != c.version {
				t.Fatalf("Resolve = %q, %q, %v; want %q, %q", p, v, err, c.want, c.version)
			}
		})
	}
}

func TestResolveExplicitBadPathFails(t *testing.T) {
	d := t.TempDir()
	home := filepath.Join(d, "home")
	fake(t, filepath.Join(home, ".local", "bin"), "hc 0.1.1")
	wrong := fake(t, filepath.Join(d, "wrong"), "nope")
	if _, _, err := Resolve(wrong, noPath, home); err == nil {
		t.Fatal("an explicit --hc that is not hc must fail, not fall back")
	}
}

func TestResolveNothingFound(t *testing.T) {
	_, _, err := Resolve("", noPath, t.TempDir())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}
