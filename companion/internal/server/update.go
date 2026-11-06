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
	// Checks is "ask", "on" or "off": whether the computer asks GitHub each day.
	Checks() string
	SetChecks(bool) error
	// CheckNow asks GitHub once and returns the newest version.
	CheckNow(context.Context) (string, error)
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

// onOff reads a paired phone's {"on": bool}, answering for it when that fails.
func (s *Server) onOff(w http.ResponseWriter, r *http.Request) (Updates, bool, bool) {
	if !s.device(w, r) {
		return nil, false, false
	}
	u := s.cfg.Updates
	if u == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "updates aren't available"})
		return nil, false, false
	}
	var body struct {
		On *bool `json:"on"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil || body.On == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "on is required"})
		return nil, false, false
	}
	return u, *body.On, true
}

func (s *Server) updateAuto(w http.ResponseWriter, r *http.Request) {
	u, on, ok := s.onOff(w, r)
	if !ok {
		return
	}
	if err := u.SetAuto(on); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"on": on})
}

// updateChecks stores the person's answer: whether the computer asks GitHub about new releases each day.
func (s *Server) updateChecks(w http.ResponseWriter, r *http.Request) {
	u, on, ok := s.onOff(w, r)
	if !ok {
		return
	}
	if err := u.SetChecks(on); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"checks": u.Checks()})
}

// updateCheck asks GitHub once, now, because the person tapped Check.
func (s *Server) updateCheck(w http.ResponseWriter, r *http.Request) {
	if !s.device(w, r) {
		return
	}
	u := s.cfg.Updates
	if u == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "updates aren't available"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	v, err := u.CheckNow(ctx)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"latest": v})
}
