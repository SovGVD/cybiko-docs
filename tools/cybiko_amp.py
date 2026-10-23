#!/usr/bin/env python3
"""Cybiko sound envelopes (.amp) and their text source (.a), as Cybiko
Converter reads and writes them.

    cybiko_amp.py info FILE.amp            header and points
    cybiko_amp.py to-text FILE.amp [OUT.a] the envelope as Converter's text
    cybiko_amp.py from-text IN.a OUT.amp   and back (what Converter does)

An envelope shapes the loudness of the notes of a version 2 melody (see
cybiko_music.py). CyOS's melody player keeps 60 of them, 1.amp to 60.amp;
a melody picks one by number.

The text form is Converter's own (its template, with comments):

    Version   0      ; format version for the .amp file
    Tdiscret  1.000  ; time between points, in milliseconds
          0.0        ; the start point
    1     1.0        ; 1 point on: 1.0
    3     0.0        ; 3 points on: 0.0, the points between drawn in a line
    end

Each line after the header is an optional step (1 if left out) and a level
from 0.0 to 1.0. A step of more than 1 fills the points before it with a
straight line from the previous level. ';' starts a comment.

The format is described in file-formats.md of cybiko-docs
(https://github.com/SovGVD/cybiko-docs). Python 3, no extra packages.
"""
import struct
import sys


def load(data):
    if len(data) < 5:
        raise ValueError("too short for an envelope")
    version, t, n = data[0], *struct.unpack_from(">HH", data, 1)
    if len(data) < 5 + 2 * n:
        raise ValueError("cut short: %d points announced, %d there" % (n, (len(data) - 5) // 2))
    if len(data) > 5 + 2 * n:
        print("warning: %d bytes after the points ignored" % (len(data) - 5 - 2 * n), file=sys.stderr)
    return version, t, list(struct.unpack_from(">%dH" % n, data, 5))


def save(version, t, points):
    if not points:
        raise ValueError("an envelope needs at least one point")
    if len(points) > 0xFFFF:
        raise ValueError("too many points")
    if t == 0 and len(points) > 1:
        raise ValueError("Tdiscret 0 is only allowed with one point (as in Converter)")
    return bytes([version]) + struct.pack(">HH", t, len(points)) + struct.pack(">%dH" % len(points), *points)


def expand(keys):
    """Converter's expansion of (level, step) pairs into points."""
    out = []
    prev = keys[0][0]
    for v, step in keys:
        if step < 2:
            out.append(v)
        else:
            diff = v - prev
            out += [prev + int(diff * k / step) for k in range(1, step + 1)]
        prev = v
    return out


def compress(points):
    """The shortest (level, step) list that expands back to exactly these
    points: runs that lie on Converter's straight lines become one line."""
    keys = [(points[0], 1)]
    i = 1
    while i < len(points):
        prev = points[i - 1]
        best = 1
        for step in range(len(points) - i, 1, -1):
            v = points[i + step - 1]
            if all(points[i + k - 1] == prev + int((v - prev) * k / step) for k in range(1, step + 1)):
                best = step
                break
        keys.append((points[i + best - 1], best))
        i += best
    return keys


def level(v):
    s = "%.6f" % (v / 65535)
    s = s.rstrip("0")
    return s + "0" if s.endswith(".") else s


def to_text(version, t, points):
    lines = [";", "; Cybiko sound envelope (cybiko_amp.py), Cybiko Converter's .a format",
             ";", "Version   %d" % version, "Tdiscret  %.3f" % (t / 1000), ";"]
    keys = compress(points)
    for i, (v, step) in enumerate(keys):
        # levels are written so that Converter's rounding gives the same value
        lines.append("      %s" % level(v) if i == 0 else "%-5d %s" % (step, level(v)))
    lines.append("end")
    return "\r\n".join(lines) + "\r\n"


def from_text(text):
    version, t, keys = 0, None, []
    for no, raw in enumerate(text.splitlines(), 1):
        line = raw.split(";")[0].strip()
        if not line:
            continue
        w = line.split()
        k = w[0].lower()
        try:
            if k == "version":
                version = int(w[1])
                if not 0 <= version <= 255:
                    raise ValueError("version out of range")
            elif k == "tdiscret":
                t = round(float(w[1]) * 1000)
                if not 0 <= t <= 0xFFFF:
                    raise ValueError("Tdiscret must be 0 to 65.535 ms")
            elif k == "end":
                break
            else:
                step, val = (1, w[0]) if len(w) == 1 else (int(w[0]), w[1])
                v = int(float(val) * 65535 + 0.5)
                if step < 1 or step > 0xFFFF or not 0 <= v <= 0xFFFF:
                    raise ValueError("bad step or level (levels are 0.0 to 1.0)")
                keys.append((v, step))
        except (IndexError, ValueError) as e:
            raise ValueError("line %d: %s: %s" % (no, raw.strip(), e))
    if t is None:
        raise ValueError("no Tdiscret line")
    if not keys:
        raise ValueError("no points")
    return version, t, expand(keys)


def main(argv):
    if len(argv) < 3 or argv[1] not in ("info", "to-text", "from-text") or \
            argv[1] == "from-text" and len(argv) < 4:
        sys.exit(__doc__)
    cmd, src = argv[1], argv[2]
    out = argv[3] if len(argv) > 3 else None
    try:
        if cmd == "from-text":
            version, t, points = from_text(open(src, encoding="latin-1").read())
            open(out, "wb").write(save(version, t, points))
            return 0
        version, t, points = load(open(src, "rb").read())
        if cmd == "info":
            print("version %d, %d points %d us apart (%.1f ms long)" % (
                version, len(points), t, (len(points) - 1) * t / 1000))
            print(" ".join(level(v) for v in points))
        else:
            text = to_text(version, t, points)
            if out:
                open(out, "w", encoding="latin-1", newline="").write(text)
            else:
                sys.stdout.write(text)
    except (ValueError, OSError) as e:
        sys.exit("%s: %s" % (src, e))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
