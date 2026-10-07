// Łatka: logowanie kontem DeepSeek (Google / e-mail) w DSH Mobile. @deepseek-ai/dsh-client-ui-settings-account rejestruje
// całą sekcję konta tylko w aplikacji desktopowej („if (!("dshDesktop" in globalThis)) return;”), choć samo logowanie
// tego nie wymaga: okno logowania ma zwykły link „Otwórz” do https://platform.deepseek.com/dsh/authorize, a powrót idzie
// na serwer dsh pod <origin>/oauth/callback (bez ciasteczka sesji, chroniony state + PKCE). W DSH Mobile sekcja włącza się,
// gdy jest mostek apki DshMobileUpdate (MainActivity); dshDesktop NIE jest udawany (jego obecność przełącza w dsh inne
// rzeczy w tryb desktopowy). Apka otwiera platform.deepseek.com w przeglądarce systemowej (Google blokuje logowanie w WebView).
// Użycie: node account-mobile.mjs <katalog node_modules>   (idempotentna; brak wzorca = błąd, bo upstream się zmienił)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rel = '@deepseek-ai/dsh-client-ui-settings-account/lib/client.js';
// Od dsh 0.2.0 pakiety @deepseek-ai/* są zagnieżdżone pod @deepseek-ai/dsh (na górze tylko dowiązania z android-hoist).
const file = [join(process.argv[2], '@deepseek-ai/dsh/node_modules', rel), join(process.argv[2], rel)].find(existsSync);
if (!file) { console.log('account-mobile: brak dsh-client-ui-settings-account, pomijam'); process.exit(0); }
let s = readFileSync(file, 'utf8');
if (s.includes('[android] account')) { console.log('account-mobile: już nałożona'); process.exit(0); }
const a = 'if (!("dshDesktop" in globalThis)) return;';
if (s.split(a).length !== 2) throw new Error('account-mobile: nie znaleziono warunku rejestracji sekcji konta — plugin zmienił się upstream');
s = s.replace(a, 'if (!("dshDesktop" in globalThis) && !globalThis.DshMobileUpdate) return; /* [android] account: także w DSH Mobile */');
writeFileSync(file, s);
console.log('account-mobile: sekcja konta DeepSeek włączona w DSH Mobile');
