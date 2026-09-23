// Aktualizator DeepSeek Harness działający w apce (bez Termuxa): npm z payloadu instaluje nową wersję dsh
// w kopii node_modules, nakłada łatki pod Androida z prekompilowanych plików, testuje start serwera
// i dopiero wtedy podmienia katalog. Wynik: ostatnia linia "RESULT: ok|uptodate|error ...".
// Użycie: node android-update.mjs --root <rt> --home <home> [--tag latest] [--force] [--check]
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(x => x.length));
const root = args.root; const home = args.home; const tag = typeof args.tag === 'string' ? args.tag : 'latest';
if (!root || !home) fail('brak --root/--home');
const node = process.execPath;
const npmCli = join(root, 'lib/node_modules/npm/bin/npm-cli.js');
const prebuilt = join(root, 'android-prebuilt');
const upd = join(root, 'upd');
const log = (s) => { process.stdout.write(s + '\n'); };
function fail(msg) { log('RESULT: error ' + msg); process.exit(1); }
const pkgVersion = (dir, name) => JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version;

const npmEnv = { ...process.env, npm_config_cache: join(home, '.npm'), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_loglevel: 'error', npm_config_progress: 'false' };
function npm(cwd, ...a) {
  const r = spawnSync(node, [npmCli, ...a], { cwd, env: npmEnv, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`npm ${a.join(' ')} -> kod ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(-800)}`);
  return r.stdout.trim();
}

try {
  const current = pkgVersion(root, '@deepseek-ai/dsh');
  log(`Sprawdzam npm (tag ${tag})…`);
  const want = npm(root, 'view', `@deepseek-ai/dsh@${tag}`, 'version').split('\n').pop().replace(/['" ]/g, '');
  if (!/^\d+\.\d+\.\d+/.test(want)) fail('npm view zwrócił: ' + want);
  log(`Zainstalowana ${current}, dostępna ${want}`);
  if (args.check) { log(`RESULT: ${current === want ? 'uptodate' : 'available'} ${want}`); process.exit(0); }
  if (current === want && !args.force) { log(`RESULT: uptodate ${want}`); process.exit(0); }

  log('Kopiuję node_modules do katalogu roboczego…');
  rmSync(upd, { recursive: true, force: true }); mkdirSync(upd, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) if (existsSync(join(root, f))) cpSync(join(root, f), join(upd, f));
  cpSync(join(root, 'node_modules'), join(upd, 'node_modules'), { recursive: true });

  log(`Instaluję @deepseek-ai/dsh@${want}…`);
  npm(upd, 'install', '--ignore-scripts', '--force', `@deepseek-ai/dsh@${want}`);
  log('sharp → WebAssembly…');
  npm(upd, 'install', '--ignore-scripts', '--force', '--cpu=wasm32', `@img/sharp-wasm32@${pkgVersion(upd, 'sharp')}`);
  log('koffi android-arm64…');
  npm(upd, 'install', '--ignore-scripts', '--force', `@koromix/koffi-android-arm64@${pkgVersion(upd, 'koffi')}`);

  log('node-pty z prekompilowanego pliku…');
  const ptyVer = pkgVersion(upd, 'node-pty');
  const preVer = readFileSync(join(prebuilt, 'node-pty.version'), 'utf8').trim();
  if (ptyVer !== preVer) fail(`node-pty ${ptyVer} wymaga przebudowy (prekompilowane ${preVer}); uruchom update.sh w Termuxie`);
  const rel = join(upd, 'node_modules/node-pty/build/Release'); mkdirSync(rel, { recursive: true });
  cpSync(join(prebuilt, 'pty.node'), join(rel, 'pty.node'));
  spawnSync(node, ['scripts/post-install.js'], { cwd: join(upd, 'node_modules/node-pty') });
  if (!existsSync(join(rel, 'pty.node'))) cpSync(join(prebuilt, 'pty.node'), join(rel, 'pty.node'));

  log('flock: addon android-arm64 + patch loadera…');
  const nas = join(upd, 'node_modules/@deepseek-ai/node-addon-system');
  const dst = join(upd, 'node_modules/@deepseek-ai/node-addon-system-android-arm64');
  mkdirSync(join(dst, 'bin'), { recursive: true });
  cpSync(join(prebuilt, 'system.node'), join(dst, 'bin/system.node'));
  writeFileSync(join(dst, 'package.json'), JSON.stringify({ name: '@deepseek-ai/node-addon-system-android-arm64', version: pkgVersion(upd, '@deepseek-ai/node-addon-system'), os: ['android'], cpu: ['arm64'], license: 'BSD-3-Clause' }, null, 2));
  const flockJs = join(nas, 'lib/flock.js');
  const src = readFileSync(flockJs, 'utf8');
  const patched = src.replace("if (platform !== 'linux' && platform !== 'darwin') {", "if (platform !== 'linux' && platform !== 'darwin' && platform !== 'android') {");
  if (!patched.includes("platform !== 'android'")) fail('nie znaleziono miejsca do załatania w flock.js (zmiana upstream) — uruchom update.sh w Termuxie');
  writeFileSync(flockJs, patched);

  log('łatki na pluginy…');
  for (const f of (existsSync(join(root, 'android-patches')) ? readdirSync(join(root, 'android-patches')) : []).filter(n => n.endsWith('.mjs'))) {
    const r = spawnSync(node, [join(root, 'android-patches', f), join(upd, 'node_modules')], { encoding: 'utf8' });
    log((r.stdout || '').trim()); if (r.status !== 0) fail(`łatka ${f}: ${(r.stderr || '').trim().slice(-300)}`);
  }
  log('postinstall pakietów…');
  spawnSync(node, ['scripts/postinstall'], { cwd: join(upd, 'node_modules/protobufjs') });
  spawnSync(node, ['scripts/ensure-spawn-helper.mjs'], { cwd: join(upd, 'node_modules/@deepseek-ai/dsh-subprocess-local') });

  log('Test startu serwera na nowej wersji…');
  const vhome = mkdtempSync(join(upd, 'verify-'));
  await new Promise((resolve, reject) => {
    const p = spawn(node, ['--expose-internals', '--require', join(root, 'android-shim.cjs'), join(upd, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--no-open', '--port', '0'],
      { cwd: vhome, env: { ...process.env, HOME: vhome, DSH_HOME: join(vhome, '.dsh'), TMPDIR: vhome } });
    let out = ''; const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('serwer nie wystartował w 180 s:\n' + out.slice(-1500))); }, 180_000);
    const onData = (d) => { out += d; if (/^dsh web: http/m.test(out)) { clearTimeout(timer); p.kill('SIGKILL'); resolve(); } };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('exit', (code) => { clearTimeout(timer); if (!/^dsh web: http/m.test(out)) reject(new Error(`serwer zakończył się kodem ${code}:\n` + out.slice(-1500))); });
  });
  rmSync(vhome, { recursive: true, force: true });

  log('Podmieniam node_modules…');
  const old = join(root, 'node_modules.old');
  rmSync(old, { recursive: true, force: true });
  renameSync(join(root, 'node_modules'), old);
  renameSync(join(upd, 'node_modules'), join(root, 'node_modules'));
  for (const f of ['package.json', 'package-lock.json']) if (existsSync(join(upd, f))) cpSync(join(upd, f), join(root, f));
  rmSync(upd, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  log(`RESULT: ok ${want}`);
} catch (e) {
  fail(String(e && e.message || e).replace(/\n/g, ' | ').slice(0, 900));
}
