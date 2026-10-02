package main

// Urządzenia z tailnetu (lc.Status().Peer) dla automatycznego wykrywania komputerów na ekranie Code.
// Lista idzie na stdout jako {"Peers":[…]} przy starcie i potem co 30 s, tylko gdy się zmieni.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"tailscale.com/ipn/ipnstate"
)

type peerInfo struct {
	DNSName  string `json:"DNSName"` // bez kropki na końcu, np. dsh-pc.tailfa0aad.ts.net
	HostName string `json:"HostName"`
	Online   bool   `json:"Online"`
	OS       string `json:"OS"`
}

// peersFromStatus: posortowana po DNSName lista urządzeń (bez nas samych).
func peersFromStatus(st *ipnstate.Status) []peerInfo {
	if st == nil {
		return nil
	}
	out := make([]peerInfo, 0, len(st.Peer))
	for _, p := range st.Peer {
		if p == nil || p.DNSName == "" {
			continue
		}
		out = append(out, peerInfo{DNSName: strings.TrimSuffix(p.DNSName, "."), HostName: p.HostName, Online: p.Online, OS: p.OS})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DNSName < out[j].DNSName })
	return out
}

func samePeers(a, b []peerInfo) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func emitPeers(peers []peerInfo) {
	b, _ := json.Marshal(struct {
		Peers []peerInfo `json:"Peers"`
	}{peers})
	fmt.Println(string(b))
}

// probeResult: odpowiedź komputera na GET https://<target>/__remote/api/info (dla dsh-code: czy to dsh-remote-control).
type probeResult struct {
	Target string          `json:"target"`
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// probeTarget: jedno zapytanie przez tsnet z limitem czasu; bez pośrednika, bez sekretu, bez ciasteczek.
func probeTarget(ctx context.Context, dial DialFunc, target string, timeout time.Duration) probeResult {
	r := probeResult{Target: target}
	if err := validTarget(target); err != nil {
		r.Error = err.Error()
		return r
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	client := &http.Client{Transport: &http.Transport{DialContext: dial, TLSHandshakeTimeout: timeout, ResponseHeaderTimeout: timeout, DisableKeepAlives: true}, Timeout: timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://"+target+"/__remote/api/info", nil)
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		r.Error = err.Error()
		return r
	}
	defer res.Body.Close()
	r.Status = res.StatusCode
	var body json.RawMessage
	if err := json.NewDecoder(http.MaxBytesReader(nil, res.Body, 64*1024)).Decode(&body); err == nil {
		r.Body = body
	}
	return r
}
