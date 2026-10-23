#!/usr/bin/env python3
"""Sound recordings for the Cybiko Xtreme: the .wav files CyRecord and
CyTalk make (IMA ADPCM, 8000 Hz, mono), to and from ordinary WAV files.

    cybiko_wav.py info FILE.wav            what the file holds
    cybiko_wav.py to-pcm FILE.wav OUT.wav  a Cybiko recording as 16-bit PCM
    cybiko_wav.py to-cybiko IN.wav OUT.wav [--gain G]
                                           any PCM WAV (8 or 16-bit, any rate,
                                           mono or stereo) as a Cybiko recording

to-cybiko mixes to mono, resamples to 8000 Hz (linear, after a short
averaging filter) and encodes IMA ADPCM in 256-byte blocks of 505 samples,
with the same header CyOS's sound library writes. --gain multiplies the
level first (default 1.0). Put the result on the Cybiko's disk and open it
in CyRecord.

The format is described in file-formats.md of cybiko-docs
(https://github.com/SovGVD/cybiko-docs). Python 3, no extra packages.
"""
import struct
import sys

RATE, BLOCK, PER_BLOCK = 8000, 256, 505

STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50,
         55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279,
         307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282,
         1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
         5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
         18500, 20350, 22385, 24623, 27086, 29794, 32767]
INDEX = [-1, -1, -1, -1, 2, 4, 6, 8]


def chunks(data):
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV file")
    pos, out = 12, {}
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack_from("<I", data, pos + 4)[0]
        out.setdefault(cid, data[pos + 8:pos + 8 + size])
        pos += 8 + size + (size & 1)
    if b"fmt " not in out or b"data" not in out:
        raise ValueError("WAV file without fmt or data")
    return out


def step_sample(code, pred, index):
    step = STEPS[index]
    diff = step >> 3
    if code & 4:
        diff += step
    if code & 2:
        diff += step >> 1
    if code & 1:
        diff += step >> 2
    pred = pred - diff if code & 8 else pred + diff
    pred = max(-32768, min(32767, pred))
    index = max(0, min(88, index + INDEX[code & 7]))
    return pred, index


def decode(data, block, channels):
    if channels != 1:
        raise ValueError("only mono IMA ADPCM (as the Cybiko writes it) is supported")
    out = []
    for b in range(0, len(data), block):
        blk = data[b:b + block]
        if len(blk) < 4:
            break
        pred, index = struct.unpack_from("<hB", blk, 0)
        index = min(index, 88)
        out.append(pred)
        for byte in blk[4:]:
            for code in (byte & 15, byte >> 4):
                pred, index = step_sample(code, pred, index)
                out.append(pred)
    return out


def encode(samples):
    out = bytearray()
    pred, index = 0, 0
    for b in range(0, len(samples), PER_BLOCK):
        part = samples[b:b + PER_BLOCK]
        part += [part[-1]] * (PER_BLOCK - len(part))
        pred = part[0]
        out += struct.pack("<hBB", pred, index, 0)
        codes = []
        for s in part[1:]:
            step = STEPS[index]
            diff = s - pred
            code = 8 if diff < 0 else 0
            diff = abs(diff)
            if diff >= step:
                code |= 4
                diff -= step
            if diff >= step >> 1:
                code |= 2
                diff -= step >> 1
            if diff >= step >> 2:
                code |= 1
            pred, index = step_sample(code, pred, index)
            codes.append(code)
        for i in range(0, len(codes), 2):
            out.append(codes[i] | codes[i + 1] << 4)
    return bytes(out)


def cybiko_wav(samples):
    data = encode(samples)
    fmt = struct.pack("<HHIIHHHH", 0x11, 1, RATE, RATE * BLOCK // PER_BLOCK, BLOCK, 4, 2, PER_BLOCK)
    body = (b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt +
            b"fact" + struct.pack("<II", 4, len(samples)) +
            b"data" + struct.pack("<I", len(data)) + data)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def pcm_wav(samples, rate):
    data = struct.pack("<%dh" % len(samples), *samples)
    fmt = struct.pack("<HHIIHH", 1, 1, rate, rate * 2, 2, 16)
    body = b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def read_pcm(c):
    tag, ch, rate, _, align, bits = struct.unpack_from("<HHIIHH", c[b"fmt "], 0)
    if tag == 0xFFFE and len(c[b"fmt "]) >= 26:
        tag = struct.unpack_from("<H", c[b"fmt "], 24)[0]
    if tag != 1 or bits not in (8, 16):
        raise ValueError("only 8 or 16-bit PCM WAV files can be converted (convert it first)")
    d = c[b"data"]
    n = len(d) // align
    if bits == 16:
        vals = struct.unpack_from("<%dh" % (n * ch), d, 0)
    else:
        vals = [(v - 128) << 8 for v in d[:n * ch]]
    mono = [sum(vals[i * ch:(i + 1) * ch]) // ch for i in range(n)]
    return mono, rate


def resample(x, rate, gain):
    if not x:
        raise ValueError("no samples")
    if rate > RATE:                      # average over the source samples
        k = max(1, round(rate / RATE / 2))
        acc, run = [], 0
        for i, v in enumerate(x):
            run += v
            if i >= k:
                run -= x[i - k]
            acc.append(run / min(i + 1, k))
        x = acc
    n = int(len(x) * RATE / rate)
    out = []
    for i in range(n):
        p = i * rate / RATE
        j = int(p)
        f = p - j
        v = x[j] * (1 - f) + (x[j + 1] if j + 1 < len(x) else x[j]) * f
        out.append(max(-32768, min(32767, int(v * gain))))
    return out


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    gain = 1.0
    if "--gain" in argv:
        gain = float(argv[argv.index("--gain") + 1])
        args.remove(argv[argv.index("--gain") + 1])
    if not args or args[0] not in ("info", "to-pcm", "to-cybiko") or args[0] != "info" and len(args) < 3:
        sys.exit(__doc__)
    cmd, src = args[0], args[1]
    try:
        c = chunks(open(src, "rb").read())
        tag, ch, rate, byte_rate, align, bits = struct.unpack_from("<HHIIHH", c[b"fmt "], 0)
        if cmd == "info":
            kind = {1: "PCM", 0x11: "IMA ADPCM"}.get(tag, "format %#x" % tag)
            print("%s, %d Hz, %d channel(s), %d bits, blocks of %d bytes, %d data bytes" % (
                kind, rate, ch, bits, align, len(c[b"data"])))
            if tag == 0x11:
                n = len(decode(c[b"data"], align, ch))
                if b"fact" in c:
                    n = min(n, struct.unpack_from("<I", c[b"fact"], 0)[0])
                print("%d samples, %.2f s%s" % (n, n / rate, "" if (rate, ch, align) == (RATE, 1, BLOCK)
                                               else " (not what CyRecord writes: 8000 Hz mono, 256-byte blocks)"))
        elif cmd == "to-pcm":
            if tag != 0x11:
                raise ValueError("not an IMA ADPCM file")
            s = decode(c[b"data"], align, ch)
            if b"fact" in c:
                s = s[:struct.unpack_from("<I", c[b"fact"], 0)[0]]
            open(args[2], "wb").write(pcm_wav(s, rate))
        else:
            mono, r = read_pcm(c)
            s = resample(mono, r, gain)
            open(args[2], "wb").write(cybiko_wav(s))
            print("%s: %.2f s, %d bytes" % (args[2], len(s) / RATE, 60 + len(encode(s))))
    except (ValueError, OSError, struct.error) as e:
        sys.exit("%s: %s" % (src, e))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
