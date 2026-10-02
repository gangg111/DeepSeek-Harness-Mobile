# DSH Mobile 1.2.0

**DeepSeek Harness 0.2.0-rc.2 · versionCode 24 · payload 21 · arm64 · ok. 620 MB**

*English summary: DeepSeek Harness upgraded from 0.1.5-rc.3 to **0.2.0-rc.2** (plugin manager, automation tasks, voice input, sidebar terminal and browser, Office/Excel previews, agent teams, keyboard shortcuts…). The Polish language pack now covers all **2446 strings** (1369 new). Two Android-specific fixes make 0.2.0 run on the phone: `koffi` pinned by dsh has no android-arm64 binary (resolved with an `overrides` to the newest 3.x that has one) and the new native `node-addon-require-builtin` has no Android variant (replaced by a JS package working under `--expose-internals`). The in-app updater applies both automatically and remembers a failed update instead of offering the same version again. Two community plugins (`dsh-memory-connect`, `dsh-reverse-skill`) are disabled by dsh 0.2.0 itself as incompatible.*

## Co nowego

- **DeepSeek Harness 0.2.0-rc.2** (z 0.1.5-rc.3): menedżer pluginów w aplikacji (instalacja z npm, GitHuba i katalogu), zadania automatyczne i przypomnienia, wprowadzanie głosowe (lokalne modele albo chmura), terminal i przeglądarka w panelu bocznym, podgląd dokumentów Office i arkuszy, zespoły agentów, edytor skrótów klawiszowych, przegląd zmian z tury, tryb „Automatyczny przegląd” uprawnień, konto DeepSeek z saldem i doładowaniem.
- **Polski interfejs dla całego 0.2.0**: 2446 napisów w 58 przestrzeniach nazw (1369 nowych, m.in. menedżer pluginów 189, rozmowa 222, zadania automatyczne 133, głos 101, konto 93, czat 91, skróty 56).
- **dsh 0.2.0 na Androidzie** (bez tego nie startuje):
  - `dsh-fs-local` przypina `koffi@3.1.1`, dla którego nie ma pakietu `@koromix/koffi-android-arm64`; `update.sh` i aktualizator w apce wymuszają przez `overrides` najnowszą wersję tej samej linii głównej z binarką (dziś 3.3.2).
  - nowy natywny `node-addon-require-builtin` nie ma wariantu android-arm64 ani źródeł; podstawiamy pakiet JS `node-addon-require-builtin-android-arm64`, który pod `--expose-internals` zwraca wewnętrzne moduły zwykłym `require()` (kształt zgodny z walidacją loadera, napi-v9).
  - npm po aktualizacji 0.1.5→0.2.0 zagnieżdża pakiety `@deepseek-ai/*` pod `@deepseek-ai/dsh/node_modules`, przez co pluginy społeczności (np. `dsh-patch-edit-plus`) nie znajdowały `@deepseek-ai/dsh-tools`; skrypt `android-hoist.mjs` dowiązuje brakujące pakiety na górze (symlinki = ta sama instancja modułu co w dsh), w APK odtwarzane z `links.txt` po rozpakowaniu.
  - `dsh-mcp-connect` deklarował wyniki narzędzi jako `type: 'json'`, czego ścisły walidator 0.2.0 nie zna; łatka `mcp-schema-020.mjs` zamienia je na `object/additionalProperties` (plugin znów wstaje).
  - moduł kliencki `dsh-turn-rewind` deklarował zależność od serwisu `settingsScope`, którego żaden plugin kliencki 0.2.0 nie dostarcza, więc czekał w nieskończoność („Failed to load plugins … waiting for service: settingsScope”); łatka `rewind-inject-020.mjs` usuwa go z `inject` i czyta opcjonalnie przez `ctx.get()`.
- **Aktualizator w apce** stosuje wszystkie powyższe obejścia sam. Gdy kolejna wersja dsh wprowadzi zmiany wymagające ręcznej przebudowy i aktualizacja padnie, powiadomienie mówi wprost, że trzeba pobrać nową wersję apki, z przyciskiem „Pobierz APK” prowadzącym do https://github.com/gangg111/DeepSeek-Harness-Mobile/releases; nieudana wersja jest zapamiętana, więc po restarcie komunikat zostaje (zamiast ponownej propozycji tej samej aktualizacji).

## Zmiany względem 1.1.0 w ekranie Code

- Nieudana sonda komputera jest ponawiana po 30 s, 2 min i 10 min, potem dopiero po zmianie stanu online urządzenia; log podaje numer próby i czas trwania sondy.
- Lista urządzeń z tailnetu sprawdzana co sekundę do pierwszej niepustej (zaraz po `Running` bywa pusta), potem co 30 s.

## Pluginy

dsh 0.2.0 sam wyłącza `dsh-memory-connect` (pamięć między sesjami) i `dsh-reverse-skill` (87 skilli inżynierii wstecznej): ich autorzy deklarują zgodność tylko z dsh 0.1.x. Pozostałe pluginy (dsh-qol, dsh-turn-rewind, dsh-patch-edit-plus, dsh-repeat-stop, dsh-tool-budget, dsh-clock-context, dsh-todo-continuity, dsh-mcp-bridge, dsh-plugin-tts, Code, tap-outside) ładują się bez ostrzeżeń („0 entries did not activate”); polskie łatki na dsh-qol, turn-rewind i TTS nakładają się bez zmian. Z `package.json` zniknęły stare bezpośrednie piny `@deepseek-ai/dsh-jobs`, `dsh-settings`, `dsh-session-persistence`, `dsh-session-title-llm`, `cordis-plugin-group` z 0.1.5.

## Instalacja

Aktualizacja z 1.1.0 bez odinstalowania (ten sam klucz). Pierwszy start rozpakowuje payload na nowo (ok. 2 min). Logowanie Tailscale, lista komputerów i sesje zostają (katalog `home` apki nie jest ruszany).

## Weryfikacja przed wydaniem

- Aktualizator z apki na kopii runtime w Termuxie: `RESULT: ok 0.2.0-rc.2` (npm install, overrides koffi, prebuilt node-pty, zamiennik require-builtin, łatki pluginów, test startu serwera).
- `update.sh --tag latest`: test startu dsh 0.2.0 na wystawionym runtime, raport tłumaczeń „kompletne” (0 braków, 0 błędów placeholderów w 2446 kluczach).
- `go test` (10) i `node --test` (10 pass, 1 pominięty) bez zmian.

## Sumy kontrolne

`dsh-mobile.apk` — md5 `6417c0e60c93997555cf4e8564003676` (plik `dsh-mobile.apk.md5`).
