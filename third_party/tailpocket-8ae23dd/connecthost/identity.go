package connecthost

import (
	"encoding/json"

	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/key"
)

// identity is the main node's key, pre-shared key and relay region; together they fix its address.
type identity struct {
	key    key.NodePrivate
	psk    tailcat.PresharedKey
	region *tailcfg.DERPRegion // nil until the first start picks the nearest region
}

type identityDoc struct {
	V      int                 `json:"v"`
	Key    string              `json:"key"`
	PSK    string              `json:"psk"`
	Region *tailcfg.DERPRegion `json:"region,omitempty"`
}

func newIdentity() identity { return identity{key: key.NewNode(), psk: tailcat.NewPresharedKey()} }

func parseIdentity(text string) (identity, error) {
	bad := ErrInvalidIdentity
	var doc identityDoc
	if json.Unmarshal([]byte(text), &doc) != nil || doc.V != 1 {
		return identity{}, bad
	}
	var id identity
	if id.key.UnmarshalText([]byte(doc.Key)) != nil || id.key.IsZero() {
		return identity{}, bad
	}
	if id.psk.UnmarshalText([]byte(doc.PSK)) != nil || id.psk.IsZero() {
		return identity{}, bad
	}
	if doc.Region != nil {
		if doc.Region.RegionID == 0 || len(doc.Region.Nodes) == 0 {
			return identity{}, bad
		}
		id.region = doc.Region
	}
	return id, nil
}

func (id identity) String() string {
	k, _ := id.key.MarshalText()
	p, _ := id.psk.MarshalText()
	body, _ := json.Marshal(identityDoc{V: 1, Key: string(k), PSK: string(p), Region: id.region})
	return string(body)
}
