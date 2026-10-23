// Cybiko melodies (.mus, .music): a port of tools/cybiko_music.py.
(function (C) {
  "use strict";
  const U = C.util;
  const M = C.music = {};

  const TICK_US = 10000;                  // one tick of a note's length
  const TIMER_HZ = 2304000;               // the sound timer: 18.432 MHz / 8
  const PERIODS = [0x44CCF, 0x40F07, 0x3D4B6, 0x39DAB, 0x369B7, 0x338AD,
    0x30A64, 0x2DEB4, 0x2B578, 0x28E8C, 0x269CF, 0x24722];
  const LOWEST = 29, HIGHEST = 127;
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const REST = 0xFF, VIBRATO = 0xF8, GLIDE = 0xF9, LOOP0 = 0xFA;

  // ---- notes -----------------------------------------------------------------

  M.noteName = n => NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);

  const BY_LENGTH = NAMES.filter(n => n.length === 2).concat(NAMES.filter(n => n.length === 1));
  M.parseNote = function (s) {
    s = s.trim();
    for (const name of BY_LENGTH) {
      if (s.toUpperCase().startsWith(name)) {
        let n;
        try { n = NAMES.indexOf(name) + 12 * (U.int(s.slice(name.length)) + 1); } catch (e) { break; }
        if (n >= 0 && n <= 127) return n;
      }
    }
    throw new Error("not a note: '" + s + "' (write it like C4, F#3 or A5)");
  };

  const byteToNote = b => b <= 0x43 ? b + 41 : b - 0x44;

  function noteToByte(n, version) {
    if (version === 0) {
      if (!(n >= 41 && n <= 108)) throw new Error(M.noteName(n) + " is out of range for version 0 (F2 to C8)");
      return n - 41;
    }
    return n + 0x44;
  }

  const period = n => (n < LOWEST || n > HIGHEST) ? 0xFFFF : PERIODS[n % 12] >> Math.floor(n / 12);

  // ---- the file ------------------------------------------------------------------

  M.Melody = function (version = 1, pulse = 1000, volume = 128, envelope = 0, events) {
    return { version, pulse, volume, envelope, events: events || [] };
  };

  M.load = function (data, warnings) {
    if (data.length < 4) throw new Error("too short for a melody");
    const version = data[0], one = data[1], size = U.u16be(data, 2);
    if (version > 2 || one !== 1) throw new Error("not a Cybiko melody (version " + version + ", second byte " + one + ")");
    const m = M.Melody(version);
    let pos = 4;
    if (version === 2) {
      if (data.length < 9) throw new Error("version 2 header cut short");
      m.pulse = U.u16be(data, 4); m.volume = data[6]; m.envelope = U.u16be(data, 7);
      pos = 9;
    }
    if (size === 0 || size % 2) throw new Error("bad event size " + size + " (the player wants an even, non-zero size)");
    const body = data.subarray(pos, pos + size);
    if (body.length < size) throw new Error("file cut short: " + body.length + " of " + size + " event bytes");
    if (data.length > pos + size && warnings)
      warnings.push("warning: " + (data.length - pos - size) + " bytes after the events ignored");
    for (let i = 0; i < size; i += 2) m.events.push([body[i], body[i + 1]]);
    return m;
  };

  M.save = function (m) {
    const n = m.events.length * 2;
    if (!n) throw new Error("a melody needs at least one event");
    if (n > 0xFFFF) throw new Error("too many events");
    const out = new U.Buf().u8(m.version).u8(1).u16be(n);
    if (m.version === 2) out.u16be(m.pulse).u8(m.volume).u16be(m.envelope);
    for (const [a, b] of m.events) out.u8(a).u8(b);
    return out.done();
  };

  // ---- text ------------------------------------------------------------------------

  M.toText = function (m) {
    const lines = ["# Cybiko melody (cybiko_music.py); lengths in ticks of 10 ms", "version " + m.version];
    if (m.version === 2) lines.push("pulse " + m.pulse, "volume " + m.volume, "envelope " + m.envelope);
    const old = m.version === 0;
    for (const [a, b] of m.events) {
      if (a === REST) lines.push("rest " + b);
      else if (a === VIBRATO) lines.push("vibrato " + b);
      else if (a === GLIDE && (b <= 0x43) === old && b <= 0xC3) lines.push("glide " + M.noteName(byteToNote(b)));
      else if (a >= LOOP0 && a <= 0xFE) lines.push(b ? "loop " + (a - LOOP0) + " " + b : "next " + (a - LOOP0));
      else if (a <= 0xC3 && (a <= 0x43) === old && b) lines.push(M.noteName(byteToNote(a)) + " " + b);
      else lines.push("raw 0x" + U.hex(a, 2) + " " + b);
    }
    return lines.join("\n") + "\n";
  };

  function num(s, lo, hi) {
    if (s === undefined) throw new Error("list index out of range");
    const v = U.int(s, true);
    if (!(v >= lo && v <= hi)) throw new Error(s + " is out of range " + lo + "-" + hi);
    return v;
  }

  M.fromText = function (text) {
    const m = M.Melody(null), body = [];
    U.splitlines(text).forEach((raw, idx) => {
      const no = idx + 1;
      const line = raw.split(";")[0].split(/(?:^|\s)#/)[0].trim();
      if (!line) return;
      const w = line.split(/\s+/), k = w[0].toLowerCase();
      try {
        if (["version", "pulse", "volume", "envelope"].includes(k)) {
          const lim = { version: 2, pulse: 0xFFFF, volume: 255, envelope: 0xFFFF }[k];
          m[k] = num(w[1], 0, lim);
        } else body.push([no, k, w.slice(1)]);
      } catch (e) { throw new Error("line " + no + ": " + e.message); }
    });
    if (m.version === null) m.version = 1;
    for (const [no, k, args] of body) {
      try {
        if (k === "rest") m.events.push([REST, num(args[0], 1, 255)]);
        else if (k === "vibrato") m.events.push([VIBRATO, num(args[0], 0, 255)]);
        else if (k === "glide") {
          if (args[0] === undefined) throw new Error("list index out of range");
          m.events.push([GLIDE, noteToByte(M.parseNote(args[0]), m.version)]);
        } else if (k === "loop") m.events.push([LOOP0 + num(args[0], 0, 4), num(args[1], 1, 255)]);
        else if (k === "next") m.events.push([LOOP0 + num(args[0], 0, 4), 0]);
        else if (k === "raw") m.events.push([num(args[0], 0, 255), num(args[1], 0, 255)]);
        else m.events.push([noteToByte(M.parseNote(k), m.version), num(args[0], 1, 255)]);
      } catch (e) { throw new Error("line " + no + ": " + e.message); }
    }
    return m;
  };

  // ---- playing it, the way CyOS's melody player does ----------------------------------

  // [{ticks, tone: [timer period per tick]}], silence as period 0.
  M.play = function (m, warnings) {
    const out = [], ev = m.events, loops = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
    let i = 0, steps = 0;
    while (i < ev.length) {
      if (++steps > 1000000) {
        if (warnings) warnings.push("warning: stopped after a million events (a loop that never ends?)");
        break;
      }
      const [a, b] = ev[i];
      if (a >= LOOP0 && a <= 0xFE) {
        const slot = loops[a - LOOP0];
        if (b) { slot[0] = b; slot[1] = i + 1; i++; }
        else {
          const left = slot[0];
          slot[0] = (left - 1) & 0xFFFF;
          i = left ? slot[1] : i + 1;
        }
        continue;
      }
      if (a === VIBRATO || a === GLIDE) { i++; continue; }
      const ticks = b ? b : 0x10000;
      if (a === REST) {
        out.push({ ticks, tone: new Array(ticks).fill(0) });
        i++;
        continue;
      }
      const pc = a <= 0xC3 ? period(byteToNote(a)) : 0xFFFF;
      if (a > 0xC3 && warnings)
        warnings.push("warning: byte " + U.hex(a, 2) + " is not a note; the player plays it as its lowest tone");
      let tone = new Array(ticks).fill(pc);
      if (i + 1 < ev.length && ev[i + 1][0] === GLIDE) {
        const pt = period(byteToNote(ev[i + 1][1]));
        for (let j = 1; j < ticks; j++) tone[j] = pc + Math.trunc((pt - pc) * j / ticks);
        i++;
      } else if (i + 1 < ev.length && ev[i + 1][0] === VIBRATO) {
        const d = ev[i + 1][1];
        if (d) {
          const n = byteToNote(a);
          let lo = period(n - d), hi = period(Math.min(n + d, 127));
          for (let r = 0; r < 3; r++) { lo = (lo + pc) >> 1; hi = (hi + pc) >> 1; }
          const table = [(lo + pc) >> 1, lo, (lo + pc) >> 1, pc, (pc + hi) >> 1, hi, (pc + hi) >> 1, pc];
          for (let k = 0; k < ticks - 1; k++) tone[k + 1] = table[(k & 15) >> 1];
        }
        i++;
      }
      out.push({ ticks, tone });
      i++;
    }
    return out;
  };

  M.seconds = (m, warnings) => M.play(m, warnings).reduce((s, p) => s + p.ticks, 0) / 100;

  M.info = function (m, warnings) {
    let s = "version " + m.version + ", " + m.events.length + " events, " + U.fixed(M.seconds(m, warnings), 2) + " s\n";
    if (m.version === 2)
      s += "pulse " + m.pulse + " us, volume " + m.volume + ", envelope " + (m.envelope ? m.envelope + ".amp" : "none") + "\n";
    return s;
  };

  M.loadAmp = d => {
    const t = U.u16be(d, 1), n = U.u16be(d, 3), pts = [];
    for (let i = 0; i < n; i++) pts.push(U.u16be(d, 5 + 2 * i));
    return { t, pts };
  };

  // Pulse widths in timer ticks, one per pulse; null for a square wave.
  // amps: Map of envelope number -> .amp bytes (or null).
  M.envelope = function (m, amps, warnings) {
    if (m.version !== 2) return null;
    let x = m.pulse;
    const vol = m.volume;
    if (!m.envelope) return x ? [((U.floorDiv(0x1200 * x, 1000) * vol) >> 8) & 0xFFFF] : null;
    const amp = amps && amps.get(m.envelope);
    if (!amp) {
      if (warnings) warnings.push("warning: " + m.envelope + ".amp not found, playing without the envelope");
      return null;
    }
    let { t, pts } = M.loadAmp(amp);
    if (!t) t = x;
    if (!x) x = t;
    if (!pts.length || !x) return null;
    const count = U.floorDiv((pts.length - 1) * t + x - 1, x) + 1;
    const scale = (U.floorDiv(0x900 * x, 1000) * vol) >> 8;
    const env = [];
    for (let k = 0; k < count; k++) {
      const at = k * x;
      const j = t ? Math.min(U.floorDiv(at, t), pts.length - 1) : pts.length - 1;
      let v;
      if (j + 1 < pts.length && t) {
        const a = pts[j] >> 1, b = pts[j + 1] >> 1;
        v = a + U.floorDiv((b - a) * (at - j * t), t);
      } else v = pts[j] >> 1;
      env.push(Math.max(U.floorDiv(scale * v, 32768), 10));
    }
    return env;
  };

  // 8-bit samples of the speaker.
  M.render = function (m, rate, amps, warnings) {
    const env = M.envelope(m, amps, warnings);
    const out = new U.Buf(), step = TIMER_HZ / rate;
    let done = 0;
    for (const { tone } of M.play(m, warnings)) {
      let t = 0.0, k = 0;
      for (const p of tone) {
        done++;
        const upto = U.round(done * rate * TICK_US / 1e6);
        while (out.n < upto) {
          if (!p) { out.u8(128); continue; }
          const high = env ? env[Math.min(k, env.length - 1)] : (p + 1) >> 1;
          out.u8(t < high ? 200 : 56);
          t += step;
          if (t >= p + 1) { t -= p + 1; k++; }
        }
      }
    }
    return out.done();
  };

  // What Python's wave module writes for 8-bit mono.
  M.wav8 = function (samples, rate) {
    return new U.Buf().str("RIFF").u32le(36 + samples.length).str("WAVEfmt ").u32le(16)
      .u16le(1).u16le(1).u32le(rate).u32le(rate).u16le(1).u16le(8)
      .str("data").u32le(samples.length).bytes(samples).done();
  };

  // ---- MIDI ------------------------------------------------------------------------------

  function readVlq(d, i) {
    let v = 0;
    for (;;) {
      if (i >= d.length) throw new Error("index out of range");
      const b = d[i++];
      v = v * 128 + (b & 0x7F);
      if (!(b & 0x80)) return [v, i];
    }
  }

  M.readMidi = function (data) {
    if (!U.startsWith(data, "MThd")) throw new Error("not a MIDI file (no MThd)");
    const hl = U.u32be(data, 4), ntrk = U.u16be(data, 10), div = U.u16be(data, 12);
    if (div & 0x8000) throw new Error("SMPTE time in MIDI files is not supported");
    let pos = 8 + hl;
    const tempoMap = [], names = [], raw = [];
    for (let k = 0; k < ntrk; k++) {
      if (!U.startsWith(data.subarray(pos, pos + 4), "MTrk")) throw new Error("bad MIDI track header");
      const size = U.u32be(data, pos + 4), d = data.subarray(pos + 8, pos + 8 + size);
      pos += 8 + size;
      let i = 0, tick = 0, status = 0, name = "";
      const evs = [];
      while (i < d.length) {
        let delta;
        [delta, i] = readVlq(d, i);
        tick += delta;
        const b = d[i];
        if (b === 0xFF) {
          const kind = d[i + 1];
          let ln, j;
          [ln, j] = readVlq(d, i + 2);
          const body = d.subarray(j, j + ln);
          i = j + ln;
          if (kind === 0x51 && ln === 3) tempoMap.push([tick, body[0] << 16 | body[1] << 8 | body[2]]);
          else if (kind === 3 && !name) name = U.latin1(body);
          else if (kind === 0x2F) break;
          continue;
        }
        if (b === 0xF0 || b === 0xF7) {
          let ln, j;
          [ln, j] = readVlq(d, i + 1);
          i = j + ln;
          continue;
        }
        if (b & 0x80) { status = b; i++; }
        const hi = status & 0xF0, n = hi === 0xC0 || hi === 0xD0 ? 1 : 2;
        const args = d.subarray(i, i + n);
        i += n;
        if (hi === 0x90 && args[1]) evs.push([tick, 1, args[0], args[1], status & 15]);
        else if (hi === 0x80 || hi === 0x90) evs.push([tick, 0, args[0], 0, status & 15]);
      }
      raw.push(evs);
      names.push(name);
    }
    tempoMap.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const us = tick => {
      let t = 0, last = 0, tempo = 500000;
      for (const [at, tp] of tempoMap) {
        if (at >= tick) break;
        t += (at - last) * tempo / div;
        last = at; tempo = tp;
      }
      return t + (tick - last) * tempo / div;
    };
    const tracks = raw.map(evs => evs.map(([t, on, note, vel, ch]) => [us(t), on, note, vel, ch]));
    return { tracks, names };
  };

  function vlq(v) {
    const out = [v & 0x7F];
    v = Math.floor(v / 128);
    while (v) { out.push(0x80 | (v & 0x7F)); v = Math.floor(v / 128); }
    return out.reverse();
  }

  M.toMidi = function (m, warnings) {
    const vel = m.version !== 2 ? 100 : Math.max(1, Math.min(127, U.floorDiv(m.volume * 127, 255)));
    const notes = new Map();
    for (let c = HIGHEST; c >= LOWEST; c--) notes.set(period(c), c);
    const evs = [[0, [0xFF, 0x51, 0x03, 0x0F, 0x42, 0x40]],
      [0, [0xFF, 0x03, 0x0C, ...U.toLatin1("Cybiko music")]],
      [0, [0xB0, 101, 0]], [0, [0xB0, 100, 0]], [0, [0xB0, 6, 12]], [0, [0xC0, 80]]];
    let now = 0, missing = 0;
    for (const { ticks, tone } of M.play(m, warnings)) {
      const p0 = tone[0], n = notes.get(p0);
      if (p0 && n === undefined) missing++;
      if (p0 && n !== undefined) {
        evs.push([now, [0x90, n, vel]]);
        let last = p0;
        for (let j = 1; j < tone.length; j++) {
          const p = tone[j];
          if (p !== last) {
            const semis = 12 * Math.log2(p0 / p);
            const bend = Math.max(0, Math.min(16383, U.round(8192 + semis / 12 * 8192)));
            evs.push([now + j, [0xE0, bend & 0x7F, bend >> 7]]);
            last = p;
          }
        }
        evs.push([now + ticks, [0x80, n, 0]]);
        if (last !== p0) evs.push([now + ticks, [0xE0, 0, 64]]);
      }
      now += ticks;
    }
    if (missing && warnings) warnings.push("warning: " + missing + " tones the player has no note for were left out");
    const body = [];
    let at = 0;
    for (const [t, e] of evs.concat([[now, [0xFF, 0x2F, 0x00]]])) {
      body.push(...vlq(t - at), ...e);
      at = t;
    }
    return new U.Buf().str("MThd").u32be(6).u16be(0).u16be(1).u16be(100)
      .str("MTrk").u32be(body.length).bytes(body).done();
  };

  // opts: {tracks: [..] | null, transpose, style, version, envelope, pulse, volume}
  M.fromMidi = function (data, opts, warnings) {
    const o = Object.assign({ tracks: null, transpose: 0, style: "high", version: 1, envelope: 0, pulse: 1000, volume: 128 }, opts);
    const { tracks: trk } = M.readMidi(data);
    const keep = o.tracks === null ? trk.map((_, k) => k) : o.tracks;
    let evs = [];
    for (const k of keep) {
      if (!(k >= 0 && k < trk.length)) throw new Error("there is no track " + k + " (the file has " + trk.length + ")");
      for (const [t, on, note, , ch] of trk[k]) if (ch !== 9) evs.push([t, on, note, ch, k]);
    }
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const held = [], line = [], skipped = [0, 0];
    const nowPlaying = () => !held.length ? null
      : o.style === "high" ? Math.max(...held.map(h => h[0])) : held[held.length - 1][0];
    for (const [t, on, note, ch, k] of evs) {
      const n = note + o.transpose;
      if (on) {
        if (n > 127) { skipped[0]++; continue; }
        if (n < 0) { skipped[1]++; continue; }
        held.push([n, ch, k]);
      } else {
        for (let h = held.length - 1; h >= 0; h--)
          if (held[h][0] === n && held[h][1] === ch && held[h][2] === k) { held.splice(h, 1); break; }
      }
      const p = nowPlaying();
      if (line.length && line[line.length - 1][0] === t) line[line.length - 1] = [t, p];
      else if (!line.length || line[line.length - 1][1] !== p) line.push([t, p]);
    }
    if ((skipped[0] || skipped[1]) && warnings)
      warnings.push("warning: " + skipped[0] + " notes over 127 and " + skipped[1] + " under 0 after transposing were left out");
    const m = M.Melody(o.version, o.pulse, o.volume, o.envelope);
    let low = 0;
    for (let q = 0; q + 1 < line.length; q++) {
      const [t] = line[q], [t2] = line[q + 1];
      let n = line[q][1];
      let ticks = U.round(t2 / TICK_US) - U.round(t / TICK_US);
      if (ticks <= 0) continue;
      if (n !== null && !(n >= LOWEST && n <= HIGHEST && (o.version || (n >= 41 && n <= 108)))) { low++; n = null; }
      const code = n === null ? REST : noteToByte(n, o.version);
      if (!m.events.length && code === REST) continue;
      const lastEv = m.events[m.events.length - 1];
      if (m.events.length && code === REST && lastEv[0] === REST && lastEv[1] + ticks <= 255) {
        m.events[m.events.length - 1] = [REST, lastEv[1] + ticks];
        continue;
      }
      while (ticks > 255) { m.events.push([code, 255]); ticks -= 255; }
      m.events.push([code, ticks]);
    }
    while (m.events.length && m.events[m.events.length - 1][0] === REST) m.events.pop();
    if (low && warnings)
      warnings.push("warning: " + low + " notes the Cybiko can't play (below F1, or out of F2-C8 for version 0) became rests");
    if (!m.events.length) throw new Error("no notes in the chosen tracks");
    return m;
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
