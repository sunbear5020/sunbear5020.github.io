/* =============================================================================
   GAZERA — browser workbench
   Clean-room, MIT · FEI · HEL Lab, Gyeongsang National University
   -----------------------------------------------------------------------------
   Everything here runs locally in the browser. No network calls, no uploads.
   The analysis definitions mirror gazera_core (Python) so results agree:
     loader  → parseDelimited / autoMap / buildFrame
     cleaner → computeQuality
     ivt     → classifyIvt
     metrics → computeMetrics / aggregateMetrics
     export  → downloadCsv / downloadJson
   Synthetic demo data is generated in this file (100 % synthetic, no vendor
   sample file, no real participant data).
   ========================================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------------------------------------------------------------- utils */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v) => {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(/,/g, '');
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const fmt = (v, digits = 1) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('ko-KR');
    return Number(v).toFixed(digits);
  };
  const pct = (v, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—');
  const median = (arr) => {
    if (!arr.length) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN);
  const sd = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };
  const pctChange = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? (a - b) / b : NaN);

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ------------------------------------------------------------ app state */
  const state = {
    fileName: null,
    source: 'none', // 'demo' | 'file'
    table: null, // { columns: string[], rows: string[][] }
    meta: {},
    mapping: {},
    frame: null,
    quality: null,
    analysis: null,
    mode: 'heat',
    toast: toast,
  };
  window.GAZERA_STATE = state;

  /* ------------------------------------------------------ synthetic data */
  const BANDS = [
    { name: '상단', x: 0, y: 0, w: 1, h: 0.35 },
    { name: '중앙', x: 0, y: 0.35, w: 1, h: 0.3 },
    { name: '하단', x: 0, y: 0.65, w: 1, h: 0.35 },
  ];
  const CONDITIONS = {
    '도시숲': { weights: [0.5, 0.25, 0.25], xBias: [0.5, 0.5, 0.5], xSpread: 0.8, fixation: 265 },
    '도심 가로': { weights: [0.12, 0.3, 0.58], xBias: [0.45, 0.74, 0.5], xSpread: 0.55, fixation: 228 },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeDemo() {
    const rand = mulberry32(20260520);
    const gauss = () => {
      let u = 0, v = 0;
      while (u === 0) u = rand();
      while (v === 0) v = rand();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const pickZone = (weights) => {
      const r = rand();
      let acc = 0;
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i];
        if (r <= acc) return i;
      }
      return weights.length - 1;
    };

    const W = 1920, H = 1080, HZ = 60, DT = 1000 / HZ;
    const subjects = 8;
    const durationS = 8;
    const columns = [
      'Recording timestamp', 'Gaze point X', 'Gaze point Y',
      'Pupil diameter left', 'Pupil diameter right',
      'Validity left', 'Validity right',
      'Participant name', 'Recording name', 'Presented stimulus name',
      'Media width', 'Media height', 'Eye movement type',
    ];
    const rows = [];
    let fixationCount = 0;
    let saccadeCount = 0;

    Object.keys(CONDITIONS).forEach((condition) => {
      const spec = CONDITIONS[condition];
      for (let s = 0; s < subjects; s++) {
        const subject = `P${String(s + 1).padStart(2, '0')}`;
        const recording = `${condition}_${subject}`;
        let t = 0;
        let prevX = null, prevY = null, prevZone = -1;
        let pupil = 3.2 + gauss() * 0.05;

        const push = (x, y, event, pupilValue) => {
          const invalid = rand() < 0.02;
          const v = invalid ? 4 : 0;
          rows.push([
            Math.round(t * 1000),
            invalid ? '' : x.toFixed(2),
            invalid ? '' : y.toFixed(2),
            invalid ? '' : (pupilValue + 0.01).toFixed(4),
            invalid ? '' : (pupilValue - 0.01).toFixed(4),
            String(v), String(v),
            subject, recording, condition, String(W), String(H),
            invalid ? 'Eyes not found' : event,
          ]);
          t += DT;
        };

        while (t < durationS * 1000) {
          const zi = pickZone(spec.weights);
          const band = BANDS[zi];
          const drawDur = zi === prevZone
            ? clamp(Math.exp(Math.log(spec.fixation * 0.7) + gauss() * 0.3), 110, 800)
            : clamp(Math.exp(Math.log(spec.fixation) + gauss() * 0.3), 140, 900);
          prevZone = zi;
          const tx = clamp(spec.xBias[zi] + gauss() * (spec.xSpread / 4), band.x + 0.05, band.x + band.w - 0.05) * W;
          const ty = (band.y + 0.02 + rand() * (band.h - 0.04)) * H;

          if (prevX !== null) {
            const sacDur = clamp(42 + gauss() * 9, 18, 90);
            const steps = Math.max(1, Math.round(sacDur / DT));
            for (let k = 1; k <= steps; k++) {
              const frac = k / (steps + 1);
              const ease = 0.5 - 0.5 * Math.cos(Math.PI * frac);
              push(prevX + (tx - prevX) * ease, prevY + (ty - prevY) * ease, 'Saccade', pupil);
            }
            saccadeCount++;
          }

          const frames = Math.max(1, Math.round(drawDur / DT));
          let driftX = 0, driftY = 0;
          for (let k = 0; k < frames; k++) {
            driftX = 0.92 * driftX + gauss() * 7 * 0.35;
            driftY = 0.92 * driftY + gauss() * 7 * 0.35;
            pupil = clamp(pupil + gauss() * 0.004, 2.1, 4.9);
            push(tx + driftX + gauss() * 1.8, ty + driftY + gauss() * 1.8, 'Fixation', pupil);
          }
          fixationCount++;
          prevX = tx;
          prevY = ty;
        }
      }
    });

    return {
      columns,
      rows,
      meta: {
        delimiter: 'tab',
        encoding: 'utf-8 (generated)',
        synthetic: true,
        groundTruth: {
          fixations: fixationCount,
          saccades: saccadeCount,
          subjects,
          conditions: Object.keys(CONDITIONS),
          durationS,
          hz: HZ,
        },
      },
    };
  }

  /* -------------------------------------------------------------- parsing */
  function countDelim(line, delim) {
    return line.split(delim).length - 1;
  }

  function sniffDelimiter(lines) {
    const sample = lines.slice(0, 200).filter((l) => l.trim());
    let best = ',';
    let bestScore = -1;
    for (const delim of [',', '\t', ';', '|']) {
      const counts = sample.slice(0, 40).map((l) => countDelim(l, delim));
      const max = Math.max(...counts);
      if (!max) continue;
      const consistent = counts.filter((c) => c === max).length;
      let score = max * 2 + consistent * 3;
      if (consistent < Math.max(2, Math.floor(counts.length / 5))) score *= 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = delim;
      }
    }
    return best;
  }

  function findHeaderIndex(lines, delim) {
    let best = 0;
    let bestScore = -1;
    const limit = Math.min(lines.length, 120);
    for (let i = 0; i < limit; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const fields = countDelim(line, delim) + 1;
      if (fields < 2) continue;
      let consistent = 0;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (lines[j] && lines[j].trim()) {
          if (countDelim(lines[j], delim) + 1 === fields) consistent++;
        }
      }
      const keyword = /(timestamp|gaze|pupil|validity|participant|recording|aoi|time)/i.test(line) ? 1 : 0;
      const score = fields + consistent * 4 + keyword * 6;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  function parseDelimited(text, delim, headerIdx) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"') {
        quoted = true;
      } else if (c === delim) {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    const header = rows[headerIdx] || [];
    const columns = header.map((c) => c.replace(/^\uFEFF/, '').trim());
    const body = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every((v) => !String(v).trim())) continue;
      body.push(r);
    }
    return { columns, rows: body };
  }

  function decodeBuffer(buffer) {
    let text = new TextDecoder('utf-8').decode(buffer);
    const bad = (text.match(/\uFFFD/g) || []).length;
    let encoding = 'utf-8';
    if (bad > Math.max(3, text.length * 0.002)) {
      try {
        const alt = new TextDecoder('euc-kr').decode(buffer);
        if ((alt.match(/\uFFFD/g) || []).length < bad) {
          text = alt;
          encoding = 'euc-kr';
        }
      } catch (e) {
        /* TextDecoder may not support euc-kr in some browsers */
      }
    }
    return { text, encoding };
  }

  /* -------------------------------------------------------------- mapping */
  const FIELDS = [
    {
      key: 'timestamp',
      label: '시각',
      patterns: [/^recording timestamp( \[(ms|us|µs|s)\])?$/, /^timestamp( \[(ms|us|µs|s)\])?$/, /^device timestamp.*$/, /^time stamp$/, /^time$/, /^(recording )?timestamp.*$/],
      block: /duration|time to first|ttff/,
    },
    { key: 'gaze_x', label: '시선 X', required: true, patterns: [/^gaze point x$/, /^gaze point x \((adcs|mcs|dacs|dcs|px).*\)$/, /^gaze x$/, /^gaze position x$/, /^gaze_x$/, /^x$/, /^interpolated gaze point x$/, /^.*gaze point.* x$/] },
    { key: 'gaze_y', label: '시선 Y', required: true, patterns: [/^gaze point y$/, /^gaze point y \((adcs|mcs|dacs|dcs|px).*\)$/, /^gaze y$/, /^gaze position y$/, /^gaze_y$/, /^y$/, /^interpolated gaze point y$/, /^.*gaze point.* y$/] },
    { key: 'pupil', label: '동공', patterns: [/^pupil diameter left$/, /^pupil diameter$/, /^pupil left$/, /^pupil$/, /^pupil diameter right$/] },
    { key: 'validity', label: '유효성', auto: true, patterns: [/^validity left$/, /^validity right$/, /^validity$/, /^left validity$/, /^right validity$/, /^gaze validity$/] },
    { key: 'event', label: '이벤트', patterns: [/^eye movement type$/, /^event type$/, /^gaze event type$/] },
    { key: 'subject', label: '참가자', patterns: [/^participant name$/, /^participant id$/, /^participant$/, /^subject id$/, /^subject$/, /^ppn$/] },
    { key: 'trial', label: '시행', patterns: [/^recording name$/, /^recording id$/, /^recording$/, /^trial$/] },
    { key: 'condition', label: '조건', patterns: [/^presented stimulus name$/, /^stimulus name$/, /^condition$/, /^group$/, /^media name$/] },
    { key: 'media_width', label: '화면 폭', patterns: [/^media width$/, /^stimulus width$/, /^screen width$/] },
    { key: 'media_height', label: '화면 높이', patterns: [/^media height$/, /^stimulus height$/, /^screen height$/] },
  ];

  const normalize = (name) => String(name).replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');

  function autoMap(columns) {
    const norm = columns.map(normalize);
    const used = new Set();
    const mapping = {};
    for (const field of FIELDS) {
      if (field.key === 'validity') continue; // auto: use every validity column
      for (const pattern of field.patterns) {
        let found = null;
        for (let i = 0; i < norm.length; i++) {
          if (used.has(i) || !norm[i]) continue;
          if (field.block && field.block.test(norm[i])) continue;
          if (pattern.test(norm[i])) {
            found = i;
            break;
          }
        }
        if (found !== null) {
          mapping[field.key] = columns[found];
          used.add(found);
          break;
        }
      }
    }
    return mapping;
  }

  function autoValidityColumns(columns) {
    return columns.filter((c) => /^(validity( (left|right))?|gaze validity|left validity|right validity)$/.test(normalize(c)));
  }

  /* --------------------------------------------------------- frame build */
  function buildFrame(table, mapping) {
    const { columns, rows } = table;
    const indexOf = (field) => (mapping[field] ? columns.indexOf(mapping[field]) : -1);
    const ix = indexOf('gaze_x');
    const iy = indexOf('gaze_y');
    if (ix < 0 || iy < 0) throw new Error('시선 X · Y 열을 지정해 주세요.');

    const it = indexOf('timestamp');
    const ip = indexOf('pupil');
    const ie = indexOf('event');
    const isub = indexOf('subject');
    const itr = indexOf('trial');
    const icond = indexOf('condition');
    const iw = indexOf('media_width');
    const ih = indexOf('media_height');
    const validCols = mapping.validity ? [indexOf('validity')] : autoValidityColumns(columns).map((c) => columns.indexOf(c));

    // screen size
    let screenW = 0, screenH = 0;
    if (iw >= 0 || ih >= 0) {
      const ws = [], hs = [];
      for (const r of rows) {
        if (iw >= 0) { const v = num(r[iw]); if (Number.isFinite(v) && v > 0) ws.push(v); }
        if (ih >= 0) { const v = num(r[ih]); if (Number.isFinite(v) && v > 0) hs.push(v); }
      }
      screenW = median(ws) || 0;
      screenH = median(hs) || 0;
    }
    if (!screenW || !screenH) {
      const xs = [], ys = [];
      for (const r of rows) {
        const x = num(r[ix]), y = num(r[iy]);
        if (Number.isFinite(x)) xs.push(x);
        if (Number.isFinite(y)) ys.push(y);
      }
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      screenW = screenW || xs[Math.floor(xs.length * 0.995)] || 1920;
      screenH = screenH || ys[Math.floor(ys.length * 0.995)] || 1080;
    }

    // timestamp unit from the first slice of data
    let unitFactor = 1;
    let unit = 'ms';
    if (it >= 0) {
      const dts = [];
      for (let i = 1; i < Math.min(rows.length, 400); i++) {
        const a = num(rows[i - 1][it]);
        const b = num(rows[i][it]);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) dts.push(b - a);
      }
      const md = median(dts);
      if (Number.isFinite(md)) {
        if (md > 1000) { unit = 'us'; unitFactor = 0.001; }
        else if (md < 1) { unit = 's'; unitFactor = 1000; }
      }
    }

    // validity convention
    let zeroIsInvalid = null;
    if (validCols.length) {
      let maxVal = -Infinity;
      let minVal = Infinity;
      let seen = 0;
      for (const r of rows) {
        for (const ci of validCols) {
          const v = num(r[ci]);
          if (Number.isFinite(v)) {
            maxVal = Math.max(maxVal, v);
            minVal = Math.min(minVal, v);
            seen++;
          }
        }
        if (seen > 4000) break;
      }
      if (seen) zeroIsInvalid = maxVal > 1;
    }

    const samples = [];
    const groups = new Map();
    let time = 0;

    for (const r of rows) {
      const x = num(r[ix]);
      const y = num(r[iy]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        // keep the sample so gaps stay visible in the timeline
      }
      if (it >= 0) {
        const t = num(r[it]);
        time = Number.isFinite(t) ? t * unitFactor : time + 1000 / 60;
      } else {
        time += 1000 / 60;
      }

      let valid = true;
      if (validCols.length) {
        valid = true;
        for (const ci of validCols) {
          const v = num(r[ci]);
          if (!Number.isFinite(v)) { valid = false; break; }
          if (zeroIsInvalid ? v !== 0 : v <= 0) { valid = false; break; }
        }
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) valid = false;

      const subject = isub >= 0 ? String(r[isub] || '').trim() || null : null;
      const trial = itr >= 0 ? String(r[itr] || '').trim() || null : null;
      const condition = icond >= 0 ? String(r[icond] || '').trim() || null : null;
      const key = subject || trial ? `${subject || '-'}|${trial || '-'}` : 'all';
      if (!groups.has(key)) {
        groups.set(key, { key, subject, trial, condition, indices: [] });
      }
      const group = groups.get(key);
      if (condition && !group.condition) group.condition = condition;

      samples.push({
        t: time,
        x,
        y,
        valid,
        pupil: ip >= 0 ? num(r[ip]) : NaN,
        event: ie >= 0 ? String(r[ie] || '').trim() : '',
        group: key,
      });
      group.indices.push(samples.length - 1);
    }

    // linear interpolation of very short coordinate gaps (<= 3 samples, <= 40 ms),
    // mirroring cleaner.clean_gaze() in the Python engine
    let interpolated = 0;
    for (const group of groups.values()) {
      const gidx = group.indices;
      let i = 0;
      while (i < gidx.length) {
        const s = samples[gidx[i]];
        const broken = !Number.isFinite(s.x) || !Number.isFinite(s.y);
        if (!broken) { i += 1; continue; }
        let j = i;
        while (j < gidx.length) {
          const q = samples[gidx[j]];
          if (Number.isFinite(q.x) && Number.isFinite(q.y)) break;
          j += 1;
        }
        const prev = i > 0 ? samples[gidx[i - 1]] : null;
        const next = j < gidx.length ? samples[gidx[j]] : null;
        const runLen = j - i;
        const span = prev && next ? next.t - prev.t : Infinity;
        if (prev && next && runLen <= 3 && span <= 40) {
          for (let k = i; k < j; k++) {
            const target = samples[gidx[k]];
            const f = (target.t - prev.t) / (next.t - prev.t || 1);
            target.x = prev.x + (next.x - prev.x) * f;
            target.y = prev.y + (next.y - prev.y) * f;
            target.valid = true;
            target.interpolated = true;
            interpolated += 1;
          }
        }
        i = j;
      }
    }

    // rebase each recording to 0 ms
    for (const group of groups.values()) {
      let min = Infinity;
      for (const i of group.indices) {
        if (Number.isFinite(samples[i].t) && samples[i].t < min) min = samples[i].t;
      }
      if (Number.isFinite(min)) {
        for (const i of group.indices) samples[i].t -= min;
      }
    }

    return {
      samples,
      groups: Array.from(groups.values()),
      screen: { w: screenW, h: screenH },
      unit,
      interpolated,
      validityColumns: validCols.map((i) => columns[i]),
    };
  }

  /* ------------------------------------------------------------- quality */
  function computeQuality(frame) {
    const samples = frame.samples;
    let validCount = 0;
    let missing = 0;
    const dts = [];
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].valid) validCount++;
      if (!Number.isFinite(samples[i].x) || !Number.isFinite(samples[i].y)) missing++;
    }
    for (const group of frame.groups) {
      const idx = group.indices;
      for (let k = 1; k < idx.length; k++) {
        const a = samples[idx[k - 1]].t;
        const b = samples[idx[k]].t;
        const d = b - a;
        if (d > 0) dts.push(d);
        else if (d < 0) group.nonMonotonic = (group.nonMonotonic || 0) + 1;
      }
    }
    const md = median(dts);
    const hz = Number.isFinite(md) && md > 0 ? 1000 / md : null;
    let duration = 0;
    for (const group of frame.groups) {
      const idx = group.indices;
      if (!idx.length) continue;
      let min = Infinity, max = -Infinity;
      for (const i of idx) {
        if (samples[i].t < min) min = samples[i].t;
        if (samples[i].t > max) max = samples[i].t;
      }
      group.duration = (max - min) / 1000;
      duration += group.duration;
    }
    const conditions = new Set(frame.groups.map((g) => g.condition).filter(Boolean));
    const subjects = new Set(frame.groups.map((g) => g.subject).filter(Boolean));
    const warnings = [];
    if (validCount / samples.length < 0.7) warnings.push(`유효 시선 비율이 낮습니다 (${pct(validCount / samples.length)}). 교정·조명을 확인하세요.`);
    if (!hz) warnings.push('시각 열이 없어 60 Hz 가정으로 시간축을 만들었습니다.');
    else if (hz < 30) warnings.push(`샘플링이 낮습니다 (${hz.toFixed(1)} Hz). 짧은 응시가 합쳐질 수 있습니다.`);
    if (missing / samples.length > 0.1) warnings.push(`좌표 결측이 ${pct(missing / samples.length)}입니다.`);
    if (frame.validityColumns.length === 0) warnings.push('유효성 열을 찾지 못해 좌표 존재 여부로 유효 시선을 판정했습니다.');
    if (frame.interpolated) warnings.push(`짧은 결측 ${frame.interpolated.toLocaleString('ko-KR')}개 샘플을 선형 보간했습니다 (≤3샘플·≤40ms).`);
    return {
      rows: samples.length,
      recordings: frame.groups.length,
      subjects: subjects.size,
      conditions: Array.from(conditions),
      validRatio: validCount / samples.length,
      missingRatio: missing / samples.length,
      hz,
      duration,
      warnings,
    };
  }

  /* ----------------------------------------------------------------- IVT */
  function estimatePxPerDeg(screenWidthPx, screenWidthMm = 530, viewingDistanceMm = 650) {
    const widthDeg = (2 * Math.atan(screenWidthMm / 2 / viewingDistanceMm) * 180) / Math.PI;
    return widthDeg > 0 ? screenWidthPx / widthDeg : 1;
  }

  function runsOf(labels) {
    const out = [];
    if (!labels.length) return out;
    let start = 0;
    for (let i = 1; i <= labels.length; i++) {
      if (i === labels.length || labels[i] !== labels[start]) {
        out.push([start, i - 1, labels[start]]);
        start = i;
      }
    }
    return out;
  }

  function flipShort(labels, times, kind, minMs, betweenOnly = false) {
    const out = labels.slice();
    for (const [s, e, label] of runsOf(out)) {
      if (label !== kind) continue;
      const duration = e > s ? times[e] - times[s] : 0;
      if (duration >= minMs) continue;
      if (betweenOnly && (s === 0 || e === out.length - 1)) continue;
      for (let i = s; i <= e; i++) out[i] = 1 - kind;
    }
    return out;
  }

  function classifyIvt(frame, config) {
    const pxPerDeg = estimatePxPerDeg(frame.screen.w || 1920);
    const segments = [];
    const threshold = config.threshold;
    const minFix = config.minFixation;
    const minSac = 20;
    const maxGap = 90;

    for (const group of frame.groups) {
      const idx = group.indices;
      let run = [];
      const flush = () => {
        if (run.length >= 3) processRun(run);
        run = [];
      };
      const processRun = (positions) => {
        const times = positions.map((i) => frame.samples[i].t);
        const xs = positions.map((i) => frame.samples[i].x);
        const ys = positions.map((i) => frame.samples[i].y);
        const vel = new Array(times.length).fill(0);
        for (let k = 1; k < times.length; k++) {
          const dt = (times[k] - times[k - 1]) / 1000;
          if (dt <= 0) continue;
          const dist = Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]) / pxPerDeg;
          vel[k] = dist / dt;
        }
        if (vel.length > 1) vel[0] = vel[1];
        let labels = vel.map((v) => (v <= threshold ? 1 : 0));
        for (let pass = 0; pass < 4; pass++) {
          labels = flipShort(labels, times, 1, minFix, false);
          labels = flipShort(labels, times, 0, minSac, true);
        }
        labels = flipShort(labels, times, 1, minFix, false);

        let start = 0;
        for (let k = 1; k <= labels.length; k++) {
          if (k === labels.length || labels[k] !== labels[start]) {
            const end = k - 1;
            const type = labels[start] === 1 ? 'fixation' : 'saccade';
            const t0 = times[start], t1 = times[end];
            let cx = 0, cy = 0;
            for (let j = start; j <= end; j++) { cx += xs[j]; cy += ys[j]; }
            const n = end - start + 1;
            cx /= n; cy /= n;
            let amplitude = 0, peak = 0;
            for (let j = start + 1; j <= end; j++) peak = Math.max(peak, vel[j]);
            if (type === 'saccade' && n >= 2) {
              const head = Math.min(3, n);
              const x0 = mean(xs.slice(start, start + head));
              const y0 = mean(ys.slice(start, start + head));
              const x1 = mean(xs.slice(end - head + 1, end + 1));
              const y1 = mean(ys.slice(end - head + 1, end + 1));
              amplitude = Math.hypot(x1 - x0, y1 - y0) / pxPerDeg;
            }
            segments.push({
              group: group.key,
              condition: group.condition,
              subject: group.subject,
              type,
              start: t0,
              end: t1,
              duration: Math.max(0, t1 - t0),
              cx, cy,
              amplitude,
              peak,
              count: n,
            });
            start = k;
          }
        }
      };

      for (const i of idx) {
        const sample = frame.samples[i];
        if (!sample.valid) { flush(); continue; }
        if (run.length) {
          const last = frame.samples[run[run.length - 1]].t;
          if (sample.t - last > maxGap) flush();
        }
        run.push(i);
      }
      flush();
    }
    return { segments, pxPerDeg };
  }

  /* ------------------------------------------------------------- metrics */
  function aoiContains(aoi, x, y, w, h) {
    const nx = x / w;
    const ny = y / h;
    return nx >= aoi.x && nx <= aoi.x + aoi.w && ny >= aoi.y && ny <= aoi.y + aoi.h;
  }

  function computeMetrics(frame, segments, aois, pxPerDeg) {
    const byGroup = new Map();
    for (const seg of segments) {
      if (!byGroup.has(seg.group)) byGroup.set(seg.group, []);
      byGroup.get(seg.group).push(seg);
    }
    const participants = [];
    for (const group of frame.groups) {
      const segs = byGroup.get(group.key) || [];
      const fix = segs.filter((s) => s.type === 'fixation');
      const sac = segs.filter((s) => s.type === 'saccade');
      const totalFix = fix.reduce((s, v) => s + v.duration, 0);
      const sampleIdx = group.indices;
      const validCount = sampleIdx.filter((i) => frame.samples[i].valid).length;
      const base = sampleIdx.length ? frame.samples[sampleIdx[0]].t : 0;
      const row = {
        subject: group.subject || 'all',
        trial: group.trial || '',
        condition: group.condition || '—',
        group: group.key,
        duration: group.duration || 0,
        validRatio: sampleIdx.length ? validCount / sampleIdx.length : 0,
        fixationCount: fix.length,
        fixationTotal: totalFix,
        fixationMean: fix.length ? totalFix / fix.length : 0,
        fixationMedian: median(fix.map((s) => s.duration)),
        fixationRate: group.duration ? fix.length / group.duration : 0,
        saccadeCount: sac.length,
        saccadeAmplitude: sac.length ? mean(sac.map((s) => s.amplitude)) : 0,
        saccadePeak: sac.length ? mean(sac.map((s) => s.peak)) : 0,
        aois: {},
      };
      for (const aoi of aois) {
        const inside = fix.filter((s) => aoiContains(aoi, s.cx, s.cy, frame.screen.w, frame.screen.h));
        const dwell = inside.reduce((s, v) => s + v.duration, 0);
        row.aois[aoi.name] = {
          dwell,
          ratio: totalFix > 0 ? dwell / totalFix : 0,
          visits: inside.length,
          ttff: inside.length ? Math.min(...inside.map((s) => s.start)) - base : NaN,
        };
      }
      participants.push(row);
    }
    return participants;
  }

  function aggregate(participants, key) {
    const groups = new Map();
    for (const p of participants) {
      const cond = p.condition;
      if (!groups.has(cond)) groups.set(cond, []);
      groups.get(cond).push(p);
    }
    const out = new Map();
    for (const [cond, list] of groups) {
      out.set(cond, {
        n: list.length,
        mean: mean(list.map((p) => p[key])),
        sd: sd(list.map((p) => p[key])),
        median: median(list.map((p) => p[key])),
      });
    }
    return out;
  }

  function cohensD(a, b) {
    if (a.length < 2 || b.length < 2) return NaN;
    const s1 = sd(a), s2 = sd(b);
    const pooled = Math.sqrt(((a.length - 1) * s1 * s1 + (b.length - 1) * s2 * s2) / (a.length + b.length - 2));
    if (!pooled) return 0;
    return (mean(a) - mean(b)) / pooled;
  }

  /* ------------------------------------------------------------ rendering */
  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  function renderMapping() {
    const grid = $('mappingGrid');
    grid.innerHTML = '';
    if (!state.table) return;
    const { columns } = state.table;
    const detected = Object.keys(state.mapping).length;
    $('mapStatus').textContent = detected ? `자동 매핑 ${detected}개` : '수동 지정 필요';

    for (const field of FIELDS) {
      if (['media_width', 'media_height', 'trial'].includes(field.key) && !state.mapping[field.key]) continue;
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.setAttribute('for', `map-${field.key}`);
      label.innerHTML = `${field.label}${field.required ? ' <span class="req">*</span>' : ''}`;
      const select = document.createElement('select');
      select.id = `map-${field.key}`;
      select.dataset.field = field.key;

      const none = document.createElement('option');
      none.value = '';
      none.textContent = field.key === 'validity' ? '자동 (모든 유효성 열)' : '사용 안 함';
      select.appendChild(none);

      for (const col of columns) {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        select.appendChild(opt);
      }
      const current = state.mapping[field.key] || '';
      select.value = current;
      select.classList.toggle('detected', Boolean(current));
      select.addEventListener('change', () => {
        if (select.value) state.mapping[field.key] = select.value;
        else delete state.mapping[field.key];
        select.classList.toggle('detected', Boolean(select.value));
        rebuildFromMapping();
      });
      wrap.appendChild(label);
      wrap.appendChild(select);
      grid.appendChild(wrap);
    }
  }

  function renderPreview() {
    const wrap = $('previewWrap');
    const table = $('previewTable');
    if (!state.table) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    const { columns, rows } = state.table;
    const wanted = ['timestamp', 'gaze_x', 'gaze_y', 'subject', 'condition'];
    const picks = wanted
      .map((key) => ({ key, col: state.mapping[key] }))
      .filter((p) => p.col && columns.includes(p.col));
    const head = picks
      .map((p) => `<th>${p.key === 'timestamp' ? '시각 (ms)' : FIELD_BY_KEY[p.key] ? FIELD_BY_KEY[p.key].label : p.col}</th>`)
      .join('');
    const factor = state.frame && state.frame.unit === 'us' ? 0.001 : state.frame && state.frame.unit === 's' ? 1000 : 1;
    const body = rows
      .slice(0, 4)
      .map((r) => `<tr>${picks.map((p) => {
        const raw = r[columns.indexOf(p.col)];
        if (p.key === 'timestamp') {
          const t = num(raw);
          return `<td>${Number.isFinite(t) ? Math.round(t * factor).toLocaleString('ko-KR') : '—'}</td>`;
        }
        return `<td>${String(raw ?? '').slice(0, 18) || '—'}</td>`;
      }).join('')}</tr>`)
      .join('');
    table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  }

  function renderQuality() {
    const q = state.quality;
    if (!q) return;
    $('qRows').textContent = q.rows.toLocaleString('ko-KR');
    $('qValid').textContent = pct(q.validRatio);
    $('qHz').innerHTML = q.hz ? `${q.hz.toFixed(0)}<small>Hz</small>` : '—';
    $('qMissing').textContent = pct(q.missingRatio);
    const list = $('warningList');
    list.innerHTML = '';
    for (const w of q.warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      list.appendChild(li);
    }
  }

  function renderFileMeta() {
    const meta = $('fileMeta');
    meta.innerHTML = '';
    if (!state.table) {
      meta.innerHTML = '<span class="name">아직 데이터가 없습니다</span>';
      return;
    }
    const q = state.quality;
    const bits = [
      `<span class="name">${state.fileName || '데이터'}</span>`,
      state.source === 'demo' ? '<span class="tag live">합성 데모</span>' : '<span class="tag">업로드</span>',
      `<span class="tag">${state.meta.delimiter || 'auto'}</span>`,
      `<span class="tag">${(state.meta.encoding || 'utf-8').toUpperCase()}</span>`,
    ];
    if (q) bits.push(`<span>${q.rows.toLocaleString('ko-KR')}행 · ${q.recordings}개 recording</span>`);
    meta.innerHTML = bits.join('');
    renderPreview();
  }

  function readAois() {
    const rows = Array.from(document.querySelectorAll('#aoiEditor .aoi-row'));
    const aois = [];
    rows.forEach((row, i) => {
      const inputs = row.querySelectorAll('input');
      const name = inputs[0].value.trim() || `AOI ${i + 1}`;
      const x = clamp(Number(inputs[1].value) || 0, 0, 1);
      const y = clamp(Number(inputs[2].value) || 0, 0, 1);
      const w = clamp(Number(inputs[3].value) || 0, 0, 1);
      const h = clamp(Number(inputs[4].value) || 0, 0, 1);
      aois.push({ name, x, y, w, h });
    });
    return aois;
  }

  function renderAoiEditor(aois) {
    const editor = $('aoiEditor');
    editor.innerHTML = '';
    (aois || BANDS).forEach((aoi) => {
      const row = document.createElement('div');
      row.className = 'aoi-row';
      const values = [aoi.name, aoi.x, aoi.y, aoi.w, aoi.h];
      values.forEach((v, i) => {
        const input = document.createElement('input');
        input.type = i === 0 ? 'text' : 'number';
        if (i > 0) {
          input.min = '0';
          input.max = '1';
          input.step = '0.05';
        }
        input.value = v;
        input.setAttribute('aria-label', i === 0 ? 'AOI 이름' : ['X', 'Y', 'W', 'H'][i - 1]);
        input.addEventListener('change', () => runAnalysis());
        row.appendChild(input);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.textContent = '×';
      del.title = '영역 삭제';
      del.addEventListener('click', () => {
        row.remove();
        runAnalysis();
      });
      row.appendChild(del);
      editor.appendChild(row);
    });
  }

  function renderKpis() {
    const grid = $('kpiGrid');
    if (!state.analysis) return;
    const { participants, conditions } = state.analysis;
    const n = participants.length;
    const avgFixCount = mean(participants.map((p) => p.fixationCount));
    const avgFixMean = mean(participants.map((p) => p.fixationMean));
    const avgAmp = mean(participants.map((p) => p.saccadeAmplitude));
    const totalDuration = participants.reduce((s, p) => s + p.duration, 0);
    const valid = mean(participants.map((p) => p.validRatio));
    const hz = state.quality.hz;
    const items = [
      { k: '응시 횟수', v: fmt(avgFixCount, 1), d: 'recording 평균' },
      { k: '평균 응시시간', v: `${fmt(avgFixMean, 0)}<small>ms</small>`, d: 'Fixation mean' },
      { k: '도약 평균 진폭', v: `${fmt(avgAmp, 2)}<small>°</small>`, d: 'Saccade amplitude' },
      { k: '유효 시선', v: pct(valid), d: 'valid samples' },
      { k: '추정 샘플링', v: hz ? `${hz.toFixed(0)}<small>Hz</small>` : '—', d: 'median dt' },
      { k: '총 분석 구간', v: `${fmt(totalDuration, 1)}<small>s</small>`, d: `${n} recording · ${conditions.length}조건` },
    ];
    grid.innerHTML = items
      .map((item, i) => `<div class="kpi${i === items.length - 1 ? ' accent' : ''}"><div class="k">${item.k}</div><div class="v">${item.v}</div><div class="d">${item.d}</div></div>`)
      .join('');
  }

  function renderAoiTable() {
    const tbody = document.querySelector('#aoiTable tbody');
    const { participants, aois, conditions } = state.analysis;
    if (!participants.length) return;
    const rows = [];
    for (const cond of conditions) {
      const list = participants.filter((p) => p.condition === cond);
      for (const aoi of aois) {
        const dwell = mean(list.map((p) => p.aois[aoi.name]?.dwell || 0));
        const ratio = mean(list.map((p) => p.aois[aoi.name]?.ratio || 0));
        const visits = mean(list.map((p) => p.aois[aoi.name]?.visits || 0));
        const ttffs = list.map((p) => p.aois[aoi.name]?.ttff).filter((v) => Number.isFinite(v));
        rows.push({ cond, aoi: aoi.name, dwell, ratio, visits, ttff: ttffs.length ? mean(ttffs) : NaN });
      }
    }
    tbody.innerHTML = rows
      .map(
        (r) => `<tr>
          <td>${r.cond}</td><td><b>${r.aoi}</b></td>
          <td class="num">${fmt(r.dwell, 0)} ms</td>
          <td class="num">${pct(r.ratio)}</td>
          <td class="num">${fmt(r.visits, 1)}</td>
          <td class="num">${Number.isFinite(r.ttff) ? `${fmt(r.ttff, 0)} ms` : '—'}</td>
        </tr>`
      )
      .join('');
    $('aoiTable').closest('.card').querySelector('.card-desc').textContent =
      `조건별 응시시간 비율 · 방문횟수 · 최초 응시시간(TTFF) · AOI ${aois.length}개`;
  }

  function renderStatsTable() {
    const tbody = document.querySelector('#statsTable tbody');
    const { participants, aois, conditions } = state.analysis;
    if (conditions.length < 2) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#6b6a66">조건이 2개 이상이어야 비교합니다.</td></tr>';
      return;
    }
    const [a, b] = conditions;
    const listA = participants.filter((p) => p.condition === a);
    const listB = participants.filter((p) => p.condition === b);
    const metrics = [
      { key: 'fixationCount', label: '응시 횟수', digits: 1 },
      { key: 'fixationMean', label: '평균 응시(ms)', digits: 0 },
      { key: 'fixationRate', label: '초당 응시', digits: 2 },
      { key: 'saccadeCount', label: '도약 횟수', digits: 1 },
      { key: 'saccadeAmplitude', label: '도약 진폭(°)', digits: 2 },
      { key: 'saccadePeak', label: '도약 속도(°/s)', digits: 0 },
    ];
    for (const aoi of aois) {
      metrics.push({
        key: `aoi:${aoi.name}`,
        label: `${aoi.name} 체류`,
        digits: 1,
        value: (p) => (p.aois[aoi.name]?.ratio || 0) * 100,
        unit: '%',
      });
    }
    const cells = metrics.map((m) => {
      const get = (p) => (m.value ? m.value(p) : p[m.key]);
      const va = listA.map(get);
      const vb = listB.map(get);
      const d = cohensD(va, vb);
      return `<tr>
        <td>${m.label}</td>
        <td class="num">${fmt(mean(va), m.digits)}${m.unit || ''}</td>
        <td class="num">${fmt(mean(vb), m.digits)}${m.unit || ''}</td>
        <td class="num ${Math.abs(d) >= 0.8 ? 'strong' : ''}">${Number.isFinite(d) ? d.toFixed(2) : '—'}</td>
      </tr>`;
    });
    tbody.innerHTML = cells.join('');
    $('statsNote').textContent = `평균값 비교 (${a} n=${listA.length} · ${b} n=${listB.length}). d는 두 조건의 표준화 평균차(Cohen's d)입니다.`;
  }

  function renderParticipantsTable() {
    const tbody = document.querySelector('#participantTable tbody');
    const { participants } = state.analysis;
    tbody.innerHTML = participants
      .slice()
      .sort((x, y) => (x.condition + x.subject).localeCompare(y.condition + y.subject, 'ko'))
      .map(
        (p) => `<tr>
          <td>${p.subject}</td><td>${p.condition}</td>
          <td class="num">${p.fixationCount}</td>
          <td class="num">${fmt(p.fixationMean, 0)}</td>
          <td class="num">${p.saccadeCount}</td>
          <td class="num">${fmt(p.saccadeAmplitude, 2)}</td>
          <td class="num">${pct(p.validRatio)}</td>
        </tr>`
      )
      .join('');
  }

  /* ----------------------------------------------------------- visualise */
  const COLORS = {
    ink: '#141413',
    cream: '#FAF9F5',
    bronze: '#D97757',
    bronzeDeep: '#B4552F',
    line: '#DEDBD0',
  };

  function ramp(t) {
    // cream → bronze → deep bronze, with alpha
    const stops = [
      [0.0, [217, 119, 87, 0]],
      [0.25, [236, 190, 152, 95]],
      [0.5, [224, 146, 105, 160]],
      [0.75, [196, 96, 58, 200]],
      [0.92, [168, 70, 38, 222]],
      [1.0, [148, 52, 26, 235]],
    ];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const f = (t - t0) / (t1 - t0 || 1);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * f),
          Math.round(c0[1] + (c1[1] - c0[1]) * f),
          Math.round(c0[2] + (c1[2] - c0[2]) * f),
          Math.round(c0[3] + (c1[3] - c0[3]) * f),
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function currentGroup() {
    if (!state.analysis) return null;
    const cond = $('previewCondition').value;
    const subj = $('previewSubject').value;
    const groups = state.frame.groups;
    return (
      groups.find((g) => (g.condition || '—') === cond && (g.subject || 'all') === subj) ||
      groups.find((g) => (g.condition || '—') === cond) ||
      groups[0]
    );
  }

  function drawCanvas() {
    const canvas = $('gazeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const frame = state.frame;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F4F1E8';
    ctx.fillRect(0, 0, W, H);

    if (!frame || !state.analysis) {
      ctx.fillStyle = '#6B6A66';
      ctx.font = '14px sans-serif';
      ctx.fillText('데모 데이터를 불러오면 시각화가 나타납니다.', 24, 32);
      return;
    }

    const group = currentGroup();
    if (!group) return;
    const sx = W / frame.screen.w;
    const sy = H / frame.screen.h;

    // stimulus hints: soft horizon bands (no vendor image is ever used)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.55, 'rgba(240,238,230,0.2)');
    grad.addColorStop(1, 'rgba(226,222,208,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const idx = group.indices;

    if (state.mode === 'heat' || state.mode === 'both') {
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d');
      octx.fillStyle = '#000';
      octx.fillRect(0, 0, W, H);
      octx.globalCompositeOperation = 'lighter';
      const radius = Math.max(30, W * 0.042);
      for (const i of idx) {
        const s = frame.samples[i];
        if (!s.valid) continue;
        const gx = s.x * sx;
        const gy = s.y * sy;
        if (gx < -radius || gy < -radius || gx > W + radius || gy > H + radius) continue;
        const g = octx.createRadialGradient(gx, gy, 0, gx, gy, radius);
        g.addColorStop(0, 'rgba(255,255,255,0.028)');
        g.addColorStop(0.55, 'rgba(110,110,110,0.014)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        octx.fillStyle = g;
        octx.beginPath();
        octx.arc(gx, gy, radius, 0, Math.PI * 2);
        octx.fill();
      }
      const img = octx.getImageData(0, 0, W, H);
      const data = img.data;
      let max = 1;
      for (let p = 0; p < data.length; p += 4) max = Math.max(max, data[p]);
      const scale = 1 / Math.max(1, max * 0.62);
      const colorized = ctx.createImageData(W, H);
      const out = colorized.data;
      for (let p = 0; p < data.length; p += 4) {
        const v = Math.min(1, data[p] * scale);
        if (v <= 0.02) continue;
        const [r, g, b, a] = ramp(v);
        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
        out[p + 3] = a;
      }
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = H;
      tmp.getContext('2d').putImageData(colorized, 0, 0);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
    }

    // AOI boxes on top of the heat so the layout stays readable
    const aois = state.analysis.aois;
    ctx.font = '600 12px Inter, sans-serif';
    for (const aoi of aois) {
      const x = aoi.x * W, y = aoi.y * H, w = aoi.w * W, h = aoi.h * H;
      ctx.save();
      ctx.fillStyle = 'rgba(217,119,87,0.05)';
      ctx.strokeStyle = 'rgba(180,85,47,0.55)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(140,60,30,0.9)';
      ctx.fillText(aoi.name, x + 8, y + 18);
      ctx.restore();
    }

    if (state.mode === 'scan' || state.mode === 'both') {
      const fixations = state.analysis.segments
        .filter((s) => s.group === group.key && s.type === 'fixation')
        .sort((a, b) => a.start - b.start);
      const visible = fixations.slice(0, 60);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(20,20,19,0.55)';
      ctx.beginPath();
      visible.forEach((f, i) => {
        const x = f.cx * sx;
        const y = f.cy * sy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      visible.forEach((f, i) => {
        const x = f.cx * sx;
        const y = f.cy * sy;
        const r = clamp(3 + f.duration / 90, 3.5, 12);
        ctx.beginPath();
        ctx.fillStyle = i === 0 ? COLORS.bronzeDeep : COLORS.bronze;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(250,249,245,0.9)';
        ctx.stroke();
        if (i < 12) {
          ctx.fillStyle = COLORS.ink;
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText(String(i + 1), x + r + 2, y - r + 2);
        }
      });
    }

    // frame border
    ctx.strokeStyle = 'rgba(20,20,19,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    const fixCount = state.analysis.segments.filter((s) => s.group === group.key && s.type === 'fixation').length;
    $('canvasMeta').textContent = `${group.condition || '—'} · ${group.subject || 'all'} · ${fmt(group.duration || 0, 1)}초 · 응시 ${fixCount}회`;
    $('canvasScreen').textContent = `합성 좌표 · ${Math.round(frame.screen.w)}×${Math.round(frame.screen.h)} 기준`;
  }

  function renderPreviewSelectors() {
    if (!state.frame) return;
    const conditions = Array.from(new Set(state.frame.groups.map((g) => g.condition).filter(Boolean)));
    const condSel = $('previewCondition');
    const prevCond = condSel.value;
    condSel.innerHTML = conditions.map((c) => `<option value="${c}">${c}</option>`).join('');
    if (conditions.includes(prevCond)) condSel.value = prevCond;

    const subjects = state.frame.groups
      .filter((g) => !condSel.value || (g.condition || '') === condSel.value)
      .map((g) => g.subject || 'all');
    const subjSel = $('previewSubject');
    const prevSubj = subjSel.value;
    subjSel.innerHTML = Array.from(new Set(subjects)).map((s) => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(prevSubj)) subjSel.value = prevSubj;
  }

  /* --------------------------------------------------------------- export */
  function csvEscape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadCsv() {
    if (!state.analysis) return;
    const { participants, aois } = state.analysis;
    const header = ['subject', 'condition', 'trial', 'duration_s', 'valid_ratio', 'fixation_count', 'fixation_total_ms', 'fixation_mean_ms', 'fixation_median_ms', 'fixation_rate_per_s', 'saccade_count', 'saccade_amplitude_mean_deg', 'saccade_peak_velocity_mean_deg_s'];
    for (const aoi of aois) {
      header.push(`aoi_${aoi.name}_dwell_ms`, `aoi_${aoi.name}_dwell_ratio`, `aoi_${aoi.name}_visits`, `aoi_${aoi.name}_ttff_ms`);
    }
    const lines = [header.join(',')];
    for (const p of participants) {
      const row = [
        p.subject, p.condition, p.trial, p.duration.toFixed(3), p.validRatio.toFixed(4),
        p.fixationCount, p.fixationTotal.toFixed(1), p.fixationMean.toFixed(1), p.fixationMedian.toFixed(1), p.fixationRate.toFixed(3),
        p.saccadeCount, p.saccadeAmplitude.toFixed(3), p.saccadePeak.toFixed(1),
      ];
      for (const aoi of aois) {
        const a = p.aois[aoi.name] || {};
        row.push(
          (a.dwell || 0).toFixed(1),
          (a.ratio || 0).toFixed(4),
          a.visits || 0,
          Number.isFinite(a.ttff) ? a.ttff.toFixed(1) : ''
        );
      }
      lines.push(row.map(csvEscape).join(','));
    }
    download(`gazera_participants_${dateStamp()}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast('참가자별 지표 CSV를 내려받았습니다.');
  }

  function downloadJson() {
    if (!state.analysis) return;
    const { participants, aois, conditions, segments, pxPerDeg, config } = state.analysis;
    const payload = {
      schema: 'gazera.result.v1',
      generated_at: new Date().toISOString(),
      generator: 'GAZERA web workbench 0.1.0',
      source: { file: state.fileName, synthetic: state.source === 'demo' },
      mapping: state.mapping,
      config: { velocity_threshold_deg_s: config.threshold, min_fixation_ms: config.minFixation, px_per_deg: pxPerDeg, aois },
      quality: state.quality,
      summary: {
        rows: state.quality.rows,
        recordings: participants.length,
        conditions,
        fixation: {
          count: mean(participants.map((p) => p.fixationCount)),
          mean_ms: mean(participants.map((p) => p.fixationMean)),
        },
        saccade: {
          count: mean(participants.map((p) => p.saccadeCount)),
          mean_amplitude_deg: mean(participants.map((p) => p.saccadeAmplitude)),
        },
      },
      participants,
      aoi: aois.map((a) => {
        const perCondition = {};
        for (const cond of conditions) {
          const list = participants.filter((p) => p.condition === cond);
          perCondition[cond] = {
            n: list.length,
            dwell_ms: mean(list.map((p) => p.aois[a.name]?.dwell || 0)),
            dwell_ratio: mean(list.map((p) => p.aois[a.name]?.ratio || 0)),
            visits: mean(list.map((p) => p.aois[a.name]?.visits || 0)),
          };
        }
        return { ...a, conditions: perCondition };
      }),
      segments_by_recording: Object.fromEntries(
        Array.from(new Set(segments.map((s) => s.group))).map((key) => [key, segments.filter((s) => s.group === key).length])
      ),
      notices: {
        license: 'MIT License · Copyright (c) 2026 FEI · HEL Lab, Gyeongsang National University',
        affiliation: 'GAZERA is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Tobii AB.',
      },
    };
    download(`gazera_report_${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast('전체 보고서 JSON을 내려받았습니다.');
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  /* ------------------------------------------------------------- pipeline */
  function rebuildFromMapping() {
    try {
      state.frame = buildFrame(state.table, state.mapping);
      state.quality = computeQuality(state.frame);
      renderQuality();
      renderFileMeta();
      runAnalysis();
    } catch (err) {
      toast(err.message || '데이터를 해석할 수 없습니다.');
      $('runBtn').disabled = true;
    }
  }

  function runAnalysis() {
    if (!state.table) return;
    try {
      if (!state.frame) state.frame = buildFrame(state.table, state.mapping);
      const config = {
        threshold: Number($('threshold').value),
        minFixation: Number($('minFix').value),
      };
      const aois = readAois();
      const { segments, pxPerDeg } = classifyIvt(state.frame, config);
      const participants = computeMetrics(state.frame, segments, aois, pxPerDeg);
      const conditions = Array.from(new Set(participants.map((p) => p.condition)));
      state.analysis = { segments, participants, aois, conditions, pxPerDeg, config };

      $('resultCount').textContent = `${participants.length} recordings · ${segments.filter((s) => s.type === 'fixation').length.toLocaleString('ko-KR')} fixations`;
      $('resultSub').textContent = `${state.fileName || '데이터'} · I-VT ${config.threshold}°/s · 최소 응시 ${config.minFixation}ms · px/deg ${pxPerDeg.toFixed(1)}`;
      renderKpis();
      renderAoiTable();
      renderStatsTable();
      renderParticipantsTable();
      renderPreviewSelectors();
      drawCanvas();
      $('dlCsv').disabled = false;
      $('dlJson').disabled = false;
      $('runBtn').disabled = false;
    } catch (err) {
      console.error(err);
      toast(err.message || '분석 중 문제가 발생했습니다.');
    }
  }

  /* ----------------------------------------------------------- interactions */
  function loadTable(table, meta, fileName, source) {
    state.table = table;
    state.meta = meta || {};
    state.fileName = fileName;
    state.source = source;
    state.mapping = autoMap(table.columns);
    // keep UI simple: hide unused optional selects unless detected
    renderMapping();
    rebuildFromMapping();
  }

  function loadDemo() {
    const demo = makeDemo();
    loadTable(demo, demo.meta, 'gazera_synthetic_demo.tsv', 'demo');
    renderAoiEditor(BANDS);
    toast(`합성 데모 데이터 ${demo.rows.length.toLocaleString('ko-KR')}행을 불러왔습니다.`);
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { text, encoding } = decodeBuffer(reader.result);
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        const delimiter = sniffDelimiter(lines);
        const headerIdx = findHeaderIndex(lines, delimiter);
        const table = parseDelimited(text, delimiter, headerIdx);
        if (!table.columns.length || !table.rows.length) throw new Error('데이터 행을 찾지 못했습니다.');
        if (table.rows.length > 400000) throw new Error('행이 너무 많습니다(최대 40만 행). Python 엔진을 사용하세요.');
        const label = { ',': 'comma', '\t': 'tab', ';': 'semicolon', '|': 'pipe' }[delimiter] || delimiter;
        loadTable(
          table,
          { delimiter: label, encoding, headerRow: headerIdx },
          file.name,
          'file'
        );
        toast(`${table.rows.length.toLocaleString('ko-KR')}행을 불러왔습니다.`);
      } catch (err) {
        console.error(err);
        toast(err.message || '파일을 읽을 수 없습니다.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function bind() {
    const dz = $('dropzone');
    const input = $('fileInput');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
      })
    );
    dz.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const file = dt && dt.files && dt.files[0];
      if (file) readFile(file);
    });
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) readFile(input.files[0]);
      input.value = '';
    });

    $('demoBtn').addEventListener('click', loadDemo);
    $('clearBtn').addEventListener('click', () => {
      state.table = null;
      state.frame = null;
      state.quality = null;
      state.analysis = null;
      state.mapping = {};
      state.fileName = null;
      renderFileMeta();
      $('previewWrap').classList.add('hidden');
      $('mappingGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">데이터를 불러오면 매핑 표가 나타납니다.</div>';
      $('mapStatus').textContent = '대기';
      $('statRow').querySelectorAll('.v').forEach((el) => (el.textContent = '—'));
      $('warningList').innerHTML = '';
      $('kpiGrid').innerHTML = '';
      document.querySelector('#aoiTable tbody').innerHTML = '<tr><td colspan="6" style="color:#6b6a66">분석을 실행하면 표가 채워집니다.</td></tr>';
      document.querySelector('#statsTable tbody').innerHTML = '<tr><td colspan="4" style="color:#6b6a66">—</td></tr>';
      document.querySelector('#participantTable tbody').innerHTML = '<tr><td colspan="7" style="color:#6b6a66">—</td></tr>';
      $('dlCsv').disabled = true;
      $('dlJson').disabled = true;
      $('runBtn').disabled = true;
      $('resultCount').textContent = '—';
      $('resultSub').textContent = '합성 데모 데이터를 불러오면 여기에 요약이 나타납니다.';
      drawCanvas();
    });

    $('threshold').addEventListener('input', (e) => {
      $('thresholdVal').textContent = e.target.value;
      runAnalysis();
    });
    $('minFix').addEventListener('input', (e) => {
      $('minFixVal').textContent = e.target.value;
      runAnalysis();
    });
    $('runBtn').addEventListener('click', runAnalysis);
    $('addAoiBtn').addEventListener('click', () => {
      const rows = document.querySelectorAll('#aoiEditor .aoi-row');
      const last = rows[rows.length - 1];
      const aois = readAois();
      aois.push({ name: `AOI ${aois.length + 1}`, x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
      renderAoiEditor(aois);
      runAnalysis();
    });
    $('resetAoiBtn').addEventListener('click', () => {
      renderAoiEditor(BANDS);
      runAnalysis();
    });

    ['heat', 'scan', 'both'].forEach((mode) => {
      const btn = $(mode === 'heat' ? 'modeHeat' : mode === 'scan' ? 'modeScan' : 'modeBoth');
      btn.addEventListener('click', () => {
        state.mode = mode;
        ['modeHeat', 'modeScan', 'modeBoth'].forEach((id) => $(id).setAttribute('aria-pressed', String($(id) === btn)));
        drawCanvas();
      });
    });

    $('previewCondition').addEventListener('change', () => {
      renderPreviewSelectors();
      drawCanvas();
    });
    $('previewSubject').addEventListener('change', drawCanvas);

    $('dlCsv').addEventListener('click', downloadCsv);
    $('dlJson').addEventListener('click', downloadJson);

    window.addEventListener('resize', () => {
      // canvas is fixed-size; CSS scales it, nothing to redraw
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    bind();
    renderAoiEditor(BANDS);
    try {
      loadDemo();
    } catch (err) {
      console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
