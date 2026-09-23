// Wyciąga słowniki angielskie (ns -> {key: text}) z bundli klienckich dsh.
// Szuka locale.register(NS, {...}); literał to zwykle { zh, en } lub { zh: zh$1, en: en$1 } — odwołania do stałych
// zdefiniowanych wyżej jako `const en$1 = { ... }`. Wynik: en.json
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const base = process.argv[2]; const out = process.argv[3];
const result = {}; const problems = [];
const esc = (s) => s.replace(/[$]/g, '\\$');
function braceMatch(src, start) {
  let depth = 0, inStr = null, e = false, i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (e) e = false; else if (c === '\\') e = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced');
}
function evalRefs(src, literal) {
  const scope = new Proxy({}, { has: () => true, get: (_, name) => (typeof name === 'string' ? { __ref: name } : undefined) });
  return new Function('scope', 'with (scope) { return (' + literal + ') }')(scope);
}
function constValue(src, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${esc(name)}\\s*=\\s*`).exec(src);
  if (!m) throw new Error(`brak definicji ${name}`);
  const at = m.index + m[0].length;
  if (src[at] === '"') return JSON.parse(src.slice(at, src.indexOf('"', at + 1) + 1));
  if (src[at] === '{') return evalRefs(src, braceMatch(src, at));
  throw new Error(`definicja ${name} nie jest obiektem ani stringiem`);
}
for (const pkg of readdirSync(base)) {
  const file = join(base, pkg, 'lib/client.js');
  let src; try { src = readFileSync(file, 'utf8'); } catch { continue; }
  const re = /locale\.register\(([\w$]+|"[^"]+")\s*,\s*\{/g; let m;
  while ((m = re.exec(src))) {
    try {
      const ns = m[1].startsWith('"') ? m[1].slice(1, -1) : constValue(src, m[1]);
      const obj = evalRefs(src, braceMatch(src, m.index + m[0].length - 1));
      let en = obj.en;
      if (en && en.__ref) en = constValue(src, en.__ref);
      if (!en || typeof en !== 'object') { problems.push(`${pkg}/${ns}: brak en`); continue; }
      for (const [k, v] of Object.entries(en)) if (typeof v !== 'string') problems.push(`${pkg}/${ns}: klucz ${k} nie jest stringiem (${typeof v})`);
      result[ns] = Object.assign(result[ns] ?? {}, en);
    } catch (e) { problems.push(`${pkg}: ${String(e.message).slice(0, 100)}`); }
  }
  const m2 = /register\(([\w$]+),\s*locale,\s*dict\)/.exec(src);
  if (m2) {
    try {
      const ns = constValue(src, m2[1]);
      const d = /(?:const|let|var)\s+dictionaries\s*=\s*/.exec(src); const at = d.index + d[0].length;
      const lit = src.slice(at, at + 40);
      problems.push(`${pkg}: pętla dictionaries ns=${ns}, literał zaczyna się: ${JSON.stringify(lit)}`);
      if (src[at] === '[') { // [["zh", {...}], ["en", {...}]] lub [["zh", zh], ...]
        let depth = 0, i = at, inStr = null, e = false;
        for (; i < src.length; i++) { const c = src[i]; if (inStr) { if (e) e = false; else if (c === '\\') e = true; else if (c === inStr) inStr = null; continue; } if (c === '"' || c === "'" || c === '`') { inStr = c; continue; } if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') { depth--; if (depth === 0) break; } }
        const arr = evalRefs(src, src.slice(at, i + 1));
        for (const [loc, dict] of arr) if (loc === 'en') result[ns] = Object.assign(result[ns] ?? {}, dict.__ref ? constValue(src, dict.__ref) : dict);
      }
    } catch (e) { problems.push(`${pkg}: dictionaries: ${String(e.message).slice(0, 100)}`); }
  }
}
writeFileSync(out, JSON.stringify(result, null, 1));
const total = Object.values(result).reduce((n, d) => n + Object.keys(d).length, 0);
console.log('namespaces:', Object.keys(result).length, 'keys:', total);
console.log(Object.entries(result).map(([ns, d]) => `${ns}:${Object.keys(d).length}`).join(' '));
if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
