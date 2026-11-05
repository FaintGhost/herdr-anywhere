package connecthost

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/tailscale/tailcat"
	"tailscale.com/types/key"

	"github.com/jt-wang/tailpocket/connectinvite"
)

const (
	DefaultTTL = 2 * time.Minute
	MaxTTL     = 15 * time.Minute
	// After a phone pairs, the window stays open this long so a phone whose reply got lost can retry.
	retryGrace = 10 * time.Second
	maxBody    = 4096
)

// Phone is a phone that joined through a pairing window.
type Phone struct {
	Key    string // "nodekey:…"
	Device string // the name the phone gave, cleaned
}

type PairOptions struct {
	// TTL bounds the window (default 2 minutes, at most 15).
	TTL time.Duration
	// Payload returns the app's own data for this phone (a token, settings, anything), delivered
	// with the reply inside the tunnel. It runs once per window. Nil sends no payload.
	Payload func(Phone) (string, error)
}

// Pairing is one open window. One phone can join it.
type Pairing struct {
	h       *Host
	inv     connectinvite.Invite
	payload func(Phone) (string, error)
	expires time.Time
	node    node
	server  *http.Server
	ln      *chanListener

	mu    sync.Mutex
	bound string
	reply *pairReply
	phone Phone

	joined   chan struct{}
	ended    chan struct{}
	joinOnce sync.Once
	endOnce  sync.Once
	timer    *time.Timer
}

type pairRequest struct {
	PhoneKey string `json:"phoneKey"`
	Device   string `json:"device"`
}

type pairReply struct {
	V       int    `json:"v"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	Name    string `json:"name"`
	Payload string `json:"payload,omitempty"`
}

// Pair opens a pairing window. Show p.QR(prefix) as a QR code, share it as a link, or call
// p.ServeLocal for same-Wi-Fi discovery; then p.Wait for the phone.
func (h *Host) Pair(ctx context.Context, opts PairOptions) (*Pairing, error) {
	ttl := opts.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if ttl > MaxTTL {
		ttl = MaxTTL
	}
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil, ErrClosed
	}
	region := h.id.region
	h.mu.Unlock()

	client := key.NewNode()
	clientText, _ := client.MarshalText()
	expires := time.Now().Add(ttl)
	p := &Pairing{h: h, payload: opts.Payload, expires: expires, ln: newChanListener(),
		joined: make(chan struct{}), ended: make(chan struct{})}
	n, err := h.start(ctx, nodeSpec{key: key.NewNode(), psk: tailcat.NewPresharedKey(), region: region,
		allowed: []key.NodePublic{client.Public()}, port: h.pairingPort, derpMapURL: h.derpMapURL,
		onTCP: func(port uint16) func(netConn) {
			if port != h.pairingPort {
				return nil
			}
			return func(c netConn) { p.ln.offer(c) }
		}})
	if err != nil {
		return nil, err
	}
	p.node = n
	p.inv = connectinvite.Invite{Version: connectinvite.Version, Address: n.Address(), Port: int(h.pairingPort), Key: string(clientText),
		Proof: connectinvite.NewProof(), ExpiresAt: expires.Unix(), Name: h.name}
	if err := p.inv.Validate(); err != nil {
		_ = n.Close()
		return nil, err
	}
	p.server = &http.Server{Handler: p, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = p.server.Serve(p.ln) }()
	p.mu.Lock()
	p.timer = time.AfterFunc(time.Until(expires), p.Close)
	p.mu.Unlock()
	h.mu.Lock()
	h.pairings[p] = struct{}{}
	h.mu.Unlock()
	return p, nil
}

// Invite is what the phone needs; holding it lets a phone pair until it expires.
func (p *Pairing) Invite() connectinvite.Invite { return p.inv }

// QR is the invite as text for a QR code or link, e.g. with connectinvite.DefaultPrefix.
func (p *Pairing) QR(prefix string) (string, error) { return connectinvite.Encode(p.inv, prefix) }

// Expires is when the window closes.
func (p *Pairing) Expires() time.Time { return p.expires }

// Wait returns the phone that joined, ErrExpired when the window closed first, or ctx.Err().
func (p *Pairing) Wait(ctx context.Context) (Phone, error) {
	select {
	case <-p.joined:
		p.mu.Lock()
		defer p.mu.Unlock()
		return p.phone, nil
	case <-p.ended:
		select {
		case <-p.joined:
			p.mu.Lock()
			defer p.mu.Unlock()
			return p.phone, nil
		default:
			return Phone{}, ErrExpired
		}
	case <-ctx.Done():
		return Phone{}, ctx.Err()
	}
}

// Done is closed when the window has closed (expired, Close, or after a phone joined).
func (p *Pairing) Done() <-chan struct{} { return p.ended }

// Close ends the window early. A phone that already joined stays paired.
func (p *Pairing) Close() {
	p.endOnce.Do(func() {
		p.mu.Lock()
		if p.timer != nil {
			p.timer.Stop()
		}
		p.mu.Unlock()
		if p.server != nil {
			_ = p.server.Close()
		}
		_ = p.ln.Close()
		if p.node != nil {
			_ = p.node.Close()
		}
		p.h.mu.Lock()
		delete(p.h.pairings, p)
		p.h.mu.Unlock()
		close(p.ended)
	})
}

func (p *Pairing) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.EscapedPath() != "/pair" || r.URL.RawQuery != "" {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+p.inv.Proof)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if len(body) > maxBody {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	var req pairRequest
	if json.Unmarshal(body, &req) != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	k, err := parsePhone(req.PhoneKey)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	phone := Phone{Key: k.String(), Device: connectinvite.CleanName(req.Device)}
	if phone.Device == "" {
		phone.Device = "Phone"
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.bound != "" && p.bound != phone.Key {
		w.WriteHeader(http.StatusConflict)
		return
	}
	if p.reply == nil {
		if !time.Now().Before(p.expires) {
			w.WriteHeader(http.StatusGone)
			return
		}
		payload := ""
		if p.payload != nil {
			if payload, err = p.payload(phone); err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		address, err := p.h.addPhone(r.Context(), k)
		if err != nil || address == "" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		p.bound, p.phone = phone.Key, phone
		p.reply = &pairReply{V: 1, Address: address, Port: int(p.h.port), Name: p.h.name, Payload: payload}
		p.joinOnce.Do(func() { close(p.joined) })
		if time.Until(p.expires) > retryGrace {
			p.timer.Reset(retryGrace)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(p.reply)
}
