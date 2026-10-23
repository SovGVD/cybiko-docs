// Cybiko sound envelopes (.amp) and Cybiko Converter's text (.a): a port of
// tools/cybiko_amp.py.
(function (C) {
  "use strict";
  const U = C.util;
  const A = C.amp = {};

  A.load = function (data, warnings) {
    if (data.length < 5) throw new Error("too short for an envelope");
    const version = data[0], t = U.u16be(data, 1), n = U.u16be(data, 3);
    if (data.length < 5 + 2 * n)
      throw new Error("cut short: " + n + " points announced, " + ((data.length - 5) >> 1) + " there");
    if (data.length > 5 + 2 * n && warnings)
      warnings.push("warning: " + (data.length - 5 - 2 * n) + " bytes after the points ignored");
    const points = [];
    for (let i = 0; i < n; i++) points.push(U.u16be(data, 5 + 2 * i));
    return { version, t, points };
  };

  A.save = function ({ version, t, points }) {
    if (!points.length) throw new Error("an envelope needs at least one point");
    if (points.length > 0xFFFF) throw new Error("too many points");
    if (t === 0 && points.length > 1) throw new Error("Tdiscret 0 is only allowed with one point (as in Converter)");
    const out = new U.Buf().u8(version).u16be(t).u16be(points.length);
    for (const p of points) out.u16be(p);
    return out.done();
  };

  // Converter's expansion of [level, step] pairs into points.
  A.expand = function (keys) {
    const out = [];
    let prev = keys[0][0];
    for (const [v, step] of keys) {
      if (step < 2) out.push(v);
      else {
        const diff = v - prev;
        for (let k = 1; k <= step; k++) out.push(prev + Math.trunc(diff * k / step));
      }
      prev = v;
    }
    return out;
  };

  // The shortest [level, step] list that expands back to these points.
  A.compress = function (points) {
    const keys = [[points[0], 1]];
    let i = 1;
    while (i < points.length) {
      const prev = points[i - 1];
      let best = 1;
      for (let step = points.length - i; step > 1; step--) {
        const v = points[i + step - 1];
        let ok = true;
        for (let k = 1; k <= step && ok; k++) ok = points[i + k - 1] === prev + Math.trunc((v - prev) * k / step);
        if (ok) { best = step; break; }
      }
      keys.push([points[i + best - 1], best]);
      i += best;
    }
    return keys;
  };

  A.level = function (v) {
    const s = U.fixed(v / 65535, 6).replace(/0+$/, "");
    return s.endsWith(".") ? s + "0" : s;
  };

  A.toText = function ({ version, t, points }) {
    const lines = [";", "; Cybiko sound envelope (cybiko_amp.py), Cybiko Converter's .a format",
      ";", "Version   " + version, "Tdiscret  " + U.fixed(t / 1000, 3), ";"];
    A.compress(points).forEach(([v, step], i) => {
      lines.push(i === 0 ? "      " + A.level(v) : U.padR(step, 5) + " " + A.level(v));
    });
    lines.push("end");
    return lines.join("\r\n") + "\r\n";
  };

  A.info = function ({ version, t, points }) {
    return "version " + version + ", " + points.length + " points " + t + " us apart (" +
      U.fixed((points.length - 1) * t / 1000, 1) + " ms long)\n" + points.map(A.level).join(" ") + "\n";
  };

  A.fromText = function (text) {
    let version = 0, t = null;
    const keys = [];
    const lines = U.splitlines(text);
    for (let idx = 0; idx < lines.length; idx++) {
      const raw = lines[idx], line = raw.split(";")[0].trim();
      if (!line) continue;
      const w = line.split(/\s+/), k = w[0].toLowerCase();
      try {
        if (k === "version") {
          if (w[1] === undefined) throw new Error("list index out of range");
          version = U.int(w[1]);
          if (!(version >= 0 && version <= 255)) throw new Error("version out of range");
        } else if (k === "tdiscret") {
          if (w[1] === undefined) throw new Error("list index out of range");
          t = U.round(U.float(w[1]) * 1000);
          if (!(t >= 0 && t <= 0xFFFF)) throw new Error("Tdiscret must be 0 to 65.535 ms");
        } else if (k === "end") break;
        else {
          const [step, val] = w.length === 1 ? [1, w[0]] : [U.int(w[0]), w[1]];
          const v = Math.trunc(U.float(val) * 65535 + 0.5);
          if (step < 1 || step > 0xFFFF || !(v >= 0 && v <= 0xFFFF))
            throw new Error("bad step or level (levels are 0.0 to 1.0)");
          keys.push([v, step]);
        }
      } catch (e) {
        throw new Error("line " + (idx + 1) + ": " + raw.trim() + ": " + e.message);
      }
    }
    if (t === null) throw new Error("no Tdiscret line");
    if (!keys.length) throw new Error("no points");
    return { version, t, points: A.expand(keys) };
  };
})(globalThis.Cybiko = globalThis.Cybiko || {});
