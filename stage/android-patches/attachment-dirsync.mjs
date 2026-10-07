// Łatka: zapis załącznika (obraz w rozmowie, import sesji z komputera) w @deepseek-ai/dsh-attachment-local robi fsync
// KAŻDEGO katalogu nadrzędnego DSH_HOME aż do „/” (ensureDurableHome -> syncDirectory). Na Androidzie katalogi systemowe
// nad danymi apki (/data/user/0, /data, /) nie dają się otworzyć: open() -> EACCES i cały zapis kończy się błędem
// „Unable to persist attachment” (u nas: „EACCES: permission denied, open '/data/user/0'” przy imporcie sesji).
// Aplikacja niczego w tych katalogach nie tworzy, więc nie ma w nich wpisów do utrwalenia: EACCES/EPERM przy otwarciu
// katalogu = pomijamy jego fsync. Katalogi apki (DSH_HOME i niżej) nadal są synchronizowane jak w oryginale.
// Użycie: node attachment-dirsync.mjs <katalog node_modules>   (idempotentna; brak wzorca = błąd, bo upstream się zmienił)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rel = '@deepseek-ai/dsh-attachment-local/lib/index.js';
// Od dsh 0.2.0 pakiety @deepseek-ai/* są zagnieżdżone pod @deepseek-ai/dsh (na górze tylko dowiązania z android-hoist).
const file = [join(process.argv[2], '@deepseek-ai/dsh/node_modules', rel), join(process.argv[2], rel)].find(existsSync);
if (!file) { console.log('attachment-dirsync: brak dsh-attachment-local, pomijam'); process.exit(0); }
let s = readFileSync(file, 'utf8');
if (s.includes('[android] dirsync')) { console.log('attachment-dirsync: już nałożona'); process.exit(0); }
const a = '\tconst handle = await open(path, constants.O_RDONLY);\n\ttry {\n\t\tawait handle.sync();';
if (s.split(a).length !== 2) throw new Error('attachment-dirsync: nie znaleziono syncDirectory — plugin zmienił się upstream');
s = s.replace(a, '\tlet handle;\n\ttry { handle = await open(path, constants.O_RDONLY); } catch (error) {\n\t\t/* [android] dirsync: katalog systemowy nad danymi apki (EACCES/EPERM) — apka nic w nim nie zmienia, nie ma czego utrwalać */\n\t\tif (error && (error.code === "EACCES" || error.code === "EPERM")) return;\n\t\tthrow error;\n\t}\n\ttry {\n\t\tawait handle.sync();');
writeFileSync(file, s);
console.log('attachment-dirsync: fsync katalogów systemowych nad DSH_HOME pomijany przy EACCES/EPERM');
