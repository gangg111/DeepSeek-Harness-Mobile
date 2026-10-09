# DSH Mobile: DeepSeek Harness on Android

**English · [Polski](README.pl.md)**

**The whole DeepSeek Harness in a single phone app, no Termux, no root, with a complete developer toolchain (including .NET 10 and PowerShell 7), a Polish language pack and a Code screen that moves sessions and their project files between your computers and the phone.**

A self-contained Android APK that runs the full [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (Node.js agent harness with a web GUI) on-device, with a bundled toolchain (C/C++ via Zig, JDK 21, Kotlin, Python 3.14, Node 26, jadx, apktool, git, ffmpeg…), a Polish language pack, a curated set of community plugins, Edge TTS, an in-app updater, `dsh-install` for Termux packages and a **Code** screen that opens DeepSeek Harness sessions from your computers, carries them to the phone together with the project files and keeps both sides in sync, over a **built-in Tailscale node** (tsnet, no VPN app needed; computers running [dsh-remote-control](https://github.com/gangg111/dsh-remote-control) are discovered automatically). Built entirely inside Termux on an arm64 phone.

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/screenshot-1.jpg" width="300" alt="Session start screen in Polish: workspace picker, standard mode, composer" />
  <img src="docs/screenshots/screenshot-2.jpg" width="300" alt="Sidebar: new session, workspaces, settings" />
</p>

## What it is

One APK packs:

- **DeepSeek Harness** (`@deepseek-ai/dsh`, web profile) running on the bundled Node.js 26 from Termux,
- a **Polish UI** (language pack through the official dsh locale mechanism, 58 namespaces, 2446 strings, since 1.2.0 covering the new dsh 0.2.0 screens: plugin manager, automation tasks, voice input, sidebar terminal and browser; the UI language follows the system or the Settings → General → Language setting, English stays available),
- **tools for the model**, all on the `PATH` of the bundled `bash`:
  - compilers: `cc`/`gcc`/`clang`/`c++`/`g++` (Zig, producing static binaries that run on Android), JDK 21 (`java`, `javac`, `jar`, `javap`, `jshell`), `kotlinc`, Python 3.14 with pip and numpy, Node 26 with npm/npx and pnpm, `make`, `cmake`,
  - reverse engineering: `jadx`, `apktool`, `d2j-dex2jar` and the rest of dex2jar, `aapt`, `aapt2`, GNU binutils (`objdump`, `nm`, `readelf`, `strings`, `ar`, `ld`, `as`),
  - .NET 10 SDK (`dotnet new/build/run`, native Android build from Termux) and PowerShell 7 (`pwsh`),
  - system: GNU coreutils, `sed`, `gawk`, `grep`, `find`, `diff`, `patch`, `tar`, `gzip`, `xz`, `bzip2`, `zip`, `unzip`, `7z`, `zstd`, `rg`, `fd`, `jq`, `tree`, `file`, `less`, `nano`, `tmux`, `curl`, `wget`, `git` (HTTPS), `gh`, `ssh`/`scp`/`sftp`, `rsync`, `dig`, `whois`, `socat`, `nmap`, `iperf3`, `sqlite3`, `openssl`, `ffmpeg`, `ffprobe`, `sox`, `lame`, `pngquant`, `rsvg-convert`, graphviz `dot`,
  - building and emulation: `perl`, autotools, `meson`, `ninja`, `pkg-config`, `patchelf`, `qemu-x86_64` with a glibc x86_64 sysroot (cross-compiled `cc -target x86_64-linux-gnu` binaries run on the phone), `proot` (fake root, bind mounts, x86_64 rootfs instead of Docker), `adb`,
  - `dsh-install <pkg>`: installs any other Termux package (with dependencies) into `~/.local`, verified like apt (GnuPG signature of the repository index, SHA256 of the index and of every package), and checks the new binaries; `-s` search, `-l` list, `-r` remove, `-f` reinstall,
  - Termux paths need no workarounds: `#!/usr/bin/env …` and `#!/bin/sh` shebangs run as written (termux-exec), tools that spawn a shell (`tar -z`, `make`, git hooks and aliases, `awk`/`perl` `system()`) use `/system/bin/sh`, Java gets the app's temp and home directories,
- **`xdg-open <file>`** for the agent: opens a result (PDF, image, video, document) in an app on the phone via the system chooser; `.md` files open in a built-in reader/editor,
- **community plugins**: mobile UI (dsh-qol), cross-session memory, turn rewind with file restore, loop breakers (repeat-stop, tool-budget), 87 reverse-engineering skills, diff-based file editing, clock in context, task list across turns, MCP bridge over stdio, TTS (Edge TTS with Polish voices, parallel synthesis of fragments),
- a **working plugin manager**: the bundled pnpm lets Plugins → Add plugin install plugins from npm and GitHub just like on a computer; they show up under “Installed” and can be uninstalled there (the plugins built into the APK keep working but are not listed),
- a **foreground service** that keeps the server alive in the background (notification with “Stop” and “Update” buttons),
- an **in-app updater** behind one “Update” button (in the notification, or the blue button at the bottom of the sidebar, as in DSH Desktop): it first checks this repository's Releases and, when a newer APK is published, downloads it with progress, verifies its md5 and offers to install it; only when there is no newer APK does the bundled npm download a new dsh version, apply the Android patches from precompiled files, test-start it and swap the directory.

## Installation

1. Download `dsh-mobile.apk` from [Releases](../../releases) (about 890 MB).
2. Allow your file manager to install from unknown sources and install it. Later updates come from inside the app; the first time, Android asks to allow “Install unknown apps” for DeepSeek Harness.
3. The first launch unpacks about 2.1 GB (57k files) into the app's storage. It takes a few minutes with a progress counter; later launches take seconds.
4. Grant file access: the agent works in `Download` by default, and the app writes its log there (`Download/dsh_log.txt`).
5. Enter your DeepSeek API key in the harness welcome screen.

Requirements: Android 9+ (targetSdk 28 on purpose, see below), arm64, about 3.5 GB of free space.

## Usage

- The UI runs in the app window; the server listens only on `127.0.0.1:3090` and every launch gets a fresh token.
- Language: Settings → General → Language (Polish by default when the system is Polish, English otherwise).
- Permission mode: the app sets `danger-full-access`, because the Android kernel has neither Landlock nor bubblewrap, and dsh refuses to run commands in sandboxed modes. Android itself isolates the process (app directory plus shared storage).
- TTS: speaker button next to a reply, “Read automatically” toggle in the composer, settings under Settings → Plugins → Voice. Default voice `pl-PL-ZofiaNeural`; `DSH_TTS_EDGE_PARALLEL` sets the number of parallel syntheses (default 30).
- Updating: “Update” in the notification or the blue button at the bottom of the sidebar. The app checks for updates (first a newer APK in Releases, then a newer dsh in npm) whenever it is opened, also after “Stop”, when you return to it (at most every 30 min) and every 6 hours. After the download, “Install” opens the system installer.
- Installing plugins: Plugins → Add plugin → Install a third-party plugin. Use the full npm name including the scope (e.g. `@michengai/dsh-skills-manager`, not the unrelated `dsh-skills-manager`) or `github:owner/repo` for plugins published only on GitHub (e.g. `github:2002XiaoYu/dsh-session-diff`). dsh rejects plugins whose authors declare compatibility only with older dsh versions, and nothing is installed then.
- Plugins installed from the plugin manager are translated where possible: Plugin Market and Archived sessions through the dsh locale mechanism, Cost (dsh-cost-meter) through a patch the app re-applies at every start and after every plugin install or update. On a fresh install Cost shows amounts in USD; an existing install keeps its saved currency (Settings → Cost → Display → Money & currency). Plugin descriptions in the market come from their authors and stay in the original language.
- `AGENTS.md` from the working directory goes into the model's context.
- The UI is rendered 1.2× larger than in a desktop browser (viewport meta: page width = screen/1.2; constant `UI_ZOOM` in `MainActivity.kt`), and the Android status/navigation bars take the page background color.
- The keyboard works without suggestions, autocorrect or swipe typing in dsh fields (the WebView reports fields as “visible password”): the composer editor (Lexical) with a composing keyboard such as Samsung's selected the first letter and overwrote it with the next one (Lexical #7210). Without word composition the bug does not occur.
- **Code** (sidebar): DeepSeek Harness sessions from your computers. First time: “Sign in to Tailscale” (the system browser opens; the app becomes the `dsh-mobile` device in your tailnet). Computers running the [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) plugin appear on their own; tapping a session opens it with full history, and messages and photos work as on the PC. “Add device” remains as a manual fallback. When the node is not signed in but the Tailscale app (VPN) is on, the old direct route still works.
- **Sessions with their project files** (with [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) 0.7.0+ on the PC): a session sent from the computer lands on the phone together with its whole project directory (except build outputs, dependencies, secrets, binaries and files over 5 MB) in `~/<project>`, a separate workspace that becomes the session's working directory, so the agent continues on the same files; it is also told in its prompt which computer path maps to which phone path. Sending the same synced session again updates the existing copy. While the session is synced, files move with the writing: when the phone takes over, it first pulls what changed on the PC; when the computer takes over, the phone first sends back what changed on the phone (including files created by shell commands). A file nobody touched since the last transfer is replaced quietly; a file changed on both sides keeps the other version next to it as `*.przed-importem-<date>`. Until the files have arrived and been confirmed, writing stays where it is, so a stale copy never overwrites newer work.
- Transfers show their progress: an arrow (to or from the phone) with a thin bar next to the session, a bar above the composer and on the Code screen, and an animated Code icon in the sidebar.
- Deleting a session (“Delete session” from the archive plugin) removes it from disk; a session still synced with a computer is refused with “unlink sync first” (tap the computer icon next to it).

## How it works

```
APK
├── assets/payload.zip           (stored, ~610 MB) → unpacked to filesDir/rt on first launch
│   ├── bin/  node bash python3 …  + wrappers (cc, javac, jadx, npm …), dsh-tsnet-mobile
│   ├── lib/  *.so from Termux (NEEDED closure), python3.14/, node_modules/npm
│   ├── opt/  jdk, zig, jadx, apktool, kotlin, dex2jar, dotnet (SDK 10), pwsh (PowerShell 7), x86_64-sysroot
│   ├── node_modules/            dsh + plugins (npm)
│   ├── dsh-locale-pl/           plugin with the Polish language pack
│   ├── dsh-code/                Code screen plugin (host + client)
│   ├── android.patch.yml        profile overlay: plugins, system prompt, locale
│   ├── android-shim.cjs         --require: fs.link → copyFile (Android forbids hard links), patches for user-installed plugins
│   ├── android-patches/*.mjs    plugin patches (parallel TTS, Polish strings) applied after npm install
│   ├── android-patches/profile/ patches for plugins the user installs (translation of dsh-cost-meter), re-applied on start and on profile changes
│   ├── android-prebuilt/        pty.node, system.node (flock) — precompiled addons
│   ├── android-update.mjs       in-app updater
│   ├── tools.env, links.txt     environment variables and symlinks recreated after unpacking
│   ├── etc/dsh-install/provided Termux packages already in the runtime (skipped as dependencies)
│   └── etc/tls/cert.pem
├── ServerService                foreground service: node … dsh --profile web --patch rt/android.patch.yml --port 3090
└── MainActivity                 WebView pointed at the server (token read from stdout)
```

Workarounds needed for Termux's Node and dsh to run inside another app:

| Problem | Solution |
|---|---|
| Termux binaries have the prefix `/data/data/com.termux/files/usr` compiled in | `LD_LIBRARY_PATH`, `OPENSSL_CONF=/dev/null`, `SSL_CERT_FILE`, `GIT_EXEC_PATH`, `GIT_CONFIG_NOSYSTEM=1`, `MAGIC`, `CMAKE_ROOT`… (`tools.env`) |
| since API 29 Android blocks exec and dlopen from the app data directory | `targetSdk 28` (Termux does the same) |
| SELinux forbids hard links (`link()`) | shim replacing `fs.link` with `copyFile(COPYFILE_EXCL)` |
| the `flock` addon exists only for linux/darwin | `flock.c` compiled with clang as `node-addon-system-android-arm64` + loader patch |
| `sharp` has no android-arm64 binary | WebAssembly variant |
| `node-pty` has no prebuild | node-gyp build with `-Dandroid_ndk_path=` |
| no sandbox (Landlock/bwrap) | `DSH_PERMISSION_MODE=danger-full-access` |
| zip does not carry symlinks | `links.txt` recreated with `Os.symlink` |
| scripts with Termux shebangs | `#!/system/bin/sh` + exec through the bundled bash |
| scripts written by the agent with `#!/usr/bin/env …` or `#!/bin/sh` (there is no `/usr` and no root) | termux-exec (`LD_PRELOAD`, `TERMUX__PREFIX=rt`) rewrites the interpreter path on exec; `bin/sh` → bash |
| 28 binaries spawn a shell through the compiled-in `$PREFIX/bin/sh` (tar -z, make, git hooks and aliases, awk/perl `system()`, cmake, ninja…) | the string is patched in the binaries to `/system/bin/sh` (same length, NUL-padded) |
| `7z` loads its codecs from `$PREFIX/libexec/7zip/7z.so`; `dig` aborts on Termux's unreadable `resolv.conf` | standalone `7zz` as `7z`; the path in `dig` patched to `/dev/null` (server `@8.8.8.8` from a wrapper) |
| Termux's JDK has `java.io.tmpdir` and `user.home` inside Termux | Java wrappers pass the app's `TMPDIR` and `HOME` |
| .NET loads ICU by unversioned names and otherwise picks Android's `/apex` ICU (SIGABRT); PowerShell ships `libpsl-native` only for glibc | unversioned ICU symlinks in `lib/`; `libpsl-native` built from PowerShell-Native for bionic; `DOTNET_ROOT`, no first-run experience |
| `koffi` version without an android-arm64 binary (dsh ≥ 0.2.0 pins 3.1.1) | `overrides` in package.json to the newest version of the same major line that has the binary |
| after a dsh upgrade npm nests `@deepseek-ai/*` under `@deepseek-ai/dsh/node_modules`, so plugins cannot find `@deepseek-ai/dsh-tools` | `android-hoist.mjs`: top-level symlinks to the nested packages (recreated from `links.txt` in the APK) |
| `node-addon-require-builtin` (dsh ≥ 0.2.0) with no android-arm64 variant and no sources | a JS package `node-addon-require-builtin-android-arm64` that returns internal modules through plain `require()` under `--expose-internals` |
| the dsh plugin manager calls `pnpm` from `PATH` (without it: “pnpm was not found”) | pnpm from Termux in `lib/node_modules/pnpm` plus a `bin/pnpm` script (`#!/system/bin/sh`, path relative to itself) |
| git reads Termux's compiled-in `usr/etc/gitconfig`; with Termux installed the file exists but the app cannot read it (“Permission denied”, e.g. when installing a plugin from GitHub) | `GIT_CONFIG_NOSYSTEM=1` in `tools.env` |
| dsh shows its update button only with the DSH Desktop bridge (`globalThis.dshDesktop`), whose presence also switches account sign-in, analytics and onboarding to desktop mode | patch `settings-update-bridge.mjs`: without `dshDesktop` the button reads the app bridge `DshMobileUpdate` (WebView `addJavascriptInterface`, answering only the local dsh) |
| pnpm reinstalls user plugins clean, and some of them keep their own zh/en dictionaries outside the dsh locale mechanism | `android-patches/profile/`: translation by English text, applied by `android-shim.cjs` at start and after every profile change; all or nothing — when the plugin code changes the patch is skipped with a log line and the plugin stays in English |

### Code screen and the built-in Tailscale node

`code/dsh-code` is a dsh plugin (host + client). The server starts `bin/dsh-tsnet-mobile` (`tsnet/`, Go, built natively inside Termux with `GOOS=android`): a Tailscale node inside the process, no TUN device, no VPN. The official `tailscaled` does not start on Android because SELinux denies apps access to netlink; the program lists interfaces through `ioctl SIOCGIFCONF` instead. For every computer it opens a local proxy on `127.0.0.1:<fixed port>` and forwards HTTP and WebSocket traffic to `https://<pc>.ts.net` (Host/Origin rewritten to the computer's address, Location rewritten back to the local one, Set-Cookie without Secure). Entering the proxy requires a secret generated at every start (passed to the program only through an environment variable), then an HttpOnly SameSite=Strict session cookie; the server uses the `X-DSH-Secret` header; anything else gets 403. Tailnet devices are probed (`/__remote/api/info`, 4 s timeout, `dsh-*` names first, up to 4 at a time; failed probes are retried after 30 s, 2 min and 10 min, then only when the device's online state changes) and those running `dsh-remote-control` are added to `dsh-code.json` in the app directory, which survives updates. On the PC side you need the [`dsh-remote-control`](https://github.com/gangg111/dsh-remote-control) plugin (separate repository: a DSH gateway behind Tailscale that admits only your account) and “HTTPS Certificates” enabled in the tailnet admin console.

## Building from source (Termux, arm64)

Requirements: Termux with `nodejs` (26), `python` (3.14), `clang`, `openjdk-21`, `golang`, `dotnet-sdk-10.0`, `gnupg` (gpgv), `git`, `zip`, `aapt2`, `apksigner`, Gradle through the project wrapper, and the packages of the tools copied into the payload (`binutils`, `ripgrep`, `fd`, `jq`, `tree`, `file`, `ffmpeg`, `sqlite`, `kotlin`, `dex2jar`, `cmake`, `make`, `python-numpy`…). Gradle/aapt2 pitfalls on Termux are described in `app/gradle.properties`.

```sh
# 1. install dsh with the Android patches (once; update.sh does it afterwards)
mkdir ~/dsh-test && cd ~/dsh-test && npm init -y && npm install --ignore-scripts --force @deepseek-ai/dsh
# 2. the toolchain from Termux + downloaded archives (zig, jadx, apktool) -> tools/root
tools/build-tools.sh
# 3. full run: npm -> native patches -> runtime -> language pack -> Tailscale node (Go) -> payload -> APK
./update.sh                 # options: --tag alpha|X.Y.Z  --skip-npm  --force  --debug
```

`update.sh` writes the signed APK to `/sdcard/Download/dsh-mobile.apk`. The release signature uses the key `~/.android/ciuchy-release.jks` (alias `ciuchy`, password in `~/.android/ciuchy-release.pass`); change `signingConfigs` in `app/app/build.gradle.kts` to your own key or use `--debug`.
Next to the APK it writes `dsh-mobile.apk.md5` and `dsh-mobile.json` (`versionCode`, `versionName`, `md5`, `size`). Every release must carry `dsh-mobile.json` next to `dsh-mobile.apk`, otherwise the in-app updater ignores it; newness is decided by `versionCode`, so assets can be replaced in place under the same tag. Upload the APK and `.md5` first and `dsh-mobile.json` last, so that no phone sees the new version before its APK is in place.

Tests: `tools/test-tools.sh <rt>` (85 toolchain tests in a clean environment), `go test ./...` in `tsnet/`, `node --test` in `code/dsh-code`. Before packaging, `update.sh` test-starts dsh on the staged runtime.

## Translation

- dsh UI: `locale-pl/pl-1..7.json` → `pl.json` → `build-plugin.mjs` → plugin `@dsh-local/locale-pl`. After a dsh update, missing keys fall back to English; `update.sh` prints the list of untranslated keys.
- Plugins installed from the plugin manager: those using the dsh locale mechanism get Polish dictionaries from `pl-7.json` (`dsh-market`, `archive-manager-workspace`); dsh-cost-meter, with its own zh/en dictionaries, is translated by `stage/android-patches/profile/` (`cost-meter.pl.json`, 614 texts).
- Community plugins do not use the dsh locale mechanism (hard-coded Chinese strings or their own zh/en dictionaries), so they are localized by the patches `android-patches/{qol,rewind,tts}-polish.mjs`. When an author changes a string, the patch stops the update with a message so that Chinese strings never slip through silently.

## Limitations

- There is no apt/pkg and no root: `dsh-install` covers Termux packages, but a package may still look for its data under `/data/data/com.termux` (it lists such paths); pip builds only pure-Python packages, npm and pnpm install only packages without native parts (this also applies to plugins added from the plugin manager).
- Windows `.exe`/`.bat` do not run (no Wine); PowerShell has the cross-platform cmdlets only (no registry, WMI, COM). There is no writable `/tmp` and `/usr/bin/env` is not a real file (exec still works); use `$TMPDIR`.
- The in-app updater requires the same `node-pty` version as the precompiled one; otherwise it points to `update.sh` in Termux (where the compiler is).
- With 30 parallel connections and very long replies, Microsoft may reject some of them; the plugin retries the fragment and skips it as a last resort.
- Size: APK about 890 MB, about 2.1 GB unpacked; about 3.5 GB of free space including the APK.
- dsh 0.2.0 disables the `dsh-memory-connect` (cross-session memory) and `dsh-reverse-skill` (reverse-engineering skills) plugins as incompatible: their authors declare compatibility with dsh 0.1.x only. They come back once compatible versions appear.
- Code screen: the proxy can only be entered from the Code screen (SameSite=Strict cookie), and the computer needs “HTTPS Certificates” enabled in the tailnet, otherwise `tls: internal error`.

## Component licenses

This app's code: MIT. The APK contains third-party software under its own licenses:

| Component | License |
|---|---|
| DeepSeek Harness and `@deepseek-ai/*` plugins | MIT |
| Node.js, npm | MIT / Artistic 2.0 |
| OpenJDK 21 (Termux) | GPLv2 with Classpath Exception |
| Zig | MIT |
| Kotlin | Apache 2.0 |
| jadx, apktool | Apache 2.0 |
| dex2jar | Apache 2.0 |
| Python 3.14, numpy | PSF / BSD |
| bash, coreutils, findutils, grep, sed, gawk, diffutils, patch, tar, gzip, make, binutils, wget (Termux) | GPLv3 |
| git | GPLv2 |
| pnpm | MIT |
| .NET 10 SDK and runtime (Termux build), PowerShell 7 | MIT |
| termux-exec | Apache 2.0 |
| 7-Zip (`7zz`) | LGPL 2.1+ with the unRAR restriction |
| GnuPG (`gpgv`), less, nano, rsync, pngquant | GPLv3 |
| QEMU (user mode), proot, perl, autotools, sox | GPLv2 / Artistic (perl) / GPL·LGPL (sox) |
| OpenSSH, tmux, BIND `dig`, graphviz, nmap, lame, `gh`, `adb` | BSD / ISC / MPL 2.0 / EPL / NPSL / LGPL / MIT / Apache 2.0 respectively |
| glibc, libgcc, libstdc++ (Debian, x86_64 sysroot for qemu) | LGPL / GPL with runtime exception |
| marked (Markdown reader) | MIT |
| Tailscale (`tsnet`) and the Go libraries of `dsh-tsnet-mobile` | BSD-3-Clause; dependencies under their own licenses (BSD/MIT/Apache 2.0) |
| ffmpeg | LGPL/GPL (Termux build) |
| curl, openssl, sqlite, zip/unzip, xz, bzip2, jq, ripgrep, fd, tree, file, cmake | their own licenses (MIT/BSD/zlib and similar) |
| dsh community plugins (dsh-qol, dsh-memory-connect, dsh-turn-rewind, dsh-reverse-skill, dsh-patch-edit-plus, dsh-repeat-stop, dsh-tool-budget, dsh-clock-context, dsh-todo-continuity, dsh-mcp-bridge, dsh-plugin-tts) | per their authors' repositories (MIT) |

Binaries come from Termux packages (https://github.com/termux/termux-packages) and the official releases of Zig, jadx and apktool.

## Repository layout

```
app/            Gradle project (Kotlin): App.kt, ServerService.kt, MainActivity.kt, ApkUpdater.kt (app updates from Releases), Opener.kt (xdg-open), MdActivity.kt (Markdown reader)
stage/          runtime and payload files (without node_modules — those live in ~/dsh-test)
tools/          build-tools.sh, merge-tools.sh, apply-links.sh, test-tools.sh, dsh-install.py, zig-cc-wrapper.sh, root/ (output)
locale-pl/      Polish language pack: extract-en.mjs, pl-*.json, build-plugin.mjs, android.patch.yml
code/dsh-code/  Code screen plugin (host: index.js, tsnet.js, discover.js; client: client.js; vendor/: shared transfer modules from dsh-remote-control; node tests)
tsnet/          dsh-tsnet-mobile: built-in Tailscale node in Go (tsnet, proxy, control API, tests)
tap-outside/    plugin closing the sidebar by tapping next to it
update.sh       full build and update pipeline
```
