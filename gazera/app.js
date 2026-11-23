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
    // stimulus RGB exclusion (image or video)
    rgb: {
      enabled: false,
      colors: [], // [{ r, g, b }]
      tolerance: 15,
      offsetMs: 0,
      bucketMs: 200,
      excluded: new Set(),
      samples: null, // Int32Array of packed RGB per sample (-1 = not sampled)
      sampled: 0,
      framesRead: 0,
      perColor: [],
      busy: false,
      token: 0,
      eyedropper: false,
    },
    stimulus: {
      kind: 'synthetic', // 'synthetic' | 'image' | 'video'
      name: '합성 자극 · 도시숲 / 도심 가로',
      image: null, // full-resolution canvas for a still image
      imageData: null,
      sampleW: 1920,
      sampleH: 1080,
      video: null,
      frameCanvas: null,
      url: null,
      durationMs: 0,
      bg: null, // 960x540 snapshot used as the heatmap background
    },
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

  /* ------------------------------------------------------- version · method */
  const VERSION = '0.2.0';
  const SCHEMA_VERSION = '0.2.0';

  const BOUNDARIES = {
    measured: { label: '실측 (measured)', text: '장비가 기록해 내보낸 값 그대로입니다. 워크벤치는 값을 만들지 않습니다.' },
    derived: { label: '파생 (derived)', text: '실측값에 명시된 수식과 파라미터를 적용해 결정론적으로 계산한 값입니다. 같은 입력이면 같은 값이 나오지만, 그 자체가 측정값은 아닙니다.' },
    exploratory: { label: '탐색 (exploratory)', text: '분포 가정·선택한 파라미터·표본 크기에 해석이 좌우되는 값입니다. 경향을 정렬할 수는 있지만, 그것만으로 가설을 확정하지 않습니다.' },
  };

  const REFERENCES = {
    salvucci2000: "Salvucci, D. D., & Goldberg, J. H. (2000). Identifying fixations and saccades in eye-tracking protocols. ETRA '00, 71–78. doi:10.1145/355017.355028",
    krejtz2014: "Krejtz, K., Szmidt, T., Duchowski, A. T., & Krejtz, I. (2014). Entropy-based statistical analysis of eye movement transitions. ETRA '14, 159–166. doi:10.1145/2578153.2578176",
    duchowski2017: 'Duchowski, A. T. (2017). Eye Tracking Methodology: Theory and Practice (3rd ed.). Springer. doi:10.1007/978-3-319-57883-5',
    holmqvist2011: 'Holmqvist, K., Nyström, M., Andersson, R., Dewhurst, R., Jarodzka, H., & van de Weijer, J. (2011). Eye Tracking: A Comprehensive Guide to Methods and Measures. Oxford University Press.',
    cohen1988: 'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Lawrence Erlbaum Associates.',
    shapiro1965: 'Shapiro, S. S., & Wilk, M. B. (1965). An analysis of variance test for normality. Biometrika, 52(3–4), 591–611. doi:10.1093/biomet/52.3-4.591',
  };

  const METHODOLOGY = [
    { key: 'valid_ratio', label: '유효 시선 비율', group: '품질', unit: '0–1', kind: 'derived', formula: 'n(valid = True) / n(samples)', boundary: '유효성 열의 약속(0=유효 / 0–4 척도)을 자동 판별합니다. 유효성 열이 없으면 모든 행을 유효로 간주하므로 이 값은 1이 되며, 그것이 데이터가 깨끗하다는 뜻은 아닙니다.' },
    { key: 'missing_ratio', label: '결측 좌표 비율', group: '품질', unit: '0–1', kind: 'derived', formula: 'n(gaze_x 또는 gaze_y 결측) / n(samples)', boundary: '결측이 곧 제외된 시선은 아니며, 짧은 공백은 보간되고 긴 공백은 구간을 나눕니다.' },
    { key: 'sample_rate_hz', label: '추정 샘플링 주기', group: '품질', unit: 'Hz', kind: 'derived', formula: '1000 / median(Δt)', boundary: '파일의 타임스탬프 간격에서 추정한 값이며 장비 사양값이 아닙니다.' },
    { key: 'rgb_excluded_ratio', label: 'RGB 제외 비율', group: '품질', unit: '0–1', kind: 'derived', formula: 'n(제외색 위 샘플) / n(samples)', boundary: '프레임 샘플링 간격과 색 허용 오차에 따라 달라지므로 두 파라미터를 함께 읽습니다.' },
    { key: 'fixation_count', label: '응시 횟수', group: 'I-VT', unit: 'count', kind: 'derived', formula: 'fixation으로 분류된 구간 수', boundary: '임계값·최소 응시시간 설정이 다른 연구와 직접 비교하지 않습니다.', ref: 'salvucci2000' },
    { key: 'fixation_duration', label: '응시 시간', group: 'I-VT', unit: 'ms', kind: 'derived', formula: 'end_ms − start_ms', boundary: '구간의 첫·끝 샘플 시각 차이이며, 한 샘플짜리 구간은 0 ms입니다.', ref: 'salvucci2000' },
    { key: 'fixation_rate', label: '초당 응시 빈도', group: 'I-VT', unit: '1/s', kind: 'derived', formula: 'fixation_count / Σ 구간 길이(s)', boundary: '시선이 없는 공백이 많으면 값이 올라갑니다.', ref: 'salvucci2000' },
    { key: 'saccade_amplitude', label: '도약 진폭', group: 'I-VT', unit: 'degree', kind: 'derived', formula: '‖centroid(앞 3) − centroid(뒤 3)‖ / px_per_deg', boundary: '화면 기하로 추정한 px/deg를 씁니다. 실제 시청거리가 다르면 각도도 달라집니다.', ref: 'salvucci2000' },
    { key: 'saccade_velocity', label: '도약 속도', group: 'I-VT', unit: 'degree/s', kind: 'derived', formula: 'max(‖Δp‖ / Δt) / px_per_deg', boundary: '샘플링 주기가 낮으면 짧은 도약의 최고 속도를 과소평가합니다.', ref: 'salvucci2000' },
    { key: 'px_per_deg', label: '화소–시각도 환산', group: 'I-VT', unit: 'px/degree', kind: 'derived', formula: 'W_px / (2·atan(W_mm/2/D_mm)·180/π)', boundary: '1920 px · 530 mm · 650 mm는 가정치입니다. 알려진 값을 설정에 넣어야 합니다.', ref: 'duchowski2017' },
    { key: 'aoi_dwell', label: 'AOI 체류시간', group: 'AOI', unit: 'ms', kind: 'derived', formula: 'Σ fixation.duration_ms where centroid ∈ AOI', boundary: 'AOI가 겹치면 한 응시가 둘 이상 영역에 계수되어 합이 100%를 넘을 수 있습니다.', ref: 'holmqvist2011' },
    { key: 'aoi_dwell_ratio', label: 'AOI 체류 비율', group: 'AOI', unit: '0–1', kind: 'derived', formula: 'AOI dwell / Σ fixation duration (recording)', boundary: 'recording 전체 응시시간 대비이며 자극 노출시간 대비가 아닙니다.', ref: 'holmqvist2011' },
    { key: 'aoi_visits', label: 'AOI 방문 횟수', group: 'AOI', unit: 'count', kind: 'derived', formula: 'count(fixations whose centroid ∈ AOI)', boundary: '중심점 기준이며, 겹치는 AOI에서는 한 응시가 여러 번 셀 수 있습니다.', ref: 'holmqvist2011' },
    { key: 'ttff', label: '최초 응시까지 시간 (TTFF)', group: 'AOI', unit: 'ms', kind: 'derived', formula: 'min(fixation.start ∈ AOI) − recording start', boundary: 'recording 시작 기준입니다. 자극 제시 시점이 다르면 offset으로 맞춰야 합니다.', ref: 'holmqvist2011' },
    { key: 'transition_count', label: 'AOI 전이 횟수', group: '전이', unit: 'count', kind: 'derived', formula: '연속한 두 응시가 서로 다른 AOI에 있을 때 1회', boundary: 'AOI 밖 응시는 사슬을 끊고, 자기 전이(A→A)는 세지 않습니다.', ref: 'krejtz2014' },
    { key: 'transition_probability', label: 'AOI 전이확률', group: '전이', unit: '0–1', kind: 'derived', formula: 'P(i→j) = n(i→j) / Σ_j n(i→j)', boundary: '전이가 5회 미만인 행은 0이나 1로 과장되므로 탐색적으로만 읽습니다.', ref: 'krejtz2014' },
    { key: 'stationary_entropy', label: '정지 시선 엔트로피', group: '전이', unit: 'bits', kind: 'derived', formula: 'H_s = −Σ π_i log2 π_i', boundary: 'AOI 구성(개수·크기)에 의존합니다. AOI 집합이 다른 분석과 직접 비교하지 않습니다.', ref: 'krejtz2014' },
    { key: 'transition_entropy', label: '전이 시선 엔트로피', group: '전이', unit: 'bits', kind: 'derived', formula: 'H_t = Σ π_i · (−Σ_j p_ij log2 p_ij)', boundary: '전이 수가 적으면 과소평가됩니다. 정규화는 log2(AOI 수)로 나눈 참고치입니다.', ref: 'krejtz2014' },
    { key: 'cohens_d', label: "효과크기 (Cohen's d)", group: '통계', unit: 'SD units', kind: 'derived', formula: '(x̄a − x̄b) / s_pooled', boundary: '0.2/0.5/0.8은 관례일 뿐입니다. 작은 표본에서는 d 자체가 크게 흔들립니다.', ref: 'cohen1988' },
    { key: 'p_value', label: 'p-value · 유의수준', group: '통계', unit: 'p', kind: 'exploratory', formula: 'α = 0.05 (사전 지정)', boundary: 'p는 효과의 크기·재현성을 말하지 않습니다. 웹 워크벤치는 p-value를 계산하지 않고, Python 엔진이 정규성 판정 후 Holm 보정과 함께 산출합니다.', ref: 'shapiro1965' },
  ];

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
      patterns: [/^recording timestamp( \[(ms|us|µs|s)\])?$/, /^timestamp( \[(ms|us|µs|s)\])?$/, /^device timestamp.*$/, /^time stamp$/, /^time$/, /^time[ _]?(ms|us|µs|s)$/, /^timestamp[ _]?(ms|us|µs|s)$/, /^time \((ms|us|µs|s)\)$/, /^(recording )?timestamp.*$/],
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
    const screenEstimated = !screenW || !screenH;
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
      const key = subject || trial || condition
        ? `${subject || '-'}|${trial || '-'}|${condition || '-'}`
        : 'all';
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
      screenEstimated,
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
    const nonMono = frame.groups.reduce((sum, g) => sum + (g.nonMonotonic || 0), 0);
    if (nonMono > 0) {
      warnings.push(`타임스탬프가 뒤로 가는 지점이 ${nonMono.toLocaleString('ko-KR')}개 있습니다. 참가자·시행·조건 열을 매핑하면 recording이 분리됩니다.`);
    }
    if (frame.screenEstimated) {
      warnings.push(`화면 크기 열이 없어 좌표 범위로 추정했습니다 (${Math.round(frame.screen.w)}×${Math.round(frame.screen.h)}).`);
    }
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

  function classifyIvt(frame, config, excluded) {
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
        if (!sample.valid || (excluded && excluded.size && excluded.has(i))) { flush(); continue; }
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
      const validCount = sampleIdx.filter((i) => frame.samples[i].valid && !frame.samples[i].rgbExcluded).length;
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
      const labels = fix
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((s) => aoiNameAt(aois, s.cx, s.cy, frame.screen.w, frame.screen.h));
      const entropy = entropyStatsFromLabels(labels, aois.map((a) => a.name));
      row.aoiTransitionCount = entropy.nTransitions;
      row.aoiStationaryEntropy = entropy.stationaryEntropy;
      row.aoiTransitionEntropy = entropy.transitionEntropy;
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

  /* ------------------------------------------------ AOI transitions · entropy */
  const esc = (value) =>
    String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));

  function aoiNameAt(aois, x, y, w, h) {
    for (const aoi of aois) {
      if (aoiContains(aoi, x, y, w, h)) return aoi.name;
    }
    return null;
  }

  function countsForLabels(labels, names) {
    const n = names.length;
    const index = new Map(names.map((name, i) => [name, i]));
    const counts = Array.from({ length: n }, () => new Array(n).fill(0));
    const visits = new Array(n).fill(0);
    for (let i = 0; i < labels.length; i += 1) {
      const current = labels[i];
      if (current === null || current === undefined || !index.has(current)) continue;
      visits[index.get(current)] += 1;
      if (i === 0) continue;
      const previous = labels[i - 1];
      // a fixation outside every AOI breaks the chain; A -> A is not a switch
      if (previous === null || previous === undefined || !index.has(previous) || previous === current) continue;
      counts[index.get(previous)][index.get(current)] += 1;
    }
    return { counts, visits };
  }

  function entropyStats(counts, visits, names) {
    const n = names.length;
    const total = visits.reduce((s, v) => s + v, 0);
    const pi = visits.map((v) => (total > 0 ? v / total : 0));
    const stationary = -pi.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    const rowTotals = counts.map((row) => row.reduce((s, v) => s + v, 0));
    const transition = counts.reduce((sum, row, i) => {
      if (!rowTotals[i]) return sum;
      const h = -row.reduce((s, v) => s + (v > 0 ? (v / rowTotals[i]) * Math.log2(v / rowTotals[i]) : 0), 0);
      return sum + pi[i] * h;
    }, 0);
    const norm = n > 1 ? Math.log2(n) : 0;
    return {
      counts,
      visits,
      pi,
      rowTotals,
      nFixations: total,
      nTransitions: counts.reduce((s, row) => s + row.reduce((a, v) => a + v, 0), 0),
      visited: pi.filter((p) => p > 0).length,
      stationaryEntropy: stationary,
      transitionEntropy: transition,
      stationaryNorm: norm ? stationary / norm : 0,
      transitionNorm: norm ? transition / norm : 0,
    };
  }

  function entropyStatsFromLabels(labels, names) {
    const { counts, visits } = countsForLabels(labels, names);
    return entropyStats(counts, visits, names);
  }

  function aggregateEntropy(labelLists, names) {
    const n = names.length;
    const counts = Array.from({ length: n }, () => new Array(n).fill(0));
    const visits = new Array(n).fill(0);
    for (const labels of labelLists) {
      const stats = entropyStatsFromLabels(labels, names);
      stats.counts.forEach((row, i) => row.forEach((v, j) => { counts[i][j] += v; }));
      stats.visits.forEach((v, i) => { visits[i] += v; });
    }
    return entropyStats(counts, visits, names);
  }

  function computeTransitions(segments, aois, screen) {
    const names = aois.map((a) => a.name);
    const byGroup = new Map();
    for (const seg of segments) {
      if (seg.type !== 'fixation') continue;
      if (!byGroup.has(seg.group)) byGroup.set(seg.group, []);
      byGroup.get(seg.group).push(seg);
    }
    const byRecording = [];
    const labelLists = [];
    const conditionLists = new Map();
    for (const [group, segs] of byGroup) {
      segs.sort((a, b) => a.start - b.start);
      const labels = segs.map((s) => aoiNameAt(aois, s.cx, s.cy, screen.w, screen.h));
      const stats = entropyStatsFromLabels(labels, names);
      const first = segs[0] || {};
      const condition = first.condition || '—';
      byRecording.push({
        group,
        subject: first.subject || 'all',
        trial: first.trial || '',
        condition,
        n_fixations: stats.nFixations,
        n_transitions: stats.nTransitions,
        visited_aois: stats.visited,
        stationary_entropy_bits: stats.stationaryEntropy,
        transition_entropy_bits: stats.transitionEntropy,
        stationary_entropy_normalized: stats.stationaryNorm,
        transition_entropy_normalized: stats.transitionNorm,
      });
      labelLists.push(labels);
      if (!conditionLists.has(condition)) conditionLists.set(condition, []);
      conditionLists.get(condition).push(labels);
    }
    const pooled = aggregateEntropy(labelLists, names);
    const byCondition = Array.from(conditionLists.entries()).map(([condition, lists]) => {
      const stats = aggregateEntropy(lists, names);
      return {
        condition,
        n_fixations: stats.nFixations,
        n_transitions: stats.nTransitions,
        visited_aois: stats.visited,
        stationary_entropy_bits: stats.stationaryEntropy,
        transition_entropy_bits: stats.transitionEntropy,
        stationary_entropy_normalized: stats.stationaryNorm,
        transition_entropy_normalized: stats.transitionNorm,
      };
    });
    const probabilities = pooled.counts.map((row, i) =>
      row.map((v) => (pooled.rowTotals[i] ? v / pooled.rowTotals[i] : 0))
    );
    return {
      aois: names,
      pooled,
      byCondition,
      byRecording,
      counts: pooled.counts,
      probabilities,
      note:
        '전이는 연속한 두 응시가 서로 다른 AOI에 있을 때만 셉니다. 기록 경계는 전이로 세지 않습니다. ' +
        '정지 엔트로피는 AOI별 응시 비중, 전이 엔트로피는 전이행렬을 그 비중으로 가중한 값입니다 (Krejtz et al., 2014).',
    };
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
    const { columns, rows } = state.table;
    const wanted = ['timestamp', 'gaze_x', 'gaze_y', 'subject', 'condition'];
    const picks = wanted
      .map((key) => ({ key, col: state.mapping[key] }))
      .filter((p) => p.col && columns.includes(p.col));
    if (!picks.length) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
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

  function clearResults(message) {
    state.analysis = null;
    renderRgbSummary();
    renderRgbCompare(null, null);
    $('kpiGrid').innerHTML = '';
    document.querySelector('#aoiTable tbody').innerHTML =
      `<tr><td colspan="6" style="color:#6b6a66">${message || '분석을 실행하면 표가 채워집니다.'}</td></tr>`;
    document.querySelector('#statsTable tbody').innerHTML = '<tr><td colspan="4" style="color:#6b6a66">—</td></tr>';
    document.querySelector('#participantTable tbody').innerHTML = '<tr><td colspan="9" style="color:#6b6a66">—</td></tr>';
    $('resultCount').textContent = '—';
    $('resultSub').textContent = '데이터를 불러오고 컬럼을 확인하면 분석 결과가 나타납니다.';
    $('dlCsv').disabled = true;
    $('dlJson').disabled = true;
    if ($('dlMd')) $('dlMd').disabled = true;
    if ($('transitionKpis')) $('transitionKpis').innerHTML = '';
    if ($('transitionMatrix')) $('transitionMatrix').innerHTML = '<thead></thead><tbody><tr><td class="muted">분석을 실행하면 전이행렬이 나타납니다.</td></tr></tbody>';
    if ($('entropyTable')) $('entropyTable').innerHTML = '<tbody><tr><td class="muted">—</td></tr></tbody>';
    $('previewCondition').innerHTML = '';
    $('previewSubject').innerHTML = '';
    $('canvasMeta').textContent = '—';
    drawCanvas();
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
      { key: 'aoiStationaryEntropy', label: '정지 엔트로피(bits)', digits: 3 },
      { key: 'aoiTransitionEntropy', label: '전이 엔트로피(bits)', digits: 3 },
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
          <td>${esc(p.subject)}</td><td>${esc(p.condition)}</td>
          <td class="num">${p.fixationCount}</td>
          <td class="num">${fmt(p.fixationMean, 0)}</td>
          <td class="num">${p.saccadeCount}</td>
          <td class="num">${fmt(p.saccadeAmplitude, 2)}</td>
          <td class="num">${pct(p.validRatio)}</td>
          <td class="num">${fmt(p.aoiStationaryEntropy, 3)}</td>
          <td class="num">${fmt(p.aoiTransitionEntropy, 3)}</td>
        </tr>`
      )
      .join('');
  }

  function renderTransitions() {
    const analysis = state.analysis;
    if (!analysis || !analysis.transitions) return;
    const { aois, pooled, probabilities, byCondition } = analysis.transitions;
    const kpis = [
      { k: 'AOI 내 응시', v: fmt(pooled.nFixations, 0), d: `${pooled.visited}/${aois.length} AOI 방문` },
      { k: 'AOI 전이', v: fmt(pooled.nTransitions, 0), d: '자기 전이 제외' },
      { k: '정지 엔트로피', v: `${fmt(pooled.stationaryEntropy, 3)}<small>bits</small>`, d: `정규화 ${fmt(pooled.stationaryNorm, 3)}` },
      { k: '전이 엔트로피', v: `${fmt(pooled.transitionEntropy, 3)}<small>bits</small>`, d: `정규화 ${fmt(pooled.transitionNorm, 3)}` },
    ];
    $('transitionKpis').innerHTML = kpis
      .map((item) => `<div class="stat"><div class="k">${item.k}</div><div class="v">${item.v}</div><div class="d">${item.d}</div></div>`)
      .join('');

    const head = `<tr><th>from \\ to</th>${aois.map((a) => `<th class="num">${esc(a)}</th>`).join('')}</tr>`;
    const rows = aois.map(
      (from, i) => `<tr><td><b>${esc(from)}</b></td>${probabilities[i]
        .map((v) => `<td class="num">${v ? v.toFixed(3) : '—'}</td>`)
        .join('')}</tr>`
    );
    $('transitionMatrix').innerHTML = `<thead>${head}</thead><tbody>${rows.join('')}</tbody>`;

    $('entropyTable').innerHTML = `<thead><tr><th>조건</th><th class="num">전이</th><th class="num">정지 H</th><th class="num">전이 H</th><th class="num">전이 H 정규화</th></tr></thead><tbody>${byCondition
      .map(
        (row) => `<tr><td>${esc(row.condition)}</td><td class="num">${fmt(row.n_transitions, 0)}</td><td class="num">${fmt(row.stationary_entropy_bits, 3)}</td><td class="num">${fmt(row.transition_entropy_bits, 3)}</td><td class="num">${fmt(row.transition_entropy_normalized, 3)}</td></tr>`
      )
      .join('')}</tbody>`;
    const note = $('transitionNote');
    if (note) {
      note.textContent = `AOI ${aois.length}개 · 정지 엔트로피는 AOI별 응시 비중, 전이 엔트로피는 전이확률 행의 엔트로피를 그 비중으로 가중한 값입니다. AOI 구성이 다른 분석과 직접 비교하지 않습니다 (Krejtz et al., 2014).`;
    }
  }

  function renderMethodology() {
    const tbody = document.querySelector('#methodologyTable tbody');
    if (!tbody) return;
    tbody.innerHTML = METHODOLOGY.map(
      (item) => `<tr>
        <td class="metric-name">${esc(item.label)}</td>
        <td><span class="kind-badge kind-${item.kind}">${item.kind}</span></td>
        <td>${esc(item.unit)}</td>
        <td class="mono-cell">${esc(item.formula)}</td>
        <td class="boundary-cell">${esc(item.boundary)}</td>
      </tr>`
    ).join('');
    $('methodologyScope').textContent = `${METHODOLOGY.length}개 지표 · v${VERSION}`;
    $('methodRefs').innerHTML = Object.values(REFERENCES).map((ref) => `<li>${esc(ref)}</li>`).join('');
  }

  /* --------------------------------------------- stimulus & RGB exclusion */
  // Everything below stays in the browser: the stimulus file never leaves the
  // machine. Images are read through a canvas, videos frame by frame at the
  // gaze timestamp.
  const EMPTY_SET = new Set();
  const rgbCtl = () => state.rgb;
  const stimCtl = () => state.stimulus;

  const packRgb = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  const rgbHex = (c) =>
    `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

  function parseRgbInput(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let m = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let hex = m[1];
      if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    const nums = raw.match(/\d+/g);
    if (nums && nums.length >= 3) {
      const [r, g, b] = nums.slice(0, 3).map(Number);
      if ([r, g, b].every((v) => v >= 0 && v <= 255)) return { r, g, b };
    }
    return null;
  }

  /* --- synthetic stimulus: a poster with flat colours to sample ---------- */
  function drawSyntheticStimulus() {
    const W = 1920, H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const x = canvas.getContext('2d', { willReadFrequently: true });

    x.fillStyle = '#FAF9F5';
    x.fillRect(0, 0, W, H);

    // black header band (top 16 %)
    x.fillStyle = '#000000';
    x.fillRect(0, 0, W, Math.round(H * 0.16));
    x.fillStyle = '#FFFFFF';
    x.fillRect(96, 46, 660, 30);
    x.fillRect(96, 92, 360, 12);

    // left: urban forest photo block
    const forest = x.createLinearGradient(0, 230, 0, 700);
    forest.addColorStop(0, '#2F4A38');
    forest.addColorStop(1, '#152219');
    x.fillStyle = forest;
    x.fillRect(96, 230, 760, 470);
    x.fillStyle = 'rgba(92,107,90,0.85)';
    for (let i = 0; i < 7; i++) {
      const cx = 170 + i * 105;
      x.beginPath();
      x.arc(cx, 420 + ((i * 37) % 90), 78, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = '#5C6B5A';
    x.fillRect(96, 660, 760, 40);

    // right: urban street photo block
    const street = x.createLinearGradient(1064, 230, 1824, 700);
    street.addColorStop(0, '#6B6A66');
    street.addColorStop(1, '#3C3B39');
    x.fillStyle = street;
    x.fillRect(1064, 230, 760, 470);
    x.fillStyle = '#8C8B86';
    x.fillRect(1100, 440, 690, 26);
    x.fillStyle = '#2C2B28';
    for (let i = 0; i < 5; i++) x.fillRect(1120 + i * 140, 260, 90, 150);

    // white caption card
    x.fillStyle = '#FFFFFF';
    x.fillRect(96, 800, 1728, 190);
    x.fillStyle = '#141413';
    x.fillRect(140, 846, 700, 20);
    x.fillRect(140, 886, 1080, 10);
    x.fillRect(140, 906, 980, 10);
    x.fillRect(140, 926, 620, 10);

    // black footer bar
    x.fillStyle = '#000000';
    x.fillRect(0, H - 44, W, 44);
    return canvas;
  }

  function setSyntheticStimulus() {
    const st = stimCtl();
    if (st.video) {
      try { st.video.pause(); } catch (e) { /* ignore */ }
    }
    st.kind = 'synthetic';
    st.name = '합성 자극 · 도시숲 / 도심 가로';
    st.image = drawSyntheticStimulus();
    st.imageData = null;
    st.sampleW = st.image.width;
    st.sampleH = st.image.height;
    st.video = null;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    st.durationMs = 0;
    $('videoBar').classList.add('hidden');
    updateStimMeta();
    renderStimPreview();
    drawCanvas();
    if (rgbCtl().enabled) sampleStimulusColors();
  }

  function fitSize(width, height, maxSide = 1920) {
    if (!width || !height) return [1, 1];
    const factor = Math.min(1, maxSide / Math.max(width, height));
    return [Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor))];
  }

  function updateStimMeta() {
    const st = stimCtl();
    $('stimName').textContent = st.name;
    const kindLabel = st.kind === 'video' ? '동영상' : st.kind === 'image' ? '이미지' : '합성';
    const size = `${st.kind === 'video' ? st.sampleW : st.image ? st.image.width : st.sampleW}×${
      st.kind === 'video' ? st.sampleH : st.image ? st.image.height : st.sampleH
    }`;
    $('stimMeta').textContent =
      st.kind === 'video' && st.durationMs
        ? `${kindLabel} · ${size} · ${(st.durationMs / 1000).toFixed(1)}초`
        : `${kindLabel} · ${size}`;
  }

  function renderStimPreview() {
    const canvas = $('stimCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const st = stimCtl();
    if (st.kind === 'video') {
      if (st.video && st.video.readyState >= 2) {
        if (!st.frameCanvas) {
          st.frameCanvas = document.createElement('canvas');
        }
        if (st.frameCanvas.width !== st.sampleW || st.frameCanvas.height !== st.sampleH) {
          st.frameCanvas.width = st.sampleW;
          st.frameCanvas.height = st.sampleH;
        }
        st.frameCanvas.getContext('2d').drawImage(st.video, 0, 0, st.sampleW, st.sampleH);
        st.bg = st.frameCanvas;
        ctx.drawImage(st.bg, 0, 0, W, H);
      } else {
        ctx.fillStyle = '#141413';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#FAF9F5';
        ctx.font = '13px sans-serif';
        ctx.fillText('동영상 프레임을 불러오는 중…', 24, 40);
      }
    } else if (st.image) {
      st.bg = st.image;
      ctx.drawImage(st.image, 0, 0, W, H);
    }
  }

  /* --- file loading ------------------------------------------------------ */
  function loadStimulusFile(file) {
    if (!file) return;
    const isVideo = /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.name);
    const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|gif|bmp|webp|avif)$/i.test(file.name);
    if (!isVideo && !isImage) {
      toast('이미지(PNG·JPG) 또는 동영상(MP4·WebM·MOV) 파일을 올려 주세요.');
      return;
    }
    if (isVideo) loadStimulusVideo(file);
    else loadStimulusImage(file);
  }

  function loadStimulusImage(file) {
    const st = stimCtl();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const [w, h] = fitSize(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      if (st.video) { try { st.video.pause(); } catch (e) { /* ignore */ } }
      if (st.url) URL.revokeObjectURL(st.url);
      st.kind = 'image';
      st.name = file.name;
      st.image = canvas;
      st.imageData = null;
      st.sampleW = w;
      st.sampleH = h;
      st.video = null;
      st.url = null;
      st.durationMs = 0;
      $('videoBar').classList.add('hidden');
      updateStimMeta();
      renderStimPreview();
      toast(`자극 이미지 ${w}×${h}를 불러왔습니다.`);
      if (rgbCtl().enabled) sampleStimulusColors();
      else runAnalysis();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('이미지를 읽을 수 없습니다.');
    };
    img.src = url;
  }

  function loadStimulusVideo(file) {
    const st = stimCtl();
    if (st.url) URL.revokeObjectURL(st.url);
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      const [w, h] = fitSize(video.videoWidth, video.videoHeight);
      st.kind = 'video';
      st.name = file.name;
      st.image = null;
      st.imageData = null;
      st.video = video;
      st.url = url;
      st.sampleW = w;
      st.sampleH = h;
      st.durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
      $('videoBar').classList.remove('hidden');
      $('videoSeek').max = String(Math.max(1, Math.floor(st.durationMs)));
      $('videoSeek').value = '0';
      updateVideoTime();
      updateStimMeta();
      seekVideo(0).then(() => {
        renderStimPreview();
        if (rgbCtl().enabled) sampleStimulusColors();
        else runAnalysis();
      });
      toast(`동영상 자극 ${w}×${h} · ${(st.durationMs / 1000).toFixed(1)}초를 불러왔습니다.`);
    });
    video.addEventListener('error', () => {
      toast('이 동영상 형식은 브라우저에서 재생할 수 없습니다. MP4(H.264)나 WebM으로 변환해 주세요.');
    });
  }

  /* --- video helpers ----------------------------------------------------- */
  function seekVideo(seconds) {
    const st = stimCtl();
    const video = st.video;
    if (!video) return Promise.resolve();
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.max(0, Math.min(seconds, Math.max(0, duration - 0.02)));
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 1200);
      video.addEventListener('seeked', finish);
      try {
        video.currentTime = target;
      } catch (e) {
        finish();
      }
    });
  }

  let videoRaf = null;
  function toggleVideoPlay() {
    const st = stimCtl();
    if (!st.video) return;
    if (st.video.paused) {
      st.video.play().catch(() => toast('재생할 수 없습니다.'));
      const tick = () => {
        if (!st.video || st.video.paused) {
          videoRaf = null;
          $('videoPlay').textContent = '▶';
          renderStimPreview();
          return;
        }
        $('videoSeek').value = String(Math.round(st.video.currentTime * 1000));
        updateVideoTime();
        renderStimPreview();
        videoRaf = requestAnimationFrame(tick);
      };
      $('videoPlay').textContent = '❚❚';
      videoRaf = requestAnimationFrame(tick);
    } else {
      st.video.pause();
      $('videoPlay').textContent = '▶';
      if (videoRaf) cancelAnimationFrame(videoRaf);
      videoRaf = null;
    }
  }

  function updateVideoTime() {
    const st = stimCtl();
    if (!st.video) return;
    const now = st.video.currentTime || 0;
    const total = Number.isFinite(st.video.duration) ? st.video.duration : 0;
    $('videoTime').textContent = `${now.toFixed(2)} / ${total.toFixed(2)} s`;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function showRgbProgress(ratio, text) {
    const box = $('rgbProgress');
    box.classList.remove('hidden');
    $('rgbProgressBar').style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    $('rgbProgressText').textContent = text;
  }
  function hideRgbProgress() {
    $('rgbProgress').classList.add('hidden');
  }

  /* --- sampling the stimulus colour under each gaze sample ---------------- */
  async function sampleStimulusColors() {
    const rgb = rgbCtl();
    const st = stimCtl();
    const frame = state.frame;
    if (!frame) return;
    if (st.kind === 'video' && (!st.video || st.video.readyState < 2)) return;
    const token = ++rgb.token;
    rgb.busy = true;
    const total = frame.samples.length;
    const packed = new Int32Array(total).fill(-1);
    let sampled = 0;
    let framesRead = 0;

    const indexList = [];
    for (let i = 0; i < total; i++) {
      const s = frame.samples[i];
      if (s.valid && Number.isFinite(s.x) && Number.isFinite(s.y)) indexList.push(i);
    }
    const screenW = frame.screen.w || 1920;
    const screenH = frame.screen.h || 1080;

    try {
      if (st.kind === 'video') {
        const buckets = new Map();
        for (const i of indexList) {
          const stimulusTime = Math.max(0, frame.samples[i].t + rgb.offsetMs);
          const bucket = Math.floor(stimulusTime / rgb.bucketMs);
          if (!buckets.has(bucket)) buckets.set(bucket, []);
          buckets.get(bucket).push(i);
        }
        const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
        const full = document.createElement('canvas');
        full.width = st.sampleW;
        full.height = st.sampleH;
        const fctx = full.getContext('2d', { willReadFrequently: true });
        showRgbProgress(0, `프레임 추출 0% (0/${keys.length})`);
        let done = 0;
        for (const key of keys) {
          if (token !== rgb.token) return;
          await seekVideo((key * rgb.bucketMs) / 1000);
          if (token !== rgb.token) return;
          if (!st.video || st.video.readyState < 2) continue;
          fctx.drawImage(st.video, 0, 0, full.width, full.height);
          const data = fctx.getImageData(0, 0, full.width, full.height).data;
          for (const i of buckets.get(key)) {
            const s = frame.samples[i];
            const px = clamp(Math.round((s.x / screenW) * (full.width - 1)), 0, full.width - 1);
            const py = clamp(Math.round((s.y / screenH) * (full.height - 1)), 0, full.height - 1);
            const off = (py * full.width + px) * 4;
            packed[i] = packRgb(data[off], data[off + 1], data[off + 2]);
            sampled += 1;
          }
          framesRead += 1;
          done += 1;
          showRgbProgress(done / keys.length, `프레임 추출 ${Math.round((done / keys.length) * 100)}% (${done}/${keys.length})`);
          await nextFrame();
        }
      } else {
        const src = st.image;
        if (!src) return;
        if (!st.imageData) {
          st.imageData = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
        }
        const data = st.imageData.data;
        const width = st.imageData.width;
        const height = st.imageData.height;
        for (const i of indexList) {
          const s = frame.samples[i];
          const px = clamp(Math.round((s.x / screenW) * (width - 1)), 0, width - 1);
          const py = clamp(Math.round((s.y / screenH) * (height - 1)), 0, height - 1);
          const off = (py * width + px) * 4;
          packed[i] = packRgb(data[off], data[off + 1], data[off + 2]);
          sampled += 1;
        }
        framesRead = 1;
      }
    } finally {
      if (token === rgb.token) {
        rgb.samples = packed;
        rgb.sampled = sampled;
        rgb.framesRead = framesRead;
        rgb.busy = false;
        hideRgbProgress();
        classifyRgb();
      }
    }
  }

  function classifyRgb() {
    const rgb = rgbCtl();
    const n = state.frame ? state.frame.samples.length : 0;
    const excluded = new Set();
    const perColor = rgb.colors.map((c) => ({ ...c, count: 0 }));
    if (rgb.enabled && rgb.samples && rgb.colors.length) {
      const tol2 = rgb.tolerance * rgb.tolerance;
      const samples = rgb.samples;
      for (let i = 0; i < n; i++) {
        const packed = samples[i];
        if (packed < 0) continue;
        const r = (packed >> 16) & 255;
        const g = (packed >> 8) & 255;
        const b = packed & 255;
        for (let k = 0; k < perColor.length; k++) {
          const c = perColor[k];
          const d2 = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (d2 <= tol2) {
            excluded.add(i);
            perColor[k].count += 1;
          }
        }
      }
    }
    rgb.excluded = excluded;
    rgb.perColor = perColor;
    if (state.frame) {
      const samples = state.frame.samples;
      for (let i = 0; i < samples.length; i++) samples[i].rgbExcluded = excluded.has(i);
    }
    renderRgbChips();
    renderRgbSummary();
    runAnalysis();
  }

  let reclassifyTimer = null;
  function scheduleReclassify() {
    clearTimeout(reclassifyTimer);
    reclassifyTimer = setTimeout(classifyRgb, 120);
  }

  /* --- UI pieces --------------------------------------------------------- */
  function renderRgbChips() {
    const box = $('rgbChips');
    if (!box) return;
    const rgb = rgbCtl();
    box.innerHTML = '';
    if (!rgb.colors.length) {
      box.innerHTML = '<span class="chips-empty">아직 지정한 색이 없습니다</span>';
      return;
    }
    rgb.colors.forEach((c, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const hit = rgb.perColor[index] ? rgb.perColor[index].count : 0;
      chip.innerHTML = `<i class="swatch" style="background:${rgbHex(c)}"></i><b>${rgbHex(c)}</b><small>${c.r}, ${c.g}, ${c.b}${
        rgb.enabled ? ` · ${hit.toLocaleString('ko-KR')}건` : ''
      }</small>`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-del';
      del.title = '이 색 제외 해제';
      del.setAttribute('aria-label', `${rgbHex(c)} 제거`);
      del.textContent = '×';
      del.addEventListener('click', () => {
        rgb.colors.splice(index, 1);
        classifyRgb();
      });
      chip.appendChild(del);
      box.appendChild(chip);
    });
  }

  function addRgbColor(color) {
    if (!color) return;
    const rgb = rgbCtl();
    if (rgb.colors.some((c) => c.r === color.r && c.g === color.g && c.b === color.b)) {
      toast(`${rgbHex(color)}은(는) 이미 목록에 있습니다.`);
      return;
    }
    rgb.colors.push(color);
    if (!rgb.enabled) setRgbEnabled(true);
    else if (!rgb.samples) sampleStimulusColors();
    else classifyRgb();
    toast(`${rgbHex(color)}을(를) 제외 목록에 추가했습니다.`);
  }

  function renderRgbSummary() {
    const rgb = rgbCtl();
    const enabled = rgb.enabled;
    $('rgbBadge').textContent = enabled
      ? `켜짐 · ${rgb.colors.length}색 · ±${rgb.tolerance}`
      : '꺼짐';
    $('rgbBadge').classList.toggle('live', enabled);
    const total = state.frame ? state.frame.samples.length : 0;
    const excluded = enabled ? rgb.excluded.size : 0;
    $('rgbExcludedSamples').textContent = enabled ? `${excluded.toLocaleString('ko-KR')}건` : '—';
    $('rgbExcludedRatio').textContent = enabled && total ? pct(excluded / total) : '—';
    const fix = state.analysis ? state.analysis.segments.filter((s) => s.type === 'fixation').length : 0;
    $('rgbFixations').textContent = state.analysis ? `${fix.toLocaleString('ko-KR')}회` : '—';
  }

  function renderRgbCompare(base, filtered) {
    const box = $('rgbCompare');
    if (!box) return;
    const rgb = rgbCtl();
    if (!rgb.enabled || !base || !filtered) {
      box.innerHTML = '<p class="rgb-empty">필터를 켜면 제외 전/후 비교가 여기에 표시됩니다.</p>';
      return;
    }
    const rows = [
      ['응시 횟수', mean(base.participants.map((p) => p.fixationCount)), mean(filtered.participants.map((p) => p.fixationCount)), 1],
      ['평균 응시(ms)', mean(base.participants.map((p) => p.fixationMean)), mean(filtered.participants.map((p) => p.fixationMean)), 0],
      ['도약 횟수', mean(base.participants.map((p) => p.saccadeCount)), mean(filtered.participants.map((p) => p.saccadeCount)), 1],
      ['도약 진폭(°)', mean(base.participants.map((p) => p.saccadeAmplitude)), mean(filtered.participants.map((p) => p.saccadeAmplitude)), 2],
    ];
    const body = rows
      .map(([label, a, b, digits]) => {
        const change = numberChange(a, b);
        return `<tr><td>${label}</td><td class="num">${fmt(a, digits)}</td><td class="num">${fmt(b, digits)}</td><td class="num ${change < -5 ? 'down' : change > 5 ? 'up' : ''}">${pct(change / 100, 1)}</td></tr>`;
      })
      .join('');
    box.innerHTML = `<table class="data mini rgb-table"><thead><tr><th>지표</th><th class="num">제외 전</th><th class="num">제외 후</th><th class="num">변화</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function numberChange(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return NaN;
    return ((after - before) / before) * 100;
  }

  function setEyedropper(on) {
    const rgb = rgbCtl();
    rgb.eyedropper = on;
    $('rgbEyedropper').setAttribute('aria-pressed', String(on));
    $('stimCanvas').classList.toggle('picking', on);
    $('stimNote').textContent = on
      ? '자극 위 색을 누르면 그 RGB가 제외 목록에 들어갑니다. (동영상은 원하는 프레임으로 이동한 뒤 누르세요)'
      : '동영상은 시선 시각에 맞는 프레임을 골라 읽습니다. 스포이드를 켜고 프레임을 누르면 그 색이 제외 목록에 들어갑니다.';
  }

  function pickColorAt(fx, fy) {
    const st = stimCtl();
    if (st.kind === 'video') {
      const video = st.video;
      if (!video || video.readyState < 2) return null;
      const canvas = document.createElement('canvas');
      canvas.width = st.sampleW;
      canvas.height = st.sampleH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const px = clamp(Math.round(fx * (canvas.width - 1)), 0, canvas.width - 1);
      const py = clamp(Math.round(fy * (canvas.height - 1)), 0, canvas.height - 1);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    }
    const src = st.image;
    if (!src) return null;
    if (!st.imageData) st.imageData = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
    const data = st.imageData.data;
    const px = clamp(Math.round(fx * (st.imageData.width - 1)), 0, st.imageData.width - 1);
    const py = clamp(Math.round(fy * (st.imageData.height - 1)), 0, st.imageData.height - 1);
    const off = (py * st.imageData.width + px) * 4;
    return { r: data[off], g: data[off + 1], b: data[off + 2] };
  }

  function setRgbEnabled(on) {
    const rgb = rgbCtl();
    rgb.enabled = on;
    $('rgbEnabled').checked = on;
    if (on && !rgb.samples) {
      sampleStimulusColors();
    } else {
      classifyRgb();
    }
    renderRgbSummary();
  }

  function initRgb() {
    const rgb = rgbCtl();
    rgb.colors = [{ r: 0, g: 0, b: 0 }];
    setSyntheticStimulus();
    renderRgbChips();
    renderRgbSummary();
    renderRgbCompare(null, null);
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

    // stimulus as the background so it is obvious where gaze was excluded
    const stim = stimCtl();
    if (stim.bg) {
      ctx.drawImage(stim.bg, 0, 0, W, H);
      ctx.fillStyle = 'rgba(250,249,245,0.10)';
      ctx.fillRect(0, 0, W, H);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(255,255,255,0.55)');
      grad.addColorStop(0.55, 'rgba(240,238,230,0.2)');
      grad.addColorStop(1, 'rgba(226,222,208,0.45)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    const idx = group.indices;
    const excluded = state.rgb.enabled ? state.rgb.excluded : null;

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
        if (excluded && excluded.has(i)) continue;
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
    const aois = state.analysis.aois;    ctx.font = '600 12px Inter, sans-serif';
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

    // where the filter removed gaze: small hollow crosses on the stimulus
    if (excluded && excluded.size) {
      const path = new Path2D();
      let count = 0;
      for (const i of idx) {
        if (!excluded.has(i)) continue;
        const s = frame.samples[i];
        const x = s.x * sx;
        const y = s.y * sy;
        path.moveTo(x - 3, y - 3);
        path.lineTo(x + 3, y + 3);
        path.moveTo(x + 3, y - 3);
        path.lineTo(x - 3, y + 3);
        count += 1;
        if (count >= 1600) break;
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(20,20,19,0.45)';
      ctx.stroke(path);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(250,249,245,0.95)';
      ctx.stroke(path);
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
    const excludedInGroup = excluded ? idx.filter((i) => excluded.has(i)).length : 0;
    $('canvasMeta').textContent = `${group.condition || '—'} · ${group.subject || 'all'} · ${fmt(group.duration || 0, 1)}초 · 응시 ${fixCount}회${
      state.rgb.enabled ? ` · 제외 ${excludedInGroup.toLocaleString('ko-KR')}샘플` : ''
    }`;
    const stimLabel = stim.kind === 'video' ? '동영상 자극' : stim.kind === 'image' ? '자극 이미지' : '합성 자극';
    $('canvasScreen').textContent = `${stimLabel} 배경 · ${Math.round(frame.screen.w)}×${Math.round(frame.screen.h)} 기준`;
    const legendExcluded = $('legendExcluded');
    if (legendExcluded) legendExcluded.classList.toggle('hidden', !(state.rgb.enabled && excluded && excluded.size));
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

  function buildBundle() {
    if (!state.analysis) return null;
    const { participants, aois, conditions, segments, pxPerDeg, config, base, transitions } = state.analysis;
    const rgb = state.rgb;
    const stim = stimCtl();
    const totalSamples = state.frame ? state.frame.samples.length : 0;
    const rgbPayload = rgb.colors.length
      ? {
          enabled: rgb.enabled,
          stimulus: {
            kind: stim.kind,
            name: stim.name,
            width: stim.kind === 'video' ? stim.sampleW : stim.image ? stim.image.width : null,
            height: stim.kind === 'video' ? stim.sampleH : stim.image ? stim.image.height : null,
            duration_ms: stim.durationMs || null,
          },
          exclude_rgb: rgb.colors.map((c) => ({ hex: rgbHex(c), rgb: [c.r, c.g, c.b] })),
          tolerance: rgb.tolerance,
          offset_ms: rgb.offsetMs,
          frame_bucket_ms: rgb.bucketMs,
          samples_total: totalSamples,
          samples_sampled: rgb.sampled,
          frames_read: rgb.framesRead,
          excluded_samples: rgb.enabled ? rgb.excluded.size : 0,
          excluded_ratio: rgb.enabled && totalSamples ? rgb.excluded.size / totalSamples : 0,
          excluded_by_color: rgb.perColor.map((c) => ({ hex: rgbHex(c), rgb: [c.r, c.g, c.b], samples: c.count })),
          before_after: base
            ? {
                fixation_count: {
                  before: mean(base.participants.map((p) => p.fixationCount)),
                  after: mean(participants.map((p) => p.fixationCount)),
                },
                fixation_mean_ms: {
                  before: mean(base.participants.map((p) => p.fixationMean)),
                  after: mean(participants.map((p) => p.fixationMean)),
                },
                saccade_amplitude_deg: {
                  before: mean(base.participants.map((p) => p.saccadeAmplitude)),
                  after: mean(participants.map((p) => p.saccadeAmplitude)),
                },
              }
            : null,
        }
      : null;
    const transitionPayload = transitions
      ? {
          aois: transitions.aois,
          counts: transitions.counts,
          probabilities: transitions.probabilities.map((row) => row.map((v) => round(v, 6))),
          by_condition: transitions.byCondition.map((row) => ({
            condition: row.condition,
            n_fixations: row.n_fixations,
            n_transitions: row.n_transitions,
            visited_aois: row.visited_aois,
            stationary_entropy_bits: round(row.stationary_entropy_bits, 4),
            transition_entropy_bits: round(row.transition_entropy_bits, 4),
            stationary_entropy_normalized: round(row.stationary_entropy_normalized, 4),
            transition_entropy_normalized: round(row.transition_entropy_normalized, 4),
          })),
          by_recording: transitions.byRecording.map((row) => ({
            ...row,
            stationary_entropy_bits: round(row.stationary_entropy_bits, 4),
            transition_entropy_bits: round(row.transition_entropy_bits, 4),
            stationary_entropy_normalized: round(row.stationary_entropy_normalized, 4),
            transition_entropy_normalized: round(row.transition_entropy_normalized, 4),
          })),
          pooled: {
            n_fixations: transitions.pooled.nFixations,
            n_transitions: transitions.pooled.nTransitions,
            visited_aois: transitions.pooled.visited,
            stationary_entropy_bits: round(transitions.pooled.stationaryEntropy, 4),
            transition_entropy_bits: round(transitions.pooled.transitionEntropy, 4),
            stationary_entropy_normalized: round(transitions.pooled.stationaryNorm, 4),
            transition_entropy_normalized: round(transitions.pooled.transitionNorm, 4),
          },
          note: transitions.note,
        }
      : null;
    return {
      schema: 'gazera.result.v1',
      schema_version: SCHEMA_VERSION,
      software_version: VERSION,
      generated_at: new Date().toISOString(),
      generator: `GAZERA web workbench ${VERSION}`,
      source: { file: state.fileName, synthetic: state.source === 'demo' },
      mapping: state.mapping,
      config: { velocity_threshold_deg_s: config.threshold, min_fixation_ms: config.minFixation, px_per_deg: pxPerDeg, aois },
      rgb_filter: rgbPayload,
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
        transitions: transitionPayload ? transitionPayload.pooled : null,
      },
      participants: participants.map((p) => ({
        subject: p.subject,
        trial: p.trial,
        condition: p.condition,
        duration_s: round(p.duration, 3),
        valid_ratio: round(p.validRatio, 4),
        fixation_count: p.fixationCount,
        fixation_total_ms: round(p.fixationTotal, 1),
        fixation_mean_ms: round(p.fixationMean, 1),
        fixation_median_ms: round(p.fixationMedian, 1),
        fixation_rate_per_s: round(p.fixationRate, 3),
        saccade_count: p.saccadeCount,
        saccade_amplitude_mean_deg: round(p.saccadeAmplitude, 3),
        saccade_peak_velocity_mean_deg_s: round(p.saccadePeak, 1),
        aoi_transition_count: p.aoiTransitionCount,
        aoi_stationary_entropy_bits: round(p.aoiStationaryEntropy, 4),
        aoi_transition_entropy_bits: round(p.aoiTransitionEntropy, 4),
        aois: p.aois,
      })),
      aoi: aois.map((a) => {
        const perCondition = {};
        for (const cond of conditions) {
          const list = participants.filter((p) => p.condition === cond);
          const ttffs = list.map((p) => p.aois[a.name]?.ttff).filter((v) => Number.isFinite(v));
          perCondition[cond] = {
            n: list.length,
            dwell_ms: mean(list.map((p) => p.aois[a.name]?.dwell || 0)),
            dwell_ratio: mean(list.map((p) => p.aois[a.name]?.ratio || 0)),
            visits: mean(list.map((p) => p.aois[a.name]?.visits || 0)),
            ttff_ms: ttffs.length ? mean(ttffs) : null,
          };
        }
        return { ...a, conditions: perCondition };
      }),
      transitions: transitionPayload,
      methodology: {
        version: VERSION,
        schema_version: SCHEMA_VERSION,
        note: 'measured = exported value; derived = deterministic formula on measured values; exploratory = assumption-dependent. None is a diagnosis.',
        boundaries: BOUNDARIES,
        references: REFERENCES,
        indicators: Object.fromEntries(METHODOLOGY.map((item) => [item.key, item])),
      },
      segments_by_recording: Object.fromEntries(
        Array.from(new Set(segments.map((s) => s.group))).map((key) => [key, segments.filter((s) => s.group === key).length])
      ),
      notices: {
        license: 'MIT License · Copyright (c) 2026 FEI · HEL Lab, Gyeongsang National University',
        affiliation: 'GAZERA is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Tobii AB.',
      },
    };
  }

  function round(value, digits) {
    return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
  }

  function downloadJson() {
    const payload = buildBundle();
    if (!payload) return;
    download(`gazera_report_${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`전체 보고서 JSON(schema ${SCHEMA_VERSION})을 내려받았습니다.`);
  }

  /* ------------------------------------------------------------- markdown */
  function mdCell(value, digits = 2) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(digits) : '—';
    return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  function markdownReport() {
    const bundle = buildBundle();
    if (!bundle) return '';
    const q = bundle.quality;
    const s = bundle.summary;
    const t = bundle.transitions;
    const cfg = bundle.config;
    const lines = [];
    lines.push(`# GAZERA 분석 보고서 — ${bundle.source.file}`);
    lines.push('');
    lines.push(`**FEI · HEL Lab, 경상국립대학교** · v${VERSION} (schema_version ${SCHEMA_VERSION})  `);
    lines.push(`생성: ${new Date(bundle.generated_at).toLocaleString('ko-KR')} · 100% 로컬 실행 · MIT License`);
    lines.push('');
    lines.push('> 연구용 분석 보고서입니다. 실측(measured) · 파생(derived) · 탐색(exploratory) 지표를 구분해 표시하며, 어떤 값도 임상 진단이 아닙니다. GAZERA는 Tobii AB와 제휴·후원·보증 관계가 없는 독립 프로젝트입니다.');
    lines.push('');
    lines.push('## 1. 데이터와 설정');
    lines.push('');
    lines.push('| 항목 | 값 |');
    lines.push('| --- | --- |');
    lines.push(`| 원본 파일 | ${mdCell(bundle.source.file)}${bundle.source.synthetic ? ' (100% 합성 데모)' : ''} |`);
    lines.push(`| 행 수 | ${s.rows.toLocaleString('ko-KR')} |`);
    lines.push(`| recording 수 | ${s.recordings} |`);
    lines.push(`| 조건 | ${mdCell(s.conditions.join(', '))} |`);
    lines.push(`| I-VT 임계값 | ${cfg.velocity_threshold_deg_s} °/s |`);
    lines.push(`| 최소 응시시간 | ${cfg.min_fixation_ms} ms |`);
    lines.push(`| px/deg | ${mdCell(cfg.px_per_deg)} |`);
    lines.push(`| AOI | ${cfg.aois.map((a) => a.name).join(', ')} |`);
    lines.push('');
    lines.push('## 2. 데이터 품질');
    lines.push('');
    lines.push('| 지표 | 값 | 경계 |');
    lines.push('| --- | --- | --- |');
    lines.push(`| 유효 시선 비율 | ${(q.validRatio * 100).toFixed(2)}% | derived |`);
    lines.push(`| 결측 좌표 비율 | ${(q.missingRatio * 100).toFixed(2)}% | derived |`);
    lines.push(`| 추정 샘플링 | ${q.hz ? `${q.hz.toFixed(1)} Hz` : '—'} | derived |`);
    if (bundle.rgb_filter) {
      lines.push(`| RGB 제외 | ${bundle.rgb_filter.excluded_samples.toLocaleString('ko-KR')} 샘플 (${(bundle.rgb_filter.excluded_ratio * 100).toFixed(2)}%) | derived |`);
    }
    if (q.warnings && q.warnings.length) {
      lines.push('');
      lines.push('**경고**');
      lines.push('');
      q.warnings.forEach((w) => lines.push(`- ${w}`));
    }
    lines.push('');
    lines.push('## 3. 응시·도약 요약 (recording 평균)');
    lines.push('');
    lines.push('| 지표 | 값 | 단위 | 경계 |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(`| 응시 횟수 | ${mdCell(s.fixation.count, 1)} | count | derived |`);
    lines.push(`| 평균 응시시간 | ${mdCell(s.fixation.mean_ms, 1)} | ms | derived |`);
    lines.push(`| 도약 횟수 | ${mdCell(s.saccade.count, 1)} | count | derived |`);
    lines.push(`| 도약 평균 진폭 | ${mdCell(s.saccade.mean_amplitude_deg, 2)} | degree | derived |`);
    lines.push('');
    lines.push('## 4. AOI 지표 (조건 평균)');
    lines.push('');
    lines.push('| 조건 | AOI | 체류(ms) | 비율(%) | 방문 | TTFF(ms) |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    bundle.aoi.forEach((aoi) => {
      Object.entries(aoi.conditions).forEach(([condition, row]) => {
        lines.push(`| ${mdCell(condition)} | ${mdCell(aoi.name)} | ${mdCell(row.dwell_ms, 1)} | ${mdCell(row.dwell_ratio * 100, 2)} | ${mdCell(row.visits, 1)} | ${mdCell(row.ttff_ms, 1)} |`);
      });
    });
    lines.push('');
    lines.push('## 5. AOI 전이와 시선 엔트로피');
    lines.push('');
    if (t) {
      lines.push(`- AOI 안 응시 **${t.pooled.n_fixations}** · 전이 **${t.pooled.n_transitions}** · 방문 AOI **${t.pooled.visited_aois}/${t.aois.length}**`);
      lines.push(`- 정지 엔트로피 **${mdCell(t.pooled.stationary_entropy_bits, 3)} bits** · 전이 엔트로피 **${mdCell(t.pooled.transition_entropy_bits, 3)} bits** (정규화 ${mdCell(t.pooled.stationary_entropy_normalized, 3)} · ${mdCell(t.pooled.transition_entropy_normalized, 3)})`);
      lines.push('');
      lines.push(`| from \\ to | ${t.aois.map(mdCell).join(' | ')} |`);
      lines.push(`| --- | ${t.aois.map(() => '---').join(' | ')} |`);
      t.probabilities.forEach((row, i) => {
        lines.push(`| ${mdCell(t.aois[i])} → | ${row.map((v) => mdCell(v, 3)).join(' | ')} |`);
      });
      lines.push('');
      lines.push('| 조건 | 전이 수 | 정지 엔트로피(bits) | 전이 엔트로피(bits) | 전이 정규화 |');
      lines.push('| --- | --- | --- | --- | --- |');
      t.by_condition.forEach((row) => {
        lines.push(`| ${mdCell(row.condition)} | ${row.n_transitions} | ${mdCell(row.stationary_entropy_bits, 3)} | ${mdCell(row.transition_entropy_bits, 3)} | ${mdCell(row.transition_entropy_normalized, 3)} |`);
      });
      lines.push('');
      lines.push(t.note);
    } else {
      lines.push('_(AOI 전이 없음)_');
    }
    lines.push('');
    lines.push('## 6. 조건 간 비교 (기술통계 · Cohen\'s d)');
    lines.push('');
    const conditions = s.conditions;
    const metrics = [
      ['응시 횟수', (p) => p.fixation_count, 1],
      ['평균 응시(ms)', (p) => p.fixation_mean_ms, 0],
      ['도약 횟수', (p) => p.saccade_count, 1],
      ['도약 진폭(°)', (p) => p.saccade_amplitude_mean_deg, 2],
      ['정지 엔트로피(bits)', (p) => p.aoi_stationary_entropy_bits, 3],
      ['전이 엔트로피(bits)', (p) => p.aoi_transition_entropy_bits, 3],
    ];
    if (conditions.length >= 2) {
      const [a, b] = conditions;
      const listA = bundle.participants.filter((p) => p.condition === a);
      const listB = bundle.participants.filter((p) => p.condition === b);
      lines.push(`| 지표 | ${mdCell(a)} (n=${listA.length}) | ${mdCell(b)} (n=${listB.length}) | Cohen's d |`);
      lines.push('| --- | --- | --- | --- |');
      metrics.forEach(([label, get, digits]) => {
        const va = listA.map(get);
        const vb = listB.map(get);
        lines.push(`| ${label} | ${mdCell(mean(va), digits)} | ${mdCell(mean(vb), digits)} | ${mdCell(cohensD(va, vb), 2)} |`);
      });
      lines.push('');
      lines.push('웹 워크벤치는 기술통계와 Cohen\'s d를 보여 줍니다. p-value·정규성 판정·Holm 보정이 포함된 추론 통계는 Python 엔진(`gazera analyze`)의 보고서를 쓰세요.');
    } else {
      lines.push('_(조건이 2개 이상이어야 비교합니다)_');
    }
    lines.push('');
    lines.push('## 7. 지표 정의 · 근거 · 경계');
    lines.push('');
    lines.push('| 구분 | 지표 | 단위 | 수식 | 경계 |');
    lines.push('| --- | --- | --- | --- | --- |');
    METHODOLOGY.forEach((item) => {
      lines.push(`| ${item.kind} | ${mdCell(item.label)} | ${mdCell(item.unit)} | ${mdCell(item.formula)} | ${mdCell(item.boundary)} |`);
    });
    lines.push('');
    Object.values(BOUNDARIES).forEach((item) => lines.push(`- **${item.label}** — ${item.text}`));
    lines.push('');
    lines.push('### 참고문헌');
    lines.push('');
    Object.values(REFERENCES).forEach((ref) => lines.push(`- ${ref}`));
    lines.push('');
    lines.push('## 8. 고지와 인용');
    lines.push('');
    lines.push('- 데이터: 합성 데모는 100% 자체 생성이며 실제 피험자 정보가 없습니다. 업로드한 파일은 브라우저 안에서만 처리됩니다.');
    lines.push('- 라이선스: MIT License · Copyright (c) 2026 FEI · HEL Lab, Gyeongsang National University.');
    lines.push('- GAZERA는 Tobii AB와 제휴·후원·보증 관계가 없는 독립 오픈소스 프로젝트입니다. 모든 제품명·상표는 각 소유자에게 있습니다.');
    lines.push('');
    lines.push(`> FEI · HEL Lab (2026). GAZERA: Intelligent Eye-Tracking Data Analytics (Version ${VERSION}) [Computer software]. Gyeongsang National University. MIT License.`);
    lines.push('');
    return lines.join('\n');
  }

  function exportMd() {
    if (!state.analysis) return;
    download(`gazera_report_${dateStamp()}.md`, markdownReport(), 'text/markdown;charset=utf-8');
    toast('Markdown 분석 보고서를 내려받았습니다.');
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
      state.rgb.samples = null;
      state.rgb.excluded = new Set();
      renderQuality();
      renderFileMeta();
      if (state.rgb.enabled) sampleStimulusColors();
      else runAnalysis();
    } catch (err) {
      // required columns not chosen yet: keep the page calm instead of toasting
      state.frame = null;
      state.quality = null;
      $('runBtn').disabled = true;
      $('mapStatus').textContent = '시선 X · Y를 지정하면 분석됩니다';
      ['qRows', 'qValid', 'qHz', 'qMissing'].forEach((id) => { $(id).textContent = '—'; });
      $('warningList').innerHTML = '';
      renderFileMeta();
      clearResults('시선 X · Y 열을 지정하면 분석이 시작됩니다.');
    }
  }

  function baselineAnalysis(config, aois) {
    const key = `${config.threshold}|${config.minFixation}|${aois
      .map((a) => `${a.name}:${a.x},${a.y},${a.w},${a.h}`)
      .join(';')}`;
    const frame = state.frame;
    if (frame._baseline && frame._baseline.key === key) return frame._baseline.value;
    const { segments, pxPerDeg } = classifyIvt(frame, config, null);
    const participants = computeMetrics(frame, segments, aois, pxPerDeg);
    const value = { segments, participants, pxPerDeg };
    frame._baseline = { key, value };
    return value;
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
      const excluded = state.rgb.enabled ? state.rgb.excluded : EMPTY_SET;
      const { segments, pxPerDeg } = classifyIvt(state.frame, config, excluded);
      const participants = computeMetrics(state.frame, segments, aois, pxPerDeg);
      const transitions = computeTransitions(segments, aois, state.frame.screen);
      const conditions = Array.from(new Set(participants.map((p) => p.condition)));
      const base = state.rgb.enabled ? baselineAnalysis(config, aois) : null;
      state.analysis = { segments, participants, aois, conditions, pxPerDeg, config, base, excludedSize: excluded.size, transitions };

      $('resultCount').textContent = `${participants.length} recordings · ${segments.filter((s) => s.type === 'fixation').length.toLocaleString('ko-KR')} fixations`;
      const rgbNote = state.rgb.enabled
        ? ` · RGB 제외 ${excluded.size.toLocaleString('ko-KR')}샘플${
            state.frame.samples.length ? ` (${pct(excluded.size / state.frame.samples.length)})` : ''
          }`
        : '';
      $('resultSub').textContent = `${state.fileName || '데이터'} · I-VT ${config.threshold}°/s · 최소 응시 ${config.minFixation}ms · px/deg ${pxPerDeg.toFixed(1)}${rgbNote}`;
      renderKpis();
      renderAoiTable();
      renderStatsTable();
      renderParticipantsTable();
      renderTransitions();
      renderPreviewSelectors();
      renderRgbSummary();
      renderRgbCompare(base, state.analysis);
      drawCanvas();
      $('dlCsv').disabled = false;
      $('dlJson').disabled = false;
      if ($('dlMd')) $('dlMd').disabled = false;
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
      state.rgb.samples = null;
      state.rgb.excluded = new Set();
      renderRgbSummary();
      renderRgbCompare(null, null);
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
    if ($('dlMd')) $('dlMd').addEventListener('click', exportMd);

    /* --- stimulus upload + RGB filter ---------------------------------- */
    const stimInput = $('stimInput');
    const stimDrop = $('stimDropzone');
    stimDrop.addEventListener('click', () => stimInput.click());
    stimDrop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        stimInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((ev) =>
      stimDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        stimDrop.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach((ev) =>
      stimDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        stimDrop.classList.remove('dragover');
      })
    );
    stimDrop.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const file = dt && dt.files && dt.files[0];
      if (file) loadStimulusFile(file);
    });
    stimInput.addEventListener('change', () => {
      if (stimInput.files && stimInput.files[0]) loadStimulusFile(stimInput.files[0]);
      stimInput.value = '';
    });
    $('stimReset').addEventListener('click', () => {
      setSyntheticStimulus();
      toast('합성 자극으로 되돌렸습니다.');
    });

    $('videoPlay').addEventListener('click', toggleVideoPlay);
    $('videoSeek').addEventListener('input', (e) => {
      const st = stimCtl();
      if (!st.video) return;
      st.video.pause();
      $('videoPlay').textContent = '▶';
      seekVideo(Number(e.target.value) / 1000).then(() => {
        renderStimPreview();
        updateVideoTime();
      });
    });

    $('rgbEnabled').addEventListener('change', (e) => setRgbEnabled(e.target.checked));
    $('rgbTol').addEventListener('input', (e) => {
      state.rgb.tolerance = Number(e.target.value);
      $('rgbTolVal').textContent = e.target.value;
      if (state.rgb.enabled) scheduleReclassify();
    });
    let offsetTimer = null;
    $('rgbOffset').addEventListener('input', (e) => {
      const value = Number(e.target.value) || 0;
      state.rgb.offsetMs = value;
      $('rgbOffsetVal').textContent = String(value);
      clearTimeout(offsetTimer);
      offsetTimer = setTimeout(() => {
        if (state.rgb.enabled) sampleStimulusColors();
      }, 350);
    });
    let bucketTimer = null;
    $('rgbBucket').addEventListener('input', (e) => {
      const value = Number(e.target.value);
      state.rgb.bucketMs = value;
      $('rgbBucketVal').textContent = String(value);
      clearTimeout(bucketTimer);
      bucketTimer = setTimeout(() => {
        if (state.rgb.enabled) sampleStimulusColors();
      }, 400);
    });

    const submitColor = () => {
      const color = parseRgbInput($('rgbInput').value);
      if (!color) {
        toast('색을 읽을 수 없습니다. #000000 또는 0,0,0 형식으로 넣어 주세요.');
        return;
      }
      addRgbColor(color);
      $('rgbInput').value = '';
    };
    $('rgbAdd').addEventListener('click', submitColor);
    $('rgbInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitColor();
      }
    });
    document.querySelectorAll('.chip-btn[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => addRgbColor(parseRgbInput(btn.dataset.color)));
    });
    $('rgbEyedropper').addEventListener('click', () => setEyedropper(!state.rgb.eyedropper));

    const stimCanvas = $('stimCanvas');
    const canvasPoint = (event) => {
      const rect = stimCanvas.getBoundingClientRect();
      return {
        fx: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        fy: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      };
    };
    stimCanvas.addEventListener('click', (event) => {
      if (!state.rgb.eyedropper) return;
      const { fx, fy } = canvasPoint(event);
      const color = pickColorAt(fx, fy);
      if (!color) {
        toast('이 프레임에서 색을 읽을 수 없습니다. 재생 위치를 옮겨 보세요.');
        return;
      }
      addRgbColor(color);
      setEyedropper(false);
    });
    stimCanvas.addEventListener('mousemove', (event) => {
      if (!state.rgb.eyedropper) return;
      const { fx, fy } = canvasPoint(event);
      const color = pickColorAt(fx, fy);
      if (color) $('stimNote').textContent = `스포이드 · ${rgbHex(color)} (${color.r}, ${color.g}, ${color.b}) — 누르면 제외 목록에 추가됩니다`;
    });

    window.addEventListener('resize', () => {
      // canvas is fixed-size; CSS scales it, nothing to redraw
    });
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    bind();
    initRgb();
    renderAoiEditor(BANDS);
    renderMethodology();
    try {
      loadDemo();
    } catch (err) {
      console.error(err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // exposed for verification in the live page
  window.GAZERA = {
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    state,
    loadDemo,
    runAnalysis,
    computeMetrics,
    computeTransitions,
    entropyStatsFromLabels,
    buildBundle,
    markdownReport,
    methodology: METHODOLOGY,
  };
})();
