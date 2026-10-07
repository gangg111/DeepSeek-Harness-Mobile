# DSH Mobile 1.2.0

**DeepSeek Harness 0.2.0-rc.2 · versionCode 44 · payload 29 · arm64 · ok. 620 MB**

*English summary: DeepSeek Harness upgraded from 0.1.5-rc.3 to **0.2.0-rc.2**; the UI is rendered 1.2× larger on the phone and the Android status/navigation bars follow the page background. Also: (plugin manager, automation tasks, voice input, sidebar terminal and browser, Office/Excel previews, agent teams, keyboard shortcuts…). The Polish language pack now covers all **2446 strings** (1369 new). Two Android-specific fixes make 0.2.0 run on the phone: `koffi` pinned by dsh has no android-arm64 binary (resolved with an `overrides` to the newest 3.x that has one) and the new native `node-addon-require-builtin` has no Android variant (replaced by a JS package working under `--expose-internals`). The in-app updater applies both automatically and remembers a failed update instead of offering the same version again. Two community plugins (`dsh-memory-connect`, `dsh-reverse-skill`) are disabled by dsh 0.2.0 itself as incompatible.*

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

## Wygląd na telefonie

- Interfejs dsh w WebView jest powiększony 1,2× przez meta viewport (szerokość strony = ekran/1,2, `initial-scale=1.2`): ikony, tekst i przyciski są większe, a szerokość w pikselach CSS spada (411 → ok. 342 na ekranie okładkowym, ok. 850 → ok. 708 na rozłożonym Foldzie), więc układ mobilny obejmuje też duży ekran. Wartość: stała `UI_ZOOM` w MainActivity. (Build 27 zastąpił CSS `zoom` z buildu 26, który rozjeżdżał pozycjonowanie wyskakujących menu: lista trybów dostępu w sesji z komputera wychodziła za ekran.)
- Pasek stanu i pasek nawigacji Androida przyjmują kolor tła strony dsh (odczyt z WebView po wczytaniu i co 2 s, ikony paska jasne/ciemne zależnie od tła), zamiast odcienia z motywu systemowego.
- Log apki dostaje linię `webview: {w, h, dpr, qolMobile, bg}` do diagnozy układu.
- Klawiatura Samsunga w kompozytorze zjadała pierwszą literę: edytor Lexical w dsh po pierwszej literze w pustym polu wstawia znaki zerowej szerokości i zaznacza wpisaną literę, a klawiatura składająca słowa nadpisuje ją następną (zapis zdarzeń w logu; Lexical #7210). Klawiatura Samsunga ignoruje flagę „bez podpowiedzi”, więc WebView zgłasza pola jako „widoczne hasło”: litery wchodzą wprost, bez składania. Koszt: brak podpowiedzi, autokorekty i pisania gestem w polach dsh w apce. Build 34.

## Zmiany względem 1.1.0 w ekranie Code

- Pola tekstowe ekranu Code (adres komputera, pierwsza wiadomość) są niekontrolowane: kontrolowane `value` razem z odświeżaniem listy co 5 s psuło kompozycję tekstu klawiatury Androida (pierwsza litera zaznaczona, następna ją zastępowała). Build 28.

- Nieudana sonda komputera jest ponawiana po 30 s, 2 min i 10 min, potem dopiero po zmianie stanu online urządzenia; log podaje numer próby i czas trwania sondy.
- Lista urządzeń z tailnetu sprawdzana co sekundę do pierwszej niepustej (zaraz po `Running` bywa pusta), potem co 30 s.

## Build 44 (payload 29)

- Bez zmian w działaniu względem buildu 43 — numer podbity do testu przycisku aktualizacji w interfejsie.

## Build 43 (payload 29)

- **Przycisk aktualizacji w interfejsie dsh**, jak w aplikacji desktopowej: niebieski przycisk na dole paska bocznego (i kropka na przycisku rozwijania paska) pokazuje dostępną aktualizację, postęp pobierania i „Zainstaluj i uruchom ponownie”. Kliknięcie robi to samo co „Aktualizuj” w powiadomieniu: najpierw nowe APK z tego repozytorium, potem dsh z npm. Apka nie udaje aplikacji desktopowej (to przełączyłoby w dsh logowanie do konta i analitykę) — przycisk czyta stan z mostka apki, dostępnego tylko dla lokalnego dsh.
- Log apki opisuje każdy wynik sprawdzenia GitHuba (także „brak nowszej wersji” i „wydanie bez dsh-mobile.json”).

## Build 42 (payload 28)

- **Aktualizacja apki jednym przyciskiem.** „Aktualizuj” w powiadomieniu najpierw sprawdza wydania w tym repozytorium: gdy jest nowsze APK (plik `dsh-mobile.json` w wydaniu, wyższy versionCode), apka pobiera je z postępem w powiadomieniu, sprawdza md5 i proponuje instalację przyciskiem „Zainstaluj”. Dopiero gdy nowszego APK nie ma, aktualizuje dsh z npm jak dotąd. Przy pierwszej instalacji z apki Android prosi o zgodę „Instaluj nieznane aplikacje”.
- **Polski dla pluginów instalowanych z menedżera:** Sklep z pluginami (dshmarket, 689 napisów) i Zarchiwizowane sesje (@michengai/dsh-archive-manager, 264) przez mechanizm językowy dsh; Cost (dsh-cost-meter, 614 tekstów) przez łatkę, którą apka nakłada przy każdym starcie i po każdej instalacji/aktualizacji pluginu (gdy kod pluginu się zmieni, łatka jest pomijana, a plugin zostaje po angielsku). Opisy pluginów w sklepie to dane od autorów i zostają w oryginale.

## Build 38 (payload 26)

- **Instalowanie pluginów z poziomu apki.** Runtime zawiera pnpm, więc „Pluginy → Dodaj plugin” instaluje pluginy z npm i z GitHuba (np. `@michengai/dsh-skills-manager`, `github:2002XiaoYu/dsh-session-diff`) tak jak na komputerze, a zainstalowane pokazują się w grupie „Zainstalowane”. Pluginy wbudowane w apkę (qol, turn-rewind, tts…) działają jak dotąd, ale menedżer ich nie wylicza.
- Git w apce nie czyta systemowej konfiguracji Termuxa (`GIT_CONFIG_NOSYSTEM=1`): na telefonach z zainstalowanym Termuxem kończył się błędem „Permission denied” przy `…/usr/etc/gitconfig`, m.in. przy instalacji pluginów z GitHuba.

## Build 36 (payload 24)

- Plugin cofania tur `dsh-turn-rewind` 0.3.9: autor sam naprawił zależność od `settingsScope` (nasza łatka się pomija), plugin ma własne napisy zh/en, a przy polskim interfejsie pokazuje spolszczone.

## Build 35 (payload 23)

- Przygotowanie pod dsh 0.2.1: zamiennik `node-addon-require-builtin` zwraca pole `product`, którego wymaga loader 0.1.7 (bez niego dsh 0.2.1 nie startuje), więc aktualizacja w apce do 0.2.1 nie padnie. Polskie tłumaczenie 70 nowych napisów 0.2.1 (m.in. dziennik sesji). Łatki turn-rewind gotowe na 0.3.9 (własne i18n pluginu: język `pl` wybiera spolszczone napisy).
- Payload bez zbędnych pakietów Pythona z Termuxa (wykluczenia przy kopiowaniu nie działały); w apce zostają pip i numpy.

## Pluginy

dsh 0.2.0 sam wyłącza `dsh-memory-connect` (pamięć między sesjami) i `dsh-reverse-skill` (87 skilli inżynierii wstecznej): ich autorzy deklarują zgodność tylko z dsh 0.1.x. Pozostałe pluginy (dsh-qol, dsh-turn-rewind, dsh-patch-edit-plus, dsh-repeat-stop, dsh-tool-budget, dsh-clock-context, dsh-todo-continuity, dsh-mcp-bridge, dsh-plugin-tts, Code, tap-outside) ładują się bez ostrzeżeń („0 entries did not activate”); polskie łatki na dsh-qol, turn-rewind i TTS nakładają się bez zmian. Z `package.json` zniknęły stare bezpośrednie piny `@deepseek-ai/dsh-jobs`, `dsh-settings`, `dsh-session-persistence`, `dsh-session-title-llm`, `cordis-plugin-group` z 0.1.5.

## Instalacja

Aktualizacja z 1.1.0 bez odinstalowania (ten sam klucz). Pierwszy start rozpakowuje payload na nowo (ok. 2 min). Logowanie Tailscale, lista komputerów i sesje zostają (katalog `home` apki nie jest ruszany).

## Weryfikacja przed wydaniem

- Aktualizator z apki na kopii runtime w Termuxie: `RESULT: ok 0.2.0-rc.2` (npm install, overrides koffi, prebuilt node-pty, zamiennik require-builtin, łatki pluginów, test startu serwera).
- `update.sh --tag latest`: test startu dsh 0.2.0 na wystawionym runtime, raport tłumaczeń „kompletne” (0 braków, 0 błędów placeholderów w 2446 kluczach).
- `go test` (10) i `node --test` (10 pass, 1 pominięty) bez zmian.

## Sumy kontrolne

`dsh-mobile.apk` — md5 `6273ad55a0c0ceb50850c6f285e8c8d1` (plik `dsh-mobile.apk.md5`).
