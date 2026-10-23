// CyRecord's recordings (IMA ADPCM, 8000 Hz, mono) to and from PCM WAV: a
// port of tools/cybiko_wav.py.
(function (C) {
  "use strict";
  const U = C.util;
  const W = C.wav = {};
  const RATE = 8000, BLOCK = 256, PER_BLOCK = 505;

  const STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50,
    55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279,
    307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282,
    1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
    5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
    18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8];

  // {"fmt ": bytes, "data": bytes, ...}, the first chunk of each kind.
  W.chunks = function (data) {
    if (!U.startsWith(data, "RIFF") || U.latin1(data.subarray(8, 12)) !== "WAVE") throw new Error("not a WAV file");
    let pos = 12;
    const out = {};
    while (pos + 8 <= data.length) {
      const id = U.latin1(data.subarray(pos, pos + 4)), size = U.u32le(data, pos + 4);
      if (!(id in out)) out[id] = data.subarray(pos + 8, pos + 8 + size);
      pos += 8 + size + (size & 1);
    }
    if (!("fmt " in out) || !("data" in out)) throw new Error("WAV file without fmt or data");
    return out;
  };

  W.fmt = c => {
    const f = c["fmt "];
    return { tag: U.u16le(f, 0), ch: U.u16le(f, 2), rate: U.u32le(f, 4), byteRate: U.u32le(f, 8),
      align: U.u16le(f, 12), bits: U.u16le(f, 14) };
  };

  function stepSample(code, pred, index) {
    const step = STEPS[index];
    let diff = step >> 3;
    if (code & 4) diff += step;
    if (code & 2) diff += step >> 1;
    if (code & 1) diff += step >> 2;
    pred = code & 8 ? pred - diff : pred + diff;
    pred = Math.max(-32768, Math.min(32767, pred));
    index = Math.max(0, Math.min(88, index + INDEX[code & 7]));
    return [pred, index];
  }

  W.decode = function (data, block, channels) {
    if (channels !== 1) throw new Error("only mono IMA ADPCM (as the Cybiko writes it) is supported");
    const out = [];
    for (let b = 0; b < data.length; b += block) {
      const blk = data.subarray(b, b + block);
      if (blk.length < 4) break;
      let pred = U.i16le(blk, 0), index = Math.min(blk[2], 88);
      out.push(pred);
      for (let i = 4; i < blk.length; i++) {
        const byte = blk[i];
        [pred, index] = stepSample(byte & 15, pred, index);
        out.push(pred);
        [pred, index] = stepSample(byte >> 4, pred, index);
        out.push(pred);
      }
    }
    return out;
  };

  W.encode = function (samples) {
    const out = new U.Buf();
    let pred = 0, index = 0;
    for (let b = 0; b < samples.length; b += PER_BLOCK) {
      const part = samples.slice(b, b + PER_BLOCK);
      while (part.length < PER_BLOCK) part.push(part[part.length - 1]);
      pred = part[0];
      out.u16le(pred & 0xFFFF).u8(index).u8(0);
      const codes = [];
      for (let i = 1; i < part.length; i++) {
        const s = part[i], step = STEPS[index];
        let diff = s - pred, code = diff < 0 ? 8 : 0;
        diff = Math.abs(diff);
        if (diff >= step) { code |= 4; diff -= step; }
        if (diff >= step >> 1) { code |= 2; diff -= step >> 1; }
        if (diff >= step >> 2) code |= 1;
        [pred, index] = stepSample(code, pred, index);
        codes.push(code);
      }
      for (let i = 0; i < codes.length; i += 2) out.u8(codes[i] | codes[i + 1] << 4);
    }
    return out.done();
  };

  W.cybikoWav = function (samples) {
    const data = W.encode(samples);
    return new U.Buf().str("RIFF").u32le(4 + 8 + 20 + 12 + 8 + data.length).str("WAVE")
      .str("fmt ").u32le(20).u16le(0x11).u16le(1).u32le(RATE).u32le(Math.floor(RATE * BLOCK / PER_BLOCK))
      .u16le(BLOCK).u16le(4).u16le(2).u16le(PER_BLOCK)
      .str("fact").u32le(4).u32le(samples.length)
      .str("data").u32le(data.length).bytes(data).done();
  };

  W.pcmWav = function (samples, rate) {
    const out = new U.Buf().str("RIFF").u32le(36 + 2 * samples.length).str("WAVE")
      .str("fmt ").u32le(16).u16le(1).u16le(1).u32le(rate).u32le(rate * 2).u16le(2).u16le(16)
      .str("data").u32le(2 * samples.length);
    for (const s of samples) out.u16le(s & 0xFFFF);
    return out.done();
  };

  W.readPcm = function (c) {
    const f = c["fmt "];
    let { tag, ch, rate, align, bits } = W.fmt(c);
    if (tag === 0xFFFE && f.length >= 26) tag = U.u16le(f, 24);
    if (tag !== 1 || (bits !== 8 && bits !== 16))
      throw new Error("only 8 or 16-bit PCM WAV files can be converted (convert it first)");
    const d = c.data, n = Math.floor(d.length / align), vals = new Array(n * ch);
    if (bits === 16) {
      if (2 * n * ch > d.length) throw new Error("unpack requires a buffer of " + 2 * n * ch + " bytes");
      for (let i = 0; i < n * ch; i++) vals[i] = U.i16le(d, 2 * i);
    } else for (let i = 0; i < n * ch; i++) vals[i] = (d[i] - 128) * 256;
    const mono = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < ch; k++) s += vals[i * ch + k];
      mono[i] = Math.floor(s / ch);
    }
    return { mono, rate };
  };

  W.resample = function (x, rate, gain) {
    if (!x.length) throw new Error("no samples");
    if (rate > RATE) {
      const k = Math.max(1, U.round(rate / RATE / 2)), acc = new Array(x.length);
      let run = 0;
      for (let i = 0; i < x.length; i++) {
        run += x[i];
        if (i >= k) run -= x[i - k];
        acc[i] = run / Math.min(i + 1, k);
      }
      x = acc;
    }
    const n = Math.trunc(x.length * RATE / rate), out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * rate / RATE, j = Math.trunc(p), f = p - j;
      const v = x[j] * (1 - f) + (j + 1 < x.length ? x[j + 1] : x[j]) * f;
      out[i] = Math.max(-32768, Math.min(32767, Math.trunc(v * gain)));
    }
    return out;
  };

  W.info = function (c) {
    const { tag, ch, rate, align, bits } = W.fmt(c);
    const kind = { 1: "PCM", 0x11: "IMA ADPCM" }[tag] || "format 0x" + tag.toString(16);
    let s = kind + ", " + rate + " Hz, " + ch + " channel(s), " + bits + " bits, blocks of " + align +
      " bytes, " + c.data.length + " data bytes\n";
    if (tag === 0x11) {
      let n = W.decode(c.data, align, ch).length;
      if (c.fact) n = Math.min(n, U.u32le(c.fact, 0));
      s += n + " samples, " + U.fixed(n / rate, 2) + " s" +
        (rate === RATE && ch === 1 && align === BLOCK ? "" : " (not what CyRecord writes: 8000 Hz mono, 256-byte blocks)") + "\n";
    }
    return s;
  };

  W.toPcm = function (c) {
    const { tag, ch, rate, align } = W.fmt(c);
    if (tag !== 0x11) throw new Error("not an IMA ADPCM file");
    let s = W.decode(c.data, align, ch);
    if (c.fact) s = s.slice(0, U.u32le(c.fact, 0));
    return W.pcmWav(s, rate);
  };

  W.toCybiko = function (c, gain) {
    const { mono, rate } = W.readPcm(c);
    const s = W.resample(mono, rate, gain ?? 1.0);
    return { data: W.cybikoWav(s), seconds: s.length / RATE };
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
