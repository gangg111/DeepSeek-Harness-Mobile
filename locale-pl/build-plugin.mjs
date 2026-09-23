// Buduje pakiet pluginu klienckiego dsh z polskim pakietem językowym: pkg/dsh-locale-pl/{package.json,lib/index.js,lib/client.js}
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const pl = JSON.parse(readFileSync(new URL('./pl.json', import.meta.url), 'utf8'));
const out = new URL('./pkg/dsh-locale-pl/', import.meta.url).pathname;
mkdirSync(out + 'lib', { recursive: true });
const id = '@dsh-local/locale-pl';
writeFileSync(out + 'package.json', JSON.stringify({
  name: id, version: '1.0.0', description: 'Polski pakiet językowy DeepSeek Harness (web GUI)', type: 'module', main: 'lib/index.js',
  exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
  dsh: { client: { inject: ['@deepseek-ai/dsh-client-locale'], platform: 'web' } },
  license: 'MIT',
}, null, 2));
writeFileSync(out + 'lib/index.js', `/** Połówka hosta: pusta, plugin dostarcza tylko słowniki do przeglądarki. */\nexport function apply() {}\n`);
writeFileSync(out + 'lib/client.js', `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tconst DICTS = ${JSON.stringify(pl)};
\t\tconst inject = ["locale"];
\t\tfunction apply(ctx) {
\t\t\tctx.effect(() => ctx.locale.addLanguage({ id: "pl", label: "Polski", fallback: "en" }), "locale-pl: language");
\t\t\tfor (const [ns, dict] of Object.entries(DICTS)) ctx.effect(() => ctx.locale.register(ns, "pl", dict), "locale-pl: " + ns);
\t\t}
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`);
console.log('zbudowano', out, 'namespaces:', Object.keys(pl).length);
