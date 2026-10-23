#!/usr/bin/env python3
"""Turn a program built with the GNU H8 tools into a CyOS module (main.e).

    mkmodule.py A.coff B.coff OUT.e [--entry SYM]

A.coff and B.coff are the same program linked at 0 and at 0x10000 (see
link.ld). The words that differ by 0x10000 are the ones the CyOS loader has
to relocate. A call of 0xf00000 + k * 0x10000 + N (cyos.ld names them)
becomes an import of export N of library k: the kernel ("ordinals"),
CyWin.dl or sound.dl. The module format is in file-formats.md
("CyOS modules").

From cybiko-browser's tools/cybiko_mkapp.py. Python 3 and the GNU H8
binutils (binutils-h8300-hms).
"""
import os
import struct
import subprocess
import sys

TOOL = "h8300-hitachi-coff-"
SHIFT = 0x10000


def image(coff):
    """The loaded bytes (.text, which holds code and data) and the symbols."""
    binary = coff + ".bin"
    subprocess.run([TOOL + "objcopy", "-O", "binary", "-j", ".text", coff, binary], check=True)
    data = open(binary, "rb").read()
    os.unlink(binary)
    syms = {}
    out = subprocess.run([TOOL + "nm", coff], check=True, capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 3:
            syms[parts[2]] = int(parts[0], 16)
    return data, syms


def fixups(a, b):
    """Offsets of the words that moved with the base, and their types."""
    if len(a) != len(b):
        sys.exit("the two links differ in size")
    out = []
    moved = bytearray(a)
    i = 0
    while i + 4 <= len(a):
        wa, wb = struct.unpack_from(">I", a, i)[0], struct.unpack_from(">I", b, i)[0]
        if (wb - wa) & 0xffffffff == SHIFT:
            out.append((2 if wa >> 24 in (0x5a, 0x5e) else 3, i))
            struct.pack_into(">I", moved, i, wb)
            i += 4
        else:
            i += 2
    if bytes(moved) != b:
        bad = next(k for k in range(len(a)) if moved[k] != b[k])
        sys.exit("offset %x: a change the loader cannot make" % bad)
    return out


IMPORT_BASE = 0xF00000
# The libraries a program can import from: export N of LIBS[k] is at
# 0xf00000 + k * 0x10000 + N.
LIBS = ["ordinals", "CyWin.dl", "sound.dl"]


def imports(a, b, taken):
    """Calls of CyOS kernel exports: jsr @(0xf00000 + N). Returns the image
    with them turned into jsr @N, and their fixup records."""
    out = bytearray(a)
    recs = []
    for i in range(0, len(a) - 3, 2):
        if i in taken or i + 2 in taken or i - 2 in taken:
            continue
        w = struct.unpack_from(">I", a, i)[0]
        lib = ((w >> 16) & 0xFF) - (IMPORT_BASE >> 16)
        if w != struct.unpack_from(">I", b, i)[0] or not 0 <= lib < len(LIBS):
            continue
        if w >> 24 in (0x5E, 0x00) and (w & 0xFFFF) < 0x1000:
            # jsr @N, or the address of an export (a variable, a function)
            struct.pack_into(">I", out, i, (w & 0xFF000000) | (w & 0xFFFF))
            recs.append((lib, i))
    return bytes(out), recs


def module(at0, at1, entry):
    a, syms = image(at0)
    b, syms1 = image(at1)
    if entry not in syms:
        sys.exit("no symbol %s" % entry)
    bss = syms["__bss_end"] - syms["__bss_start"]
    if syms1["__bss_end"] - syms1["__bss_start"] != bss or len(a) < syms["__image_end"]:
        sys.exit("unexpected layout; link with player/link.ld")
    names = b"".join(n.encode() + b"\0" for n in LIBS)
    fx = fixups(a, b)
    a, calls = imports(a, b, {off for _, off in fx})
    fx += [(0x80 + lib, off) for lib, off in calls]
    recs = b"".join(struct.pack(">I", t << 24 | off) for t, off in sorted(fx, key=lambda r: r[1]))
    head = struct.pack(">HHIIIIII16x", 0x91AF, 2, len(a), bss, 0, len(names), len(recs), syms[entry])
    return head + a + names + recs


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    entry = sys.argv[sys.argv.index("--entry") + 1] if "--entry" in sys.argv else "_main"
    blob = module(sys.argv[1], sys.argv[2], entry)
    with open(sys.argv[3], "wb") as f:
        f.write(blob)
    print("%s: %d bytes" % (sys.argv[3], len(blob)))
