package update

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ManifestFile is in every release: what it holds, signed. ManifestFile+".sig" is the signature, in base64.
const ManifestFile = "latest.json"

// PublicKey checks release manifests. Its private half signs releases and never leaves the release machine.
var PublicKey = mustKey("bdNmbEpXYChjjsP0zYnKTW4z+pHaT3DDvCDPbeBULhA=")

func mustKey(s string) ed25519.PublicKey {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) != ed25519.PublicKeySize {
		panic("update: the built-in key is not an Ed25519 public key")
	}
	return ed25519.PublicKey(b)
}

// Manifest says which files make a release.
type Manifest struct {
	Version string `json:"version"`
	Files   []File `json:"files"`
}

// File is one file of a release.
type File struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"` // hex
	Bytes  int64  `json:"bytes"`
}

// Sign returns the manifest's bytes and their signature, as they go into a release.
func Sign(key ed25519.PrivateKey, m Manifest) (body, sig []byte, err error) {
	body, err = json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	body = append(body, '\n')
	return body, []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(key, body)) + "\n"), nil
}

// Verify reads a manifest only if key signed exactly these bytes.
func Verify(key ed25519.PublicKey, body, sig []byte) (Manifest, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || len(raw) != ed25519.SignatureSize || !ed25519.Verify(key, body, raw) {
		return Manifest{}, errors.New("the release isn't signed by the Herdr Anywhere key")
	}
	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return Manifest{}, fmt.Errorf("reading the release: %w", err)
	}
	if _, ok := parts(m.Version); !ok {
		return Manifest{}, fmt.Errorf("the release names no version: %q", m.Version)
	}
	return m, nil
}
