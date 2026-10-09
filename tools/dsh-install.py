"""dsh-install: pakiety Termuxa (aarch64, bionic) instalowane do ~/.local, poza runtime apki.

Łańcuch zaufania jak w apt: podpis InRelease (gpgv + klucze Termuxa z rt) -> SHA256 indeksu Packages
-> SHA256 każdego .deb. Zależności, które runtime już ma (rt/etc/dsh-install/provided), są pomijane.
Po rozpakowaniu: shebangi Termuxa -> interpreter z ~/.local/bin albo rt/bin, $PREFIX/bin/sh w binarkach
-> /system/bin/sh, dowiązania do $PREFIX -> ~/.local. Skrypty postinst nie są uruchamiane.

Użycie: dsh-install PAKIET...      instaluje z zależnościami i sprawdza binarki (--version)
        dsh-install -s SŁOWO       szuka w nazwach i opisach
        dsh-install -l             lista zainstalowanych
        dsh-install -f PAKIET...   reinstaluje (także tę samą wersję) i ponownie sprawdza binarki
        dsh-install -r PAKIET...   usuwa pliki pakietu
        dsh-install -u             odświeża indeks (sam odświeża, gdy ma ponad 6 h)
"""
import gzip, hashlib, io, lzma, os, re, shutil, subprocess, sys, tarfile, time, urllib.request

TPFX = "/data/data/com.termux/files/usr"
REPO = os.environ.get("DSH_INSTALL_REPO", "https://packages-cf.termux.dev/apt/termux-main")
RT = os.environ.get("MOBILE_RT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
HOME = os.path.expanduser("~")
LOCAL = os.path.join(HOME, ".local")
STATE = os.path.join(LOCAL, "var", "dsh-install")
CACHE = os.path.join(os.environ.get("TMPDIR") or os.path.join(HOME, ".cache"), "dsh-install")
# pakiety bazowe Termuxa, których w apce nie chcemy (podmieniłyby sh/apt albo dotyczą samej apki Termux)
SKIP = {"dash", "apt", "dpkg", "termux-tools", "termux-am", "termux-am-socket", "termux-exec", "termux-keyring",
        "termux-licenses", "termux-core", "command-not-found", "proot", "bash", "coreutils"}


def die(msg):
    print("dsh-install: " + msg, file=sys.stderr); sys.exit(1)


def fetch(url):
    import ssl
    ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or os.path.join(RT, "etc/tls/cert.pem"))
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-install/1 (apt-like)"})   # domyślny UA Pythona -> 403 z CDN
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
            return r.read()
    except OSError as e:
        die(f"pobieranie {url}: {e}")


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def stanzas(text):
    for block in text.split("\n\n"):
        d, key = {}, None
        for line in block.splitlines():
            if line[:1] in (" ", "\t") and key:
                d[key] += "\n" + line.strip()
            elif ":" in line:
                key, v = line.split(":", 1); d[key] = v.strip()
        if "Package" in d:
            yield d


def update_index():
    os.makedirs(STATE, exist_ok=True)
    signed = fetch(REPO + "/dists/stable/InRelease")
    keys = sorted(os.path.join(RT, "share/termux-keyring", k) for k in os.listdir(os.path.join(RT, "share/termux-keyring")) if k.endswith(".gpg"))
    args = [os.path.join(RT, "bin/gpgv")] + sum((["--keyring", k] for k in keys), []) + ["--output", "-", "-"]
    p = subprocess.run(args, input=signed, capture_output=True)
    if p.returncode != 0:
        die("podpis InRelease NIEPOPRAWNY — przerywam\n" + p.stderr.decode(errors="replace"))
    release = p.stdout.decode()
    sums = dict((m.group(2), m.group(1)) for m in re.finditer(r"^ ([0-9a-f]{64})\s+\d+\s+(\S+)$", release, re.M))
    name = "main/binary-aarch64/Packages.gz"
    if name not in sums:
        die("InRelease nie zawiera SHA256 dla " + name)
    raw = fetch(REPO + "/dists/stable/" + name)
    if sha256(raw) != sums[name]:
        die("SHA256 indeksu Packages nie zgadza się z podpisanym InRelease — przerywam")
    with open(os.path.join(STATE, "Packages"), "wb") as f:
        f.write(gzip.decompress(raw))


def load_index():
    path = os.path.join(STATE, "Packages")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > 6 * 3600:
        print("== indeks pakietów (podpis gpgv + SHA256)"); update_index()
    pkgs, provides = {}, {}
    for d in stanzas(open(path, encoding="utf-8", errors="replace").read()):
        pkgs[d["Package"]] = d
        for pv in d.get("Provides", "").split(","):
            pv = pv.split("(")[0].strip()
            if pv: provides.setdefault(pv, d["Package"])
    return pkgs, provides


def provided():
    try:
        return set(open(os.path.join(RT, "etc/dsh-install/provided")).read().split())
    except OSError:
        return set()


def installed():
    out = {}
    if os.path.isdir(STATE):
        for f in os.listdir(STATE):
            if f.endswith(".version"):
                out[f[:-8]] = open(os.path.join(STATE, f)).read().strip()
    return out


def resolve(names, pkgs, provides, force=False):
    have, inst, order, seen = provided() | SKIP, installed(), [], set()

    def pick(alts):
        for a in alts:
            a = a.split("(")[0].strip().split(":")[0]
            if a in have or a in inst: return None
            if a in pkgs: return a
            if a in provides: return provides[a]
        return alts[0].split("(")[0].strip()

    def visit(n, top):
        if n in seen: return
        seen.add(n)
        if n not in pkgs: die("nie ma pakietu: " + n + "  (szukaj: dsh-install -s " + n + ")")
        if inst.get(n) == pkgs[n]["Version"] and not (top and force):
            if top: print(f"{n} {inst[n]}: już zainstalowany (najnowsza wersja)")
            return
        if not top and n in have: return
        deps = ",".join(x for x in (pkgs[n].get("Pre-Depends"), pkgs[n].get("Depends")) if x)
        for dep in filter(None, (s.strip() for s in deps.split(","))):
            p = pick([a.strip() for a in dep.split("|")])
            if p: visit(p, False)
        order.append(n)

    for n in names:
        visit(provides.get(n, n) if n not in pkgs else n, True)
    return order


def deb_data(deb):
    if not deb.startswith(b"!<arch>\n"): die("to nie jest plik .deb")
    i = 8
    while i < len(deb):
        name, size = deb[i:i + 16].decode().strip().rstrip("/"), int(deb[i + 48:i + 58])
        body = deb[i + 60:i + 60 + size]
        if name.startswith("data.tar"):
            if name.endswith(".xz"): return lzma.decompress(body)
            if name.endswith(".gz"): return gzip.decompress(body)
            if name.endswith(".zst"):
                from compression import zstd
                return zstd.decompress(body)
            return body
        i += 60 + size + (size & 1)
    die("brak data.tar w .deb")


def local_path(p):
    p = p[1:] if p.startswith(".") else p
    if p == TPFX or p.startswith(TPFX + "/"):
        return LOCAL + p[len(TPFX):]
    return None


def extract(pkg, data):
    files, shebangs = [], []
    sh_old = (TPFX + "/bin/sh").encode() + b"\0"
    sh_new = b"/system/bin/sh".ljust(len(sh_old), b"\0")
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for m in tar:
            dst = local_path(m.name)
            if dst is None: continue
            if m.isdir():
                os.makedirs(dst, exist_ok=True); continue
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.lexists(dst): os.remove(dst)
            if m.issym():
                tgt = m.linkname
                os.symlink(LOCAL + tgt[len(TPFX):] if tgt.startswith(TPFX + "/") else tgt, dst)
            elif m.islnk():   # twarde dowiązania na Androidzie dają EACCES -> kopia
                shutil.copy2(local_path(m.linkname) or m.linkname, dst)
            elif m.isfile():
                b = tar.extractfile(m).read()
                if b[:4] == b"\x7fELF":
                    b = b.replace(sh_old, sh_new)
                elif b[:2] == b"#!" and TPFX.encode() in b.split(b"\n", 1)[0]:
                    shebangs.append(dst)
                with open(dst, "wb") as f: f.write(b)
                os.chmod(dst, m.mode | 0o600)
            else:
                continue
            files.append(dst)
    return files, shebangs


def fix_shebang(path):
    with open(path, "rb") as f: b = f.read()
    first, rest = (b.split(b"\n", 1) + [b""])[:2]
    m = re.match(rb"#!\s*(\S+)(.*)", first)
    name = os.path.basename(m.group(1).decode())
    for d in (os.path.join(LOCAL, "bin"), os.path.join(RT, "bin")):
        if os.path.exists(os.path.join(d, name)):
            interp = os.path.join(d, name); break
    else:
        interp = "/usr/bin/env " + name   # termux-exec przepisze /usr/bin/env na rt/bin/env
    with open(path, "wb") as f: f.write(b"#!" + interp.encode() + m.group(2) + b"\n" + rest)


def libdirs():
    return [os.path.join(RT, "lib"), os.path.join(LOCAL, "lib"), "/system/lib64", "/apex/com.android.runtime/lib64/bionic"]


def check_bin(path):
    try:
        out = subprocess.run([os.path.join(RT, "bin/readelf"), "-d", path], capture_output=True, text=True).stdout
    except OSError:
        out = ""
    missing = [l for l in re.findall(r"NEEDED.*\[(.+?)\]", out) if not any(os.path.exists(os.path.join(d, l)) for d in libdirs())]
    if missing:
        return "BRAK BIBLIOTEK: " + " ".join(missing)
    env = dict(os.environ, LD_LIBRARY_PATH=":".join(x for x in (os.environ.get("LD_LIBRARY_PATH"), os.path.join(LOCAL, "lib")) if x))
    fallback, helpline = None, None
    for flag in ("--version", "-V", "-v", "--help", "-h"):
        try:
            p = subprocess.run([path, flag], capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL, env=env)
        except subprocess.TimeoutExpired:
            continue
        except OSError as e:
            return "nie uruchamia się: " + str(e)
        text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", p.stdout + p.stderr)
        line = next((l.strip() for l in text.splitlines() if l.strip()), "")
        if flag in ("--help", "-h"):
            if p.returncode == 0 and line and helpline is None: helpline = line
            continue
        if not re.search(r"\d+\.\d+", line):   # np. neofetch -V wypisuje logo zamiast wersji
            continue
        if p.returncode == 0:
            return "OK " + line[:80]
        if fallback is None:
            fallback = f"uruchamia się, wypisał „{line[:60]}”, ale {flag} zwrócił kod {p.returncode}"
    return fallback or (f"OK (tylko --help) {helpline[:70]}" if helpline else "?? (żadna z flag --version/-V/-v/--help/-h nie zadziałała)")


def termux_paths(files):
    found = set()
    for f in files:
        if os.path.islink(f) or not os.path.isfile(f): continue
        with open(f, "rb") as fh: b = fh.read()
        if b[:4] != b"\x7fELF": continue
        for m in re.finditer(re.escape(TPFX.encode()) + rb"(/[A-Za-z0-9._/+-]*)", b):
            s = m.group(1).decode(errors="replace")
            # /bin/bash, /bin/login: w każdej binarce (biblioteka uruchamiająca Termuxa), nieużywane w apce -> szum
            if s not in ("/lib", "/bin/sh", "/bin/bash", "/bin/login") and not s.startswith("/lib:"): found.add(TPFX + s)
    return sorted(found)


def install(names, force=False):
    pkgs, provides = load_index()
    order = resolve(names, pkgs, provides, force)
    if not order:
        print("nic do zrobienia (wszystko jest w runtime albo już zainstalowane)"); return
    print("== do instalacji: " + " ".join(order))
    os.makedirs(CACHE, exist_ok=True); os.makedirs(STATE, exist_ok=True)
    new_files, top = [], {provides.get(n, n) if n not in pkgs else n for n in names}
    for n in order:
        d = pkgs[n]
        deb = fetch(REPO + "/" + d["Filename"])
        if sha256(deb) != d["SHA256"]:
            die(n + ": SHA256 .deb nie zgadza się z podpisanym indeksem — przerywam")
        files, shebangs = extract(n, deb_data(deb))
        for s in shebangs: fix_shebang(s)
        with open(os.path.join(STATE, n + ".list"), "w") as f: f.write("\n".join(files) + "\n")
        with open(os.path.join(STATE, n + ".version"), "w") as f: f.write(d["Version"] + "\n")
        print(f"   {n} {d['Version']}: {len(files)} plików")
        if n in top: new_files += files
    bins = [f for f in new_files if f.startswith(os.path.join(LOCAL, "bin") + "/") and os.access(f, os.X_OK)]
    print("== sprawdzenie binarek")
    for b in sorted(bins):
        print(f"   {os.path.basename(b)}: {check_bin(b)}")
    paths = termux_paths(new_files)
    if paths:
        print("== uwaga: binarki mają wkompilowane ścieżki Termuxa (pliki danych/konfiguracji mogą nie zostać znalezione):")
        for p in paths[:8]: print("   " + p)


def remove(names):
    for n in names:
        lst = os.path.join(STATE, n + ".list")
        if not os.path.exists(lst):
            print(f"{n}: nie jest zainstalowany przez dsh-install"); continue
        cnt, dirs = 0, set()
        for f in open(lst).read().split():
            if os.path.lexists(f) and f.startswith(LOCAL + "/"):
                os.remove(f); cnt += 1; dirs.add(os.path.dirname(f))
        for d in sorted(dirs, key=len, reverse=True):   # puste katalogi po pakiecie, w górę do ~/.local (bez niego)
            while d.startswith(LOCAL + "/") and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d); d = os.path.dirname(d)
        os.remove(lst); os.remove(os.path.join(STATE, n + ".version"))
        print(f"{n}: usunięto {cnt} plików")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return
    if argv[0] == "-u":
        update_index(); print("indeks odświeżony"); return
    if argv[0] == "-l":
        for n, v in sorted(installed().items()): print(n, v)
        return
    if argv[0] == "-r":
        remove(argv[1:]); return
    if argv[0] == "-s":
        pkgs, _ = load_index(); q = " ".join(argv[1:]).lower()
        for n, d in sorted(pkgs.items()):
            desc = d.get("Description", "").split("\n")[0]
            if q in n.lower() or q in desc.lower(): print(f"{n} {d['Version']}  {desc}")
        return
    if argv[0] == "-f":
        install(argv[1:], force=True); return
    install(argv)


if __name__ == "__main__":
    main(sys.argv[1:])
