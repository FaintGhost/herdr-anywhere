package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"herdr-anywhere/companion/internal/store"
)

func TestSameOrigin(t *testing.T) {
	cases := []struct {
		origin, host string
		tls          bool
		ok           bool
	}{
		{"", "mac:7681", false, true},
		{"http://mac:7681", "mac:7681", false, true},
		{"http://MAC:7681", "mac:7681", false, true},
		{"https://mac:7681", "mac:7681", true, true},
		{"https://mac:7681", "mac:7681", false, false}, // scheme must match too
		{"http://mac:7681", "mac:7681", true, false},
		{"http://mac:7682", "mac:7681", false, false},
		{"http://evil.example", "mac:7681", false, false},
		{"null", "mac:7681", false, false},
		{"http://mac:7681/path", "mac:7681", false, false},
		{"garbage", "mac:7681", false, false},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", "/hc", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if !c.tls {
			r.TLS = nil
		} else if r.TLS == nil {
			r.TLS = &tlsStateForTest
		}
		if got := sameOrigin(r); got != c.ok {
			t.Errorf("sameOrigin(Origin %q, Host %q, tls %v) = %v, want %v", c.origin, c.host, c.tls, got, c.ok)
		}
	}
}

func TestInfoHasNameVersionAndHc(t *testing.T) {
	f := newFixture(t, func(c *Config) { c.HCVersion = "hc 0.1.13" })
	r, body := get(t, f.srv.URL+"/api/info")
	if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("status %d, type %q", r.StatusCode, r.Header.Get("Content-Type"))
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"name": "test-mac", "version": "0.0.0-test", "hc": "hc 0.1.13"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("info = %v, want %v", got, want)
	}
}

func TestInfoHcIsNullWithoutHc(t *testing.T) {
	f := newFixture(t, nil)
	_, body := get(t, f.srv.URL+"/api/info")
	if !strings.Contains(body, `"hc":null`) {
		t.Fatalf("info = %s", body)
	}
}

func pairBody(code, device string) string {
	b, _ := json.Marshal(map[string]string{"code": code, "device": device})
	return string(b)
}

func TestPairAPI(t *testing.T) {
	f := newFixture(t, nil)
	code, _ := f.store.CreateCode("Phone", 10*time.Minute)

	r, body := post(t, f.srv.URL+"/api/pair", pairBody(code, "Pixel 9"))
	if r.StatusCode != 200 {
		t.Fatalf("status %d: %s", r.StatusCode, body)
	}
	var got struct{ Token, Device, Name string }
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if b, err := base64.RawURLEncoding.DecodeString(got.Token); err != nil || len(b) < 32 {
		t.Fatalf("token %q", got.Token)
	}
	if got.Name != "test-mac" || got.Device == "" {
		t.Fatalf("reply = %s", body)
	}
	ds, _ := f.store.Devices()
	if len(ds) != 1 || ds[0].ID != got.Device || ds[0].Name != "Pixel 9" {
		t.Fatalf("devices = %+v", ds)
	}
	if d, err := f.store.Authenticate(got.Token); err != nil || d.ID != got.Device {
		t.Fatalf("token does not authenticate: %v", err)
	}

	if r, _ := post(t, f.srv.URL+"/api/pair", pairBody(code, "again")); r.StatusCode != http.StatusGone {
		t.Fatalf("used code: status %d, want 410", r.StatusCode)
	}
	if r, _ := post(t, f.srv.URL+"/api/pair", pairBody("not-a-code", "x")); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad code: status %d, want 401", r.StatusCode)
	}
	if r, _ := post(t, f.srv.URL+"/api/pair", "{"); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad json: status %d, want 400", r.StatusCode)
	}
	if r, _ := get(t, f.srv.URL+"/api/pair"); r.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("GET: status %d, want 405", r.StatusCode)
	}
}

func TestPairAPIRejectsForeignOrigin(t *testing.T) {
	f := newFixture(t, nil)
	code, _ := f.store.CreateCode("Phone", 10*time.Minute)
	r, _ := post(t, f.srv.URL+"/api/pair", pairBody(code, "x"), "Origin", "http://evil.example")
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d, want 403", r.StatusCode)
	}
}

func TestPairAPIRateLimitsFailures(t *testing.T) {
	f := newFixture(t, nil)
	for i := range 10 {
		if r, _ := post(t, f.srv.URL+"/api/pair", pairBody("wrong", "x")); r.StatusCode != 401 {
			t.Fatalf("try %d: status %d", i, r.StatusCode)
		}
	}
	code, _ := f.store.CreateCode("Phone", 10*time.Minute)
	if r, _ := post(t, f.srv.URL+"/api/pair", pairBody(code, "x")); r.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("after 10 failures: status %d, want 429", r.StatusCode)
	}
}

func TestLimiterForgetsAfterTheWindow(t *testing.T) {
	now := time.Unix(0, 0)
	l := newLimiter(10, time.Minute)
	l.now = func() time.Time { return now }
	for range 10 {
		l.fail("1.2.3.4")
	}
	if l.allow("1.2.3.4") {
		t.Fatal("allowed after 10 failures")
	}
	if !l.allow("5.6.7.8") {
		t.Fatal("another IP is blocked")
	}
	now = now.Add(time.Minute + time.Second)
	if !l.allow("1.2.3.4") {
		t.Fatal("still blocked after the window")
	}
}

func TestRequestLogHasNoQuery(t *testing.T) {
	f := newFixture(t, nil)
	get(t, f.srv.URL+"/hc?token=supersecret-token-value")
	get(t, f.srv.URL+"/anything?token=supersecret-token-value")
	logs := f.logs.String()
	if !strings.Contains(logs, "/hc") {
		t.Fatalf("no request log line: %q", logs)
	}
	if strings.Contains(logs, "supersecret") || strings.Contains(logs, "token=") {
		t.Fatalf("log leaks the query: %q", logs)
	}
}

// `herdr-anywhere pair` is another process writing the same state dir while
// serve runs: its code must work without a restart.
func TestCodeFromAnotherProcessWorksWithoutRestart(t *testing.T) {
	f := newFixture(t, nil)
	get(t, f.srv.URL+"/api/info") // serve is up and has handled traffic
	other, err := store.Open(f.store.Dir())
	if err != nil {
		t.Fatal(err)
	}
	code, _ := other.CreateCode("Phone", 10*time.Minute)
	if r, body := post(t, f.srv.URL+"/api/pair", pairBody(code, "x")); r.StatusCode != 200 {
		t.Fatalf("status %d: %s", r.StatusCode, body)
	}
}
