# DSH Mobile 1.3.0

**DeepSeek Harness 0.2.0-rc.2 · versionCode 91 · payload 72 · arm64 · ok. 890 MB**

*English summary: sessions now travel between the computer and the phone **together with their project files**, and the files stay in sync with the writing: the phone pulls what changed on the PC when it takes over, and sends back what changed on the phone (including shell-created files) before the computer takes over; untouched files are replaced quietly, files changed on both sides keep the other version next to them, and writing never moves until the files have arrived and been confirmed. Re-sending a synced session updates the existing copy, deleting a synced session asks you to unlink first, and every transfer shows its progress. The agent's toolchain grew a lot: **.NET 10 SDK and PowerShell 7**, `dsh-install` for any Termux package (verified like apt), qemu-x86_64 with a glibc sysroot, proot, adb, ssh/rsync/tmux and many more, and Termux paths no longer need workarounds (`#!/usr/bin/env` shebangs, `tar -z`, `make`, git hooks, 7z, dig, Java, fontconfig all work as written). `xdg-open` opens results in phone apps, with a built-in Markdown reader. Full project-file features need [dsh-remote-control](https://github.com/gangg111/dsh-remote-control) 0.7.0+ on the PC; with older versions sessions transfer as before.*

## Sesje i pliki projektu z komputera

Wymaga [dsh-remote-control](https://github.com/gangg111/dsh-remote-control) 0.7.0+ na PC. Starsza wtyczka: sesje przenoszą się jak dotąd, bez plików. Każda funkcja włącza się tylko wtedy, gdy komputer ją ogłasza.

- **Sesja przychodzi z całym projektem.** Katalog roboczy sesji na PC (bez `bin`, `obj`, `node_modules` i innych wyników budowania, bez sekretów, binarek i plików ponad 5 MB; do 64 MB i 20 000 plików) trafia do `~/<projekt>` jako osobny obszar roboczy, który staje się katalogiem roboczym sesji. Agent dostaje w prompcie mapowanie ścieżek PC ↔ telefon i informację, że zamiast `.exe` ma tu pwsh i dotnet.
- **Synchronizacja plików razem z pisaniem.**
  - Telefon przejmuje pisanie → najpierw pobiera pliki zmienione na PC od ostatniego przeniesienia i potwierdza ich zastosowanie.
  - Komputer przejmuje pisanie → telefon najpierw odsyła pliki zmienione u siebie (także zrobione poleceniami powłoki).
  - Plik niezmieniony od ostatniego przeniesienia jest podmieniany bez kopii; zmieniony po obu stronach zostawia drugą wersję obok jako `*.przed-importem-<data>`.
  - Dopóki pliki nie dojdą i nie zostaną potwierdzone, pisanie zostaje tam, gdzie jest (tury rozmowy synchronizują się dalej), więc stara kopia nie nadpisze nowszej pracy. Sprawdzone testami awarii pobrania i potwierdzenia.
- **Ponowne wysłanie** synchronizowanej sesji aktualizuje istniejącą kopię zamiast tworzyć kolejną.
- **Postęp transferów:** strzałka do/z telefonu z paskiem przy sesji, pasek nad polem pisania i na ekranie Code, animowana ikona Code w pasku bocznym; procenty z rozmiaru, puste obiegi nie migają.
- **Usuwanie sesji:** „Usuń sesję” (wtyczka archiwum) kasuje sesję z dysku; sesja wciąż synchronizowana jest odrzucana z komunikatem „najpierw odłącz synchronizację”. Naprawione: dotknięcie pozycji menu „…” sesji nic nie robiło (zamykanie panelu dotknięciem obok połykało je).
- **Odbiór z PC:** nieudane pierwsze zapytanie do komputera (zimne połączenie Tailscale) wyłączało po cichu odbiór sesji na 10 minut. Teraz telefon ponawia w kolejnym obiegu i zapisuje błąd w logu.

## Narzędzia agenta

- **.NET 10 SDK** (`dotnet new/build/run`, natywny build Termuxa pod Androida) i **PowerShell 7.6** (`pwsh`, z biblioteką `libpsl-native` zbudowaną pod Androida).
- **`dsh-install <pakiet>`**: dowolny pakiet Termuxa z zależnościami do `~/.local`, łańcuch zaufania jak w apt (podpis GnuPG indeksu → SHA256 indeksu → SHA256 pakietu), sprawdzenie nowych binarek; `-s`, `-l`, `-r`, `-f`.
- Nowe narzędzia: `qemu-x86_64` z sysrootem glibc x86_64 i kompilacją `cc -target x86_64-linux-gnu|musl`, `proot` (rootfs x86_64 zamiast Dockera), `adb`, `gh`, `ssh`/`scp`/`sftp`, `rsync`, `tmux`, `less`, `nano`, `dig`, `whois`, `socat`, `nmap`, `iperf3`, `7z`, `zstd`, `sox`, `lame`, `pngquant`, `rsvg-convert`, graphviz `dot`, `perl` z autotools, `meson`, `ninja`, `pkg-config`, `patchelf`, Pillow i requests.
- **Ścieżki Termuxa bez obejść:**
  - shebangi `#!/usr/bin/env …` i `#!/bin/sh` działają bez edycji (termux-exec);
  - 28 binarek z wkompilowanym `$PREFIX/bin/sh` (tar -z, make, hooki i aliasy gita, `system()` w awk/perl…) używa `/system/bin/sh`;
  - `7z` pakuje (samodzielny 7zz), `dig` działa bez `@serwera`, Java ma katalog tymczasowy i domowy apki (jadx bez zmiennych), `dot` bez błędu fontconfig, `git status` bez ostrzeżeń, autotools bez dodatkowych zmiennych;
  - `~/.local/bin` pierwsze w `PATH`, `~/.local/lib` w `LD_LIBRARY_PATH`.
- Agent sam zweryfikował wszystkie kryteria odbioru ze swojego raportu na telefonie; `tools/test-tools.sh` ma 85 testów.

## Otwieranie plików

- **`xdg-open <plik>`**: agent otwiera wynik (PDF, obraz, film, dokument) w aplikacji telefonu przez systemowy wybór aplikacji. Ścieżka idzie do apki przez lokalne gniazdo dostępne tylko dla jej własnego UID, a plik jest udostępniany przez FileProvider z uprawnieniem do URI.
- Wbudowany **czytnik/edytor Markdown** dla plików `.md`.

## Rozmiar

APK ok. 890 MB, po rozpakowaniu ok. 2,1 GB (57 tys. plików); razem ok. 3,5 GB wolnego miejsca. Pierwsze uruchomienie po aktualizacji rozpakowuje runtime od nowa (kilka minut).
