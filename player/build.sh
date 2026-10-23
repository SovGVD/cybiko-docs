#!/bin/sh
# Builds the free MXD clip player (build/player/main.e) into the copies the
# converters carry: tools/cybiko_mxd_player.e for cybiko_mxd.py and
# web/lib/mxdplayer.js for the web page.
# Needs the GNU H8 tools (Debian/Ubuntu: binutils-h8300-hms gcc-h8300-hms)
# and Python 3.
set -e
cd "$(dirname "$0")/.."
out=build/player
mkdir -p $out
h8300-hitachi-coff-gcc -ms -Os -fomit-frame-pointer -Wall -Wextra -ffreestanding -fno-builtin \
    -c player/main.c -o $out/main.o
h8300-hitachi-coff-as player/rt.s -o $out/rt.o
for base in 0 0x10000; do
    h8300-hitachi-coff-ld -mh8300s -T player/link.ld -Ttext $base -o $out/at$base.coff $out/main.o $out/rt.o
done
python3 player/mkmodule.py $out/at0.coff $out/at0x10000.coff $out/main.e
cp $out/main.e tools/cybiko_mxd_player.e
python3 - <<'PY'
import base64
data = base64.b64encode(open("build/player/main.e", "rb").read()).decode()
lines = [data[i:i + 76] for i in range(0, len(data), 76)]
open("web/lib/mxdplayer.js", "w").write(
    "// The free MXD clip player (player/, built by player/build.sh).\n"
    "(function (C) {\n  \"use strict\";\n  C.mxdPlayer = \"\" +\n" +
    " +\n".join('    "%s"' % l for l in lines) +
    ";\n})(globalThis.Cybiko = globalThis.Cybiko || {});\n")
PY
