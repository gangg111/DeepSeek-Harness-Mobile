#!/system/bin/sh
# cc/gcc/clang/c++/g++/clang++ -> zig cc|c++ (build-tools.sh podstawia @MODE@). Domyślny cel aarch64-linux-musl:
# statyczne binarki działają na Androidzie.
Z="$(dirname "$0")/../opt/zig/zig"
case " $* " in *" -target "*|*"--target="*) ;; *) set -- -target aarch64-linux-musl "$@";; esac
# `zig cc -target … --version` pada (SIGSEGV), a meson/cmake rozpoznają kompilator po --version:
# -v wypisuje tę samą linię „clang version …”, oddajemy ją na stdout.
case " $* " in *" --version "*)
  for a; do shift; [ "$a" = --version ] && a=-v; set -- "$@" "$a"; done
  exec "$Z" @MODE@ "$@" 2>&1;;
esac
# Plik zależności (-MD/-MMD + -MF/-MT/-MQ, dodają je meson, cmake, autotools) wywraca zig (SIGSEGV albo
# „unable to open output directory”), -M/-MM też. Kompilujemy bez tych flag, a zależności bierzemy z wyjścia
# preprocesora (-E): linie `# N "plik"` to dokładnie lista wczytanych plików.
case " $* " in *" -MD "*|*" -MMD "*)
  dep=; tgt=; out=; next=
  for a; do shift
    case "$next" in
      MF) dep=$a; next=; continue;;
      MT) tgt=$a; next=; continue;;
      o) out=$a; next=;;
    esac
    case "$a" in
      -MD|-MMD|-MP) continue;;
      -MF) next=MF; continue;;
      -MT|-MQ) next=MT; continue;;
      -o) next=o;;
    esac
    set -- "$@" "$a"
  done
  "$Z" @MODE@ "$@" || exit $?
  [ -n "$out" ] || exit 0
  [ -n "$dep" ] || dep="${out%.*}.d"
  [ -n "$tgt" ] || tgt=$out
  skip=
  for a; do shift
    [ -n "$skip" ] && { skip=; continue; }
    case "$a" in -o) skip=1; continue;; -c) continue;; esac
    set -- "$@" "$a"
  done
  "$Z" @MODE@ "$@" -E -o - 2>/dev/null | awk -F'"' -v t="$tgt" '
    /^# [0-9]+ "/ && $2 !~ /^</ && !seen[$2]++ { f = $2; gsub(/ /, "\\ ", f); d = d " \\\n  " f }
    END { print t ":" d }' > "$dep"
  exit 0;;
esac
exec "$Z" @MODE@ "$@"
