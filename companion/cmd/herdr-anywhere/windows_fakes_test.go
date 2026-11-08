package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setHome makes dir the home folder the companion reads (~/.claude): HOME on
// macOS and Linux, USERPROFILE on Windows (os.UserHomeDir).
func setHome(t *testing.T, dir string) {
	t.Helper()
	t.Setenv("HOME", dir)
	t.Setenv("USERPROFILE", dir)
}

// These tests run on Windows too (CI's Companion jobs). A shell script can't be
// run there, so a fake hc or herdr is testfake.HC, a built Go program; and the
// home folder is USERPROFILE there, so tests set it with setHome.
func TestTheTestsHereRunOnWindowsToo(t *testing.T) {
	files, _ := filepath.Glob("*_test.go")
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), "#!"+"/bin/sh") {
			t.Errorf("%s writes a shell script as a fake program", f)
		}
		if f != "windows_fakes_test.go" && strings.Contains(string(b), `t.Setenv("HOME"`) {
			t.Errorf("%s sets HOME alone; use setHome", f)
		}
	}
}
