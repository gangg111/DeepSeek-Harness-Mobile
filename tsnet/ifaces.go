package main

// Lista interfejsów przez ioctl SIOCGIFCONF: SELinux na Androidzie odmawia apkom netlinka
// (RTM_GETLINK/RTM_GETROUTE), którego używa net.Interfaces(), a ioctl na gnieździe przechodzi.
// IPv6 pomijamy (/proc/net/if_inet6 też jest nieczytelny).

import (
	"fmt"
	"net"
	"unsafe"

	"golang.org/x/sys/unix"
	"tailscale.com/net/netmon"
)

const ifreqSize = 40 // struct ifreq na linux/arm64: ifr_name[16] + union 24 B

func ioctlInterfaces() ([]netmon.Interface, error) {
	fd, err := unix.Socket(unix.AF_INET, unix.SOCK_DGRAM|unix.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("socket: %w", err)
	}
	defer unix.Close(fd)

	buf := make([]byte, 64*ifreqSize)
	var ifc struct {
		Len int32
		_   int32
		Buf uintptr
	}
	ifc.Len = int32(len(buf))
	ifc.Buf = uintptr(unsafe.Pointer(&buf[0]))
	if _, _, e := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), unix.SIOCGIFCONF, uintptr(unsafe.Pointer(&ifc))); e != 0 {
		return nil, fmt.Errorf("SIOCGIFCONF: %w", e)
	}
	var out []netmon.Interface
	for off := 0; off+ifreqSize <= int(ifc.Len); off += ifreqSize {
		name := string(buf[off : off+unix.IFNAMSIZ])
		if i := indexByte(name, 0); i >= 0 {
			name = name[:i]
		}
		ifr, err := unix.NewIfreq(name)
		if err != nil {
			continue
		}
		ni := &net.Interface{Name: name}
		if err := unix.IoctlIfreq(fd, unix.SIOCGIFINDEX, ifr); err == nil {
			ni.Index = int(ifr.Uint32())
		}
		if err := unix.IoctlIfreq(fd, unix.SIOCGIFFLAGS, ifr); err == nil {
			ni.Flags = linkFlags(ifr.Uint16())
		}
		if err := unix.IoctlIfreq(fd, unix.SIOCGIFMTU, ifr); err == nil {
			ni.MTU = int(ifr.Uint32())
		}
		var addrs []net.Addr
		if err := unix.IoctlIfreq(fd, unix.SIOCGIFADDR, ifr); err == nil {
			if ip, err := ifr.Inet4Addr(); err == nil {
				mask := net.CIDRMask(32, 32)
				if err := unix.IoctlIfreq(fd, unix.SIOCGIFNETMASK, ifr); err == nil {
					if m, err := ifr.Inet4Addr(); err == nil {
						mask = net.IPMask(m)
					}
				}
				addrs = append(addrs, &net.IPNet{IP: ip, Mask: mask})
			}
		}
		if addrs == nil {
			addrs = []net.Addr{} // nie-nil: netmon ma użyć tej listy, a nie wołać Addrs() przez netlink
		}
		out = append(out, netmon.Interface{Interface: ni, AltAddrs: addrs})
	}
	return out, nil
}

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func linkFlags(raw uint16) net.Flags {
	var f net.Flags
	if raw&unix.IFF_UP != 0 {
		f |= net.FlagUp
	}
	if raw&unix.IFF_RUNNING != 0 {
		f |= net.FlagRunning
	}
	if raw&unix.IFF_BROADCAST != 0 {
		f |= net.FlagBroadcast
	}
	if raw&unix.IFF_LOOPBACK != 0 {
		f |= net.FlagLoopback
	}
	if raw&unix.IFF_POINTOPOINT != 0 {
		f |= net.FlagPointToPoint
	}
	if raw&unix.IFF_MULTICAST != 0 {
		f |= net.FlagMulticast
	}
	return f
}
