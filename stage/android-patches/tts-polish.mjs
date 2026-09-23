// Łatka na @dsh-external/dsh-plugin-tts: (1) polskie głosy Edge (Zofia/Marek) na początku listy i Zofia domyślna,
// (2) polski słownik interfejsu (tts-pl.json) + wybór języka „pl” (auto z przeglądarki i ręcznie).
// Użycie: node tts-polish.mjs <katalog node_modules>   (idempotentna; przy zmianie upstreamu kończy się błędem)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const nm = process.argv[2];
const dir = join(nm, '@dsh-external/dsh-plugin-tts/lib');
if (!existsSync(join(dir, 'client.js'))) { console.log('tts-polish: brak pluginu tts, pomijam'); process.exit(0); }
const DEF = 'zh-CN-XiaoxuanNeural', PL = 'pl-PL-ZofiaNeural';
const cpath = join(dir, 'client.js'), hpath = join(dir, 'index.mjs');
let client = readFileSync(cpath, 'utf8');
const rep = (from, to, label) => {
  if (!client.includes(from)) throw new Error('tts-polish: nie znaleziono (' + label + ') — plugin zmienił się upstream');
  client = client.replace(from, to);
};

// ---- 1) głosy ------------------------------------------------------------------------------------------
if (client.includes('[android] polish voices')) {
  console.log('tts-polish: głosy już nałożone');
} else {
  const listHead = '      const VOICES = [\n        ["zh-CN-XiaoxuanNeural", t("voice.xiaoxuan")],';
  if (!client.includes(listHead)) throw new Error('tts-polish: nie znaleziono listy VOICES — plugin zmienił się upstream');
  client = client.split('"' + DEF + '"').join('"' + PL + '"');   // domyślny głos: tylko literały w cudzysłowach; etykiety „(zh-CN-…)” zostają
  rep('      const VOICES = [\n        ["pl-PL-ZofiaNeural", t("voice.xiaoxuan")],',
    '      // [android] polish voices\n      const VOICES = [\n        ["pl-PL-ZofiaNeural", "Zofia (pl-PL, kobieta)"],\n        ["pl-PL-MarekNeural", "Marek (pl-PL, mężczyzna)"],\n        ["zh-CN-XiaoxuanNeural", t("voice.xiaoxuan")],', 'VOICES');
  let host = readFileSync(hpath, 'utf8');
  host = host.split("'" + DEF + "'").join("'" + PL + "'");
  writeFileSync(hpath, host);
  console.log('tts-polish: głosy nałożone (domyślnie ' + PL + ')');
}

// ---- 2) słownik pl + wybór języka ------------------------------------------------------------------------
if (client.includes('[android] polish i18n')) {
  console.log('tts-polish: słownik pl już nałożony');
} else {
  const pl = JSON.parse(readFileSync(new URL('./tts-pl.json', import.meta.url), 'utf8'));
  rep('        dict: {\n          zh: {', '        dict: {\n          pl: ' + JSON.stringify(pl) + ', // [android] polish i18n\n          zh: {', 'dict');
  rep('if (pref === "zh" || pref === "en") return pref;', 'if (pref === "zh" || pref === "en" || pref === "pl") return pref;', 'resolveLocale');
  rep('if (/^zh/i.test(code)) return "zh";', 'if (/^pl/i.test(code)) return "pl";\n        if (/^zh/i.test(code)) return "zh";', 'navigator pl');
  rep('if (v === "zh" || v === "en" || v === "auto") return v;', 'if (v === "zh" || v === "en" || v === "pl" || v === "auto") return v;', 'persisted');
  rep('const next = v === "zh" || v === "en" ? v : "auto";', 'const next = v === "zh" || v === "en" || v === "pl" ? v : "auto";', 'setLang');
  rep('react.createElement("option", { value: "en" }, t("lang.en")),', 'react.createElement("option", { value: "en" }, t("lang.en")),\n              react.createElement("option", { value: "pl" }, "Polski"),', 'option');
  console.log('tts-polish: słownik pl nałożony (' + Object.keys(pl).length + ' kluczy)');
}
writeFileSync(cpath, client);
