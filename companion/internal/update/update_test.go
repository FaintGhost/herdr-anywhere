package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A release as api.github.com answers it (measured 2026-11-06 on this repo's v0.1.5): asset digests are "sha256:<hex>".
func fakeGitHub(t *testing.T, tag string, binary []byte, digest string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var checks atomic.Int32
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/repos/"+Repo+"/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		checks.Add(1)
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "herdr-anywhere/") {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		json.NewEncoder(w).Encode(map[string]any{"tag_name": tag, "assets": []map[string]any{
			{"name": "Herdr-Anywhere.apk", "browser_download_url": srv.URL + "/apk", "digest": "sha256:00", "size": 136080774},
			{"name": Asset, "browser_download_url": srv.URL + "/mac", "digest": digest},
		}})
	})
	mux.HandleFunc("/mac", func(w http.ResponseWriter, r *http.Request) { w.Write(binary) })
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &checks
}

func digestOf(b []byte) string {
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func script(version string) []byte {
	return []byte("#!/bin/sh\necho herdr-anywhere " + version + "\n")
}

func installed(t *testing.T) string {
	t.Helper()
	exe := filepath.Join(t.TempDir(), "herdr-anywhere")
	if err := os.WriteFile(exe, script("0.1.5"), 0o755); err != nil {
		t.Fatal(err)
	}
	return exe
}

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.1.6", "0.1.5", true},
		{"0.1.10", "0.1.9", true},
		{"0.2.0", "0.1.9", true},
		{"1.0.0", "0.9.9", true},
		{"v0.1.6", "0.1.5", true},
		{"0.1.5", "0.1.5", false},
		{"0.1.4", "0.1.5", false},
		{"", "0.1.5", false},
		{"nonsense", "0.1.5", false},
		{"0.1.6", "dev", false},
	} {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestLatestReadsTheMacFile(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	r, err := Client{API: srv.URL, Current: "0.1.5"}.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.Version != "0.1.6" || r.URL != srv.URL+"/mac" || r.Digest != digestOf(bin) {
		t.Fatalf("%+v", r)
	}
}

func TestLatestRefusesAReleaseWithoutADigest(t *testing.T) {
	srv, _ := fakeGitHub(t, "v0.1.6", script("0.1.6"), "")
	if _, err := (Client{API: srv.URL, Current: "0.1.5"}).Latest(context.Background()); err == nil {
		t.Fatal("no error")
	}
}

func TestApplyReplacesTheFile(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	c := Client{API: srv.URL, Current: "0.1.5"}
	r, err := c.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	exe := installed(t)
	if err := c.Apply(context.Background(), r, exe); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != string(bin) {
		t.Fatalf("file holds %q", got)
	}
	if fi, _ := os.Stat(exe); fi.Mode().Perm()&0o100 == 0 {
		t.Fatalf("not executable: %v", fi.Mode())
	}
	assertNoLeftovers(t, exe)
}

// A file that isn't what the release says, or isn't the version it claims, never replaces the one that works.
func TestApplyKeepsTheOldFile(t *testing.T) {
	for name, c := range map[string]struct {
		bin    []byte
		digest string
	}{
		"digest differs": {script("0.1.6"), digestOf([]byte("something else"))},
		"other version":  {script("0.1.4"), digestOf(script("0.1.4"))},
		"doesn't run":    {[]byte("#!/bin/sh\nexit 3\n"), digestOf([]byte("#!/bin/sh\nexit 3\n"))},
		"not a program":  {[]byte("<html>"), digestOf([]byte("<html>"))},
	} {
		t.Run(name, func(t *testing.T) {
			srv, _ := fakeGitHub(t, "v0.1.6", c.bin, c.digest)
			cl := Client{API: srv.URL, Current: "0.1.5"}
			r, err := cl.Latest(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			exe := installed(t)
			if err := cl.Apply(context.Background(), r, exe); err == nil {
				t.Fatal("no error")
			}
			got, _ := os.ReadFile(exe)
			if string(got) != string(script("0.1.5")) {
				t.Fatalf("file replaced: %q", got)
			}
			assertNoLeftovers(t, exe)
		})
	}
}

func assertNoLeftovers(t *testing.T, exe string) {
	t.Helper()
	es, _ := os.ReadDir(filepath.Dir(exe))
	if len(es) != 1 {
		t.Fatalf("left in the folder: %v", es)
	}
}

func manager(t *testing.T, srv *httptest.Server, exe string, restart func()) *Manager {
	t.Helper()
	return &Manager{
		Client:   Client{API: srv.URL, Current: "0.1.5"},
		Exe:      exe,
		Installs: true,
		Dir:      t.TempDir(),
		Every:    time.Hour,
		Restart:  restart,
		Logf:     func(string, ...any) {},
	}
}

func TestCheckRemembersANewerVersion(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() { t.Error("restarted") })
	if m.Latest() != "" {
		t.Fatalf("before a check: %q", m.Latest())
	}
	m.Check(context.Background())
	if m.Latest() != "0.1.6" {
		t.Fatalf("Latest = %q", m.Latest())
	}
	if a := m.App(); a.URL != srv.URL+"/apk" || a.Digest != "sha256:00" || a.Bytes != 136080774 {
		t.Fatalf("App = %+v", a)
	}
}

func TestACheckThatFailsForgetsNothing(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	m.Check(context.Background())
	srv.Close()
	m.Check(context.Background())
	if m.Latest() != "0.1.6" {
		t.Fatalf("Latest = %q", m.Latest())
	}
}

func TestApplyLatestRefusesWithoutANewerVersion(t *testing.T) {
	bin := script("0.1.5")
	srv, _ := fakeGitHub(t, "v0.1.5", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() { t.Error("restarted") })
	if _, err := m.ApplyLatest(context.Background()); err != ErrNoUpdate {
		t.Fatalf("err = %v", err)
	}
}

func TestApplyLatestInstalls(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	exe := installed(t)
	m := manager(t, srv, exe, func() {})
	v, err := m.ApplyLatest(context.Background())
	if err != nil || v != "0.1.6" {
		t.Fatalf("%q %v", v, err)
	}
	got, _ := os.ReadFile(exe)
	if string(got) != string(bin) {
		t.Fatalf("file holds %q", got)
	}
}

func TestAutoStaysOffUntilAskedAndSurvivesARestart(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	if m.Auto() {
		t.Fatal("on by default")
	}
	if err := m.SetAuto(true); err != nil {
		t.Fatal(err)
	}
	again := &Manager{Dir: m.Dir}
	if !again.Auto() {
		t.Fatal("forgotten")
	}
}

func TestACheckUpdatesByItselfOnlyWhenAuto(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	exe := installed(t)
	var restarts atomic.Int32
	m := manager(t, srv, exe, func() { restarts.Add(1) })

	m.Check(context.Background())
	if got, _ := os.ReadFile(exe); string(got) != string(script("0.1.5")) || restarts.Load() != 0 {
		t.Fatalf("updated though auto is off: %q, %d restarts", got, restarts.Load())
	}

	if err := m.SetAuto(true); err != nil {
		t.Fatal(err)
	}
	m.Check(context.Background())
	if got, _ := os.ReadFile(exe); string(got) != string(bin) {
		t.Fatalf("file holds %q", got)
	}
	if restarts.Load() != 1 {
		t.Fatalf("%d restarts", restarts.Load())
	}
}

// A release that fails must not be tried over and over within the hour.
func TestAutoGivesAFailedVersionOneTry(t *testing.T) {
	bin := script("0.1.4") // says 0.1.4 in a release called 0.1.6
	srv, checks := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() { t.Error("restarted") })
	if err := m.SetAuto(true); err != nil {
		t.Fatal(err)
	}
	var logged []string
	m.Logf = func(f string, a ...any) { logged = append(logged, fmt.Sprintf(f, a...)) }
	m.Check(context.Background())
	m.Check(context.Background())
	if checks.Load() != 2 {
		t.Fatalf("%d checks", checks.Load())
	}
	failures := 0
	for _, l := range logged {
		if strings.Contains(l, "couldn't") {
			failures++
		}
	}
	if failures != 1 {
		t.Fatalf("tried %d times: %v", failures, logged)
	}
}

func TestRunChecksAtOnceAndThenOnSchedule(t *testing.T) {
	bin := script("0.1.5")
	srv, checks := fakeGitHub(t, "v0.1.5", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	if err := m.SetChecks(true); err != nil {
		t.Fatal(err)
	}
	m.Every = 20 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.Run(ctx); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for checks.Load() < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("%d checks", checks.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run didn't stop")
	}
}

func TestNothingInstallsWhereNoReleasedFileRuns(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	exe := installed(t)
	m := manager(t, srv, exe, func() { t.Error("restarted") })
	m.Installs = false
	if err := m.SetAuto(true); err != nil {
		t.Fatal(err)
	}
	m.Check(context.Background())
	if _, err := m.ApplyLatest(context.Background()); err != ErrNotHere {
		t.Fatalf("err = %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != string(script("0.1.5")) {
		t.Fatalf("replaced: %q", got)
	}
	if m.Latest() != "0.1.6" {
		t.Fatalf("the notice still needs the version: %q", m.Latest())
	}
}

// Nothing leaves the computer until the person says yes: a program that phones home on its own looks like malware.
func TestRunAsksGitHubNothingUntilThePersonSaysYes(t *testing.T) {
	bin := script("0.1.6")
	srv, checks := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	m.Every = 10 * time.Millisecond
	if m.Checks() != "ask" {
		t.Fatalf("checks = %q before anyone answered", m.Checks())
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Run(ctx)
	time.Sleep(100 * time.Millisecond)
	if checks.Load() != 0 {
		t.Fatalf("asked GitHub %d times before the person said yes", checks.Load())
	}
	if err := m.SetChecks(true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for checks.Load() < 2 {
		if time.Now().After(deadline) {
			t.Fatalf("%d checks after yes", checks.Load())
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := m.SetChecks(false); err != nil {
		t.Fatal(err)
	}
	time.Sleep(30 * time.Millisecond)
	after := checks.Load()
	time.Sleep(100 * time.Millisecond)
	if checks.Load() != after {
		t.Fatalf("still asking after no: %d then %d", after, checks.Load())
	}
}

// The phone checks the moment the person says yes; the schedule that wakes on the same yes doesn't ask again.
func TestAYesThatTheAppCheckedOnAsksGitHubOnce(t *testing.T) {
	bin := script("0.1.6")
	srv, checks := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	m.First = 20 * time.Millisecond
	m.Every = time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go m.Run(ctx)
	time.Sleep(50 * time.Millisecond)
	if err := m.SetChecks(true); err != nil {
		t.Fatal(err)
	}
	if _, err := m.CheckNow(ctx); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	if checks.Load() != 1 {
		t.Fatalf("asked GitHub %d times for one yes", checks.Load())
	}
}

func TestTheAnswerSurvivesARestart(t *testing.T) {
	m := &Manager{Dir: t.TempDir()}
	if err := m.SetChecks(false); err != nil {
		t.Fatal(err)
	}
	if got := (&Manager{Dir: m.Dir}).Checks(); got != "off" {
		t.Fatalf("checks = %q", got)
	}
}

// Installing by itself needs checking; no checks means nothing installs by itself.
func TestAutoAndChecksGoTogether(t *testing.T) {
	m := &Manager{Dir: t.TempDir()}
	if err := m.SetAuto(true); err != nil {
		t.Fatal(err)
	}
	if m.Checks() != "on" || !m.Auto() {
		t.Fatalf("auto on: checks %q, auto %v", m.Checks(), m.Auto())
	}
	if err := m.SetChecks(false); err != nil {
		t.Fatal(err)
	}
	if m.Checks() != "off" || m.Auto() {
		t.Fatalf("checks off: checks %q, auto %v", m.Checks(), m.Auto())
	}
}

// 0.1.6 wrote only {"auto": true}: whoever turned that on said yes to checking.
func TestA016AutoChoiceCountsAsYes(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, stateFile), []byte(`{"auto":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := (&Manager{Dir: dir}).Checks(); got != "on" {
		t.Fatalf("checks = %q", got)
	}
	if err := os.WriteFile(filepath.Join(dir, stateFile), []byte(`{"auto":false}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := (&Manager{Dir: dir}).Checks(); got != "ask" {
		t.Fatalf("checks = %q", got)
	}
}

// The person asks now: one question to GitHub, whatever the daily choice, and nothing installs.
func TestCheckNowAsksOnceAndInstallsNothing(t *testing.T) {
	bin := script("0.1.6")
	srv, checks := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	exe := installed(t)
	m := manager(t, srv, exe, func() { t.Error("restarted") })
	if err := m.SetChecks(false); err != nil {
		t.Fatal(err)
	}
	v, err := m.CheckNow(context.Background())
	if err != nil || v != "0.1.6" || checks.Load() != 1 || m.Latest() != "0.1.6" {
		t.Fatalf("CheckNow = %q, %v; %d checks; latest %q", v, err, checks.Load(), m.Latest())
	}
	if got, _ := os.ReadFile(exe); string(got) != string(script("0.1.5")) {
		t.Fatalf("installed: %q", got)
	}
}

// What the last check found is kept: after the computer updates itself, phones still learn of the new app at once.
func TestWhatACheckFoundSurvivesARestart(t *testing.T) {
	bin := script("0.1.6")
	srv, _ := fakeGitHub(t, "v0.1.6", bin, digestOf(bin))
	m := manager(t, srv, installed(t), func() {})
	if _, err := m.CheckNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	again := &Manager{Dir: m.Dir}
	if again.Latest() != "0.1.6" || again.App().URL == "" {
		t.Fatalf("after a restart: latest %q, app %+v", again.Latest(), again.App())
	}
}
