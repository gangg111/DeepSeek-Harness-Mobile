// Łatka: @anionex/dsh-turn-rewind (klient) deklaruje `inject: [..., 'settingsScope']`, ale w dsh >= 0.2.0 żaden plugin
// kliencki nie dostarcza serwisu `settingsScope` — cordis 4 nie ma zależności opcjonalnych, więc moduł czeka w nieskończoność
// („pending (waiting for service: settingsScope)”, interfejs zgłasza „Failed to load plugins”). Fasada runnera dopuszcza
// `ctx.get(name)` bez deklaracji, więc usuwamy serwis z inject i czytamy go opcjonalnie.
// Użycie: node rewind-inject-020.mjs <katalog node_modules>   (idempotentna)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.argv[2], '@anionex/dsh-turn-rewind/lib/client.js');
if (!existsSync(file)) { console.log('rewind-inject-020: brak pluginu turn-rewind, pomijam'); process.exit(0); }
let s = readFileSync(file, 'utf8');
if (s.includes('[android] settingsScope optional')) { console.log('rewind-inject-020: już nałożona'); process.exit(0); }
const a = "exports.inject = ['slots', 'sessions', 'conversation', 'settingsScope'];";
const b = "scope: ctx.settingsScope?.bind({ namespace: 'turn-rewind' }),";
if (!s.includes(a) || !s.includes(b)) throw new Error('rewind-inject-020: nie znaleziono fragmentów — plugin zmienił się upstream');
s = s.replace(a, "exports.inject = ['slots', 'sessions', 'conversation']; // [android] settingsScope optional: dsh>=0.2.0 nie dostarcza tego serwisu")
     .replace(b, "scope: ctx.get('settingsScope')?.bind({ namespace: 'turn-rewind' }),");
writeFileSync(file, s);
console.log('rewind-inject-020: settingsScope usunięty z inject, odczyt przez ctx.get()');
