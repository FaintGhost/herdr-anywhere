// Package hcbin finds herdr-core's `hc`: --hc, else `hc` on PATH, else
// ~/.local/bin/hc. A candidate counts only if `hc --version` starts with
// "hc " (the check herdr-app's core_bin.rs makes), so another program named
// hc is skipped.
package hcbin

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var ErrNotFound = errors.New("herdr-core's hc not found (tried --hc, PATH, ~/.local/bin/hc)")

// Version runs `path --version` and returns its trimmed output.
func Version(path string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("%s --version: %w", path, err)
	}
	text := strings.TrimSpace(string(out))
	if !strings.HasPrefix(text, "hc ") {
		return "", fmt.Errorf("%s --version printed %q, not \"hc <version>\"", path, text)
	}
	return text, nil
}

// Resolve returns the hc to run and its version. An explicit path must work;
// it never falls back.
func Resolve(explicit string, lookPath func(string) (string, error), home string) (string, string, error) {
	if explicit != "" {
		v, err := Version(explicit)
		if err != nil {
			return "", "", err
		}
		return explicit, v, nil
	}
	var candidates []string
	if p, err := lookPath("hc"); err == nil {
		candidates = append(candidates, p)
	}
	if home != "" {
		candidates = append(candidates, filepath.Join(home, ".local", "bin", "hc"))
	}
	for _, p := range candidates {
		if v, err := Version(p); err == nil {
			return p, v, nil
		}
	}
	return "", "", ErrNotFound
}
