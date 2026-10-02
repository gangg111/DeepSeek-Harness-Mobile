// Od dsh 0.2.0 npm zagnieżdża pakiety @deepseek-ai/* pod node_modules/@deepseek-ai/dsh/node_modules (na górze zostają
// stare wersje trzymane przez peery pluginów społeczności). Pluginy importujące np. @deepseek-ai/dsh-tools nie znajdują
// ich wtedy wcale. Ten skrypt dowiązuje brakujące na górze pakiety do zagnieżdżonych (symlink => ta sama instancja modułu
// co w dsh). Istniejących na górze (stare peery) nie rusza. Lista dowiązań trafia do node_modules/.android-hoist-links
// (format links.txt apki: "ścieżka -> cel"), bo zip ich nie przenosi — App.applyLinks odtwarza je po rozpakowaniu.
// Użycie: node android-hoist.mjs <katalog node_modules>   (idempotentny)
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const nm = process.argv[2];
const nestedScoped = join(nm, '@deepseek-ai/dsh/node_modules/@deepseek-ai');
const nestedPlain = join(nm, '@deepseek-ai/dsh/node_modules');
const links = [];
function link(topRel, targetRel) {
  const top = join(nm, topRel);
  if (existsSync(top) || (safeLstat(top) && safeLstat(top).isSymbolicLink())) {
    if (safeLstat(top).isSymbolicLink() && readlinkSync(top) !== targetRel) { unlinkSync(top); symlinkSync(targetRel, top, 'dir'); }
    else if (!safeLstat(top).isSymbolicLink()) return;   // prawdziwy pakiet na górze (stary peer) — zostaje
  } else symlinkSync(targetRel, top, 'dir');
  links.push(`node_modules/${topRel} -> ${targetRel}`);
}
function safeLstat(p) { try { return lstatSync(p); } catch { return null; } }
if (!existsSync(nestedScoped)) { console.log('android-hoist: brak zagnieżdżonych @deepseek-ai/*, nic do roboty'); writeFileSync(join(nm, '.android-hoist-links'), ''); process.exit(0); }
mkdirSync(join(nm, '@deepseek-ai'), { recursive: true });
for (const name of readdirSync(nestedScoped)) link(`@deepseek-ai/${name}`, `dsh/node_modules/@deepseek-ai/${name}`);
for (const name of readdirSync(nestedPlain)) {
  if (name.startsWith('@') || name.startsWith('.')) continue;
  link(name, `@deepseek-ai/dsh/node_modules/${name}`);
}
writeFileSync(join(nm, '.android-hoist-links'), links.join('\n') + (links.length ? '\n' : ''));
console.log(`android-hoist: ${links.length} dowiązań (${readdirSync(nestedScoped).length} zagnieżdżonych @deepseek-ai/*)`);
