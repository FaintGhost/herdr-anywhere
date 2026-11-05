package server

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// folderFixture is a server whose home holds src/{api,web(.git)}, a file and a hidden folder.
func folderFixture(t *testing.T) (*fixture, string, string) {
	t.Helper()
	home := t.TempDir()
	for _, d := range []string{"src/api", "src/Web/.git", "src/.cache", "notes"} {
		if err := os.MkdirAll(filepath.Join(home, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(home, "src", "README.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := newFixture(t, func(c *Config) { c.Home = home })
	_, token := f.pair(t)
	return f, home, token
}

func folders(t *testing.T, f *fixture, token, path string, extra ...string) (int, map[string]any) {
	t.Helper()
	q := "?path=" + url.QueryEscape(path)
	for _, e := range extra {
		q += "&" + e
	}
	req, _ := http.NewRequest("GET", f.srv.URL+"/api/folders"+q, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	return r.StatusCode, body
}

func TestFoldersNeedsAPairedDevice(t *testing.T) {
	f, _, _ := folderFixture(t)
	if code, _ := folders(t, f, "", "~"); code != http.StatusUnauthorized {
		t.Fatalf("no token: %d, want 401", code)
	}
	if code, _ := folders(t, f, "not-a-token", "~"); code != http.StatusUnauthorized {
		t.Fatalf("unknown token: %d, want 401", code)
	}
}

func TestFoldersListsSubfoldersOnly(t *testing.T) {
	f, home, token := folderFixture(t)
	code, body := folders(t, f, token, "~/src")
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	if body["path"] != filepath.Join(home, "src") || body["home"] != home || body["parent"] != home {
		t.Fatalf("path %v, home %v, parent %v", body["path"], body["home"], body["parent"])
	}
	// Folders only, hidden ones left out, sorted ignoring case; a folder holding .git is a repository.
	got, _ := json.Marshal(body["folders"])
	if want := `[{"git":false,"name":"api"},{"git":true,"name":"Web"}]`; string(got) != want {
		t.Fatalf("folders %s, want %s", got, want)
	}
}

func TestFoldersListsHiddenOnesWhenAsked(t *testing.T) {
	f, _, token := folderFixture(t)
	code, body := folders(t, f, token, "~/src", "hidden=1")
	if code != 200 {
		t.Fatalf("status %d: %v", code, body)
	}
	// The phone's "Show hidden": dot folders too, marked, in the same order.
	got, _ := json.Marshal(body["folders"])
	if want := `[{"git":false,"hidden":true,"name":".cache"},{"git":false,"name":"api"},{"git":true,"name":"Web"}]`; string(got) != want {
		t.Fatalf("folders %s, want %s", got, want)
	}
}

func TestFoldersEmptyPathIsHome(t *testing.T) {
	f, home, token := folderFixture(t)
	code, body := folders(t, f, token, "")
	if code != 200 || body["path"] != home {
		t.Fatalf("status %d, path %v, want %s", code, body["path"], home)
	}
}

func TestFoldersSaysWhenAFolderIsMissing(t *testing.T) {
	f, home, token := folderFixture(t)
	code, body := folders(t, f, token, "~/src/apii")
	if code != http.StatusNotFound || body["missing"] != true || body["path"] != filepath.Join(home, "src", "apii") {
		t.Fatalf("status %d, body %v", code, body)
	}
	// The nearest folder that does exist, so the app can offer to create the rest from there.
	if body["existing"] != filepath.Join(home, "src") {
		t.Fatalf("existing %v, want %s", body["existing"], filepath.Join(home, "src"))
	}
}

func TestFoldersRefusesAFileOrARelativePath(t *testing.T) {
	f, _, token := folderFixture(t)
	if code, _ := folders(t, f, token, "~/src/README.md"); code != http.StatusBadRequest {
		t.Fatalf("a file: %d, want 400", code)
	}
	if code, _ := folders(t, f, token, "src"); code != http.StatusBadRequest {
		t.Fatalf("a relative path: %d, want 400", code)
	}
}

func TestCreateFolderMakesTheMissingParts(t *testing.T) {
	f, home, token := folderFixture(t)
	r, body := post(t, f.srv.URL+"/api/folders", `{"path":"~/src/new/app"}`, "Authorization", "Bearer "+token)
	if r.StatusCode != 200 {
		t.Fatalf("status %d: %s", r.StatusCode, body)
	}
	var got map[string]any
	_ = json.Unmarshal([]byte(body), &got)
	want := filepath.Join(home, "src", "new", "app")
	if got["path"] != want || got["created"] != true {
		t.Fatalf("body %v", got)
	}
	if st, err := os.Stat(want); err != nil || !st.IsDir() {
		t.Fatalf("not created: %v", err)
	}
	// Asked again, it is already there.
	_, body = post(t, f.srv.URL+"/api/folders", `{"path":"~/src/new/app"}`, "Authorization", "Bearer "+token)
	_ = json.Unmarshal([]byte(body), &got)
	if got["created"] != false {
		t.Fatalf("second time: %v", got)
	}
}

func TestCreateFolderNeedsAPairedDeviceAndAnAbsolutePath(t *testing.T) {
	f, home, token := folderFixture(t)
	if r, _ := post(t, f.srv.URL+"/api/folders", `{"path":"~/x"}`); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d, want 401", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(home, "x")); err == nil {
		t.Fatal("created without a token")
	}
	if r, _ := post(t, f.srv.URL+"/api/folders", `{"path":"x/y"}`, "Authorization", "Bearer "+token); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("relative: %d, want 400", r.StatusCode)
	}
	if r, _ := post(t, f.srv.URL+"/api/folders", `{"path":"~/src/README.md/x"}`, "Authorization", "Bearer "+token); r.StatusCode != http.StatusConflict {
		t.Fatalf("under a file: %d, want 409", r.StatusCode)
	}
	if r, _ := post(t, f.srv.URL+"/api/folders", `{"path":"~/y"}`, "Authorization", "Bearer "+token, "Origin", "http://evil.example"); r.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin: %d, want 403", r.StatusCode)
	}
}
