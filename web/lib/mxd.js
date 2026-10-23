// MXD video clips for the MP3 cartridge: the parts of tools/cybiko_mxd.py
// that don't need ffmpeg. The page gets the frames from the browser's video
// decoder and the sound as an MP3.
(function (C) {
  "use strict";
  const U = C.util;
  const X = C.mxd = {};
  const W = 160, H = 100, ICON_W = 25, ICON_H = 18;
  X.W = W; X.H = H;

  const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

  // 0-255 greys to Cybiko levels 0 (white) to 3 (black).
  X.toLevels = function (grey, w, h, dither, gamma) {
    const lum = new Float64Array(grey.length);
    for (let i = 0; i < grey.length; i++) lum[i] = gamma !== 1.0 ? 255.0 * Math.pow(grey[i] / 255.0, gamma) : grey[i];
    const out = new Uint8Array(w * h);
    if (dither === "fs") {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x, old = lum[i];
          const lvl = Math.min(3, Math.max(0, Math.trunc((255.0 - old) / 85.0 + 0.5)));
          out[i] = lvl;
          const err = old - (255 - 85 * lvl);
          if (x + 1 < w) lum[i + 1] += err * 7 / 16;
          if (y + 1 < h) {
            if (x > 0) lum[i + w - 1] += err * 3 / 16;
            lum[i + w] += err * 5 / 16;
            if (x + 1 < w) lum[i + w + 1] += err * 1 / 16;
          }
        }
      }
    } else {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const d = dither === "bayer" ? (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5 : 0.0;
          out[i] = Math.min(3, Math.max(0, Math.trunc((255.0 - lum[i]) / 85.0 + 0.5 + d)));
        }
    }
    return out;
  };

  // Rows of 2-bit pixels, four to a byte, leftmost in the top bits.
  X.pack2bpp = function (levels, w, h) {
    const stride = (w + 3) >> 2, out = new Uint8Array(stride * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) out[y * stride + (x >> 2)] |= levels[y * w + x] << (6 - 2 * (x % 4));
    return out;
  };

  // A 25x18 icon from a frame, cropped to the icon's shape.
  X.makeIcon = function (frame, dither, gamma) {
    const cw = U.floorDiv(H * ICON_W, ICON_H);    // 138: the icon's aspect
    const x0 = U.floorDiv(W - cw, 2), small = [];
    for (let y = 0; y < ICON_H; y++)
      for (let x = 0; x < ICON_W; x++) {
        const sx0 = x0 + U.floorDiv(x * cw, ICON_W), sx1 = x0 + U.floorDiv((x + 1) * cw, ICON_W);
        const sy0 = U.floorDiv(y * H, ICON_H), sy1 = U.floorDiv((y + 1) * H, ICON_H);
        let sum = 0, n = 0;
        for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { sum += frame[sy * W + sx]; n++; }
        small.push(U.floorDiv(sum, n));
      }
    const pix = X.pack2bpp(X.toLevels(small, ICON_W, ICON_H, dither, gamma), ICON_W, ICON_H);
    return U.concat([new Uint8Array([2, 1, ICON_W, ICON_H, 0, 0, ICON_W, ICON_H]), pix]);
  };

  X.rootInf = function (name) {
    const lines = ["root", name + " ", "", "", "sound.dl", "", "Video clip", "21.1.1", "1.5.1", "sound.dl<21.1.1>"];
    return U.toLatin1(lines.join("\r\n") + "\r\n", true);
  };

  // The free clip player (player/ in this repository), from lib/mxdplayer.js.
  X.freePlayer = function () {
    if (!C.mxdPlayer) throw new Error("lib/mxdplayer.js is not loaded");
    const s = atob(C.mxdPlayer), b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };

  X.templatePlayer = function (blob) {
    for (const p of C.cap.cyEntries(blob)) if (p.name === "main.e" && p.data) return p.data;
    throw new Error("the template has no main.e: pass one of the MXD clips from the MP3 cartridge CD");
  };

  // MP3 data as ffmpeg writes it for a clip: no ID3 tags, no Xing/Info
  // header frame.
  X.plainMp3 = function (mp3) {
    let a = 0, b = mp3.length;
    while (U.startsWith(mp3.subarray(a), "ID3") && a + 10 <= b) {
      const s = mp3.subarray(a);
      const size = (s[6] & 127) << 21 | (s[7] & 127) << 14 | (s[8] & 127) << 7 | (s[9] & 127);
      a += 10 + size + (s[5] & 0x10 ? 10 : 0);
    }
    if (b - a >= 128 && U.startsWith(mp3.subarray(b - 128), "TAG")) b -= 128;
    while (a + 1 < b && !(mp3[a] === 0xFF && (mp3[a + 1] & 0xE0) === 0xE0)) a++;
    const f = frameLength(mp3, a);
    if (f && a + f <= b) {
      const head = U.latin1(mp3.subarray(a, a + Math.min(f, 64)));
      if (head.includes("Xing") || head.includes("Info") || head.includes("VBRI")) a += f;
    }
    return mp3.subarray(a, b);
  };

  const BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  function frameLength(d, a) {           // layer III only
    if (a + 4 > d.length || d[a] !== 0xFF || (d[a + 1] & 0xE0) !== 0xE0) return 0;
    const ver = (d[a + 1] >> 3) & 3, layer = (d[a + 1] >> 1) & 3;
    const br = d[a + 2] >> 4, sr = (d[a + 2] >> 2) & 3, pad = (d[a + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || !br || br === 15 || sr === 3) return 0;
    const kbps = BITRATES[ver === 3 ? 1 : 2][br], rate = RATES[ver][sr];
    return Math.floor((ver === 3 ? 144000 : 72000) * kbps / rate) + pad;
  }

  // The clip: frames are 160x100 arrays of 0-255 greys.
  X.build = function ({ frames, music, player, name, fps, dither, gamma }) {
    const period = U.round(10000 / fps);
    const pic = new U.Buf().u16be(period).u8(W).u8(H);
    for (const f of frames) pic.bytes([0, 0, W, H]).bytes(X.pack2bpp(X.toLevels(f, W, H, dither, gamma), W, H));
    const icon = X.makeIcon(frames[Math.floor(frames.length / 3)], dither, gamma);
    return C.cap.cyArchive([
      ...(music && music.length ? [{ name: "music.mp3", data: music, compress: false }] : []),
      { name: "clip.pic", data: pic.done(), compress: true },
      { name: "main.e", data: player, compress: true },
      { name: "root.inf", data: X.rootInf(name), compress: true },
      { name: "0.ico", data: icon, compress: false },
    ]);
  };

  // A clip's frames (2-bit levels, w x h each), frame rate and sound.
  X.parse = function (blob) {
    const parts = {};
    for (const p of C.cap.cyEntries(blob)) parts[p.name] = p.data;
    const pic = parts["clip.pic"], music = parts["music.mp3"] || null;
    if (!pic || pic.length < 4) throw new Error("not an MXD clip (no clip.pic)");
    const period = U.u16be(pic, 0), w = pic[2], h = pic[3];
    const stride = (w + 3) >> 2, size = stride * h, frames = [];
    let pos = 4;
    while (pos + 4 + size <= pic.length) {
      const fw = pic[pos + 2], fh = pic[pos + 3];
      if (fw !== w || fh !== h) throw new Error("frame at " + pos + " is " + fw + "x" + fh + ", not " + w + "x" + h + ": not supported");
      const rows = pic.subarray(pos + 4, pos + 4 + size), f = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) f[y * w + x] = rows[y * stride + (x >> 2)] >> (6 - 2 * (x % 4)) & 3;
      frames.push(f);
      pos += 4 + size;
    }
    return { w, h, fps: period ? 10000.0 / period : 5.0, frames, music, icon: parts["0.ico"] || null };
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
