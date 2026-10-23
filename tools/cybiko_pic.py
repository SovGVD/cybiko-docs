#!/usr/bin/env python3
"""Cybiko pictures (.pic, four greys, and .xpic, 13 greys) to and from PNG.

    cybiko_pic.py info FILE.pic|.xpic        size and images
    cybiko_pic.py to-png FILE.pic OUT.png [--each]
    cybiko_pic.py from-image IN.png|.bmp|.pgm|.ppm OUT.pic|OUT.xpic [options]

to-png draws every image of the file at its place on one picture; with
--each it writes OUT-0.png, OUT-1.png, ... one per image instead.

from-image options:
    --size WxH        the picture's size (default: the input's, at most
                      160x100, the Cybiko's screen)
    --fit MODE        how a picture of another shape gets to that size:
                      "pad" (default) keeps all of it with white bars,
                      "crop" fills it, "stretch" ignores the shape
    --dither MODE     "fs" (Floyd-Steinberg, default) or "none"
    --brightness B    added to every pixel, -255 to 255 (default 0)
    --contrast C      multiplies the distance from mid grey (default 1.0)
    --gamma G         below 1 lightens, above 1 darkens (default 1.0)

Some applications also carry 1-bit pictures (black and white) in the same
container; info and to-png read those too.

The output's extension picks the kind: .pic (2 bits a pixel, white, light
grey, dark grey, black) or .xpic (4 bits a pixel, 13 greys, for Photo
Viewer). Input PNGs may be grey, RGB, with alpha (drawn on white) or with
a palette, 8 bits a channel or less; BMPs 8, 24 or 32 bits.

The format is described in file-formats.md of cybiko-docs
(https://github.com/SovGVD/cybiko-docs). Python 3, no extra packages.
"""
import argparse
import os
import struct
import sys
import zlib


# ---- the Cybiko formats ---------------------------------------------------------

def levels(bpp):
    return {1: 2, 2: 4, 4: 13}[bpp]


def load_pic(data):
    """(bpp, width, height, [(x, y, w, h, rows of pixel values)])."""
    if len(data) < 4:
        raise ValueError("too short for a picture")
    bpp, count, width, height = data[:4]
    if bpp not in (1, 2, 4):
        raise ValueError("%d bits a pixel: not a .pic (1 or 2) or .xpic (4)" % bpp)
    pos, images = 4, []
    for i in range(count):
        if pos + 4 > len(data):
            raise ValueError("image %d cut short" % i)
        x, y, w, h = data[pos:pos + 4]
        pos += 4
        stride = (w * bpp + 7) // 8
        if pos + stride * h > len(data):
            raise ValueError("image %d cut short" % i)
        rows = []
        for r in range(h):
            row = data[pos + r * stride:pos + (r + 1) * stride]
            if bpp == 1:
                px = [(row[c >> 3] >> (7 - (c & 7))) & 1 for c in range(w)]
            elif bpp == 2:
                px = [(row[c >> 2] >> (6 - 2 * (c & 3))) & 3 for c in range(w)]
            else:
                px = [(row[c >> 1] >> (4 - 4 * (c & 1))) & 15 for c in range(w)]
            rows.append(px)
        pos += stride * h
        images.append((x, y, w, h, rows))
    if pos < len(data):
        print("warning: %d bytes after the images ignored" % (len(data) - pos), file=sys.stderr)
    return bpp, width, height, images


def save_pic(bpp, images, width=None, height=None):
    """width and height (the whole picture's) default to what holds every
    image; files from Cybiko sometimes give other values there."""
    width = max(x + w for x, y, w, h, _ in images) if width is None else width
    height = max(y + h for x, y, w, h, _ in images) if height is None else height
    if width > 255 or height > 255 or len(images) > 255:
        raise ValueError("pictures are at most 255 x 255 and 255 images")
    out = bytearray([bpp, len(images), width, height])
    for x, y, w, h, rows in images:
        out += bytes([x, y, w, h])
        for row in rows:
            b = bytearray((w * bpp + 7) // 8)
            for c, v in enumerate(row):
                if bpp == 1:
                    b[c >> 3] |= v << (7 - (c & 7))
                elif bpp == 2:
                    b[c >> 2] |= v << (6 - 2 * (c & 3))
                else:
                    b[c >> 1] |= v << (4 - 4 * (c & 1))
            out += b
    return bytes(out)


def grey_of(v, bpp):
    """How light a pixel value looks: 0 white, the top value black."""
    top = levels(bpp) - 1
    if v > top:
        return 0          # 13-15 in an .xpic: Photo Viewer gets them wrong
    return round(255 - v * 255 / top)


# ---- PNG ------------------------------------------------------------------------

def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path, w, h, grey_rows):
    raw = b"".join(b"\0" + bytes(r) for r in grey_rows)
    png = (b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) +
           png_chunk(b"IDAT", zlib.compress(raw, 9)) + png_chunk(b"IEND", b""))
    open(path, "wb").write(png)


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def read_png(data):
    """Grey levels 0-255 as rows of floats (alpha drawn on white)."""
    pos, idat, plte, trns = 8, b"", None, None
    while pos < len(data):
        n, kind = struct.unpack_from(">I4s", data, pos)
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, inter = struct.unpack(">IIBBBBB", body)
        elif kind == b"PLTE":
            plte = [tuple(body[i:i + 3]) for i in range(0, len(body), 3)]
        elif kind == b"tRNS":
            trns = body
        elif kind == b"IDAT":
            idat += body
    if inter:
        raise ValueError("interlaced PNGs are not supported; save it without interlacing")
    if depth == 16:
        raise ValueError("16-bit PNGs are not supported; save it with 8 bits a channel")
    chans = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    bpp_bits = depth * chans
    stride = (w * bpp_bits + 7) // 8
    fb = max(1, bpp_bits // 8)
    raw = zlib.decompress(idat)
    prev = bytearray(stride)
    rows = []
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - fb] if i >= fb else 0
            b = prev[i]
            c = prev[i - fb] if i >= fb else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                line[i] = (line[i] + paeth(a, b, c)) & 255
        prev = line
        if depth < 8:
            vals = [(line[(x * depth) >> 3] >> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1)
                    for x in range(w * chans)]
        else:
            vals = list(line)
        out = []
        for x in range(w):
            px = vals[x * chans:(x + 1) * chans]
            alpha = 255
            if ctype == 3:
                r, g, b = plte[px[0]]
                if trns and px[0] < len(trns):
                    alpha = trns[px[0]]
            elif ctype in (0, 4):
                r = g = b = px[0] * 255 // ((1 << depth) - 1)
                if ctype == 4:
                    alpha = px[1]
            else:
                r, g, b = px[:3]
                if ctype == 6:
                    alpha = px[3]
            grey = 0.299 * r + 0.587 * g + 0.114 * b
            out.append(grey * alpha / 255 + 255 * (1 - alpha / 255))
        rows.append(out)
    return w, h, rows


def read_bmp(data):
    off, = struct.unpack_from("<I", data, 10)
    w, h, _, bits, comp = struct.unpack_from("<iiHHI", data, 18)
    if comp not in (0, 3) or bits not in (8, 24, 32):
        raise ValueError("only uncompressed 8, 24 or 32-bit BMPs are supported")
    pal = None
    if bits == 8:
        hs, = struct.unpack_from("<I", data, 14)
        pal = [data[14 + hs + 4 * i:14 + hs + 4 * i + 3] for i in range(256)]
    stride = (w * bits // 8 + 3) & ~3
    rows = []
    for y in range(abs(h)):
        line = data[off + y * stride:off + (y + 1) * stride]
        out = []
        for x in range(w):
            if bits == 8:
                b, g, r = pal[line[x]]
            else:
                b, g, r = line[x * bits // 8:x * bits // 8 + 3]
            out.append(0.299 * r + 0.587 * g + 0.114 * b)
        rows.append(out)
    if h > 0:
        rows.reverse()
    return w, abs(h), rows


def read_pnm(data):
    parts, pos = [], 2
    while len(parts) < 3:
        while data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b"#":
            pos = data.index(b"\n", pos)
            continue
        start = pos
        while not data[pos:pos + 1].isspace():
            pos += 1
        parts.append(int(data[start:pos]))
    w, h, maxv = parts
    pos += 1
    chans = 3 if data[:2] == b"P6" else 1
    if maxv > 255:
        raise ValueError("16-bit PGM/PPM files are not supported")
    px = data[pos:pos + w * h * chans]
    rows = []
    for y in range(h):
        line = px[y * w * chans:(y + 1) * w * chans]
        if chans == 1:
            rows.append([v * 255 / maxv for v in line])
        else:
            rows.append([(0.299 * line[i] + 0.587 * line[i + 1] + 0.114 * line[i + 2]) * 255 / maxv
                         for i in range(0, len(line), 3)])
    return w, h, rows


def read_image(path):
    data = open(path, "rb").read()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return read_png(data)
    if data[:2] == b"BM":
        return read_bmp(data)
    if data[:2] in (b"P5", b"P6"):
        return read_pnm(data)
    raise ValueError("not a PNG, BMP, PGM or PPM file")


# ---- picture to Cybiko ------------------------------------------------------------

def resize(rows, w, h, tw, th, fit):
    """Area-average resize to tw x th; pad with white or crop as asked."""
    if fit == "stretch":
        sx, sy, ox, oy, cw, ch = w / tw, h / th, 0, 0, tw, th
    else:
        s = max(w / tw, h / th) if fit == "pad" else min(w / tw, h / th)
        cw, ch = min(tw, round(w / s)), min(th, round(h / s))
        sx = sy = s
        ox, oy = (tw - cw) // 2, (th - ch) // 2
        if fit == "crop":
            ox = oy = 0
    out = [[255.0] * tw for _ in range(th)]
    x0 = (w - cw * sx) / 2
    y0 = (h - ch * sy) / 2
    for y in range(ch):
        ya, yb = y0 + y * sy, y0 + (y + 1) * sy
        for x in range(cw):
            xa, xb = x0 + x * sx, x0 + (x + 1) * sx
            tot = area = 0.0
            for yy in range(int(ya), max(int(ya) + 1, min(h, int(yb + 0.999)))):
                fy = min(yb, yy + 1) - max(ya, yy)
                for xx in range(int(xa), max(int(xa) + 1, min(w, int(xb + 0.999)))):
                    fx = min(xb, xx + 1) - max(xa, xx)
                    a = max(fx, 0) * max(fy, 0) or 1e-9
                    tot += rows[min(yy, h - 1)][min(xx, w - 1)] * a
                    area += a
            out[oy + y][ox + x] = tot / area
    return out


def quantise(rows, n, dither):
    """Grey 0-255 (white 255) to values 0 (white) .. n-1 (black)."""
    h, w = len(rows), len(rows[0])
    buf = [[255 - v for v in r] for r in rows]       # darkness
    out = []
    for y in range(h):
        line = []
        for x in range(w):
            d = min(255.0, max(0.0, buf[y][x]))
            v = int(d * (n - 1) / 255 + 0.5)
            line.append(v)
            if dither == "fs":
                err = d - v * 255 / (n - 1)
                if x + 1 < w:
                    buf[y][x + 1] += err * 7 / 16
                if y + 1 < h:
                    if x:
                        buf[y + 1][x - 1] += err * 3 / 16
                    buf[y + 1][x] += err * 5 / 16
                    if x + 1 < w:
                        buf[y + 1][x + 1] += err / 16
        out.append(line)
    return out


def main(argv):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog=__doc__.split("\n\n", 1)[1])
    p.add_argument("command", choices=["info", "to-png", "from-image"])
    p.add_argument("input")
    p.add_argument("output", nargs="?")
    p.add_argument("--each", action="store_true")
    p.add_argument("--size")
    p.add_argument("--fit", choices=["pad", "crop", "stretch"], default="pad")
    p.add_argument("--dither", choices=["fs", "none"], default="fs")
    p.add_argument("--brightness", type=float, default=0)
    p.add_argument("--contrast", type=float, default=1.0)
    p.add_argument("--gamma", type=float, default=1.0)
    a = p.parse_args(argv[1:])
    if a.command != "info" and not a.output:
        p.error("%s needs an output file" % a.command)
    try:
        if a.command == "from-image":
            ext = os.path.splitext(a.output)[1].lower()
            if ext not in (".pic", ".xpic"):
                raise ValueError("the output must end in .pic or .xpic")
            bpp = 2 if ext == ".pic" else 4
            w, h, rows = read_image(a.input)
            if a.size:
                tw, th = (int(v) for v in a.size.lower().split("x"))
            else:
                s = max(w / 160, h / 100, 1)
                tw, th = max(1, round(w / s)), max(1, round(h / s))
            if not (0 < tw <= 255 and 0 < th <= 255):
                raise ValueError("pictures are 1-255 pixels each way")
            if (tw, th) != (w, h):
                rows = resize(rows, w, h, tw, th, a.fit)
            rows = [[255 * (min(255, max(0, (v - 128) * a.contrast + 128 + a.brightness)) / 255)
                     ** a.gamma for v in r] for r in rows]
            px = quantise(rows, levels(bpp), a.dither)
            open(a.output, "wb").write(save_pic(bpp, [(0, 0, tw, th, px)]))
            print("%s: %d x %d, %d greys" % (a.output, tw, th, levels(bpp)))
            return 0
        bpp, width, height, images = load_pic(open(a.input, "rb").read())
        bad = sum(v > levels(bpp) - 1 for _, _, _, _, rows in images for r in rows for v in r)
        if bad:
            print("warning: %d pixels have values 13-15, which Photo Viewer can't show "
                  "(drawn black)" % bad, file=sys.stderr)
        if a.command == "info":
            kind = {1: ".pic (black and white)", 2: ".pic (4 greys)", 4: ".xpic (13 greys)"}[bpp]
            print("%s, %d x %d, %d image(s)" % (kind,
                                                width, height, len(images)))
            for i, (x, y, w, h, _) in enumerate(images):
                print("  image %d: %d x %d at %d, %d" % (i, w, h, x, y))
        elif a.each:
            base, ext = os.path.splitext(a.output)
            for i, (x, y, w, h, rows) in enumerate(images):
                write_png("%s-%d%s" % (base, i, ext or ".png"), w, h,
                          [[grey_of(v, bpp) for v in r] for r in rows])
        else:
            canvas = [[255] * width for _ in range(height)]
            for x, y, w, h, rows in images:
                for r, row in enumerate(rows):
                    for c, v in enumerate(row):
                        if y + r < height and x + c < width:
                            canvas[y + r][x + c] = grey_of(v, bpp)
            write_png(a.output, width, height, canvas)
    except (ValueError, OSError, KeyError, struct.error, zlib.error) as e:
        sys.exit("%s: %s" % (a.input, e))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
