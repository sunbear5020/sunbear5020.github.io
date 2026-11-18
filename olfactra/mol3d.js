/* OLFACTRA — 3-D molecular / receptor-binding viewer.
 *
 * Pure canvas 2D, no libraries and no network: everything it draws comes from
 * data.js, which tools/build_web_data.py generates from the Python engine.
 *
 *   · "분자 3D"     — the RDKit conformer of the selected molecule (ball & stick,
 *                     CPK colours, optional pharmacophore points).
 *   · "수용체 결합" — the same molecule docking into an idealised class A GPCR
 *                     bundle with model residues, H-bond / hydrophobic / π lines
 *                     and the distance in Å.
 *
 * The model is schematic: see the boundary text under the stage and NOTICE.md.
 */
(function () {
  "use strict";

  var D = window.OLFACTRA_DATA;
  if (!D || !D.receptors || !D.receptors.length) return;

  var MOL = {};
  D.molecules.forEach(function (m) { MOL[m.id] = m; });
  var REC = {};
  D.receptors.forEach(function (r) { REC[r.id] = r; });

  var ELEM = {
    C: { color: "#DCD6C8", r: 1.70, name: "탄소" },
    N: { color: "#7C9CFF", r: 1.55, name: "질소" },
    O: { color: "#E2604A", r: 1.52, name: "산소" },
    S: { color: "#E3C05A", r: 1.80, name: "황" },
    F: { color: "#8FD3C7", r: 1.47, name: "불소" },
    Cl: { color: "#7FCB8A", r: 1.75, name: "염소" },
    Br: { color: "#C98A6B", r: 1.85, name: "브롬" },
    I: { color: "#A98BD6", r: 1.98, name: "요오드" },
    P: { color: "#E39A5A", r: 1.80, name: "인" }
  };
  var ELEM_DEFAULT = { color: "#B9B3A6", r: 1.7, name: "원자" };

  var KIND = {
    hbond: { color: "#79B4FF", label: "수소결합", ko: "H-bond" },
    hydrophobic: { color: "#D8AE4A", label: "소수성 접촉", ko: "소수성" },
    pi: { color: "#D98AA0", label: "π 상호작용", ko: "π" }
  };
  var RES_COLOR = { polar: "#79B4FF", aromatic: "#D98AA0", hydrophobic: "#C8BFA6" };

  var state = {
    mode: "molecule",
    mid: null,
    rid: null,
    spin: true,
    yaw: -0.62,
    pitch: 0.3,
    zoom: 1,
    t: 1,                 // docking progress 0..1
    animating: false,
    showFeatures: true,
    drag: null,
    raf: null,
    lastFrame: 0
  };

  var els = {};
  var m3LabelBoxes = [];
  var onSelectExternal = null;

  /* ------------------------------------------------------------------ maths */
  function rot(p, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x = p[0] * cy + p[2] * sy;
    var z = -p[0] * sy + p[2] * cy;
    var y = p[1] * cp - z * sp;
    var z2 = p[1] * sp + z * cp;
    return [x, y, z2];
  }

  function applyPose(p, pose) {
    if (!pose) return p;
    var R = pose.rotation, t = pose.translation;
    return [
      R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0],
      R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1],
      R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2]
    ];
  }

  function rotAxis(p, angle, axis) {
    var c = Math.cos(angle), s = Math.sin(angle);
    var x = p[0], y = p[1], z = p[2];
    if (axis === "x") return [x, y * c - z * s, y * s + z * c];
    if (axis === "y") return [x * c + z * s, y, -x * s + z * c];
    return [x * c - y * s, x * s + y * c, z];
  }

  /* ----------------------------------------------------------------- canvas */
  function view() {
    var canvas = els.canvas;
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || canvas.clientWidth || 720;
    var h = rect.height || canvas.clientHeight || 460;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function camera(w, h) {
    var span;
    if (state.mode === "binding") {
      var rec = REC[state.rid];
      span = rec ? 17 + rec.pocket_radius * 1.5 : 32;
    } else {
      var m = MOL[state.mid];
      var r = 3.5;
      if (m && m.conformer) {
        m.conformer.atoms.forEach(function (a) {
          r = Math.max(r, Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
        });
      }
      span = r * 2.3 + 0.8;
    }
    var k = Math.min(w, h) / span;
    return {
      k: k * state.zoom,
      cx: w / 2,
      cy: h / 2,
      D: state.mode === "binding" ? 90 : 34
    };
  }

  function project(p, cam, centre) {
    var q = rot([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]], state.yaw, state.pitch);
    var persp = cam.D / Math.max(12, cam.D - q[2]);
    return { x: cam.cx + q[0] * cam.k * persp, y: cam.cy - q[1] * cam.k * persp, z: q[2], s: persp };
  }

  function fog(z, zmin, zmax) {
    var t = (z - zmin) / Math.max(1, zmax - zmin);
    return 0.42 + 0.58 * t;
  }

  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + amount)));
    g = Math.max(0, Math.min(255, Math.round(g + amount)));
    b = Math.max(0, Math.min(255, Math.round(b + amount)));
    var h = (1 << 24) + (r << 16) + (g << 8) + b;
    return "#" + h.toString(16).slice(1);
  }

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ------------------------------------------------------------- draw: scene */
  function ligandPoints() {
    var m = MOL[state.mid];
    if (!m || !m.conformer) return null;
    var pose = state.mode === "binding" ? currentPose() : null;
    var atoms = m.conformer.atoms.map(function (a) {
      var p = [a.x, a.y, a.z];
      if (pose) {
        p = applyPose(p, pose);
        if (state.t < 1) {
          var lift = (1 - state.t) * 9;
          p = [p[0], p[1], p[2] + lift];
          p = rotAxis(p, (1 - state.t) * 1.1, "z");
        }
      }
      return { p: p, a: a };
    });
    return { conformer: m.conformer, atoms: atoms, pose: pose };
  }

  function drawMolecule(ctx, w, h, cam, centre, lit) {
    if (!lit) return;
    var items = [];
    var zs = lit.atoms.map(function (o) { return o.p[2]; });
    var zmin = Math.min.apply(null, zs) - 2, zmax = Math.max.apply(null, zs) + 2;

    lit.conformer.bonds.forEach(function (b) {
      var a1 = lit.atoms[b.a], a2 = lit.atoms[b.b];
      if (!a1 || !a2) return;
      var p1 = project(a1.p, cam, centre), p2 = project(a2.p, cam, centre);
      items.push({
        kind: "bond", z: (p1.z + p2.z) / 2, p1: p1, p2: p2, order: b.o,
        c1: (ELEM[a1.a.e] || ELEM_DEFAULT).color, c2: (ELEM[a2.a.e] || ELEM_DEFAULT).color
      });
    });
    lit.atoms.forEach(function (o) {
      var pr = project(o.p, cam, centre);
      items.push({ kind: "atom", z: pr.z, p: pr, a: o.a });
    });

    if (state.showFeatures) {
      lit.conformer.features.forEach(function (f) {
        var p = f.c;
        if (lit.pose) {
          p = applyPose(p, lit.pose);
          if (state.t < 1) {
            var lift = (1 - state.t) * 9;
            p = [p[0], p[1], p[2] + lift];
            p = rotAxis(p, (1 - state.t) * 1.1, "z");
          }
        }
        var pr = project(p, cam, centre);
        items.push({ kind: "feature", z: pr.z + 0.4, p: pr, f: f });
      });
    }

    items.sort(function (a, b) { return a.z - b.z; });
    var zr = Math.max(1, zmax - zmin);
    var boost = state.mode === "binding";
    items.forEach(function (it) {
      var t = (it.z - zmin) / zr;
      var f = boost ? 0.78 + 0.22 * t : fog(it.z, zmin, zmax);
      if (it.kind === "bond") {
        var width = Math.max(1.6, (boost ? 0.24 : 0.21) * cam.k * it.p1.s);
        drawBond(ctx, it.p1, it.p2, width, it.order, it.c1, it.c2, f);
      } else if (it.kind === "atom") {
        var e = ELEM[it.a.e] || ELEM_DEFAULT;
        var r = Math.max(2.0, e.r * (boost ? 0.44 : 0.30) * cam.k * it.p.s);
        if (boost) {
          ctx.beginPath();
          ctx.arc(it.p.x, it.p.y, r + 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(6,6,8,0.35)";
          ctx.fill();
        }
        drawSphere(ctx, it.p.x, it.p.y, r, e.color, f, it.a.e, state.showFeatures, it.a);
      } else {
        var col = f.type === "hbd" ? "#79B4FF" : f.type === "hba" ? "#E2604A"
          : f.type === "aromatic" ? "#D98AA0" : "#D8AE4A";
        ctx.beginPath();
        ctx.arc(it.p.x, it.p.y, Math.max(3, 0.55 * cam.k * it.p.s), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, 0.85 * f);
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(col, 0.10 * f);
        ctx.fill();
      }
    });
  }

  function drawBond(ctx, p1, p2, width, order, c1, c2, fogAmt) {
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var offsets = [0];
    if (order === 2) offsets = [-width * 0.55, width * 0.55];
    else if (order === 3) offsets = [-width * 0.85, 0, width * 0.85];
    else if (order === 1.5) offsets = [0];

    offsets.forEach(function (off, idx) {
      var ax = p1.x + nx * off, ay = p1.y + ny * off;
      var bx = p2.x + nx * off, by = p2.y + ny * off;
      // dark rim, then the two half-sticks in their atom colours
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(6,6,8," + (0.55 * fogAmt) + ")";
      ctx.lineWidth = width + 2.4;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      var mx = (ax + bx) / 2, my = (ay + by) / 2;
      ctx.lineWidth = width;
      ctx.strokeStyle = rgba(shade(c1, -6), fogAmt);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.strokeStyle = rgba(shade(c2, -6), fogAmt);
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // a subtle top highlight so the stick looks cylindrical
      ctx.strokeStyle = "rgba(255,255,255," + (0.10 * fogAmt) + ")";
      ctx.lineWidth = Math.max(1, width * 0.28);
      ctx.beginPath();
      ctx.moveTo(ax - ny * width * 0.22, ay + nx * width * 0.22);
      ctx.lineTo(bx - ny * width * 0.22, by + nx * width * 0.22);
      ctx.stroke();

      if (order === 1.5) {
        // aromatic: a short inner line, the way a structural formula marks it
        var t1 = 0.26, t2 = 0.74;
        var ox = nx * width * 0.85, oy = ny * width * 0.85;
        ctx.strokeStyle = "rgba(28,26,22," + (0.45 * fogAmt) + ")";
        ctx.lineWidth = Math.max(1, width * 0.32);
        ctx.beginPath();
        ctx.moveTo(ax + (bx - ax) * t1 + ox, ay + (by - ay) * t1 + oy);
        ctx.lineTo(ax + (bx - ax) * t2 + ox, ay + (by - ay) * t2 + oy);
        ctx.stroke();
      }
    });
  }

  function drawSphere(ctx, x, y, r, color, fogAmt, element, highlight, atom) {
    var grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    grad.addColorStop(0, rgba(shade(color, 60), fogAmt));
    grad.addColorStop(0.55, rgba(color, fogAmt));
    grad.addColorStop(1, rgba(shade(color, -75), fogAmt));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    if (element !== "C") {
      ctx.strokeStyle = "rgba(10,10,12," + (0.45 * fogAmt) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (highlight && atom && (atom.hbd || atom.hba)) {
      ctx.strokeStyle = rgba(atom.hbd ? "#79B4FF" : "#E2604A", 0.85 * fogAmt);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawReceptor(ctx, w, h, cam, centre) {
    var rec = REC[state.rid];
    if (!rec) return;
    var items = [];
    var zs = [];
    rec.helices.forEach(function (hel, hi) {
      var pts = hel.path;
      for (var i = 0; i < pts.length; i += 2) {
        var pr = project(pts[i], cam, centre);
        zs.push(pr.z);
        items.push({ kind: "helixBead", z: pr.z, p: pr, hue: hi });
      }
    });
    var residues = rec.residues.map(function (res) {
      var pr = project(res.pos, cam, centre);
      zs.push(pr.z);
      return { res: res, pr: pr };
    });
    residues.forEach(function (r) {
      items.push({ kind: "residue", z: r.pr.z, p: r.pr, res: r.res });
    });

    var zmin = Math.min.apply(null, zs) - 4, zmax = Math.max.apply(null, zs) + 4;
    items.sort(function (a, b) { return a.z - b.z; });

    var helixColors = ["#7FB3B8", "#93B58C", "#C0AA74", "#A3A9BC", "#BC9FAF", "#8FBAC9", "#BECBA1"];
    var labelled = {};
    var pose = currentPose();
    if (pose) pose.interactions.forEach(function (it) { labelled[it.residue] = true; });

    items.forEach(function (it) {
      var f = 0.35 + 0.65 * ((it.z - zmin) / Math.max(1, zmax - zmin));
      if (it.kind === "helixBead") {
        var col = helixColors[it.hue % helixColors.length];
        var r = Math.max(2.5, 1.95 * cam.k * it.p.s);
        var grad = ctx.createRadialGradient(it.p.x - r * 0.4, it.p.y - r * 0.45, r * 0.15, it.p.x, it.p.y, r);
        grad.addColorStop(0, rgba(shade(col, 40), 0.40 * f));
        grad.addColorStop(0.62, rgba(col, 0.30 * f));
        grad.addColorStop(1, rgba(shade(col, -75), 0.26 * f));
        ctx.beginPath();
        ctx.arc(it.p.x, it.p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      } else {
        drawResidue(ctx, it.p, it.res, f, cam, labelled[it.res.label]);
      }
    });

    rec.helices.forEach(function (hel) {
      var top = hel.path[Math.max(0, hel.path.length - 8)];
      if (!top) return;
      var pr = project(top, cam, centre);
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.fillStyle = "rgba(220,214,200,0.40)";
      ctx.textAlign = "center";
      ctx.fillText(hel.name, pr.x, pr.y - 12);
      ctx.textAlign = "start";
    });
    void w; void h;
  }

  function drawResidue(ctx, pr, res, fogAmt, cam, showLabel) {
    var col = RES_COLOR[res.kind] || "#C8BFA6";
    var r = Math.max(3, 0.24 * cam.k * pr.s);
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, r + 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10,10,12," + (0.55 * fogAmt) + ")";
    ctx.fill();
    var grad = ctx.createRadialGradient(pr.x - r * 0.3, pr.y - r * 0.35, r * 0.1, pr.x, pr.y, r);
    grad.addColorStop(0, rgba(shade(col, 45), fogAmt));
    grad.addColorStop(1, rgba(shade(col, -55), fogAmt));
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.7 * fogAmt);
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!showLabel) return;
    var label = res.label;
    ctx.font = "500 9.5px ui-monospace, monospace";
    var tw = ctx.measureText(label).width;
    var lx = pr.x + r + 3, ly = pr.y - 7;
    var box = { x: lx - 2, y: ly - 1, w: tw + 8, h: 14 };
    if (m3LabelBoxes.some(function (b) {
      return !(box.x + box.w < b.x || b.x + b.w < box.x || box.y + box.h < b.y || b.y + b.h < box.y);
    })) return;
    m3LabelBoxes.push(box);
    ctx.fillStyle = "rgba(12,12,14," + (0.78 * fogAmt) + ")";
    roundRect(ctx, lx - 2, ly - 1, tw + 8, 14, 3);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.35 * fogAmt);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = rgba(col, fogAmt);
    ctx.fillText(label, lx + 3, pr.y + 2.5);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawInteractions(ctx, w, h, cam, centre, lit) {
    if (!lit || !lit.pose || state.t < 0.55) return;
    var rec = REC[state.rid];
    if (!rec) return;
    var alpha = Math.min(1, (state.t - 0.55) / 0.35);
    var byLabel = {};
    rec.residues.forEach(function (r) { byLabel[r.label] = r; });

    lit.pose.interactions.forEach(function (it) {
      var res = byLabel[it.residue];
      var atom = lit.conformer.atoms[it.atom];
      if (!res || !atom) return;
      var pa = lit.atoms[it.atom];
      var p1 = project(pa.p, cam, centre);
      var p2 = project(res.pos, cam, centre);
      var meta = KIND[it.kind] || KIND.hydrophobic;

      ctx.setLineDash(it.kind === "hydrophobic" ? [2, 4] : [5, 4]);
      ctx.strokeStyle = rgba(meta.color, 0.9 * alpha);
      ctx.lineWidth = it.kind === "hbond" ? 1.9 : 1.4;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      var mx = p1.x + (p2.x - p1.x) * 0.42, my = p1.y + (p2.y - p1.y) * 0.42;
      var text = it.distance.toFixed(1) + " Å";
      ctx.font = "600 9.5px ui-monospace, monospace";
      var tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(10,10,12," + (0.78 * alpha) + ")";
      roundRect(ctx, mx - tw / 2 - 4, my - 7, tw + 8, 14, 4);
      ctx.fill();
      ctx.fillStyle = rgba(meta.color, alpha);
      ctx.textAlign = "center";
      ctx.fillText(text, mx, my + 3);
      ctx.textAlign = "start";
    });
    void w; void h;

    // small legend, bottom-left
    var x = 14, y = h - 16;
    ctx.font = "500 10px 'Noto Sans KR', sans-serif";
    Object.keys(KIND).forEach(function (k) {
      var meta = KIND[k];
      ctx.strokeStyle = rgba(meta.color, 0.9);
      ctx.setLineDash(k === "hydrophobic" ? [2, 3] : [5, 3]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + 16, y - 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(220,214,200,0.8)";
      ctx.fillText(meta.label, x + 21, y);
      x += 16 + ctx.measureText(meta.label).width + 18;
    });
  }

  function draw() {
    var canvas = els.canvas;
    if (!canvas || canvas.offsetParent === null) return;
    var v = view();
    var ctx = v.ctx, w = v.w, h = v.h;
    ctx.clearRect(0, 0, w, h);

    // background: subtle radial vignette like a structure viewer
    var bg = ctx.createRadialGradient(w * 0.5, h * 0.42, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    bg.addColorStop(0, "#1B1A17");
    bg.addColorStop(1, "#0D0D0C");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    m3LabelBoxes = [];
    var rec = REC[state.rid];
    var centre = state.mode === "binding"
      ? (rec ? rec.pocket_center.slice() : [0, 0, 0])
      : [0, 0, 0];
    var cam = camera(w, h);
    if (state.mode === "binding") drawReceptor(ctx, w, h, cam, centre);
    var lit = ligandPoints();
    drawMolecule(ctx, w, h, cam, centre, lit);
    drawInteractions(ctx, w, h, cam, centre, lit);

    // scale reference for the binding view
    if (state.mode === "binding") {
      ctx.font = "500 10px ui-monospace, monospace";
      ctx.fillStyle = "rgba(220,214,200,0.45)";
      var px = 12 * cam.k * (cam.D / cam.D);
      ctx.strokeStyle = "rgba(220,214,200,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w - 20 - px, h - 18);
      ctx.lineTo(w - 20, h - 18);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText("10 Å", w - 20, h - 24);
      ctx.textAlign = "start";
    }
  }

  /* ------------------------------------------------------------------ state */
  function currentPose() {
    var byRec = D.poses[state.mid];
    if (!byRec) return null;
    return byRec[state.rid] || null;
  }

  function loop(ts) {
    var busy = state.spin || state.animating;
    if (state.spin && !state.drag) state.yaw += 0.0055;
    if (state.animating) {
      var dt = Math.min(0.05, (ts - state.lastFrame) / 1000 || 0.016);
      state.t = Math.min(1, state.t + dt / 1.7);
      if (state.t >= 1) state.animating = false;
      renderInteractions();
    }
    if (state.spin || state.animating || !state.lastFrame) draw();
    state.lastFrame = ts;
    els.spin.classList.toggle("is-on", state.spin);
    if (busy || state.t < 1) {
      state.raf = requestAnimationFrame(loop);
    } else {
      state.raf = null;
      state.lastFrame = 0;
    }
  }

  function kick() {
    if (!state.raf) state.raf = requestAnimationFrame(loop);
  }

  function selectMolecule(mid, silent) {
    if (!MOL[mid]) return;
    state.mid = mid;
    if (!els.molecule) return;   // called during page init, before the viewer is wired
    if (!state.rid) state.rid = MOL[mid].pose_default || D.receptors[0].id;
    els.molecule.value = mid;
    renderTitle();
    renderInfo();
    renderInteractions();
    renderEvidence();
    if (!silent && typeof onSelectExternal === "function") onSelectExternal(mid);
    state.t = 1;
    kick();
  }

  function selectReceptor(rid) {
    if (!REC[rid]) return;
    state.rid = rid;
    els.receptor.value = rid;
    state.t = 1;
    renderTitle();
    renderInfo();
    renderInteractions();
    renderEvidence();
    kick();
  }

  function setMode(mode) {
    state.mode = mode;
    els.modeBtns.forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-mol3d-mode") === mode);
    });
    els.receptorWrap.hidden = mode !== "binding";
    els.dock.hidden = mode !== "binding";
    els.features.hidden = mode !== "molecule";
    state.t = 1;
    renderTitle();
    renderInfo();
    renderInteractions();
    renderEvidence();
    draw();
  }

  /* ------------------------------------------------------------------- text */
  function renderTitle() {
    var m = MOL[state.mid];
    var rec = REC[state.rid];
    if (!m) return;
    var t = state.mode === "binding" && rec
      ? m.name + " · " + m.name_ko + "  →  " + rec.name
      : m.name + " · " + m.name_ko;
    els.title.textContent = t;
    els.hint.textContent = state.mode === "binding"
      ? "드래그 회전 · 휠 확대 · 결합 애니메이션 재생"
      : "드래그 회전 · 휠 확대";
  }

  function renderInfo() {
    var m = MOL[state.mid];
    if (!m) { els.info.innerHTML = ""; return; }
    var c = m.conformer;
    if (!c) { els.info.innerHTML = '<p class="m3-empty">3D 좌표가 없습니다.</p>'; return; }
    var counts = {};
    c.atoms.forEach(function (a) { counts[a.e] = (counts[a.e] || 0) + 1; });
    var chips = Object.keys(counts).map(function (e) {
      var meta = ELEM[e] || ELEM_DEFAULT;
      return '<span class="m3-chip"><i style="background:' + meta.color + '"></i>' +
        e + " " + counts[e] + "</span>";
    }).join("");

    if (state.mode === "molecule") {
      var fg = [];
      [["aldehyde", "알데하이드"], ["ketone", "케톤"], ["ester", "에스터"], ["lactone", "락톤"],
       ["alcohol", "알코올"], ["phenol", "페놀"], ["ether", "에터"]].forEach(function (kv) {
        if (c.props && c.props[kv[0]]) fg.push(kv[1] + (c.props[kv[0]] > 1 ? " ×" + c.props[kv[0]] : ""));
      });
      els.info.innerHTML =
        '<div class="m3-kv"><span>분자식</span><b class="mono">' + esc(c.props.formula) + "</b></div>" +
        '<div class="m3-kv"><span>원자</span><b>' + c.atoms.length + "개 (수소 제외)</b></div>" +
        '<div class="m3-kv"><span>고리·회전가능 결합</span><b>' + c.props.rings + " · " + c.props.rotatable + "</b></div>" +
        '<div class="m3-kv"><span>작용기</span><b>' + (fg.join(" · ") || "탄화수소") + "</b></div>" +
        '<div class="m3-chips">' + chips + "</div>" +
        '<p class="m3-tiny">MMFF94s로 최적화한 단일 저에너지 컨포머입니다. 실제 분자는 여러 형태를 오가므로, ' +
        "이 좌표는 가능한 모양 하나이지 유일한 생체 활성 형태가 아닙니다.</p>";
      return;
    }

    var pose = currentPose();
    var rec = REC[state.rid];
    if (!pose || !rec) { els.info.innerHTML = '<p class="m3-empty">이 수용체의 포즈가 없습니다.</p>'; return; }
    els.info.innerHTML =
      '<div class="m3-score">' +
        '<div><b>' + pose.fit.toFixed(0) + '</b><span>모식 적합도</span></div>' +
        '<div><b>' + pose.contacts + '</b><span>잔기 접촉</span></div>' +
        '<div><b>' + pose.hbonds + '</b><span>수소결합</span></div>' +
        '<div><b>' + pose.hydrophobic + '</b><span>소수성</span></div>' +
        '<div><b>' + pose.pi + '</b><span>π</span></div>' +
      "</div>" +
      '<div class="m3-chips">' + chips + "</div>" +
      '<p class="m3-note2"><b>' + esc(rec.name) + "</b> — " + esc(rec.description_ko) + "</p>" +
      '<p class="m3-tiny">' + esc(rec.evidence_note_ko) + "</p>";
  }

  function renderInteractions() {
    var pose = state.mode === "binding" ? currentPose() : null;
    var m = MOL[state.mid];
    if (!pose || !m) {
      els.interactions.innerHTML = state.mode === "molecule"
        ? '<p class="m3-empty">수용체 결합 모드에서 잔기별 상호작용과 거리를 보여 줍니다.</p>'
        : "";
      return;
    }
    var rec = REC[state.rid];
    var rows = pose.interactions.map(function (it) {
      var meta = KIND[it.kind] || KIND.hydrophobic;
      var atom = m.conformer.atoms[it.atom] || { e: "?" };
      return '<li><span class="m3-kind" style="color:' + meta.color + '">' + meta.ko + "</span>" +
        '<span class="m3-res mono">' + esc(it.residue) + "</span>" +
        '<span class="m3-atom">' + esc(atom.e) + " 원자</span>" +
        '<span class="m3-dist mono">' + it.distance.toFixed(2) + " Å</span></li>";
    }).join("");
    var chem = "";
    if (pose.chemotype !== undefined) {
      chem = '<p class="m3-tiny">화학형 일치 <b>' + Math.round(pose.chemotype * 100) + "%</b> — " +
        esc(pose.chemotype_note) + " (수용체별 보고 리간드 계열과의 휴리스틱 비교)</p>";
    }
    els.interactions.innerHTML =
      '<h4>잔기 상호작용 <span class="m3-count">' + pose.interactions.length + "</span></h4>" +
      '<ul class="m3-list">' + rows + "</ul>" + chem +
      '<p class="m3-tiny">거리는 리간드 원자와 모식 잔기 측쇄 작용기(또는 측쇄 중심) 사이의 값입니다. ' +
      "잔기 좌표는 Ballesteros–Weinstein 번호로 표시한 모식 위치이며 PDB 원자 좌표가 아닙니다.</p>";
    void rec;
  }

  function renderEvidence() {
    var m = MOL[state.mid];
    var rec = REC[state.rid];
    var box = els.evidence;
    if (!m || !rec || state.mode !== "binding") { box.hidden = true; return; }
    var p = m.pyrfume || {};
    var hit = (p.receptors || []).filter(function (r) { return r.gene === rec.gene; })[0];
    box.hidden = false;
    if (hit) {
      box.className = "mol3d-badge is-live";
      box.innerHTML = '<b>문헌 보고 활성</b> · Mainland et al. 2015 (Pyrfume)<br>' +
        '<span>' + esc(rec.gene) + " 반응" + (hit.dose_response ? " · 농도–반응 통과" : " · 1차 스크리닝 통과") +
        (hit.ec50_log !== null && hit.ec50_log !== undefined ? " · EC50 log₁₀ " + hit.ec50_log : "") + "</span>";
    } else {
      box.className = "mol3d-badge";
      box.innerHTML = '<b>모식 결합</b> · 이 분자–수용체 조합의 실측 반응은 Pyrfume 번들에 없습니다';
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* -------------------------------------------------------------------- init */
  function init() {
    els.canvas = document.getElementById("mol3d-canvas");
    if (!els.canvas) return;
    els.molecule = document.getElementById("mol3d-molecule");
    els.receptor = document.getElementById("mol3d-receptor");
    els.receptorWrap = document.getElementById("mol3d-receptor-wrap");
    els.spin = document.getElementById("mol3d-spin");
    els.dock = document.getElementById("mol3d-dock");
    els.reset = document.getElementById("mol3d-reset");
    els.features = document.getElementById("mol3d-features");
    els.title = document.getElementById("mol3d-title");
    els.hint = document.getElementById("mol3d-hint");
    els.info = document.getElementById("mol3d-info");
    els.interactions = document.getElementById("mol3d-interactions");
    els.evidence = document.getElementById("mol3d-evidence");
    els.modeBtns = Array.prototype.slice.call(document.querySelectorAll("[data-mol3d-mode]"));

    els.molecule.innerHTML = D.molecules.slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (m) {
        return '<option value="' + m.id + '">' + esc(m.name) + " · " + esc(m.name_ko) + "</option>";
      }).join("");
    els.receptor.innerHTML = D.receptors.map(function (r) {
      return '<option value="' + r.id + '">' + esc(r.name) + " — " + esc(r.ligands_ko) + "</option>";
    }).join("");

    els.modeBtns.forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mol3d-mode")); });
    });
    els.molecule.addEventListener("change", function () { selectMolecule(els.molecule.value); });
    els.receptor.addEventListener("change", function () { selectReceptor(els.receptor.value); });
    els.spin.addEventListener("click", function () { state.spin = !state.spin; kick(); });
    els.dock.addEventListener("click", function () {
      state.t = 0.001;
      state.animating = true;
      kick();
    });
    els.reset.addEventListener("click", function () {
      state.yaw = -0.62; state.pitch = 0.3; state.zoom = 1; draw();
    });
    if (els.features) {
      els.features.addEventListener("click", function () {
        state.showFeatures = !state.showFeatures;
        els.features.classList.toggle("is-on", state.showFeatures);
        draw();
      });
    }

    // pointer interaction
    var canvas = els.canvas;
    canvas.addEventListener("pointerdown", function (ev) {
      state.drag = { x: ev.clientX, y: ev.clientY, yaw: state.yaw, pitch: state.pitch };
      canvas.setPointerCapture(ev.pointerId);
      canvas.classList.add("is-grabbing");
    });
    canvas.addEventListener("pointermove", function (ev) {
      if (!state.drag) return;
      state.yaw = state.drag.yaw + (ev.clientX - state.drag.x) * 0.008;
      state.pitch = Math.max(-1.2, Math.min(1.2, state.drag.pitch + (ev.clientY - state.drag.y) * 0.008));
      draw();
    });
    canvas.addEventListener("pointerup", function (ev) {
      state.drag = null;
      canvas.classList.remove("is-grabbing");
      try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      kick();
    });
    canvas.addEventListener("pointercancel", function () { state.drag = null; });
    canvas.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      state.zoom = Math.max(0.45, Math.min(3.4, state.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
      draw();
    }, { passive: false });

    // touch pinch zoom
    var pinch = null;
    canvas.addEventListener("touchstart", function (ev) {
      if (ev.touches.length === 2) {
        pinch = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                           ev.touches[0].clientY - ev.touches[1].clientY);
      }
    }, { passive: true });
    canvas.addEventListener("touchmove", function (ev) {
      if (ev.touches.length === 2 && pinch) {
        var d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX,
                           ev.touches[0].clientY - ev.touches[1].clientY);
        state.zoom = Math.max(0.45, Math.min(3.4, state.zoom * (d / pinch)));
        pinch = d;
        draw();
      }
    }, { passive: true });
    canvas.addEventListener("touchend", function () { pinch = null; }, { passive: true });

    var first = MOL[state.mid] ? state.mid : D.molecules[0].id;
    selectMolecule(first, true);
    setMode("molecule");
    kick();
  }

  window.OLFACTRA3D = {
    init: init,
    select: function (mid) { if (MOL[mid]) { selectMolecule(mid, true); state.t = 1; draw(); } },
    setMode: setMode,
    onSelect: function (fn) { onSelectExternal = fn; },
    state: state
  };
})();
