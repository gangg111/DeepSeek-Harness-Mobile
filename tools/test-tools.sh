#!/data/data/com.termux/files/usr/bin/bash
# Testuje komplet narzędzi w czystym środowisku (env -i), bez prefiksu Termuxa: $1 = katalog runtime (rt)
# zawierający bin/lib/etc ze stage (bash, python, node, cert.pem) + tools/root. Wypisuje OK/FAIL per narzędzie.
set -u
RT=$(cd "$1" && pwd); T=$(mktemp -d "$RT/../tt.XXXX"); H=$T/home; mkdir -p "$H"
ENVV=(HOME="$H" TMPDIR="$T" PATH="$RT/bin" LD_LIBRARY_PATH="$RT/lib" LANG=en_US.UTF-8 OPENSSL_CONF=/dev/null SSL_CERT_FILE="$RT/etc/tls/cert.pem" REQUESTS_CA_BUNDLE="$RT/etc/tls/cert.pem")
# jak w apce: zmienne systemu Android przechodzą do procesów agenta (App.serverEnv)
while IFS= read -r line; do ENVV+=("$line"); done < <(env | grep -E '^(ANDROID_[A-Z_]*|BOOTCLASSPATH|DEX2OATBOOTCLASSPATH|SYSTEMSERVERCLASSPATH|EXTERNAL_STORAGE)=')
while IFS= read -r line; do [ -n "$line" ] && ENVV+=("$(echo "$line" | sed "s|\$RT|$RT|g; s|\$HOME|$H|g")"); done < "$RT/tools.env"
[ -f "$RT/etc/wgetrc.in" ] && sed "s|\$RT|$RT|g" "$RT/etc/wgetrc.in" > "$RT/etc/wgetrc"
pass=0; fail=0
t() { # t <nazwa> <komenda bash...>  — sukces = kod 0
  local name=$1; shift
  local out; out=$(cd "$T" && env -i "${ENVV[@]}" "$RT/bin/bash" --norc -c "$*" 2>&1); local rc=$?
  if [ $rc = 0 ]; then pass=$((pass+1)); printf 'OK    %-14s %s\n' "$name" "$(echo "$out" | tail -1 | cut -c1-90)"
  else fail=$((fail+1)); printf 'FAIL  %-14s rc=%s %s\n' "$name" "$rc" "$(echo "$out" | tail -3 | tr '\n' '|' | cut -c1-200)"; fi
}
t bash        'echo "bash $BASH_VERSION"'
t coreutils   'ls "$HOME" >/dev/null && echo x | cat && sort --version | head -1'
t sed-awk     'echo abc | sed s/b/X/ | awk "{print toupper(\$0)}"'
t grep        'echo hello | grep -o ell'
t find-xargs  'find "$HOME" -maxdepth 0 | xargs echo'
t diff-patch  'printf "a\n" > a; printf "b\n" > b; diff -u a b > p.diff; patch --version | head -1'
t tar-gzip    'tar czf t.tgz a b && tar tzf t.tgz | wc -l'
t xz-bzip2    'echo x | xz | unxz && echo y | bzip2 | bunzip2'
t zip-unzip   'zip -q z.zip a b && unzip -l z.zip | tail -1'
t which       'which bash'
t tree        'tree -L 1 "$HOME" | tail -1'
t file        'file a'
t rg          'echo needle | rg -o eedl'
t fd          'fd -t f a . | head -1'
t jq          'echo "{\"a\":[1,2]}" | jq -c .a'
t make        'printf "all:\n\t@echo make-ok\n" > Makefile && make'
t cmake       'cmake --version | head -1'
t curl-https  'curl -sS -o /dev/null -w "%{http_code}" https://api.deepseek.com/'
t wget-https  'wget -q -O /dev/null https://ziglang.org/download/index.json && echo wget-ok'
t git         'git init -q r && cd r && git config user.email a@b && git config user.name a && echo x > f && git add f && git commit -qm init && git log --oneline | wc -l'
t git-clone   'git clone -q --depth 1 https://github.com/octocat/Hello-World.git hw && ls hw | head -1'
t zig-c       'printf "#include <stdio.h>\nint main(){puts(\"c-ok\");}\n" > h.c && cc -O2 -o h h.c && ./h'
t zig-cpp     'printf "#include <iostream>\nint main(){std::cout<<\"cpp-ok\"<<std::endl;}\n" > h.cpp && c++ -O2 -o hpp h.cpp && ./hpp'
t python      'python3 -c "import ssl,sqlite3,json; print(\"py-ok\")"'
t numpy       'python3 -c "import numpy as np; print(\"numpy\", np.__version__, np.dot([1,2],[3,4]))"'
t pip         'python3 -m pip --version | cut -c1-30'
t node-npm    'node -v && npm -v'
t java        'java -version 2>&1 | head -1'
t javac       'printf "public class H{public static void main(String[] a){System.out.println(\"java-ok\");}}\n" > H.java && javac H.java && java H'
t kotlinc     'printf "fun main(){println(\"kt-ok\")}\n" > k.kt && kotlinc k.kt -include-runtime -d k.jar 2>/dev/null && java -jar k.jar'
t jadx        'jadx --version'
t apktool     'apktool --version'
t dex2jar     'd2j-dex2jar --help 2>&1 | head -1'
t binutils    'objdump --version | head -1 && nm --version | head -1'
t aapt2       'aapt2 version 2>&1 | head -1'
t sqlite3     'sqlite3 :memory: "select 42"'
t openssl     'openssl version'
t ffmpeg      'ffmpeg -version | head -1'
t qemu-x86_64  'printf "static const char m[]=\"x86-ok\\\\n\";\nvoid _start(void){long r;__asm__ volatile(\"syscall\":\"=a\"(r):\"a\"(1),\"D\"(1),\"S\"(m),\"d\"(7):\"rcx\",\"r11\",\"memory\");__asm__ volatile(\"syscall\"::\"a\"(60),\"D\"(0));}\n" > x.c && cc -target x86_64-linux-musl -nostdlib -ffreestanding -static -o x86 x.c && file x86 | cut -d, -f1-2 && qemu-x86_64 ./x86'
t x86-glibc   'qemu-x86_64 "$QEMU_LD_PREFIX/usr/lib/x86_64-linux-gnu/libc.so.6" | head -1 | cut -c1-60 && qemu-x86_64 "$QEMU_LD_PREFIX/lib64/ld-linux-x86-64.so.2" --list "$QEMU_LD_PREFIX/usr/lib/x86_64-linux-gnu/libstdc++.so.6" | grep -c "=> /lib/x86_64-linux-gnu/"'
t cc-x86-gnu  'printf "#include <stdio.h>\n#include <math.h>\nint main(){printf(\"gnu-ok %%.0f\\\\n\", sqrt(81.0));}\n" > xg.c && cc -target x86_64-linux-gnu -o xg xg.c -lm && file xg | cut -d, -f1-2,4 && qemu-x86_64 ./xg'
t cc-x86-musl 'printf "#include <stdio.h>\nint main(){puts(\"musl-ok\");}\n" > xm.c && cc -target x86_64-linux-musl -static -o xm xm.c && qemu-x86_64 ./xm'
t c++-x86-gnu 'printf "#include <iostream>\nint main(){std::cout<<\"cpp-x86-ok\"<<std::endl;}\n" > xp.cpp && c++ -target x86_64-linux-gnu -o xp xp.cpp && qemu-x86_64 ./xp'
t proot       'proot -0 id -u && proot -b "$RT/bin/bash:/bin/sh" -w / /bin/sh -c "echo proot-bind-ok"'
# rootfs x86_64 pod proot -q (zamiennik Dockera); pusty /host-rootfs/lib tylko dla testu z Termuxa pod proot Claude Code (glibcowe /lib), w apce bez znaczenia
t proot-qemu  'mkdir -p e && proot -q qemu-x86_64 -r "$QEMU_LD_PREFIX" -b /proc -b /dev -b "$PWD/e:/host-rootfs/lib" -b "$PWD/xg:/xg" /xg 2>&1 | grep -x "gnu-ok 9"'
t adb         'v=$(adb version) && echo "$v" | sed -n 2p'
t patchelf   'cp x86 x2 && patchelf --set-soname foo x2 2>/dev/null; patchelf --version'
t socat       'socat -V | grep "socat version" && echo hi | socat - EXEC:cat'
t nmap        'nmap -sT -p 1 -Pn 127.0.0.1 2>&1 | grep -E "^1/tcp"'
t gh          'gh --version | head -1'
t zstd        'echo z | zstd -q | unzstd -q'
t pkg-config  'pkg-config --version'
t ninja       'ninja --version'
t meson       'meson --version'
t rsvg        'echo "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\" fill=\"red\"/></svg>" > i.svg && rsvg-convert -o i.png i.svg && file i.png | cut -d, -f1-2'
t pil-requests 'python3 -c "import PIL.Image,requests; PIL.Image.open(\"i.png\").load(); print(\"PIL\", PIL.__version__, requests.get(\"https://api.deepseek.com/\").status_code)"'
t perl        'perl -MPOSIX -MDigest::SHA=sha1_hex -e "print \"perl $^V \", sha1_hex(\"a\"), \"\n\""'
t autotools   'mkdir at && cd at && printf "AC_INIT([h],[1])\nAM_INIT_AUTOMAKE([foreign])\nAC_PROG_CC\nAC_CONFIG_FILES([Makefile])\nAC_OUTPUT\n" > configure.ac && printf "bin_PROGRAMS=h\nh_SOURCES=h.c\n" > Makefile.am && cp ../h.c . && autoreconf -i >/dev/null 2>&1 && ./configure -q && make -s && ./h'
t libtoolize  'libtoolize --version | head -1'
t git-quiet   'cd r && git status 2>&1 | grep -c "unable to access" | grep -x 0'
# etap 2
t less        'echo less-ok | less -F'
t nano        'nano --version | head -1'
t tmux        'tmux new -d "echo tmux-ok > tm.txt; tmux wait -S gotowe" && tmux wait gotowe && cat tm.txt'
t ssh         'ssh-keygen -q -t ed25519 -N "" -f k && ssh-keygen -lf k.pub | cut -d" " -f1,4 && ssh -V 2>&1'
t scp-sftp    'scp a a2 && cmp a a2 && grep -c -- "-S" "$(command -v sftp)"'
t rsync       'mkdir rs && rsync -a a b rs/ && ls rs | wc -l'
t dig         'dig +short example.com A | grep -cE "^[0-9.]+$"'
t whois       'whois -h whois.iana.org pl | grep -m1 -i "^domain"'
t iperf3      '(iperf3 -s -1 -p 15201 >/dev/null 2>&1 &) && for i in 1 2 3 4 5 6 7 8 9 10; do iperf3 -c 127.0.0.1 -p 15201 -t 1 2>/dev/null | grep -m1 receiver && break; done'
t 7z          '7z a -bd x.7z a b >/dev/null && 7z l x.7z | tail -1'
t cabextract  'cabextract --version'
t sox-lame    'sox -n s.wav synth 0.3 sine 440 && lame -S s.wav s.mp3 && sox s.mp3 -n stat 2>&1 | grep "^Length"'
t dot-pngq    'echo "digraph{a->b}" | dot -Tpng -o g.png && echo "digraph{a->b}" | dot -Tsvg | grep -c "<svg" && pngquant -f -o gq.png g.png && file gq.png | cut -d, -f1-3'
# raport modelu „co poprawić w środowisku” (kryteria odbioru)
t env-shebang 'printf "#!/usr/bin/env bash\necho env-ok\n" > es && printf "#!/usr/bin/env python3\nprint(\"py-env-ok\")\n" > ep && chmod +x es ep && ./es && ./ep'
t java-props  'java -XshowSettings:properties -version 2>&1 | grep -E "tmpdir|user.home" | grep -vc -e "$TMPDIR" -e "$HOME" | grep -x 0'
t jadx-decomp 'jadx -d jd H.class >/dev/null 2>&1; grep -l "java-ok" -r jd && ls -d "$HOME/.config/jadx" >/dev/null'
t fontconfig  'echo "digraph{a->b [label=\"zażółć\"]}" | dot -Tpng -o gf.png 2>err && ! grep -i fontconfig err && echo font-ok'
t 7z-all      '7z a -bd x.zip a >/dev/null && 7za t x.7z | grep -m1 "Everything is Ok"'
t x86-preload 'qemu-x86_64 ./xg 2>&1 | grep -vc "gnu-ok" | grep -x 0'
# powłoka wkompilowana w binarki ($PREFIX/bin/sh -> /system/bin/sh) i /bin/sh z termux-exec -> rt/bin/sh
t sh-patched  '! grep -lF /data/data/com.termux/files/usr/bin/sh "$RT/bin/tar" "$RT/bin/make" "$RT/bin/git" "$RT/bin/gawk" && echo sh-ok'
t make-shell  'mkdir mk && printf "all:\n\t@for i in 1 2; do echo m\$\$i; done | tail -1\n" > mk/Makefile && make -C mk -s'
t git-hook    'cd r && git config alias.hi "!echo alias-ok" && git hi && printf "#!/bin/sh\necho hook-ok\n" > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit && echo y > g && git add g && git commit -qm h'
t awk-perl-sys 'awk "BEGIN{system(\"echo awk-ok | cat\")}" && perl -e "system(q{echo perl-ok | cat})"'
t dig-noresolv '! grep -qaF resolv.conf "$RT/bin/.dig" && dig github.com | grep -m1 -E "IN\s+A\s"'
t dsh-install 'dsh-install bc >/dev/null && echo "2^64" | LD_LIBRARY_PATH="$LD_LIBRARY_PATH:$HOME/.local/lib" "$HOME/.local/bin/bc" && dsh-install -f bc | grep -q "bc: OK" && dsh-install -r bc && ! ls -d "$HOME/.local/share/doc/bc" 2>/dev/null'
t pwsh        'pwsh -NoProfile -NonInteractive -Command "\$PSVersionTable.PSVersion.ToString(); (1..4 | Measure-Object -Sum).Sum; Get-ChildItem . | Select-Object -First 1 | ForEach-Object Name" | tr "\n" " "'
t dotnet-cs   'dotnet new console -n cs -o cs >/dev/null && printf "Console.WriteLine(\"cs-ok \" + System.Globalization.CultureInfo.CurrentCulture.Name);\n" > cs/Program.cs && cd cs && dotnet build -v q -nologo 2>&1 | grep -E "^ +0 Error" && ./bin/Debug/net10.0/cs'
echo "--- pass=$pass fail=$fail"
rm -rf "$T"
