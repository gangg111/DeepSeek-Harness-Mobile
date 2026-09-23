#!/data/data/com.termux/files/usr/bin/bash
# Odtwarza dowiązania z links.txt w katalogu runtime ($1) — odpowiednik tego, co robi App.kt po rozpakowaniu.
set -euo pipefail
DST=$1
while IFS= read -r line; do
  [ -n "$line" ] || continue
  link=${line%% -> *}; target=${line##* -> }
  ln -sfn "$target" "$DST/$link"
done < "$DST/links.txt"
sed "s|\$RT|$DST|g" "$DST/etc/wgetrc.in" > "$DST/etc/wgetrc"
