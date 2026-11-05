// Package lan finds the Mac's private IPv4 LAN addresses, the ones a phone on
// the same Wi-Fi can reach.
package lan

import (
	"net"
	"net/netip"
	"strings"
)

// Interface is the part of a network interface the filter looks at.
type Interface struct {
	Name  string
	Flags net.Flags
	Addrs []netip.Prefix
}

// Tunnels (utun: VPNs and tailnets), Apple Wireless Direct Link, low-latency
// WLAN and VM bridges are not the LAN a phone is on.
var skipped = []string{"utun", "awdl", "llw", "bridge"}

var private = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"),
}

// Addresses returns the RFC 1918 IPv4 addresses of interfaces that are up,
// in interface order. Loopback, link-local, CGNAT (100.64/10) and public
// addresses are left out, as are the interfaces named in skipped.
func Addresses(ifaces []Interface) []netip.Addr {
	var out []netip.Addr
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 || isSkipped(i.Name) {
			continue
		}
		for _, p := range i.Addrs {
			a := p.Addr().Unmap()
			if a.Is4() && isPrivate(a) {
				out = append(out, a)
			}
		}
	}
	return out
}

func isSkipped(name string) bool {
	for _, s := range skipped {
		if strings.HasPrefix(name, s) {
			return true
		}
	}
	return false
}

func isPrivate(a netip.Addr) bool {
	for _, p := range private {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// System reads this machine's interfaces.
func System() ([]Interface, error) {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var out []Interface
	for _, i := range ifs {
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		li := Interface{Name: i.Name, Flags: i.Flags}
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok {
				ip, ok := netip.AddrFromSlice(n.IP)
				if !ok {
					continue
				}
				ones, _ := n.Mask.Size()
				li.Addrs = append(li.Addrs, netip.PrefixFrom(ip.Unmap(), ones))
			}
		}
		out = append(out, li)
	}
	return out, nil
}

// SystemAddresses is Addresses(System()).
func SystemAddresses() ([]netip.Addr, error) {
	ifs, err := System()
	if err != nil {
		return nil, err
	}
	return Addresses(ifs), nil
}
