package main

// dsh-tsnet-mobile: węzeł Tailscale wbudowany w DSH Mobile (tsnet, bez TUN/VPN) + lokalne pośredniki
// HTTP/WebSocket do komputerów w tailnecie + API sterujące dla serwera dsh-code.
// stdout: linie JSON ze stanem węzła (BackendState, AuthURL) dla ServerService; koniec po zamknięciu stdin.

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
)

type stateLine struct {
	BackendState string   `json:"BackendState"`
	AuthURL      string   `json:"AuthURL,omitempty"`
	TailscaleIPs []string `json:"TailscaleIPs,omitempty"`
	Error        string   `json:"Error,omitempty"`
}

func emit(l stateLine) {
	b, _ := json.Marshal(l)
	fmt.Println(string(b))
}

func main() {
	dir := flag.String("dir", "", "katalog stanu tsnet (statedir)")
	hostname := flag.String("hostname", "dsh-mobile", "nazwa węzła w tailnecie")
	listen := flag.String("listen", "", "adres API sterującego, np. 127.0.0.1:1057 (puste = bez API)")
	probe := flag.String("probe", "", "diagnostyka: host:port w tailnecie — połącz przez tsnet, zrób TLS, wypisz wynik i zakończ")
	flag.Parse()
	secret := os.Getenv("DSH_TSNET_SECRET") // tylko env (nie w argumentach procesu); nigdy nie logować
	os.Unsetenv("DSH_TSNET_SECRET")
	if *dir == "" {
		emit(stateLine{Error: "brak --dir"})
		os.Exit(2)
	}
	if *listen != "" && len(secret) < 16 {
		emit(stateLine{Error: "API sterujące wymaga sekretu w env DSH_TSNET_SECRET (min. 16 znaków)"})
		os.Exit(2)
	}
	if host, _, err := net.SplitHostPort(*listen); *listen != "" && (err != nil || !net.ParseIP(host).IsLoopback()) {
		emit(stateLine{Error: "--listen musi być adresem pętli zwrotnej (127.0.0.1:port)"})
		os.Exit(2)
	}

	// Przed startem: listowanie interfejsów przez ioctl zamiast netlinka (zablokowany przez SELinux).
	netmon.RegisterInterfaceGetter(ioctlInterfaces)

	srv := &tsnet.Server{Dir: *dir, Hostname: *hostname, Ephemeral: false}
	if err := srv.Start(); err != nil {
		emit(stateLine{Error: "tsnet start: " + err.Error()})
		os.Exit(1)
	}
	defer srv.Close()

	if *probe != "" {
		runProbe(srv, *probe)
		return
	}

	pool := newProxyPool(retryingDial(srv.Dial), nil, secret)
	state := &nodeState{}
	if *listen != "" {
		ln, err := net.Listen("tcp", *listen)
		if err != nil {
			emit(stateLine{Error: "listen " + *listen + ": " + err.Error()})
			os.Exit(1)
		}
		go http.Serve(ln, controlHandler(state, pool, secret))
		log.Printf("API sterujące na http://%s", ln.Addr())
	}

	// Koniec po zamknięciu stdin (apka zamyka potok = proces ma się skończyć).
	go func() {
		io.Copy(io.Discard, os.Stdin)
		pool.closeAll()
		srv.Close()
		os.Exit(0)
	}()

	lc, err := srv.LocalClient()
	if err != nil {
		emit(stateLine{Error: "local client: " + err.Error()})
		os.Exit(1)
	}
	var last stateLine
	var lastPeers []peerInfo
	peersSent := false
	nextPeers := time.Now()
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		st, err := lc.Status(ctx)
		cancel()
		if err == nil && st.BackendState == "Running" && !time.Now().Before(nextPeers) {
			if peers := peersFromStatus(st); !peersSent || !samePeers(peers, lastPeers) {
				emitPeers(peers)
				lastPeers, peersSent = peers, true
			}
			nextPeers = time.Now().Add(30 * time.Second)
		}
		cur := stateLine{}
		if err != nil {
			cur.Error = err.Error()
		} else {
			cur.BackendState = st.BackendState
			cur.AuthURL = st.AuthURL
			for _, ip := range st.TailscaleIPs {
				cur.TailscaleIPs = append(cur.TailscaleIPs, ip.String())
			}
		}
		if fmt.Sprint(cur) != fmt.Sprint(last) {
			emit(cur)
			state.set(cur)
			last = cur
		}
		time.Sleep(time.Second)
	}
}

// runProbe: diagnostyka połączenia do komputera przez tsnet (bez pośrednika i sekretu).
func runProbe(srv *tsnet.Server, hostport string) {
	upCtx, upCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer upCancel()
	st, err := srv.Up(upCtx)
	if err != nil {
		fmt.Printf("up: err=%v\n", err)
		return
	}
	fmt.Printf("up: %s ips=%v\n", st.BackendState, st.TailscaleIPs)
	host, _, _ := net.SplitHostPort(hostport)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	t0 := time.Now()
	dial := retryingDial(srv.Dial)
	conn, err := dial(ctx, "tcp", hostport)
	fmt.Printf("dial %s: err=%v (%s)\n", hostport, err, time.Since(t0).Round(time.Millisecond))
	if err != nil {
		return
	}
	defer conn.Close()
	fmt.Printf("local=%s remote=%s\n", conn.LocalAddr(), conn.RemoteAddr())
	// Dodatkowo: TLS bez SNI oraz goły HTTP na 80 (co komputer w ogóle wystawia).
	if c2, err := dial(ctx, "tcp", hostport); err == nil {
		t2 := tls.Client(c2, &tls.Config{InsecureSkipVerify: true})
		t2.SetDeadline(time.Now().Add(10 * time.Second))
		fmt.Printf("tls bez SNI: err=%v\n", t2.Handshake())
		c2.Close()
	}
	if c3, err := dial(ctx, "tcp", host+":80"); err == nil {
		c3.SetDeadline(time.Now().Add(10 * time.Second))
		fmt.Fprintf(c3, "GET /__remote/api/info HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", host)
		buf := make([]byte, 1024)
		n, _ := c3.Read(buf)
		fmt.Printf("http :80 odpowiedź: %q\n", string(buf[:n]))
		c3.Close()
	} else {
		fmt.Printf("http :80 dial: %v\n", err)
	}
	tc := tls.Client(conn, &tls.Config{ServerName: host, NextProtos: []string{"http/1.1"}})
	tc.SetDeadline(time.Now().Add(15 * time.Second))
	err = tc.Handshake()
	fmt.Printf("tls handshake SNI=%s: err=%v\n", host, err)
	if err == nil {
		cs := tc.ConnectionState()
		for _, c := range cs.PeerCertificates {
			fmt.Printf("cert: subject=%s dns=%v issuer=%s\n", c.Subject, c.DNSNames, c.Issuer)
		}
		fmt.Fprintf(tc, "GET /__remote/api/info HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", host)
		buf := make([]byte, 2048)
		n, _ := tc.Read(buf)
		fmt.Printf("odpowiedź: %q\n", string(buf[:n]))
	}
}
