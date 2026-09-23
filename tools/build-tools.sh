#!/data/data/com.termux/files/usr/bin/bash
# Składa komplet narzędzi dla modelu z pakietów Termuxa + pobranych archiwów do ~/dsh-android/tools/root:
#   bin/ (binarki + wrappery), lib/ (domknięcie NEEDED), opt/ (zig, jdk, jadx, apktool, dex2jar, kotlin),
#   share/ (magic, cmake, git templates), libexec/git-core, links.txt (dowiązania odtwarzane w apce), tools.env.
# Ścieżki Termuxa wkompilowane w binarki obchodzone są zmiennymi z tools.env ($RT = katalog runtime).
set -euo pipefail
P=/data/data/com.termux/files/usr
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$HERE/root; DL=$HERE/dl
log() { printf '\n== %s\n' "$*"; }

rm -rf "$ROOT/bin" "$ROOT/lib" "$ROOT/share" "$ROOT/libexec" "$ROOT/links.txt" "$ROOT/tools.env" "$ROOT/site-packages"
mkdir -p "$ROOT/bin" "$ROOT/lib" "$ROOT/share" "$ROOT/libexec" "$ROOT/opt"
: > "$ROOT/links.txt"

# --- biblioteki: domknięcie NEEDED (bez bibliotek systemowych bionic)
closure() {
  { readelf -d "$1" 2>/dev/null || true; } | { grep NEEDED || true; } | sed 's/.*\[\(.*\)\]/\1/' | while read -r l; do
    case "$l" in libc.so|libm.so|libdl.so|liblog.so|libz.so|libandroid.so|libmediandk.so|libGLESv2.so|libEGL.so|libvulkan.so) continue ;; esac
    [ -e "$ROOT/lib/$l" ] && continue
    [ -e "$P/lib/$l" ] || { echo "BRAK biblioteki $l (dla $1)"; exit 1; }
    cp "$(readlink -f "$P/lib/$l")" "$ROOT/lib/$l"; closure "$P/lib/$l"
  done
}

# --- binarka z Termuxa: kopia celu dowiązania; dowiązania trafiają do links.txt
addbin() { # addbin <nazwa> [<nazwa w root/bin>]
  local name=$1 dst=${2:-$1} src="$P/bin/$1" real
  [ -e "$src" ] || { echo "pomijam: brak $1"; return; }
  real=$(readlink -f "$src")
  if [ "$(head -c2 "$real")" = "#!" ]; then
    # skrypt: shebang Termuxa nie istnieje w apce -> uruchamiamy przez naszego basha
    { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/bash" "$(dirname "$0")/.scripts/'"$dst"'" "$@"'; } > "$ROOT/bin/$dst"
    mkdir -p "$ROOT/bin/.scripts"; cp "$real" "$ROOT/bin/.scripts/$dst"
    sed -i '1s|^#!.*|#!/system/bin/sh|' "$ROOT/bin/.scripts/$dst"
  else
    local base; base=$(basename "$real")
    if [ "$base" != "$dst" ] && [ -e "$P/bin/$base" ]; then
      # dowiązanie do wspólnej binarki (np. coreutils, git-core): jeden plik + link
      [ -e "$ROOT/bin/$base" ] || { cp "$real" "$ROOT/bin/$base"; closure "$real"; }
      echo "bin/$dst -> $base" >> "$ROOT/links.txt"; ln -sf "$base" "$ROOT/bin/$dst"
    else
      cp "$real" "$ROOT/bin/$dst"; closure "$real"
    fi
  fi
}

log "coreutils (multi-call) + narzędzia GNU/toybox-zastępcze"
addbin coreutils
for n in $(ls -la "$P/bin" | awk '$NF=="coreutils"{print $(NF-2)}'); do echo "bin/$n -> coreutils" >> "$ROOT/links.txt"; ln -sf coreutils "$ROOT/bin/$n"; done
for n in sed gawk grep egrep fgrep find xargs diff cmp diff3 sdiff patch tar gzip gunzip zcat xz unxz xzcat bzip2 bunzip2 bzcat which tree file zip unzip rg fd jq make cmake ctest cpack curl wget git openssl sqlite3 ffmpeg ffprobe; do addbin "$n"; done
echo "bin/awk -> gawk" >> "$ROOT/links.txt"; ln -sf gawk "$ROOT/bin/awk"
# binutils GNU (w Termuxie pod nazwami g*, bo objdump/nm/... to dowiązania do LLVM ciągnące libLLVM 128 MB)
for pair in gobjdump:objdump gnm:nm greadelf:readelf gstrings:strings gar:ar gobjcopy:objcopy gstrip:strip gsize:size gaddr2line:addr2line gc++filt:c++filt granlib:ranlib as:as ld.bfd:ld elfedit:elfedit; do addbin "${pair%%:*}" "${pair##*:}"; done
for n in aapt aapt2; do addbin "$n"; done
[ -e "$P/bin/aapt2.real" ] && cp "$P/bin/aapt2.real" "$ROOT/bin/aapt2" && closure "$ROOT/bin/aapt2"   # wrapper z Termuxa -> prawdziwa binarka

log "git: helpery zewnętrzne z libexec/git-core (wbudowane komendy są w binarce git), szablony"
mkdir -p "$ROOT/libexec/git-core" "$ROOT/share/git-core"
find "$P/libexec/git-core" -maxdepth 1 -type f | while read -r f; do
  b=$(basename "$f"); cp "$f" "$ROOT/libexec/git-core/$b"
  if [ "$(head -c2 "$f")" = "#!" ]; then sed -i '1s|^#!.*|#!/system/bin/sh|' "$ROOT/libexec/git-core/$b"; else closure "$f"; fi
done
# dowiązania w git-core (git-remote-https -> git-remote-http itd.) — tylko te, których cel skopiowaliśmy
find "$P/libexec/git-core" -maxdepth 1 -type l | while read -r l; do
  b=$(basename "$l"); tgt=$(basename "$(readlink "$l")")
  [ -e "$ROOT/libexec/git-core/$tgt" ] || continue
  echo "libexec/git-core/$b -> $tgt" >> "$ROOT/links.txt"; ln -sf "$tgt" "$ROOT/libexec/git-core/$b"
done
cp -r "$P/share/git-core/templates" "$ROOT/share/git-core/templates"

log "share: magic.mgc, cmake"
mkdir -p "$ROOT/share/misc"; cp "$P/share/misc/magic.mgc" "$ROOT/share/misc/magic.mgc"
cp -r "$P"/share/cmake-* "$ROOT/share/"

log "numpy + libopenblas do site-packages"
mkdir -p "$ROOT/site-packages"
rsync -a --exclude '__pycache__' --exclude '/numpy/tests' --exclude '/numpy/*/tests' "$P/lib/python3.14/site-packages/numpy" "$P"/lib/python3.14/site-packages/numpy-*.dist-info "$ROOT/site-packages/"
find "$ROOT/site-packages" -name "*.so" | while read -r so; do closure "$so"; done

log "JDK 21 (bez src.zip/demo/man)"
rm -rf "$ROOT/opt/jdk"; rsync -a --exclude 'src.zip' --exclude '/demo' --exclude '/man' --exclude '/legal' "$P/lib/jvm/java-21-openjdk/" "$ROOT/opt/jdk/"
for n in java javac jar javap jshell keytool jdeps jlink; do
  { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/../opt/jdk/bin/'"$n"'" "$@"'; } > "$ROOT/bin/$n"
done

log "kotlin + dex2jar (skrypty przez naszego basha)"
rm -rf "$ROOT/opt/kotlin" "$ROOT/opt/dex2jar"; cp -r "$P/opt/kotlin" "$ROOT/opt/kotlin"; cp -r "$P/opt/dex2jar" "$ROOT/opt/dex2jar"
for n in kotlinc kotlin kotlinc-jvm kotlinc-js kapt; do
  [ -e "$ROOT/opt/kotlin/bin/$n" ] || continue
  { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/bash" "$(dirname "$0")/../opt/kotlin/bin/'"$n"'" "$@"'; } > "$ROOT/bin/$n"
done
for f in "$ROOT"/opt/dex2jar/*.sh; do n=$(basename "$f" .sh); { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/bash" "$(dirname "$0")/../opt/dex2jar/'"$n"'.sh" "$@"'; } > "$ROOT/bin/$n"; done

log "jadx, apktool, zig (wrappery)"
{ echo '#!/system/bin/sh'; echo 'D="$(dirname "$0")/../opt/jadx/lib"'; echo 'exec "$(dirname "$0")/java" -Xmx1g -cp "$D/*" jadx.cli.JadxCLI "$@"'; } > "$ROOT/bin/jadx"
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/java" -jar "$(dirname "$0")/../opt/apktool/apktool.jar" "$@"'; } > "$ROOT/bin/apktool"
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/../opt/zig/zig" "$@"'; } > "$ROOT/bin/zig"
# cc/gcc/c++/g++/clang: zig cc z domyślnym celem aarch64-linux-musl (statyczne binarki działają na Androidzie)
for n in cc gcc clang; do { echo '#!/system/bin/sh'; echo 'case " $* " in *" -target "*|*"--target="*) ;; *) set -- -target aarch64-linux-musl "$@";; esac'; echo 'exec "$(dirname "$0")/../opt/zig/zig" cc "$@"'; } > "$ROOT/bin/$n"; done
for n in c++ g++ clang++; do { echo '#!/system/bin/sh'; echo 'case " $* " in *" -target "*|*"--target="*) ;; *) set -- -target aarch64-linux-musl "$@";; esac'; echo 'exec "$(dirname "$0")/../opt/zig/zig" c++ "$@"'; } > "$ROOT/bin/$n"; done
# npm/npx z payloadu node
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/node" "$(dirname "$0")/../lib/node_modules/npm/bin/npm-cli.js" "$@"'; } > "$ROOT/bin/npm"
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/node" "$(dirname "$0")/../lib/node_modules/npm/bin/npx-cli.js" "$@"'; } > "$ROOT/bin/npx"
chmod +x "$ROOT"/bin/* "$ROOT"/bin/.scripts/* "$ROOT"/libexec/git-core/* "$ROOT"/opt/jdk/bin/* "$ROOT"/opt/jdk/lib/jspawnhelper "$ROOT"/opt/zig/zig 2>/dev/null || true

log "tools.env (zmienne obchodzące ścieżki Termuxa; \$RT = katalog runtime)"
cat > "$ROOT/tools.env" <<'EOF'
JAVA_HOME=$RT/opt/jdk
GIT_EXEC_PATH=$RT/libexec/git-core
GIT_TEMPLATE_DIR=$RT/share/git-core/templates
GIT_SSL_CAINFO=$RT/etc/tls/cert.pem
CURL_CA_BUNDLE=$RT/etc/tls/cert.pem
MAGIC=$RT/share/misc/magic.mgc
CMAKE_ROOT=$RT/share/cmake-4.3
PYTHONPATH=$RT/site-packages
ZIG_GLOBAL_CACHE_DIR=$HOME/.cache/zig
KOTLIN_HOME=$RT/opt/kotlin
EOF
# wget: certyfikat przez wgetrc
mkdir -p "$ROOT/etc"; echo 'ca_certificate = $RT/etc/tls/cert.pem' > "$ROOT/etc/wgetrc.in"; echo 'WGETRC=$RT/etc/wgetrc' >> "$ROOT/tools.env"

du -sh "$ROOT"/bin "$ROOT"/lib "$ROOT"/opt/* "$ROOT"/share "$ROOT"/site-packages 2>/dev/null
echo "links: $(wc -l < "$ROOT/links.txt")"
