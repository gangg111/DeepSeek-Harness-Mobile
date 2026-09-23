#!/data/data/com.termux/files/usr/bin/bash
# Testuje komplet narzędzi w czystym środowisku (env -i), bez prefiksu Termuxa: $1 = katalog runtime (rt)
# zawierający bin/lib/etc ze stage (bash, python, node, cert.pem) + tools/root. Wypisuje OK/FAIL per narzędzie.
set -u
RT=$(cd "$1" && pwd); T=$(mktemp -d "$RT/../tt.XXXX"); H=$T/home; mkdir -p "$H"
ENVV=(HOME="$H" TMPDIR="$T" PATH="$RT/bin" LD_LIBRARY_PATH="$RT/lib" LANG=en_US.UTF-8 OPENSSL_CONF=/dev/null SSL_CERT_FILE="$RT/etc/tls/cert.pem" REQUESTS_CA_BUNDLE="$RT/etc/tls/cert.pem")
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
echo "--- pass=$pass fail=$fail"
rm -rf "$T"
