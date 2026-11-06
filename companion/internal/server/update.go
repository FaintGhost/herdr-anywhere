package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"herdr-anywhere/companion/internal/update"
)

// Updates is what the phone can ask of the companion about new versions (internal/update.Manager, with Restart).
type Updates interface {
	Latest() string
	App() update.App
	CanInstall() bool
	Auto() bool
	SetAuto(bool) error
	ApplyLatest(context.Context) (string, error)
	// Restart runs the new file. Called after the phone has its answer.
	Restart()
}

// update installs the newest release, at the request of a paired phone. A paired phone can already run any command
// here, so this gives it nothing new; what it runs is the release, checked against the release's digest.
func (s *Server) update(w http.ResponseWriter, r *http.Request) {
	if !s.device(w, r) {
		return
	}
	u := s.cfg.Updates
	if u == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "updates aren't available"})
		return
	}
	// The phone's going away doesn't stop a download halfway: it runs on its own clock.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
	defer cancel()
	v, err := u.ApplyLatest(ctx)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]string{"version": v})
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.AfterFunc(300*time.Millisecond, u.Restart)
	case errors.Is(err, update.ErrNoUpdate), errors.Is(err, update.ErrBusy):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	case errors.Is(err, update.ErrNotHere):
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": err.Error()})
	default:
		s.log.Printf("update: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
	}
}

func (s *Server) updateAuto(w http.ResponseWriter, r *http.Request) {
	if !s.device(w, r) {
		return
	}
	u := s.cfg.Updates
	if u == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "updates aren't available"})
		return
	}
	var body struct {
		On *bool `json:"on"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil || body.On == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "on is required"})
		return
	}
	if err := u.SetAuto(*body.On); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"on": *body.On})
}
