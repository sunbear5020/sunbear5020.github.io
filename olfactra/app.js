/* OLFACTRA — static workbench (100% client-side).
 * Data: data.js (generated from the Python engine by tools/build_web_data.py).
 * Everything below mirrors olfactra_core/*.py; if you change the engine, regenerate. */
(function () {
  "use strict";

  var D = window.OLFACTRA_DATA;
  if (!D) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:24px;font:14px sans-serif">data.js를 불러오지 못했습니다. 같은 폴더에 data.js가 있는지 확인하세요.</p>');
    return;
  }

  var FAMILIES = D.meta.families;               // [{id,label}]
  var NOTES = D.meta.notes;                     // [{id,label}]
  var FAM_LABEL = {}, NOTE_LABEL = {}, NOTE_ORDER = {};
  FAMILIES.forEach(function (f) { FAM_LABEL[f.id] = f.label; });
  NOTES.forEach(function (n, i) { NOTE_LABEL[n.id] = n.label; NOTE_ORDER[n.id] = i; });

  var FAM_COLOR = {
    citrus: "#C9A227", green: "#6E8B57", floral: "#C4707F", fruity: "#D98E5A",
    sweet: "#B0813F", spicy: "#A2532F", woody: "#7A6248", resinous: "#8B6F3E",
    earthy: "#6B5B45", camphor: "#5E7F82", musky: "#8C7A8C", smoky: "#5B5550",
    powdery: "#A79C8E"
  };

  var MOL = {}, MOL_LIST = D.molecules.slice();
  MOL_LIST.forEach(function (m) { MOL[m.id] = m; });
  var PRODUCT = {};
  D.products.forEach(function (p) { PRODUCT[p.id] = p; });
  var ACCORD = {};
  D.accords.forEach(function (a) { ACCORD[a.id] = a; });

  var state = {
    tab: "id",
    id: { mood: null, season: null, space: null, style: null },
    studio: { product: "reed_diffuser", volume: 100, load: null, items: [], source: "" },
    compare: { accord: null, product: null, volume: 50, load: null },
    atlas: { q: "", cat: null, selected: null },
    mol: { selected: "alpha-pinene", family: null, cell: null }
  };

  /* ------------------------------------------------------------------ utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n, d) {
    if (n == null || isNaN(n)) return "—";
    var v = Number(n);
    var s = v.toFixed(d == null ? 2 : d);
    return s.replace(/\.?0+$/, function (m) { return m.indexOf(".") === 0 ? "" : m; });
  }
  function pct(n, d) { return fmt(n, d == null ? 0 : d) + "%"; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rounded(n) { return Math.round(n * 10) / 10; }
  // Korean subject particle: pick by whether the last syllable has a final consonant
  function josa(word, withFinal, withoutFinal) {
    var w = String(word || "").trim();
    if (!w) return withoutFinal;
    var code = w.charCodeAt(w.length - 1);
    if (code < 0xAC00 || code > 0xD7A3) return withoutFinal;
    return ((code - 0xAC00) % 28) ? withFinal : withoutFinal;
  }
  function byId(id) { return document.getElementById(id); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  /* ------------------------------------------------------- odour mathematics */
  function odorVector(m) {
    return FAMILIES.map(function (f) { return m.families[f.id] || 0; });
  }
  function cosine(a, b) {
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return dot / Math.sqrt(na * nb);
  }
  function similarity(a, b) { return cosine(odorVector(a), odorVector(b)); }
  function familyOverlap(a, b) {
    var sum = 0;
    FAMILIES.forEach(function (f) {
      sum += Math.min(a.families[f.id] || 0, b.families[f.id] || 0);
    });
    return Math.min(1, sum);
  }
  var COMPLEMENT = [
    [["floral", "woody"], 0.12], [["citrus", "resinous"], 0.10], [["green", "woody"], 0.08],
    [["sweet", "spicy"], 0.08], [["smoky", "sweet"], 0.07], [["musky", "floral"], 0.09],
    [["floral", "citrus"], 0.07], [["woody", "spicy"], 0.06]
  ];
  function blendScore(a, b) {
    var overlap = familyOverlap(a, b);
    var sim = similarity(a, b);
    var span = Math.abs(NOTE_ORDER[a.note] - NOTE_ORDER[b.note]);
    var noteFactor = span === 0 ? 0.85 : (span === 1 ? 1.0 : 0.75);
    var lift = 0;
    var domA = Object.keys(a.families).filter(function (f) { return a.families[f] >= 0.2; });
    var domB = Object.keys(b.families).filter(function (f) { return b.families[f] >= 0.2; });
    COMPLEMENT.forEach(function (pair) {
      var p = pair[0];
      if (p.some(function (f) { return domA.indexOf(f) >= 0; }) &&
          p.some(function (f) { return domB.indexOf(f) >= 0; })) {
        lift = Math.max(lift, pair[1]);
      }
    });
    return clamp((0.55 * overlap + 0.30 * sim + lift) * noteFactor, 0, 1);
  }

  function normalisedItems(items) {
    var total = items.reduce(function (s, it) { return s + (Number(it.share) || 0); }, 0);
    if (total <= 0) return [];
    return items.map(function (it) {
      return { id: it.id, share: (Number(it.share) || 0) / total * 100 };
    });
  }

  function noteBalance(items) {
    var bal = { top: 0, middle: 0, base: 0 };
    normalisedItems(items).forEach(function (it) {
      var m = MOL[it.id]; if (!m) return;
      bal[m.note] += it.share / 100;
    });
    return bal;
  }

  function familyProfile(items) {
    var prof = {};
    FAMILIES.forEach(function (f) { prof[f.id] = 0; });
    normalisedItems(items).forEach(function (it) {
      var m = MOL[it.id]; if (!m) return;
      Object.keys(m.families).forEach(function (f) {
        if (prof[f] != null) prof[f] += m.families[f] * it.share / 100;
      });
    });
    return prof;
  }

  function blendReport(items) {
    var norm = normalisedItems(items);
    var mats = norm.map(function (it) { return MOL[it.id]; }).filter(Boolean);
    var warnings = [];
    var bal = noteBalance(items);
    var pairs = 0, sum = 0, low = [];
    for (var i = 0; i < mats.length; i++) {
      for (var j = i + 1; j < mats.length; j++) {
        var sc = blendScore(mats[i], mats[j]);
        sum += sc; pairs++;
        if (sc < 0.10) low.push(mats[i].name_ko + "·" + mats[j].name_ko);
      }
    }
    if (mats.length === 1) warnings.push("한 가지 원료만으로는 향의 층(탑·미들·베이스)이 만들어지지 않습니다.");
    if (bal.top === 0) warnings.push("탑 노트가 없습니다 — 첫인상이 무거울 수 있습니다.");
    if (bal.base === 0) warnings.push("베이스 노트가 없습니다 — 지속력이 짧아집니다.");
    if (bal.top > 0.6) warnings.push("탑 노트 비중이 높습니다 — 휘발이 빠르고 잔향이 약해집니다.");
    if (low.length) warnings.push("향조가 거의 겹치지 않는 조합: " + low.slice(0, 3).join(", ") +
      " — 소량으로 두거나 사이를 잇는 원료를 하나 두세요");
    return { harmony: pairs ? sum / pairs : 1, balance: bal, profile: familyProfile(items), warnings: warnings };
  }

  /* ------------------------------------------------------------- recommender */
  function scoreAccord(accord, sel) {
    var score = 0, total = 0, reasons = [];
    if (sel.mood) {
      total += 3; score += (accord.moods[sel.mood] || 0) * 3;
      if (accord.moods[sel.mood]) reasons.push(LABELS.mood[sel.mood] + " 기분에 " + accord.moods[sel.mood].toFixed(1) + " 만큼 맞습니다");
    }
    if (sel.season) {
      total += 1.5; score += (accord.seasons[sel.season] || 0) * 1.5;
      if ((accord.seasons[sel.season] || 0) >= 0.7) reasons.push(LABELS.season[sel.season] + "에 잘 어울리는 향조 구성");
    }
    if (sel.space) {
      total += 2; score += (accord.spaces[sel.space] || 0) * 2;
      if ((accord.spaces[sel.space] || 0) >= 0.7) reasons.push(LABELS.space[sel.space] + " 공간의 발향 거리·환기에 맞습니다");
    }
    if (sel.style) {
      total += 2; score += (accord.styles[sel.style] || 0) * 2;
      if ((accord.styles[sel.style] || 0) >= 0.7) reasons.push(LABELS.style[sel.style] + " 스타일에 맞는 향조 축");
    }
    var items = Object.keys(accord.materials).map(function (id) { return { id: id, share: accord.materials[id] }; });
    if (sel.style) {
      var prof = familyProfile(items);
      var norm = 0;
      Object.keys(prof).forEach(function (k) { norm += prof[k]; });
      norm = norm || 1;
      var fit = 0;
      var sf = D.meta.style_families[sel.style] || {};
      Object.keys(sf).forEach(function (f) { fit += (prof[f] || 0) / norm * sf[f]; });
      score += fit * 4; total += 4;
    }
    if (sel.space) {
      var bal = noteBalance(items);
      var sn = D.meta.space_notes[sel.space] || {};
      var noteFit = 0;
      Object.keys(sn).forEach(function (n) { noteFit += (bal[n] || 0) * sn[n]; });
      score += Math.max(0, noteFit) * 1.5; total += 1.5;
    }
    // measured pleasantness of the single molecules (Pyrfume / Keller 2016) —
    // the same small, documented prior the Python engine applies
    var prior = hedonicPrior(accord.materials);
    if (prior) {
      total += HEDONIC_WEIGHT;
      score += prior.value * HEDONIC_WEIGHT;
      reasons.push("구성 분자 " + prior.measured.length + "종(비중 " + Math.round(prior.coverage * 100) +
        "%)의 실측 쾌적도 평균 " + Math.round(prior.mean) + "/100 — Keller & Vosshall 2016");
    }
    return { score: total ? Math.min(100, 100 * score / total) : 0, reasons: reasons, prior: prior };
  }

  var HEDONIC_WEIGHT = 1.2;
  var HEDONIC_MIN_COVERAGE = 0.15;

  /** weighted pleasantness prior over the measured single molecules (Pyrfume) */
  function hedonicPrior(materials) {
    var total = 0, weighted = 0, weight = 0, measured = [];
    Object.keys(materials).forEach(function (mid) {
      var sh = Number(materials[mid]) || 0;
      if (sh <= 0) return;
      total += sh;
      var m = MOL[mid];
      var pyr = m && m.pyrfume;
      if (!pyr || pyr.pleasantness == null) return;
      measured.push({ id: mid, share: sh, pleasantness: pyr.pleasantness });
      weighted += pyr.pleasantness * sh; weight += sh;
    });
    if (!weight || !total) return null;
    var cov = weight / total;
    if (cov < HEDONIC_MIN_COVERAGE) return null;
    var mean = weighted / weight;
    return {
      value: clamp((mean - 30) / 60, 0, 1),
      mean: mean,
      coverage: cov,
      measured: measured
    };
  }

  function recommend(sel, limit, exclude) {
    var ranked = D.accords.map(function (a) {
      if (exclude && exclude.indexOf(a.id) >= 0) return null;
      var s = scoreAccord(a, sel);
      var items = Object.keys(a.materials).map(function (id) { return { id: id, share: a.materials[id] }; });
      var rep = blendReport(items);
      return { accord: a, score: s.score, reasons: s.reasons, report: rep, prior: s.prior };
    }).filter(Boolean);
    ranked.sort(function (a, b) { return (b.score - a.score) || (b.report.harmony - a.report.harmony); });
    var picked = [], seen = [];
    ranked.forEach(function (r) {
      if (picked.length >= limit) return;
      var sig = Object.keys(r.accord.materials).filter(function (k) { return r.accord.materials[k] >= 15; });
      var clash = seen.some(function (s) {
        return sig.filter(function (x) { return s.indexOf(x) >= 0; }).length >= 3;
      });
      if (clash) return;
      picked.push(r); seen.push(sig);
    });
    return picked;
  }

  /* ---------------------------------------------------------------- studio */
  function densityOf(m) { return (m.state === "liquid") ? m.density_g_ml : 1.0; }

  function buildFormula(product, volume, loadPct, items) {
    var pt = PRODUCT[product];
    if (!pt) return null;
    var vol = Number(volume) || 0;
    var load = (loadPct == null) ? pt.load_default : Number(loadPct);
    var norm = normalisedItems(items);
    if (!norm.length || vol <= 0 || load <= 0) return null;

    var fragVol = vol * load / 100;
    var baseVol = vol - fragVol;
    var rows = [], fragMass = 0, capScale = pt.cap_scale || 1;

    norm.forEach(function (it) {
      var m = MOL[it.id]; if (!m) return;
      var neatVol = fragVol * it.share / 100;
      var neatMass = neatVol * densityOf(m);
      fragMass += neatMass;
      rows.push({
        m: m, share: it.share, neatVol: neatVol, neatMass: neatMass,
        finished: 0, cap: (m.working_cap_pct || 0) * capScale, capBase: m.working_cap_pct, ratio: 0, status: "ok"
      });
    });

    var carriers = [], baseMass = 0;
    pt.carriers.forEach(function (c) {
      var v = baseVol * c.ratio, mass = v * c.density_g_ml;
      baseMass += mass;
      carriers.push({ c: c, vol: v, mass: mass });
    });

    var total = fragMass + baseMass;
    var worstOver = false, anyCaution = false, allergens = [];
    rows.forEach(function (r) {
      r.finished = total ? r.neatMass / total * 100 : 0;
      r.ratio = r.cap ? r.finished / r.cap : 0;
      if (r.ratio > 1) { r.status = "over"; worstOver = true; }
      else if (r.ratio >= 0.6) { r.status = "caution"; anyCaution = true; }
      if (D.allergens.indexOf(r.m.id) >= 0 && r.finished >= 0.001) allergens.push(r.m.name_ko);
    });

    var warnings = [];
    if (load > pt.load_max) warnings.push("부향률 " + fmt(load) + "%가 " + pt.name_ko + " 권장 상한(" + fmt(pt.load_max) + "%)을 넘습니다 — 향이 뭉개지고 자극 위험이 커집니다.");
    if (load < pt.load_min) warnings.push("부향률 " + fmt(load) + "%는 " + pt.name_ko + " 권장 하한(" + fmt(pt.load_min) + "%)보다 낮습니다 — 잔향이 거의 없습니다.");
    if (capScale !== 1) warnings.push("노출 경로 보정: " + pt.name_ko + josa(pt.name_ko, "은", "는") + " 피부 도포 제품이 아니라 공간 확산·분무 제형이므로 상한을 ×" + fmt(capScale) + "로 완화해 판정했습니다. 환기·영유아·반려동물 주의는 완화되지 않습니다.");
    rows.forEach(function (r) {
      if (r.status === "over") warnings.push(r.m.name_ko + ": 완성품 " + fmt(r.finished, 3) + "% (적용 상한 " + fmt(r.cap) + "% = 피부 기준 " + fmt(r.capBase) + "% × " + fmt(capScale) + ") — " + fmt(r.ratio, 1) + "배 초과. 배합비를 줄이거나 부향률을 낮추세요.");
      else if (r.status === "caution") warnings.push(r.m.name_ko + ": 완성품 " + fmt(r.finished, 3) + "% — 적용 상한의 " + Math.round(r.ratio * 100) + "%. (" + r.m.cap_basis + ")");
    });
    var petFlags = [];
    rows.forEach(function (r) { if (D.pet_flags[r.m.id]) petFlags.push(D.pet_flags[r.m.id]); });
    if (petFlags.length) warnings.push("영유아·반려동물 주의 성분: " + petFlags.join("; "));

    var alcohol = pt.carriers.reduce(function (s2, c) { return s2 + (/에탄올/.test(c.name) ? c.ratio : 0); }, 0);
    if (alcohol > 0.3) warnings.push("에탄올 비율이 높습니다 — 인화성 액체이므로 화기·정전기·직사광선을 피하세요.");
    var water = pt.carriers.reduce(function (s2, c) { return s2 + (/수/.test(c.name) ? c.ratio : 0); }, 0);
    if (water >= 0.5 && load >= 3) warnings.push("물 비율이 높습니다 — 테르펜이 뿌옇게 분리될 수 있어 사용 전 흔들어 쓰는 제형으로 설계하세요.");
    var solids = rows.filter(function (r) { return r.m.state !== "liquid"; });
    if (solids.length) warnings.push("고체 원료(" + solids.map(function (r) { return r.m.name_ko; }).join(", ") + ")는 부피 대신 무게로 달아 에탄올이나 오일에 먼저 녹인 뒤 섞으세요. 시간이 지나면 결정이 석출될 수 있습니다.");

    var finishedLoad = total ? fragMass / total * 100 : 0;
    if (finishedLoad > load * 1.02) warnings.push("캐리어 밀도가 낮아 향의 질량 비율(w/w)이 부피 기준(w/v)보다 높습니다 — 라벨에는 w/w를 쓰세요.");
    (pt.cautions || []).forEach(function (c) { warnings.push(c); });

    rows.sort(function (a, b) { return (NOTE_ORDER[a.m.note] - NOTE_ORDER[b.m.note]) || (b.share - a.share); });

    return {
      pt: pt, vol: vol, load: load, rows: rows, carriers: carriers,
      total: total, fragMass: fragMass, fragVol: fragVol, finishedLoad: finishedLoad,
      status: (worstOver || load > pt.load_max) ? "over" : (anyCaution ? "caution" : "ok"),
      warnings: warnings, allergens: allergens, balance: noteBalance(items),
      label: pt.name_ko + " " + fmt(vol) + " mL"
    };
  }

  function formulate() {
    var s = state.studio;
    return buildFormula(s.product, s.volume, s.load, s.items);
  }

  /* ------------------------------------------------ property profile (v0.2) */
  // Mirrors olfactra_core.compare.property_profile: mass-weighted means over the
  // concentrate. LogP and TPSA are *derived* descriptors (Crippen / Ertl), not
  // measurements — the METHOD tab says so in words.
  function propProfile(f) {
    var wsum = 0, mw = 0, logp = 0, tpsa = 0, solid = 0;
    var minMw = Infinity, maxMw = 0, minLp = Infinity, maxLp = -Infinity, maxTpsa = 0;
    var maxRatio = 0, over = [], caution = [];
    f.rows.forEach(function (r) {
      var w = r.neatMass;
      var lp = (r.m.logp == null ? 0 : r.m.logp), tp = (r.m.tpsa == null ? 0 : r.m.tpsa);
      wsum += w;
      mw += r.m.molecular_weight * w; logp += lp * w; tpsa += tp * w;
      minMw = Math.min(minMw, r.m.molecular_weight); maxMw = Math.max(maxMw, r.m.molecular_weight);
      minLp = Math.min(minLp, lp); maxLp = Math.max(maxLp, lp); maxTpsa = Math.max(maxTpsa, tp);
      if (r.m.state !== "liquid") solid += r.share;
      maxRatio = Math.max(maxRatio, r.ratio);
      if (r.status === "over") over.push(r.m.name_ko);
      if (r.status === "caution") caution.push(r.m.name_ko);
    });
    var mean = function (v) { return wsum ? v / wsum : 0; };
    return {
      materials: f.rows.length,
      mean_mw: rounded(mean(mw)), min_mw: rounded(minMw === Infinity ? 0 : minMw), max_mw: rounded(maxMw),
      mean_logp: Math.round(mean(logp) * 100) / 100,
      min_logp: Math.round((minLp === Infinity ? 0 : minLp) * 100) / 100,
      max_logp: Math.round((maxLp === -Infinity ? 0 : maxLp) * 100) / 100,
      mean_tpsa: Math.round(mean(tpsa) * 100) / 100, max_tpsa: maxTpsa,
      solid_share_pct: rounded(solid),
      note_share_pct: {
        top: rounded((f.balance.top || 0) * 100), middle: rounded((f.balance.middle || 0) * 100),
        base: rounded((f.balance.base || 0) * 100)
      },
      fragrance_mass_g: f.fragMass, total_mass_g: f.total,
      finished_load_pct_ww: f.finishedLoad,
      max_cap_ratio: Math.round(maxRatio * 1000) / 1000,
      headroom_pct: Math.round(Math.max(0, 1 - maxRatio) * 1000) / 10,
      status: f.status, over: over, caution: caution, allergens: f.allergens.slice()
    };
  }

  function statusKo(s) { return s === "ok" ? "적합" : (s === "caution" ? "주의" : "상한 초과"); }

  function compareFormulas(fa, fb, labelA, labelB) {
    var pa = propProfile(fa), pb = propProfile(fb);
    var d = {
      mean_mw: rounded(pb.mean_mw - pa.mean_mw),
      mean_logp: Math.round((pb.mean_logp - pa.mean_logp) * 100) / 100,
      mean_tpsa: Math.round((pb.mean_tpsa - pa.mean_tpsa) * 100) / 100,
      finished_load_pct_ww: Math.round((pb.finished_load_pct_ww - pa.finished_load_pct_ww) * 100) / 100,
      headroom_pct: Math.round((pb.headroom_pct - pa.headroom_pct) * 10) / 10,
      max_cap_ratio: Math.round((pb.max_cap_ratio - pa.max_cap_ratio) * 1000) / 1000
    };
    var summary = [];
    if (pa.status !== pb.status) {
      summary.push("안전 판정이 다릅니다 — " + labelA + " '" + statusKo(pa.status) + "', " + labelB + " '" + statusKo(pb.status) + "'.");
    }
    if (Math.abs(d.headroom_pct) >= 5) {
      summary.push("상한 여유분은 " + labelB + "가 " + fmt(pb.headroom_pct, 1) + "%, " + labelA + "가 " + fmt(pa.headroom_pct, 1) +
        "% — " + (d.headroom_pct < 0 ? labelB : labelA) + " 쪽이 상한에 더 가깝습니다 (" + fmt(Math.abs(d.headroom_pct), 1) + "%p 차이).");
    }
    var dom = "top", domv = 0;
    NOTES.forEach(function (n) {
      var v = pb.note_share_pct[n.id] - pa.note_share_pct[n.id];
      if (Math.abs(v) > Math.abs(domv)) { dom = n.id; domv = v; }
    });
    if (Math.abs(domv) >= 3) {
      summary.push(NOTE_LABEL[dom] + " 노트가 " + (domv > 0 ? "+" : "") + fmt(domv, 1) + "%p (" +
        labelA + " " + fmt(pa.note_share_pct[dom], 0) + "% → " + labelB + " " + fmt(pb.note_share_pct[dom], 0) + "%).");
    }
    if (Math.abs(d.mean_mw) >= 5) {
      summary.push("평균 분자량은 " + fmt(pa.mean_mw, 1) + " → " + fmt(pb.mean_mw, 1) + " g/mol (" +
        (d.mean_mw > 0 ? "+" : "") + fmt(d.mean_mw, 1) + ") — " + (d.mean_mw > 0 ? "무거운" : "가벼운") + " 쪽으로 이동.");
    }
    if (Math.abs(d.mean_logp) >= 0.2) {
      summary.push("평균 계산 LogP " + fmt(pa.mean_logp, 2) + " → " + fmt(pb.mean_logp, 2) + " (" +
        (d.mean_logp > 0 ? "+" : "") + fmt(d.mean_logp, 2) + ") — " + (d.mean_logp > 0 ? "더 소수성" : "더 극성") + "인 조성.");
    }
    if (Math.abs(d.mean_tpsa) >= 1.0) {
      summary.push("평균 TPSA " + fmt(pa.mean_tpsa, 1) + " → " + fmt(pb.mean_tpsa, 1) + " Å² (" +
        (d.mean_tpsa > 0 ? "+" : "") + fmt(d.mean_tpsa, 1) + ").");
    }
    var added = pb.allergens.filter(function (x) { return pa.allergens.indexOf(x) < 0; });
    var removed = pa.allergens.filter(function (x) { return pb.allergens.indexOf(x) < 0; });
    if (added.length || removed.length) {
      var bits = [];
      if (added.length) bits.push(labelB + "에 새로 표시 대상: " + added.join(", "));
      if (removed.length) bits.push(labelA + "에만 있던 표시 대상: " + removed.join(", "));
      summary.push("알레르겐 표시 — " + bits.join("; ") + ".");
    }
    if (!summary.length) summary.push("두 배합의 노트 구조·물성·안전 여유분이 거의 같습니다.");
    return { a: { label: labelA, formula: fa, profile: pa }, b: { label: labelB, formula: fb, profile: pb }, deltas: d, summary: summary };
  }

  function compareTableHtml(cmp) {
    var rows = [];
    function add(label, a, b, delta, evidence) {
      rows.push("<tr><td>" + esc(label) + '</td><td class="num">' + a + '</td><td class="num">' + b +
        '</td><td class="num">' + (delta || "") + "</td><td>" + esc(evidence || "") + "</td></tr>");
    }
    var pa = cmp.a.profile, pb = cmp.b.profile, d = cmp.deltas;
    NOTES.forEach(function (n) {
      var dv = rounded(pb.note_share_pct[n.id] - pa.note_share_pct[n.id]);
      add(n.label + " 노트 %", fmt(pa.note_share_pct[n.id], 1), fmt(pb.note_share_pct[n.id], 1),
        (dv > 0 ? "+" : "") + fmt(dv, 1), "휴리스틱");
    });
    add("원료 수", pa.materials, pb.materials, "", "—");
    add("평균 분자량 (g/mol)", fmt(pa.mean_mw, 2), fmt(pb.mean_mw, 2), (d.mean_mw > 0 ? "+" : "") + fmt(d.mean_mw, 2), "측정(PubChem)");
    add("평균 LogP", fmt(pa.mean_logp, 2), fmt(pb.mean_logp, 2), (d.mean_logp > 0 ? "+" : "") + fmt(d.mean_logp, 2), "유도(Crippen)");
    add("평균 TPSA (Å²)", fmt(pa.mean_tpsa, 1), fmt(pb.mean_tpsa, 1), (d.mean_tpsa > 0 ? "+" : "") + fmt(d.mean_tpsa, 1), "유도(Ertl)");
    add("완성품 부향률 (% w/w)", fmt(pa.finished_load_pct_ww, 2), fmt(pb.finished_load_pct_ww, 2),
      (d.finished_load_pct_ww > 0 ? "+" : "") + fmt(d.finished_load_pct_ww, 2), "유도(계량)");
    add("최대 상한 사용률", pct(pa.max_cap_ratio * 100), pct(pb.max_cap_ratio * 100),
      (d.max_cap_ratio > 0 ? "+" : "") + fmt(d.max_cap_ratio * 100, 0) + "%p", "휴리스틱");
    add("남은 여유분", fmt(pa.headroom_pct, 1) + "%", fmt(pb.headroom_pct, 1) + "%",
      (d.headroom_pct > 0 ? "+" : "") + fmt(d.headroom_pct, 1) + "%p", "휴리스틱");
    add("판정", statusKo(pa.status), statusKo(pb.status), "", "휴리스틱");
    add("표시 대상 알레르겐", pa.allergens.join(", ") || "—", pb.allergens.join(", ") || "—", "", "측정(EU 목록)");
    return rows.join("");
  }

  /* --------------------------------------------------------------- labels */
  var LABELS = { mood: {}, season: {}, space: {}, style: {} };
  D.meta.dimensions.moods.forEach(function (d) { LABELS.mood[d.id] = d.label; });
  D.meta.dimensions.seasons.forEach(function (d) { LABELS.season[d.id] = d.label; });
  D.meta.dimensions.spaces.forEach(function (d) { LABELS.space[d.id] = d.label; });
  D.meta.dimensions.styles.forEach(function (d) { LABELS.style[d.id] = d.label; });

  /* --------------------------------------------------------------- routing */
  function setTab(tab, push) {
    state.tab = tab;
    $$(".nav-btn").forEach(function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    ["id", "studio", "atlas", "molecule", "method"].forEach(function (t) {
      var panel = byId("panel-" + t);
      if (panel) panel.hidden = (t !== tab);
    });
    if (tab === "molecule") { requestAnimationFrame(drawMoleculeViews); }
    if (tab === "atlas") { requestAnimationFrame(function () { if (state.atlas.selected) scrollToDetail(); }); }
    if (tab === "studio") { requestAnimationFrame(renderCompare); }
    if (push !== false) {
      try { history.replaceState(null, "", "#" + tab); } catch (e) { /* file:// */ }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ================================================================ ID tab */
  function renderIdControls() {
    var host = byId("id-controls");
    var groups = [["mood", "기분"], ["season", "계절"], ["space", "공간"], ["style", "스타일"]];
    host.innerHTML = groups.map(function (g) {
      var key = g[0];
      var dim = D.meta.dimensions[key === "mood" ? "moods" : key + "s"];
      return '<div class="field-group"><span class="group-label">' + esc(g[1]) + "</span>" +
        '<div class="chips" data-group="' + key + '">' +
        dim.map(function (d) {
          var on = state.id[key] === d.id;
          return '<button type="button" class="chip' + (on ? " is-on" : "") + '" data-value="' + esc(d.id) +
            '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(d.label) + "</button>";
        }).join("") + "</div></div>";
    }).join("");

    $$("#id-controls .chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var group = btn.closest("[data-group]").getAttribute("data-group");
        var value = btn.getAttribute("data-value");
        state.id[group] = (state.id[group] === value) ? null : value;
        renderIdControls();
        renderIdResults();
      });
    });
  }

  /* ------------------------------------------------------- Pyrfume evidence */
  function numOrNa(v) {
    return (v == null) ? '<span class="na">미측정</span>' : '<span class="num">' + fmt(v, 1) + "</span>";
  }

  function doiLinks() {
    var src = (D.meta.pyrfume && D.meta.pyrfume.sources) || {};
    return Object.keys(src).map(function (k) {
      var s = src[k];
      return '<a href="https://doi.org/' + esc(s.doi) + '" target="_blank" rel="noopener">' +
        esc(s.label) + "</a>";
    }).join("") + '<a href="https://github.com/pyrfume/pyrfume-data" target="_blank" rel="noopener">Pyrfume (MIT)</a>';
  }

  function accordEvidenceHtml(a, prior) {
    var ids = Object.keys(a.materials).filter(function (id) { return a.materials[id] > 0 && MOL[id]; });
    if (!ids.length) return "";
    var total = ids.reduce(function (s, id) { return s + a.materials[id]; }, 0) || 1;
    var rows = ids.map(function (id) {
      var m = MOL[id], p = m.pyrfume || {};
      var share = a.materials[id] / total;
      var terms = (p.dravnieks || []).slice(0, 3).map(function (t) {
        return t.term_ko ? t.term_ko : t.term.toLowerCase();
      }).join(" · ");
      return '<div class="pyr-row"><b>' + esc(m.name_ko) +
        (terms ? '<span class="pyr-terms">' + esc(terms) + "</span>" : "") + "</b>" +
        '<span class="num">' + Math.round(share * 100) + "%</span>" +
        numOrNa(p.pleasantness) + numOrNa(p.intensity) + numOrNa(p.familiarity) + "</div>";
    }).join("");
    var measured = ids.filter(function (id) { var p = MOL[id].pyrfume || {}; return p.pleasantness != null; }).length;
    var summary = measured ?
      "Keller 실측 " + measured + "/" + ids.length + "분자" + (prior ? " · 평균 " + Math.round(prior.mean) + "/100" : "") :
      "실측값 없음";
    return '<details class="pyr"><summary><span class="pyr-badge">학술 데이터 근거</span>' +
      '<span class="pyr-cov">Pyrfume · ' + summary + '</span></summary>' +
      '<div class="pyr-body">' +
      '<div class="pyr-row head"><span>구성 분자</span><span class="num">비중</span>' +
      '<span class="num">쾌적도</span><span class="num">강도</span><span class="num">친숙도</span></div>' +
      rows +
      '<p class="pyr-note">쾌적도·강도·친숙도는 Keller & Vosshall 2016의 <b>단품</b> 평균 평점(0–100)이고,' +
      ' 기술어는 Dravnieks 1985 프로파일입니다. 혼합물의 향은 성분의 합이 아니므로(마스킹·상승·적응)' +
      ' 이 값은 완성된 아코드의 냄새·쾌적도를 예측하지 않습니다. 측정값이 없는 분자는 <b>미측정</b>으로 두었습니다.</p>' +
      '<div class="pyr-src">' + doiLinks() + "</div></div></details>";
  }

  function moleculePyrfumeHtml(m) {
    var p = m.pyrfume || {};
    if (!p.measured) {
      return '<div class="ad-section"><h4>학술 후각 데이터 · Pyrfume</h4>' +
        '<p class="tiny-note">Pyrfume 공개 데이터와 PubChem CID로 매칭되는 <b>실측값이 없습니다</b> ' +
        '(43개 중 23개가 매칭됨). 이 분자의 향 설명은 일반 정유·화학 문헌과 조향 관행에 근거한 서술입니다.</p>' +
        '<div class="pyr-src">' + doiLinks() + "</div></div>";
    }
    var bars = "";
    [["쾌적도", p.pleasantness], ["강도", p.intensity], ["친숙도", p.familiarity]].forEach(function (kv) {
      if (kv[1] == null) return;
      bars += '<div class="pyr-metric"><span>' + kv[0] + '</span><div class="bar"><i style="width:' +
        Math.max(2, kv[1]) + '%"></i></div><em>' + Math.round(kv[1]) + "</em></div>";
    });
    var terms = (p.dravnieks || []).slice(0, 5).map(function (t) {
      return '<span class="pyr-term">' + esc(t.term_ko || t.term.toLowerCase()) + " " + Math.round(t.use) + "</span>";
    }).join("");
    var ors = (p.receptors || []).slice(0, 6).map(function (r) {
      return '<span class="pyr-term"' + (r.dose_response ? ' style="border-color:var(--accent)"' : "") +
        ">" + esc(r.gene) + (r.dose_response ? " ✓" : "") + "</span>";
    }).join("");
    return '<div class="ad-section"><h4>학술 후각 데이터 · Pyrfume</h4>' + bars +
      (terms ? '<p class="tiny-note" style="margin-top:8px">Dravnieks 1985 대표 기술어 (사용도 %)</p><div class="pyr-terms">' + terms + "</div>" : "") +
      (ors ? '<p class="tiny-note" style="margin-top:8px">Mainland 2015 반응 수용체 (' + p.receptors_tested + '개 중, ✓ = 농도–반응 통과)</p><div class="pyr-terms">' + ors + "</div>" : "") +
      '<p class="tiny-note">' + (p.raters ? "Keller 2016 평정자 최대 " + p.raters + "명 · " : "") +
      "단품 측정값이며 혼합물의 향을 예측하지 않습니다.</p>" +
      '<div class="pyr-src">' + doiLinks() + "</div></div>";
  }

  function notePyramidHtml(balance) {
    return '<div class="note-pyramid">' + NOTES.map(function (n) {
      var v = (balance[n.id] || 0) * 100;
      return '<div class="note-row" data-note="' + n.id + '"><span>' + esc(n.label) + "</span>" +
        '<div class="bar"><i style="width:' + v.toFixed(1) + '%"></i></div><em>' + Math.round(v) + "%</em></div>";
    }).join("") + "</div>";
  }

  function accordItems(accord) {
    return Object.keys(accord.materials).map(function (id) { return { id: id, share: accord.materials[id] }; });
  }

  function renderIdResults() {
    var host = byId("id-results");
    var picks = recommend(state.id, 3);
    if (!picks.length) { host.innerHTML = '<p class="placeholder">조건을 골라 주세요.</p>'; return; }
    host.innerHTML = picks.map(function (p, i) {
      var a = p.accord;
      var pt = PRODUCT[a.product_hint];
      var norm = normalisedItems(accordItems(a));
      var rows = norm.map(function (it) {
        var m = MOL[it.id];
        return '<li><span class="share">' + fmt(it.share) + "%</span><b>" + esc(m.name_ko) + "</b>" +
          '<span class="note-tag" data-note="' + m.note + '">' + esc(NOTE_LABEL[m.note]) + "</span>" +
          '<span class="desc">' + esc(m.descriptor_ko) + "</span></li>";
      }).join("");
      var warns = p.report.warnings.slice();
      if (a.caution) warns.push(a.caution);
      var reasons = p.reasons.length ? p.reasons : ["조건이 지정되지 않아 향조 균형과 노트 구조를 기준으로 제안했습니다"];
      var hasScore = p.score > 0.5;
      var scoreText = hasScore ? String(Math.round(p.score)) : "—";
      return '<article class="result-card' + (i === 0 ? " is-first" : "") + '">' +
        '<div class="result-head"><div>' +
        '<p class="result-kicker">' + (hasScore ? "추천 " + (i + 1) : "균형 추천 " + (i + 1)) + " · " + esc(pt ? pt.name_ko : a.product_hint) + "</p>" +
        "<h3>" + esc(a.name_ko) + "<span>" + esc(a.name_en) + "</span></h3>" +
        '<p class="result-tagline">' + esc(a.tagline) + "</p></div>" +
        '<div class="score"><b>' + scoreText + '</b><span>' + (hasScore ? "fit" : "harmony") + '</span>' +
        '<div class="score-bar"><i style="width:' + (hasScore ? p.score.toFixed(0) : "0") + '%"></i></div></div></div>' +
        notePyramidHtml(p.report.balance) +
        '<ul class="mat-list">' + rows + "</ul>" +
        '<ul class="reasons">' + reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>" +
        accordEvidenceHtml(a, p.prior) +
        (warns.length ? '<details class="warn"><summary>주의 ' + warns.length + "건</summary><ul>" +
          warns.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></details>" : "") +
        '<p class="tiny-note">조화 지수 ' + p.report.harmony.toFixed(2) + " · " + esc(a.story) + "</p>" +
        '<div class="row tight"><button type="button" class="btn small primary" data-to-studio="' + esc(a.id) + '">STUDIO에서 계산</button>' +
        '<button type="button" class="btn small ghost" data-copy="' + esc(a.id) + '">배합 복사</button></div>' +
        "</article>";
    }).join("");

    $$("#id-results [data-to-studio]").forEach(function (b) {
      b.addEventListener("click", function () { loadAccord(b.getAttribute("data-to-studio")); });
    });
    $$("#id-results [data-copy]").forEach(function (b) {
      b.addEventListener("click", function () { copyAccord(b.getAttribute("data-copy"), b); });
    });
  }

  function copyAccord(id, btn) {
    var a = ACCORD[id];
    var norm = normalisedItems(accordItems(a));
    var text = a.name_ko + " (" + a.name_en + ")\n" + norm.map(function (it) {
      return "  " + MOL[it.id].name_ko + " (" + MOL[it.id].name + ") " + fmt(it.share) + "%";
    }).join("\n") + "\n— OLFACTRA · FEI · HEL Lab (MIT)";
    var done = function () {
      if (!btn) return;
      var old = btn.textContent; btn.textContent = "복사됨";
      setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { download("olfactra-accord.txt", text); });
    } else { download("olfactra-accord.txt", text); }
  }

  function loadAccord(id, opts) {
    var a = ACCORD[id];
    if (!a) return;
    state.studio.source = a.name_ko;
    state.studio.items = accordItems(a).map(function (it) { return { id: it.id, share: it.share }; });
    if (!opts || opts.keepProduct !== true) {
      state.studio.product = a.product_hint;
      state.studio.load = null;
    }
    saveStudio();
    renderStudio();
    setTab("studio");
  }

  /* ============================================================ STUDIO tab */
  function saveStudio() {
    try {
      localStorage.setItem("olfactra.studio.v1", JSON.stringify({
        product: state.studio.product, volume: state.studio.volume,
        load: state.studio.load, items: state.studio.items, source: state.studio.source
      }));
    } catch (e) { /* private mode */ }
  }

  function restoreStudio() {
    try {
      var raw = localStorage.getItem("olfactra.studio.v1");
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.items)) return false;
      state.studio.product = PRODUCT[saved.product] ? saved.product : state.studio.product;
      state.studio.volume = Number(saved.volume) || state.studio.volume;
      state.studio.load = (saved.load == null) ? null : Number(saved.load);
      state.studio.items = saved.items.filter(function (it) { return MOL[it.id]; });
      state.studio.source = saved.source || "";
      return true;
    } catch (e) { return false; }
  }

  function renderStudioProducts() {
    var sel = byId("studio-product");
    sel.innerHTML = D.products.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name_ko) + " · " + esc(p.name_en) + "</option>";
    }).join("");
    sel.value = state.studio.product;
  }

  function renderStudioAddOptions() {
    var sel = byId("studio-add-select");
    var have = state.studio.items.map(function (i) { return i.id; });
    var sorted = MOL_LIST.slice().sort(function (a, b) {
      return (NOTE_ORDER[a.note] - NOTE_ORDER[b.note]) || a.name_ko.localeCompare(b.name_ko, "ko");
    });
    sel.innerHTML = '<option value="">원료 추가…</option>' + sorted.filter(function (m) {
      return have.indexOf(m.id) < 0;
    }).map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(NOTE_LABEL[m.note]) + " · " + esc(m.name_ko) + " (" + esc(m.formula) + ")</option>";
    }).join("");
  }

  function renderStudioItems() {
    var host = byId("studio-items");
    var items = state.studio.items;
    byId("studio-source").textContent = state.studio.source
      ? "불러온 아코드: " + state.studio.source : "직접 배합";
    if (!items.length) {
      host.innerHTML = '<p class="empty-note">원료가 없습니다. ID 탭에서 아코드를 불러오거나 아래에서 원료를 추가하세요.</p>';
    } else {
      host.innerHTML = items.map(function (it, idx) {
        var m = MOL[it.id];
        var cap = m.working_cap_pct;
        return '<div class="item" data-idx="' + idx + '">' +
          '<div class="item-head"><b>' + esc(m.name_ko) + "</b>" +
          '<span class="note-tag" data-note="' + m.note + '">' + esc(NOTE_LABEL[m.note]) + "</span>" +
          '<span class="item-cap">상한 ' + fmt(cap) + "%</span>" +
          '<button type="button" class="icon-btn" data-remove="' + idx + '" aria-label="' + esc(m.name_ko) + ' 삭제">×</button></div>' +
          '<div class="item-body"><input type="range" min="0" max="100" step="1" value="' +
          Math.round(it.share) + '" data-share="' + idx + '" aria-label="' + esc(m.name_ko) + ' 비중">' +
          "<output>" + fmt(it.share) + "%</output></div></div>";
      }).join("");
      $$("#studio-items [data-share]").forEach(function (input) {
        input.addEventListener("input", function () {
          var idx = Number(input.getAttribute("data-share"));
          state.studio.items[idx].share = Number(input.value);
          input.nextElementSibling.textContent = fmt(input.value) + "%";
          renderStudioResults();
          saveStudio();
        });
      });
      $$("#studio-items [data-remove]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          state.studio.items.splice(Number(btn.getAttribute("data-remove")), 1);
          state.studio.source = state.studio.source ? state.studio.source + " (편집)" : "직접 배합";
          renderStudioItems(); renderStudioAddOptions(); renderStudioResults(); saveStudio();
        });
      });
    }
    var sum = state.studio.items.reduce(function (s, it) { return s + Number(it.share); }, 0);
    var note = byId("studio-load-note");
    var pt = PRODUCT[state.studio.product];
    note.textContent = "권장 " + fmt(pt.load_min) + "–" + fmt(pt.load_max) + "% · 배합 합계 " + fmt(sum) + "%";
    note.style.color = (Math.abs(sum - 100) > 0.5 && state.studio.items.length) ? "var(--warn)" : "";
  }

  function renderStudioResults() {
    var f = formulate();
    var summary = byId("studio-summary");
    var tbody = $("#studio-table tbody");
    var cbody = $("#studio-carriers tbody");
    var safety = byId("studio-safety");
    if (!f) {
      summary.innerHTML = "";
      tbody.innerHTML = '<tr><td colspan="8" class="placeholder">원료를 추가하면 계산됩니다.</td></tr>';
      cbody.innerHTML = "";
      safety.className = "safety";
      safety.innerHTML = "<h4>안전 판정</h4><p>계산할 배합이 없습니다.</p>";
      return;
    }
    summary.innerHTML = [
      ["총 용량", fmt(f.vol), "mL"],
      ["부향률", fmt(f.load), "%"],
      ["완성품 부향률", fmt(f.finishedLoad, 2), "% w/w"],
      ["향 농축액", fmt(f.fragMass, 2), "g"],
      ["총 무게", fmt(f.total, 2), "g"],
      ["판정", f.status === "ok" ? "적합" : (f.status === "caution" ? "주의" : "초과"), ""]
    ].map(function (row) {
      return '<div class="stat"><div class="k">' + esc(row[0]) + '</div><div class="v">' +
        esc(row[1]) + (row[2] ? '<span class="u">' + esc(row[2]) + "</span>" : "") + "</div></div>";
    }).join("");

    tbody.innerHTML = f.rows.map(function (r) {
      return "<tr><td><b>" + esc(r.m.name_ko) + "</b><br><span class=\"mono\" style=\"color:var(--muted)\">" +
        esc(r.m.formula) + (r.m.state !== "liquid" ? " · 고체" : "") + "</span></td>" +
        '<td><span class="note-tag" data-note="' + r.m.note + '">' + esc(NOTE_LABEL[r.m.note]) + "</span></td>" +
        '<td class="num">' + fmt(r.share) + '</td><td class="num">' + fmt(r.neatVol, 3) +
        '</td><td class="num">' + fmt(r.neatMass, 3) +
        '</td><td class="num">' + fmt(r.finished, 3) +
        '</td><td class="num">' + fmt(r.capBase) + (f.pt.cap_scale !== 1 ?
          ' <span style="color:var(--muted)">×' + fmt(f.pt.cap_scale) + "</span>" : "") + '</td>' +
        '<td><span class="status-pill ' + r.status + '">' +
        (r.status === "ok" ? "ok" : (r.status === "caution" ? "주의" : "초과")) + "</span></td></tr>";
    }).join("");

    cbody.innerHTML = f.carriers.map(function (c) {
      return "<tr><td>" + esc(c.c.name) + "</td><td>" + esc(c.c.role) + '</td><td class="num">' +
        fmt(c.c.ratio * 100) + '%</td><td class="num">' + fmt(c.vol, 3) + '</td><td class="num">' +
        fmt(c.mass, 3) + "</td></tr>";
    }).join("");

    safety.className = "safety" + (f.status === "ok" ? " clean" : "");
    safety.innerHTML = "<h4>안전 판정 · " + (f.status === "ok" ? "적합" : (f.status === "caution" ? "주의" : "상한 초과")) + "</h4>" +
      (f.allergens.length ? '<p style="margin-bottom:8px">라벨 표시 대상 알레르겐(EU 기준 0.001% 이상): <b>' +
        esc(f.allergens.join(", ")) + "</b></p>" : "") +
      "<ul>" + f.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>";

    var p = propProfile(f);
    var propHost = byId("studio-properties");
    if (propHost) {
      propHost.innerHTML = [
        ["평균 분자량", fmt(p.mean_mw, 1), "g/mol"],
        ["평균 LogP", fmt(p.mean_logp, 2), "계산"],
        ["평균 TPSA", fmt(p.mean_tpsa, 1), "Å²"],
        ["상한 여유분", fmt(p.headroom_pct, 1), "%"]
      ].map(function (row) {
        return '<div class="stat prop"><div class="k">' + esc(row[0]) + '</div><div class="v">' +
          esc(row[1]) + '<span class="u">' + esc(row[2]) + "</span></div></div>";
      }).join("");
    }
    renderCompare();
  }

  function recipeRows(f) {
    return f.rows.map(function (r, i) {
      return {
        no: i + 1, material: r.m.name, material_ko: r.m.name_ko, cas: r.m.cas || "",
        formula: r.m.formula, note: NOTE_LABEL[r.m.note],
        share: fmt(r.share), volume_ml: fmt(r.neatVol, 3), mass_g: fmt(r.neatMass, 3),
        finished_pct_ww: fmt(r.finished, 4), cap_pct: fmt(r.cap), cap_ratio: r.ratio.toFixed(3),
        status: r.status, allergen: D.allergens.indexOf(r.m.id) >= 0 ? "Y" : "", state: r.m.state
      };
    });
  }

  function studioCsv(f) {
    var cols = ["no", "material", "material_ko", "cas", "formula", "note", "share_of_concentrate_pct",
      "volume_ml", "mass_g", "finished_pct_ww", "cap_pct", "cap_ratio", "status", "allergen_label", "state"];
    var lines = [cols.join(",")];
    recipeRows(f).forEach(function (r) {
      lines.push([r.no, q(r.material), q(r.material_ko), q(r.cas), q(r.formula), q(r.note), r.share,
        r.volume_ml, r.mass_g, r.finished_pct_ww, r.cap_pct, r.cap_ratio, r.status, r.allergen, r.state].join(","));
    });
    lines.push("");
    lines.push(["# product_type", q(f.pt.name_ko), f.pt.id].join(","));
    lines.push(["# volume_ml", f.vol].join(","));
    lines.push(["# load_pct", f.load].join(","));
    lines.push(["# finished_load_pct_ww", fmt(f.finishedLoad, 3)].join(","));
    lines.push(["# total_mass_g", fmt(f.total, 3)].join(","));
    lines.push(["# status", f.status].join(","));
    lines.push(["# license", "MIT", q(D.meta.copyright)].join(","));
    lines.push(["# warning", q(f.warnings.join(" | "))].join(","));
    return "\ufeff" + lines.join("\n") + "\n";
  }
  function q(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // numeric material rows — the shape olfactra_core.exporter.formula_to_dict writes
  function materialDicts(f) {
    return f.rows.map(function (r) {
      return {
        id: r.m.id, name: r.m.name, name_ko: r.m.name_ko, note: r.m.note,
        share_pct: Number(fmt(r.share, 2)), volume_ml: Number(fmt(r.neatVol, 3)),
        mass_g: Number(fmt(r.neatMass, 3)), finished_pct_ww: Number(fmt(r.finished, 4)),
        cap_pct: Number(fmt(r.cap, 3)), cap_base_pct: r.capBase,
        cap_ratio: Number(fmt(r.ratio, 3)), status: r.status,
        is_solid: r.m.state !== "liquid",
        allergen: D.allergens.indexOf(r.m.id) >= 0
      };
    });
  }

  function studioJson(f) {
    var bundle = {
      schema_version: "0.2.0",
      meta: {
        project: "OLFACTRA", version: D.meta.version, schema_version: "0.2.0", license: "MIT",
        copyright: D.meta.copyright, generated: new Date().toISOString().slice(0, 10),
        science_boundary: D.meta.science_boundary, safety_boundary: D.meta.safety_boundary
      },
      formula: {
        product_type: f.pt.id, product_type_ko: f.pt.name_ko, volume_ml: f.vol,
        load_pct: f.load, total_mass_g: Number(fmt(f.total, 3)),
        fragrance_mass_g: Number(fmt(f.fragMass, 3)), fragrance_volume_ml: Number(fmt(f.fragVol, 3)),
        finished_load_pct_ww: Number(fmt(f.finishedLoad, 3)), status: f.status
      },
      materials: materialDicts(f),
      carriers: f.carriers.map(function (c) {
        return { name: c.c.name, role: c.c.role, ratio: c.c.ratio, volume_ml: Number(fmt(c.vol, 3)), mass_g: Number(fmt(c.mass, 3)) };
      }),
      note_balance: {
        top: rounded(f.balance.top || 0), middle: rounded(f.balance.middle || 0), base: rounded(f.balance.base || 0)
      },
      property_profile: propProfile(f),
      allergens: f.allergens,
      warnings: f.warnings
    };
    if (D.provenance) bundle.methodology = D.provenance;
    return JSON.stringify(bundle, null, 2);
  }

  /* ------------------------------------------------- Markdown research report */
  var PROV_TABLE_ROWS = [
    ["pubchem_record", "측정"], ["dilution_arithmetic", "유도"], ["safety_gate", "휴리스틱"],
    ["note_pyramid", "휴리스틱"], ["logp_crippen", "유도"], ["tpsa_ertl", "유도"],
    ["odour_family_vector", "휴리스틱"], ["blend_harmony", "휴리스틱"]
  ];

  function provOf(id) {
    var list = (D.provenance && D.provenance.indicators) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function provTableMarkdown(ids) {
    var lines = ["| 지표 | 근거 등급 | 수식·방법 | 경계 |", "| --- | --- | --- | --- |"];
    ids.forEach(function (id) {
      var ind = provOf(id); if (!ind) return;
      lines.push("| **" + ind.label_ko + "** (" + ind.unit + ") | " + ind.kind_label + " | " +
        String(ind.formula).replace(/\|/g, "\\|") + " | " + String(ind.boundary_ko).replace(/\|/g, "\\|") + " |");
    });
    return lines.join("\n");
  }

  function provRefsMarkdown() {
    var refs = (D.provenance && D.provenance.references) || [];
    return refs.map(function (r) {
      return "- **" + r.label + "** — " + r.detail + (r.link ? " <" + r.link + ">" : "");
    }).join("\n");
  }

  function boundary(name) {
    return (D.provenance && D.provenance.boundaries && D.provenance.boundaries[name]) || "";
  }

  function studioMarkdown(f) {
    var p = propProfile(f);
    var out = [];
    out.push("# OLFACTRA 배합 보고서 — " + f.pt.name_ko, "");
    out.push("- 버전: **OLFACTRA " + D.meta.version + "** · JSON schema `0.2.0` · MIT License");
    out.push("- 생성일: " + new Date().toISOString().slice(0, 10));
    out.push("- 제형: **" + f.pt.name_ko + "** (" + f.pt.id + ") · " + fmt(f.vol) + " mL · 부향률 " +
      fmt(f.load) + "% (완성품 " + fmt(f.finishedLoad, 2) + "% w/w)");
    out.push("- 총 무게 " + fmt(f.total, 2) + " g (향 농축액 " + fmt(f.fragMass, 2) + " g)");
    out.push("- 안전 판정: **" + statusKo(f.status) + "**", "");
    out.push("> 이 보고서는 **후보 배합**을 계산한 것입니다. 완성된 혼합물의 냄새를 예측하지 않으며, " +
      "관능평가·GC-MS 분석·안전성 평가를 대체하지 않습니다.", "");
    out.push("## 1. 계량표", "");
    out.push("| No | 원료 | CAS | 노트 | 비중 (%) | mL | g | 완성품 (% w/w) | 적용 상한 (%) | 판정 |");
    out.push("| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
    f.rows.forEach(function (r, i) {
      out.push("| " + (i + 1) + " | " + r.m.name_ko + " (" + r.m.name + ") | " + (r.m.cas || "—") + " | " +
        NOTE_LABEL[r.m.note] + " | " + fmt(r.share, 1) + " | " + fmt(r.neatVol, 3) + " | " +
        fmt(r.neatMass, 3) + " | " + fmt(r.finished, 4) + " | " + fmt(r.capBase) +
        (f.pt.cap_scale !== 1 ? " ×" + fmt(f.pt.cap_scale) : "") + " | " +
        (r.status === "ok" ? "적합" : (r.status === "caution" ? "주의" : "초과")) + " |");
    });
    out.push("", "### 캐리어", "", "| 캐리어 | 역할 | 비율 (%) | mL | g |", "| --- | --- | ---: | ---: | ---: |");
    f.carriers.forEach(function (c) {
      out.push("| " + c.c.name + " | " + (c.c.role || "") + " | " + fmt(c.c.ratio * 100, 1) + " | " +
        fmt(c.vol, 3) + " | " + fmt(c.mass, 3) + " |");
    });
    out.push("", "## 2. 노트 피라미드", "", "| 노트 | 비중 (%) |", "| --- | ---: |");
    NOTES.forEach(function (n) { out.push("| " + n.label + " | " + fmt(p.note_share_pct[n.id], 1) + " |"); });
    out.push("", "## 3. 물성 프로파일 (질량 가중 평균, 유도 지표)", "",
      "| 지표 | 값 | 근거 등급 |", "| --- | ---: | --- |",
      "| 원료 수 | " + p.materials + " | — |",
      "| 평균 분자량 (g/mol) | " + fmt(p.mean_mw, 2) + " | 측정(PubChem) |",
      "| 분자량 범위 (g/mol) | " + fmt(p.min_mw, 2) + "–" + fmt(p.max_mw, 2) + " | 측정(PubChem) |",
      "| 평균 계산 LogP | " + fmt(p.mean_logp, 2) + " | 유도(Crippen) |",
      "| LogP 범위 | " + fmt(p.min_logp, 2) + "–" + fmt(p.max_logp, 2) + " | 유도(Crippen) |",
      "| 평균 TPSA (Å²) | " + fmt(p.mean_tpsa, 2) + " | 유도(Ertl) |",
      "| 고체 원료 비중 (%) | " + fmt(p.solid_share_pct, 1) + " | — |", "",
      "LogP와 TPSA는 공개 SMILES에서 계산한 **추정치**이며 실측값이 아닙니다. " +
      "휘발성·발향 지속시간의 대리값으로 쓰지 마세요(METHOD 탭의 지표 경계 참고).", "");
    out.push("## 4. 안전 판정", "",
      "- 판정: **" + statusKo(f.status) + "**",
      "- 최대 상한 사용률: " + Math.round(p.max_cap_ratio * 100) + "% · 남은 여유분 " + fmt(p.headroom_pct, 1) + "%",
      "- 표시 대상 알레르겐(EU 0.001% 이상): " + (f.allergens.join(", ") || "없음"), "");
    if (f.warnings.length) {
      out.push("### 주의 사항", "");
      f.warnings.forEach(function (w) { out.push("- " + w); });
      out.push("");
    } else { out.push("주의 사항이 없습니다.", ""); }
    out.push("## 5. 방법론·출처·경계", "",
      "근거 등급: **측정** = 공개 데이터셋·레코드의 실측값, **유도·계산** = 공개 입력에서 정해진 방법으로 계산한 값, " +
      "**휴리스틱** = 측정 대상이 없는 규칙 기반 지표.", "",
      provTableMarkdown(PROV_TABLE_ROWS.map(function (x) { return x[0]; })), "");
    if (boundary("science")) out.push("> **과학적 경계** — " + boundary("science"), "");
    if (boundary("safety")) out.push("> **안전 경계** — " + boundary("safety"), "");
    if (boundary("model")) out.push("> **모델 경계** — " + boundary("model"), "");
    out.push("### 참고문헌", "", provRefsMarkdown(), "");
    out.push("## 6. 재현", "", "```bash",
      "python -m olfactra_core formulate --product " + f.pt.id + " --volume " + fmt(f.vol) +
      " --load " + fmt(f.load) + " --accord \"" +
      f.rows.map(function (r) { return r.m.id + "=" + fmt(r.share, 2); }).join(",") + "\" --out report.md",
      "```", "", "---", "",
      "경상국립대학교 환경산림과학부 산림환경자원학과 **FEI · HEL 인간환경연구실** · " +
      "`Copyright (c) 2026 FEI · HEL Lab, Gyeongsang National University` · MIT License");
    return out.join("\n") + "\n";
  }

  function compareMarkdown(cmp) {
    var pa = cmp.a.profile, pb = cmp.b.profile, d = cmp.deltas;
    var out = [];
    out.push("# OLFACTRA — 배합 비교 보고서", "",
      "- 버전: **" + D.meta.version + "** · schema 0.2.0 · MIT",
      "- A: **" + cmp.a.label + "** — " + cmp.a.formula.pt.name_ko + " " + fmt(cmp.a.formula.vol) + " mL, 부향률 " + fmt(cmp.a.formula.load) + "%",
      "- B: **" + cmp.b.label + "** — " + cmp.b.formula.pt.name_ko + " " + fmt(cmp.b.formula.vol) + " mL, 부향률 " + fmt(cmp.b.formula.load) + "%",
      "", "## 1. 요약", "");
    cmp.summary.forEach(function (line) { out.push("- " + line); });
    out.push("", "## 2. 노트 피라미드", "", "| 노트 | A (%) | B (%) | 차이 (%p) |", "| --- | ---: | ---: | ---: |");
    NOTES.forEach(function (n) {
      out.push("| " + n.label + " | " + fmt(pa.note_share_pct[n.id], 1) + " | " + fmt(pb.note_share_pct[n.id], 1) +
        " | " + (pb.note_share_pct[n.id] - pa.note_share_pct[n.id] > 0 ? "+" : "") +
        fmt(pb.note_share_pct[n.id] - pa.note_share_pct[n.id], 1) + " |");
    });
    out.push("", "## 3. 물성 프로파일 (질량 가중 평균)", "",
      "| 지표 | A | B | 차이 | 근거 등급 |", "| --- | ---: | ---: | ---: | --- |",
      "| 평균 분자량 (g/mol) | " + fmt(pa.mean_mw, 2) + " | " + fmt(pb.mean_mw, 2) + " | " + fmt(d.mean_mw, 2) + " | 측정(PubChem) |",
      "| 평균 LogP | " + fmt(pa.mean_logp, 2) + " | " + fmt(pb.mean_logp, 2) + " | " + fmt(d.mean_logp, 2) + " | 유도(Crippen) |",
      "| 평균 TPSA (Å²) | " + fmt(pa.mean_tpsa, 1) + " | " + fmt(pb.mean_tpsa, 1) + " | " + fmt(d.mean_tpsa, 1) + " | 유도(Ertl) |",
      "| 완성품 부향률 (% w/w) | " + fmt(pa.finished_load_pct_ww, 2) + " | " + fmt(pb.finished_load_pct_ww, 2) + " | " +
      fmt(d.finished_load_pct_ww, 2) + " | 유도(계량) |",
      "", "## 4. 안전 여유분", "", "| 항목 | A | B | 차이 |", "| --- | ---: | ---: | ---: |",
      "| 판정 | " + statusKo(pa.status) + " | " + statusKo(pb.status) + " | |",
      "| 최대 상한 사용률 | " + Math.round(pa.max_cap_ratio * 100) + "% | " + Math.round(pb.max_cap_ratio * 100) + "% | " +
      fmt(d.max_cap_ratio * 100, 0) + "%p |",
      "| 남은 여유분 | " + fmt(pa.headroom_pct, 1) + "% | " + fmt(pb.headroom_pct, 1) + "% | " + fmt(d.headroom_pct, 1) + "%p |",
      "| 초과 원료 | " + (pa.over.join(", ") || "—") + " | " + (pb.over.join(", ") || "—") + " | |",
      "| 주의 원료 | " + (pa.caution.join(", ") || "—") + " | " + (pb.caution.join(", ") || "—") + " | |",
      "| 표시 대상 알레르겐 | " + (pa.allergens.join(", ") || "—") + " | " + (pb.allergens.join(", ") || "—") + " | |",
      "", "## 5. 방법론·출처·경계", "",
      "이 보고서의 수치는 다음 지표들로 만들어졌습니다. 근거 등급이 '휴리스틱'인 값은 측정값이 아니라 순위·비교를 돕는 규칙입니다.", "",
      provTableMarkdown(["pubchem_record", "logp_crippen", "tpsa_ertl", "dilution_arithmetic",
        "safety_gate", "note_pyramid", "blend_harmony", "volatility_index"]), "");
    if (boundary("science")) out.push("> **과학적 경계** — " + boundary("science"), "");
    if (boundary("safety")) out.push("> **안전 경계** — " + boundary("safety"), "");
    out.push("### 참고문헌", "", provRefsMarkdown(), "", "---", "",
      "경상국립대학교 환경산림과학부 산림환경자원학과 **FEI · HEL 인간환경연구실** · MIT License");
    return out.join("\n") + "\n";
  }

  function copyRecipe(f) {
    var text = "OLFACTRA 레시피 — " + f.pt.name_ko + " " + fmt(f.vol) + " mL · 부향률 " + fmt(f.load) + "%\n" +
      f.rows.map(function (r) {
        return "  " + r.m.name_ko + " (" + r.m.name + ") " + fmt(r.share) + "%  " + fmt(r.neatMass, 3) + " g";
      }).join("\n") +
      "\n캐리어: " + f.carriers.map(function (c) { return c.c.name + " " + fmt(c.vol, 1) + " mL"; }).join(", ") +
      "\n판정: " + f.status + " · 완성품 " + fmt(f.finishedLoad, 2) + "% w/w\n— OLFACTRA · FEI · HEL Lab (MIT)";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      download("olfactra-recipe.txt", text);
    }
  }

  function renderCompareControls() {
    var accSel = byId("compare-accord");
    var prodSel = byId("compare-product");
    if (!accSel || !prodSel) return;
    accSel.innerHTML = D.accords.map(function (a) {
      return '<option value="' + esc(a.id) + '">' + esc(a.name_ko) + " · " + esc(a.name_en) + "</option>";
    }).join("");
    prodSel.innerHTML = D.products.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name_ko) + "</option>";
    }).join("");
    if (!ACCORD[state.compare.accord]) {
      state.compare.accord = (D.accords[1] || D.accords[0]).id;
    }
    var acc = ACCORD[state.compare.accord];
    state.compare.product = state.compare.product && PRODUCT[state.compare.product]
      ? state.compare.product : acc.product_hint;
    accSel.value = state.compare.accord;
    prodSel.value = state.compare.product;

    var volEl = byId("compare-volume");
    volEl.value = state.compare.volume;
    byId("compare-volume-out").textContent = fmt(state.compare.volume);
    var pt = PRODUCT[state.compare.product];
    var load = (state.compare.load == null) ? pt.load_default : state.compare.load;
    var loadEl = byId("compare-load");
    loadEl.value = load;
    byId("compare-load-out").textContent = fmt(load);

    on(accSel, "change", function (e) {
      state.compare.accord = e.target.value;
      var a = ACCORD[state.compare.accord];
      state.compare.product = a.product_hint;
      state.compare.load = null;
      renderCompareControls();
      renderCompare();
    });
    on(prodSel, "change", function (e) {
      state.compare.product = e.target.value;
      state.compare.load = null;
      renderCompareControls();
      renderCompare();
    });
    on(volEl, "input", function (e) {
      state.compare.volume = Number(e.target.value);
      byId("compare-volume-out").textContent = fmt(state.compare.volume);
      renderCompare();
    });
    on(loadEl, "input", function (e) {
      state.compare.load = Number(e.target.value);
      byId("compare-load-out").textContent = fmt(state.compare.load);
      renderCompare();
    });
  }

  function renderStudio() {
    var pt = PRODUCT[state.studio.product];
    byId("studio-product").value = state.studio.product;
    byId("studio-product-note").textContent = pt.description + " (권장 " + fmt(pt.load_min) + "–" + fmt(pt.load_max) + "%, " +
      (pt.exposure === "skin" ? "피부 도포" : "공간 확산 ×" + fmt(pt.cap_scale)) + ")";
    var vol = byId("studio-volume");
    vol.value = state.studio.volume;
    byId("studio-volume-out").textContent = fmt(state.studio.volume);
    var loadEl = byId("studio-load");
    var load = (state.studio.load == null) ? pt.load_default : state.studio.load;
    loadEl.value = load;
    byId("studio-load-out").textContent = fmt(load);
    renderStudioItems();
    renderStudioAddOptions();
    renderStudioResults();
  }

  /* =========================================================== COMPARE (v0.2) */
  function compareFormulaB() {
    var s = state.compare;
    var acc = ACCORD[s.accord] || D.accords[1] || D.accords[0];
    var product = s.product || acc.product_hint;
    return {
      accord: acc,
      formula: buildFormula(product, s.volume, s.load, accordItems(acc))
    };
  }

  function renderCompare() {
    var tbody = $("#compare-table tbody");
    if (!tbody) return;
    var a = formulate();
    if (!a) {
      tbody.innerHTML = '<tr><td colspan="5" class="placeholder">배합 A를 먼저 만들어 주세요.</td></tr>';
      byId("compare-summary").innerHTML = "";
      byId("compare-notes").innerHTML = "";
      state.compare.last = null;
      return;
    }
    var bSide = compareFormulaB();
    var b = bSide.formula;
    if (!b) { tbody.innerHTML = '<tr><td colspan="5" class="placeholder">비교 배합 B를 만들 수 없습니다.</td></tr>'; return; }
    var labelA = "A · " + (state.studio.source || a.pt.name_ko);
    var labelB = "B · " + bSide.accord.name_ko;
    var cmp = compareFormulas(a, b, labelA, labelB);
    state.compare.last = cmp;

    tbody.innerHTML = compareTableHtml(cmp);
    byId("compare-summary").innerHTML = cmp.summary.map(function (line) {
      return '<p class="cmp-line">' + esc(line) + "</p>";
    }).join("");
    byId("compare-notes").innerHTML =
      '<div class="cmp-head">' + esc(labelA) + " · " + esc(a.pt.name_ko) + " " + fmt(a.vol) + " mL, 부향률 " + fmt(a.load) + "%</div>" +
      notePyramidHtml(a.balance) +
      '<div class="cmp-head">' + esc(labelB) + " · " + esc(b.pt.name_ko) + " " + fmt(b.vol) + " mL, 부향률 " + fmt(b.load) + "%</div>" +
      notePyramidHtml(b.balance);
    var bd = byId("compare-boundary");
    if (bd) {
      bd.innerHTML = "물성 평균은 향 농축액의 질량 가중 평균입니다. LogP·TPSA는 구조에서 계산한 추정치이고, " +
        "노트 비중·안전 여유분은 각 지표의 경계를 그대로 물려받습니다 — <b>METHOD</b> 탭에서 근거 등급과 출처를 확인하세요.";
    }
  }

  function downloadCompare(kind) {
    var cmp = state.compare.last;
    if (!cmp) return;
    var base = "olfactra-compare-" + cmp.a.formula.pt.id + "-vs-" + cmp.b.formula.pt.id;
    if (kind === "md") {
      download(base + ".md", compareMarkdown(cmp), "text/markdown;charset=utf-8");
    } else {
      download(base + ".json", JSON.stringify({
        schema_version: "0.2.0",
        labels: { a: cmp.a.label, b: cmp.b.label },
        a: { product_type: cmp.a.formula.pt.id, volume_ml: cmp.a.formula.vol, load_pct: cmp.a.formula.load,
             status: cmp.a.formula.status, profile: cmp.a.profile },
        b: { product_type: cmp.b.formula.pt.id, volume_ml: cmp.b.formula.vol, load_pct: cmp.b.formula.load,
             status: cmp.b.formula.status, profile: cmp.b.profile },
        deltas: cmp.deltas, summary: cmp.summary
      }, null, 2), "application/json");
    }
  }

  /* ============================================================ METHOD (v0.2) */
  function kindChip(kind) {
    var labels = { measured: "측정", derived: "유도·계산", heuristic: "휴리스틱" };
    return '<span class="kind-chip ' + esc(kind) + '">' + esc(labels[kind] || kind) + "</span>";
  }

  function renderMethod() {
    var prov = D.provenance;
    if (!prov) return;
    var host = byId("method-kinds");
    if (host) {
      host.innerHTML = prov.kinds.map(function (k) {
        return '<div class="kind-card ' + esc(k.id) + '">' + kindChip(k.id) +
          '<b>' + esc(String(prov.counts[k.id] || 0)) + "개 지표</b>" +
          '<p>' + esc(k.description_ko) + "</p></div>";
      }).join("");
    }
    var list = byId("method-list");
    if (list) {
      list.innerHTML = prov.indicators.map(function (ind, i) {
        var refs = (ind.references || []).map(function (r) {
          return r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener">' + esc(r.label) + "</a>" : esc(r.label);
        }).join(" · ");
        return '<details class="method-item ' + esc(ind.kind) + '"' + (i < 2 ? " open" : "") + ">" +
          "<summary>" + kindChip(ind.kind) + "<b>" + esc(ind.label_ko) + "</b>" +
          '<span class="mi-en">' + esc(ind.label_en) + "</span>" +
          '<span class="mi-unit mono">' + esc(ind.unit) + "</span></summary>" +
          '<div class="mi-body">' +
          '<p class="mi-formula mono">' + esc(ind.formula) + "</p>" +
          '<p><span class="mi-k">근거</span>' + esc(ind.basis_ko) + "</p>" +
          '<p class="mi-boundary"><span class="mi-k">경계</span>' + esc(ind.boundary_ko) + "</p>" +
          (ind.inputs && ind.inputs.length ? '<p class="mi-used"><span class="mi-k">입력</span>' + esc(ind.inputs.join(" · ")) + "</p>" : "") +
          (ind.used_in && ind.used_in.length ? '<p class="mi-used"><span class="mi-k">쓰이는 곳</span>' + esc(ind.used_in.join(" · ")) + "</p>" : "") +
          (refs ? '<p class="mi-refs"><span class="mi-k">참고</span>' + refs + "</p>" : "") +
          "</div></details>";
      }).join("");
    }
    var bounds = byId("method-boundaries");
    if (bounds) {
      var names = [["science", "과학"], ["safety", "안전"], ["model", "모델"], ["clean_room", "클린룸"]];
      bounds.innerHTML = names.filter(function (n) { return prov.boundaries[n[0]]; }).map(function (n) {
        return '<div class="bound-item"><b>' + esc(n[1]) + " 경계</b><p>" + esc(prov.boundaries[n[0]]) + "</p></div>";
      }).join("");
    }
    var refsHost = byId("method-refs");
    if (refsHost) {
      refsHost.innerHTML = (prov.references || []).map(function (r) {
        return '<div class="ref-item"><b>' + esc(r.label) + "</b><p>" + esc(r.detail) + "</p>" +
          (r.link ? '<a href="' + esc(r.link) + '" target="_blank" rel="noopener" class="mono">' + esc(r.link) + "</a>" : "") + "</div>";
      }).join("");
    }
  }

  /* ============================================================= ATLAS tab */
  function renderAtlasCats() {
    var host = byId("atlas-cats");
    host.innerHTML = '<button type="button" class="chip' + (state.atlas.cat ? "" : " is-on") +
      '" data-cat="">전체</button>' + D.meta.categories.map(function (c) {
        return '<button type="button" class="chip' + (state.atlas.cat === c.id ? " is-on" : "") +
          '" data-cat="' + esc(c.id) + '">' + esc(c.label) + "</button>";
      }).join("");
    $$("#atlas-cats .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        state.atlas.cat = b.getAttribute("data-cat") || null;
        renderAtlasCats(); renderAtlasGrid(); renderAtlasTimeline();
      });
    });
  }

  function atlasFiltered() {
    var qy = state.atlas.q.trim().toLowerCase();
    return D.atlas.filter(function (e) {
      if (state.atlas.cat && e.category !== state.atlas.cat) return false;
      if (!qy) return true;
      var hay = [e.name_ko, e.name_en, e.botanical, e.region, e.material_part, e.story, e.science,
        e.use_ko, e.category_label].concat(e.molecules.map(function (id) { return MOL[id] ? MOL[id].name_ko + " " + MOL[id].name : id; }))
        .join(" ").toLowerCase();
      return hay.indexOf(qy) >= 0;
    });
  }

  function yearLabel(y) {
    return y < 0 ? "기원전 " + Math.abs(y) : (y >= 1000 ? String(y) : "기원후 " + y);
  }

  function renderAtlasTimeline() {
    var host = byId("atlas-timeline");
    var list = atlasFiltered();
    var max = Math.max.apply(null, list.map(function (e) { return e.year; }).concat([1]));
    host.innerHTML = list.map(function (e) {
      var left = clamp((e.year + 3000) / (max + 3000) * 100, 0, 100);
      return '<button type="button" class="tl-item' + (state.atlas.selected === e.id ? " is-on" : "") +
        '" data-entry="' + esc(e.id) + '" title="' + esc(e.name_ko + " · " + e.era_label) + '">' +
        '<span class="tl-year">' + esc(yearLabel(e.year)) + '</span><i class="tl-dot"></i>' +
        '<span class="tl-name">' + esc(e.name_ko.split(" · ")[0]) + "</span></button>";
    }).join("") || '<p class="placeholder">해당 조건의 항목이 없습니다.</p>';
    $$("#atlas-timeline [data-entry]").forEach(function (b) {
      b.addEventListener("click", function () { openEntry(b.getAttribute("data-entry")); });
    });
  }

  function renderAtlasGrid() {
    var host = byId("atlas-grid");
    var list = atlasFiltered();
    host.innerHTML = list.map(function (e) {
      var mols = e.molecules.slice(0, 3).map(function (id) { return MOL[id] ? MOL[id].name_ko : id; }).join(" · ");
      return '<button type="button" class="atlas-card' + (state.atlas.selected === e.id ? " is-on" : "") +
        '" data-entry="' + esc(e.id) + '"><span class="ac-top"><span class="ac-cat">' + esc(e.category_label) +
        '</span><span>' + esc(yearLabel(e.year)) + "</span></span><b>" + esc(e.name_ko) + "</b>" +
        (e.botanical && e.botanical !== "—" ? "<em>" + esc(e.botanical) + "</em>" : "") +
        '<span class="ac-region">' + esc(e.region) + "</span>" +
        '<span class="ac-mol">' + esc(mols) + "</span></button>";
    }).join("") || '<p class="placeholder">검색 결과가 없습니다.</p>';
    $$("#atlas-grid [data-entry]").forEach(function (b) {
      b.addEventListener("click", function () { openEntry(b.getAttribute("data-entry")); });
    });
  }

  function scrollToDetail() {
    var el = byId("atlas-detail");
    if (el && !el.hidden) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openEntry(id) {
    state.atlas.selected = id;
    var e = D.atlas.filter(function (x) { return x.id === id; })[0];
    var host = byId("atlas-detail");
    if (!e) { host.hidden = true; return; }
    var mols = e.molecules.map(function (mid) {
      var m = MOL[mid];
      return '<button type="button" class="mol-chip" data-mol="' + esc(mid) + '">' +
        esc(m ? m.name_ko : mid) + " · " + esc(m ? m.formula : "") + "</button>";
    }).join("");
    host.hidden = false;
    host.innerHTML = '<div class="ad-head"><div><h3>' + esc(e.name_ko) + '</h3><p class="bot">' + esc(e.botanical) +
      '</p></div><div><p class="mono" style="color:var(--muted)">' + esc(e.name_en) + "</p></div></div>" +
      '<div class="ad-meta"><span>' + esc(e.category_label) + "</span><span>" + esc(e.era_label) +
      "</span><span>" + esc(e.region) + "</span><span>" + esc(e.material_part) + "</span></div>" +
      '<div class="ad-section"><h4>이야기</h4><p>' + esc(e.story) + "</p></div>" +
      '<div class="ad-section"><h4>과학</h4><p>' + esc(e.science) + "</p></div>" +
      '<div class="ad-section"><h4>향 분자</h4><div class="ad-mols">' + mols + "</div>" +
      '<p class="tiny-note">분자를 누르면 MOLECULE 탭에서 구조와 유사 분자를 볼 수 있습니다.</p></div>' +
      '<div class="ad-section"><h4>쓰임</h4><p>' + esc(e.use_ko) + "</p></div>" +
      '<div class="ad-section"><h4>근거 문헌</h4><ul>' + e.sources.map(function (s) {
        return "<li><b>" + esc(s.label) + "</b> — " + esc(s.detail) + "</li>";
      }).join("") + "</ul></div>" +
      (e.caution ? '<div class="ad-caution"><b>주의</b> · ' + esc(e.caution) + "</div>" : "") +
      (e.conservation ? '<div class="ad-cons"><b>보전</b> · ' + esc(e.conservation) + "</div>" : "") +
      '<div class="row"><button type="button" class="btn small" id="ad-close">닫기</button></div>';
    $$("#atlas-detail [data-mol]").forEach(function (b) {
      b.addEventListener("click", function () { selectMolecule(b.getAttribute("data-mol")); });
    });
    on(byId("ad-close"), "click", function () { host.hidden = true; state.atlas.selected = null; renderAtlasGrid(); renderAtlasTimeline(); });
    renderAtlasGrid(); renderAtlasTimeline();
    scrollToDetail();
  }

  /* ========================================================== MOLECULE tab */
  function selectMolecule(id) {
    state.mol.selected = id;
    state.mol.cell = null;
    setTab("molecule");
    renderMoleculeDetail();
    drawMoleculeViews();
  }

  function renderMoleculeDetail() {
    var host = byId("mol-detail");
    var m = MOL[state.mol.selected];
    if (!m) { host.innerHTML = '<p class="placeholder">지도에서 분자를 선택하세요.</p>'; return; }
    var fam = Object.keys(m.families).sort(function (a, b) { return m.families[b] - m.families[a]; });
    var sims = MOL_LIST.filter(function (x) { return x.id !== m.id; }).map(function (x) {
      return { m: x, s: similarity(m, x), b: blendScore(m, x) };
    }).sort(function (a, b) { return b.s - a.s; }).slice(0, 5);
    var blends = MOL_LIST.filter(function (x) { return x.id !== m.id; }).map(function (x) {
      return { m: x, b: blendScore(m, x) };
    }).sort(function (a, b) { return b.b - a.b; }).slice(0, 4);
    var atlasLinks = D.atlas.filter(function (e) { return e.molecules.indexOf(m.id) >= 0; });

    host.innerHTML = '<div class="mol-head"><div class="mol-svg">' + (m.svg || "") + "</div><div>" +
      "<h3>" + esc(m.name) + '</h3><p class="ko">' + esc(m.name_ko) + " · " + esc(NOTE_LABEL[m.note]) +
      " 노트</p><p class=\"mol-id\">" + esc(m.smiles) + "</p></div></div>" +
      '<div class="fam-bars">' + fam.map(function (f) {
        return '<div class="fam-row"><span>' + esc(FAM_LABEL[f]) + '</span><div class="bar"><i style="width:' +
          (m.families[f] * 100).toFixed(0) + '%"></i></div><em>' + m.families[f].toFixed(2) + "</em></div>";
      }).join("") + "</div>" +
      '<dl class="kv">' +
      "<dt>분자식</dt><dd class=\"mono\">" + esc(m.formula) + "</dd>" +
      "<dt>분자량</dt><dd class=\"mono\">" + fmt(m.molecular_weight) + " g/mol</dd>" +
      "<dt>CAS</dt><dd class=\"mono\">" + esc(m.cas || "—") + "</dd>" +
      "<dt>작용기</dt><dd>" + esc(m.functional_group) + "</dd>" +
      "<dt>휘발성</dt><dd class=\"mono\">" + m.volatility.toFixed(2) + " (1=가장 빠름)</dd>" +
      "<dt>밀도</dt><dd class=\"mono\">" + fmt(m.density_g_ml, 2) + " g/mL · " + (m.state === "liquid" ? "액체" : "고체") + "</dd>" +
      "<dt>향</dt><dd>" + esc(m.descriptor_ko) + "<br><span style=\"color:var(--muted)\">" + esc(m.descriptor_en) + "</span></dd>" +
      "<dt>급원</dt><dd>" + esc(m.natural_sources.join(", ")) + "</dd>" +
      "<dt>실무 상한</dt><dd>" + fmt(m.working_cap_pct) + "% <span style=\"color:var(--muted)\">— " + esc(m.cap_basis) + "</span></dd>" +
      "<dt>PubChem</dt><dd><a href=\"https://pubchem.ncbi.nlm.nih.gov/compound/" + m.pubchem_cid +
      "\" target=\"_blank\" rel=\"noopener\">CID " + m.pubchem_cid + "</a></dd>" +
      "</dl>" +
      moleculePyrfumeHtml(m) +
      '<div class="ad-section"><h4>유사 향조</h4><ul class="similar">' + sims.map(function (s) {
        return "<li><span class=\"sc\">" + s.s.toFixed(2) + '</span><button type="button" data-sim="' + esc(s.m.id) +
          '">' + esc(s.m.name_ko) + "</button><span class=\"mono\" style=\"color:var(--muted)\">" + esc(NOTE_LABEL[s.m.note]) + "</span></li>";
      }).join("") + "</ul></div>" +
      '<div class="ad-section"><h4>블렌딩 조화 상위</h4><ul class="similar">' + blends.map(function (s) {
        return "<li><span class=\"sc\">" + s.b.toFixed(2) + '</span><button type="button" data-sim="' + esc(s.m.id) +
          '">' + esc(s.m.name_ko) + "</button><span class=\"mono\" style=\"color:var(--muted)\">" + esc(NOTE_LABEL[s.m.note]) + "</span></li>";
      }).join("") + "</ul><p class=\"tiny-note\">조화 점수는 향조 겹침·노트 거리·보완 관계의 합성 지표입니다. 실제 혼합의 냄새를 보장하지 않습니다.</p></div>" +
      (atlasLinks.length ? '<div class="ad-section"><h4>관련 아카이브</h4><div class="ad-mols">' + atlasLinks.map(function (e) {
        return '<button type="button" class="mol-chip" data-entry="' + esc(e.id) + '">' + esc(e.name_ko) + "</button>";
      }).join("") + "</div></div>" : "") +
      '<div class="row tight"><button type="button" class="btn small" id="mol-add-studio">STUDIO에 추가</button></div>';

    $$("#mol-detail [data-sim]").forEach(function (b) {
      b.addEventListener("click", function () { state.mol.selected = b.getAttribute("data-sim"); renderMoleculeDetail(); drawMoleculeViews(); });
    });
    $$("#mol-detail [data-entry]").forEach(function (b) {
      b.addEventListener("click", function () { setTab("atlas"); openEntry(b.getAttribute("data-entry")); });
    });
    on(byId("mol-add-studio"), "click", function () {
      if (!state.studio.items.some(function (i) { return i.id === m.id; })) {
        state.studio.items.push({ id: m.id, share: 10 });
        state.studio.source = state.studio.source ? state.studio.source + " (편집)" : "직접 배합";
      }
      saveStudio(); renderStudio(); setTab("studio");
    });

    if (window.OLFACTRA3D) window.OLFACTRA3D.select(m.id);
  }

  /* --------------------------------------------------------- canvas: map */
  var mapHit = [];
  function setupCanvas(canvas, cssHeight) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || canvas.clientWidth || 640;
    var h = cssHeight || rect.height || canvas.clientHeight || 360;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function drawMap() {
    var canvas = byId("mol-map");
    if (!canvas || canvas.offsetParent === null) return;
    var cssH = window.innerWidth < 700 ? 320 : 420;
    var s = setupCanvas(canvas, cssH);
    var ctx = s.ctx, W = s.w, H = s.h;
    var pad = { l: 52, r: 16, t: 26, b: 38 };
    var minW = 96, maxW = 260;
    var x = function (mw) { return pad.l + (clamp(mw, minW, maxW) - minW) / (maxW - minW) * (W - pad.l - pad.r); };
    var y = function (v) { return pad.t + (1 - clamp(v, 0, 1)) * (H - pad.t - pad.b); };

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#FAF9F5";
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = "#E4E1D8";
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "#6B6A64";
    ctx.textAlign = "right";
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      var yy = y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
      ctx.fillText(v.toFixed(2), pad.l - 8, yy + 3);
    });
    ctx.textAlign = "left";
    [100, 136, 170, 204, 238].forEach(function (mw) {
      if (mw > maxW) return;
      var xx = x(mw);
      ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, H - pad.b); ctx.stroke();
      ctx.fillText(String(mw), xx - 8, H - pad.b + 14);
    });
    // note bands
    var bands = [["base", 0, 0.34, "#EEF2EC"], ["middle", 0.34, 0.68, "#FBF0EA"], ["top", 0.68, 1, "#FBF6E7"]];
    bands.forEach(function (b) {
      ctx.fillStyle = b[3];
      ctx.globalAlpha = 0.5;
      ctx.fillRect(pad.l, y(b[2]), W - pad.l - pad.r, y(b[1]) - y(b[2]));
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#9A968B";
      ctx.fillText(NOTE_LABEL[b[0]], W - pad.r - 26, y(b[2]) + 12);
    });

    ctx.fillStyle = "#6B6A64";
    ctx.textAlign = "center";
    ctx.fillText("분자량 (g/mol) →", pad.l + (W - pad.l - pad.r) / 2, H - 6);
    ctx.textAlign = "left";
    ctx.fillStyle = "#6B6A64";
    ctx.fillText("↑ 휘발성 (1 = 빠름)", 6, 13);

    mapHit = [];
    var sel = state.mol.selected;
    MOL_LIST.forEach(function (m) {
      var dim = state.mol.family && !(m.families[state.mol.family] >= 0.2);
      var cx = x(m.molecular_weight), cy = y(m.volatility);
      var r = 5 + (m.molecular_weight - 100) / 160 * 7;
      var color = FAM_COLOR[Object.keys(m.families).sort(function (a, b) { return m.families[b] - m.families[a]; })[0]] || "#7A6248";
      ctx.globalAlpha = dim ? 0.16 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (m.id === sel) {
        ctx.strokeStyle = "#141413"; ctx.lineWidth = 2; ctx.stroke();
      } else {
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      mapHit.push({ id: m.id, x: cx, y: cy, r: r + 3, m: m });
    });

    if (sel && MOL[sel]) {
      var mm = MOL[sel];
      var sx = x(mm.molecular_weight), sy = y(mm.volatility);
      ctx.font = "600 11px 'Noto Sans KR', sans-serif";
      var label = mm.name_ko;
      var tw = ctx.measureText(label).width;
      var bx = clamp(sx + 10, pad.l, W - tw - 18);
      var byy = clamp(sy - 8, 14, H - pad.b - 4);
      ctx.fillStyle = "rgba(20,20,19,.92)";
      ctx.fillRect(bx - 5, byy - 12, tw + 10, 17);
      ctx.fillStyle = "#FAF9F5";
      ctx.fillText(label, bx, byy);
    }
  }

  function bindMap() {
    var canvas = byId("mol-map");
    if (!canvas) return;
    var tip = null;
    function nearest(ev) {
      var rect = canvas.getBoundingClientRect();
      var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      var best = null, bd = 1e9;
      mapHit.forEach(function (h) {
        var d = Math.hypot(h.x - px, h.y - py);
        if (d < h.r && d < bd) { bd = d; best = h; }
      });
      return best;
    }
    canvas.addEventListener("click", function (ev) {
      var hit = nearest(ev);
      if (hit) { state.mol.selected = hit.id; renderMoleculeDetail(); drawMap(); }
    });
    canvas.addEventListener("mousemove", function (ev) {
      var hit = nearest(ev);
      canvas.style.cursor = hit ? "pointer" : "crosshair";
      canvas.title = hit ? (hit.m.name_ko + " · " + hit.m.name + " · " + hit.m.formula + " · " + hit.m.descriptor_ko) : "";
    });
  }

  /* ------------------------------------------------------ canvas: matrix */
  var matrixHit = [];
  function drawMatrix() {
    var canvas = byId("mol-matrix");
    if (!canvas || canvas.offsetParent === null) return;
    var cssH = window.innerWidth < 700 ? 380 : 340;
    var s = setupCanvas(canvas, cssH);
    var ctx = s.ctx, W = s.w, H = s.h;
    var padL = 74, padT = 26, padR = 12, padB = 14;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#FAF9F5"; ctx.fillRect(0, 0, W, H);
    var cols = NOTES.length, rows = FAMILIES.length;
    var cw = (W - padL - padR) / cols;
    var ch = (H - padT - padB) / rows;
    var counts = {};
    FAMILIES.forEach(function (f) { NOTES.forEach(function (n) { counts[f.id + "|" + n.id] = []; }); });
    MOL_LIST.forEach(function (m) {
      Object.keys(m.families).forEach(function (f) { if (m.families[f] >= 0.2) counts[f + "|" + m.note].push(m.id); });
    });
    var maxC = 1;
    Object.keys(counts).forEach(function (k) { maxC = Math.max(maxC, counts[k].length); });

    matrixHit = [];
    ctx.font = "11px 'Noto Sans KR', sans-serif";
    NOTES.forEach(function (n, j) {
      ctx.fillStyle = "#6B6A64";
      ctx.fillText(n.label, padL + j * cw + cw / 2 - 8, padT - 8);
    });
    FAMILIES.forEach(function (f, i) {
      ctx.fillStyle = "#3C3A35";
      ctx.fillText(f.label, 10, padT + i * ch + ch / 2 + 4);
      NOTES.forEach(function (n, j) {
        var ids = counts[f.id + "|" + n.id];
        var c = ids.length / maxC;
        var xx = padL + j * cw, yy = padT + i * ch;
        ctx.fillStyle = ids.length
          ? "rgba(217,119,87," + (0.10 + c * 0.72).toFixed(2) + ")"
          : "#F4F2EB";
        if (state.mol.cell && state.mol.cell === f.id + "|" + n.id) ctx.fillStyle = "#141413";
        ctx.fillRect(xx + 2, yy + 2, cw - 4, ch - 4);
        ctx.fillStyle = (c > 0.55 || (state.mol.cell === f.id + "|" + n.id)) ? "#FAF9F5" : "#3C3A35";
        if (ids.length) ctx.fillText(String(ids.length), xx + cw / 2 - 3, yy + ch / 2 + 4);
        matrixHit.push({ key: f.id + "|" + n.id, x: xx, y: yy, w: cw, h: ch, ids: ids, fam: f.id, note: n.id });
      });
    });
    ctx.fillStyle = "#9A968B";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("셀 = 해당 향조(0.2 이상) · 노트의 분자 수 (최대 " + maxC + ")", padL, H - 2);
  }

  function bindMatrix() {
    var canvas = byId("mol-matrix");
    if (!canvas) return;
    canvas.addEventListener("click", function (ev) {
      var rect = canvas.getBoundingClientRect();
      var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      var hit = matrixHit.filter(function (h) {
        return px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h;
      })[0];
      if (!hit || !hit.ids.length) return;
      state.mol.cell = (state.mol.cell === hit.key) ? null : hit.key;
      if (state.mol.cell) {
        state.mol.family = hit.fam;
        state.mol.selected = hit.ids[0];
        renderMoleculeDetail();
        renderLegend();
      }
      drawMap(); drawMatrix();
    });
  }

  function renderLegend() {
    var host = byId("mol-legend");
    host.innerHTML = FAMILIES.map(function (f) {
      return '<button type="button" class="legend-item' + (state.mol.family === f.id ? " is-on" : "") +
        '" data-fam="' + esc(f.id) + '"><i class="sq" style="background:' + FAM_COLOR[f.id] + '"></i>' +
        esc(f.label) + "</button>";
    }).join("") + '<span class="legend-item" style="cursor:default">원 크기 = 분자량</span>';
    $$("#mol-legend [data-fam]").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = b.getAttribute("data-fam");
        state.mol.family = (state.mol.family === f) ? null : f;
        renderLegend(); drawMap();
      });
    });
  }

  function drawMoleculeViews() { drawMap(); drawMatrix(); }

  /* ================================================================== init */
  function init() {
    $$("[data-version]").forEach(function (el) { el.textContent = D.meta.version; });
    $$("[data-count]").forEach(function (el) {
      var k = el.getAttribute("data-count");
      if (k === "molecules") el.textContent = D.meta.stats.molecules.molecules;
      if (k === "atlas") el.textContent = D.meta.stats.atlas.entries;
      if (k === "indicators") el.textContent = (D.provenance && D.provenance.indicators) ? D.provenance.indicators.length : 0;
    });

    if (!restoreStudio()) {
      var first = ACCORD["forest-breath"] || D.accords[0];
      state.studio.items = accordItems(first).map(function (it) { return { id: it.id, share: it.share }; });
      state.studio.product = first.product_hint;
      state.studio.source = first.name_ko;
    }

    $$(".nav-btn").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    });
    on(byId("id-run"), "click", function () {
      renderIdResults();
      var el = byId("id-results");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    on(byId("id-reset"), "click", function () {
      state.id = { mood: null, season: null, space: null, style: null };
      renderIdControls(); renderIdResults();
    });

    renderStudioProducts();
    on(byId("studio-product"), "change", function (e) {
      state.studio.product = e.target.value;
      state.studio.load = null;
      renderStudio(); saveStudio();
    });
    on(byId("studio-volume"), "input", function (e) {
      state.studio.volume = Number(e.target.value);
      byId("studio-volume-out").textContent = fmt(state.studio.volume);
      renderStudioResults(); saveStudio();
    });
    on(byId("studio-load"), "input", function (e) {
      state.studio.load = Number(e.target.value);
      byId("studio-load-out").textContent = fmt(state.studio.load);
      var pt = PRODUCT[state.studio.product];
      var sum = state.studio.items.reduce(function (s, it) { return s + Number(it.share); }, 0);
      byId("studio-load-note").textContent = "권장 " + fmt(pt.load_min) + "–" + fmt(pt.load_max) + "% · 배합 합계 " + fmt(sum) + "%";
      renderStudioResults(); saveStudio();
    });
    on(byId("studio-add"), "click", function () {
      var sel = byId("studio-add-select");
      if (!sel.value) return;
      state.studio.items.push({ id: sel.value, share: 10 });
      state.studio.source = state.studio.source ? state.studio.source + " (편집)" : "직접 배합";
      renderStudioItems(); renderStudioAddOptions(); renderStudioResults(); saveStudio();
    });
    on(byId("studio-balance"), "click", function () {
      var sum = state.studio.items.reduce(function (s, it) { return s + Number(it.share); }, 0);
      if (!sum) return;
      state.studio.items = state.studio.items.map(function (it) {
        return { id: it.id, share: Math.round(it.share / sum * 1000) / 10 };
      });
      renderStudioItems(); renderStudioResults(); saveStudio();
    });
    on(byId("studio-clear"), "click", function () {
      state.studio.items = []; state.studio.source = "";
      renderStudioItems(); renderStudioAddOptions(); renderStudioResults(); saveStudio();
    });
    on(byId("studio-md"), "click", function () {
      var f = formulate(); if (!f) return;
      download("olfactra-report-" + f.pt.id + "-" + fmt(f.vol) + "ml.md", studioMarkdown(f), "text/markdown;charset=utf-8");
    });
    on(byId("compare-md"), "click", function () { downloadCompare("md"); });
    on(byId("compare-json"), "click", function () { downloadCompare("json"); });
    on(byId("studio-csv"), "click", function () {
      var f = formulate(); if (!f) return;
      download("olfactra-recipe-" + f.pt.id + "-" + fmt(f.vol) + "ml.csv", studioCsv(f), "text/csv;charset=utf-8");
    });
    on(byId("studio-json"), "click", function () {
      var f = formulate(); if (!f) return;
      download("olfactra-recipe-" + f.pt.id + "-" + fmt(f.vol) + "ml.json", studioJson(f), "application/json");
    });
    on(byId("studio-copy"), "click", function () {
      var f = formulate(); if (f) copyRecipe(f);
    });

    on(byId("atlas-search"), "input", function (e) {
      state.atlas.q = e.target.value;
      renderAtlasGrid(); renderAtlasTimeline();
    });

    renderCompareControls();
    renderIdControls();
    renderIdResults();
    renderStudio();
    renderMethod();
    renderAtlasCats();
    renderAtlasGrid();
    renderAtlasTimeline();
    renderLegend();
    renderMoleculeDetail();
    bindMap();
    bindMatrix();

    if (window.OLFACTRA3D) {
      window.OLFACTRA3D.init();
      window.OLFACTRA3D.select(state.mol.selected);
      window.OLFACTRA3D.onSelect(function (mid) {
        state.mol.selected = mid;
        state.mol.cell = null;
        renderMoleculeDetail();
        drawMoleculeViews();
      });
    }

    var hash = (location.hash || "").replace("#", "");
    setTab(["id", "studio", "atlas", "molecule", "method"].indexOf(hash) >= 0 ? hash : "id", false);

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawMoleculeViews, 140);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
