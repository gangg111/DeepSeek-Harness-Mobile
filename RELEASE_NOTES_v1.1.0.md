# DSH Mobile 1.1.0

**DeepSeek Harness 0.1.5-rc.3 · versionCode 21 · payload 18 · arm64 · ok. 620 MB**

*English summary: the new **Code** screen lists DeepSeek Harness sessions running on your computers and opens them on the phone with full history, attachments and model selection. Connectivity is provided by a **built-in Tailscale node** (Go, `tsnet`) inside the app: no Tailscale app, no Android VPN. Computers running the `dsh-remote-control` plugin are **discovered automatically** on the tailnet. All traffic between the WebView and the computer goes through a local loopback proxy guarded by a per-launch secret.*

## Co nowego

- **Ekran Code** w pasku bocznym: komputery z wtyczką `dsh-remote-control`, ich sesje (tytuł, obszar roboczy, ostatnia wiadomość, „Czeka na Twoje zatwierdzenie”), stan Połączono/Rozłączono, „Nowa sesja” z wyborem obszaru roboczego. Dotknięcie sesji otwiera ją z komputera z pełną historią; wiadomości i zdjęcia działają jak na PC.
- **Wbudowany węzeł Tailscale** (`dsh-tsnet-mobile`, program w Go na bibliotece `tsnet`): apka sama jest urządzeniem w Twoim tailnecie. Logowanie jednym przyciskiem „Zaloguj Tailscale” (otwiera się przeglądarka systemowa), stan zostaje w katalogu apki. Apka Tailscale i VPN nie są potrzebne; jeśli jednak są włączone, stara droga przez `https://<pc>.ts.net` działa jak dotąd.
- **Automatyczne wykrywanie komputerów**: urządzenia online z tailnetu są sondowane (`/__remote/api/info`, 4 s, najpierw nazwy `dsh-*`, do 4 naraz) i te z `dsh-remote-control` pojawiają się na liście same, z nazwą z komputera. Ręcznie usunięte nie wracają; „Dodaj urządzenie” zostaje jako zapas.
- **Lokalny pośrednik z sekretem**: WebView i serwer rozmawiają z komputerem przez `127.0.0.1:<stały port urządzenia>`. Wejście wymaga sekretu losowanego przy każdym starcie, potem ciasteczka sesji (HttpOnly, SameSite=Strict); bez nich 403, także dla WebSocket. Sekret nie trafia do komputera, plików ani logów. Stały port na urządzenie zachowuje ciasteczka i localStorage DSH z komputera między restartami.
- Załączniki w kompozytorze (zdjęcia, pliki) działają w WebView.
- Apka loguje przy starcie wersję buildu i payloadu (`/sdcard/Download/dsh_log.txt`).
- Nieudana sonda komputera jest ponawiana po 30 s, 2 min i 10 min, potem dopiero po zmianie jego stanu online (asset podmieniony 2026-10-02 na build 21).

## Dlaczego własny węzeł, a nie tailscaled

Oficjalny `tailscaled` nie startuje w apce ani w Termuxie: SELinux Androida odmawia aplikacjom netlinka (`netmon.New: netlinkrib: permission denied`). Program `dsh-tsnet-mobile` jest budowany natywnie w Termuxie (`GOOS=android`) i listuje interfejsy przez `ioctl SIOCGIFCONF`, które Android dopuszcza.

## Wymagania po stronie komputera

- DeepSeek Harness z wtyczką `dsh-remote-control` (brama wpuszcza tylko Twoje konto Tailscale).
- W panelu tailnetu włączone **HTTPS Certificates** (DNS → HTTPS Certificates). Bez tego każde połączenie kończy się `tls: internal error`. Pierwszy uścisk po włączeniu może trwać do minuty (certyfikat Let's Encrypt).

## Instalacja

Aktualizacja z 1.0.0 bez odinstalowania (ten sam klucz). Pierwszy start rozpakowuje payload na nowo (ok. 2 min, licznik w powiadomieniu). Potem: pasek boczny → Code → „Zaloguj Tailscale” → komputer pojawia się sam.

## Znane ograniczenia

- Węzeł wbudowany to osobne urządzenie w tailnecie (`dsh-mobile`); jeśli taka nazwa już istnieje, dostanie przyrostek.
- Wejście do pośrednika działa tylko z ekranu Code (ciasteczko SameSite=Strict); link wklejony z innej strony da 403.
- Pozostałe ograniczenia z 1.0.0 bez zmian (brak menedżera pakietów, `danger-full-access`, rozmiar).

## Weryfikacja przed wydaniem

- `go test` w `tsnet/`: 10 testów (przepisywanie Host/Origin/Location/Set-Cookie, WebSocket, 403 bez sekretu i bez ciasteczka, sekret nie dociera do komputera, stały port, lista urządzeń, sonda).
- `node --test` w `code/dsh-code`: 8 testów (adresy, parsowanie stanu węzła, planowanie sond, limit równoległości).
- Na telefonie z wyłączoną apką Tailscale: komputer wykryty automatycznie w sekundę po `Running`, sesja otwarta z historią, wiadomość i zdjęcie dotarły (model na PC opisał treść zdjęcia).

## Licencje

Nowe w tym wydaniu: Tailscale / `tsnet` (BSD-3-Clause), biblioteki Go wg ich licencji (głównie BSD/MIT/Apache 2.0). Reszta jak w 1.0.0, pełna lista w README.

## Sumy kontrolne

`dsh-mobile.apk` — md5 `7e3afca8ef0c0831cfaf52123a743039` (plik `dsh-mobile.apk.md5`).
