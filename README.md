# DSH Mobile — DeepSeek Harness na Androidzie

**DeepSeek Harness w jednej apce na telefon: bez Termuxa, bez roota, po polsku, z kompletem narzędzi programistycznych.**

*English summary: a self-contained Android APK that runs the full [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (Node.js agent harness with a web GUI) on-device, with a bundled toolchain (C/C++ via Zig, JDK 21, Kotlin, Python 3.14, Node 26, jadx, apktool, git, ffmpeg…), a Polish language pack, a curated set of community plugins, Edge TTS and an in-app updater. Built entirely inside Termux on an arm64 phone.*

---

## Co to jest

Apka pakuje w jeden plik APK:

- **DeepSeek Harness** (`@deepseek-ai/dsh`, profil web) uruchamiany na wbudowanym **Node.js 26** z Termuxa,
- **interfejs po polsku** (pakiet językowy przez oficjalny mechanizm locale dsh, 41 obszarów, 1219 napisów),
- **komplet narzędzi dla modelu**, wszystkie na `PATH` narzędzia `bash`:
  - kompilatory: `cc`/`gcc`/`clang`/`c++`/`g++` (Zig, statyczne binarki działające na Androidzie), JDK 21 (`java`, `javac`, `jar`, `javap`, `jshell`), `kotlinc`, Python 3.14 z pip i numpy, Node 26 z npm/npx, `make`, `cmake`,
  - inżynieria wsteczna: `jadx`, `apktool`, `d2j-dex2jar` i reszta dex2jar, `aapt`, `aapt2`, GNU binutils (`objdump`, `nm`, `readelf`, `strings`, `ar`, `ld`, `as`),
  - system: GNU coreutils, `sed`, `gawk`, `grep`, `find`, `diff`, `patch`, `tar`, `gzip`, `xz`, `bzip2`, `zip`, `unzip`, `rg`, `fd`, `jq`, `tree`, `file`, `curl`, `wget`, `git` (HTTPS), `sqlite3`, `openssl`, `ffmpeg`, `ffprobe`,
- **pluginy społeczności**: mobilny UI (dsh-qol), pamięć między sesjami, cofanie tur z przywracaniem plików, bezpieczniki pętli (repeat-stop, tool-budget), 87 skilli inżynierii wstecznej, edycja plików diffem, zegar w kontekście, lista zadań między turami, most MCP po stdio, **TTS** (Edge TTS z polskimi głosami, równoległa synteza fragmentów),
- **usługę pierwszoplanową** trzymającą serwer przy życiu w tle (powiadomienie z przyciskami „Zatrzymaj" i „Aktualizuj"),
- **aktualizator w apce**: wbudowany npm pobiera nową wersję dsh, nakłada łatki pod Androida z prekompilowanych plików, testuje start i dopiero wtedy podmienia katalog.

## Instalacja

1. Pobierz `dsh-mobile.apk` z [Releases](../../releases) (ok. 600 MB).
2. Zezwól na instalację z nieznanych źródeł dla menedżera plików i zainstaluj.
3. Pierwsze uruchomienie rozpakowuje ok. 1,3 GB (60 tys. plików) do pamięci apki, kilka minut z licznikiem na ekranie. Kolejne starty trwają kilka sekund.
4. Zezwól na dostęp do plików: agent pracuje domyślnie w `Pobranych`, a apka pisze tam log (`Download/dsh_log.txt`).
5. Wpisz klucz API DeepSeek w oknie powitalnym harnessu.

Wymagania: Android 9+ (targetSdk 28 celowo, patrz niżej), arm64, ok. 2 GB wolnego miejsca.

## Użycie

- Interfejs jest w oknie apki, serwer nasłuchuje tylko na `127.0.0.1:3090`, każdy start ma nowy token.
- Język: Ustawienia → Ogólne → Język (domyślnie polski, gdy system jest polski).
- Tryb uprawnień: apka ustawia `danger-full-access`, bo jądro Androida nie ma Landlocka ani bubblewrapa, a dsh w trybach z sandboxem odmawia uruchamiania komend. Izolację zapewnia sam Android (katalog apki + pamięć współdzielona).
- TTS: przycisk głośnika przy odpowiedzi, przełącznik „Czytaj automatycznie" w kompozytorze, ustawienia w Ustawienia → Pluginy → Głos. Domyślny głos `pl-PL-ZofiaNeural`, liczba równoległych syntez `DSH_TTS_EDGE_PARALLEL` (domyślnie 30).
- Aktualizacja dsh: powiadomienie → „Aktualizuj". Po starcie apka sprawdza npm i pokazuje dostępną wersję.
- `AGENTS.md` w katalogu roboczym jest wstrzykiwany do kontekstu modelu.

## Jak to działa

```
APK
├── assets/payload.zip           (stored, ~610 MB) → rozpakowany do filesDir/rt przy pierwszym starcie
│   ├── bin/  node bash python3 …  + wrappery (cc, javac, jadx, npm …)
│   ├── lib/  *.so z Termuxa (domknięcie NEEDED), python3.14/, node_modules/npm
│   ├── opt/  jdk, zig, jadx, apktool, kotlin, dex2jar
│   ├── node_modules/            dsh + pluginy (npm)
│   ├── dsh-locale-pl/           plugin z polskim pakietem językowym
│   ├── android.patch.yml        nakładka profilu: pluginy, prompt systemowy, locale
│   ├── android-shim.cjs         --require: fs.link → copyFile (Android zabrania hardlinków)
│   ├── android-patches/*.mjs    łatki na pluginy (równoległy TTS, polskie napisy) nakładane po npm install
│   ├── android-prebuilt/        pty.node, system.node (flock) — prekompilowane addony
│   ├── android-update.mjs       aktualizator w apce
│   ├── tools.env, links.txt     zmienne środowiska i dowiązania odtwarzane po rozpakowaniu
│   └── etc/tls/cert.pem
├── ServerService                foreground service: node … dsh --profile web --patch rt/android.patch.yml --port 3090
└── MainActivity                 WebView z adresem serwera (token ze stdout)
```

Rzeczy, które trzeba było obejść, żeby Node i dsh z Termuxa działały w cudzej apce:

| Problem | Rozwiązanie |
|---|---|
| binarki Termuxa mają wkompilowany prefiks `/data/data/com.termux/files/usr` | `LD_LIBRARY_PATH`, `OPENSSL_CONF=/dev/null`, `SSL_CERT_FILE`, `GIT_EXEC_PATH`, `MAGIC`, `CMAKE_ROOT`… (`tools.env`) |
| exec i dlopen z katalogu danych apki blokowane od API 29 | `targetSdk 28` (tak samo robi Termux) |
| SELinux zabrania hardlinków `link()` | shim podmieniający `fs.link` na `copyFile(COPYFILE_EXCL)` |
| addon `flock` tylko dla linux/darwin | `flock.c` skompilowany clangiem jako `node-addon-system-android-arm64` + patch loadera |
| `sharp` bez binarki android-arm64 | wariant WebAssembly |
| `node-pty` bez prebuilda | build node-gyp z `-Dandroid_ndk_path=` |
| brak sandboxa (Landlock/bwrap) | `DSH_PERMISSION_MODE=danger-full-access` |
| zip nie przenosi dowiązań | `links.txt` odtwarzany przez `Os.symlink` |
| skrypty z shebangiem Termuxa | `#!/system/bin/sh` + exec przez wbudowanego basha |

## Budowanie ze źródeł (Termux, arm64)

Wymagania: Termux z `nodejs` (26), `python` (3.14), `clang`, `openjdk-21`, `git`, `zip`, `aapt2`, `apksigner`, `gradle` przez wrapper projektu, oraz pakiety narzędzi kopiowanych do payloadu (`binutils`, `ripgrep`, `fd`, `jq`, `tree`, `file`, `ffmpeg`, `sqlite`, `kotlin`, `dex2jar`, `cmake`, `make`, `python-numpy`…). Szczegóły pułapek Gradle/aapt2 na Termuxie: `app/gradle.properties`.

```sh
# 1. instalacja dsh z łatkami pod Androida (raz; potem robi to update.sh)
mkdir ~/dsh-test && cd ~/dsh-test && npm init -y && npm install --ignore-scripts --force @deepseek-ai/dsh
# 2. komplet narzędzi z Termuxa + pobrane archiwa (zig, jadx, apktool) -> tools/root
tools/build-tools.sh
# 3. pełny przebieg: npm -> łatki natywne -> runtime -> pakiet językowy -> payload -> APK
./update.sh                 # opcje: --tag alpha|X.Y.Z  --skip-npm  --force  --debug
```

`update.sh` kończy podpisanym APK w `/sdcard/Download/dsh-mobile.apk`. Podpis release oczekuje klucza `~/.android/ciuchy-release.jks` (alias `ciuchy`, hasło w `~/.android/ciuchy-release.pass`); zmień `signingConfigs` w `app/app/build.gradle.kts` na własny klucz albo użyj `--debug`.

Testy: `tools/test-tools.sh <rt>` (38 testów narzędzi w czystym środowisku), `update.sh` sam testuje start dsh na wystawionym runtime przed pakowaniem.

## Tłumaczenie

- Interfejs dsh: `locale-pl/pl-1..4.json` → `pl.json` → `build-plugin.mjs` → plugin `@dsh-local/locale-pl`. Brakujące klucze po aktualizacji dsh spadają na angielski; `update.sh` wypisuje listę „BRAK TŁUMACZEŃ".
- Pluginy społeczności nie używają mechanizmu locale dsh (chińskie napisy na sztywno albo własne słowniki zh/en), dlatego są spolszczone łatkami `android-patches/{qol,rewind,tts}-polish.mjs`. Gdy autor zmieni tekst, łatka zatrzymuje aktualizację z komunikatem zamiast po cichu przepuścić chiński.

## Ograniczenia

- Brak menedżera pakietów w apce: pip buduje tylko czyste pakiety Pythona, npm tylko pakiety bez części natywnej.
- Aktualizator w apce wymaga tej samej wersji `node-pty`, co prekompilowana; inaczej odsyła do `update.sh` w Termuxie (tam jest kompilator).
- 30 równoległych połączeń do Edge TTS to dużo; przy bardzo długich odpowiedziach Microsoft może odrzucać część, plugin ponawia i w ostateczności pomija fragment.
- Rozmiar: APK ok. 600 MB, po rozpakowaniu ok. 1,5 GB.

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
| ffmpeg | LGPL/GPL (build Termuxa) |
| curl, openssl, sqlite, zip/unzip, xz, bzip2, jq, ripgrep, fd, tree, file, cmake | licencje własne (MIT/BSD/zlib i podobne) |
| pluginy społeczności dsh (dsh-qol, dsh-memory-connect, dsh-turn-rewind, dsh-reverse-skill, dsh-patch-edit-plus, dsh-repeat-stop, dsh-tool-budget, dsh-clock-context, dsh-todo-continuity, dsh-mcp-bridge, dsh-plugin-tts) | wg repozytoriów autorów (MIT) |

Binarki pochodzą z pakietów Termuxa (https://github.com/termux/termux-packages) oraz oficjalnych wydań Zig, jadx i apktool.

## Struktura repozytorium

```
app/            projekt Gradle (Kotlin): App.kt, ServerService.kt, MainActivity.kt
stage/          runtime i pliki payloadu (bez node_modules — te są w ~/dsh-test)
tools/          build-tools.sh, merge-tools.sh, apply-links.sh, test-tools.sh, root/ (wynik)
locale-pl/      polski pakiet językowy: extract-en.mjs, pl-*.json, build-plugin.mjs, android.patch.yml
update.sh       pełny przebieg budowania i aktualizacji
```
