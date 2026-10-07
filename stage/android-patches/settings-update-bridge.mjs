// Łatka: niebieski przycisk aktualizacji na dole paska bocznego dsh (dsh-client-ui-settings-general, DesktopUpdateIndicator)
// pojawia się tylko w aplikacji desktopowej, która wystawia mostek globalThis.dshDesktop.updates. Samego dshDesktop NIE
// udajemy: jego obecność przełącza w dsh inne rzeczy na tryb desktopowy (konto DeepSeek, analityka, ekran powitalny).
// Zamiast tego, gdy dshDesktop brak, przycisk czyta stan z mostka apki DshMobileUpdate (MainActivity.UpdateBridge:
// status() -> JSON „presentation”, open() -> ta sama aktualizacja co przycisk w powiadomieniu: najpierw APK z GitHuba, potem dsh).
// Użycie: node settings-update-bridge.mjs <katalog node_modules>   (idempotentna; brak wzorca = błąd, bo upstream się zmienił)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rel = '@deepseek-ai/dsh-client-ui-settings-general/lib/client.js';
// Od dsh 0.2.0 pakiety @deepseek-ai/* są zagnieżdżone pod @deepseek-ai/dsh (na górze tylko dowiązania z android-hoist).
const file = [join(process.argv[2], '@deepseek-ai/dsh/node_modules', rel), join(process.argv[2], rel)].find(existsSync);
if (!file) { console.log('settings-update-bridge: brak dsh-client-ui-settings-general, pomijam'); process.exit(0); }
let s = readFileSync(file, 'utf8');
if (s.includes('[android] update bridge')) { console.log('settings-update-bridge: już nałożona'); process.exit(0); }
const a = 'const carrier = globalThis.dshDesktop;';
if (s.split(a).length !== 2) throw new Error('settings-update-bridge: nie znaleziono odczytu dshDesktop — plugin zmienił się upstream');
const bridge = `globalThis.dshDesktop ?? (/* [android] update bridge */ globalThis.DshMobileUpdate ? { protocolVersion: 1, updates: (() => {
\tconst B = globalThis.DshMobileUpdate;
\tconst read = () => { try { return JSON.parse(B.status()); } catch { return { phase: "idle" }; } };
\treturn {
\t\tstatus: () => Promise.resolve(read()),
\t\tsubscribe: (cb) => { let last = ""; const tick = () => { const p = read(); const j = JSON.stringify(p); if (j !== last) { last = j; cb(p); } }; tick(); const id = setInterval(tick, 1500); return () => clearInterval(id); },
\t\topen: () => B.open() ? Promise.resolve() : Promise.reject(new Error("update bridge refused"))
\t};
})() } : void 0)`;
s = s.replace(a, `const carrier = ${bridge};`);
writeFileSync(file, s);
console.log('settings-update-bridge: przycisk aktualizacji czyta stan z mostka apki (DshMobileUpdate)');
