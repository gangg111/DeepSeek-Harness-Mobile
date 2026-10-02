package main

// API sterujące dla serwera dsh-code (node) na 127.0.0.1:<port z argumentu>:
//   GET  /status          -> stan węzła (BackendState, AuthURL, TailscaleIPs)
//   POST /probe {target}        -> {target, status, body|error}: GET https://<target>/__remote/api/info przez tsnet (limit 4 s)
//   POST /proxy {target, port}  -> {port, origin} lokalnego pośrednika dla komputera; `port` = zapamiętany
//                                  przez dsh-code (0 = dowolny); gdy zajęty, wraca inny i dsh-code go zapisuje
// Każde żądanie musi nieść nagłówek X-DSH-Secret równy sekretowi z env DSH_TSNET_SECRET (losuje go serwer
// dsh-code przy starcie), inaczej 403 — 127.0.0.1 widzą wszystkie apki na telefonie, a pośrednik wychodzi
// z tożsamością Tailscale użytkownika.

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

const probeTimeout = 4 * time.Second

type nodeState struct {
	mu  sync.RWMutex
	cur stateLine
}

func (n *nodeState) set(s stateLine) { n.mu.Lock(); n.cur = s; n.mu.Unlock() }
func (n *nodeState) get() stateLine  { n.mu.RLock(); defer n.mu.RUnlock(); return n.cur }

func controlHandler(state *nodeState, pool *proxyPool, secret string) http.Handler {
	return controlHandlerDial(state, pool, secret, pool.dial)
}

func controlHandlerDial(state *nodeState, pool *proxyPool, secret string, dial DialFunc) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, state.get())
	})
	mux.HandleFunc("POST /probe", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Target string `json:"target"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "treść nie jest JSON"})
			return
		}
		writeJSON(w, http.StatusOK, probeTarget(r.Context(), dial, strings.ToLower(strings.TrimSpace(body.Target)), probeTimeout))
	})
	mux.HandleFunc("POST /proxy", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Target string `json:"target"`
			Port   int    `json:"port"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "treść nie jest JSON"})
			return
		}
		if body.Port < 0 || body.Port > 65535 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "zły port"})
			return
		}
		p, err := pool.get(body.Target, body.Port)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"target": p.target, "port": p.port, "origin": p.localOrigin()})
	})
	auth := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !equalSecret(r.Header.Get(secretHeader), secret) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
			return
		}
		mux.ServeHTTP(w, r)
	})
	return loopbackOnly(auth)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
