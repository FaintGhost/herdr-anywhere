package connectphone

import (
	"errors"
	"testing"

	"tailscale.com/ipn/ipnstate"
)

func TestRouteOf(t *testing.T) {
	cases := []struct {
		name   string
		res    *ipnstate.PingResult
		err    error
		route  string
		relay  string
		failed bool
	}{
		{name: "a pong from an address is direct", res: &ipnstate.PingResult{Endpoint: "192.0.2.1:41641"}, route: "direct"},
		{name: "a pong with both is direct", res: &ipnstate.PingResult{Endpoint: "192.0.2.1:41641", DERPRegionCode: "tok"}, route: "direct"},
		{name: "a pong through a relay names it", res: &ipnstate.PingResult{DERPRegionCode: "tok"}, route: "relay", relay: "tok"},
		{name: "a relay without a code is still a relay", res: &ipnstate.PingResult{}, route: "relay"},
		{name: "the number an address's relay is given is not its name", res: &ipnstate.PingResult{DERPRegionID: 1, DERPRegionCode: "1"}, route: "relay"},
		{name: "a number with a letter is a name", res: &ipnstate.PingResult{DERPRegionCode: "r2"}, route: "relay", relay: "r2"},
		{name: "a ping that failed says nothing about the route", res: &ipnstate.PingResult{Err: "timeout"}, failed: true},
		{name: "an error says nothing about the route", err: errors.New("no"), failed: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			route, relay, err := routeOf(c.res, c.err)
			if (err != nil) != c.failed || route != c.route || relay != c.relay {
				t.Fatalf("got %q %q %v", route, relay, err)
			}
		})
	}
}
