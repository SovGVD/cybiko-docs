#!/usr/bin/env node
// Checks that the web converters give the same bytes as the Python tools.
//
//   node web/test/compare.js SAMPLES_DIR [--quick]
//
// SAMPLES_DIR is searched (with subfolders) for Cybiko files: packs (.cap,
// .csu), archives (.app, .dl), flash dumps (*.bin, *flash*), pictures (.pic,
// .xpic), melodies (.mus, .music), envelopes (.amp) and recordings (.wav).
// They are not in this repository (they are Cybiko's); see web/README.md.
// Made-up inputs (images, MIDI and WAV files, a video) are generated too,
// with Python and ffmpeg. Needs Node 18+, Python 3 and ffmpeg.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const TOOLS = path.join(ROOT, "tools");
for (const f of ["util", "bzip2", "cap", "pic", "music", "amp", "wav", "mxd"])
  require(path.join(__dirname, "..", "lib", f + ".js"));
const C = globalThis.Cybiko, U = C.util;

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const samples = args.find(a => !a.startsWith("--"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cybiko-web-"));
let passed = 0, failed = 0;

function py(tool, argv, opts) {
  try {
    return execFileSync("python3", [path.join(TOOLS, tool), ...argv],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28, ...opts }).toString("latin1");
  } catch (e) {
    return { error: (e.stderr || "").toString() || String(e) };
  }
}
const read = f => new Uint8Array(fs.readFileSync(f));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function check(what, ok, detail) {
  if (ok) passed++;
  else { failed++; console.log("FAIL " + what + (detail ? ": " + detail : "")); }
}
function checkBytes(what, js, pyFile) {
  if (!fs.existsSync(pyFile)) return check(what, false, "Python wrote no " + pyFile);
  const p = read(pyFile);
  let at = 0;
  while (at < js.length && js[at] === p[at]) at++;
  check(what, same(js, p), "JS " + js.length + " bytes, Python " + p.length + ", first difference at " + at);
}
async function guard(what, fn) {
  try { await fn(); } catch (e) { check(what, false, "JS threw " + (e.stack || e)); }
}

// An 8-bit grey PNG (as the Python tool writes it) to rows.
function pngRows(file) {
  const d = fs.readFileSync(file);
  let pos = 8, w, h, idat = [];
  while (pos < d.length) {
    const n = d.readUInt32BE(pos), kind = d.toString("latin1", pos + 4, pos + 8);
    if (kind === "IHDR") { w = d.readUInt32BE(pos + 8); h = d.readUInt32BE(pos + 12); }
    if (kind === "IDAT") idat.push(d.subarray(pos + 8, pos + 8 + n));
    pos += 12 + n;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rows = [];
  for (let y = 0; y < h; y++) rows.push([...raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1))]);
  return { w, h, rows };
}
async function checkPng(what, jsPng, pyFile) {
  const f = path.join(tmp, "js.png");
  fs.writeFileSync(f, jsPng);
  if (!fs.existsSync(pyFile)) return check(what, false, "Python wrote no PNG");
  const a = pngRows(f), b = pngRows(pyFile);
  check(what, a.w === b.w && a.h === b.h && JSON.stringify(a.rows) === JSON.stringify(b.rows), "pixels differ");
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function kindOf(file) {
  const ext = path.extname(file).toLowerCase(), d = fs.readFileSync(file);
  const head = d.toString("latin1", 0, 4);
  if (head.startsWith("CAP")) return "cap";
  if (head.startsWith("Cy") && [".app", ".dl", ""].includes(ext)) return "app";
  if (ext === ".pic" || ext === ".xpic") return "pic";
  if (ext === ".mus" || ext === ".music") return "music";
  if (ext === ".amp") return "amp";
  if (ext === ".wav") return "wav";
  if (ext === ".bin" || /flash/i.test(path.basename(file))) return "flash";
  return null;
}

// ---- packs and archives ---------------------------------------------------------

async function testCap(file) {
  const name = path.basename(file), out = path.join(tmp, "cap");
  fs.rmSync(out, { recursive: true, force: true });
  const text = py("cybiko_cap.py", ["extract", file, out]);
  await guard("cap " + name, () => {
    const entries = C.cap.parsePack(read(file));
    check("cap list " + name, C.cap.listPack(entries) === text, "listing differs");
    for (const e of entries) if (e.type === 2 || e.type === 3)
      checkBytes("cap extract " + name + "/" + e.name, C.cap.decodeFile(e), path.join(out, C.cap.safeName(e.name)));
  });
}

async function testApp(file) {
  const name = path.basename(file), out = path.join(tmp, "app");
  fs.rmSync(out, { recursive: true, force: true });
  const text = py("cybiko_cap.py", ["app", file, out]);
  await guard("app " + name, () => {
    const parts = C.cap.cyEntries(read(file));
    check("app list " + name, C.cap.listApp(parts) === text, "listing differs");
    const files = [];
    for (const p of parts) if (p.data) {
      checkBytes("app part " + name + "/" + p.name, p.data, path.join(out, C.cap.safeName(p.name)));
      files.push({ name: C.cap.safeName(p.name), data: p.data });
    }
    if (quick && fs.statSync(file).size > 200000) return;
    // Pack the parts again, all compressed and with the first one stored.
    const uniq = [...new Map(files.map(f => [f.name, f])).values()];
    for (const store of [[], uniq.length ? [uniq[0].name] : []]) {
      const o = path.join(tmp, "packed.app");
      py("cybiko_cap.py", ["pack", out, o, ...(store.length ? ["--store", ...store] : [])]);
      checkBytes("pack " + name + (store.length ? " --store" : ""), C.cap.packFiles(uniq, new Set(store)), o);
    }
  });
}

async function testFlash(file) {
  const name = path.basename(file), out = path.join(tmp, "flash");
  fs.rmSync(out, { recursive: true, force: true });
  const text = py("cybiko_cap.py", ["flash", file, out]);
  await guard("flash " + name, () => {
    const blob = read(file), found = C.cap.findArchives(blob);
    check("flash list " + name, C.cap.listFlash(found) === text, "listing differs");
    for (const f of found)
      for (const p of C.cap.cyEntries(blob.subarray(f.pos))) if (p.data)
        checkBytes("flash part " + name + " " + U.hex(f.pos, 6) + "/" + p.name, p.data,
          path.join(out, U.hex(f.pos, 6), C.cap.safeName(p.name)));
  });
}

// ---- pictures ----------------------------------------------------------------------

async function testPic(file) {
  const name = path.basename(file), o = path.join(tmp, "pic.png");
  await guard("pic " + name, async () => {
    const info = py("cybiko_pic.py", ["info", file]);
    let pic;
    try { pic = C.pic.load(read(file)); }
    catch (e) { return check("pic info " + name, typeof info === "object", "JS failed, Python did not: " + e.message); }
    check("pic info " + name, C.pic.info(pic) === info, JSON.stringify([C.pic.info(pic), info]));
    py("cybiko_pic.py", ["to-png", file, o]);
    await checkPng("pic to-png " + name, await U.greyPng(pic.width, pic.height, C.pic.canvasRows(pic)), o);
    py("cybiko_pic.py", ["to-png", file, o, "--each"]);
    for (let i = 0; i < pic.images.length; i++) {
      const m = pic.images[i];
      await checkPng("pic to-png --each " + name + " " + i, await U.greyPng(m.w, m.h, C.pic.imageRows(pic, m)),
        path.join(tmp, "pic-" + i + ".png"));
    }
  });
}

async function testFromImage(img, opts) {
  const ext = opts.bpp === 2 ? ".pic" : ".xpic", o = path.join(tmp, "out" + ext);
  fs.rmSync(o, { force: true });
  const argv = ["from-image", img, o];
  if (opts.size) argv.push("--size", opts.size);
  if (opts.fit) argv.push("--fit", opts.fit);
  if (opts.dither) argv.push("--dither", opts.dither);
  for (const k of ["brightness", "contrast", "gamma"]) if (opts[k] !== undefined) argv.push("--" + k, String(opts[k]));
  const what = "from-image " + path.basename(img) + " " + JSON.stringify(opts);
  py("cybiko_pic.py", argv);
  await guard(what, async () => {
    const image = await C.pic.readImage(read(img));
    checkBytes(what, C.pic.fromImage(image, opts).data, o);
  });
}

function makeImages() {
  const src = path.join(tmp, "src.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    "testsrc2=size=203x131:rate=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='X*255/W'",
    "-frames:v", "1", src]);
  const files = { rgba: src };
  const conv = (name, fmtArgs) => {
    const f = path.join(tmp, name);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, ...fmtArgs, f]);
    files[name] = f;
  };
  conv("rgb.png", ["-pix_fmt", "rgb24"]);
  conv("grey.png", ["-pix_fmt", "gray"]);
  conv("greya.png", ["-pix_fmt", "ya8"]);
  conv("pal.png", ["-vf", "split[a][b];[a]palettegen=max_colors=16[p];[b][p]paletteuse", "-pix_fmt", "pal8"]);
  conv("mono.png", ["-pix_fmt", "monob"]);
  conv("rgb.bmp", ["-pix_fmt", "bgr24"]);
  conv("rgba.bmp", ["-pix_fmt", "bgra"]);
  conv("pal.bmp", ["-pix_fmt", "pal8"]);
  conv("grey.pgm", ["-pix_fmt", "gray"]);
  conv("rgb.ppm", ["-pix_fmt", "rgb24"]);
  // PNGs with 2 and 4-bit greys and a tRNS palette, written by Python.
  execFileSync("python3", ["-c", `
import struct, zlib, sys
def png(path, w, h, depth, ctype, rows, plte=None, trns=None):
    def ch(k, d): return struct.pack(">I", len(d)) + k + d + struct.pack(">I", zlib.crc32(k + d) & 0xffffffff)
    raw = b"".join(bytes([y % 5]) + r for y, r in enumerate(rows))
    # filters 0-4 in turn: the bytes are made up, the reader must undo them
    out = b"\\x89PNG\\r\\n\\x1a\\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, ctype, 0, 0, 0))
    if plte: out += ch(b"PLTE", plte)
    if trns: out += ch(b"tRNS", trns)
    open(path, "wb").write(out + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b""))
w, h = 97, 61
for depth in (1, 2, 4):
    stride = (w * depth + 7) // 8
    png(sys.argv[1] + "/g%d.png" % depth, w, h, depth, 0, [bytes((x * 37 + y * 11) & 255 for x in range(stride)) for y in range(h)])
pal = bytes(range(0, 256, 1))[:48]
png(sys.argv[1] + "/p4.png", w, h, 4, 3, [bytes((x * 13 + y) & 255 for x in range((w * 4 + 7) // 8)) for y in range(h)], pal, bytes([0, 128, 255, 7]))
png(sys.argv[1] + "/rgbf.png", 40, 30, 8, 2, [bytes((x * 7 + y * 3) & 255 for x in range(120)) for y in range(30)])
`, tmp]);
  for (const f of ["g1.png", "g2.png", "g4.png", "p4.png", "rgbf.png"]) files[f] = path.join(tmp, f);
  return files;
}

// ---- melodies, envelopes ----------------------------------------------------------------

function ampMap(dir) {
  const m = new Map();
  if (dir) for (const f of fs.readdirSync(dir)) {
    const k = /^(\d+)\.amp$/.exec(f);
    if (k) m.set(Number(k[1]), read(path.join(dir, f)));
  }
  return m;
}

async function testMusic(file, ampDir) {
  const name = path.basename(file);
  await guard("music " + name, async () => {
    const w = [];
    const m = C.music.load(read(file), w);
    const info = py("cybiko_music.py", ["info", file]);
    check("music info " + name, C.music.info(m) === info, JSON.stringify([C.music.info(m), info]));
    const text = py("cybiko_music.py", ["to-text", file]);
    check("music to-text " + name, C.music.toText(m) === text, "text differs");
    const t = path.join(tmp, "m.txt"), o = path.join(tmp, "m.music");
    fs.writeFileSync(t, text);
    py("cybiko_music.py", ["from-text", t, o]);
    checkBytes("music from-text " + name, C.music.save(C.music.fromText(text)), o);
    const mid = path.join(tmp, "m.mid");
    py("cybiko_music.py", ["to-midi", file, mid]);
    checkBytes("music to-midi " + name, C.music.toMidi(m), mid);
    const wav = path.join(tmp, "m.wav"), rate = quick ? 8000 : 22050;
    py("cybiko_music.py", ["to-wav", file, wav, "--rate", String(rate), ...(ampDir ? ["--amp-dir", ampDir] : [])]);
    checkBytes("music to-wav " + name, C.music.wav8(C.music.render(m, rate, ampMap(ampDir)), rate), wav);
    await testFromMidi(mid, { version: m.version === 0 ? 0 : 1 });
  });
}

async function testFromMidi(mid, opts) {
  const o = path.join(tmp, "fm.music");
  fs.rmSync(o, { force: true });
  const argv = ["from-midi", mid, o];
  if (opts.tracks) argv.push("--tracks", opts.tracks.join(","));
  for (const k of ["transpose", "style", "version", "envelope", "pulse", "volume"])
    if (opts[k] !== undefined) argv.push("--" + k, String(opts[k]));
  const what = "from-midi " + path.basename(mid) + " " + JSON.stringify(opts);
  const r = py("cybiko_music.py", argv);
  await guard(what, () => {
    let js;
    try { js = C.music.save(C.music.fromMidi(read(mid), opts)); }
    catch (e) { return check(what, typeof r === "object", "JS failed, Python did not: " + e.message); }
    checkBytes(what, js, o);
  });
}

function makeMidi() {
  const f = path.join(tmp, "multi.mid");
  execFileSync("python3", ["-c", `
import struct, sys, random
random.seed(7)
def vlq(v):
    out = [v & 0x7f]; v >>= 7
    while v: out.append(0x80 | v & 0x7f); v >>= 7
    return bytes(reversed(out))
def track(evs):
    evs.sort(key=lambda e: e[0]); body = b""; at = 0
    for t, e in evs: body += vlq(t - at) + e; at = t
    body += b"\\x00\\xff\\x2f\\x00"
    return b"MTrk" + struct.pack(">I", len(body)) + body
tracks = [[(0, b"\\xff\\x51\\x03\\x07\\xa1\\x20"), (960, b"\\xff\\x51\\x03\\x05\\x16\\x15"), (0, b"\\xff\\x03\\x04Tmpo")]]
for k in range(3):
    evs = [(0, b"\\xff\\x03\\x05Track"), (5, b"\\xf0\\x03\\x01\\x02\\xf7")]
    t = 0
    for i in range(120):
        n = random.randint(20 + 10 * k, 100 + 10 * k) % 128
        ch = 9 if (k == 2 and i % 7 == 0) else k
        d = random.choice([30, 60, 120, 240, 2000])
        evs.append((t, bytes([0x90 | ch, n, random.randint(1, 127)])))
        evs.append((t + d, bytes([0x80 | ch, n, 0]) if i % 2 else bytes([0x90 | ch, n, 0])))
        t += random.choice([0, 15, 60, 120, 300])
    tracks.append(evs)
data = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), 240) + b"".join(track(t) for t in tracks)
open(sys.argv[1], "wb").write(data)
`, f]);
  return f;
}

async function testAmp(file) {
  const name = path.basename(file);
  await guard("amp " + name, () => {
    const a = C.amp.load(read(file));
    const info = py("cybiko_amp.py", ["info", file]);
    check("amp info " + name, C.amp.info(a) === info, JSON.stringify([C.amp.info(a), info]));
    const t = path.join(tmp, "e.a"), o = path.join(tmp, "e.amp");
    py("cybiko_amp.py", ["to-text", file, t]);
    const text = C.amp.toText(a);
    checkBytes("amp to-text " + name, U.toLatin1(text), t);
    py("cybiko_amp.py", ["from-text", t, o]);
    checkBytes("amp from-text " + name, C.amp.save(C.amp.fromText(U.latin1(read(t)))), o);
  });
}

async function testAmpText(text, label) {
  const t = path.join(tmp, "h.a"), o = path.join(tmp, "h.amp");
  fs.writeFileSync(t, Buffer.from(text, "latin1"));
  fs.rmSync(o, { force: true });
  const r = py("cybiko_amp.py", ["from-text", t, o]);
  await guard("amp from-text " + label, () => {
    let js;
    try { js = C.amp.save(C.amp.fromText(text)); }
    catch (e) { return check("amp from-text " + label, typeof r === "object", "JS failed, Python did not: " + e.message); }
    checkBytes("amp from-text " + label, js, o);
  });
}

// ---- recordings ------------------------------------------------------------------------------

async function testWav(file, gains) {
  const name = path.basename(file);
  await guard("wav " + name, () => {
    const c = C.wav.chunks(read(file)), { tag } = C.wav.fmt(c);
    const info = py("cybiko_wav.py", ["info", file]);
    check("wav info " + name, C.wav.info(c) === info, JSON.stringify([C.wav.info(c), info]));
    const o = path.join(tmp, "w.wav");
    if (tag === 0x11) {
      py("cybiko_wav.py", ["to-pcm", file, o]);
      checkBytes("wav to-pcm " + name, C.wav.toPcm(c), o);
    } else {
      for (const g of gains || [1.0]) {
        py("cybiko_wav.py", ["to-cybiko", file, o, "--gain", String(g)]);
        const js = C.wav.toCybiko(c, g).data;
        checkBytes("wav to-cybiko " + name + " gain " + g, js, o);
        const back = path.join(tmp, "back.wav");
        fs.writeFileSync(back, js);
        py("cybiko_wav.py", ["to-pcm", back, o]);
        checkBytes("wav to-pcm (made) " + name, C.wav.toPcm(C.wav.chunks(js)), o);
      }
    }
  });
}

function makeWavs() {
  const out = [];
  const make = (name, a) => {
    const f = path.join(tmp, name);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
      "aevalsrc=0.6*sin(2*PI*440*t)+0.3*sin(2*PI*1234*t*t):s=48000:d=1.3", ...a, f]);
    out.push(f);
  };
  make("s16-44k-stereo.wav", ["-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"]);
  make("s16-8k.wav", ["-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le"]);
  make("u8-22k.wav", ["-ar", "22050", "-ac", "1", "-c:a", "pcm_u8"]);
  make("s16-6k.wav", ["-ar", "6000", "-ac", "1", "-c:a", "pcm_s16le"]);
  make("s16-48k.wav", ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le"]);
  make("ima.wav", ["-ar", "8000", "-ac", "1", "-c:a", "adpcm_ima_wav"]);
  return out;
}

// ---- MXD clips -----------------------------------------------------------------------------------

async function testMxd() {
  const video = path.join(tmp, "v.mp4"), tpl = path.join(tmp, "tpl.app"), out = path.join(tmp, "clip.app");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:d=4",
    "-f", "lavfi", "-i", "sine=f=330:d=4", "-c:v", "libx264", "-c:a", "aac", "-shortest", video]);
  // A made-up player stands in for Cybiko's main.e.
  const player = new Uint8Array(3000).map((_, i) => (i * 31 + (i >> 5)) & 255);
  fs.writeFileSync(tpl, C.cap.cyArchive([{ name: "main.e", data: player, compress: true }]));
  for (const o of [{ fit: "crop", dither: "fs", gamma: 1.0, fps: 5 }, { fit: "pad", dither: "bayer", gamma: 0.8, fps: 3 },
    { fit: "crop", dither: "none", gamma: 1.2, fps: 2 }]) {
    const what = "mxd " + JSON.stringify(o);
    py("cybiko_mxd.py", [video, out, "--template", tpl, "--name", "Test clip", "--fps", String(o.fps),
      "--fit", o.fit, "--dither", o.dither, "--gamma", String(o.gamma)]);
    await guard(what, () => {
      // The same ffmpeg calls as cybiko_mxd.py's get_frames and get_music.
      const geo = o.fit === "pad"
        ? "scale=160:100:force_original_aspect_ratio=decrease,pad=160:100:(ow-iw)/2:(oh-ih)/2:white"
        : "scale=160:100:force_original_aspect_ratio=increase,crop=160:100";
      const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-an", "-vf", "fps=" + o.fps + "," + geo + ",format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 28 });
      const frames = [];
      for (let i = 0; i + 16000 <= raw.length; i += 16000) frames.push(new Uint8Array(raw.subarray(i, i + 16000)));
      const music = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "22050", "-b:a", "64k",
        "-c:a", "libmp3lame", "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "0", "-f", "mp3", "-"]);
      const js = C.mxd.build({ frames, music: C.mxd.plainMp3(new Uint8Array(music)), player: C.mxd.templatePlayer(read(tpl)),
        name: "Test clip", fps: o.fps, dither: o.dither, gamma: o.gamma });
      checkBytes(what, js, out);
      const clip = C.mxd.parse(js);
      check(what + " parse", clip.frames.length === frames.length && same(clip.music, music), "frames or sound differ");
    });
  }
}

// ---- main ----------------------------------------------------------------------------------------

(async () => {
  const files = samples ? walk(samples) : [];
  const by = {};
  for (const f of files) { const k = kindOf(f); if (k) (by[k] = by[k] || []).push(f); }
  const ampDir = (by.amp || []).length ? path.dirname(by.amp.find(f => /\/1\.amp$/.test(f)) || by.amp[0]) : null;
  const limit = (list, n) => quick ? (list || []).slice(0, n) : list || [];
  console.log("samples: " + Object.entries(by).map(([k, v]) => v.length + " " + k).join(", "));

  for (const f of limit(by.cap, 2)) await testCap(f);
  for (const f of limit(by.app, 8)) await testApp(f);
  for (const f of limit(by.flash, 1)) await testFlash(f);
  for (const f of limit(by.pic, 10)) await testPic(f);
  for (const f of limit(by.music, 10)) await testMusic(f, ampDir);
  for (const f of limit(by.amp, 10)) await testAmp(f);
  for (const f of limit(by.wav, 4)) await testWav(f);

  const imgs = makeImages();
  for (const [k, f] of Object.entries(imgs)) {
    await testFromImage(f, { bpp: 2 });
    await testFromImage(f, { bpp: 4 });
    if (quick && k !== "rgba") continue;
    await testFromImage(f, { bpp: 2, size: "64x64", fit: "crop", dither: "none" });
    await testFromImage(f, { bpp: 4, size: "160x100", fit: "pad", brightness: 20, contrast: 1.3, gamma: 0.8 });
    await testFromImage(f, { bpp: 4, size: "37x90", fit: "stretch", brightness: -40.5, gamma: 1.7 });
    await testFromImage(f, { bpp: 2, size: "255x255", fit: "pad", contrast: 0.7 });
  }
  const mid = makeMidi();
  for (const o of [{}, { tracks: [1, 3] }, { style: "last", transpose: -12 }, { version: 0 }, { version: 2, envelope: 59, pulse: 2000, volume: 30 },
    { transpose: 40 }, { tracks: [2], version: 0, transpose: -30 }, { tracks: [7] }])
    await testFromMidi(mid, o);
  for (const [text, label] of [
    ["Version 0\r\nTdiscret 1.000\r\n 0.0\r\n1 1.0\r\n3 0.0\r\nend\r\n", "template"],
    ["; c\nVERSION 3\ntdiscret 0.0015 ; tiny\n0.5\n10 0.25\n7 1\n2 0.333333\n", "steps"],
    ["Tdiscret 2.5\n0.0001\n65535 1.0\n", "long"],
    ["Tdiscret 0\n0.7\n", "zero time"],
    ["Tdiscret 0\n0.7\n0.1\n", "zero time, two points"],
    ["Tdiscret 1\n1.5\n", "level too high"],
  ]) await testAmpText(text, label);
  for (const f of makeWavs()) await testWav(f, [1.0, 0.5, 3.0]);
  await testMxd();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
