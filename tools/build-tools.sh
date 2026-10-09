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
    # skrypt: shebang Termuxa nie istnieje w apce -> uruchamiamy przez nasz interpreter (perl/python3, reszta przez basha)
    local interp=bash; case "$(head -1 "$real")" in *perl*) interp=perl ;; *python*) interp=python3 ;; esac
    { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/'"$interp"'" "$(dirname "$0")/.scripts/'"$dst"'" "$@"'; } > "$ROOT/bin/$dst"
    mkdir -p "$ROOT/bin/.scripts"; cp "$real" "$ROOT/bin/.scripts/$dst"
    # perl wykonuje shebang bez słowa „perl” innym interpreterem, więc skrypty perla dostają env perl (z flagami)
    if [ $interp = perl ]; then sed -i '1s|^#!.*/perl|#!/system/bin/env perl|' "$ROOT/bin/.scripts/$dst"; else sed -i '1s|^#!.*|#!/system/bin/sh|' "$ROOT/bin/.scripts/$dst"; fi
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

log "narzędzia z raportu modelu (2026-10-08): qemu-user, ELF, sieć, gh, zstd, budowanie, SVG"
for n in qemu-x86_64 patchelf socat nmap ncat gh zstd unzstd zstdcat ninja pkg-config m4 rsvg-convert; do addbin "$n"; done
rm -rf "$ROOT/share/nmap"; cp -r "$P/share/nmap" "$ROOT/share/nmap"

log "etap 2 (raport modelu): terminal, ssh, DNS, archiwa, audio/obrazy, graphviz"
for n in less nano ssh ssh-keygen ssh-keyscan ssh-add ssh-agent rsync whois iperf3 cabextract sox lame pngquant dot; do addbin "$n"; done
cp -r "$P/share/terminfo" "$ROOT/share/terminfo"
# 7z z Termuxa ładuje kodeki z $PREFIX/libexec/7zip/7z.so (w apce brak) -> samodzielny 7zz (wszystkie formaty) jako 7z/7za/7zz
cp "$P/bin/7zz" "$ROOT/bin/7z"; closure "$P/bin/7zz"
for n in 7za 7zz; do echo "bin/$n -> 7z" >> "$ROOT/links.txt"; ln -sf 7z "$ROOT/bin/$n"; done
# shebangi #!/usr/bin/env i #!/bin/sh: termux-exec (LD_PRELOAD w tools.env) przepisuje je na $TERMUX__PREFIX/bin = rt/bin
cp "$P/lib/libtermux-exec-ld-preload.so" "$ROOT/lib/"
echo "bin/sh -> bash" >> "$ROOT/links.txt"; ln -sf bash "$ROOT/bin/sh"   # cel przepisanego /bin/sh
# fontconfig (dot, cairo): domyślny plik w $PREFIX/etc/fonts -> własny, z fontami Androida
mkdir -p "$ROOT/etc/fonts"
cat > "$ROOT/etc/fonts/fonts.conf" <<'FC'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/system/fonts</dir>
  <dir prefix="xdg">fonts</dir>
  <cachedir prefix="xdg">fontconfig</cachedir>
  <alias><family>sans-serif</family><prefer><family>Roboto</family></prefer></alias>
  <alias><family>serif</family><prefer><family>Noto Serif</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>Droid Sans Mono</family><family>Cutive Mono</family></prefer></alias>
  <alias><family>Times-Roman</family><prefer><family>Noto Serif</family></prefer></alias>
</fontconfig>
FC
# graphviz: wtyczki (formaty png/svg/pdf, układy) ładowane z GVBINDIR wg config8
cp -r "$P/lib/graphviz" "$ROOT/lib/graphviz"; for so in "$ROOT"/lib/graphviz/*.so; do closure "$so"; done
# scp/sftp mają wkompilowane $PREFIX/bin/ssh -> -S na naszego ssh
for n in scp sftp; do
  cp "$P/bin/$n" "$ROOT/bin/.$n"; closure "$P/bin/$n"
  { echo '#!/system/bin/sh'; echo 'D=$(dirname "$0")'; echo 'exec "$D/.'"$n"'" -S "$D/ssh" "$@"'; } > "$ROOT/bin/$n"
done
# tmux: gniazda w $PREFIX/tmp, powłoka $PREFIX/bin/sh -> TMPDIR apki i nasz bash
cp "$P/bin/tmux" "$ROOT/bin/.tmux"; closure "$P/bin/tmux"
cat > "$ROOT/bin/tmux" <<'EOF'
#!/system/bin/sh
D=$(cd "$(dirname "$0")" && pwd)
export TMUX_TMPDIR="${TMUX_TMPDIR:-${TMPDIR:-$HOME}}" SHELL="${SHELL:-$D/bash}" TERM="${TERM:-xterm-256color}"
exec "$D/.tmux" "$@"
EOF
# dig czyta $PREFIX/etc/resolv.conf (w apce go nie ma) -> bez @serwera pytamy 8.8.8.8 jak Termux
cp "$P/bin/dig" "$ROOT/bin/.dig"; closure "$P/bin/dig"
# w apce plik Termuxa istnieje, ale jest nieczytelny (EACCES) -> dig przerywa nawet z @serwerem; pusty /dev/null parsuje się poprawnie
python3 - "$ROOT/bin/.dig" "$P/etc/resolv.conf" <<'PY'
import sys
f, old = sys.argv[1], sys.argv[2].encode() + b"\0"
d = open(f, "rb").read(); assert old in d, "dig: brak ścieżki resolv.conf"
open(f, "wb").write(d.replace(old, b"/dev/null".ljust(len(old), b"\0")))
PY
cat > "$ROOT/bin/dig" <<'EOF'
#!/system/bin/sh
D=$(dirname "$0")
for a in "$@"; do case "$a" in @*) exec "$D/.dig" "$@" ;; esac; done
exec "$D/.dig" @8.8.8.8 "$@"
EOF

log "dsh-install: pakiety Termuxa do ~/.local (gpgv + klucze Termuxa weryfikują InRelease)"
addbin gpgv
rm -rf "$ROOT/share/termux-keyring"; mkdir -p "$ROOT/share/termux-keyring"; cp -L "$P"/share/termux-keyring/*.gpg "$ROOT/share/termux-keyring/"
mkdir -p "$ROOT/bin/.scripts"; cp "$HERE/dsh-install.py" "$ROOT/bin/.scripts/dsh-install"
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/python3" "$(dirname "$0")/.scripts/dsh-install" "$@"'; } > "$ROOT/bin/dsh-install"

log "sysroot glibc x86_64 z Debiana trixie (qemu-x86_64 uruchamia dynamiczne binarki; QEMU_LD_PREFIX w tools.env)"
SR=$ROOT/opt/x86_64-sysroot; rm -rf "$SR"; mkdir -p "$SR" "$DL/deb"
DEB=https://deb.debian.org/debian
curl -fsSL "$DEB/dists/trixie/main/binary-amd64/Packages.xz" | xz -d > "$DL/deb/Packages"
for p in libc6 libgcc-s1 libstdc++6 zlib1g; do
  f=$(awk -v p="$p" '$1=="Package:"{c=($2==p)} c&&$1=="Filename:"{print $2; exit}' "$DL/deb/Packages")
  [ -n "$f" ] || { echo "BRAK paczki $p w Debianie"; exit 1; }
  [ -s "$DL/deb/$(basename "$f")" ] || curl -fsSL -o "$DL/deb/$(basename "$f")" "$DEB/$f"
  dpkg-deb -x "$DL/deb/$(basename "$f")" "$SR"
done
rm -rf "$SR/usr/share"; ln -s usr/lib "$SR/lib"; ln -s usr/lib64 "$SR/lib64"
(cd "$ROOT" && find opt/x86_64-sysroot -type l | while read -r l; do echo "$l -> $(readlink "$l")"; done) >> "$ROOT/links.txt"

log "zig: nagłówki libc x86/x86_64 Linux (gnu + musl) z archiwum -> cc -target x86_64-linux-gnu|musl"
ZV=$(tar tJf "$DL/zig.tar.xz" | awk -F/ 'NR==1{print $1}')   # awk czyta do końca: head -1 dałby SIGPIPE przy pipefail
tar xJf "$DL/zig.tar.xz" -C "$ROOT/opt/zig" --strip-components=1 \
  "$ZV/lib/libc/include/x86-linux-any" "$ZV/lib/libc/include/x86-linux-gnu" "$ZV/lib/libc/include/x86-linux-musl" "$ZV/lib/libc/include/x86_64-linux-musl"

log "proot (wrapper: loader z rt/libexec, PROOT_TMP_DIR=\$TMPDIR, bo /tmp nie istnieje) + adb"
mkdir -p "$ROOT/opt/proot" "$ROOT/libexec/proot"
cp "$P/bin/proot" "$ROOT/opt/proot/proot"; closure "$P/bin/proot"
cp "$P/libexec/proot/loader" "$P/libexec/proot/loader32" "$ROOT/libexec/proot/"
cat > "$ROOT/bin/proot" <<'EOF'
#!/system/bin/sh
D=$(cd "$(dirname "$0")/.." && pwd)
export PROOT_LOADER="${PROOT_LOADER:-$D/libexec/proot/loader}" PROOT_LOADER_32="${PROOT_LOADER_32:-$D/libexec/proot/loader32}" PROOT_TMP_DIR="${PROOT_TMP_DIR:-$TMPDIR}"
exec "$D/opt/proot/proot" "$@"
EOF
chmod +x "$ROOT/bin/proot" "$ROOT/opt/proot/proot" "$ROOT"/libexec/proot/*
addbin adb

log "perl + autotools (ścieżki Termuxa w skryptach -> \$MOBILE_RT, /bin/sh -> /system/bin/sh, zamrożone .m4f od nowa)"
addbin perl
mkdir -p "$ROOT/lib/perl5"; rsync -a --exclude '*.pod' --exclude '/5.*/pod' "$P/lib/perl5/" "$ROOT/lib/perl5/"
find "$ROOT/lib/perl5" -name "*.so" | while read -r so; do closure "$so"; done
for d in autoconf automake-1.18 aclocal-1.18 aclocal libtool; do rm -rf "$ROOT/share/$d"; cp -r "$P/share/$d" "$ROOT/share/$d"; done
for n in autoconf autoheader autom4te autoreconf autoscan autoupdate ifnames automake automake-1.18 aclocal aclocal-1.18 libtoolize; do addbin "$n"; done
AT=("$ROOT"/share/{autoconf,automake-1.18,aclocal-1.18,aclocal,libtool} "$ROOT"/bin/.scripts/{autoconf,autoheader,autom4te,autoreconf,autoscan,autoupdate,ifnames,automake*,aclocal*,libtoolize})
grep -rlI "$P" "${AT[@]}" | xargs sed -i "s|$P/bin/sh|/system/bin/sh|g; s|$P/bin/env|/system/bin/env|g; s|$P/tmp|/data/local/tmp|g"
grep -rlI "'$P" "${AT[@]}" | grep -v autom4te.cfg | xargs sed -i "s|'$P|\$ENV{MOBILE_RT}.'|g"
sed -i "s|'$P/|'@MOBILE_RT@/|g" "$ROOT/share/autoconf/autom4te.cfg"
sed -i 's|      my @words = shellwords (\$_);|&\n      s/\\@MOBILE_RT\\@/$ENV{MOBILE_RT}/g for @words;|' "$ROOT/bin/.scripts/autom4te"
sed -i "s|$P|\$MOBILE_RT|g" "$ROOT/bin/.scripts/libtoolize"
left=$(grep -rnI "$P" "${AT[@]}" | grep -v '\.m4f:' || true); [ -z "$left" ] || { echo "autotools: zostały ścieżki Termuxa:"; echo "$left"; exit 1; }
for l in m4sugar/m4sugar m4sugar/m4sh autotest/autotest autoconf/autoconf; do
  rm -f "$ROOT/share/autoconf/$l.m4f"
  MOBILE_RT=$ROOT AC_MACRODIR=$ROOT/share/autoconf autom4te_perllibdir=$ROOT/share/autoconf M4=$P/bin/m4 perl "$ROOT/bin/.scripts/autom4te" \
    --language="$(basename "$l")" --freeze -o "$ROOT/share/autoconf/$l.m4f"
done
grep -l "$P" "$ROOT"/share/autoconf/*/*.m4f && { echo "m4f nadal z Termuxem"; exit 1; } || true

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
# Termuksowy cmake czyta $PREFIX/include/android/api-level.h przy wykrywaniu hosta; w apce PREFIX nie ma -> błąd konfiguracji.
sed -i 's|^        file(READ ${_ANDROID_API_LEVEL_H} _ANDROID_API_LEVEL_H_CONTENT)$|        if(EXISTS ${_ANDROID_API_LEVEL_H}) # [dsh-mobile] w apce nie ma $PREFIX z Termuxa\n          file(READ ${_ANDROID_API_LEVEL_H} _ANDROID_API_LEVEL_H_CONTENT)\n        endif()|' "$ROOT"/share/cmake-*/Modules/CMakeDetermineSystem.cmake
grep -q "dsh-mobile" "$ROOT"/share/cmake-*/Modules/CMakeDetermineSystem.cmake

log "numpy + libopenblas do site-packages"
mkdir -p "$ROOT/site-packages"
rsync -a --exclude '__pycache__' --exclude '/numpy/tests' --exclude '/numpy/*/tests' "$P/lib/python3.14/site-packages/numpy" "$P"/lib/python3.14/site-packages/numpy-*.dist-info "$ROOT/site-packages/"
for m in PIL pillow requests urllib3 idna charset_normalizer certifi mesonbuild meson; do
  rsync -a --exclude '__pycache__' "$P/lib/python3.14/site-packages/$m" "$P"/lib/python3.14/site-packages/"$m"-*.dist-info "$ROOT/site-packages/" 2>/dev/null || true
done
for m in PIL requests urllib3 idna charset_normalizer certifi mesonbuild; do [ -d "$ROOT/site-packages/$m" ] || { echo "BRAK pakietu python $m"; exit 1; }; done
addbin meson
find "$ROOT/site-packages" -name "*.so" | while read -r so; do closure "$so"; done

log ".NET SDK 10 (natywny bionic z Termuxa) + PowerShell 7 (NuGet, libpsl-native zbudowane pod bionic)"
# pkg install dotnet-sdk-10.0; dowiązania packs/ -> shared/ są względne -> links.txt
[ -x "$P/lib/dotnet/dotnet" ] || { echo "BRAK .NET: pkg install dotnet-sdk-10.0"; exit 1; }
rm -rf "$ROOT/opt/dotnet"; cp -a "$P/lib/dotnet" "$ROOT/opt/dotnet"
(cd "$ROOT" && find opt/dotnet -type l | while read -r l; do echo "$l -> $(readlink "$l")"; done) >> "$ROOT/links.txt"
for so in $(find "$ROOT/opt/dotnet" -name '*.so' -type f); do closure "$so"; done
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/../opt/dotnet/dotnet" "$@"'; } > "$ROOT/bin/dotnet"
# ICU: .NET dlopen-uje libicuuc.so/libicui18n.so BEZ wersji; bez nich linker bierze ICU Androida z /apex -> SIGABRT
for n in icuuc icui18n icudata; do
  son=$(readelf -d "$P/lib/lib$n.so" | sed -n 's/.*SONAME.*\[\(.*\)\]/\1/p')
  [ -e "$ROOT/lib/$son" ] || { cp "$(readlink -f "$P/lib/lib$n.so")" "$ROOT/lib/$son"; closure "$ROOT/lib/$son"; }
  echo "lib/lib$n.so -> $son" >> "$ROOT/links.txt"; ln -sf "$son" "$ROOT/lib/lib$n.so"
done
PSV=7.6.6; PSSHA=631fdf06304cabc4cdc036d23d6f31598db6b006a3037f5e171b255eae3aa163; PSN=f24d5494b373de20ec3e3d2fdc7c3fc98af1f9f1
[ -s "$DL/powershell.$PSV.nupkg" ] || curl -fsSL -o "$DL/powershell.$PSV.nupkg" "https://api.nuget.org/v3-flatcontainer/powershell/$PSV/powershell.$PSV.nupkg"
echo "$PSSHA  $DL/powershell.$PSV.nupkg" | sha256sum -c --quiet
rm -rf "$DL/pwsh-x" "$ROOT/opt/pwsh"; mkdir -p "$DL/pwsh-x"; unzip -q "$DL/powershell.$PSV.nupkg" "tools/*/any/unix/*" -d "$DL/pwsh-x"
mv "$DL"/pwsh-x/tools/*/any/unix "$ROOT/opt/pwsh"; rm -rf "$DL/pwsh-x"
rm -f "$ROOT"/opt/pwsh/runtimes/*/native/libpsl-native.so   # wersje glibc/musl; Android ładuje naszą z katalogu pwsh
if [ ! -d "$DL/PowerShell-Native/.git" ]; then git clone -q https://github.com/PowerShell/PowerShell-Native.git "$DL/PowerShell-Native"; fi
git -C "$DL/PowerShell-Native" fetch -q --depth 1 origin "$PSN" 2>/dev/null || true; git -C "$DL/PowerShell-Native" checkout -q "$PSN"
rm -rf "$DL/psl-build"; mkdir -p "$DL/psl-build"
(cd "$DL/psl-build" && cmake -DCMAKE_BUILD_TYPE=Release "$DL/PowerShell-Native/src/libpsl-native" >/dev/null && make -s -j8 >/dev/null)
cp "$DL/PowerShell-Native/src/powershell-unix/libpsl-native.so" "$ROOT/opt/pwsh/libpsl-native.so"; closure "$ROOT/opt/pwsh/libpsl-native.so"
{ echo '#!/system/bin/sh'; echo 'D=$(dirname "$0")'; echo 'exec "$D/../opt/dotnet/dotnet" "$D/../opt/pwsh/pwsh.dll" "$@"'; } > "$ROOT/bin/pwsh"

log "JDK 21 (bez src.zip/demo/man)"
rm -rf "$ROOT/opt/jdk"; rsync -a --exclude 'src.zip' --exclude '/demo' --exclude '/man' --exclude '/legal' "$P/lib/jvm/java-21-openjdk/" "$ROOT/opt/jdk/"
# JDK Termuxa ma wkompilowane tmpdir=$PREFIX/tmp i user.home=Termux home (jadx: ~/.config) -> TMPDIR i HOME apki
J='-Djava.io.tmpdir="${TMPDIR:-$HOME}" -Duser.home="$HOME"'
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/../opt/jdk/bin/java" '"$J"' "$@"'; } > "$ROOT/bin/java"
for n in javac jar javap jshell keytool jdeps jlink; do
  { echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/../opt/jdk/bin/'"$n"'" '"${J//-D/-J-D}"' "$@"'; } > "$ROOT/bin/$n"
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
# Wrapper (tools/zig-cc-wrapper.sh) obchodzi dwa błędy zig: --version i pliki zależności -MD.
for pair in cc:cc gcc:cc clang:cc c++:c++ g++:c++ clang++:c++; do sed "s/@MODE@/${pair#*:}/g" "$HERE/zig-cc-wrapper.sh" > "$ROOT/bin/${pair%%:*}"; done
# npm/npx z payloadu node
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/node" "$(dirname "$0")/../lib/node_modules/npm/bin/npm-cli.js" "$@"'; } > "$ROOT/bin/npm"
{ echo '#!/system/bin/sh'; echo 'exec "$(dirname "$0")/node" "$(dirname "$0")/../lib/node_modules/npm/bin/npx-cli.js" "$@"'; } > "$ROOT/bin/npx"
chmod +x "$ROOT"/bin/* "$ROOT"/bin/.scripts/* "$ROOT"/libexec/git-core/* "$ROOT"/opt/jdk/bin/* "$ROOT"/opt/jdk/lib/jspawnhelper "$ROOT"/opt/zig/zig 2>/dev/null || true

log "tools.env (zmienne obchodzące ścieżki Termuxa; \$RT = katalog runtime)"
# GIT_CONFIG_NOSYSTEM: git ma wkompilowane usr/etc/gitconfig Termuxa; gdy Termux jest zainstalowany, plik istnieje, ale apka nie ma
# do niego dostępu i git pada „unable to access …/gitconfig: Permission denied” (np. pnpm add github:…).
# Nazwy zmiennych NIE DSH_*: dsh (dsh-subprocess) wycina z powłoki agenta zmienne DSH_* i pasujące do /KEY|PASSWORD|SECRET|TOKEN/i.
cat > "$ROOT/tools.env" <<'EOF'
JAVA_HOME=$RT/opt/jdk
GIT_EXEC_PATH=$RT/libexec/git-core
GIT_TEMPLATE_DIR=$RT/share/git-core/templates
GIT_CONFIG_NOSYSTEM=1
GIT_SSL_CAINFO=$RT/etc/tls/cert.pem
CURL_CA_BUNDLE=$RT/etc/tls/cert.pem
MAGIC=$RT/share/misc/magic.mgc
CMAKE_ROOT=$RT/share/cmake-4.3
PYTHONPATH=$RT/site-packages
ZIG_GLOBAL_CACHE_DIR=$HOME/.cache/zig
KOTLIN_HOME=$RT/opt/kotlin
GIT_ATTR_NOSYSTEM=1
MOBILE_RT=$RT
PERL5LIB=$RT/lib/perl5/site_perl/5.42.0/aarch64-android:$RT/lib/perl5/site_perl/5.42.0:$RT/lib/perl5/5.42.0/aarch64-android:$RT/lib/perl5/5.42.0
NMAPDIR=$RT/share/nmap
QEMU_LD_PREFIX=$RT/opt/x86_64-sysroot
TERMINFO=$RT/share/terminfo
GVBINDIR=$RT/lib/graphviz
TERM=dumb
LD_PRELOAD=$RT/lib/libtermux-exec-ld-preload.so
TERMUX__PREFIX=$RT
QEMU_UNSET_ENV=LD_PRELOAD
FONTCONFIG_FILE=$RT/etc/fonts/fonts.conf
DOTNET_ROOT=$RT/opt/dotnet
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_NOLOGO=1
DOTNET_GENERATE_ASPNET_CERTIFICATE=false
DOTNET_SKIP_FIRST_TIME_EXPERIENCE=true
EOF
# wget: certyfikat przez wgetrc
mkdir -p "$ROOT/etc"; echo 'ca_certificate = $RT/etc/tls/cert.pem' > "$ROOT/etc/wgetrc.in"; echo 'WGETRC=$RT/etc/wgetrc' >> "$ROOT/tools.env"

log "powłoka wkompilowana w binarki: \$PREFIX/bin/sh (tar -z, make, git !alias/hooki, awk system(), perl system()…) -> /system/bin/sh"
chmod -R u+w "$ROOT"
python3 - "$ROOT" "$P/bin/sh" <<'PY'
import os, sys
root, old = sys.argv[1], sys.argv[2].encode() + b"\0"
new = b"/system/bin/sh".ljust(len(old), b"\0")
n = 0
for d in ("bin", "libexec", "lib"):
    for dp, _, fs in os.walk(os.path.join(root, d)):
        for f in fs:
            fp = os.path.join(dp, f)
            if os.path.islink(fp) or f.startswith("libtermux-exec"): continue
            with open(fp, "rb") as fh: data = fh.read()
            if data[:4] != b"\x7fELF" or old not in data: continue
            with open(fp, "wb") as fh: fh.write(data.replace(old, new))
            n += 1
print("łatka powłoki:", n, "plików")
PY
# pliki tylko do odczytu z Termuxa (np. moduły perla 0444) blokowałyby ponowne wklejenie root do stage
chmod -R u+w "$ROOT"
du -sh "$ROOT"/bin "$ROOT"/lib "$ROOT"/opt/* "$ROOT"/share "$ROOT"/site-packages 2>/dev/null
echo "links: $(wc -l < "$ROOT/links.txt")"
