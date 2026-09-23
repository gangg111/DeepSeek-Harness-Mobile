#!/data/data/com.termux/files/usr/bin/bash
# Wkleja tools/root do katalogu runtime ($1): kopiuje z zachowaniem dowiązań, potem usuwa dowiązania
# (zip ich nie przenosi) — apka odtwarza je z links.txt, Termux przez apply-links.sh.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); DST=$1
cp -a "$HERE/root/." "$DST/"
find "$DST" -type l -delete
