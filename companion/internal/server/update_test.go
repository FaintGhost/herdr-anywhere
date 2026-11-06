package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"herdr-anywhere/companion/internal/update"
)

type fakeUpdates struct {
	latest   string
	can      bool
	auto     bool
	checks   string
	looked   atomic.Int32
	err      error
	applied  atomic.Int32
	restarts atomic.Int32
}

func (f *fakeUpdates) App() update.App {
	return update.App{URL: "https://example.com/a.apk", Digest: "sha256:ab", Bytes: 5}
}
func (f *fakeUpdates) Latest() string        { return f.latest }
func (f *fakeUpdates) CanInstall() bool      { return f.can }
func (f *fakeUpdates) Auto() bool            { return f.auto }
func (f *fakeUpdates) SetAuto(on bool) error { f.auto = on; return nil }
func (f *fakeUpdates) Checks() string {
	if f.checks == "" {
		return "ask"
	}
	return f.checks
}
func (f *fakeUpdates) SetChecks(on bool) error {
	f.checks = map[bool]string{true: "on", false: "off"}[on]
	return nil
}
func (f *fakeUpdates) CheckNow(context.Context) (string, error) {
	f.looked.Add(1)
	if f.err != nil {
		return "", f.err
	}
	return f.latest, nil
}
func (f *fakeUpdates) Restart() { f.restarts.Add(1) }
func (f *fakeUpdates) ApplyLatest(context.Context) (string, error) {
	f.applied.Add(1)
	if f.err != nil {
		return "", f.err
	}
	return f.latest, nil
}

func postJSON(t *testing.T, url, token, body string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var out map[string]any
	json.NewDecoder(r.Body).Decode(&out)
	return r.StatusCode, out
}

func TestInfoSaysWhatIsNew(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.6", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	_, body := get(t, f.srv.URL+"/api/info")
	var info map[string]any
	if err := json.Unmarshal([]byte(body), &info); err != nil {
		t.Fatal(err)
	}
	if info["latest"] != "0.1.6" || info["canUpdate"] != true || info["autoUpdate"] != false || info["checks"] != "ask" {
		t.Fatalf("%v", info)
	}
	app, _ := info["app"].(map[string]any)
	if app["url"] != "https://example.com/a.apk" || app["digest"] != "sha256:ab" || app["bytes"] != float64(5) {
		t.Fatalf("%v", info)
	}
}

func TestOnlyAPairedPhoneCanUpdate(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.6", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	for _, path := range []string{"/api/update", "/api/update/auto"} {
		if code, _ := postJSON(t, f.srv.URL+path, "", `{"on":true}`); code != http.StatusUnauthorized {
			t.Fatalf("%s: %d", path, code)
		}
		if code, _ := postJSON(t, f.srv.URL+path, "wrong", `{"on":true}`); code != http.StatusUnauthorized {
			t.Fatalf("%s: %d", path, code)
		}
	}
	if u.applied.Load() != 0 || u.auto {
		t.Fatal("did it anyway")
	}
}

func TestUpdateAnswersThenRestarts(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.6", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	_, token := f.pair(t)
	code, body := postJSON(t, f.srv.URL+"/api/update", token, "")
	if code != http.StatusOK || body["version"] != "0.1.6" {
		t.Fatalf("%d %v", code, body)
	}
	deadline := time.Now().Add(3 * time.Second)
	for u.restarts.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("no restart")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestUpdateThatFailsKeepsRunning(t *testing.T) {
	for _, c := range []struct {
		err  error
		want int
	}{
		{update.ErrNoUpdate, http.StatusConflict},
		{update.ErrBusy, http.StatusConflict},
		{update.ErrNotHere, http.StatusNotImplemented},
		{errors.New("the download doesn't match"), http.StatusBadGateway},
	} {
		u := &fakeUpdates{latest: "0.1.6", err: c.err}
		f := newFixture(t, func(cfg *Config) { cfg.Updates = u })
		_, token := f.pair(t)
		if code, body := postJSON(t, f.srv.URL+"/api/update", token, ""); code != c.want || body["error"] == nil {
			t.Fatalf("%v: %d %v", c.err, code, body)
		}
		time.Sleep(350 * time.Millisecond)
		if u.restarts.Load() != 0 {
			t.Fatalf("%v: restarted", c.err)
		}
	}
}

func TestAutoIsThePhonesToSet(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.6", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	_, token := f.pair(t)
	if code, _ := postJSON(t, f.srv.URL+"/api/update/auto", token, `{}`); code != http.StatusBadRequest {
		t.Fatalf("%d", code)
	}
	if code, body := postJSON(t, f.srv.URL+"/api/update/auto", token, `{"on":true}`); code != http.StatusOK || body["on"] != true || !u.auto {
		t.Fatalf("%d %v %v", code, body, u.auto)
	}
}

func TestACompanionWithoutUpdatesSaysSo(t *testing.T) {
	f := newFixture(t, nil)
	_, token := f.pair(t)
	if code, _ := postJSON(t, f.srv.URL+"/api/update", token, ""); code != http.StatusNotImplemented {
		t.Fatalf("%d", code)
	}
	_, body := get(t, f.srv.URL+"/api/info")
	if strings.Contains(body, "latest") {
		t.Fatalf("%s", body)
	}
}

func TestThePhoneAnswersWhetherToCheck(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.6", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	if code, _ := postJSON(t, f.srv.URL+"/api/update/checks", "", `{"on":true}`); code != http.StatusUnauthorized {
		t.Fatalf("unpaired: %d", code)
	}
	_, token := f.pair(t)
	if code, _ := postJSON(t, f.srv.URL+"/api/update/checks", token, `{}`); code != http.StatusBadRequest {
		t.Fatalf("%d", code)
	}
	if code, body := postJSON(t, f.srv.URL+"/api/update/checks", token, `{"on":false}`); code != http.StatusOK || body["checks"] != "off" || u.checks != "off" {
		t.Fatalf("%d %v %q", code, body, u.checks)
	}
}

func TestThePhoneCanAskForOneCheckNow(t *testing.T) {
	u := &fakeUpdates{latest: "0.1.7", can: true}
	f := newFixture(t, func(c *Config) { c.Updates = u })
	if code, _ := postJSON(t, f.srv.URL+"/api/update/check", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("unpaired: %d", code)
	}
	_, token := f.pair(t)
	if code, body := postJSON(t, f.srv.URL+"/api/update/check", token, ""); code != http.StatusOK || body["latest"] != "0.1.7" || u.looked.Load() != 1 {
		t.Fatalf("%d %v %d", code, body, u.looked.Load())
	}
	u.err = errors.New("no network")
	if code, body := postJSON(t, f.srv.URL+"/api/update/check", token, ""); code != http.StatusBadGateway || body["error"] != "no network" {
		t.Fatalf("%d %v", code, body)
	}
}
