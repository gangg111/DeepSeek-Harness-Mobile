#!/data/data/com.termux/files/usr/bin/bash
# Aktualizacja APK DeepSeek Harness: npm -> łatki pod Androida -> runtime z Termuxa -> payload -> build + podpis.
# Użycie: ~/dsh-android/update.sh [--tag latest|alpha|X.Y.Z] [--skip-npm] [--debug] [--force]
set -euo pipefail
P=/data/data/com.termux/files/usr
ROOT=$HOME/dsh-android; STAGE=$ROOT/stage; DSH=$HOME/dsh-test; APP=$ROOT/app
NODE_GYP=$P/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js
TAG=latest; SKIP_NPM=0; BUILD=Release; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG=$2; shift ;;
    --skip-npm) SKIP_NPM=1 ;;
    --debug) BUILD=Debug ;;
    --force) FORCE=1 ;;
    *) echo "nieznana opcja: $1"; exit 2 ;;
  esac; shift
done
log() { printf '\n== %s\n' "$*"; }
ver() { node -p "require('$DSH/node_modules/$1/package.json').version"; }

step_npm() {
  cd "$DSH"
  local cur want
  cur=$(ver @deepseek-ai/dsh)
  want=$(npm view "@deepseek-ai/dsh@$TAG" version | tail -1 | tr -d "' ")
  log "dsh: zainstalowana $cur, w npm ($TAG): $want"
  if [ "$cur" = "$want" ] && [ $FORCE = 0 ]; then echo "npm: bez zmian"; return; fi
  # --ignore-scripts: shim node-gyp od npm ma shebang /usr/bin/env, którego tu nie ma; natywne moduły budujemy sami niżej.
  npm install --ignore-scripts --force "@deepseek-ai/dsh@$want"
}

step_native() {
  cd "$DSH"
  # Kolejność ma znaczenie: każde `npm install` usuwa pakiety spoza lockfile, więc nasz addon flock wchodzi na końcu.
  log "sharp -> wariant WebAssembly (brak binarki android-arm64)"
  npm install --ignore-scripts --force --cpu=wasm32 "@img/sharp-wasm32@$(ver sharp)"
  log "koffi android-arm64 (--cpu=wasm32 wyżej wycina ten pakiet)"
  npm install --ignore-scripts --force "@koromix/koffi-android-arm64@$(ver koffi)"
  log "node-pty: build natywny (common.gypi wymaga android_ndk_path)"
  (cd node_modules/node-pty && node "$NODE_GYP" rebuild -- -Dandroid_ndk_path= >/dev/null && node scripts/post-install.js >/dev/null)
  test -f node_modules/node-pty/build/Release/pty.node
  log "flock: addon Node-API z flock.c + dopuszczenie platformy android"
  local nas=node_modules/@deepseek-ai/node-addon-system dst=node_modules/@deepseek-ai/node-addon-system-android-arm64
  mkdir -p "$dst/bin"
  clang -std=c11 -O2 -fPIC -fvisibility=hidden -DNAPI_VERSION=8 -I "$P/include/node" -shared -o "$dst/bin/system.node" "$nas/src/flock.c"
  printf '{ "name": "@deepseek-ai/node-addon-system-android-arm64", "version": "%s", "os": ["android"], "cpu": ["arm64"], "license": "BSD-3-Clause" }\n' "$(ver @deepseek-ai/node-addon-system)" > "$dst/package.json"
  sed -i "s/if (platform !== 'linux' \&\& platform !== 'darwin') {/if (platform !== 'linux' \&\& platform !== 'darwin' \&\& platform !== 'android') {/" "$nas/lib/flock.js"
  grep -q "platform !== 'android'" "$nas/lib/flock.js"
  log "łatki na pluginy (stage/android-patches/*.mjs)"
  for f in "$STAGE"/android-patches/*.mjs; do [ -e "$f" ] && node "$f" "$DSH/node_modules"; done
  log "postinstall pozostałych pakietów"
  (cd node_modules/protobufjs && node scripts/postinstall >/dev/null 2>&1) || true
  (cd node_modules/@deepseek-ai/dsh-subprocess-local && node scripts/ensure-spawn-helper.mjs >/dev/null 2>&1) || true
}

# Kopiuje binarkę + domknięcie jej NEEDED z prefiksu Termuxa do stage/lib.
closure() {
  readelf -d "$1" 2>/dev/null | { grep NEEDED || true; } | sed 's/.*\[\(.*\)\]/\1/' | while read -r l; do
    case "$l" in libc.so|libm.so|libdl.so|liblog.so) continue ;; esac
    [ -e "$STAGE/lib/$l" ] && continue
    [ -e "$P/lib/$l" ] || { echo "BRAK biblioteki $l (dla $1)"; exit 1; }
    cp "$(readlink -f "$P/lib/$l")" "$STAGE/lib/$l"; closure "$P/lib/$l"
  done
}

step_stage() {
  log "runtime z Termuxa: node $(node -v), bash, python"
  mkdir -p "$STAGE/bin" "$STAGE/etc/tls"
  rm -rf "$STAGE/lib"; mkdir -p "$STAGE/lib"
  cp "$P/bin/node" "$STAGE/bin/node"
  cp "$(readlink -f "$P/bin/bash")" "$STAGE/bin/bash"
  local pyv; pyv=$("$P/bin/python3" -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
  cp "$P/bin/python$pyv" "$STAGE/bin/python3"; cp "$P/bin/python$pyv" "$STAGE/bin/python"
  rsync -a --delete --exclude '__pycache__' --exclude '/test' --exclude '/idlelib' --exclude '/tkinter' --exclude '/turtledemo' --exclude '/site-packages' "$P/lib/python$pyv" "$STAGE/lib/"
  mkdir -p "$STAGE/lib/python$pyv/site-packages"
  rsync -a --exclude '__pycache__' "$P/lib/python$pyv/site-packages/pip" "$P"/lib/python$pyv/site-packages/pip-*.dist-info "$STAGE/lib/python$pyv/site-packages/"
  rm -f "$STAGE/lib/python$pyv/lib-dynload/_tkinter"*.so
  cp "$P/etc/tls/cert.pem" "$STAGE/etc/tls/cert.pem"
  closure "$STAGE/bin/node"; closure "$STAGE/bin/bash"; closure "$STAGE/bin/python3"
  for so in "$STAGE/lib/python$pyv"/lib-dynload/*.so; do closure "$so"; done
  test -f "$STAGE/android-shim.cjs" && test -f "$STAGE/android-update.mjs"
  log "komplet narzędzi (tools/root -> stage: zig, jdk, jadx, apktool, kotlin, git, ffmpeg, binutils…)"
  rm -rf "$STAGE/opt" "$STAGE/share" "$STAGE/libexec" "$STAGE/site-packages" "$STAGE/links.txt" "$STAGE/tools.env"
  "$ROOT/tools/merge-tools.sh" "$STAGE"
  ln -sfn "$DSH/node_modules" "$STAGE/node_modules"   # dla wrappera Termuxa (ścieżki pluginów w android.patch.yml); do zipa NIE wchodzi
  log "polski pakiet językowy (locale-pl/pl.json -> stage/dsh-locale-pl)"
  (cd "$ROOT/locale-pl" && node build-plugin.mjs >/dev/null)
  rm -rf "$STAGE/dsh-locale-pl"; cp -r "$ROOT/locale-pl/pkg/dsh-locale-pl" "$STAGE/dsh-locale-pl"; cp "$ROOT/locale-pl/android.patch.yml" "$STAGE/android.patch.yml"
  # Raport: klucze, które nowe dsh dodało, a pl.json ich nie ma (pokażą się po angielsku) — do ręcznego dotłumaczenia.
  (cd "$ROOT/locale-pl" && node extract-en.mjs "$DSH/node_modules/@deepseek-ai" en.json >/dev/null && node -e '
    const en=require("./en.json"), pl=require("./pl.json"); const miss=[];
    for (const [ns,d] of Object.entries(en)) for (const k of Object.keys(d)) if (k!=="__ref" && !(pl[ns]?.[k])) miss.push(ns+"."+k);
    console.log(miss.length ? "BRAK TŁUMACZEŃ (" + miss.length + "): " + miss.join(" ") : "tłumaczenie kompletne");')
  log "npm + prekompilowane addony dla aktualizatora w apce"
  rm -rf "$STAGE/lib/node_modules"; mkdir -p "$STAGE/lib/node_modules"
  cp -r "$P/lib/node_modules/npm" "$STAGE/lib/node_modules/npm"; rm -rf "$STAGE/lib/node_modules/npm/docs" "$STAGE/lib/node_modules/npm/man"
  mkdir -p "$STAGE/android-prebuilt"
  cp "$DSH/node_modules/node-pty/build/Release/pty.node" "$STAGE/android-prebuilt/pty.node"
  ver node-pty > "$STAGE/android-prebuilt/node-pty.version"
  cp "$DSH/node_modules/@deepseek-ai/node-addon-system-android-arm64/bin/system.node" "$STAGE/android-prebuilt/system.node"
  cp "$DSH/package.json" "$DSH/package-lock.json" "$STAGE/"
  du -sh "$STAGE"
}

step_verify() {
  log "test: staged node + dsh w czystym środowisku"
  local home="$STAGE/home-verify" logf
  rm -rf "$home"; mkdir -p "$home"; logf=$(mktemp)
  env -i LD_LIBRARY_PATH="$STAGE/lib" HOME="$home" DSH_HOME="$home/.dsh" TMPDIR="$home" PATH="$STAGE/bin:/system/bin" \
    OPENSSL_CONF=/dev/null SSL_CERT_FILE="$STAGE/etc/tls/cert.pem" DSH_PERMISSION_MODE=danger-full-access \
    "$STAGE/bin/node" --expose-internals --require "$STAGE/android-shim.cjs" \
    "$DSH/node_modules/@deepseek-ai/dsh/lib/bin.js" --profile web --patch "$STAGE/android.patch.yml" --no-open --port 0 >"$logf" 2>&1 &
  local pid=$! i
  for i in $(seq 1 60); do grep -q "^dsh web: http" "$logf" && break; kill -0 $pid 2>/dev/null || break; sleep 2; done
  kill $pid 2>/dev/null || true; rm -rf "$home"
  if grep -q "^dsh web: http" "$logf"; then echo "OK: $(grep '^dsh web:' "$logf" | sed 's/token=.*/token=…/')"; rm -f "$logf"
  else echo "BŁĄD: serwer nie wystartował"; tail -40 "$logf"; rm -f "$logf"; exit 1; fi
  "$STAGE/bin/python3" -c 'import ssl,sqlite3,ctypes,lzma; print("python OK", ssl.OPENSSL_VERSION)' 2>/dev/null \
    || { LD_LIBRARY_PATH="$STAGE/lib" "$STAGE/bin/python3" -c 'import ssl,sqlite3,ctypes,lzma; print("python OK")'; }
}

step_pack() {
  log "payload.zip"
  local zipf="$APP/app/src/main/assets/payload.zip"
  rm -f "$zipf"
  (cd "$STAGE" && zip -q -r "$zipf" . -x 'home-verify/*' -x 'home/*' -x 'node_modules' -x 'node_modules/*')
  (cd "$DSH" && zip -q -r "$zipf" node_modules -x 'node_modules/.bin/*')
  ls -la "$zipf"
  local app="$APP/app/src/main/java/com/dsh/mobile/App.kt" gradle="$APP/app/build.gradle.kts"
  local pv vc dshv
  pv=$(grep -o 'PAYLOAD_VERSION = "[0-9]*"' "$app" | grep -o '[0-9]*'); pv=$((pv + 1))
  vc=$(grep -o 'versionCode = [0-9]*' "$gradle" | grep -o '[0-9]*'); vc=$((vc + 1))
  dshv=$(ver @deepseek-ai/dsh)
  sed -i "s/PAYLOAD_VERSION = \"[0-9]*\"/PAYLOAD_VERSION = \"$pv\"/" "$app"
  sed -i "s/versionCode = [0-9]*/versionCode = $vc/; s/versionName = \"[^\"]*\"/versionName = \"$dshv+$pv\"/" "$gradle"
  log "build $BUILD (payload v$pv, versionCode $vc, dsh $dshv)"
  local glog; glog=$(mktemp)
  if ! (cd "$APP" && ./gradlew ":app:assemble$BUILD" -q >"$glog" 2>&1); then echo "BŁĄD Gradle:"; grep -vE '^w:|^$' "$glog" | tail -40; rm -f "$glog"; exit 1; fi
  rm -f "$glog"
  local out
  if [ "$BUILD" = Release ]; then out="$APP/app/build/outputs/apk/release/app-release.apk"; else out="$APP/app/build/outputs/apk/debug/app-debug.apk"; fi
  test -f "$out"
  apksigner verify --print-certs "$out" | grep -m1 "Signer #1 certificate DN"
  cp -f "$out" /sdcard/Download/dsh-mobile.apk
  log "GOTOWE: /sdcard/Download/dsh-mobile.apk ($(du -k "$out" | cut -f1) KB, md5 $(md5sum "$out" | cut -c1-8))"
}

[ $SKIP_NPM = 1 ] || step_npm
step_native
step_stage
step_verify
step_pack
