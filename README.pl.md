# DSH Mobile: DeepSeek Harness na Androidzie

**[English](README.md) · Polski**

**DeepSeek Harness w jednej apce na telefon, bez Termuxa i roota, po polsku, z kompletem narzędzi programistycznych (także .NET 10 i PowerShell 7) i ekranem Code, który przenosi sesje razem z plikami projektu między komputerem a telefonem.**

*English summary: a self-contained Android APK that runs the full [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on-device with a bundled toolchain, a Polish language pack, community plugins, Edge TTS, an in-app updater, `dsh-install` for Termux packages, .NET 10 and PowerShell 7, and a **Code** screen that opens sessions from your computers and carries them to the phone together with their project files, kept in sync, over a built-in Tailscale node. Full English README: [README.md](README.md).*

---

## Zrzuty ekranu

<p align="center">
  <img src="docs/screenshots/screenshot-1.jpg" width="300" alt="Ekran startowy sesji po polsku: wybór obszaru roboczego, tryb standardowy, kompozytor" />
  <img src="docs/screenshots/screenshot-2.jpg" width="300" alt="Panel boczny: nowa sesja, obszary robocze, ustawienia" />
</p>

## Co to jest

Apka pakuje w jeden plik APK:

- **DeepSeek Harness** (`@deepseek-ai/dsh`, profil web) uruchamiany na wbudowanym Node.js 26 z Termuxa,
- **polski interfejs** (pakiet językowy przez oficjalny mechanizm locale dsh, 58 przestrzeni nazw, 2446 napisów; od 1.2.0 także nowe ekrany dsh 0.2.0: menedżer pluginów, zadania automatyczne, wprowadzanie głosowe, terminal i przeglądarka w panelu),
- **narzędzia dla modelu**, wszystkie na `PATH` narzędzia `bash`:
  - kompilatory: `cc`/`gcc`/`clang`/`c++`/`g++` (Zig, statyczne binarki działające na Androidzie), JDK 21 (`java`, `javac`, `jar`, `javap`, `jshell`), `kotlinc`, Python 3.14 z pip i numpy, Node 26 z npm/npx i pnpm, `make`, `cmake`,
  - inżynieria wsteczna: `jadx`, `apktool`, `d2j-dex2jar` i reszta dex2jar, `aapt`, `aapt2`, GNU binutils (`objdump`, `nm`, `readelf`, `strings`, `ar`, `ld`, `as`),
  - .NET 10 SDK (`dotnet new/build/run`, natywna wersja na Androida z Termuxa) i PowerShell 7 (`pwsh`),
  - system: GNU coreutils, `sed`, `gawk`, `grep`, `find`, `diff`, `patch`, `tar`, `gzip`, `xz`, `bzip2`, `zip`, `unzip`, `7z`, `zstd`, `rg`, `fd`, `jq`, `tree`, `file`, `less`, `nano`, `tmux`, `curl`, `wget`, `git` (HTTPS), `gh`, `ssh`/`scp`/`sftp`, `rsync`, `dig`, `whois`, `socat`, `nmap`, `iperf3`, `sqlite3`, `openssl`, `ffmpeg`, `ffprobe`, `sox`, `lame`, `pngquant`, `rsvg-convert`, graphviz `dot`,
  - budowanie i emulacja: `perl`, autotools, `meson`, `ninja`, `pkg-config`, `patchelf`, `qemu-x86_64` z sysrootem glibc x86_64 (binarki skompilowane `cc -target x86_64-linux-gnu` działają na telefonie), `proot` (udawany root, montowanie katalogów, rootfs x86_64 zamiast Dockera), `adb`,
  - `dsh-install <pakiet>`: instaluje dowolny inny pakiet Termuxa (z zależnościami) do `~/.local`, sprawdzany jak w apt (podpis GnuPG indeksu repozytorium, SHA256 indeksu i każdego pakietu), i sprawdza nowe binarki; `-s` szukanie, `-l` lista, `-r` usuwanie, `-f` ponowna instalacja,
  - ścieżki Termuxa bez obejść: shebangi `#!/usr/bin/env …` i `#!/bin/sh` działają bez zmian (termux-exec), narzędzia uruchamiające powłokę (`tar -z`, `make`, hooki i aliasy gita, `system()` w `awk`/`perl`) używają `/system/bin/sh`, Java dostaje katalog tymczasowy i domowy apki,
- **`xdg-open <plik>`** dla agenta: otwiera wynik (PDF, obraz, film, dokument) w aplikacji na telefonie przez systemowy wybór aplikacji; pliki `.md` otwierają się we wbudowanym czytniku/edytorze,
- **pluginy społeczności**: mobilny UI (dsh-qol), pamięć między sesjami, cofanie tur z przywracaniem plików, bezpieczniki pętli (repeat-stop, tool-budget), 87 skilli inżynierii wstecznej, edycja plików diffem, zegar w kontekście, lista zadań między turami, most MCP po stdio, TTS (Edge TTS z polskimi głosami, równoległa synteza fragmentów),
- **działający menedżer pluginów**: dzięki dołączonemu pnpm „Pluginy → Dodaj plugin” instaluje pluginy z npm i z GitHuba tak jak na komputerze; pokazują się w grupie „Zainstalowane” i tam można je odinstalować (pluginy wbudowane w APK działają dalej, ale nie są tam wymienione),
- **usługę pierwszoplanową**, która trzyma serwer w tle (powiadomienie z przyciskami „Zatrzymaj" i „Aktualizuj"),
- **aktualizator w apce** pod jednym przyciskiem „Aktualizuj” (w powiadomieniu albo niebieski przycisk na dole paska bocznego, jak w DSH Desktop): najpierw sprawdza wydania w tym repozytorium i gdy jest nowsze APK, pobiera je z postępem, sprawdza md5 i proponuje instalację; dopiero gdy nowszego APK nie ma, wbudowany npm pobiera nową wersję dsh, nakłada łatki pod Androida z prekompilowanych plików, testuje start i dopiero wtedy podmienia katalog.

## Instalacja

1. Pobierz `dsh-mobile.apk` z [Releases](../../releases) (ok. 890 MB).
2. Zezwól menedżerowi plików na instalację z nieznanych źródeł i zainstaluj. Kolejne aktualizacje przychodzą już z apki; za pierwszym razem Android prosi o zgodę „Instaluj nieznane aplikacje” dla DeepSeek Harness.
3. Pierwsze uruchomienie rozpakowuje ok. 2,1 GB (57 tys. plików) do pamięci apki. Trwa kilka minut, postęp widać na liczniku. Kolejne starty trwają kilka sekund.
4. Zezwól na dostęp do plików: agent pracuje domyślnie w `Pobranych`, tam też apka zapisuje log (`Download/dsh_log.txt`).
5. Wpisz klucz API DeepSeek w oknie powitalnym harnessu.

Wymagania: Android 9+ (targetSdk 28 celowo, patrz niżej), arm64, ok. 3,5 GB wolnego miejsca.

## Użycie

- Interfejs działa w oknie apki, serwer nasłuchuje tylko na `127.0.0.1:3090`, każdy start dostaje nowy token.
- Język: Ustawienia → Ogólne → Język (domyślnie polski, gdy system jest polski).
- Tryb uprawnień: apka ustawia `danger-full-access`, bo jądro Androida nie ma Landlocka ani bubblewrapa, a dsh w trybach z sandboxem odmawia uruchamiania komend. Procesy izoluje sam Android (katalog apki + pamięć współdzielona).
- TTS: przycisk głośnika przy odpowiedzi, przełącznik „Czytaj automatycznie" w kompozytorze, ustawienia w Ustawienia → Pluginy → Głos. Domyślny głos `pl-PL-ZofiaNeural`, liczbę równoległych syntez ustawia `DSH_TTS_EDGE_PARALLEL` (domyślnie 30).
- Aktualizacja: „Aktualizuj” w powiadomieniu albo niebieski przycisk na dole paska bocznego. Apka sprawdza aktualizacje (najpierw nowsze APK w wydaniach, potem nowsze dsh w npm) przy każdym otwarciu, także po „Zatrzymaj”, przy powrocie do apki (najwyżej co 30 min) i co 6 godzin. Po pobraniu „Zainstaluj” otwiera instalator systemowy.
- Instalowanie pluginów: Pluginy → Dodaj plugin → Zainstaluj zewnętrzny plugin. Podawaj pełną nazwę z npm razem z zakresem (np. `@michengai/dsh-skills-manager`, a nie niezwiązany `dsh-skills-manager`) albo `github:właściciel/repo` dla pluginów wydanych tylko na GitHubie (np. `github:2002XiaoYu/dsh-session-diff`). dsh odrzuca pluginy, których autorzy deklarują zgodność tylko ze starszym dsh, i wtedy nic się nie instaluje.
- Pluginy instalowane z menedżera są tłumaczone, gdzie się da: Sklep z pluginami i Zarchiwizowane sesje przez mechanizm językowy dsh, Cost (dsh-cost-meter) przez łatkę, którą apka nakłada przy każdym starcie i po każdej instalacji lub aktualizacji pluginu. Przy świeżej instalacji Cost pokazuje kwoty w USD; istniejąca instalacja zachowuje zapisaną walutę (Ustawienia → Cost → Wyświetlanie → Kwoty i waluta). Opisy pluginów w sklepie pochodzą od autorów i zostają w oryginale.
- `AGENTS.md` z katalogu roboczego trafia do kontekstu modelu.
- Interfejs jest powiększony 1,2× względem wersji przeglądarkowej (meta viewport: szerokość strony = ekran/1,2; stała `UI_ZOOM` w `MainActivity.kt`), a paski systemowe Androida przyjmują kolor tła strony.
- Klawiatura w polach dsh działa bez podpowiedzi, autokorekty i pisania gestem (WebView zgłasza pole jako „widoczne hasło”): edytor kompozytora (Lexical) z klawiaturą składającą słowa, np. Samsung, zaznaczał pierwszą literę i nadpisywał ją następną (Lexical #7210). Bez składania słów błąd nie występuje.
- **Code** (pasek boczny): sesje DeepSeek Harness z Twoich komputerów. Pierwszy raz: „Zaloguj Tailscale” (otwiera się przeglądarka systemowa, apka staje się urządzeniem `dsh-mobile` w tailnecie). Komputery z wtyczką [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) pojawiają się same; dotknięcie sesji otwiera ją z pełną historią, wiadomości i zdjęcia działają jak na PC. „Dodaj urządzenie” to zapas do wpisania adresu ręcznie. Gdy węzeł nie jest zalogowany, a apka Tailscale (VPN) jest włączona, działa stara droga bezpośrednia.
- **Sesje razem z plikami projektu** (z [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) 0.7.0+ na PC): sesja wysłana z komputera trafia na telefon z całym katalogiem projektu (poza wynikami budowania, zależnościami, sekretami, binarkami i plikami ponad 5 MB) w `~/<projekt>`, osobnym obszarze roboczym, który staje się katalogiem roboczym sesji, więc agent pracuje dalej na tych samych plikach; w prompcie dostaje też informację, która ścieżka na komputerze odpowiada której na telefonie. Ponowne wysłanie tej samej synchronizowanej sesji aktualizuje istniejącą kopię. Gdy sesja jest synchronizowana, pliki idą razem z pisaniem: przy przejęciu przez telefon najpierw przychodzi to, co zmieniło się na PC; przy przejęciu przez komputer telefon najpierw odsyła to, co zmieniło się na telefonie (także pliki zrobione poleceniami powłoki). Plik, którego nikt nie ruszał od ostatniego przeniesienia, jest podmieniany po cichu; plik zmieniony po obu stronach zachowuje drugą wersję obok jako `*.przed-importem-<data>`. Dopóki pliki nie dojdą i nie zostaną potwierdzone, pisanie zostaje tam, gdzie jest, więc stara kopia nigdy nie nadpisze nowszej pracy.
- Transfery pokazują postęp: strzałka (do albo z telefonu) z cienkim paskiem przy sesji, pasek nad polem pisania i na ekranie Code oraz animowana ikona Code w pasku bocznym.
- Usunięcie sesji („Usuń sesję” z wtyczki archiwum) kasuje ją z dysku; sesja nadal synchronizowana z komputerem jest odrzucana z komunikatem „najpierw odłącz synchronizację” (ikona komputera przy sesji).

## Jak to działa

```
APK
├── assets/payload.zip           (stored, ~610 MB) → rozpakowany do filesDir/rt przy pierwszym starcie
│   ├── bin/  node bash python3 …  + wrappery (cc, javac, jadx, npm …)
│   ├── lib/  *.so z Termuxa (domknięcie NEEDED), python3.14/, node_modules/npm
│   ├── opt/  jdk, zig, jadx, apktool, kotlin, dex2jar, dotnet (SDK 10), pwsh (PowerShell 7), x86_64-sysroot
│   ├── node_modules/            dsh + pluginy (npm)
│   ├── dsh-locale-pl/           plugin z polskim pakietem językowym
│   ├── android.patch.yml        nakładka profilu: pluginy, prompt systemowy, locale
│   ├── android-shim.cjs         --require: fs.link → copyFile (Android zabrania hardlinków), łatki na pluginy użytkownika
│   ├── android-patches/*.mjs    łatki na pluginy (równoległy TTS, polskie napisy) nakładane po npm install
│   ├── android-patches/profile/ łatki na pluginy instalowane przez użytkownika (tłumaczenie dsh-cost-meter), nakładane przy starcie i po zmianie profilu
│   ├── android-prebuilt/        pty.node, system.node (flock) — prekompilowane addony
│   ├── android-update.mjs       aktualizator w apce
│   ├── tools.env, links.txt     zmienne środowiska i dowiązania odtwarzane po rozpakowaniu
│   ├── etc/dsh-install/provided pakiety Termuxa obecne w runtime (pomijane jako zależności)
│   └── etc/tls/cert.pem
├── ServerService                foreground service: node … dsh --profile web --patch rt/android.patch.yml --port 3090
└── MainActivity                 WebView z adresem serwera (token ze stdout)
```

Obejścia potrzebne, żeby Node i dsh z Termuxa działały w innej apce:

| Problem | Rozwiązanie |
|---|---|
| binarki Termuxa mają wkompilowany prefiks `/data/data/com.termux/files/usr` | `LD_LIBRARY_PATH`, `OPENSSL_CONF=/dev/null`, `SSL_CERT_FILE`, `GIT_EXEC_PATH`, `GIT_CONFIG_NOSYSTEM=1`, `MAGIC`, `CMAKE_ROOT`… (`tools.env`) |
| od API 29 Android blokuje exec i dlopen z katalogu danych apki | `targetSdk 28` (tak samo robi Termux) |
| SELinux zabrania hardlinków `link()` | shim podmieniający `fs.link` na `copyFile(COPYFILE_EXCL)` |
| addon `flock` tylko dla linux/darwin | `flock.c` skompilowany clangiem jako `node-addon-system-android-arm64` + patch loadera |
| `sharp` bez binarki android-arm64 | wariant WebAssembly |
| `node-pty` bez prebuilda | build node-gyp z `-Dandroid_ndk_path=` |
| brak sandboxa (Landlock/bwrap) | `DSH_PERMISSION_MODE=danger-full-access` |
| zip nie przenosi dowiązań | `links.txt` odtwarzany przez `Os.symlink` |
| skrypty z shebangiem Termuxa | `#!/system/bin/sh` + exec przez wbudowanego basha |
| skrypty agenta z `#!/usr/bin/env …` albo `#!/bin/sh` (nie ma `/usr` ani roota) | termux-exec (`LD_PRELOAD`, `TERMUX__PREFIX=rt`) przepisuje ścieżkę interpretera przy exec; `bin/sh` → bash |
| 28 binarek uruchamia powłokę przez wkompilowane `$PREFIX/bin/sh` (tar -z, make, hooki i aliasy gita, `system()` w awk/perl, cmake, ninja…) | napis w binarkach podmieniony na `/system/bin/sh` (ta sama długość, dopełnienie zerami) |
| `7z` ładuje kodeki z `$PREFIX/libexec/7zip/7z.so`; `dig` przerywa na nieczytelnym `resolv.conf` Termuxa | samodzielny `7zz` jako `7z`; ścieżka w `dig` podmieniona na `/dev/null` (serwer `@8.8.8.8` z wrappera) |
| JDK Termuxa ma `java.io.tmpdir` i `user.home` w Termuxie | wrappery Javy podają `TMPDIR` i `HOME` apki |
| .NET ładuje ICU po nazwach bez wersji i inaczej bierze ICU Androida z `/apex` (SIGABRT); PowerShell ma `libpsl-native` tylko pod glibc | dowiązania ICU bez wersji w `lib/`; `libpsl-native` zbudowane z PowerShell-Native pod bionic; `DOTNET_ROOT`, bez „pierwszego uruchomienia” |
| `koffi` w wersji bez binarki android-arm64 (dsh ≥ 0.2.0 przypina 3.1.1) | `overrides` w package.json na najnowszą wersję tej samej linii głównej, która binarkę ma |
| npm po aktualizacji dsh zagnieżdża `@deepseek-ai/*` pod `@deepseek-ai/dsh/node_modules`, pluginy nie znajdują `@deepseek-ai/dsh-tools` | `android-hoist.mjs`: dowiązania na górze do zagnieżdżonych pakietów (w APK odtwarzane z `links.txt`) |
| `node-addon-require-builtin` (dsh ≥ 0.2.0) bez wariantu android-arm64 i bez źródeł | pakiet JS `node-addon-require-builtin-android-arm64`, który pod `--expose-internals` zwraca wewnętrzne moduły zwykłym `require()` |
| menedżer pluginów dsh woła `pnpm` z `PATH` (bez niego: „pnpm was not found”) | pnpm z Termuxa w `lib/node_modules/pnpm` i skrypt `bin/pnpm` (`#!/system/bin/sh`, ścieżka względem siebie) |
| git czyta wkompilowany `usr/etc/gitconfig` Termuxa; gdy Termux jest zainstalowany, plik istnieje, ale apka nie może go odczytać („Permission denied”, np. przy instalacji pluginu z GitHuba) | `GIT_CONFIG_NOSYSTEM=1` w `tools.env` |
| dsh pokazuje przycisk aktualizacji tylko z mostkiem DSH Desktop (`globalThis.dshDesktop`), którego obecność przełącza też logowanie do konta, analitykę i ekran powitalny w tryb desktopowy | łatka `settings-update-bridge.mjs`: bez `dshDesktop` przycisk czyta mostek apki `DshMobileUpdate` (WebView `addJavascriptInterface`, odpowiada tylko lokalnemu dsh) |
| pnpm instaluje pluginy użytkownika na czysto, a część z nich ma własne słowniki zh/en poza mechanizmem językowym dsh | `android-patches/profile/`: tłumaczenie po tekście angielskim, nakładane przez `android-shim.cjs` przy starcie i po każdej zmianie profilu; wszystko albo nic — gdy kod pluginu się zmieni, łatka jest pomijana z wpisem w logu, a plugin zostaje po angielsku |

### Ekran Code i wbudowany Tailscale

`code/dsh-code` to plugin dsh (host + klient). Serwer uruchamia `bin/dsh-tsnet-mobile` (`tsnet/`, Go, budowany natywnie w Termuxie z `GOOS=android`), czyli węzeł Tailscale w procesie, bez TUN i bez VPN. Oficjalny `tailscaled` nie startuje na Androidzie, bo SELinux odmawia aplikacjom netlinka; program listuje interfejsy przez `ioctl SIOCGIFCONF`. Dla każdego komputera program otwiera lokalny pośrednik `127.0.0.1:<stały port>` i przekazuje HTTP oraz WebSocket do `https://<pc>.ts.net` (Host/Origin na adres komputera, Location z powrotem na lokalny, Set-Cookie bez Secure). Wejście wymaga sekretu losowanego przy starcie (przekazywanego do programu wyłącznie przez zmienną środowiska), potem ciasteczka sesji HttpOnly SameSite=Strict; serwer używa nagłówka `X-DSH-Secret`; bez nich 403. Urządzenia z tailnetu są sondowane (`/__remote/api/info`, 4 s, `dsh-*` najpierw, do 4 naraz, ponawianie tylko po zmianie stanu online) i te z `dsh-remote-control` trafiają do `dsh-code.json` w katalogu apki, który przeżywa aktualizacje. Po stronie PC wymagane: wtyczka [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) (osobne repozytorium: brama DSH za Tailscale, wpuszcza tylko Twoje konto) i włączone „HTTPS Certificates” w panelu tailnetu.

## Budowanie ze źródeł (Termux, arm64)

Wymagania: Termux z `nodejs` (26), `python` (3.14), `clang`, `openjdk-21`, `golang`, `dotnet-sdk-10.0`, `gnupg` (gpgv), `git`, `zip`, `aapt2`, `apksigner`, `gradle` przez wrapper projektu, oraz pakiety narzędzi kopiowanych do payloadu (`binutils`, `ripgrep`, `fd`, `jq`, `tree`, `file`, `ffmpeg`, `sqlite`, `kotlin`, `dex2jar`, `cmake`, `make`, `python-numpy`…). Pułapki Gradle/aapt2 na Termuxie opisuje `app/gradle.properties`.

```sh
# 1. instalacja dsh z łatkami pod Androida (raz; potem robi to update.sh)
mkdir ~/dsh-test && cd ~/dsh-test && npm init -y && npm install --ignore-scripts --force @deepseek-ai/dsh
# 2. komplet narzędzi z Termuxa + pobrane archiwa (zig, jadx, apktool) -> tools/root
tools/build-tools.sh
# 3. pełny przebieg: npm -> łatki natywne -> runtime -> pakiet językowy -> węzeł Tailscale (pkg install golang) -> payload -> APK
./update.sh                 # opcje: --tag alpha|X.Y.Z  --skip-npm  --force  --debug
```

`update.sh` zapisuje podpisany APK w `/sdcard/Download/dsh-mobile.apk`. Podpis release używa klucza `~/.android/ciuchy-release.jks` (alias `ciuchy`, hasło w `~/.android/ciuchy-release.pass`); zmień `signingConfigs` w `app/app/build.gradle.kts` na własny klucz albo użyj `--debug`.
Obok APK zapisuje `dsh-mobile.apk.md5` i `dsh-mobile.json` (`versionCode`, `versionName`, `md5`, `size`). Każde wydanie musi mieć `dsh-mobile.json` obok `dsh-mobile.apk`, inaczej aktualizator w apce go nie zauważy; o nowości decyduje `versionCode`, więc assety można podmieniać w miejscu pod tym samym tagiem. Najpierw wgraj APK i `.md5`, a `dsh-mobile.json` na końcu, żeby żaden telefon nie zobaczył nowej wersji, zanim jej APK będzie na miejscu.

Testy: `tools/test-tools.sh <rt>` (85 testów narzędzi w czystym środowisku), `go test ./...` w `tsnet/`, `node --test` w `code/dsh-code`. `update.sh` przed pakowaniem sam testuje start dsh na gotowym runtime.

## Tłumaczenie

- Interfejs dsh: `locale-pl/pl-1..7.json` → `pl.json` → `build-plugin.mjs` → plugin `@dsh-local/locale-pl`. Po aktualizacji dsh brakujące klucze wyświetlają się po angielsku; `update.sh` wypisuje listę „BRAK TŁUMACZEŃ".
- Pluginy instalowane z menedżera: te, które używają mechanizmu językowego dsh, dostają polskie słowniki z `pl-7.json` (`dsh-market`, `archive-manager-workspace`); dsh-cost-meter z własnymi słownikami zh/en tłumaczy `stage/android-patches/profile/` (`cost-meter.pl.json`, 614 tekstów).
- Pluginy społeczności nie korzystają z mechanizmu locale dsh (chińskie napisy na sztywno albo własne słowniki zh/en), więc spolszczają je łatki `android-patches/{qol,rewind,tts}-polish.mjs`. Gdy autor zmieni tekst, łatka zatrzymuje aktualizację z komunikatem, żeby chińskie napisy nie przeszły po cichu.

## Ograniczenia

- Nie ma apt/pkg ani roota: `dsh-install` obsługuje pakiety Termuxa, ale pakiet może szukać swoich danych pod `/data/data/com.termux` (wypisuje takie ścieżki); pip buduje tylko czyste pakiety Pythona, npm i pnpm instalują tylko pakiety bez części natywnej (dotyczy to też pluginów dodawanych z menedżera pluginów).
- Windowsowe `.exe`/`.bat` nie działają (bez Wine); PowerShell ma tylko polecenia wieloplatformowe (bez rejestru, WMI, COM). Nie ma zapisywalnego `/tmp`, a `/usr/bin/env` nie jest prawdziwym plikiem (exec i tak działa); używaj `$TMPDIR`.
- Aktualizator w apce wymaga tej samej wersji `node-pty` co prekompilowana; przy innej odsyła do `update.sh` w Termuxie (tam jest kompilator).
- Przy 30 równoległych połączeniach i bardzo długich odpowiedziach Microsoft może odrzucać część z nich; plugin ponawia fragment, a w ostateczności go pomija.
- Rozmiar: APK ok. 890 MB, po rozpakowaniu ok. 2,1 GB; razem z APK potrzeba ok. 3,5 GB wolnego miejsca.
- dsh 0.2.0 wyłącza jako niezgodne pluginy `dsh-memory-connect` (pamięć między sesjami) i `dsh-reverse-skill` (skille inżynierii wstecznej): ich autorzy deklarują zgodność tylko z dsh 0.1.x. Wrócą, gdy pojawią się zgodne wersje.
- Ekran Code: wejście do pośrednika działa tylko z ekranu Code (ciasteczko SameSite=Strict), a komputer musi mieć włączone „HTTPS Certificates” w tailnecie, inaczej `tls: internal error`.

## Licencje komponentów

Kod tej apki: MIT. APK zawiera oprogramowanie osób trzecich na ich licencjach:

| Komponent | Licencja |
|---|---|
| DeepSeek Harness i pluginy `@deepseek-ai/*` | MIT |
| Node.js, npm | MIT / Artistic 2.0 |
| OpenJDK 21 (Termux) | GPLv2 z Classpath Exception |
| Zig | MIT |
| Kotlin | Apache 2.0 |
| jadx, apktool | Apache 2.0 |
| dex2jar | Apache 2.0 |
| Python 3.14, numpy | PSF / BSD |
| bash, coreutils, findutils, grep, sed, gawk, diffutils, patch, tar, gzip, make, binutils, wget (Termux) | GPLv3 |
| git | GPLv2 |
| pnpm | MIT |
| .NET 10 SDK i runtime (wersja Termuxa), PowerShell 7 | MIT |
| termux-exec | Apache 2.0 |
| 7-Zip (`7zz`) | LGPL 2.1+ z ograniczeniem unRAR |
| GnuPG (`gpgv`), less, nano, rsync, pngquant | GPLv3 |
| QEMU (tryb użytkownika), proot, perl, autotools, sox | GPLv2 / Artistic (perl) / GPL·LGPL (sox) |
| OpenSSH, tmux, BIND `dig`, graphviz, nmap, lame, `gh`, `adb` | odpowiednio BSD / ISC / MPL 2.0 / EPL / NPSL / LGPL / MIT / Apache 2.0 |
| glibc, libgcc, libstdc++ (Debian, sysroot x86_64 dla qemu) | LGPL / GPL z wyjątkiem runtime |
| marked (czytnik Markdown) | MIT |
| Tailscale (`tsnet`) i biblioteki Go programu `dsh-tsnet-mobile` | BSD-3-Clause; zależności wg ich licencji (BSD/MIT/Apache 2.0) |
| ffmpeg | LGPL/GPL (build Termuxa) |
| curl, openssl, sqlite, zip/unzip, xz, bzip2, jq, ripgrep, fd, tree, file, cmake | licencje własne (MIT/BSD/zlib i podobne) |
| pluginy społeczności dsh (dsh-qol, dsh-memory-connect, dsh-turn-rewind, dsh-reverse-skill, dsh-patch-edit-plus, dsh-repeat-stop, dsh-tool-budget, dsh-clock-context, dsh-todo-continuity, dsh-mcp-bridge, dsh-plugin-tts) | wg repozytoriów autorów (MIT) |

Binarki pochodzą z pakietów Termuxa (https://github.com/termux/termux-packages) oraz oficjalnych wydań Zig, jadx i apktool.

## Struktura repozytorium

```
app/            projekt Gradle (Kotlin): App.kt, ServerService.kt, MainActivity.kt, ApkUpdater.kt (aktualizacja apki z wydań), Opener.kt (xdg-open), MdActivity.kt (czytnik Markdown)
stage/          runtime i pliki payloadu (bez node_modules — te są w ~/dsh-test)
tools/          build-tools.sh, merge-tools.sh, apply-links.sh, test-tools.sh, dsh-install.py, zig-cc-wrapper.sh, root/ (wynik)
locale-pl/      polski pakiet językowy: extract-en.mjs, pl-*.json, build-plugin.mjs, android.patch.yml
code/dsh-code/  plugin ekranu Code (host: index.js, tsnet.js, discover.js; klient: client.js; vendor/: wspólne moduły przenoszenia z dsh-remote-control; testy node)
tsnet/          dsh-tsnet-mobile: wbudowany węzeł Tailscale w Go (tsnet, pośrednik, API sterujące, testy)
tap-outside/    plugin zamykania panelu bocznego dotknięciem obok
update.sh       pełny przebieg budowania i aktualizacji
```
