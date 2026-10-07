'use strict';
// Łatki na pluginy, które użytkownik instaluje sam z menedżera pluginów (profil dsh: $DSH_HOME/profiles/*/node_modules),
// w odróżnieniu od android-patches/*.mjs, które poprawiają pluginy wbudowane w payload przy budowie/aktualizacji dsh.
// android-shim.cjs woła applyAll() przy każdym starcie serwera i watch(), które powtarza to po każdej zmianie profilu
// (instalacja/aktualizacja pluginu przez pnpm wymienia pliki pluginu na czyste). Łatki są idempotentne.
const fs = require('fs');
const path = require('path');

const PATCHES = { 'dsh-cost-meter': require('./cost-meter.cjs') };

const list = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } };

/**
 * Zainstalowane kopie łatanych pluginów. Profil dsh ma `nodeLinker: hoisted`, więc plugin leży w
 * profiles/<profil>/node_modules/<nazwa>; na wypadek innego linkera sprawdzamy też .pnpm/<nazwa>@<wersja>/node_modules/<nazwa>.
 */
function pluginDirs(dshHome) {
  const out = new Map();
  const profiles = path.join(dshHome, 'profiles');
  const add = (name, dir) => {
    if (!fs.existsSync(path.join(dir, 'package.json'))) return;
    let real = dir; try { real = fs.realpathSync(dir) } catch {}
    out.set(real, [name, real]);
  };
  for (const p of list(profiles)) {
    const nm = path.join(profiles, p, 'node_modules');
    for (const name of Object.keys(PATCHES)) {
      add(name, path.join(nm, name));
      for (const d of list(path.join(nm, '.pnpm'))) if (d.startsWith(`${name.replace('/', '+')}@`)) add(name, path.join(nm, '.pnpm', d, 'node_modules', name));
    }
  }
  return [...out.values()];
}

function applyAll(dshHome, log = (m) => console.error(m)) {
  for (const [name, dir] of pluginDirs(dshHome)) {
    try { const r = PATCHES[name](dir); if (r) log(`[android] ${name}: ${r}`) }
    catch (e) { log(`[android] ${name}: łatka pominięta, plugin zostaje bez zmian (${e.message})`) }
  }
}

/** Po każdej zmianie profilu (package.json / pnpm-lock.yaml) nakłada łatki ponownie, z opóźnieniem na koniec zapisu pnpm. */
function watch(dshHome, log = (m) => console.error(m)) {
  const profiles = path.join(dshHome, 'profiles');
  const watched = new Set();
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { addProfiles(); applyAll(dshHome, log) }, 700) };
  const add = (dir, filter) => {
    if (watched.has(dir)) return;
    try { fs.watch(dir, (_ev, file) => { if (!filter || filter(String(file))) schedule() }).unref(); watched.add(dir) } catch {}
  };
  const addProfiles = () => { for (const p of list(profiles)) add(path.join(profiles, p), (f) => f === 'package.json' || f === 'pnpm-lock.yaml') };
  fs.mkdirSync(profiles, { recursive: true });
  add(profiles);   // nowy profil
  addProfiles();
}

module.exports = { applyAll, watch, pluginDirs };
