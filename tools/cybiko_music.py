#!/usr/bin/env python3
"""Cybiko melodies (.mus, .music): read, write, convert to and from MIDI,
and play them into a WAV file the way the Cybiko Xtreme sounds.

    cybiko_music.py info FILE.music               header and length
    cybiko_music.py to-text FILE.music [OUT.txt]  the melody as editable text
    cybiko_music.py from-text IN.txt OUT.music    and back
    cybiko_music.py to-midi FILE.music OUT.mid    a one-track MIDI file
    cybiko_music.py from-midi IN.mid OUT.music [options]
    cybiko_music.py to-wav FILE.music OUT.wav [--amp-dir DIR] [--rate HZ]

from-midi options (the same choices as Cybiko Converter's music box):
    --tracks 1,3       the MIDI tracks to keep, counted from 0 (default all)
    --transpose N      shift every note by N semitones
    --style high|last  when notes overlap, play the highest one (default) or
                       the one pressed last
    --version 0|1|2    the file version to write (default 1, as Converter)
    --envelope N --pulse US --volume V
                       version 2 only: the sound envelope (N.amp, 0 for
                       none), its pulse time in microseconds and the volume
                       0-255 (defaults 0, 1000 and 128)

The text form, one item a line (';' or a '#' after a space starts a
comment):

    version 2          0, 1 or 2 (version 2 has the four lines below)
    pulse 1703         envelope pulse time, microseconds
    volume 10          0-255
    envelope 34        N.amp of CyOS's melody player, 0 for none
    C#5 10             a note (C4 is MIDI note 60) and its length in
                       ticks of 10 ms (1-255)
    rest 5             silence
    glide D5           after a note: slide to D5 over the note's length
    vibrato 2          after a note: wobble up to 2 semitones around it
    loop 0 3           start of a part played 3 + 1 times (slots 0-4)
    next 0             end of that part
    raw 0x1c 4         any two bytes as they are

to-wav needs the envelopes of version 2 files: CyOS keeps them as 1.amp to
60.amp in the archive of its melody player (mplayer.app, in the flash);
pass the folder they are in with --amp-dir, or the notes play without one.

The format is described in file-formats.md of cybiko-docs
(https://github.com/SovGVD/cybiko-docs). Python 3, no extra packages.
"""
import argparse
import math
import os
import re
import struct
import sys
import wave

TICK_US = 10000                  # one tick of a note's length
TIMER_HZ = 2304000               # the sound timer: 18.432 MHz / 8
PERIODS = [0x44CCF, 0x40F07, 0x3D4B6, 0x39DAB, 0x369B7, 0x338AD,
           0x30A64, 0x2DEB4, 0x2B578, 0x28E8C, 0x269CF, 0x24722]
LOWEST, HIGHEST = 29, 127        # the notes the player has periods for
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
REST, VIBRATO, GLIDE, LOOP0 = 0xFF, 0xF8, 0xF9, 0xFA


# ---- notes ----------------------------------------------------------------

def note_name(n):
    return "%s%d" % (NAMES[n % 12], n // 12 - 1)


def parse_note(s):
    s = s.strip()
    for name in sorted(NAMES, key=len, reverse=True):
        if s.upper().startswith(name):
            rest = s[len(name):]
            try:
                n = NAMES.index(name) + 12 * (int(rest) + 1)
            except ValueError:
                break
            if 0 <= n <= 127:
                return n
    raise ValueError("not a note: %r (write it like C4, F#3 or A5)" % s)


def byte_to_note(b):
    """The player's two note codes: 0-43 hex are MIDI notes 41-108 (the
    version 0 files), 44-c3 are MIDI notes 0-127."""
    return b + 41 if b <= 0x43 else b - 0x44


def note_to_byte(n, version):
    if version == 0:
        if not 41 <= n <= 108:
            raise ValueError("%s is out of range for version 0 (F2 to C8)" % note_name(n))
        return n - 41
    return n + 0x44


def period(n):
    """The sound timer's period for MIDI note n, 0xffff if it has none."""
    if not LOWEST <= n <= HIGHEST:
        return 0xFFFF
    return PERIODS[n % 12] >> (n // 12)


# ---- the file ---------------------------------------------------------------

class Melody:
    def __init__(self, version=1, pulse=1000, volume=128, envelope=0, events=None):
        self.version, self.pulse, self.volume, self.envelope = version, pulse, volume, envelope
        self.events = events or []          # [(byte, byte)]


def load(data):
    if len(data) < 4:
        raise ValueError("too short for a melody")
    version, one, size = data[0], data[1], struct.unpack_from(">H", data, 2)[0]
    if version > 2 or one != 1:
        raise ValueError("not a Cybiko melody (version %d, second byte %d)" % (version, one))
    m = Melody(version)
    pos = 4
    if version == 2:
        if len(data) < 9:
            raise ValueError("version 2 header cut short")
        m.pulse, m.volume, m.envelope = struct.unpack_from(">HBH", data, 4)
        pos = 9
    if size == 0 or size % 2:
        raise ValueError("bad event size %d (the player wants an even, non-zero size)" % size)
    body = data[pos:pos + size]
    if len(body) < size:
        raise ValueError("file cut short: %d of %d event bytes" % (len(body), size))
    if len(data) > pos + size:
        print("warning: %d bytes after the events ignored" % (len(data) - pos - size), file=sys.stderr)
    m.events = [(body[i], body[i + 1]) for i in range(0, size, 2)]
    return m


def save(m):
    body = bytes(b for e in m.events for b in e)
    if not body:
        raise ValueError("a melody needs at least one event")
    if len(body) > 0xFFFF:
        raise ValueError("too many events")
    out = bytes([m.version, 1]) + struct.pack(">H", len(body))
    if m.version == 2:
        out += struct.pack(">HBH", m.pulse, m.volume, m.envelope)
    return out + body


# ---- text -------------------------------------------------------------------

def to_text(m):
    lines = ["# Cybiko melody (cybiko_music.py); lengths in ticks of 10 ms",
             "version %d" % m.version]
    if m.version == 2:
        lines += ["pulse %d" % m.pulse, "volume %d" % m.volume, "envelope %d" % m.envelope]
    old = m.version == 0
    for a, b in m.events:
        if a == REST:
            lines.append("rest %d" % b)
        elif a == VIBRATO:
            lines.append("vibrato %d" % b)
        elif a == GLIDE and (b <= 0x43) == old and b <= 0xC3:
            lines.append("glide %s" % note_name(byte_to_note(b)))
        elif LOOP0 <= a <= 0xFE:
            lines.append("loop %d %d" % (a - LOOP0, b) if b else "next %d" % (a - LOOP0))
        elif a <= 0xC3 and (a <= 0x43) == old and b:
            lines.append("%s %d" % (note_name(byte_to_note(a)), b))
        else:
            lines.append("raw 0x%02x %d" % (a, b))
    return "\n".join(lines) + "\n"


def from_text(text):
    m = Melody(version=None)
    body = []
    for no, line in enumerate(text.splitlines(), 1):
        line = re.split(r"(?:^|\s)#", line.split(";")[0])[0].strip()
        if not line:
            continue
        w = line.split()
        k = w[0].lower()
        try:
            def num(s, lo, hi):
                v = int(s, 0)
                if not lo <= v <= hi:
                    raise ValueError("%s is out of range %d-%d" % (s, lo, hi))
                return v
            if k in ("version", "pulse", "volume", "envelope"):
                lim = {"version": 2, "pulse": 0xFFFF, "volume": 255, "envelope": 0xFFFF}[k]
                setattr(m, k, num(w[1], 0, lim))
            else:
                body.append((no, k, w[1:]))
        except (IndexError, ValueError) as e:
            raise ValueError("line %d: %s" % (no, e or "missing value"))
    if m.version is None:
        m.version = 1
    for no, k, args in body:
        try:
            if k == "rest":
                m.events.append((REST, num(args[0], 1, 255)))
            elif k == "vibrato":
                m.events.append((VIBRATO, num(args[0], 0, 255)))
            elif k == "glide":
                m.events.append((GLIDE, note_to_byte(parse_note(args[0]), m.version)))
            elif k == "loop":
                m.events.append((LOOP0 + num(args[0], 0, 4), num(args[1], 1, 255)))
            elif k == "next":
                m.events.append((LOOP0 + num(args[0], 0, 4), 0))
            elif k == "raw":
                m.events.append((num(args[0], 0, 255), num(args[1], 0, 255)))
            else:
                m.events.append((note_to_byte(parse_note(k), m.version), num(args[0], 1, 255)))
        except (IndexError, ValueError) as e:
            raise ValueError("line %d: %s" % (no, e or "missing value"))
    return m


# ---- playing it, the way CyOS's melody player does ------------------------------

def play(m):
    """What the speaker does: a list of (ticks, [timer periods, one per
    tick], envelope restart flag), silence as period 0. Loops are unrolled."""
    out = []
    ev, i, loops = m.events, 0, [[0, 0] for _ in range(5)]
    steps = 0
    while i < len(ev):
        steps += 1
        if steps > 1000000:
            print("warning: stopped after a million events (a loop that never ends?)", file=sys.stderr)
            break
        a, b = ev[i]
        if LOOP0 <= a <= 0xFE:
            slot = loops[a - LOOP0]
            if b:
                slot[0], slot[1] = b, i + 1
                i += 1
            else:
                left = slot[0]
                slot[0] = (left - 1) & 0xFFFF
                i = slot[1] if left else i + 1
            continue
        if a in (VIBRATO, GLIDE):          # a modifier with no note before it
            i += 1
            continue
        ticks = b if b else 0x10000        # 0 counts down from 65536
        if a == REST:
            out.append((ticks, [0] * ticks))
            i += 1
            continue
        pc = period(byte_to_note(a)) if a <= 0xC3 else 0xFFFF
        if a > 0xC3:
            print("warning: byte %02x is not a note; the player plays it as its lowest tone" % a,
                  file=sys.stderr)
        tone = [pc] * ticks
        if i + 1 < len(ev) and ev[i + 1][0] == GLIDE:
            pt = period(byte_to_note(ev[i + 1][1]))
            tone = [pc] + [pc + int((pt - pc) * j / ticks) for j in range(1, ticks)]
            i += 1
        elif i + 1 < len(ev) and ev[i + 1][0] == VIBRATO:
            d = ev[i + 1][1]
            if d:
                n = byte_to_note(a)
                lo, hi = period(n - d), period(min(n + d, 127))
                for _ in range(3):
                    lo, hi = (lo + pc) >> 1, (hi + pc) >> 1
                table = [(lo + pc) >> 1, lo, (lo + pc) >> 1, pc, (pc + hi) >> 1, hi, (pc + hi) >> 1, pc]
                tone = [pc] + [table[(k & 15) >> 1] for k in range(ticks - 1)]
            i += 1
        out.append((ticks, tone))
        i += 1
    return out


def load_amp(path):
    d = open(path, "rb").read()
    t, n = struct.unpack_from(">HH", d, 1)
    return t, list(struct.unpack_from(">%dH" % n, d, 5))


def envelope(m, amp_dir):
    """The pulse widths in timer ticks, one per pulse; None for a plain
    square wave (versions 0 and 1)."""
    if m.version != 2:
        return None
    x, vol = m.pulse, m.volume
    if not m.envelope:
        return [(0x1200 * x // 1000 * vol >> 8) & 0xFFFF] if x else None
    path = os.path.join(amp_dir or ".", "%d.amp" % m.envelope)
    if not os.path.exists(path):
        print("warning: %s not found, playing without the envelope" % path, file=sys.stderr)
        return None
    t, pts = load_amp(path)
    if not t:
        t = x
    if not x:
        x = t
    if not pts or not x:
        return None
    count = ((len(pts) - 1) * t + x - 1) // x + 1
    scale = (0x900 * x // 1000) * vol >> 8
    env = []
    for k in range(count):
        at = k * x
        j = min(at // t, len(pts) - 1) if t else len(pts) - 1
        if j + 1 < len(pts) and t:
            a, b = pts[j] >> 1, pts[j + 1] >> 1
            v = a + (b - a) * (at - j * t) // t
        else:
            v = pts[j] >> 1
        env.append(max(scale * v >> 15, 10))
    return env


def render(m, rate, amp_dir):
    """Samples of the speaker: a pulse wave whose high time comes from the
    envelope (one value per pulse, the last one held), or a square wave."""
    env = envelope(m, amp_dir)
    out = bytearray()
    step = TIMER_HZ / rate                      # timer ticks a sample
    done = 0                                    # note ticks so far
    for ticks, tone in play(m):
        t, k = 0.0, 0                           # every note restarts its pulses
        for p in tone:
            done += 1
            for _ in range(round(done * rate * TICK_US / 1e6) - len(out)):
                if not p:
                    out.append(128)
                    continue
                high = env[min(k, len(env) - 1)] if env else (p + 1) // 2
                out.append(200 if t < high else 56)
                t += step
                if t >= p + 1:
                    t -= p + 1
                    k += 1
    return bytes(out)


# ---- MIDI ---------------------------------------------------------------------

def read_vlq(d, i):
    v = 0
    while True:
        b = d[i]
        i += 1
        v = v << 7 | b & 0x7F
        if not b & 0x80:
            return v, i


def read_midi(data):
    """Note-on and note-off times in microseconds, per track:
    [[(us, on, note, velocity)]], and the track names."""
    if data[:4] != b"MThd":
        raise ValueError("not a MIDI file (no MThd)")
    hl, fmt, ntrk, div = struct.unpack_from(">IHHH", data, 4)
    if div & 0x8000:
        raise ValueError("SMPTE time in MIDI files is not supported")
    pos = 8 + hl
    tracks, tempo_map, names = [], [], []
    raw = []
    for _ in range(ntrk):
        if data[pos:pos + 4] != b"MTrk":
            raise ValueError("bad MIDI track header")
        size = struct.unpack_from(">I", data, pos + 4)[0]
        d = data[pos + 8:pos + 8 + size]
        pos += 8 + size
        i, tick, status, evs, name = 0, 0, 0, [], ""
        while i < len(d):
            delta, i = read_vlq(d, i)
            tick += delta
            b = d[i]
            if b == 0xFF:
                kind = d[i + 1]
                ln, j = read_vlq(d, i + 2)
                body = d[j:j + ln]
                i = j + ln
                if kind == 0x51 and ln == 3:
                    tempo_map.append((tick, int.from_bytes(body, "big")))
                elif kind == 3 and not name:
                    name = body.decode("latin-1")
                elif kind == 0x2F:
                    break
                continue
            if b in (0xF0, 0xF7):
                ln, j = read_vlq(d, i + 1)
                i = j + ln
                continue
            if b & 0x80:
                status = b
                i += 1
            hi = status & 0xF0
            n = 1 if hi in (0xC0, 0xD0) else 2
            args = d[i:i + n]
            i += n
            if hi == 0x90 and args[1]:
                evs.append((tick, 1, args[0], args[1], status & 15))
            elif hi == 0x80 or hi == 0x90:
                evs.append((tick, 0, args[0], 0, status & 15))
        raw.append(evs)
        names.append(name)
    tempo_map.sort()

    def us(tick):
        t, last_tick, tempo = 0, 0, 500000
        for at, tp in tempo_map:
            if at >= tick:
                break
            t += (at - last_tick) * tempo / div
            last_tick, tempo = at, tp
        return t + (tick - last_tick) * tempo / div

    for evs in raw:
        tracks.append([(us(t), on, note, vel, ch) for t, on, note, vel, ch in evs])
    return tracks, names


def vlq(v):
    out = [v & 0x7F]
    v >>= 7
    while v:
        out.append(0x80 | v & 0x7F)
        v >>= 7
    return bytes(reversed(out))


def to_midi(m):
    """One track; a quarter note of 100 ticks at 60 bpm, so one MIDI tick is
    one 10 ms tick of the melody. Glides and vibrato become pitch bends (with
    a bend range of 12 semitones), loops are unrolled."""
    vel = 100 if m.version != 2 else max(1, min(127, m.volume * 127 // 255))
    notes = {period(c): c for c in range(HIGHEST, LOWEST - 1, -1)}
    evs = [(0, b"\xff\x51\x03" + (1000000).to_bytes(3, "big")),
           (0, b"\xff\x03\x0cCybiko music"),
           (0, bytes([0xB0, 101, 0])), (0, bytes([0xB0, 100, 0])), (0, bytes([0xB0, 6, 12])),
           (0, bytes([0xC0, 80]))]                # square lead
    now, missing = 0, 0
    for ticks, tone in play(m):
        p0 = tone[0]
        n = notes.get(p0)
        if p0 and n is None:
            missing += 1
        if p0 and n is not None:
            evs.append((now, bytes([0x90, n, vel])))
            last = p0
            for j, p in enumerate(tone[1:], 1):
                if p != last:
                    semis = 12 * math.log2(p0 / p)
                    bend = max(0, min(16383, round(8192 + semis / 12 * 8192)))
                    evs.append((now + j, bytes([0xE0, bend & 0x7F, bend >> 7])))
                    last = p
            evs.append((now + ticks, bytes([0x80, n, 0])))
            if last != p0:
                evs.append((now + ticks, bytes([0xE0, 0, 64])))
        now += ticks
    if missing:
        print("warning: %d tones the player has no note for were left out" % missing, file=sys.stderr)
    body, at = bytearray(), 0
    for t, e in evs + [(now, b"\xff\x2f\x00")]:
        body += vlq(t - at) + e
        at = t
    return (b"MThd" + struct.pack(">IHHH", 6, 0, 1, 100) +
            b"MTrk" + struct.pack(">I", len(body)) + bytes(body))


def from_midi(data, tracks=None, transpose=0, style="high", version=1,
              envelope_no=0, pulse=1000, volume=128):
    trk, names = read_midi(data)
    keep = range(len(trk)) if tracks is None else tracks
    evs = []
    for k in keep:
        if not 0 <= k < len(trk):
            raise ValueError("there is no track %d (the file has %d)" % (k, len(trk)))
        evs += [(t, on, note, ch, k) for t, on, note, vel, ch in trk[k] if ch != 9]  # not drums
    evs.sort(key=lambda e: (e[0], e[1]))         # offs before ons at the same time
    held = []                                    # (note, channel, track) in press order
    line = []                                    # (start us, note or None)
    skipped = [0, 0]

    def now_playing():
        if not held:
            return None
        return max(h[0] for h in held) if style == "high" else held[-1][0]

    for t, on, note, ch, k in evs:
        n = note + transpose
        if on:
            if n > 127:
                skipped[0] += 1
                continue
            if n < 0:
                skipped[1] += 1
                continue
            held.append((n, ch, k))
        else:
            for h in range(len(held) - 1, -1, -1):
                if held[h] == (n, ch, k):
                    del held[h]
                    break
        p = now_playing()
        if line and line[-1][0] == t:
            line[-1] = (t, p)
        elif not line or line[-1][1] != p:
            line.append((t, p))
    if skipped[0] or skipped[1]:
        print("warning: %d notes over 127 and %d under 0 after transposing were left out"
              % tuple(skipped), file=sys.stderr)
    m = Melody(version, pulse, volume, envelope_no)
    low = 0
    for (t, n), (t2, _) in zip(line, line[1:]):
        ticks = round(t2 / TICK_US) - round(t / TICK_US)
        if ticks <= 0:
            continue
        if n is not None and not (LOWEST <= n <= HIGHEST and (version or 41 <= n <= 108)):
            low += 1
            n = None
        code = REST if n is None else note_to_byte(n, version)
        if not m.events and code == REST:
            continue                              # no silence before the first note
        if m.events and code == REST and m.events[-1][0] == REST and m.events[-1][1] + ticks <= 255:
            m.events[-1] = (REST, m.events[-1][1] + ticks)
            continue
        while ticks > 255:
            m.events.append((code, 255))
            ticks -= 255
        m.events.append((code, ticks))
    while m.events and m.events[-1][0] == REST:
        m.events.pop()
    if low:
        print("warning: %d notes the Cybiko can't play (below F1, or out of F2-C8 for "
              "version 0) became rests" % low, file=sys.stderr)
    if not m.events:
        raise ValueError("no notes in the chosen tracks")
    return m


# ---- the command line -------------------------------------------------------------

def write_wav(path, samples, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(samples)


def main(argv):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter,
                                epilog=__doc__.split("\n\n", 1)[1])
    p.add_argument("command", choices=["info", "to-text", "from-text", "to-midi", "from-midi", "to-wav"])
    p.add_argument("input")
    p.add_argument("output", nargs="?")
    p.add_argument("--tracks")
    p.add_argument("--transpose", type=int, default=0)
    p.add_argument("--style", choices=["high", "last"], default="high")
    p.add_argument("--version", type=int, choices=[0, 1, 2], default=1)
    p.add_argument("--envelope", type=int, default=0)
    p.add_argument("--pulse", type=int, default=1000)
    p.add_argument("--volume", type=int, default=128)
    p.add_argument("--amp-dir")
    p.add_argument("--rate", type=int, default=22050)
    a = p.parse_args(argv[1:])
    need_out = a.command not in ("info", "to-text")
    if need_out and not a.output:
        p.error("%s needs an output file" % a.command)
    try:
        if a.command == "from-text":
            m = from_text(open(a.input, encoding="utf-8").read())
            open(a.output, "wb").write(save(m))
            return 0
        if a.command == "from-midi":
            tracks = [int(x) for x in a.tracks.split(",")] if a.tracks else None
            m = from_midi(open(a.input, "rb").read(), tracks, a.transpose, a.style, a.version,
                          a.envelope, a.pulse, a.volume)
            open(a.output, "wb").write(save(m))
            secs = sum(t for t, _ in play(m)) / 100
            print("%s: %d events, %.1f s" % (a.output, len(m.events), secs))
            return 0
        m = load(open(a.input, "rb").read())
        if a.command == "info":
            secs = sum(t for t, _ in play(m)) / 100
            print("version %d, %d events, %.2f s" % (m.version, len(m.events), secs))
            if m.version == 2:
                print("pulse %d us, volume %d, envelope %s" % (
                    m.pulse, m.volume, "%d.amp" % m.envelope if m.envelope else "none"))
        elif a.command == "to-text":
            text = to_text(m)
            if a.output:
                open(a.output, "w", encoding="utf-8").write(text)
            else:
                sys.stdout.write(text)
        elif a.command == "to-midi":
            open(a.output, "wb").write(to_midi(m))
        elif a.command == "to-wav":
            write_wav(a.output, render(m, a.rate, a.amp_dir), a.rate)
    except (ValueError, OSError, struct.error) as e:
        sys.exit("%s: %s" % (a.input, e))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
