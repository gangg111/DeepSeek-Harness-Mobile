package main

// Lokalny pośrednik: 127.0.0.1:<port> -> https://<komputer> przez tsnet (bez VPN w Androidzie).
// WebView i serwer dsh-code gadają po zwykłym HTTP z pętlą zwrotną; po drugiej stronie jest brama
// dsh-remote-* na komputerze za `tailscale serve` (TLS, nagłówek z tożsamością węzła).
//
// Przepisywanie: Host/Origin/Referer -> adres komputera; Location z adresu komputera -> lokalny;
// w Set-Cookie znika flaga Secure (WebView -> pośrednik to http). WebSocket przechodzi przez
// httputil.ReverseProxy (101 Switching Protocols). Wpuszczane są tylko połączenia z 127.0.0.1.

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Nagłówek z sekretem dla zapytań serwera dsh-code (zamiast ciasteczka); nigdy nie wychodzi do komputera.
const secretHeader = "X-DSH-Secret"

// Parametr zapytania, którym WebView wchodzi pierwszy raz: /?dshrk=<sekret>&dshOpen=<id>.
const secretQuery = "dshrk"

// DialFunc łączy się z komputerem (w produkcji: srv.Dial z tsnet; w testach: zwykły net.Dialer).
type DialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// retryingDial: tuż po przejściu węzła w Running MagicDNS bywa jeszcze puste („no such host”) —
// ponawiamy rozwiązywanie nazwy do ~8 s, zanim oddamy błąd.
func retryingDial(d DialFunc) DialFunc {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		var lastErr error
		for i := 0; i < 16; i++ {
			c, err := d(ctx, network, addr)
			if err == nil {
				return c, nil
			}
			lastErr = err
			if !strings.Contains(err.Error(), "no such host") || ctx.Err() != nil {
				return nil, err
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
		return nil, lastErr
	}
}

type deviceProxy struct {
	target  string // host[:port] komputera, np. dsh-pc.tailfa0aad.ts.net
	port    int    // lokalny port pośrednika (stały na urządzenie; dsh-code zapisuje go w dsh-code.json)
	secret  string // sekret wspólny z serwerem dsh-code (env), porównywany w stałym czasie
	session string // losowa wartość ciasteczka sesji WebView dla tego pośrednika
	ln      net.Listener
	srv     *http.Server
}

// newDeviceProxy odpala pośrednika dla jednego komputera na żądanym porcie; gdy port jest zajęty
// (albo 0), bierze efemeryczny — wołający odczytuje p.port i zapisuje go.
func newDeviceProxy(target string, port int, secret string, dial DialFunc, tlsCfg *tls.Config) (*deviceProxy, error) {
	if err := validTarget(target); err != nil {
		return nil, err
	}
	if secret == "" {
		return nil, errors.New("pośrednik wymaga sekretu")
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil && port != 0 {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return nil, err
	}
	p := &deviceProxy{target: target, port: ln.Addr().(*net.TCPAddr).Port, secret: secret, session: randomHex(32), ln: ln}
	p.srv = &http.Server{Handler: loopbackOnly(p.guard(p.handler(dial, tlsCfg))), ReadHeaderTimeout: 30 * time.Second}
	go p.srv.Serve(ln)
	return p, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func equalSecret(a, b string) bool {
	return a != "" && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// cookieName: ciasteczka nie rozróżniają portu (127.0.0.1:5001 i :5002 dzielą jar), więc nazwa niesie port.
func (p *deviceProxy) cookieName() string { return fmt.Sprintf("dshrk-%d", p.port) }

// guard: sesja pośrednika. Wejście z ?dshrk=<sekret> ustawia ciasteczko sesji i przekierowuje bez dshrk;
// nagłówek X-DSH-Secret (serwer dsh-code) przepuszcza bez ciasteczka; reszta bez ważnego ciasteczka -> 403.
// Sekret i ciasteczka sesji są usuwane z żądania przed przekazaniem do komputera.
func (p *deviceProxy) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has(secretQuery) {
			q := r.URL.Query()
			ok := equalSecret(q.Get(secretQuery), p.secret)
			q.Del(secretQuery)
			if !ok {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: p.cookieName(), Value: p.session, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			u := *r.URL
			u.RawQuery = q.Encode()
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, u.RequestURI(), http.StatusSeeOther)
			return
		}
		viaHeader := equalSecret(r.Header.Get(secretHeader), p.secret)
		viaCookie := false
		if c, err := r.Cookie(p.cookieName()); err == nil {
			viaCookie = equalSecret(c.Value, p.session)
		}
		if !viaHeader && !viaCookie {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		r.Header.Del(secretHeader)
		stripOwnCookies(r)
		next.ServeHTTP(w, r)
	})
}

// stripOwnCookies usuwa z nagłówka Cookie ciasteczka sesji pośredników (dshrk-*); reszta idzie do komputera bez zmian.
func stripOwnCookies(r *http.Request) {
	raw := r.Header.Values("Cookie")
	if len(raw) == 0 {
		return
	}
	var keep []string
	for _, line := range raw {
		for _, part := range strings.Split(line, ";") {
			part = strings.TrimSpace(part)
			if part == "" || strings.HasPrefix(part, "dshrk-") {
				continue
			}
			keep = append(keep, part)
		}
	}
	r.Header.Del("Cookie")
	if len(keep) > 0 {
		r.Header.Set("Cookie", strings.Join(keep, "; "))
	}
}

func (p *deviceProxy) localOrigin() string  { return fmt.Sprintf("http://127.0.0.1:%d", p.port) }
func (p *deviceProxy) remoteOrigin() string { return "https://" + p.target }

func (p *deviceProxy) handler(dial DialFunc, tlsCfg *tls.Config) http.Handler {
	upstream := &url.URL{Scheme: "https", Host: p.target}
	rp := httputil.NewSingleHostReverseProxy(upstream)
	rp.Transport = &http.Transport{
		DialContext:           dial,
		TLSClientConfig:       tlsCfg,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          8,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   90 * time.Second, // pierwszy uścisk: komputer może dopiero wystawiać certyfikat Let's Encrypt
		ResponseHeaderTimeout: 60 * time.Second,
	}
	director := rp.Director
	rp.Director = func(req *http.Request) {
		director(req)
		req.Host = p.target
		for _, h := range []string{"Origin", "Referer"} {
			if v := req.Header.Get(h); v != "" {
				req.Header.Set(h, p.swapOrigin(v, p.localOrigin(), p.remoteOrigin()))
			}
		}
		// Komputer nie ma wiedzieć o lokalnym porcie; proxy-nagłówki od WebView nie są potrzebne.
		req.Header["X-Forwarded-For"] = nil // nil (nie Del): tak ReverseProxy nie dokleja adresu klienta
		req.Header.Del("X-Forwarded-Host")
		req.Header.Del("X-Forwarded-Proto")
	}
	rp.ModifyResponse = func(res *http.Response) error {
		for _, h := range []string{"Location", "Content-Location"} {
			if v := res.Header.Get(h); v != "" {
				res.Header.Set(h, p.swapOrigin(v, p.remoteOrigin(), p.localOrigin()))
			}
		}
		if cookies := res.Header.Values("Set-Cookie"); len(cookies) > 0 {
			res.Header.Del("Set-Cookie")
			for _, c := range cookies {
				res.Header.Add("Set-Cookie", stripSecure(c))
			}
		}
		return nil
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		code := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			code = http.StatusGatewayTimeout
		}
		log.Printf("pośrednik %s: %s %s: %v", p.target, r.Method, r.URL.Path, err) // bez query (tam bywa dshrk)
		http.Error(w, "dsh-tsnet-mobile: "+err.Error(), code)
	}
	return rp
}

// swapOrigin zamienia prefiks `from` (porównanie bez wielkości liter) na `to`; inne adresy bez zmian.
func (p *deviceProxy) swapOrigin(v, from, to string) string {
	if len(v) >= len(from) && strings.EqualFold(v[:len(from)], from) && (len(v) == len(from) || v[len(from)] == '/' || v[len(from)] == '?' || v[len(from)] == '#') {
		return to + v[len(from):]
	}
	return v
}

var secureAttr = regexp.MustCompile(`(?i);\s*secure\s*(?:;|$)`)

// stripSecure usuwa atrybut Secure z nagłówka Set-Cookie, resztę zostawia bajt w bajt.
func stripSecure(c string) string {
	return secureAttr.ReplaceAllStringFunc(c, func(m string) string {
		if strings.HasSuffix(m, ";") {
			return ";"
		}
		return ""
	})
}

// loopbackOnly odrzuca wszystko, co nie przyszło z 127.0.0.1 (listener i tak jest na pętli zwrotnej; pas i szelki).
func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isLoopback(r.RemoteAddr) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

var targetRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$`)

func validTarget(t string) error {
	if !targetRe.MatchString(strings.ToLower(t)) {
		return fmt.Errorf("nieprawidłowy adres komputera: %q", t)
	}
	return nil
}

func (p *deviceProxy) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	p.srv.Shutdown(ctx)
}

// proxyPool: jeden pośrednik na komputer, ten sam port przy ponownym pytaniu.
type proxyPool struct {
	mu     sync.Mutex
	dial   DialFunc
	tlsCfg *tls.Config
	secret string
	byHost map[string]*deviceProxy
}

func newProxyPool(dial DialFunc, tlsCfg *tls.Config, secret string) *proxyPool {
	return &proxyPool{dial: dial, tlsCfg: tlsCfg, secret: secret, byHost: map[string]*deviceProxy{}}
}

// get zwraca pośrednika dla komputera; `port` to port zapamiętany przez dsh-code (0 = dowolny).
func (pp *proxyPool) get(target string, port int) (*deviceProxy, error) {
	target = strings.ToLower(strings.TrimSpace(target))
	pp.mu.Lock()
	defer pp.mu.Unlock()
	if p, ok := pp.byHost[target]; ok {
		return p, nil
	}
	p, err := newDeviceProxy(target, port, pp.secret, pp.dial, pp.tlsCfg)
	if err != nil {
		return nil, err
	}
	pp.byHost[target] = p
	return p, nil
}

func (pp *proxyPool) closeAll() {
	pp.mu.Lock()
	defer pp.mu.Unlock()
	for h, p := range pp.byHost {
		p.close()
		delete(pp.byHost, h)
	}
}
