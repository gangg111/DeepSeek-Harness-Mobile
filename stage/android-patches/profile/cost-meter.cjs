'use strict';
// Polski dla dsh-cost-meter (instalowany przez użytkownika z menedżera pluginów, więc żyje w profilu, nie w payloadzie).
// Plugin ma własne słowniki tylko zh/en i nie używa mechanizmu locale dsh. Tłumaczymy PO TEKŚCIE ANGIELSKIM
// (cost-meter.pl.json: angielski -> polski), tylko gdy interfejs dsh jest po polsku:
//  - lib/client.js: słownik en owinięty w Proxy, polski gdy <html lang="pl…">,
//  - lib/client.statistics.js: pary s("zh","en") przez ten sam tłumacz,
//  - lib/locale.js + lib/index.js: host „pl” traktowany jak „en”, komunikaty serwera tłumaczone z android-pl.json.
// Wszystko albo nic: gdy któryś wzorzec nie pasuje (autor zmienił kod), nic nie jest zapisywane i plugin zostaje po angielsku.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MARK = '/*[android] cost-meter pl*/';
const USD_MARK = '/*[android] cost-meter usd*/';

function write(file, text) {
  // Zapis przez plik tymczasowy + rename: nie zmienia pliku, który pnpm mógł dowiązać z magazynu pakietów.
  const tmp = `${file}.android-tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Domyślna waluta wyświetlania USD zamiast CNY (te same wartości, które ustawia wybór „Dolar amerykański (USD)” w ustawieniach
// pluginu). Dotyczy tylko świeżej instalacji: zapisana konfiguracja pluginu ma pierwszeństwo. Osobny znacznik, bo dochodzi do
// instalacji, na których łatka polska jest już nałożona (reguła „wszystko albo nic” dotyczy tylko plików tłumaczenia).
function patchDefaultCurrency(lib) {
  const file = path.join(lib, 'store.js');
  const s = fs.readFileSync(file, 'utf8');
  if (s.includes(USD_MARK)) return false;
  const re = /(\n\s*)currency: 'CNY',([^\n]*)\n(\s*)symbol: '¥',\n(\s*)decimals: 4,\n(\s*)exchangeRate: 7\.2,/;
  if (!re.test(s)) throw new Error('store.js: brak domyślnej waluty CNY');
  write(file, USD_MARK + '\n' + s.replace(re, "$1currency: 'USD',$2\n$3symbol: '$$',\n$4decimals: 6,\n$5exchangeRate: 1,"));
  return true;
}

module.exports = function patchCostMeter(dir) {
  const lib = path.join(dir, 'lib');
  const done = [];
  try { if (patchDefaultCurrency(lib)) done.push('domyślnie USD') } catch (e) { done.push(`domyślna waluta pominięta (${e.message})`) }
  const pl = patchTranslation(lib);
  if (pl) done.unshift(pl);
  return done.length ? done.join('; ') : null;
};

function patchTranslation(lib) {
  const files = { client: 'client.js', stats: 'client.statistics.js', index: 'index.js', locale: 'locale.js' };
  const src = {};
  for (const [k, f] of Object.entries(files)) src[k] = fs.readFileSync(path.join(lib, f), 'utf8');
  if (Object.values(src).every((s) => s.includes(MARK))) return null;   // już nałożona
  if (Object.values(src).some((s) => s.includes(MARK))) throw new Error('częściowo nałożona — przeinstaluj plugin');
  const pl = JSON.parse(fs.readFileSync(path.join(__dirname, 'cost-meter.pl.json'), 'utf8'));
  const out = {};

  // client.js: tłumacz globalny + słownik en w Proxy.
  {
    const s = src.client;
    const m = s.match(/([\w$]+)=Object\.fromEntries\(\[\["zh",/);
    if (!m) throw new Error('client.js: brak słowników zh/en');
    const end = s.indexOf('}));', m.index);
    if (end < 0) throw new Error('client.js: brak końca słowników');
    const at = end + 4, v = m[1];
    const helper = `${MARK}(function(){var P=${JSON.stringify(pl)};var on=function(){try{return /^pl(?:[-_]|$)/i.test(document.documentElement.lang||"")}catch(e){return false}};` +
      `globalThis.__dshCostPlT=function(t){if(typeof t!=="string"||!on())return t;var r=P[t];return r===undefined?t:r};` +
      `globalThis.__dshCostPlWrap=function(o){return new Proxy(o,{get:function(o,k){return globalThis.__dshCostPlT(o[k])}})}})();\n`;
    out.client = helper + s.slice(0, at) + `${v}.en=globalThis.__dshCostPlWrap(${v}.en);` + s.slice(at);
    new vm.Script(out.client, { filename: 'client.js' });   // tylko kompilacja: błąd składni = nie zapisujemy
  }
  // client.statistics.js: s=(zh,en)=>d?en:zh -> en przez tłumacz.
  {
    const re = /([\w$]+)=\(([\w$]+),([\w$]+)\)=>([\w$]+)\?\3:\2/;
    if (!re.test(src.stats)) throw new Error('client.statistics.js: brak funkcji wyboru zh/en');
    out.stats = MARK + src.stats.replace(re, '$1=($2,$3)=>$4?(globalThis.__dshCostPlT?globalThis.__dshCostPlT($3):$3):$2');
    new vm.Script(out.stats, { filename: 'client.statistics.js' });
  }
  // locale.js: host „pl” -> gałąź angielska + flaga dla komunikatów serwera.
  {
    const a = "return language === 'zh' || language === 'en' ? language : null";
    if (!src.locale.includes(a)) throw new Error('locale.js: brak supportedLocale');
    out.locale = MARK + '\n' + src.locale.replace(a,
      "if (language === 'pl') { globalThis.__dshCostHostPl = true; return 'en' }\n  if (language === 'zh' || language === 'en') globalThis.__dshCostHostPl = false\n  " + a);
  }
  // index.js: komunikaty serwera (SERVER_MESSAGES.en) tłumaczone, gdy host jest po polsku.
  {
    const a = 'let text = dict[code] ?? code';
    if (src.index.split(a).length !== 2 || !src.index.includes('SERVER_MESSAGES.en')) throw new Error('index.js: brak tmsg');
    out.index = `${MARK}\nimport __androidPlFs from 'node:fs'\n` +
      "const __androidCostPl = (() => { try { return JSON.parse(__androidPlFs.readFileSync(new URL('./android-pl.json', import.meta.url), 'utf8')) } catch { return {} } })()\n" +
      src.index.replace(a, `${a}\n  if (dict === SERVER_MESSAGES.en && globalThis.__dshCostHostPl) text = __androidCostPl[text] ?? text`);
  }

  write(path.join(lib, 'android-pl.json'), JSON.stringify(pl));
  for (const [k, f] of Object.entries(files)) write(path.join(lib, f), out[k]);
  return `nałożona (${Object.keys(pl).length} tekstów)`;
};
