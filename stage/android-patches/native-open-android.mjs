// Łatka: dsh-native-command zna tylko darwin/win32/linux; na Androidzie process.platform === 'android', więc
// nativeFileManager() = null → /api/present.host zwraca available:false, a karty plików pokazują „Ten host nie ma pulpitu”.
// Na Androidzie: host ma „pulpit”, menedżer plików 'directory', a otwieranie (także folderu przy reveal) idzie przez
// `xdg-open` z runtime apki (rt/bin/xdg-open → ServerService → ACTION_VIEW). Lista aplikacji zostaje pusta: wybór robi chooser.
// „Pokaż w folderze” dla pliku spoza /storage otwiera sam plik (prywatnego katalogu apki nie zobaczy żaden menedżer plików).
// Użycie: node native-open-android.mjs <katalog node_modules>   (idempotentna)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const nm = process.argv[2];
const file = join(nm, '@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-native-command/lib/index.js');
if (!existsSync(file)) { console.log('native-open-android: brak dsh-native-command — sprawdź, gdzie npm go umieścił'); process.exit(1); }
let src = readFileSync(file, 'utf8');
const edits = [
  ['\tif (platform !== "linux") return false;\n\tconst env = internals.env ?? process.env;\n\treturn isWsl(internals)',
   '\tif (platform === "android") return true; /* [android] native-open */\n\tif (platform !== "linux") return false;\n\tconst env = internals.env ?? process.env;\n\treturn isWsl(internals)'],
  ['\treturn platform === "linux" ? "directory" : null;',
   '\treturn platform === "linux" || platform === "android" ? "directory" : null; /* [android] native-open */'],
  ['\tif (platform === "darwin") {\n\t\tawait run("open", intent === "text-editor"',
   '\tif (platform === "android") { await run("xdg-open", [path], signal, "hidden"); return; } /* [android] native-open */\n\tif (platform === "darwin") {\n\t\tawait run("open", intent === "text-editor"'],
  // „Pokaż w folderze”: folder z prywatnego katalogu apki nie otworzy się w żadnym menedżerze plików, więc otwieramy sam plik.
  ['\tif (manager === "directory") {\n\t\tawait run("xdg-open", [dirname(path)], signal, "hidden");',
   '\tif (manager === "directory") {\n\t\tif (platform === "android" && !path.startsWith("/storage/") && !path.startsWith("/sdcard/")) { await run("xdg-open", [path], signal, "hidden"); return; } /* [android] native-open-reveal */\n\t\tawait run("xdg-open", [dirname(path)], signal, "hidden");'],
];
let n = 0;
for (const [from, to] of edits) {
  if (src.includes(to)) continue;
  n++;
  if (src.split(from).length !== 2) { console.log(`native-open-android: wzorzec nie pasuje dokładnie raz (upstream zmienił kod):\n${from}`); process.exit(1); }
  src = src.replace(from, to);
}
if (!n) { console.log('native-open-android: już nałożona'); process.exit(0); }
writeFileSync(file, src);
console.log(`native-open-android: nałożono ${n} z ${edits.length} (canOpenNativePath, nativeFileManager, otwieranie i „pokaż w folderze” przez xdg-open)`);
