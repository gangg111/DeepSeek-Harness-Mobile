package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/types/key"
)

// „Komputer”: serwer TLS httptest; dial pośrednika zawsze trafia w niego, niezależnie od adresu docelowego.
func startFakePC(t *testing.T) (*httptest.Server, DialFunc, *tls.Config) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/echo", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"host": r.Host, "origin": r.Header.Get("Origin"), "referer": r.Header.Get("Referer"), "xff": r.Header.Get("X-Forwarded-For"), "cookie": r.Header.Get("Cookie"), "secret": r.Header.Get(secretHeader)})
	})
	mux.HandleFunc("/redirect", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://example.com/?dshOpen=abc")
		w.WriteHeader(302)
	})
	mux.HandleFunc("/redirect-other", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://login.tailscale.com/a/x")
		w.WriteHeader(302)
	})
	mux.HandleFunc("/cookie", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "dsh-auth-x=v1.abc; Path=/; Secure; HttpOnly; SameSite=Strict")
		w.Header().Add("Set-Cookie", "plain=1; Path=/; Secure")
		w.Header().Add("Set-Cookie", "nosec=2; Path=/; HttpOnly")
		w.WriteHeader(204)
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			http.Error(w, "nie websocket", 400)
			return
		}
		conn, rw, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Errorf("hijack: %v", err)
			return
		}
		defer conn.Close()
		fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Seen-Origin: %s\r\n\r\n", r.Header.Get("Origin"))
		rw.Flush()
		line, _ := rw.ReadString('\n')
		rw.WriteString("echo:" + line)
		rw.Flush()
	})
	srv := httptest.NewTLSServer(mux)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	tlsCfg := srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	tlsCfg.ServerName = "example.com" // certyfikat httptest ma SAN example.com
	return srv, dial, tlsCfg
}

const testSecret = "sekret-testowy-0123456789abcdef"

func startProxy(t *testing.T) *deviceProxy {
	t.Helper()
	_, dial, tlsCfg := startFakePC(t)
	p, err := newDeviceProxy("example.com", 0, testSecret, dial, tlsCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.close)
	return p
}

// withSecret: żądanie jak z serwera dsh-code (nagłówek z sekretem, bez ciasteczka).
func withSecret(req *http.Request) *http.Request {
	req.Header.Set(secretHeader, testSecret)
	return req
}

// sessionClient: klient jak WebView po wejściu z ?dshrk= (ma ciasteczko sesji, nie podąża za przekierowaniami).
func sessionClient(t *testing.T, p *deviceProxy) *http.Client {
	t.Helper()
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := c.Get(p.localOrigin() + "/?" + secretQuery + "=" + testSecret + "&dshOpen=abc")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 303 {
		t.Fatalf("wejście z dshrk: status %d", res.StatusCode)
	}
	if got := res.Header.Get("Location"); got != "/?dshOpen=abc" {
		t.Fatalf("przekierowanie ma być bez dshrk: %q", got)
	}
	var sess *http.Cookie
	for _, ck := range res.Cookies() {
		if ck.Name == p.cookieName() {
			sess = ck
		}
	}
	if sess == nil || sess.Value == "" || !sess.HttpOnly || sess.SameSite != http.SameSiteStrictMode || sess.Domain != "" {
		t.Fatalf("ciasteczko sesji złe: %+v", sess)
	}
	if sess.Value == testSecret {
		t.Fatal("ciasteczko nie może być samym sekretem")
	}
	jar := &staticJar{cookie: sess}
	return &http.Client{Jar: jar, CheckRedirect: c.CheckRedirect}
}

type staticJar struct{ cookie *http.Cookie }

func (j *staticJar) SetCookies(*url.URL, []*http.Cookie) {}
func (j *staticJar) Cookies(*url.URL) []*http.Cookie     { return []*http.Cookie{j.cookie} }

func TestRewritesHostOriginReferer(t *testing.T) {
	p := startProxy(t)
	req, _ := http.NewRequest("GET", p.localOrigin()+"/echo", nil)
	req.Header.Set("Origin", p.localOrigin())
	req.Header.Set("Referer", p.localOrigin()+"/?dshOpen=1")
	req.Header.Set("Cookie", "dsh-auth-x=v1.abc")
	res, err := http.DefaultClient.Do(withSecret(req))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	json.NewDecoder(res.Body).Decode(&got)
	if got["host"] != "example.com" || got["origin"] != "https://example.com" || got["referer"] != "https://example.com/?dshOpen=1" {
		t.Fatalf("nagłówki nie przepisane: %+v", got)
	}
	if got["xff"] != "" {
		t.Fatalf("X-Forwarded-For ma nie wychodzić: %+v", got)
	}
	if got["cookie"] != "dsh-auth-x=v1.abc" {
		t.Fatalf("cookie ma przejść bez zmian: %+v", got)
	}
}

func TestRewritesLocationOnlyForTarget(t *testing.T) {
	p := startProxy(t)
	c := sessionClient(t, p)
	res, err := c.Get(p.localOrigin() + "/redirect")
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Header.Get("Location"); got != p.localOrigin()+"/?dshOpen=abc" {
		t.Fatalf("Location = %q", got)
	}
	res, _ = c.Get(p.localOrigin() + "/redirect-other")
	if got := res.Header.Get("Location"); got != "https://login.tailscale.com/a/x" {
		t.Fatalf("obcy Location zmieniony: %q", got)
	}
}

func TestStripsSecureFromSetCookie(t *testing.T) {
	p := startProxy(t)
	res, err := sessionClient(t, p).Get(p.localOrigin() + "/cookie")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"dsh-auth-x=v1.abc; Path=/; HttpOnly; SameSite=Strict", "plain=1; Path=/", "nosec=2; Path=/; HttpOnly"}
	got := res.Header.Values("Set-Cookie")
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("Set-Cookie:\n got %q\nwant %q", got, want)
	}
}

func TestWebSocketPassthrough(t *testing.T) {
	p := startProxy(t)
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", p.port), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprintf(conn, "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nOrigin: %s\r\nCookie: %s=%s; dsh-auth-x=v1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n", p.port, p.localOrigin(), p.cookieName(), p.session)
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 101 {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("status %d: %s", res.StatusCode, b)
	}
	if got := res.Header.Get("X-Seen-Origin"); got != "https://example.com" {
		t.Fatalf("Origin przy upgrade = %q", got)
	}
	fmt.Fprintf(conn, "ping\n")
	line, err := br.ReadString('\n')
	if err != nil || line != "echo:ping\n" {
		t.Fatalf("echo = %q, %v", line, err)
	}
}

func TestRejectsNonLoopback(t *testing.T) {
	h := loopbackOnly(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	for addr, want := range map[string]int{"127.0.0.1:5000": 200, "[::1]:5000": 200, "10.0.0.5:5000": 403, "192.168.117.23:1": 403, "zle": 403} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = addr
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s -> %d, chcę %d", addr, rec.Code, want)
		}
	}
}

func TestControlAPI(t *testing.T) {
	_, dial, tlsCfg := startFakePC(t)
	pool := newProxyPool(dial, tlsCfg, testSecret)
	t.Cleanup(pool.closeAll)
	st := &nodeState{}
	st.set(stateLine{BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/1"})
	ts := httptest.NewServer(controlHandler(st, pool, testSecret))
	t.Cleanup(ts.Close)

	res, _ := http.Get(ts.URL + "/status")
	if res.StatusCode != 403 {
		t.Fatalf("bez sekretu: %d", res.StatusCode)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/status", nil)
	req.Header.Set(secretHeader, "zly-sekret")
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 403 {
		t.Fatalf("zły sekret: %d", res.StatusCode)
	}
	req, _ = http.NewRequest("GET", ts.URL+"/status", nil)
	res, _ = http.DefaultClient.Do(withSecret(req))
	var s stateLine
	json.NewDecoder(res.Body).Decode(&s)
	if s.BackendState != "NeedsLogin" || s.AuthURL == "" {
		t.Fatalf("status: %+v", s)
	}
	post := func(body string) (int, map[string]any) {
		req, _ := http.NewRequest("POST", ts.URL+"/proxy", strings.NewReader(body))
		res, err := http.DefaultClient.Do(withSecret(req))
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		json.NewDecoder(res.Body).Decode(&m)
		return res.StatusCode, m
	}
	code, m1 := post(`{"target":"example.com"}`)
	if code != 200 || m1["port"].(float64) == 0 {
		t.Fatalf("proxy: %d %+v", code, m1)
	}
	_, m2 := post(`{"target":"EXAMPLE.com"}`)
	if m1["port"] != m2["port"] {
		t.Fatalf("ten sam komputer ma dostać ten sam port: %v vs %v", m1["port"], m2["port"])
	}
	if code, m := post(`{"target":"https://x/../y"}`); code != 400 {
		t.Fatalf("zły adres przyjęty: %d %+v", code, m)
	}
	// Stały port na urządzenie: zapamiętany port jest honorowany, a zajęty zastępowany innym.
	busy, _ := net.Listen("tcp", "127.0.0.1:0")
	t.Cleanup(func() { busy.Close() })
	busyPort := busy.Addr().(*net.TCPAddr).Port
	_, m3 := post(fmt.Sprintf(`{"target":"pc-b.example.com","port":%d}`, busyPort))
	if int(m3["port"].(float64)) == busyPort || m3["port"].(float64) == 0 {
		t.Fatalf("zajęty port ma być zastąpiony innym: %+v", m3)
	}
	free, _ := net.Listen("tcp", "127.0.0.1:0")
	freePort := free.Addr().(*net.TCPAddr).Port
	free.Close()
	_, m4 := post(fmt.Sprintf(`{"target":"pc-c.example.com","port":%d}`, freePort))
	if int(m4["port"].(float64)) != freePort {
		t.Fatalf("wolny zapamiętany port ma być użyty: chcę %d, jest %v", freePort, m4["port"])
	}
	// Pośrednik z API naprawdę przekazuje do „komputera”.
	req, _ = http.NewRequest("GET", fmt.Sprintf("%s/echo", m1["origin"]), nil)
	res, err := http.DefaultClient.Do(withSecret(req))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	json.NewDecoder(res.Body).Decode(&got)
	if got["host"] != "example.com" {
		t.Fatalf("przez pośrednika z API: %+v", got)
	}
}

func TestListenerRequiresSessionOrSecret(t *testing.T) {
	p := startProxy(t)
	// HTTP bez ciasteczka i bez sekretu -> 403.
	res, err := http.Get(p.localOrigin() + "/echo")
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 403 {
		t.Fatalf("bez sesji: %d", res.StatusCode)
	}
	// Zły sekret w dshrk -> 403, bez ciasteczka.
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, _ = c.Get(p.localOrigin() + "/?dshrk=zly&dshOpen=1")
	if res.StatusCode != 403 || len(res.Cookies()) != 0 {
		t.Fatalf("zły dshrk: %d, ciasteczka %d", res.StatusCode, len(res.Cookies()))
	}
	// Ciasteczko z inną wartością (np. z pośrednika innego urządzenia) -> 403.
	req, _ := http.NewRequest("GET", p.localOrigin()+"/echo", nil)
	req.AddCookie(&http.Cookie{Name: p.cookieName(), Value: "cudza-sesja"})
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 403 {
		t.Fatalf("cudza sesja: %d", res.StatusCode)
	}
	// WebSocket bez ciasteczka -> 403, bez 101.
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", p.port), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprintf(conn, "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n", p.port)
	wsRes, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	if wsRes.StatusCode != 403 {
		t.Fatalf("websocket bez sesji: %d", wsRes.StatusCode)
	}
	// Z ciasteczkiem sesji HTTP przechodzi.
	if res, err = sessionClient(t, p).Get(p.localOrigin() + "/echo"); err != nil || res.StatusCode != 200 {
		t.Fatalf("z sesją: %v %v", res, err)
	}
}

func TestSecretNeverReachesUpstream(t *testing.T) {
	p := startProxy(t)
	// Z nagłówkiem sekretu i z ciasteczkami sesji (naszym i cudzym) + prawdziwym ciasteczkiem DSH z komputera.
	req, _ := http.NewRequest("GET", p.localOrigin()+"/echo", nil)
	req.Header.Set("Cookie", fmt.Sprintf("%s=%s; dsh-auth-x=v1.abc; dshrk-9999=inne", p.cookieName(), p.session))
	res, err := http.DefaultClient.Do(withSecret(req))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	json.NewDecoder(res.Body).Decode(&got)
	if got["cookie"] != "dsh-auth-x=v1.abc" {
		t.Fatalf("do komputera ma iść tylko jego ciasteczko: %q", got["cookie"])
	}
	if got["secret"] != "" {
		t.Fatalf("nagłówek z sekretem doszedł do komputera: %q", got["secret"])
	}
	// Przez ścieżkę wejścia (?dshrk=) komputer nic nie dostaje: pośrednik odpowiada przekierowaniem sam.
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, _ = c.Get(p.localOrigin() + "/echo?dshrk=" + testSecret)
	if res.StatusCode != 303 || strings.Contains(res.Header.Get("Location"), testSecret) {
		t.Fatalf("wejście z dshrk: %d %q", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestProbeEndpoint(t *testing.T) {
	// „Komputer” z dsh-remote-control: /__remote/api/info odpowiada JSON-em z service.
	mux := http.NewServeMux()
	mux.HandleFunc("/__remote/api/info", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(secretHeader) != "" || r.Header.Get("Cookie") != "" {
			t.Errorf("sonda nie może nieść sekretu ani ciasteczek")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"service":"dsh-remote-control","name":"AORUS_Z690"}`))
	})
	pc := httptest.NewTLSServer(mux)
	t.Cleanup(pc.Close)
	addr := pc.Listener.Addr().String()
	dial := func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	pool := newProxyPool(dial, pc.Client().Transport.(*http.Transport).TLSClientConfig, testSecret)
	t.Cleanup(pool.closeAll)
	ts := httptest.NewServer(controlHandlerDial(&nodeState{}, pool, testSecret, dial))
	t.Cleanup(ts.Close)
	post := func(body string) (int, map[string]any) {
		req, _ := http.NewRequest("POST", ts.URL+"/probe", strings.NewReader(body))
		res, err := http.DefaultClient.Do(withSecret(req))
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		json.NewDecoder(res.Body).Decode(&m)
		return res.StatusCode, m
	}
	// Certyfikat testowy nie jest zaufany przez sondę (produkcyjnie: Let's Encrypt), więc oczekujemy błędu TLS, nie zawieszenia.
	code, m := post(`{"target":"example.com"}`)
	if code != 200 || m["error"] == nil || !strings.Contains(m["error"].(string), "certificate") {
		t.Fatalf("sonda z niezaufanym certyfikatem: %d %+v", code, m)
	}
	if code, m := post(`{"target":"zly adres"}`); code != 200 || m["error"] == nil {
		t.Fatalf("zły adres: %d %+v", code, m)
	}
	// Bez sekretu -> 403.
	req, _ := http.NewRequest("POST", ts.URL+"/probe", strings.NewReader(`{"target":"example.com"}`))
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != 403 {
		t.Fatalf("bez sekretu: %d", res.StatusCode)
	}
}

func TestPeersFromStatus(t *testing.T) {
	st := &ipnstate.Status{Peer: map[key.NodePublic]*ipnstate.PeerStatus{}}
	k1, k2 := key.NewNode().Public(), key.NewNode().Public()
	st.Peer[k1] = &ipnstate.PeerStatus{DNSName: "zeta.tail1.ts.net.", HostName: "zeta", Online: false, OS: "linux"}
	st.Peer[k2] = &ipnstate.PeerStatus{DNSName: "dsh-pc.tail1.ts.net.", HostName: "AORUS_Z690", Online: true, OS: "windows"}
	got := peersFromStatus(st)
	want := []peerInfo{{"dsh-pc.tail1.ts.net", "AORUS_Z690", true, "windows"}, {"zeta.tail1.ts.net", "zeta", false, "linux"}}
	if !samePeers(got, want) {
		t.Fatalf("peers = %+v", got)
	}
	if samePeers(got, want[:1]) {
		t.Fatal("różne listy uznane za równe")
	}
}
