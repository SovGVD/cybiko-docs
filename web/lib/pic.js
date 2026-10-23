// Cybiko pictures (.pic, four greys; .xpic, 13 greys): a port of
// tools/cybiko_pic.py.
(function (C) {
  "use strict";
  const U = C.util;
  const P = C.pic = {};

  P.levels = bpp => ({ 1: 2, 2: 4, 4: 13 })[bpp];

  // {bpp, width, height, images: [{x, y, w, h, rows}], warnings}
  P.load = function (data) {
    if (data.length < 4) throw new Error("too short for a picture");
    const [bpp, count, width, height] = data;
    if (![1, 2, 4].includes(bpp)) throw new Error(bpp + " bits a pixel: not a .pic (1 or 2) or .xpic (4)");
    let pos = 4;
    const images = [], warnings = [];
    for (let i = 0; i < count; i++) {
      if (pos + 4 > data.length) throw new Error("image " + i + " cut short");
      const [x, y, w, h] = data.subarray(pos, pos + 4);
      pos += 4;
      const stride = (w * bpp + 7) >> 3;
      if (pos + stride * h > data.length) throw new Error("image " + i + " cut short");
      const rows = [];
      for (let r = 0; r < h; r++) {
        const row = data.subarray(pos + r * stride), px = new Array(w);
        for (let c = 0; c < w; c++) {
          if (bpp === 1) px[c] = (row[c >> 3] >> (7 - (c & 7))) & 1;
          else if (bpp === 2) px[c] = (row[c >> 2] >> (6 - 2 * (c & 3))) & 3;
          else px[c] = (row[c >> 1] >> (4 - 4 * (c & 1))) & 15;
        }
        rows.push(px);
      }
      pos += stride * h;
      images.push({ x, y, w, h, rows });
    }
    if (pos < data.length) warnings.push("warning: " + (data.length - pos) + " bytes after the images ignored");
    return { bpp, width, height, images, warnings };
  };

  P.save = function (bpp, images, width, height) {
    if (width === undefined) width = Math.max(...images.map(m => m.x + m.w));
    if (height === undefined) height = Math.max(...images.map(m => m.y + m.h));
    if (width > 255 || height > 255 || images.length > 255)
      throw new Error("pictures are at most 255 x 255 and 255 images");
    const out = new U.Buf().bytes([bpp, images.length, width, height]);
    for (const { x, y, w, h, rows } of images) {
      out.bytes([x, y, w, h]);
      for (const row of rows) {
        const b = new Uint8Array((w * bpp + 7) >> 3);
        row.forEach((v, c) => {
          if (bpp === 1) b[c >> 3] |= v << (7 - (c & 7));
          else if (bpp === 2) b[c >> 2] |= v << (6 - 2 * (c & 3));
          else b[c >> 1] |= v << (4 - 4 * (c & 1));
        });
        out.bytes(b);
      }
    }
    return out.done();
  };

  // How light a pixel value looks: 0 white, the top value black.
  P.greyOf = function (v, bpp) {
    const top = P.levels(bpp) - 1;
    if (v > top) return 0;                // 13-15 in an .xpic
    return U.round(255 - v * 255 / top);
  };

  P.badPixels = pic => {
    let bad = 0;
    const top = P.levels(pic.bpp) - 1;
    for (const m of pic.images) for (const r of m.rows) for (const v of r) if (v > top) bad++;
    return bad;
  };

  P.info = function (pic) {
    const kind = { 1: ".pic (black and white)", 2: ".pic (4 greys)", 4: ".xpic (13 greys)" }[pic.bpp];
    let s = kind + ", " + pic.width + " x " + pic.height + ", " + pic.images.length + " image(s)\n";
    pic.images.forEach((m, i) => { s += "  image " + i + ": " + m.w + " x " + m.h + " at " + m.x + ", " + m.y + "\n"; });
    return s;
  };

  // Grey rows of the whole picture (every image at its place) or of one image.
  P.canvasRows = function (pic) {
    const rows = [];
    for (let y = 0; y < pic.height; y++) rows.push(new Array(pic.width).fill(255));
    for (const { x, y, rows: rs } of pic.images)
      rs.forEach((row, r) => row.forEach((v, c) => {
        if (y + r < pic.height && x + c < pic.width) rows[y + r][x + c] = P.greyOf(v, pic.bpp);
      }));
    return rows;
  };
  P.imageRows = (pic, m) => m.rows.map(r => r.map(v => P.greyOf(v, pic.bpp)));

  // ---- reading pictures ---------------------------------------------------------

  function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  // Grey levels 0-255 as rows of floats (alpha drawn on white).
  P.readPng = async function (data) {
    let pos = 8, plte = null, trns = null, w, h, depth, ctype, inter;
    const idat = [];
    while (pos < data.length) {
      const n = U.u32be(data, pos), kind = U.latin1(data.subarray(pos + 4, pos + 8));
      const body = data.subarray(pos + 8, pos + 8 + n);
      pos += 12 + n;
      if (kind === "IHDR") {
        w = U.u32be(body, 0); h = U.u32be(body, 4);
        depth = body[8]; ctype = body[9]; inter = body[12];
      } else if (kind === "PLTE") {
        plte = [];
        for (let i = 0; i < body.length; i += 3) plte.push(body.subarray(i, i + 3));
      } else if (kind === "tRNS") trns = body;
      else if (kind === "IDAT") idat.push(body);
    }
    if (inter) throw new Error("interlaced PNGs are not supported; save it without interlacing");
    if (depth === 16) throw new Error("16-bit PNGs are not supported; save it with 8 bits a channel");
    const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    const bits = depth * chans, stride = (w * bits + 7) >> 3, fb = Math.max(1, bits >> 3);
    const raw = await U.inflate(U.concat(idat));
    let prev = new Uint8Array(stride);
    const rows = [];
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
      for (let i = 0; i < stride; i++) {
        const a = i >= fb ? line[i - fb] : 0, b = prev[i], c = i >= fb ? prev[i - fb] : 0;
        if (f === 1) line[i] = (line[i] + a) & 255;
        else if (f === 2) line[i] = (line[i] + b) & 255;
        else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
        else if (f === 4) line[i] = (line[i] + paeth(a, b, c)) & 255;
      }
      prev = line;
      let vals = line;
      if (depth < 8) {
        vals = new Array(w * chans);
        for (let x = 0; x < w * chans; x++)
          vals[x] = (line[(x * depth) >> 3] >> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1);
      }
      const out = new Array(w);
      for (let x = 0; x < w; x++) {
        const px = vals.slice(x * chans, (x + 1) * chans);
        let alpha = 255, r, g, b;
        if (ctype === 3) {
          [r, g, b] = plte[px[0]];
          if (trns && px[0] < trns.length) alpha = trns[px[0]];
        } else if (ctype === 0 || ctype === 4) {
          r = g = b = Math.floor(px[0] * 255 / ((1 << depth) - 1));
          if (ctype === 4) alpha = px[1];
        } else {
          [r, g, b] = px;
          if (ctype === 6) alpha = px[3];
        }
        const grey = 0.299 * r + 0.587 * g + 0.114 * b;
        out[x] = grey * alpha / 255 + 255 * (1 - alpha / 255);
      }
      rows.push(out);
    }
    return { w, h, rows };
  };

  P.readBmp = function (data) {
    const off = U.u32le(data, 10), w = U.i32le(data, 18), h = U.i32le(data, 22);
    const bits = U.u16le(data, 28), comp = U.u32le(data, 30);
    if (![0, 3].includes(comp) || ![8, 24, 32].includes(bits))
      throw new Error("only uncompressed 8, 24 or 32-bit BMPs are supported");
    let pal = null;
    if (bits === 8) {
      const hs = U.u32le(data, 14);
      pal = [];
      for (let i = 0; i < 256; i++) pal.push(data.subarray(14 + hs + 4 * i, 14 + hs + 4 * i + 3));
    }
    const stride = (Math.floor(w * bits / 8) + 3) & ~3, rows = [];
    for (let y = 0; y < Math.abs(h); y++) {
      const line = data.subarray(off + y * stride, off + (y + 1) * stride), out = [];
      for (let x = 0; x < w; x++) {
        let b, g, r;
        if (bits === 8) [b, g, r] = pal[line[x]];
        else { const o = Math.floor(x * bits / 8); [b, g, r] = line.subarray(o, o + 3); }
        out.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
      rows.push(out);
    }
    if (h > 0) rows.reverse();
    return { w, h: Math.abs(h), rows };
  };

  const space = c => c === 32 || (c >= 9 && c <= 13);
  P.readPnm = function (data) {
    const parts = [];
    let pos = 2;
    while (parts.length < 3) {
      while (pos < data.length && space(data[pos])) pos++;
      if (data[pos] === 35) {                 // "#"
        pos = data.indexOf(10, pos);
        if (pos < 0) throw new Error("subsection not found");
        continue;
      }
      const start = pos;
      while (pos < data.length && !space(data[pos])) pos++;
      parts.push(U.int(U.latin1(data.subarray(start, pos))));
    }
    const [w, h, maxv] = parts;
    pos++;
    const chans = data[1] === 54 ? 3 : 1;     // P6
    if (maxv > 255) throw new Error("16-bit PGM/PPM files are not supported");
    const px = data.subarray(pos, pos + w * h * chans), rows = [];
    for (let y = 0; y < h; y++) {
      const line = px.subarray(y * w * chans, (y + 1) * w * chans), out = [];
      if (chans === 1) for (const v of line) out.push(v * 255 / maxv);
      else for (let i = 0; i < line.length; i += 3)
        out.push((0.299 * line[i] + 0.587 * line[i + 1] + 0.114 * line[i + 2]) * 255 / maxv);
      rows.push(out);
    }
    return { w, h, rows };
  };

  P.isOwnFormat = data => U.startsWith(data, "\x89PNG\r\n\x1a\n") || U.startsWith(data, "BM") ||
    U.startsWith(data, "P5") || U.startsWith(data, "P6");

  P.readImage = async function (data) {
    if (U.startsWith(data, "\x89PNG\r\n\x1a\n")) return P.readPng(data);
    if (U.startsWith(data, "BM")) return P.readBmp(data);
    if (U.startsWith(data, "P5") || U.startsWith(data, "P6")) return P.readPnm(data);
    throw new Error("not a PNG, BMP, PGM or PPM file");
  };

  // Grey rows from RGBA pixels (a picture the browser decoded: JPEG, GIF...).
  P.fromRgba = function (w, h, rgba) {
    const rows = [];
    for (let y = 0; y < h; y++) {
      const out = new Array(w);
      for (let x = 0; x < w; x++) {
        const i = 4 * (y * w + x), alpha = rgba[i + 3];
        const grey = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        out[x] = grey * alpha / 255 + 255 * (1 - alpha / 255);
      }
      rows.push(out);
    }
    return { w, h, rows };
  };

  // ---- picture to Cybiko -----------------------------------------------------------

  // Area-average resize to tw x th; pad with white or crop as asked.
  P.resize = function (rows, w, h, tw, th, fit) {
    let sx, sy, ox, oy, cw, ch;
    if (fit === "stretch") { sx = w / tw; sy = h / th; ox = oy = 0; cw = tw; ch = th; }
    else {
      const s = fit === "pad" ? Math.max(w / tw, h / th) : Math.min(w / tw, h / th);
      cw = Math.min(tw, U.round(w / s)); ch = Math.min(th, U.round(h / s));
      sx = sy = s;
      ox = U.floorDiv(tw - cw, 2); oy = U.floorDiv(th - ch, 2);
      if (fit === "crop") ox = oy = 0;
    }
    const out = [];
    for (let y = 0; y < th; y++) out.push(new Array(tw).fill(255.0));
    const x0 = (w - cw * sx) / 2, y0 = (h - ch * sy) / 2;
    for (let y = 0; y < ch; y++) {
      const ya = y0 + y * sy, yb = y0 + (y + 1) * sy;
      const yEnd = Math.max(Math.trunc(ya) + 1, Math.min(h, Math.trunc(yb + 0.999)));
      for (let x = 0; x < cw; x++) {
        const xa = x0 + x * sx, xb = x0 + (x + 1) * sx;
        const xEnd = Math.max(Math.trunc(xa) + 1, Math.min(w, Math.trunc(xb + 0.999)));
        let tot = 0.0, area = 0.0;
        for (let yy = Math.trunc(ya); yy < yEnd; yy++) {
          const fy = Math.min(yb, yy + 1) - Math.max(ya, yy);
          for (let xx = Math.trunc(xa); xx < xEnd; xx++) {
            const fx = Math.min(xb, xx + 1) - Math.max(xa, xx);
            const a = Math.max(fx, 0) * Math.max(fy, 0) || 1e-9;
            tot += rows[pyIdx(Math.min(yy, h - 1), h)][pyIdx(Math.min(xx, w - 1), w)] * a;
            area += a;
          }
        }
        out[oy + y][ox + x] = tot / area;
      }
    }
    return out;
  };
  const pyIdx = (i, n) => i < 0 ? n + i : i;

  // Grey 0-255 (white 255) to values 0 (white) .. n-1 (black).
  P.quantise = function (rows, n, dither) {
    const h = rows.length, w = rows[0].length;
    const buf = rows.map(r => r.map(v => 255 - v));
    const out = [];
    for (let y = 0; y < h; y++) {
      const line = new Array(w);
      for (let x = 0; x < w; x++) {
        const d = Math.min(255.0, Math.max(0.0, buf[y][x]));
        const v = Math.trunc(d * (n - 1) / 255 + 0.5);
        line[x] = v;
        if (dither === "fs") {
          const err = d - v * 255 / (n - 1);
          if (x + 1 < w) buf[y][x + 1] += err * 7 / 16;
          if (y + 1 < h) {
            if (x) buf[y + 1][x - 1] += err * 3 / 16;
            buf[y + 1][x] += err * 5 / 16;
            if (x + 1 < w) buf[y + 1][x + 1] += err / 16;
          }
        }
      }
      out.push(line);
    }
    return out;
  };

  // from-image: img = {w, h, rows}; opts = {bpp, size: "WxH" | null, fit,
  // dither, brightness, contrast, gamma}. Returns {data, w, h}.
  P.fromImage = function (img, opts) {
    const bpp = opts.bpp;
    let { w, h, rows } = img, tw, th;
    if (opts.size) {
      const p = String(opts.size).toLowerCase().split("x");
      if (p.length !== 2) throw new Error("--size must be WxH");
      tw = U.int(p[0]); th = U.int(p[1]);
    } else {
      const s = Math.max(w / 160, h / 100, 1);
      tw = Math.max(1, U.round(w / s)); th = Math.max(1, U.round(h / s));
    }
    if (!(tw > 0 && tw <= 255 && th > 0 && th <= 255)) throw new Error("pictures are 1-255 pixels each way");
    if (tw !== w || th !== h) rows = P.resize(rows, w, h, tw, th, opts.fit || "pad");
    const c = opts.contrast ?? 1.0, b = opts.brightness ?? 0, g = opts.gamma ?? 1.0;
    rows = rows.map(r => r.map(v => 255 * Math.pow(Math.min(255, Math.max(0, (v - 128) * c + 128 + b)) / 255, g)));
    const px = P.quantise(rows, P.levels(bpp), opts.dither || "fs");
    return { data: P.save(bpp, [{ x: 0, y: 0, w: tw, h: th, rows: px }]), w: tw, h: th };
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
