package server

import (
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
)

// Set here rather than taken from the system's mime tables, which differ
// between machines and lack .webmanifest and .nshc.
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".map":         "application/json",
	".wasm":        "application/wasm",
	".webmanifest": "application/manifest+json",
	".nshc":        "application/octet-stream",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".svg":         "image/svg+xml",
	".ico":         "image/x-icon",
	".webp":        "image/webp",
	".woff2":       "font/woff2",
	".txt":         "text/plain; charset=utf-8",
}

func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if t, ok := contentTypes[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}

// static serves files from one directory. os.Root keeps every open inside
// it, symlinks included. The root is opened per request: `nsh package`
// replaces the directory, and a handle to the old one would serve nothing.
type static struct{ dir string }

func newStatic(dir string) (*static, error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	root.Close()
	return &static{dir: dir}, nil
}

func (s *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	name := strings.TrimPrefix(clean, "/")
	if name == "" {
		name = "."
	}
	root, err := os.OpenRoot(s.dir)
	if err != nil {
		notFound(w, err)
		return
	}
	defer root.Close()
	info, err := root.Stat(name)
	if err != nil {
		notFound(w, err)
		return
	}
	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			http.Redirect(w, r, strings.TrimSuffix(clean, "/")+"/", http.StatusMovedPermanently)
			return
		}
		name = path.Join(name, "index.html")
	}
	f, err := root.Open(name)
	if err != nil {
		notFound(w, err)
		return
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil || info.IsDir() {
		notFound(w, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType(name))
	h.Set("X-Content-Type-Options", "nosniff")
	switch base := path.Base(name); {
	case base == "index.html":
		h.Set("Cache-Control", "no-cache")
	case name == "sw.js":
		h.Set("Cache-Control", "no-cache")
		h.Set("Service-Worker-Allowed", "/")
	}
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// notFound answers 404 for missing files and for refused ones alike (a path
// or symlink leading out of the root), so the reply says nothing about what
// lies outside.
func notFound(w http.ResponseWriter, _ error) {
	http.Error(w, "not found", http.StatusNotFound)
}
