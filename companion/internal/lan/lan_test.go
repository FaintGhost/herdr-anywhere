package lan

import (
	"net"
	"net/netip"
	"slices"
	"testing"
)

func pfx(s ...string) []netip.Prefix {
	var out []netip.Prefix
	for _, x := range s {
		out = append(out, netip.MustParsePrefix(x))
	}
	return out
}

func TestPrivateIPv4Filter(t *testing.T) {
	up := net.FlagUp | net.FlagBroadcast | net.FlagMulticast
	ifaces := []Interface{
		{Name: "lo0", Flags: net.FlagUp | net.FlagLoopback, Addrs: pfx("127.0.0.1/8", "::1/128")},
		{Name: "en0", Flags: up, Addrs: pfx("fe80::1/64", "192.168.1.23/24", "fd00::5/64")},
		{Name: "en1", Flags: up, Addrs: pfx("10.0.0.7/8")},
		{Name: "en2", Flags: up, Addrs: pfx("172.20.1.2/16")},
		{Name: "en3", Flags: up, Addrs: pfx("172.32.0.1/16")},                 // public, just past 172.16/12
		{Name: "en4", Flags: up, Addrs: pfx("169.254.3.4/16")},                // link-local
		{Name: "en5", Flags: up, Addrs: pfx("100.100.1.1/10")},                // CGNAT (tailnets)
		{Name: "en6", Flags: up, Addrs: pfx("8.8.8.8/32")},                    // public
		{Name: "en7", Flags: net.FlagBroadcast, Addrs: pfx("192.168.9.9/24")}, // down
		{Name: "utun3", Flags: up | net.FlagPointToPoint, Addrs: pfx("10.8.0.2/32")},
		{Name: "awdl0", Flags: up, Addrs: pfx("192.168.50.1/24")},
		{Name: "llw0", Flags: up, Addrs: pfx("192.168.51.1/24")},
		{Name: "bridge100", Flags: up, Addrs: pfx("192.168.64.1/24")},
	}
	got := Addresses(ifaces)
	want := []netip.Addr{
		netip.MustParseAddr("192.168.1.23"),
		netip.MustParseAddr("10.0.0.7"),
		netip.MustParseAddr("172.20.1.2"),
	}
	if !slices.Equal(got, want) {
		t.Fatalf("Addresses = %v, want %v", got, want)
	}
}

func TestNoInterfacesNoAddresses(t *testing.T) {
	if got := Addresses(nil); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}
