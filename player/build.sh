#!/bin/sh
# Builds the free MXD clip players, simple.c and controls.c, into the copies
# the converters carry: tools/cybiko_mxd_player.e and
# cybiko_mxd_player_controls.e for cybiko_mxd.py, and web/lib/mxdplayer.js
# for the web page.
# Needs the GNU H8 tools (Debian/Ubuntu: binutils-h8300-hms gcc-h8300-hms)
# and Python 3.
set -e
cd "$(dirname "$0")/.."
out=build/player
mkdir -p $out
h8300-hitachi-coff-as player/rt.s -o $out/rt.o
for name in simple controls; do
    h8300-hitachi-coff-gcc -ms -Os -fomit-frame-pointer -Wall -Wextra -ffreestanding -fno-builtin \
        -c player/$name.c -o $out/$name.o
    for base in 0 0x10000; do
        h8300-hitachi-coff-ld -mh8300s -T player/link.ld -Ttext $base -o $out/$name-$base.coff $out/$name.o $out/rt.o
    done
    python3 player/mkmodule.py $out/$name-0.coff $out/$name-0x10000.coff $out/$name.e
done
cp $out/simple.e tools/cybiko_mxd_player.e
cp $out/controls.e tools/cybiko_mxd_player_controls.e
python3 - <<'PY'
import base64
def b64(name):
    data = base64.b64encode(open("build/player/%s.e" % name, "rb").read()).decode()
    return " +\n".join('    "%s"' % data[i:i + 76] for i in range(0, len(data), 76))
open("web/lib/mxdplayer.js", "w").write(
    "// The free MXD clip players (player/, built by player/build.sh): the\n"
    "// simple one and the one with controls.\n"
    "(function (C) {\n  \"use strict\";\n"
    "  C.mxdPlayer = \"\" +\n" + b64("simple") + ";\n"
    "  C.mxdPlayerControls = \"\" +\n" + b64("controls") + ";\n"
    "})(globalThis.Cybiko = globalThis.Cybiko || {});\n")
PY
