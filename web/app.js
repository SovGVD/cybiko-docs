// The page: wires the converters in lib/ to the forms in index.html.
(function () {
  "use strict";
  const C = window.Cybiko, U = C.util;
  const $ = id => document.getElementById(id);

  // ---- small helpers ---------------------------------------------------------

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false)
      e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }

  const MIME = { png: "image/png", wav: "audio/wav", mid: "audio/midi", mp3: "audio/mpeg", zip: "application/zip",
    txt: "text/plain", a: "text/plain" };
  const urls = new Map();                   // revoke an output's old blob when it is replaced
  function blobUrl(key, data, type) {
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
    const u = URL.createObjectURL(new Blob([data], { type: type || "application/octet-stream" }));
    urls.set(key, u);
    return u;
  }
  let linkNo = 0;
  function save(name, data, label) {
    const ext = name.split(".").pop().toLowerCase();
    return el("a", { href: blobUrl("l" + linkNo++, data, MIME[ext]), download: name }, label || "Save " + name);
  }

  // Replaces a box's contents, skipping empty (null) items.
  const put = (box, ...kids) => box.replaceChildren(...kids.filter(k => k !== null && k !== undefined && k !== false));

  const readFile = f => f.arrayBuffer().then(b => new Uint8Array(b));
  const base = name => U.splitext(name.replace(/^.*[\\/]/, ""))[0];

  function fail(box, e) {
    put(box, el("p", { class: "error" }, e && e.message ? e.message : String(e)));
  }
  const warnBox = w => w && w.length ? el("p", { class: "warn" }, w.join("\n")) : null;

  // A canvas showing grey rows (0-255), each pixel zoom x zoom.
  function greyCanvas(w, h, rows, zoom) {
    const c = el("canvas", { class: "screen", width: w, height: h });
    c.style.width = w * zoom + "px";
    c.style.height = h * zoom + "px";
    const ctx = c.getContext("2d"), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = rows[y][x], i = 4 * (y * w + x);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ---- tabs and drop zones -------------------------------------------------------

  function showTab() {
    const id = (location.hash || "#archives").slice(1);
    const known = [...document.querySelectorAll(".tool")].some(s => s.id === id);
    for (const s of document.querySelectorAll(".tool")) s.classList.toggle("on", s.id === (known ? id : "archives"));
    for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("on", a.getAttribute("href") === "#" + (known ? id : "archives"));
  }
  window.addEventListener("hashchange", showTab);
  showTab();

  function nameDrop(input, files) {
    const box = input.closest(".drop");
    if (!box) return;
    let n = box.querySelector(".name");
    if (!n) box.append(n = el("span", { class: "name" }));
    n.textContent = files.length > 1 ? files.length + " files" : files[0] ? files[0].name : "";
  }
  for (const box of document.querySelectorAll(".drop")) {
    const input = box.querySelector("input");
    box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("over"); });
    box.addEventListener("dragleave", () => box.classList.remove("over"));
    box.addEventListener("drop", () => box.classList.remove("over"));
    input.addEventListener("change", () => nameDrop(input, input.files));
  }
  function onFile(id, fn) {
    $(id).addEventListener("change", async () => {
      const f = $(id).files[0];
      if (f) fn(f.name, await readFile(f), f);
    });
  }

  // Hands a file to the tool for its format.
  function openIn(name, data) {
    const ext = (U.splitext(name)[1] || "").toLowerCase();
    let tab = null, fn = null;
    if (ext === ".pic" || ext === ".xpic") { tab = "pictures"; fn = showPic; }
    else if (ext === ".mus" || ext === ".music") { tab = "melodies"; fn = openMelody; }
    else if (ext === ".amp") { tab = "envelopes"; fn = openAmp; }
    else if (ext === ".wav") { tab = "recordings"; fn = openWav; }
    else if (U.startsWith(data, "Cy") && isClip(data)) { tab = "clips"; fn = playClip; }
    else if (U.startsWith(data, "Cy") || U.startsWith(data, "CAP")) { tab = "archives"; fn = openArchive; }
    if (!fn) return false;
    location.hash = tab;
    fn(name, data);
    window.scrollTo(0, 0);
    return true;
  }
  const canOpen = (name, data) => /\.(pic|xpic|mus|music|amp|wav)$/i.test(name) ||
    U.startsWith(data, "Cy") || U.startsWith(data, "CAP");
  const isText = name => /\.(inf|txt|js|help|a|kbd)$/i.test(name) || name === "install.js";
  function isClip(data) {
    try { return C.cap.cyEntries(data).some(p => p.name === "clip.pic"); } catch (e) { return false; }
  }

  // ---- packs and archives ---------------------------------------------------------------

  function fileTable(rows, head) {
    return el("div", { class: "table-wrap" }, el("table", { class: "files" },
      el("tr", {}, head.map(h => el("th", {}, h))), rows));
  }
  function partActions(name, data, viewBox) {
    return el("td", {},
      canOpen(name, data) ? el("button", { class: "quiet", onclick: () => openIn(name, data) }, "Open") : null, " ",
      isText(name) ? el("button", { class: "quiet", onclick: () => put(viewBox, el("h3", {}, name),
        el("pre", {}, new TextDecoder("latin1").decode(data))) }, "Text") : null, " ",
      save(C.cap.safeName(name), data, "Save"));
  }

  function openArchive(name, data) {
    const out = $("arc-out");
    try {
      const view = el("div");
      if (U.startsWith(data, "CAP")) {
        const entries = C.cap.parsePack(data), files = [];
        const rows = entries.map(e => {
          const kind = C.cap.TYPE_NAMES[e.type] || "type " + e.type;
          if (e.type !== 2 && e.type !== 3) return el("tr", {}, el("td", {}, e.name), el("td", {}, kind), el("td", { class: "num" }, e.size), el("td"));
          const d = C.cap.decodeFile(e);
          files.push({ name: C.cap.safeName(e.name), data: d });
          return el("tr", {}, el("td", {}, e.name), el("td", {}, kind), el("td", { class: "num" }, d.length), partActions(e.name, d, view));
        });
        put(out, el("p", {}, name + ": an EZ Loader pack with " + entries.length + " entries."),
          fileTable(rows, ["Name", "Kind", "Bytes", ""]),
          el("div", { class: "downloads" }, save(base(name) + ".zip", U.zip(files), "Save all as ZIP")), view);
        return;
      }
      if (U.startsWith(data, "Cy")) {
        const parts = C.cap.cyEntries(data), files = [];
        const rows = parts.map(p => {
          if (p.data) files.push({ name: C.cap.safeName(p.name), data: p.data });
          return el("tr", {}, el("td", {}, p.name), el("td", {}, "method " + p.method),
            el("td", { class: "num" }, p.data ? p.data.length : "?"), p.data ? partActions(p.name, p.data, view) : el("td", {}, "not unpacked"));
        });
        put(out, el("p", {}, name + ": a CyOS archive with " + parts.length + " parts." +
          (isClip(data) ? " It is an MXD clip: " : "")), isClip(data)
          ? el("p", {}, el("button", { class: "quiet", onclick: () => openIn(name, data) }, "Play the clip")) : null,
        fileTable(rows, ["Part", "Stored", "Bytes", ""]),
        el("div", { class: "downloads" }, save(base(name) + ".zip", U.zip(files), "Save all parts as ZIP")), view);
        return;
      }
      const found = C.cap.findArchives(data);
      if (!found.length) throw new Error(name + " is not a pack or an archive, and no archives were found in it");
      const files = [], blocks = [];
      for (const f of found) {
        const at = U.hex(f.pos, 6), rows = [];
        for (const p of C.cap.cyEntries(data.subarray(f.pos))) {
          if (p.data) files.push({ name: at + "/" + C.cap.safeName(p.name), data: p.data });
          rows.push(el("tr", {}, el("td", {}, p.name), el("td", { class: "num" }, p.data ? p.data.length : "?"),
            p.data ? partActions(p.name, p.data, view) : el("td", {}, "method " + p.method + ", not unpacked")));
        }
        blocks.push(el("details", {}, el("summary", {}, at + ": " + f.names.length + " parts (" + f.names.slice(0, 6).join(", ") +
          (f.names.length > 6 ? ", ..." : "") + ")"), fileTable(rows, ["Part", "Bytes", ""])));
      }
      put(out, el("p", {}, name + ": " + found.length + " archives found (CyOS's own applications)."),
        el("div", { class: "downloads" }, save(base(name) + "-archives.zip", U.zip(files), "Save all as ZIP (a folder for each offset)")),
        ...blocks, view);
    } catch (e) { fail(out, e); }
  }
  onFile("arc-file", openArchive);

  // Make an archive.
  let packFiles = [];
  async function setPackFiles(list, fromDir) {
    const files = [];
    for (const f of list) {
      if (fromDir && (f.webkitRelativePath || "").split("/").length > 2) continue;   // files in the folder only
      files.push({ name: f.name, data: await readFile(f) });
    }
    packFiles = files;
    $("pack-go").disabled = !files.length;
    put($("pack-out"));
    put($("pack-list"), fileTable(files.map(f => el("tr", {}, el("td", {}, f.name),
      el("td", { class: "num" }, f.data.length),
      el("td", {}, el("label", {}, el("input", { type: "checkbox", "data-store": f.name }), " store"))
    )), ["File", "Bytes", ""]));
    if (fromDir && list.length) $("pack-name").value = list[0].webkitRelativePath.split("/")[0] + ".app";
  }
  $("pack-files").addEventListener("change", () => setPackFiles($("pack-files").files, false));
  $("pack-dir").addEventListener("change", () => setPackFiles($("pack-dir").files, true));
  $("pack-go").addEventListener("click", () => {
    const out = $("pack-out");
    try {
      const store = new Set([...document.querySelectorAll("[data-store]")].filter(c => c.checked).map(c => c.dataset.store));
      const blob = C.cap.packFiles(packFiles, store), name = $("pack-name").value || "new.app";
      put(out, el("p", {}, name + ": " + packFiles.length + " parts, " + blob.length + " bytes"),
        el("div", { class: "downloads" }, save(name, blob)));
    } catch (e) { fail(out, e); }
  });

  // ---- pictures ------------------------------------------------------------------------------

  async function showPic(name, data) {
    const out = $("pic-out");
    try {
      const pic = C.pic.load(data), bad = C.pic.badPixels(pic);
      const zoom = Math.max(1, Math.min(4, Math.floor(640 / Math.max(pic.width, 1))));
      const each = [];
      for (let i = 0; i < pic.images.length; i++) {
        const m = pic.images[i];
        each.push({ name: base(name) + "-" + i + ".png", data: await U.greyPng(m.w, m.h, C.pic.imageRows(pic, m)) });
      }
      const whole = await U.greyPng(pic.width, pic.height, C.pic.canvasRows(pic));
      put(out, el("pre", {}, C.pic.info(pic)), warnBox(pic.warnings),
        bad ? el("p", { class: "warn" }, "warning: " + bad + " pixels have values 13-15, which Photo Viewer can't show (drawn black)") : null,
        pic.width && pic.height ? greyCanvas(pic.width, pic.height, C.pic.canvasRows(pic), zoom) : null,
        pic.images.length > 1 ? el("div", { class: "thumbs" }, pic.images.map((m, i) =>
          el("figure", {}, greyCanvas(m.w, m.h, C.pic.imageRows(pic, m), 2), "image " + i))) : null,
        el("div", { class: "downloads" }, save(base(name) + ".png", whole, "Save as PNG"),
          pic.images.length > 1 ? save(base(name) + "-images.zip", U.zip(each), "Save each image as PNG (ZIP)") : null));
    } catch (e) { fail(out, e); }
  }
  onFile("pic-file", showPic);

  let image = null, imageName = "";
  async function loadImage(name, data, file) {
    const out = $("img-out");
    try {
      if (C.pic.isOwnFormat(data)) image = await C.pic.readImage(data);
      else {
        const bmp = await createImageBitmap(file || new Blob([data]));
        const c = document.createElement("canvas");
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        image = C.pic.fromRgba(bmp.width, bmp.height, ctx.getImageData(0, 0, bmp.width, bmp.height).data);
      }
      imageName = name;
      convertImage();
    } catch (e) { image = null; fail(out, e); }
  }
  function convertImage() {
    const out = $("img-out");
    if (!image) return;
    try {
      const bpp = Number($("img-kind").value);
      const num = id => { const v = U.float($(id).value || "0"); if (isNaN(v)) throw new Error("not a number: " + $(id).value); return v; };
      const r = C.pic.fromImage(image, { bpp, size: $("img-size").value.trim() || null, fit: $("img-fit").value,
        dither: $("img-dither").value, brightness: num("img-brightness"), contrast: num("img-contrast"), gamma: num("img-gamma") });
      const pic = C.pic.load(r.data), name = base(imageName) + (bpp === 2 ? ".pic" : ".xpic");
      put(out, el("p", {}, name + ": " + r.w + " x " + r.h + ", " + C.pic.levels(bpp) + " greys, " + r.data.length + " bytes"),
        greyCanvas(r.w, r.h, C.pic.canvasRows(pic), Math.max(1, Math.min(4, Math.floor(640 / r.w)))),
        el("div", { class: "downloads" }, save(name, r.data)));
    } catch (e) { fail(out, e); }
  }
  onFile("img-file", loadImage);
  for (const id of ["img-kind", "img-size", "img-fit", "img-dither", "img-brightness", "img-contrast", "img-gamma"])
    $(id).addEventListener("change", convertImage);

  // ---- melodies ------------------------------------------------------------------------------

  const amps = new Map();
  let melodyName = "melody", midiData = null;

  function ampStatus() {
    $("amp-status").textContent = amps.size ? amps.size + " envelopes loaded (" +
      [...amps.keys()].sort((a, b) => a - b).slice(0, 8).join(", ") + (amps.size > 8 ? ", ..." : "") + ")." : "No envelopes loaded.";
  }
  $("amp-src").addEventListener("change", async () => {
    for (const f of $("amp-src").files) {
      const data = await readFile(f), m = /^(\d+)\.amp$/i.exec(f.name);
      try {
        if (m) { amps.set(Number(m[1]), data); continue; }
        const archives = U.startsWith(data, "Cy") ? [{ pos: 0 }] : C.cap.findArchives(data);
        for (const a of archives)
          for (const p of C.cap.cyEntries(data.subarray(a.pos))) {
            const k = /^(\d+)\.amp$/.exec(p.name);
            if (k && p.data) amps.set(Number(k[1]), p.data);
          }
      } catch (e) { console.warn(f.name, e); }
    }
    ampStatus();
  });

  function showMelody(m, warnings, note) {
    $("mus-text").value = C.music.toText(m);
    put($("mus-out"), note ? el("p", {}, note) : null, el("pre", {}, C.music.info(m, warnings)), warnBox(warnings));
    put($("mus-text-out"));
  }

  function openMelody(name, data) {
    const out = $("mus-out");
    melodyName = base(name);
    $("midi-opts").hidden = true;
    midiData = null;
    try {
      if (U.startsWith(data, "MThd")) {
        midiData = data;
        const { tracks, names } = C.music.readMidi(data);
        put($("midi-tracks"), el("span", { class: "note" }, "Tracks to keep (drum channel 10 is always left out): "),
          ...tracks.map((t, k) => el("label", {}, el("input", { type: "checkbox", checked: true, "data-track": k }),
            " " + k + (names[k] ? " " + names[k] : "") + " (" + t.filter(e => e[1]).length + " notes)")));
        $("midi-opts").hidden = false;
        put(out, el("p", {}, name + ": a MIDI file with " + tracks.length + " tracks. Pick the options and convert."));
        return;
      }
      const looksBinary = data.length >= 4 && data[0] <= 2 && data[1] === 1;
      if (!looksBinary || /\.txt$/i.test(name)) {
        const text = U.fromUtf8(data);
        const m = C.music.fromText(text), w = [];
        showMelody(m, w, name + ": read as text.");
        $("mus-text").value = text;
        return;
      }
      const w = [], m = C.music.load(data, w);
      showMelody(m, w, name + ":");
    } catch (e) { fail(out, e); }
  }
  onFile("mus-file", openMelody);

  function midiOptions() {
    const tracks = [...document.querySelectorAll("[data-track]")];
    const keep = tracks.filter(c => c.checked).map(c => Number(c.dataset.track));
    const version = Number($("midi-version").value);
    return { tracks: keep.length === tracks.length ? null : keep, transpose: U.int($("midi-transpose").value || "0"),
      style: $("midi-style").value, version, envelope: U.int($("midi-envelope").value || "0"),
      pulse: U.int($("midi-pulse").value || "0"), volume: U.int($("midi-volume").value || "0") };
  }
  function v2Fields() {
    for (const l of document.querySelectorAll("#midi-opts .v2")) l.hidden = $("midi-version").value !== "2";
  }
  $("midi-version").addEventListener("change", v2Fields);
  v2Fields();
  $("midi-go").addEventListener("click", () => {
    try {
      const w = [], m = C.music.fromMidi(midiData, midiOptions(), w);
      showMelody(m, w, "Converted: " + m.events.length + " events.");
    } catch (e) { fail($("mus-out"), e); }
  });

  function textMelody() {
    return C.music.fromText($("mus-text").value);
  }
  const musOut = $("mus-text-out");
  let player = null;
  $("mus-play").addEventListener("click", () => {
    try {
      const rate = Number($("mus-rate").value), w = [], m = textMelody();
      const wav = C.music.wav8(C.music.render(m, rate, amps, w), rate);
      if (player) player.pause();
      player = el("audio", { controls: true, src: blobUrl("mus-play", wav, "audio/wav") });
      put(musOut, player, warnBox(w));
      player.play().catch(() => {});
    } catch (e) { fail(musOut, e); }
  });
  $("mus-save").addEventListener("click", () => {
    try {
      const data = C.music.save(textMelody());
      put(musOut, el("div", { class: "downloads" }, save(melodyName + ".music", data)));
    } catch (e) { fail(musOut, e); }
  });
  $("mus-midi").addEventListener("click", () => {
    try {
      const w = [], data = C.music.toMidi(textMelody(), w);
      put(musOut, el("div", { class: "downloads" }, save(melodyName + ".mid", data)), warnBox(w));
    } catch (e) { fail(musOut, e); }
  });
  $("mus-wav").addEventListener("click", () => {
    try {
      const rate = Number($("mus-rate").value), w = [];
      const data = C.music.wav8(C.music.render(textMelody(), rate, amps, w), rate);
      put(musOut, el("div", { class: "downloads" }, save(melodyName + ".wav", data)), warnBox(w));
    } catch (e) { fail(musOut, e); }
  });

  // ---- envelopes --------------------------------------------------------------------------------

  function envPlot(points) {
    const n = points.length, w = Math.max(1, n - 1);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "env");
    svg.setAttribute("viewBox", "0 0 " + w + " 1");
    svg.setAttribute("preserveAspectRatio", "none");
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("points", (n === 1 ? [points[0], points[0]] : points).map((v, i) => i + "," + (1 - v / 65535 * 0.94 - 0.03)).join(" "));
    svg.append(line);
    return svg;
  }
  let ampName = "envelope";
  function showEnvelope(a, warnings, box) {
    put(box, el("pre", {}, C.amp.info(a)), warnBox(warnings), envPlot(a.points));
  }
  function openAmp(name, data) {
    const out = $("amp-out");
    ampName = base(name);
    $("amp-name").value = ampName + ".amp";
    try {
      if (/\.amp$/i.test(name) || (data.length >= 5 && data.length === 5 + 2 * U.u16be(data, 3))) {
        const w = [], a = C.amp.load(data, w), text = C.amp.toText(a);
        $("amp-text").value = text;
        showEnvelope(a, w, out);
        out.append(el("div", { class: "downloads" }, save(ampName + ".a", U.toLatin1(text), "Save as .a text")));
      } else {
        $("amp-text").value = U.latin1(data);
        put(out, el("p", {}, name + ": read as text; make the .amp below."));
      }
    } catch (e) { fail(out, e); }
  }
  onFile("amp-file", openAmp);
  $("amp-make").addEventListener("click", () => {
    const out = $("amp-make-out");
    try {
      const a = C.amp.fromText($("amp-text").value), data = C.amp.save(a);
      showEnvelope(a, [], out);
      out.append(el("div", { class: "downloads" }, save($("amp-name").value || "envelope.amp", data)));
    } catch (e) { fail(out, e); }
  });

  // ---- recordings --------------------------------------------------------------------------------

  let wavIn = null;
  // Sound the browser decodes, as a 16-bit PCM WAV at its own rate.
  async function decodeToWav(data) {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const buf = await ac.decodeAudioData(data.slice().buffer);
      const ch = buf.numberOfChannels, n = buf.length, out = new U.Buf();
      out.str("RIFF").u32le(36 + n * ch * 2).str("WAVEfmt ").u32le(16).u16le(1).u16le(ch).u32le(buf.sampleRate)
        .u32le(buf.sampleRate * ch * 2).u16le(ch * 2).u16le(16).str("data").u32le(n * ch * 2);
      const chans = [...Array(ch).keys()].map(k => buf.getChannelData(k));
      for (let i = 0; i < n; i++) for (const c of chans)
        out.u16le(Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))) & 0xFFFF);
      return out.done();
    } finally { ac.close(); }
  }
  async function openWav(name, data) {
    const out = $("wav-out");
    try {
      let note = null;
      if (!U.startsWith(data, "RIFF") || !wavOk(data)) {
        data = await decodeToWav(data);
        note = "Decoded by the browser into 16-bit PCM first.";
      }
      wavIn = { name, data, note };
      convertWav();
    } catch (e) { wavIn = null; fail(out, e); }
  }
  function wavOk(data) {
    try {
      const f = C.wav.fmt(C.wav.chunks(data));
      return f.tag === 0x11 || ((f.tag === 1 || f.tag === 0xFFFE) && (f.bits === 8 || f.bits === 16));
    } catch (e) { return false; }
  }
  function convertWav() {
    const out = $("wav-out");
    if (!wavIn) return;
    try {
      const c = C.wav.chunks(wavIn.data), { tag } = C.wav.fmt(c), name = base(wavIn.name);
      const parts = [wavIn.note ? el("p", { class: "note" }, wavIn.note) : null, el("pre", {}, C.wav.info(c))];
      if (tag === 0x11) {
        const pcm = C.wav.toPcm(c);
        parts.push(el("audio", { controls: true, src: blobUrl("wav-a", pcm, "audio/wav") }),
          el("div", { class: "downloads" }, save(name + "-pcm.wav", pcm, "Save as 16-bit PCM WAV")));
      } else {
        const gain = U.float($("wav-gain").value || "1");
        const r = C.wav.toCybiko(c, gain);
        parts.push(el("p", {}, "As a Cybiko recording: " + U.fixed(r.seconds, 2) + " s, " + r.data.length + " bytes. How it will sound:"),
          el("audio", { controls: true, src: blobUrl("wav-a", C.wav.toPcm(C.wav.chunks(r.data)), "audio/wav") }),
          el("div", { class: "downloads" }, save(name + "_cy.wav", r.data, "Save the Cybiko recording")));
      }
      put(out, ...parts);
    } catch (e) { fail(out, e); }
  }
  onFile("wav-file", openWav);
  $("wav-gain").addEventListener("change", convertWav);

  // ---- MXD clips ------------------------------------------------------------------------------------

  let clipStop = null;
  function playClip(name, data) {
    const out = $("clip-out");
    if (clipStop) clipStop();
    try {
      const clip = C.mxd.parse(data), zoom = 3, grey = [255, 170, 85, 0];
      if (!clip.frames.length) throw new Error("the clip has no frames");
      const canvas = el("canvas", { class: "screen", width: clip.w, height: clip.h });
      canvas.style.width = clip.w * zoom + "px";
      canvas.style.height = clip.h * zoom + "px";
      const ctx = canvas.getContext("2d"), img = ctx.createImageData(clip.w, clip.h);
      let shown = -1;
      const draw = k => {
        k = Math.max(0, Math.min(clip.frames.length - 1, k));
        if (k === shown) return;
        shown = k;
        const f = clip.frames[k];
        for (let i = 0; i < f.length; i++) {
          img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = grey[f[i]];
          img.data[4 * i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      };
      draw(0);
      const secs = clip.frames.length / clip.fps;
      let audio = null, raf = 0, t0 = 0, timer = false;
      const tick = () => {
        const t = audio ? audio.currentTime : (performance.now() - t0) / 1000;
        draw(Math.floor(t * clip.fps));
        if (timer && t > secs) timer = false;
        if ((audio && !audio.paused) || timer) raf = requestAnimationFrame(tick);
      };
      const controls = [];
      if (clip.music && clip.music.length) {
        audio = el("audio", { controls: true, src: blobUrl("clip-a", clip.music, "audio/mpeg") });
        audio.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
        audio.addEventListener("seeked", () => draw(Math.floor(audio.currentTime * clip.fps)));
        controls.push(audio);
      } else controls.push(el("button", { onclick: () => { t0 = performance.now(); timer = true; tick(); } }, "Play"));
      clipStop = () => { cancelAnimationFrame(raf); timer = false; if (audio) audio.pause(); };
      const pngs = async () => {
        const files = [];
        for (let k = 0; k < clip.frames.length; k++) {
          const rows = [];
          for (let y = 0; y < clip.h; y++) rows.push(Array.from(clip.frames[k].subarray(y * clip.w, (y + 1) * clip.w), v => grey[v]));
          files.push({ name: base(name) + "-" + String(k).padStart(4, "0") + ".png", data: await U.greyPng(clip.w, clip.h, rows) });
        }
        return U.zip(files);
      };
      const framesBtn = el("button", { class: "quiet", onclick: async () => {
        framesBtn.disabled = true;
        framesBtn.replaceWith(save(base(name) + "-frames.zip", await pngs(), "Save the frames (PNG, ZIP)"));
      } }, "Make a ZIP of the frames");
      put(out, el("p", {}, name + ": " + clip.frames.length + " frames of " + clip.w + " x " + clip.h + " at " +
        U.fixed(clip.fps, 2).replace(/\.?0+$/, "") + " fps (" + U.fixed(secs, 1) + " s), " +
        (clip.music ? Math.round(clip.music.length / 1024) + " KB of MP3" : "no sound") + "."),
      canvas, ...controls,
      el("div", { class: "downloads" }, clip.music ? save(base(name) + ".mp3", clip.music, "Save the sound (MP3)") : null, framesBtn));
    } catch (e) { fail(out, e); }
  }
  onFile("clip-file", playClip);

  // Make a clip.
  const ready = () => { $("mk-go").disabled = !$("mk-video").files[0] || !$("mk-template").files[0] ||
    ($("mk-audio").value === "file" && !$("mk-mp3").files[0]); };
  for (const id of ["mk-video", "mk-template", "mk-mp3"]) $(id).addEventListener("change", ready);
  $("mk-audio").addEventListener("change", () => { $("mk-mp3-box").hidden = $("mk-audio").value !== "file"; ready(); });

  const once = (t, ev) => new Promise((res, rej) => {
    const ok = () => { t.removeEventListener("error", bad); res(); };
    const bad = () => { t.removeEventListener(ev, ok); rej(new Error("the browser cannot decode this video")); };
    t.addEventListener(ev, ok, { once: true });
    t.addEventListener("error", bad, { once: true });
  });

  async function videoFrames(file, o, progress) {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    v.src = blobUrl("mk-video", file);
    await once(v, "loadeddata");
    const W = C.mxd.W, H = C.mxd.H, dur = v.duration;
    if (!isFinite(dur) || !v.videoWidth) throw new Error("no video frames in " + file.name);
    const end = o.duration ? Math.min(dur, o.start + o.duration) : dur;
    const n = Math.max(1, Math.round((end - o.start) * o.fps));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    const sw = v.videoWidth, sh = v.videoHeight;
    const s = o.fit === "pad" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    const dw = sw * s, dh = sh * s, frames = [];
    for (let k = 0; k < n; k++) {
      const t = Math.min(o.start + k / o.fps, dur - 0.001);
      if (Math.abs(v.currentTime - t) > 1e-6) { v.currentTime = t; await once(v, "seeked"); }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const px = ctx.getImageData(0, 0, W, H).data, f = new Uint8Array(W * H);
      for (let i = 0; i < f.length; i++) f[i] = Math.round(0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]);
      frames.push(f);
      progress(k + 1, n);
    }
    return frames;
  }

  let lameLoading = null;
  function loadLame() {
    if (window.lamejs) return Promise.resolve();
    return lameLoading = lameLoading || new Promise((res, rej) => {
      const s = el("script", { src: "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js" });
      s.onload = () => res();
      s.onerror = () => { lameLoading = null; rej(new Error("could not load lamejs (the MP3 encoder); choose an MP3 file for the sound instead")); };
      document.head.append(s);
    });
  }
  async function videoSound(file, o) {
    await loadLame();
    const hifi = o.audio === "hifi", rate = hifi ? 44100 : 22050, chans = hifi ? 2 : 1, kbps = hifi ? 128 : 64;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    let buf;
    try { buf = await ac.decodeAudioData(await file.arrayBuffer()); }
    catch (e) { throw new Error("the browser cannot decode the video's sound; choose an MP3 file for the sound instead"); }
    finally { ac.close(); }
    const end = o.duration ? Math.min(buf.duration, o.start + o.duration) : buf.duration;
    const len = Math.max(1, Math.ceil((end - o.start) * rate));
    const off = new OfflineAudioContext(chans, len, rate), src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0, o.start, end - o.start);
    const pcm = await off.startRendering();
    const enc = new window.lamejs.Mp3Encoder(chans, rate, kbps), parts = [];
    const ints = [...Array(chans).keys()].map(k => {
      const f = pcm.getChannelData(k), a = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
      return a;
    });
    for (let i = 0; i < len; i += 1152) {
      const chunk = ints.map(a => a.subarray(i, i + 1152));
      const mp3 = chans === 2 ? enc.encodeBuffer(chunk[0], chunk[1]) : enc.encodeBuffer(chunk[0]);
      if (mp3.length) parts.push(new Uint8Array(mp3.buffer, mp3.byteOffset, mp3.length).slice());
    }
    const last = enc.flush();
    if (last.length) parts.push(new Uint8Array(last.buffer, last.byteOffset, last.length).slice());
    return C.mxd.plainMp3(U.concat(parts));
  }

  $("mk-go").addEventListener("click", async () => {
    const out = $("mk-out"), video = $("mk-video").files[0], go = $("mk-go");
    const bar = el("progress", { max: 1, value: 0 }), status = el("p", { class: "note" }, "Reading the template...");
    put(out, status, bar);
    go.disabled = true;
    try {
      const num = (id, dflt) => { const s = $(id).value.trim(); return s ? U.float(s) : dflt; };
      const o = { fps: num("mk-fps", 5), start: num("mk-start", 0), duration: num("mk-duration", 0), fit: $("mk-fit").value,
        dither: $("mk-dither").value, gamma: num("mk-gamma", 1.0), audio: $("mk-audio").value };
      if (!(o.fps >= 1 && o.fps <= 5)) throw new Error("frames a second must be 1 to 5");
      const name = $("mk-name").value || base(video.name);
      const player = C.mxd.templatePlayer(await readFile($("mk-template").files[0]));
      status.textContent = "Taking the frames from the video...";
      const frames = await videoFrames(video, o, (k, n) => { bar.max = n; bar.value = k; status.textContent = "Frame " + k + " of " + n; });
      status.textContent = "Making the sound...";
      bar.removeAttribute("value");
      const music = o.audio === "file" ? C.mxd.plainMp3(await readFile($("mk-mp3").files[0])) : await videoSound(video, o);
      status.textContent = "Compressing...";
      await new Promise(r => setTimeout(r, 30));
      const clip = C.mxd.build({ frames, music, player, name, fps: o.fps, dither: o.dither, gamma: o.gamma });
      const file = name.replace(/[\\/:*?"<>|]/g, "_") + ".app";
      put(out, el("p", {}, file + ": " + frames.length + " frames, " + U.fixed(frames.length / o.fps, 1) + " s, " +
        Math.round(clip.length / 1024) + " KB"),
      el("div", { class: "downloads" }, save(file, clip), el("button", { class: "quiet", onclick: () => { location.hash = "clips"; playClip(file, clip); window.scrollTo(0, 0); } }, "Play it")));
    } catch (e) { fail(out, e); }
    go.disabled = false;
    ready();
  });
})();
