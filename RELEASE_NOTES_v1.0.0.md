# DSH Mobile 1.0.0

**DeepSeek Harness 0.1.5-rc.3 · versionCode 13 · payload 11 · arm64 · ok. 600 MB**

Pierwsze publiczne wydanie: kompletny DeepSeek Harness w jednej apce na Androida, bez Termuxa i bez roota.

## Co jest w środku

- **DeepSeek Harness 0.1.5-rc.3** (profil web) na wbudowanym Node.js 26.2, interfejs w oknie apki, serwer tylko na localhost z tokenem.
- **Polski interfejs**: pakiet językowy przez oficjalny mechanizm locale dsh (1219 napisów), automatyczny wybór według języka systemu.
- **Komplet narzędzi dla agenta**: C/C++ (Zig 0.16 jako `cc`/`gcc`/`clang`/`c++`), JDK 21 z `javac`, Kotlin, Python 3.14 z pip i numpy, Node 26 z npm, `make`, `cmake`, jadx 1.5.6, apktool 3.0.3, dex2jar, aapt/aapt2, GNU binutils, git (HTTPS), GNU coreutils i narzędzia tekstowe, `rg`, `fd`, `jq`, `curl`, `wget`, `sqlite3`, `openssl`, `ffmpeg`.
- **Pluginy**: dsh-qol (mobilny UI), dsh-memory-connect (pamięć między sesjami), dsh-turn-rewind (cofanie tury z przywracaniem plików), dsh-repeat-stop i dsh-tool-budget (bezpieczniki pętli, próg 8 i limit 500 wywołań), dsh-reverse-skill (87 skilli inżynierii wstecznej), dsh-patch-edit-plus, dsh-clock-context (Europe/Warsaw), dsh-todo-continuity, dsh-mcp-bridge (MCP po stdio).
- **TTS**: dsh-plugin-tts z Edge TTS, polskie głosy Zofia i Marek (Zofia domyślnie), spolszczony interfejs, równoległa synteza do 30 fragmentów naraz (zmienna `DSH_TTS_EDGE_PARALLEL`).
- **Usługa pierwszoplanowa**: serwer nie ginie w tle, powiadomienie z przyciskami „Zatrzymaj" i „Aktualizuj", odtwarzane po zmieceniu.
- **Aktualizator w apce**: wbudowany npm pobiera nową wersję dsh, nakłada łatki pod Androida z prekompilowanych addonów, testuje start serwera i dopiero wtedy podmienia katalog. Po starcie apka sprawdza, czy jest nowsza wersja.
- **Prompt systemowy** informuje model o środowisku Androida i dostępnych narzędziach.

## Instalacja i pierwsze uruchomienie

1. Zainstaluj `dsh-mobile.apk` (menedżer plików → zezwól na nieznane źródła).
2. Pierwszy start rozpakowuje ok. 1,3 GB, kilka minut z licznikiem.
3. Zezwól na dostęp do plików; katalog roboczy to `Pobrane`.
4. Wpisz klucz API DeepSeek.

Aktualizacja z poprzednich buildów testowych podpisanych kluczem debug wymaga odinstalowania (inny podpis).

## Znane ograniczenia

- Tryb uprawnień `danger-full-access` na stałe: jądro Androida nie ma Landlocka ani bubblewrapa, więc sandbox dsh nie ma czym izolować. Izoluje sam Android.
- pip instaluje tylko czyste pakiety Pythona, npm tylko pakiety bez części natywnej (brak menedżera pakietów systemowych).
- Zmiana wersji `node-pty` w przyszłym dsh wymaga przebudowy w Termuxie (`update.sh`), aktualizator w apce to zgłosi.
- Komunikaty hosta TTS dotyczące lokalnych silników RVC zostają po angielsku.
- Wysoka równoległość Edge TTS może przy bardzo długich tekstach skutkować odrzuceniem części połączeń; fragment jest ponawiany, w ostateczności pomijany z komunikatem.

## Weryfikacja przed wydaniem

- 38 testów narzędzi w czystym środowisku bez Termuxa: kompilacja i uruchomienie C, C++, Javy, Kotlina, klonowanie repozytorium przez HTTPS, numpy, jadx, apktool, dex2jar, ffmpeg, wszystkie zaliczone.
- Start dsh na wystawionym runtime z pełną nakładką pluginów przed pakowaniem.
- Na telefonie: model napisał, skompilował i uruchomił program w C, zdekompilował APK, odczytał odpowiedź na głos po polsku.
- 22 fragmenty polskiego tekstu zsyntezowane przez Edge TTS w 10 s.

## Licencje

APK zawiera oprogramowanie osób trzecich: DeepSeek Harness (MIT), Node.js (MIT), OpenJDK 21 (GPLv2 + Classpath Exception), Zig (MIT), Kotlin, jadx, apktool, dex2jar (Apache 2.0), Python (PSF), numpy (BSD), pakiety GNU z Termuxa (GPLv2/v3), git (GPLv2), ffmpeg (LGPL/GPL), pluginy społeczności dsh (MIT). Pełna lista w README.

## Sumy kontrolne

`dsh-mobile.apk` — md5 `d6955b0c7dc36a1b337bf8f3e7461cf1` (plik `dsh-mobile.apk.md5`).
