package server

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
)

var tlsStateForTest = tls.ConnectionState{}

func webDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	web := filepath.Join(root, "web")
	files := map[string]string{
		"index.html":           "<!doctype html>home",
		"sw.js":                "self.x=1",
		"app.js":               "console.log(1)",
		"app.wasm":             "\x00asm",
		"manifest.webmanifest": "{}",
		"bundle.nshc":          "NSHC",
		"style.css":            "body{}",
		"icon.png":             "\x89PNG",
		"sub/index.html":       "sub home",
	}
	for name, body := range files {
		p := filepath.Join(web, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "secret.txt"), []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A symlink out of the web dir must not be followed.
	if err := os.Symlink(filepath.Join(root, "secret.txt"), filepath.Join(web, "link.txt")); err != nil {
		t.Fatal(err)
	}
	return web
}

func TestStaticContentTypesAndHeaders(t *testing.T) {
	dir := webDir(t)
	f := newFixture(t, func(c *Config) { c.WebDir = dir })
	cases := []struct {
		path, ctype, cache, swAllowed, body string
	}{
		{"/", "text/html; charset=utf-8", "no-cache", "", "<!doctype html>home"},
		{"/index.html", "text/html; charset=utf-8", "no-cache", "", "<!doctype html>home"},
		{"/sw.js", "text/javascript; charset=utf-8", "no-cache", "/", "self.x=1"},
		{"/app.js", "text/javascript; charset=utf-8", "", "", "console.log(1)"},
		{"/app.wasm", "application/wasm", "", "", "\x00asm"},
		{"/manifest.webmanifest", "application/manifest+json", "", "", "{}"},
		{"/bundle.nshc", "application/octet-stream", "", "", "NSHC"},
		{"/style.css", "text/css; charset=utf-8", "", "", "body{}"},
		{"/icon.png", "image/png", "", "", "\x89PNG"},
		{"/sub/", "text/html; charset=utf-8", "no-cache", "", "sub home"},
	}
	for _, c := range cases {
		r, body := get(t, f.srv.URL+c.path)
		if r.StatusCode != 200 || body != c.body {
			t.Errorf("%s: status %d body %q", c.path, r.StatusCode, body)
			continue
		}
		if got := r.Header.Get("Content-Type"); got != c.ctype {
			t.Errorf("%s: Content-Type %q, want %q", c.path, got, c.ctype)
		}
		if got := r.Header.Get("Cache-Control"); got != c.cache {
			t.Errorf("%s: Cache-Control %q, want %q", c.path, got, c.cache)
		}
		if got := r.Header.Get("Service-Worker-Allowed"); got != c.swAllowed {
			t.Errorf("%s: Service-Worker-Allowed %q, want %q", c.path, got, c.swAllowed)
		}
		if got := r.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options %q", c.path, got)
		}
	}
}

func TestStaticRefusesWhatIsNotInTheWebDir(t *testing.T) {
	dir := webDir(t)
	f := newFixture(t, func(c *Config) { c.WebDir = dir })
	for _, p := range []string{"/missing.js", "/../secret.txt", "/%2e%2e/secret.txt", "/link.txt", "/sub"} {
		r, body := get(t, f.srv.URL+p)
		if p == "/sub" {
			// a directory without its slash redirects, like net/http does
			if r.Request.URL.Path != "/sub/" {
				t.Errorf("%s: ended at %s", p, r.Request.URL.Path)
			}
			continue
		}
		if r.StatusCode != 404 || body == "outside" {
			t.Errorf("%s: status %d body %q", p, r.StatusCode, body)
		}
	}
}

func TestNoWebDirMeans404(t *testing.T) {
	f := newFixture(t, nil)
	if r, _ := get(t, f.srv.URL+"/"); r.StatusCode != 404 {
		t.Fatalf("status %d", r.StatusCode)
	}
}

// `nsh package` replaces the web dir with a new one; a running serve must show the new build.
func TestStaticFollowsAWebDirReplacedWhileServing(t *testing.T) {
	dir := webDir(t)
	f := newFixture(t, func(c *Config) { c.WebDir = dir })
	if r, _ := get(t, f.srv.URL+"/"); r.StatusCode != 200 {
		t.Fatalf("before: %d", r.StatusCode)
	}
	next := dir + ".next"
	if err := os.MkdirAll(next, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(next, "index.html"), []byte("new build"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(next, dir); err != nil {
		t.Fatal(err)
	}
	r, body := get(t, f.srv.URL+"/")
	if r.StatusCode != 200 || body != "new build" {
		t.Fatalf("after: %d %q, want 200 \"new build\"", r.StatusCode, body)
	}
}
