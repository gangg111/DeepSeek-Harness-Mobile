// Łatka: dsh-mcp-connect deklaruje wyniki narzędzi jako `output.schema: { type: 'json' }`. W dsh >= 0.2.0 tools.register()
// sprawdza ten schemat ścisłym walidatorem (assertSupportedJsonSchema), który nie zna typu `json` — plugin nie wstaje.
// Wszystkie narzędzia mcp-connect zwracają obiekty, więc `{ type: 'object', additionalProperties: true }` przechodzi
// zarówno walidator DSL, jak i ścisły. Parametry (`arguments: { type: 'json' }`) zostają — konwerter DSL je przyjmuje.
// Użycie: node mcp-schema-020.mjs <katalog node_modules>   (idempotentna)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const nm = process.argv[2];
const file = join(nm, 'dsh-mcp-connect/plugin.js');
if (!existsSync(file)) { console.log('mcp-schema-020: brak pluginu dsh-mcp-connect, pomijam'); process.exit(0); }
let src = readFileSync(file, 'utf8');
const from = "schema: { type: 'json' }";
const to = "schema: { type: 'object', additionalProperties: true } /* [android] dsh>=0.2.0: ścisły walidator nie zna type:'json' */";
if (!src.includes(from)) {
  console.log(src.includes('[android] dsh>=0.2.0') ? 'mcp-schema-020: już nałożona' : 'mcp-schema-020: brak `schema: { type: \'json\' }` — upstream już to zmienił, pomijam');
  process.exit(0);
}
const n = src.split(from).length - 1;
writeFileSync(file, src.split(from).join(to));
console.log(`mcp-schema-020: zamieniono ${n} schematów wyników type:'json' na object/additionalProperties`);
