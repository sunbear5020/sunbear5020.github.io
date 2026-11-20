/* =============================================================================
   HEARTMETRIC — browser workbench · v0.2.0
   Clean-room, MIT · FEI · HEL Lab, Gyeongsang National University
   -----------------------------------------------------------------------------
   Everything here runs locally in the browser. No network calls, no uploads.
   The definitions mirror heartmetric_core (Python) so both produce the same
   numbers from the same file and the same tolerance:

     loader   → parseDelimited / mapHeaders / standardize / parseTime
     cleaner  → cleanRows
     metrics  → addDerived / environmentalLoad / dipping / hrvRecovery / stressIndex
     align    → alignStreams (greedy nearest match, daily aggregation)
     stats    → welch / pairedT / cohensDz / permutationP / signTest / subjectPairs
     corr     → pearson / spearman / olsRegression
     export   → buildBundle (schema 0.2.0) / markdownReport / cleaned CSV

   The demonstration series is generated in this file (100 % synthetic).
   ========================================================================== */
(() => {
  'use strict';

  const VERSION = '0.2.0';
  const SCHEMA_VERSION = '0.2.0';
  const NIGHT = { start: 22, end: 6 };

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------------------------------------------------------------- utils */
  const num = (v) => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v).trim().replace(/,/g, '').replace(/\s/g, '');
    if (!s || s === '-' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const fmt = (v, digits = 1) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('ko-KR');
    return Number(v).toFixed(digits);
  };
  const pctText = (v, digits = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '—');
  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN);
  const sd = (arr) => {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
  };
  const values = (rows, key) => rows.map((r) => r[key]).filter((v) => Number.isFinite(v));
  const round = (value, digits = 3) => {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };

  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (v) => (v instanceof Date && !isNaN(v) ? v : null);
  const fmtDate = (d) => (toDate(d) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '—');
  const fmtStamp = (d) => (toDate(d) ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '—');
  const fmtShort = (d) => (toDate(d) ? `${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : '—');
  const dayKey = (d) => (toDate(d) ? fmtDate(d) : '');

  const fmtP = (p) => {
    if (!Number.isFinite(p)) return '—';
    if (p < 0.0001) return '<0.0001';
    if (p < 0.001) return p.toFixed(4);
    return p.toFixed(3);
  };

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  const escapeHtml = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ------------------------------------------------------------- randomness */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const uniform = mulberry32(seed);
    return {
      uniform,
      normal(mu = 0, sigma = 1) {
        const u = Math.max(1e-9, uniform());
        const v = uniform();
        return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
    };
  }

  /* ---------------------------------------------------------------- schema */
  const SUBJECT = 'subject_id';
  const METRIC_COLUMNS = [
    'sbp', 'dbp', 'hr', 'rmssd', 'sdnn', 'temp_c', 'humidity_pct',
    'pm25', 'pm10', 'green_index', 'forest', 'steps',
  ];
  const STANDARD_COLUMNS = ['timestamp', SUBJECT, 'source', 'condition', ...METRIC_COLUMNS, 'activity', 'flags', 'notes'];
  const DERIVED_COLUMNS = ['map', 'pp', 'env_load'];

  const ALIASES = {
    timestamp: ['timestamp', 'datetime', 'date time', 'date', 'time', 'start', 'startdate', 'start date',
      'starttime', 'enddate', 'recordedat', 'recorded at', 'measuredat', 'measurement time', 'day',
      'summarydate', 'bedtime start', 'bedtime_start', '측정일', '측정시각', '일시', '날짜', '시간', '측정일시'],
    subject_id: ['subject id', 'subject', 'subjectid', 'participant', 'participant id', 'participantid',
      'participant code', 'person id', 'person', 'record id', 'user id', 'userid',
      '피험자', '피험자id', '피험자번호', '대상자', '대상자id', '참가자', '참가자id', '연구대상'],
    source: ['source', 'device', 'app', 'vendor', '출처', '기기'],
    condition: ['condition', 'group', 'phase', 'condition name', 'segment', 'protocol', 'intervention',
      'activity type', '환경', '조건', '구간', '그룹'],
    sbp: ['sbp', 'systolic', 'systolic bp', 'systolic blood pressure', 'systolicpressure', 'systolic mmhg',
      'bpx systole', 'highest blood pressure', '수축기', '수축기혈압', '최고혈압'],
    dbp: ['dbp', 'diastolic', 'diastolic bp', 'diastolic blood pressure', 'diastolicpressure', 'diastolic mmhg',
      'bpx diastole', 'lowest blood pressure', '이완기', '이완기혈압', '최저혈압'],
    hr: ['hr', 'heart rate', 'heartrate', 'pulse', 'pulse rate', 'bpm', 'pulse bpm', 'average heart rate',
      'averageheartrate', 'mean heart rate', 'resting heart rate', 'restingheartrate', 'lowest heart rate',
      '심박수', '맥박', '심박', '평균심박수'],
    rmssd: ['rmssd', 'rmssd ms', 'rmssdms', 'hrv', 'hrv ms', 'hrvms', 'average hrv', 'averagehrv', 'hrv rmssd',
      '심박변이도', '에이치알브이'],
    sdnn: ['sdnn', 'sdnn ms', 'sdnnms', 'hrv sdnn', '심박변이도sdnn'],
    temp_c: ['temp', 'temperature', 'temp c', 'tempc', 'air temp', 'airtemperature', 'ambient temperature',
      '기온', '온도'],
    humidity_pct: ['humidity', 'rh', 'relative humidity', 'humidity pct', '습도'],
    pm25: ['pm25', 'pm2 5', 'pm2.5', 'pm 2.5', 'pm25 ugm3', 'fine dust', '초미세먼지'],
    pm10: ['pm10', 'pm 10', 'pm10 ugm3', '미세먼지'],
    green_index: ['green index', 'greenindex', 'ndvi', 'greenness', 'green ratio', '녹지지수', '녹지율'],
    forest: ['forest', 'forest flag', 'is forest', 'forestflag', 'canopy', 'canopy cover', '산림', '숲', '산림여부'],
    activity: ['activity', 'activity type', 'posture', 'state', '활동', '활동유형', '자세'],
    steps: ['steps', 'step count', 'stepcount', '걸음수', '걸음'],
    flags: ['flags', 'qc', 'quality', 'note', 'notes', '메모', '비고'],
  };

  const METRIC_NAME_ALIASES = ['type', 'metric', 'metric name', 'quantity type', 'quantitytype', 'hk type',
    'hktype', 'variable', 'field', 'item', '측정항목', '항목', '지표'];
  const VALUE_ALIASES = ['value', 'val', 'measurement', 'reading', '값', '측정값', '수치'];
  const METRIC_NAME_MAP = {
    systolic: 'sbp', systolicbloodpressure: 'sbp', sbp: 'sbp',
    hkquantitytypeidentifierbloodpressuresystolic: 'sbp',
    diastolic: 'dbp', diastolicbloodpressure: 'dbp', dbp: 'dbp',
    hkquantitytypeidentifierbloodpressurediastolic: 'dbp',
    heartrate: 'hr', hr: 'hr', pulse: 'hr', hkquantitytypeidentifierheartrate: 'hr',
    restingheartrate: 'hr', hkquantitytypeidentifierrestingheartrate: 'hr',
    heartratevariabilityrmssd: 'rmssd', rmssd: 'rmssd',
    hkquantitytypeidentifierheartratevariabilityrmssd: 'rmssd',
    heartratevariabilitysdnn: 'sdnn', sdnn: 'sdnn',
    hkquantitytypeidentifierheartratevariabilitysdnn: 'sdnn',
    stepcount: 'steps', steps: 'steps', hkquantitytypeidentifierstepcount: 'steps',
  };

  const CONDITION_VALUES = {
    urban: 'urban', city: 'urban', street: 'urban', 도시: 'urban', 도심: 'urban', 가로: 'urban', 시가지: 'urban',
    forest: 'forest', foresthealing: 'forest', healingforest: 'forest', 숲: 'forest', 산림: 'forest',
    산림치유: 'forest', 치유의숲: 'forest', 숲길: 'forest',
    rest: 'rest', resting: 'rest', baseline: 'rest', 휴식: 'rest', 안정: 'rest', 기저: 'rest',
    indoor: 'indoor', 실내: 'indoor', outdoor: 'outdoor', 야외: 'outdoor',
  };

  const normKey = (name) => String(name == null ? '' : name).trim().toLowerCase()
    .replace(/°c|℃/g, 'c').replace(/[^0-9a-z가-힣]+/g, '');

  const ALIAS_LOOKUP = {};
  Object.entries(ALIASES).forEach(([canonical, list]) => {
    ALIAS_LOOKUP[normKey(canonical)] = canonical;
    list.forEach((alias) => { if (!(normKey(alias) in ALIAS_LOOKUP)) ALIAS_LOOKUP[normKey(alias)] = canonical; });
  });

  const CONDITION_LOOKUP = {};
  Object.entries(CONDITION_VALUES).forEach(([label, code]) => { CONDITION_LOOKUP[normKey(label)] = code; });

  const canonicalColumn = (name) => ALIAS_LOOKUP[normKey(name)] || null;
  const canonicalMetricName = (value) => METRIC_NAME_MAP[normKey(value)] || null;
  function normalizeCondition(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || /^(nan|none|null|-)$/i.test(text)) return null;
    return CONDITION_LOOKUP[normKey(text)] || text.toLowerCase().replace(/\s+/g, '_');
  }
  function normalizeSubject(value) {
    if (value === null || value === undefined) return null;
    let text = String(value).trim();
    if (!text || /^(nan|none|null|-|<na>)$/i.test(text)) return null;
    if (/^\d+\.0$/.test(text)) text = text.slice(0, -2);
    return text;
  }

  const PHYSIO_RANGES = {
    sbp: [60, 260], dbp: [30, 160], hr: [25, 220], rmssd: [1, 300], sdnn: [1, 400],
    temp_c: [-40, 55], humidity_pct: [0, 100], pm25: [0, 1000], pm10: [0, 1500],
    green_index: [0, 1], forest: [0, 1], steps: [0, 100000],
  };

  const METRIC_LABELS = {
    sbp: 'SBP', dbp: 'DBP', map: 'MAP', pp: '맥압', hr: 'HR', rmssd: 'RMSSD', sdnn: 'SDNN',
    pm25: 'PM2.5', pm10: 'PM10', temp_c: '기온', green_index: '녹지', humidity_pct: '습도',
    env_load: '환경부하', forest: '산림', steps: '걸음',
  };

  const KIND_LABELS = { measured: 'measured · 실측', derived: 'derived · 파생', exploratory: 'exploratory · 탐색' };

  /* ----------------------------------------------------------- csv parsing */
  function parseDelimited(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delimiter = firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',';

    const records = [];
    let field = '';
    let row = [];
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === delimiter) { row.push(field); field = ''; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        row.push(field); field = '';
        if (row.some((cell) => cell.trim() !== '')) records.push(row);
        row = [];
        continue;
      }
      field += ch;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) records.push(row); }
    if (!records.length) return { headers: [], rows: [] };

    const headers = records[0].map((h) => h.trim());
    const rows = records.slice(1).map((cells) => {
      const object = {};
      headers.forEach((header, index) => { object[header] = cells[index] === undefined ? '' : cells[index]; });
      return object;
    });
    return { headers, rows };
  }

  /* --------------------------------------------------------------- loading */
  function parseTime(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;
    if (/^\d{9,13}$/.test(raw)) {
      const n = Number(raw);
      const ms = raw.length >= 12 ? n : n * 1000;
      const d = new Date(ms);
      return isNaN(d) ? null : d;
    }
    const iso = raw.replace(' ', 'T').replace(/\s+(UTC|GMT)$/i, 'Z');
    let d = new Date(iso);
    if (!isNaN(d)) return d;
    d = new Date(raw);
    return isNaN(d) ? null : d;
  }

  function mapHeaders(headers) {
    const mapping = {};
    const unmapped = [];
    headers.forEach((header) => {
      const canonical = canonicalColumn(header);
      if (canonical && !(canonical in mapping)) mapping[canonical] = header;
      else unmapped.push(header);
    });
    return { mapping, unmapped };
  }

  function standardize(record, mapping) {
    const out = {};
    Object.entries(mapping).forEach(([canonical, raw]) => { out[canonical] = record[raw]; });
    STANDARD_COLUMNS.forEach((column) => { if (!(column in out)) out[column] = null; });
    out.timestamp = parseTime(out.timestamp);
    out.subject_id = normalizeSubject(out.subject_id);
    out.condition = normalizeCondition(out.condition);
    METRIC_COLUMNS.forEach((column) => { out[column] = num(out[column]); });
    out.activity = out.activity ? String(out.activity) : null;
    if (!out.source) out.source = 'upload';
    return out;
  }

  function pivotLong(records, headers) {
    const nameHeader = headers.find((h) => METRIC_NAME_ALIASES.map(normKey).includes(normKey(h)));
    const valueHeader = headers.find((h) => VALUE_ALIASES.map(normKey).includes(normKey(h)));
    if (!nameHeader || !valueHeader) return null;
    const usable = records.filter((r) => canonicalMetricName(r[nameHeader]));
    if (!usable.length) return null;

    const timeHeader = headers.find((h) => canonicalColumn(h) === 'timestamp');
    const conditionHeader = headers.find((h) => canonicalColumn(h) === 'condition');
    const subjectHeader = headers.find((h) => canonicalColumn(h) === SUBJECT);
    if (!timeHeader) return null;

    const buckets = new Map();
    usable.forEach((record) => {
      const time = parseTime(record[timeHeader]);
      if (!time) return;
      const subject = subjectHeader ? normalizeSubject(record[subjectHeader]) : null;
      const key = time.toISOString() + '|' + (conditionHeader ? String(record[conditionHeader]) : '') + '|' + (subject || '');
      if (!buckets.has(key)) {
        buckets.set(key, {
          timestamp: time,
          subject_id: subject,
          condition: conditionHeader ? normalizeCondition(record[conditionHeader]) : null,
        });
      }
      const metric = canonicalMetricName(record[nameHeader]);
      const value = num(record[valueHeader]);
      if (Number.isFinite(value)) buckets.get(key)[metric] = value;
    });
    return { rows: [...buckets.values()], pivot: true };
  }

  const applyUnits = (rows, warnings) => {
    const max = (key) => {
      const list = values(rows, key);
      return list.length ? Math.max(...list) : null;
    };
    const sbpMax = max('sbp');
    const dbpMax = max('dbp');
    if (sbpMax !== null && sbpMax > 0 && sbpMax < 40 && (dbpMax === null || dbpMax < 30)) {
      rows.forEach((r) => { r.sbp *= 7.50062; r.dbp *= 7.50062; });
      warnings.push('혈압이 kPa로 보여 mmHg로 변환했습니다 (×7.50062)');
    }
    const tempMax = max('temp_c');
    if (tempMax !== null && tempMax > 60 && tempMax < 130) {
      rows.forEach((r) => { if (Number.isFinite(r.temp_c)) r.temp_c = (r.temp_c - 32) * 5 / 9; });
      warnings.push('기온이 °F로 보여 °C로 변환했습니다');
    }
    ['rmssd', 'sdnn'].forEach((key) => {
      const list = values(rows, key);
      if (list.length && Math.max(...list) <= 1.5 && Math.max(...list) > 0) {
        rows.forEach((r) => { if (Number.isFinite(r[key])) r[key] *= 1000; });
        warnings.push(`${key.toUpperCase()}가 초 단위로 보여 ms로 변환했습니다`);
      }
    });
    const green = values(rows, 'green_index');
    if (green.length && Math.max(...green) > 1 && Math.max(...green) <= 100) {
      rows.forEach((r) => { if (Number.isFinite(r.green_index)) r.green_index /= 100; });
      warnings.push('녹지지수가 0–100 스케일로 보여 0–1로 바꿨습니다');
    }
    return rows;
  };

  function finalizeRows(rows, warnings) {
    const kept = rows.filter((r) => r.timestamp instanceof Date);
    if (kept.length !== rows.length) warnings.push(`${rows.length - kept.length}개 행에 시각이 없어 제외했습니다`);
    kept.sort((a, b) => a.timestamp - b.timestamp);
    return kept;
  }

  function loadJson(text, name, warnings) {
    const payload = JSON.parse(text);
    let records = [];
    if (Array.isArray(payload)) records = payload;
    else if (payload && typeof payload === 'object') {
      const key = ['data', 'records', 'readings', 'measurements', 'items', 'results', 'samples']
        .find((k) => Array.isArray(payload[k]));
      if (key) records = payload[key];
      else records = [payload];
    }
    records = records.filter((r) => r && typeof r === 'object');
    if (!records.length) throw new Error('JSON에서 레코드를 찾지 못했습니다');

    const headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
    const { mapping, unmapped } = mapHeaders(headers);

    const ouraLike = 'average_hrv' in records[0] || 'average_heart_rate' in records[0];
    let rows;
    if (ouraLike) {
      rows = records.map((record) => ({
        timestamp: parseTime(record.bedtime_start || (record.day ? `${record.day} 03:00:00` : null)),
        subject_id: normalizeSubject(record.subject_id || record.subject || record.participant),
        source: 'oura',
        condition: normalizeCondition(record.condition),
        hr: num(record.average_heart_rate !== undefined ? record.average_heart_rate : record.resting_heart_rate),
        rmssd: num(record.average_hrv),
        sdnn: num(record.sdnn),
        pm25: num(record.pm25),
        temp_c: num(record.temp_c),
      }));
      warnings.push('Oura 야간 집계는 해당 day의 03:00으로 배치했습니다 (박동 단위 데이터는 없습니다)');
    } else {
      const pivot = pivotLong(records, headers);
      rows = pivot ? pivot.rows : records.map((record) => standardize(record, mapping));
      if (pivot) warnings.push('긴 형식(측정항목 열)을 표준 열로 피벗했습니다');
    }
    rows.forEach((row) => { row.source = row.source || 'json'; row.flags = row.flags || null; });
    applyUnits(rows, warnings);
    return { rows: finalizeRows(rows, warnings), mapping, unmapped, warnings, source: ouraLike ? 'oura' : 'json' };
  }

  function loadText(text, name) {
    const warnings = [];
    const trimmed = String(text).trim();
    if (/\.xml$/i.test(name || '') || trimmed.startsWith('<')) {
      throw new Error('Apple Health XML은 Python 엔진에서 읽습니다 (README의 load_apple_health_xml). CSV로 내보내 주세요.');
    }
    if (/\.json$/i.test(name || '') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return loadJson(trimmed, name, warnings);
    }
    const { headers, rows: records } = parseDelimited(text);
    if (!headers.length) throw new Error('빈 파일이거나 구분자를 찾지 못했습니다');
    const { mapping, unmapped } = mapHeaders(headers);
    const pivot = pivotLong(records, headers);
    let rows;
    if (pivot) {
      rows = pivot.rows;
      warnings.push('긴 형식(측정항목 열)을 표준 열로 피벗했습니다');
    } else {
      rows = records.map((record) => standardize(record, mapping));
    }
    if (!Object.keys(mapping).length && !pivot) {
      throw new Error('헤더를 하나도 해석하지 못했습니다. 열 이름을 확인해 주세요.');
    }
    rows.forEach((row) => {
      row.source = row.source || 'csv';
      row.flags = row.flags || null;
    });
    applyUnits(rows, warnings);
    return { rows: finalizeRows(rows, warnings), mapping, unmapped, warnings, source: 'csv' };
  }

  /* --------------------------------------------------------------- cleaning */
  const GAP_HOURS = 12;

  function cleanRows(input) {
    const rowsIn = input.length;
    const warnings = [];
    let rows = input.filter((r) => r.timestamp instanceof Date);

    rows = rows.slice().sort((a, b) => a.timestamp - b.timestamp);

    const signature = (r) => METRIC_COLUMNS.map((k) => (Number.isFinite(r[k]) ? r[k].toFixed(1) : '')).join('|');
    const subjectKey = (r) => r[SUBJECT] || '';
    const seen = new Set();
    let duplicatesRemoved = 0;
    rows = rows.filter((row) => {
      const key = row.timestamp.toISOString() + '|' + subjectKey(row) + '|' + (row.condition || '') + '|' + signature(row);
      if (seen.has(key)) { duplicatesRemoved += 1; return false; }
      seen.add(key);
      return true;
    });

    const lastBySignature = new Map();
    rows = rows.filter((row) => {
      const key = signature(row) + '|' + (row.condition || '') + '|' + subjectKey(row);
      const previous = lastBySignature.get(key);
      const within = previous && Math.abs(row.timestamp - previous) <= 60000;
      lastBySignature.set(key, row.timestamp);
      if (within) { duplicatesRemoved += 1; return false; }
      return true;
    });

    const removed = {};
    const flag = (row, code) => {
      const existing = row.flags ? String(row.flags) : '';
      if (existing.split('|').includes(code)) return;
      row.flags = existing ? `${existing}|${code}` : code;
    };

    Object.entries(PHYSIO_RANGES).forEach(([key, [low, high]]) => {
      rows.forEach((row) => {
        const v = row[key];
        if (!Number.isFinite(v)) return;
        if (v < low || v > high) {
          removed[key] = (removed[key] || 0) + 1;
          flag(row, `${key}_range`);
          row[key] = NaN;
        }
      });
    });

    let inconsistent = 0;
    rows.forEach((row) => {
      if (Number.isFinite(row.sbp) && Number.isFinite(row.dbp) && row.sbp <= row.dbp) {
        inconsistent += 1;
        flag(row, 'sbp_le_dbp');
        row.sbp = NaN;
        row.dbp = NaN;
        return;
      }
      if (Number.isFinite(row.sbp) && Number.isFinite(row.dbp) && row.sbp - row.dbp > 100) {
        flag(row, 'wide_pulse_pressure');
      }
      if (Number.isFinite(row.rmssd) && Number.isFinite(row.sdnn) && row.rmssd > row.sdnn * 1.5) {
        flag(row, 'rmssd_gt_sdnn');
      }
    });

    rows.forEach((row) => {
      if (Number.isFinite(row.forest) && row.forest !== 0 && row.forest !== 1) row.forest = NaN;
    });

    const gaps = [];
    for (let i = 1; i < rows.length; i += 1) {
      if (subjectKey(rows[i]) !== subjectKey(rows[i - 1])) continue;
      const hours = (rows[i].timestamp - rows[i - 1].timestamp) / 3600000;
      if (hours >= GAP_HOURS) gaps.push({ from: fmtStamp(rows[i - 1].timestamp), to: fmtStamp(rows[i].timestamp), hours });
    }
    let maxGap = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (subjectKey(rows[i]) !== subjectKey(rows[i - 1])) continue;
      maxGap = Math.max(maxGap, (rows[i].timestamp - rows[i - 1].timestamp) / 3600000);
    }

    const missing = {};
    METRIC_COLUMNS.forEach((key) => {
      if (!rows.length) return;
      missing[key] = Math.round(rows.filter((r) => !Number.isFinite(r[key])).length / rows.length * 1000) / 10;
    });

    const conditions = {};
    rows.forEach((row) => {
      const key = row.condition || '(unlabelled)';
      conditions[key] = (conditions[key] || 0) + 1;
    });

    const subjects = [...new Set(rows.map((r) => r[SUBJECT]).filter(Boolean))];
    const isQualityFlag = (row) => Boolean(row.flags)
      && String(row.flags).split('|').some((code) => code && !code.startsWith('align'));
    const flagged = rows.filter(isQualityFlag).length;
    const span = rows.length
      ? {
        start: fmtStamp(rows[0].timestamp),
        end: fmtStamp(rows[rows.length - 1].timestamp),
        days: Math.round(((rows[rows.length - 1].timestamp - rows[0].timestamp) / 86400000 + 1e-9) * 10) / 10,
      }
      : null;

    return {
      rows,
      qc: {
        rowsIn, rowsOut: rows.length, duplicatesRemoved, removed, inconsistent,
        missing, gaps, maxGap: Math.round(maxGap * 10) / 10, conditions, subjects, flagged, span, warnings,
      },
    };
  }

  /* ---------------------------------------------------------------- metrics */
  const addDerived = (rows) => rows.map((row) => {
    const out = {
      ...row,
      pp: Number.isFinite(row.sbp) && Number.isFinite(row.dbp) ? row.sbp - row.dbp : NaN,
      map: Number.isFinite(row.sbp) && Number.isFinite(row.dbp) ? row.dbp + (row.sbp - row.dbp) / 3 : NaN,
    };
    out.env_load = environmentalLoad(out);
    return out;
  });

  const REFERENCE = { rmssd: 50, hrLow: 55, hrHigh: 95, pm25: 35, thermalCenter: 22, thermalSpan: 15 };
  const STRESS_WEIGHTS = { bp_load: 0.30, hrv_suppression: 0.25, pm25: 0.20, thermal: 0.15, hr_load: 0.10 };

  function environmentalLoad(row) {
    const parts = [];
    if (Number.isFinite(row.pm25)) parts.push(clamp(row.pm25 / REFERENCE.pm25, 0, 1));
    if (Number.isFinite(row.temp_c)) parts.push(clamp(Math.abs(row.temp_c - REFERENCE.thermalCenter) / REFERENCE.thermalSpan, 0, 1));
    if (Number.isFinite(row.green_index)) parts.push(clamp(1 - row.green_index, 0, 1));
    return parts.length ? mean(parts) : NaN;
  }

  const isNight = (date) => {
    const hour = date.getHours();
    return hour >= NIGHT.start || hour < NIGHT.end;
  };

  function bloodPressureLoad(rows, sbpThreshold = 130, dbpThreshold = 80) {
    const valid = rows.filter((r) => Number.isFinite(r.sbp) || Number.isFinite(r.dbp));
    if (!valid.length) return { n: 0, either: NaN };
    const high = valid.filter((r) => (Number.isFinite(r.sbp) && r.sbp >= sbpThreshold)
      || (Number.isFinite(r.dbp) && r.dbp >= dbpThreshold));
    return { n: valid.length, either: high.length / valid.length * 100 };
  }

  function dipping(rows, metric = 'sbp') {
    const day = rows.filter((r) => !isNight(r.timestamp) && Number.isFinite(r[metric])).map((r) => r[metric]);
    const night = rows.filter((r) => isNight(r.timestamp) && Number.isFinite(r[metric])).map((r) => r[metric]);
    if (day.length < 2 || night.length < 2) {
      return { available: false, reason: `주간 ${day.length}회 · 야간 ${night.length}회 (각 2회 이상 필요)`, nDay: day.length, nNight: night.length };
    }
    const dayMean = mean(day);
    const nightMean = mean(night);
    const value = (dayMean - nightMean) / dayMean * 100;
    let category = 'normal dipping';
    if (value < 0) category = 'reverse dipper';
    else if (value < 10) category = 'non-dipper';
    else if (value > 20) category = 'extreme dipper';
    return { available: true, dayMean, nightMean, value, category, nDay: day.length, nNight: night.length };
  }

  function hrvRecovery(rows, metric = 'rmssd') {
    const finite = rows.filter((r) => Number.isFinite(r[metric]));
    if (!finite.length) return { available: false, reason: 'HRV 값이 없습니다' };
    const night = finite.filter((r) => isNight(r.timestamp)).map((r) => r[metric]);
    const day = finite.filter((r) => !isNight(r.timestamp)).map((r) => r[metric]);
    let resting = night;
    let baseline = '야간';
    if (night.length < 2 || day.length < 2) {
      const byDate = new Map();
      finite.slice().sort((a, b) => a.timestamp - b.timestamp).forEach((row) => {
        const key = dayKey(row.timestamp);
        if (!byDate.has(key)) byDate.set(key, row[metric]);
      });
      resting = [...byDate.values()];
      baseline = '그날 첫 측정';
      if (day.length < 2) return { available: false, reason: '주간 HRV 측정이 부족합니다' };
    }
    const dayValues = day.length >= 2 ? day : finite.map((r) => r[metric]);
    if (resting.length < 2) return { available: false, reason: '기저 HRV 측정이 부족합니다' };
    const restingMean = mean(resting);
    const dayMean = mean(dayValues);
    if (dayMean <= 0) return { available: false, reason: '주간 평균이 0입니다' };
    const index = restingMean / dayMean * 100;
    let band = 'blunted';
    if (index >= 110) band = 'enhanced recovery';
    else if (index >= 95) band = 'maintained';
    return { available: true, index, band, baseline, restingMean, dayMean, nResting: resting.length, nDay: dayValues.length };
  }

  function stressIndex(rows) {
    const components = {};
    const load = bloodPressureLoad(rows);
    if (Number.isFinite(load.either)) components.bp_load = load.either;
    const rmssd = values(rows, 'rmssd');
    if (rmssd.length) components.hrv_suppression = clamp(1 - mean(rmssd) / REFERENCE.rmssd, 0, 1) * 100;
    const pm25 = values(rows, 'pm25');
    if (pm25.length) components.pm25 = clamp(mean(pm25) / REFERENCE.pm25, 0, 1) * 100;
    const temp = values(rows, 'temp_c');
    if (temp.length) components.thermal = clamp(Math.abs(mean(temp) - REFERENCE.thermalCenter) / REFERENCE.thermalSpan, 0, 1) * 100;
    const hr = values(rows, 'hr');
    if (hr.length) components.hr_load = clamp((mean(hr) - REFERENCE.hrLow) / (REFERENCE.hrHigh - REFERENCE.hrLow), 0, 1) * 100;

    const keys = Object.keys(components);
    if (!keys.length) return { available: false, index: NaN, components: {} };
    let total = 0;
    let weighted = 0;
    keys.forEach((key) => { const w = STRESS_WEIGHTS[key] || 0; weighted += components[key] * w; total += w; });
    if (total <= 0) { total = keys.length; weighted = keys.reduce((s, k) => s + components[k], 0); }
    const index = weighted / total;
    let band = 'very high';
    if (index < 25) band = 'low';
    else if (index < 50) band = 'moderate';
    else if (index < 75) band = 'high';
    return { available: true, index, band, components };
  }

  function conditionSummary(rows, metrics) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = row.condition || '(unlabelled)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return [...groups.entries()].map(([condition, group]) => {
      const summary = { condition, n: group.length };
      metrics.forEach((metric) => {
        const list = values(group, metric);
        summary[metric] = list.length ? mean(list) : NaN;
        summary[`${metric}_n`] = list.length;
      });
      return summary;
    });
  }

  function summarize(rows, hrvMetric) {
    const pick = (key) => values(rows, key);
    const stats = {
      rows: rows.length,
      days: new Set(rows.map((r) => dayKey(r.timestamp))).size,
      subjects: new Set(rows.map((r) => r[SUBJECT]).filter(Boolean)).size,
      sbp: mean(pick('sbp')), dbp: mean(pick('dbp')), map: mean(pick('map')), pp: mean(pick('pp')),
      hr: mean(pick('hr')), rmssd: mean(pick('rmssd')), sdnn: mean(pick('sdnn')),
      pm25: mean(pick('pm25')), temp_c: mean(pick('temp_c')), green_index: mean(pick('green_index')),
      sbpN: pick('sbp').length, rmssdN: pick('rmssd').length,
    };
    stats.load = bloodPressureLoad(rows);
    stats.dipping = dipping(rows, 'sbp');
    stats.recovery = hrvRecovery(rows, hrvMetric);
    stats.stress = stressIndex(rows);
    return stats;
  }

  function dailyTable(rows) {
    const byDate = new Map();
    rows.forEach((row) => {
      const key = dayKey(row.timestamp);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(row);
    });
    return [...byDate.entries()].map(([date, group]) => {
      const item = { date, n: group.length };
      ['sbp', 'dbp', 'map', 'pp', 'hr', 'rmssd', 'sdnn', 'pm25', 'temp_c', 'green_index'].forEach((key) => {
        const list = values(group, key);
        if (list.length) item[key] = Math.round(mean(list) * 10) / 10;
      });
      const counts = {};
      group.forEach((r) => { const c = r.condition || '(unlabelled)'; counts[c] = (counts[c] || 0) + 1; });
      item.dominant_condition = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      return item;
    });
  }

  /* ------------------------------------------------------------- statistics */
  function betacf(a, b, x) {
    const MAXIT = 300;
    const EPS = 3e-14;
    const FPMIN = 1e-300;
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m += 1) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < EPS) break;
    }
    return h;
  }

  function logGamma(z) {
    const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let x = z;
    let y = z;
    let tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j += 1) { y += 1; ser += cof[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }

  function betainc(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const logBeta = logGamma(a + b) - logGamma(a) - logGamma(b);
    const front = Math.exp(logBeta + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return front * betacf(a, b, x) / a;
    return 1 - front * betacf(b, a, 1 - x) / b;
  }

  function tSf(t, df) {
    if (!(df > 0) || !Number.isFinite(df)) return NaN;
    const x = df / (df + t * t);
    const half = 0.5 * betainc(df / 2, 0.5, x);
    return t >= 0 ? half : 1 - half;
  }

  function tCdf(t, df) { return 1 - tSf(t, df); }

  function tQuantile(q, df) {
    let low = -1e3;
    let high = 1e3;
    for (let i = 0; i < 200; i += 1) {
      const mid = (low + high) / 2;
      if (tCdf(mid, df) < q) low = mid; else high = mid;
      if (high - low < 1e-10) break;
    }
    return (low + high) / 2;
  }

  function cohenD(a, b) {
    if (a.length < 2 || b.length < 2) return NaN;
    const pooled = Math.sqrt(((a.length - 1) * sd(a) ** 2 + (b.length - 1) * sd(b) ** 2) / (a.length + b.length - 2));
    if (!pooled) return NaN;
    return (mean(a) - mean(b)) / pooled;
  }

  function hedgesG(a, b) {
    const d = cohenD(a, b);
    const n = a.length + b.length;
    if (!Number.isFinite(d) || n < 4) return NaN;
    return d * (1 - 3 / (4 * n - 9));
  }

  function cohensDz(a, b) {
    const diffs = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) diffs.push(a[i] - b[i]);
    }
    if (diffs.length < 2) return NaN;
    const spread = sd(diffs);
    if (!spread) return NaN;
    return mean(diffs) / spread;
  }

  function permutationP(a, b, iterations = 5000, seed = 5020) {
    const diffs = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) diffs.push(a[i] - b[i]);
    }
    if (diffs.length < 2) return NaN;
    const observed = Math.abs(mean(diffs));
    const rng = makeRng(seed);
    let hits = 0;
    for (let k = 0; k < iterations; k += 1) {
      let total = 0;
      for (let i = 0; i < diffs.length; i += 1) total += (rng.uniform() < 0.5 ? -1 : 1) * diffs[i];
      if (Math.abs(total / diffs.length) >= observed - 1e-12) hits += 1;
    }
    return (hits + 1) / (iterations + 1);
  }

  function signTestP(a, b) {
    const diffs = [];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
      const d = a[i] - b[i];
      if (d !== 0) diffs.push(d);
    }
    const m = diffs.length;
    if (!m) return NaN;
    const positive = diffs.filter((d) => d > 0).length;
    const tail = Math.min(positive, m - positive);
    let sum = 0;
    for (let k = 0; k <= tail; k += 1) {
      sum += Math.exp(logGamma(m + 1) - logGamma(k + 1) - logGamma(m - k + 1) - m * Math.LN2);
    }
    return Math.min(1, 2 * sum);
  }

  function effectLabel(d) {
    if (!Number.isFinite(d)) return '—';
    const m = Math.abs(d);
    if (m < 0.2) return 'negligible';
    if (m < 0.5) return 'small';
    if (m < 0.8) return 'medium';
    return 'large';
  }

  function welch(a, b, alpha = 0.05) {
    if (a.length < 2 || b.length < 2) return null;
    const v1 = sd(a) ** 2;
    const v2 = sd(b) ** 2;
    const se = Math.sqrt(v1 / a.length + v2 / b.length);
    const diff = mean(a) - mean(b);
    if (!se) return null;
    const t = diff / se;
    const numerator = (v1 / a.length + v2 / b.length) ** 2;
    const denominator = (v1 / a.length) ** 2 / (a.length - 1) + (v2 / b.length) ** 2 / (b.length - 1);
    const df = denominator > 0 ? numerator / denominator : a.length + b.length - 2;
    const p = 2 * tSf(Math.abs(t), df);
    const crit = tQuantile(1 - alpha / 2, df);
    const d = cohenD(a, b);
    return {
      test: 'welch_t', t, df, p: clamp(p, 0, 1), diff,
      nA: a.length, nB: b.length, meanA: mean(a), meanB: mean(b),
      d, dz: NaN, g: hedgesG(a, b), effect: effectLabel(d), permP: NaN, signP: NaN,
      ciLow: diff - crit * se, ciHigh: diff + crit * se,
    };
  }

  function pairedT(a, b, alpha = 0.05) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return null;
    const diff = [];
    for (let i = 0; i < n; i += 1) diff.push(a[i] - b[i]);
    const md = mean(diff);
    const sdd = sd(diff);
    if (!sdd) return null;
    const se = sdd / Math.sqrt(n);
    const t = md / se;
    const df = n - 1;
    const p = 2 * tSf(Math.abs(t), df);
    const crit = tQuantile(1 - alpha / 2, df);
    const dz = cohensDz(a, b);
    return {
      test: 'paired_t', t, df, p: clamp(p, 0, 1), diff: md,
      nA: n, nB: n, meanA: mean(a), meanB: mean(b),
      d: cohenD(a, b), dz, g: hedgesG(a, b), effect: effectLabel(Number.isFinite(dz) ? dz : cohenD(a, b)),
      permP: permutationP(a, b), signP: signTestP(a, b),
      ciLow: md - crit * se, ciHigh: md + crit * se,
    };
  }

  function subjectPairs(rows, metric, groupA, groupB) {
    const buckets = new Map();
    rows.forEach((row) => {
      if (!row[SUBJECT] || !row.condition) return;
      if (!Number.isFinite(row[metric])) return;
      if (row.condition !== groupA && row.condition !== groupB) return;
      const key = `${row[SUBJECT]}||${row.condition}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row[metric]);
    });
    const bySubject = new Map();
    buckets.forEach((list, key) => {
      const [subject, condition] = key.split('||');
      if (!bySubject.has(subject)) bySubject.set(subject, {});
      bySubject.get(subject)[condition] = mean(list);
    });
    const a = [];
    const b = [];
    [...bySubject.values()].forEach((entry) => {
      if (Number.isFinite(entry[groupA]) && Number.isFinite(entry[groupB])) {
        a.push(entry[groupA]);
        b.push(entry[groupB]);
      }
    });
    return { a, b, subjects: a.length };
  }

  function countSubjectsInBoth(rows, groupA, groupB) {
    const sets = new Map();
    rows.forEach((row) => {
      if (!row[SUBJECT] || !row.condition) return;
      if (!sets.has(row[SUBJECT])) sets.set(row[SUBJECT], new Set());
      sets.get(row[SUBJECT]).add(row.condition);
    });
    let count = 0;
    sets.forEach((set) => { if (set.has(groupA) && set.has(groupB)) count += 1; });
    return count;
  }

  function compareTable(rows, metrics, groupA, groupB, paired) {
    const out = [];
    if (!groupA || !groupB || groupA === groupB) return { rows: out, mode: 'unpaired', nSubjects: 0, note: '' };
    const pairedSubjects = paired ? countSubjectsInBoth(rows, groupA, groupB) : 0;
    const mode = !paired ? 'unpaired' : pairedSubjects >= 2 ? 'subject' : 'row';
    let note = '';
    if (paired && mode === 'row') {
      note = pairedSubjects === 1
        ? 'subject_id가 1명뿐이라 시간 순서로 짝지었습니다 (같은 사람의 반복 측정).'
        : 'subject_id가 없어 시간 순서로 짝지었습니다 (subject_id를 넣으면 피험자 단위 대응이 됩니다).';
    }
    metrics.forEach((metric) => {
      let a;
      let b;
      let result;
      if (mode === 'subject') {
        const pairs = subjectPairs(rows, metric, groupA, groupB);
        if (pairs.subjects < 2) return;
        a = pairs.a;
        b = pairs.b;
        result = pairedT(a, b);
      } else {
        a = rows.filter((r) => r.condition === groupA && Number.isFinite(r[metric])).map((r) => r[metric]);
        b = rows.filter((r) => r.condition === groupB && Number.isFinite(r[metric])).map((r) => r[metric]);
        if (a.length < 2 || b.length < 2) return;
        if (paired) {
          const n = Math.min(a.length, b.length);
          a = a.slice(0, n);
          b = b.slice(0, n);
          result = pairedT(a, b);
        } else {
          result = welch(a, b);
        }
      }
      if (!result) return;
      out.push({
        metric,
        meanA: result.meanA,
        meanB: result.meanB,
        diff: result.diff,
        pct: result.meanB ? result.diff / result.meanB * 100 : NaN,
        d: result.d,
        dz: result.dz,
        effect: result.effect,
        p: result.p,
        permP: result.permP,
        signP: result.signP,
        ciLow: result.ciLow,
        ciHigh: result.ciHigh,
        nA: a.length,
        nB: b.length,
        nSubjects: mode === 'subject' ? a.length : null,
        test: result.test,
      });
    });
    return { rows: out, mode, nSubjects: pairedSubjects, note };
  }

  /* ------------------------------------------------------------ correlation */
  function pearsonArrays(xs, ys) {
    const n = xs.length;
    if (n < 3) return { r: NaN, n };
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i += 1) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    if (!sxx || !syy) return { r: NaN, n };
    const r = sxy / Math.sqrt(sxx * syy);
    const t = r * Math.sqrt((n - 2) / Math.max(1e-15, 1 - r * r));
    return { r, p: 2 * tSf(Math.abs(t), n - 2), n };
  }

  function rank(valuesIn) {
    const sorted = valuesIn.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(valuesIn.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j += 1;
      const average = (i + j + 2) / 2;
      for (let k = i; k <= j; k += 1) ranks[sorted[k][1]] = average;
      i = j + 1;
    }
    return ranks;
  }

  function spearmanArrays(xs, ys) {
    if (xs.length < 3) return { rho: NaN, n: xs.length };
    const result = pearsonArrays(rank(xs), rank(ys));
    return { rho: result.r, p: result.p, n: result.n };
  }

  function olsRegression(xs, ys) {
    const n = xs.length;
    if (n < 3) return { slope: NaN, intercept: NaN, p: NaN, r2: NaN, n };
    const mx = mean(xs);
    const my = mean(ys);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i += 1) {
      sxx += (xs[i] - mx) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    if (!sxx) return { slope: NaN, intercept: NaN, p: NaN, r2: NaN, n };
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let sse = 0;
    let sst = 0;
    for (let i = 0; i < n; i += 1) {
      sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
      sst += (ys[i] - my) ** 2;
    }
    const df = n - 2;
    if (df < 1 || sse <= 0) return { slope, intercept, p: NaN, r2: NaN, n };
    const se = Math.sqrt(sse / df / sxx);
    const t = slope / se;
    return { slope, intercept, se, t, p: 2 * tSf(Math.abs(t), df), r2: sst > 0 ? 1 - sse / sst : NaN, n };
  }

  const DEFAULT_PAIRS = [
    ['pm25', 'sbp'], ['pm25', 'dbp'], ['pm25', 'map'], ['pm25', 'rmssd'], ['pm25', 'sdnn'],
    ['green_index', 'sbp'], ['green_index', 'rmssd'], ['temp_c', 'hr'], ['temp_c', 'sbp'],
    ['humidity_pct', 'hr'], ['env_load', 'sbp'], ['env_load', 'rmssd'],
  ];

  function correlationRow(rows, xKey, yKey) {
    const pairs = rows.filter((r) => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey]));
    if (pairs.length < 4) return { x: xKey, y: yKey, n: pairs.length, available: false };
    const xs = pairs.map((p) => p[xKey]);
    const ys = pairs.map((p) => p[yKey]);
    const p = pearsonArrays(xs, ys);
    const s = spearmanArrays(xs, ys);
    const reg = olsRegression(xs, ys);
    return {
      x: xKey, y: yKey, n: pairs.length, available: true,
      r: p.r, rP: p.p, rho: s.rho, rhoP: s.p,
      slope: reg.slope, intercept: reg.intercept, slopeP: reg.p, r2: reg.r2,
    };
  }

  function correlationRows(rows, pairs = DEFAULT_PAIRS) {
    return pairs.map(([x, y]) => correlationRow(rows, x, y)).filter((row) => row.available);
  }

  /* -------------------------------------------------------------- synthetic */
  const EFFECTS = {
    urban: { walkSbp: 2.5, walkDbp: 1.2, walkHr: 21, rmssd: -3.5 },
    forest: { walkSbp: -8, walkDbp: -5, walkHr: 10, rmssd: 6 },
  };
  const ENVIRONMENT = {
    urban: { pm25: 27, green: 0.08, temp: 26.4, humidity: 52, forest: 0 },
    forest: { pm25: 8.5, green: 0.84, temp: 23.4, humidity: 68, forest: 1 },
  };

  function generateDemo(days = 14, seed = 123, startISO = '2026-05-06', subject = 'S-01', anomalies = true) {
    const rng = makeRng(seed);
    const slots = [['night', 3, 0], ['morning', 7, 10], ['walk', 10, 0], ['post', 11, 15], ['evening', 21, 40]];
    const start = new Date(`${startISO}T00:00:00`);
    const baseSbp = 133 + rng.normal(0, 3);
    const baseDbp = 84 + rng.normal(0, 2);
    const baseHr = 71 + rng.normal(0, 2.5);
    const baseRmssd = 37 + rng.normal(0, 3);
    let drift = 0;
    let carryover = 0;
    const rows = [];

    for (let d = 0; d < days; d += 1) {
      const day = new Date(start.getTime() + d * 86400000);
      const condition = d % 2 === 0 ? 'urban' : 'forest';
      const profile = ENVIRONMENT[condition];
      const effect = EFFECTS[condition];
      drift += rng.normal(0, 0.9);
      const dayNoise = rng.normal(0, 1.4);
      const weatherPm = Math.max(3, profile.pm25 + rng.normal(0, condition === 'urban' ? 6.5 : 2.6));
      const weatherTemp = profile.temp + rng.normal(0, 1.5);
      const weatherHumidity = clamp(profile.humidity + rng.normal(0, 6), 30, 95);
      const weatherGreen = clamp(profile.green + rng.normal(0, 0.04), 0.02, 0.97);

      slots.forEach(([slot, hour, minute]) => {
        const timestamp = new Date(day.getTime() + (hour * 60 + minute) * 60000);
        let sbp; let dbp; let hr; let rmssd; let pm25; let temp; let humidity; let green;
        if (slot === 'night') {
          sbp = baseSbp + drift - 16.5 + rng.normal(0, 3) + carryover;
          dbp = baseDbp + drift * 0.6 - 11.5 + rng.normal(0, 2) + carryover * 0.5;
          hr = baseHr - 14 + rng.normal(0, 2.5);
          rmssd = baseRmssd * 1.24 + rng.normal(0, 3.5) + (condition === 'forest' ? 2 : 0);
          pm25 = weatherPm * 0.4 + 4;
          temp = 22 + rng.normal(0, 0.6);
          humidity = Math.min(95, weatherHumidity + 6);
          green = Math.max(0.02, weatherGreen * 0.25);
        } else if (slot === 'morning') {
          sbp = baseSbp + drift + dayNoise + carryover;
          dbp = baseDbp + drift * 0.6 + dayNoise * 0.5 + carryover * 0.5;
          hr = baseHr + 1 + rng.normal(0, 2);
          rmssd = baseRmssd + rng.normal(0, 3);
          pm25 = weatherPm;
          temp = weatherTemp - 1.4;
          humidity = weatherHumidity;
          green = weatherGreen;
        } else if (slot === 'walk') {
          sbp = baseSbp + drift + effect.walkSbp + rng.normal(0, 3.5);
          dbp = baseDbp + drift * 0.6 + effect.walkDbp + rng.normal(0, 2.4);
          hr = baseHr + effect.walkHr + rng.normal(0, 4);
          rmssd = baseRmssd + effect.rmssd + rng.normal(0, 3);
          pm25 = weatherPm;
          temp = weatherTemp;
          humidity = weatherHumidity - 4;
          green = weatherGreen;
        } else if (slot === 'post') {
          sbp = baseSbp + drift + effect.walkSbp * 0.6 + rng.normal(0, 3);
          dbp = baseDbp + drift * 0.6 + effect.walkDbp * 0.6 + rng.normal(0, 2);
          hr = baseHr + 2 + effect.walkHr * 0.18 + rng.normal(0, 2.5);
          rmssd = baseRmssd + effect.rmssd * 0.9 + rng.normal(0, 3);
          pm25 = weatherPm * 0.9;
          temp = weatherTemp + 0.6;
          humidity = weatherHumidity;
          green = weatherGreen;
        } else {
          sbp = baseSbp + drift * 1.1 + dayNoise * 0.6 + effect.walkSbp * 0.5 + rng.normal(0, 3.2);
          dbp = baseDbp + drift * 0.7 + effect.walkDbp * 0.5 + rng.normal(0, 2.2);
          hr = baseHr + 2 + rng.normal(0, 2.2);
          rmssd = baseRmssd + effect.rmssd * 0.55 + rng.normal(0, 3.2);
          pm25 = weatherPm * 0.75;
          temp = weatherTemp - 2.8;
          humidity = weatherHumidity + 3;
          green = weatherGreen;
        }
        const sdnn = rmssd * 2.05 + rng.normal(0, 4);
        rows.push({
          timestamp,
          subject_id: subject,
          source: 'synthetic',
          condition,
          sbp: Math.round(sbp * 10) / 10,
          dbp: Math.round(dbp * 10) / 10,
          hr: Math.round(hr * 10) / 10,
          rmssd: Math.round(Math.max(8, rmssd) * 10) / 10,
          sdnn: Math.round(Math.max(12, sdnn) * 10) / 10,
          temp_c: Math.round(temp * 10) / 10,
          humidity_pct: Math.round(clamp(humidity, 28, 96) * 10) / 10,
          pm25: Math.round(Math.max(1, pm25) * 10) / 10,
          pm10: Math.round(Math.max(2, pm25 * 1.55 + rng.normal(0, 3)) * 10) / 10,
          green_index: Math.round(green * 1000) / 1000,
          forest: profile.forest,
          activity: slot,
          steps: Math.round(Math.abs(rng.normal(0, 6)) + (slot === 'walk' ? 4200 : 0)),
          flags: null,
          notes: slot === 'walk' ? (condition === 'forest' ? '숲길 40분' : '가로 40분') : null,
        });
      });
      carryover = condition === 'forest' ? -1.44 : 0.6;
    }

    // The same three deliberate faults as the Python generator, so the QC panel
    // has something real to report.
    if (anomalies && rows.length >= 21) {
      rows[2].sbp = 0; rows[2].dbp = 0;
      rows[13].sbp = 78; rows[13].dbp = 96;
      const duplicate = { ...rows[30], timestamp: new Date(rows[30].timestamp.getTime() + 60000), notes: '중복 동기화' };
      rows.push(duplicate);
    }
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows;
  }

  function generateCohort(subjects = 6, days = 8, seed = 123) {
    const rows = [];
    for (let i = 0; i < subjects; i += 1) {
      rows.push(...generateDemo(days, seed + 101 * i, '2026-05-06', `S-${pad(i + 1)}`, false));
    }
    return rows.sort((a, b) => String(a.subject_id).localeCompare(String(b.subject_id)) || a.timestamp - b.timestamp);
  }

  /* --------------------------------------------------------------- alignment */
  const ROLE_ORDER = ['bp', 'wearable', 'environment'];

  function roleOf(rows) {
    const has = (key) => rows.some((r) => Number.isFinite(r[key]));
    if (has('sbp') || has('dbp')) return 'bp';
    if (has('hr') || has('rmssd') || has('sdnn')) return 'wearable';
    if (has('pm25') || has('green_index') || has('temp_c')) return 'environment';
    return 'other';
  }

  function streamName(stream, index) {
    return stream.name || `stream${index + 1}`;
  }

  function subjectsCompatible(anchor, row, singleSubject) {
    const a = anchor[SUBJECT] || '';
    const b = row[SUBJECT] || '';
    if (a && b) return a === b;
    if (a || b) return singleSubject;
    return true;
  }

  const stripInternal = (row) => {
    const out = {};
    Object.entries(row).forEach(([key, value]) => { if (!key.startsWith('__')) out[key] = value; });
    return out;
  };

  function coalesce(target, source) {
    METRIC_COLUMNS.forEach((key) => {
      const value = source[key];
      if (!Number.isFinite(value)) return;
      if (!Number.isFinite(target[key])) target[key] = value;
    });
    if (!target.condition && source.condition) target.condition = source.condition;
    if (!target[SUBJECT] && source[SUBJECT]) target[SUBJECT] = source[SUBJECT];
    if (!target.notes && source.notes) target.notes = source.notes;
  }

  function addFlag(flags, code) {
    const existing = flags ? String(flags) : '';
    if (existing.split('|').includes(code)) return existing;
    return existing ? `${existing}|${code}` : code;
  }

  function alignStreams(streams, toleranceMinutes, mode = 'tolerance') {
    const prepared = streams.map((stream, index) => ({
      name: streamName(stream, index),
      role: roleOf(stream.rows),
      rows: stream.rows,
    }));
    if (!prepared.length) return { rows: [], report: null };
    const anchor = prepared.find((s) => s.role === 'bp') || prepared[0];
    if (mode === 'daily') return alignDaily(prepared);

    const records = [];
    prepared.forEach((stream) => {
      stream.rows.forEach((row) => {
        records.push({ ...row, __stream: stream.name, __role: stream.role, __assigned: false });
      });
    });
    const toleranceMs = Math.max(0, Number(toleranceMinutes) || 0) * 60000;
    const anchorIndexes = [];
    records.forEach((row, index) => { if (row.__role === anchor.role) anchorIndexes.push(index); });
    const knownSubjects = new Set(records.map((r) => r[SUBJECT]).filter(Boolean));
    const singleSubject = knownSubjects.size <= 1;
    const partners = new Map();
    anchorIndexes.forEach((index) => partners.set(index, []));

    const roles = [...new Set(records.map((r) => r.__role))].filter((role) => role !== anchor.role);
    roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));

    const warnings = [];
    let unlabelledJoins = 0;
    let blockedJoins = 0;
    const rowTaken = new Set();

    roles.forEach((role) => {
      const candidates = [];
      records.forEach((row, index) => {
        if (row.__role !== role || row.__assigned) return;
        anchorIndexes.forEach((anchorIndex) => {
          const anchorRow = records[anchorIndex];
          const a = anchorRow[SUBJECT] || '';
          const b = row[SUBJECT] || '';
          let bothLabelled = true;
          if (a && b) {
            if (a !== b) return;
          } else if (a || b) {
            bothLabelled = false;
            if (!singleSubject) { row.__blocked = true; return; }
          }
          const delta = Math.abs(row.timestamp - anchorRow.timestamp);
          if (delta <= toleranceMs) candidates.push([delta, anchorIndex, index, bothLabelled]);
        });
      });
      candidates.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
      const takenAnchor = new Set();
      candidates.forEach(([, anchorIndex, index, bothLabelled]) => {
        if (takenAnchor.has(anchorIndex) || rowTaken.has(index)) return;
        partners.get(anchorIndex).push(index);
        takenAnchor.add(anchorIndex);
        rowTaken.add(index);
        records[index].__assigned = true;
        if (!bothLabelled) unlabelledJoins += 1;
      });
    });
    blockedJoins = records.filter((row) => row.__blocked && !row.__assigned).length;

    const out = [];
    let matched = 0;
    let multi = 0;
    const rolesByAnchor = new Map();
    anchorIndexes.forEach((anchorIndex) => {
      const base = stripInternal(records[anchorIndex]);
      const partnerIndexes = partners.get(anchorIndex);
      rolesByAnchor.set(anchorIndex, partnerIndexes.map((i) => records[i].__role));
      if (partnerIndexes.length) {
        matched += 1;
        partnerIndexes.forEach((i) => coalesce(base, stripInternal(records[i])));
      }
      const names = [records[anchorIndex].__stream]
        .concat(partnerIndexes.map((i) => records[i].__stream))
        .filter((value, i, list) => list.indexOf(value) === i);
      base.source = names.join('+');
      base.flags = addFlag(base.flags, `align:${names.join('+')}`);
      if (!partnerIndexes.length) base.flags = addFlag(base.flags, 'align_unmatched');
      if (new Set(rolesByAnchor.get(anchorIndex)).size > 1 || partnerIndexes.length > 1) multi += 1;
      out.push(base);
    });

    records.forEach((row, index) => {
      if (row.__role === anchor.role && anchorIndexes.includes(index)) return;
      if (row.__assigned) return;
      const base = stripInternal(row);
      base.source = row.__stream;
      base.flags = addFlag(base.flags, `align:${row.__stream}`);
      base.flags = addFlag(base.flags, 'align_unmatched');
      out.push(base);
    });

    const streamReports = prepared.map((stream) => {
      let matchedRows = 0;
      records.forEach((row, index) => {
        if (row.__stream !== stream.name) return;
        if (row.__role === anchor.role && anchorIndexes.includes(index)) {
          if (partners.get(index).length) matchedRows += 1;
        } else if (row.__assigned) {
          matchedRows += 1;
        }
      });
      return {
        name: stream.name,
        role: stream.role,
        rows: stream.rows.length,
        matched_rows: matchedRows,
        unmatched_rows: stream.rows.length - matchedRows,
        match_rate_pct: stream.rows.length ? Math.round(matchedRows / stream.rows.length * 1000) / 10 : 0,
      };
    });

    if (unlabelledJoins) warnings.push(`${unlabelledJoins}개 행에 subject_id가 없어 단일 피험자로 결합했습니다.`);
    if (blockedJoins) warnings.push('여러 피험자 데이터에서 subject_id가 없는 스트림의 결합 후보를 거부했습니다.');

    out.sort((a, b) => String(a[SUBJECT] || '').localeCompare(String(b[SUBJECT] || '')) || a.timestamp - b.timestamp);
    return {
      rows: out,
      report: {
        mode: 'tolerance',
        tolerance_minutes: Number(toleranceMinutes) || 0,
        anchor: anchor.role,
        subject_column: SUBJECT,
        streams: streamReports,
        rows_in: records.length,
        rows_out: out.length,
        anchors: anchorIndexes.length,
        anchors_matched: matched,
        match_rate_pct: anchorIndexes.length ? Math.round(matched / anchorIndexes.length * 1000) / 10 : 0,
        rows_with_multiple_streams: multi,
        warnings,
      },
    };
  }

  function alignDaily(prepared) {
    const merged = new Map();
    const order = [];
    const streamReports = prepared.map((stream) => ({
      name: stream.name, role: stream.role, rows: 0, matched_rows: 0, unmatched_rows: 0, match_rate_pct: null,
    }));
    prepared.forEach((stream) => {
      const buckets = new Map();
      stream.rows.forEach((row) => {
        if (!(row.timestamp instanceof Date)) return;
        const key = `${row[SUBJECT] || ''}||${dayKey(row.timestamp)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
      });
      const entry = streamReports.find((item) => item.name === stream.name);
      if (entry) entry.rows = buckets.size;
      buckets.forEach((group, key) => {
        if (!merged.has(key)) {
          const [subject, date] = key.split('||');
          merged.set(key, {
            timestamp: new Date(`${date}T00:00:00`),
            subject_id: subject || null,
            source: '',
            condition: null,
            flags: null,
            notes: null,
            __streams: [],
          });
          order.push(key);
        }
        const target = merged.get(key);
        const averaged = {};
        METRIC_COLUMNS.forEach((metric) => {
          const list = values(group, metric);
          averaged[metric] = list.length ? mean(list) : NaN;
        });
        averaged.condition = group.map((r) => r.condition).find(Boolean) || null;
        averaged.notes = group.map((r) => r.notes).find(Boolean) || null;
        coalesce(target, averaged);
        target.__streams.push(stream.name);
      });
    });
    let multi = 0;
    const out = order.map((key) => {
      const row = merged.get(key);
      const names = [...new Set(row.__streams)];
      delete row.__streams;
      if (names.length > 1) multi += 1;
      row.source = names.join('+');
      row.flags = addFlag(row.flags, `align:${names.join('+')}`);
      if (names.length < 2) row.flags = addFlag(row.flags, 'align_unmatched');
      row.__names = names;
      return row;
    });
    out.sort((a, b) => String(a[SUBJECT] || '').localeCompare(String(b[SUBJECT] || '')) || a.timestamp - b.timestamp);
    streamReports.forEach((entry) => {
      const count = out.filter((row) => (row.__names || []).includes(entry.name)).length;
      entry.matched_rows = count;
      entry.unmatched_rows = entry.rows - count;
    });
    out.forEach((row) => { delete row.__names; });
    return {
      rows: out,
      report: {
        mode: 'daily',
        tolerance_minutes: 0,
        anchor: 'date',
        subject_column: SUBJECT,
        streams: streamReports,
        rows_in: prepared.reduce((sum, s) => sum + s.rows.length, 0),
        rows_out: out.length,
        anchors: out.length,
        anchors_matched: multi,
        match_rate_pct: out.length ? Math.round(multi / out.length * 1000) / 10 : 0,
        rows_with_multiple_streams: multi,
        warnings: ['일별 집계는 피험자·날짜별 평균으로 결합했습니다.'],
      },
    };
  }

  function splitCohortStreams(rows) {
    const bp = rows.map((row) => ({
      timestamp: new Date(row.timestamp),
      subject_id: row.subject_id,
      source: 'cuff_bp',
      condition: row.condition,
      sbp: row.sbp,
      dbp: row.dbp,
    }));
    const wearable = rows.map((row) => ({
      timestamp: new Date(row.timestamp.getTime() + 3 * 60000),
      subject_id: row.subject_id,
      source: 'wearable',
      condition: row.condition,
      hr: row.hr,
      rmssd: row.rmssd,
      sdnn: row.sdnn,
    }));
    const environment = rows.map((row) => ({
      timestamp: new Date(row.timestamp.getTime() - 7 * 60000),
      subject_id: row.subject_id,
      source: 'environment',
      condition: row.condition,
      temp_c: row.temp_c,
      humidity_pct: row.humidity_pct,
      pm25: row.pm25,
      pm10: row.pm10,
      green_index: row.green_index,
      forest: row.forest,
    }));
    return [
      { name: 'cuff_bp.csv', rows: bp },
      { name: 'wearable.json', rows: wearable },
      { name: 'environment.csv', rows: environment },
    ];
  }

  /* ------------------------------------------------------------ methodology */
  const REFERENCES = {
    pm25: 'WHO (2005) Air Quality Guidelines — 24-hour PM2.5 interim target 1 = 35 µg/m³ (2021 지침값은 15 µg/m³)',
    welcoming: 'Lakens, D. (2013). Calculating and reporting effect sizes. Front. Psychol. 4:863',
    welch: 'Welch, B. L. (1947). The generalization of Student\'s problem. Biometrika 34:28–35',
    permutation: 'Sign-flip randomization test — 조건 교환 가능성만 가정',
    sign: 'Exact two-sided binomial sign test',
    pearson: 'Pearson product-moment correlation · p from t = r√((n−2)/(1−r²))',
    spearman: 'Spearman rank correlation (average ranks, t approximation)',
    ols: 'Ordinary least squares · slope tested with t = b1/SE(b1)',
    dipping: 'Ambulatory BP convention — normal 10–20 %, non-dipper 0–10 %, reverse < 0 %, extreme > 20 %',
  };

  const METHODOLOGY = [
    { key: 'sbp', label: '수축기 혈압 (SBP)', unit: 'mmHg', kind: 'measured', formula: null, boundary: '커프 측정만이 혈압의 근거입니다. Oura API v2에는 혈압 엔드포인트가 없습니다.' },
    { key: 'dbp', label: '이완기 혈압 (DBP)', unit: 'mmHg', kind: 'measured', formula: null, boundary: 'SBP ≤ DBP인 모순 쌍은 분석에서 제외하고 QC에 기록합니다.' },
    { key: 'hr', label: '심박수 (HR)', unit: 'bpm', kind: 'measured', formula: null, boundary: '기기별 평균 구간이 다릅니다(야간 평균·안정 심박·순간 심박).' },
    { key: 'rmssd', label: 'HRV — RMSSD', unit: 'ms', kind: 'measured', formula: null, boundary: 'Oura는 RMSSD, Apple Health는 SDNN을 보고합니다. 서로 변환하지 않습니다.' },
    { key: 'sdnn', label: 'HRV — SDNN', unit: 'ms', kind: 'measured', formula: null, boundary: 'RMSSD와 다른 양이며 기록 구간도 다릅니다. 대체하지 않습니다.' },
    { key: 'pm25', label: '초미세먼지 (PM2.5)', unit: 'µg/m³', kind: 'measured', formula: null, boundary: '측정소 값은 개인 흡입량이 아닙니다.' },
    { key: 'temp_c', label: '기온', unit: '°C', kind: 'measured', formula: null, boundary: '측정 지점의 대표값이며 개인 노출과 다를 수 있습니다.' },
    { key: 'green_index', label: '녹지지수', unit: '0–1', kind: 'measured', formula: null, boundary: '0–100 스케일은 자동으로 1/100 합니다.' },
    { key: 'map', label: '평균동맥압 (MAP)', unit: 'mmHg', kind: 'derived', formula: 'DBP + (SBP − DBP) / 3', boundary: '동맥압 파형의 적분이 아니라 두 점에서 계산한 근사입니다.' },
    { key: 'pp', label: '맥압 (PP)', unit: 'mmHg', kind: 'derived', formula: 'SBP − DBP', boundary: '큰 맥압은 플래그만 남기고 삭제하지 않습니다.' },
    { key: 'dipping', label: '야간 하강률', unit: '%', kind: 'derived', formula: '(주간평균 − 야간평균) / 주간평균 × 100', boundary: '야간 22:00–06:00, 주·야 각 2회 이상 필요. 수면이 아니라 시계 시간 기준입니다.' },
    { key: 'hrv_recovery', label: 'HRV 회복 지수', unit: 'index', kind: 'derived', formula: '야간 HRV / 주간 HRV × 100', boundary: '임상 기준값이 없습니다. 야간 측정이 없으면 그날 첫 측정을 기저로 씁니다.' },
    { key: 'bp_load', label: '혈압 부하', unit: '%', kind: 'derived', formula: 'SBP ≥ 130 또는 DBP ≥ 80 비율', boundary: '역치는 코드에서 바꿀 수 있는 관례값이며 진단이 아닙니다.' },
    { key: 'env_load', label: '환경 부하 (행별)', unit: '0–1', kind: 'exploratory', formula: 'mean( clamp(PM2.5/35) · clamp(|기온−22|/15) · (1−녹지) )', boundary: '혈압·HRV를 포함하지 않아 상관분석의 순환논리를 피했습니다.' },
    { key: 'stress_index', label: '환경 스트레스 지수', unit: '0–100', kind: 'exploratory', formula: '0.30·BP부하 + 0.25·HRV억제 + 0.20·PM2.5 + 0.15·열부담 + 0.10·HR부하', boundary: '연구실 요약 지수이며 임상 위험 점수가 아닙니다.' },
    { key: 'welch_t', label: 'Welch t-test', unit: 't, df, p', kind: 'derived', formula: 't = (x̄a − x̄b) / √(s²a/na + s²b/nb)', boundary: '서로 다른 관측일 때. 같은 사람의 반복 측정에는 대응표본을 쓰세요.' },
    { key: 'paired_t', label: '대응표본 t-test', unit: 't, df = n−1', kind: 'derived', formula: 't = mean(d) / (SD(d)/√n)', boundary: 'subject_id가 양쪽 조건에 모두 있어야 합니다. 없으면 시간순 짝짓기로 대체합니다.' },
    { key: 'cohens_dz', label: "Cohen's d_z", unit: 'SD units', kind: 'derived', formula: 'd_z = mean(a − b) / SD(a − b)', boundary: '대응 설계의 효과크기입니다. 독립표본 d와 같은 축으로 비교하지 않습니다.' },
    { key: 'permutation_p', label: '순열(sign-flip) p', unit: 'p', kind: 'derived', formula: '5,000회 부호 뒤집기 중 관측 |평균차| 이상의 비율', boundary: '분포 가정이 없는 대안이며 몬테카를로 근사입니다.' },
    { key: 'sign_test_p', label: '부호 검정 p', unit: 'p', kind: 'derived', formula: '양(+) 차이 개수에 대한 양측 이항검정', boundary: '차이의 크기를 무시하고 방향만 봅니다. 0 차이는 제외합니다.' },
    { key: 'pearson_r', label: 'Pearson r', unit: '−1…1', kind: 'derived', formula: 'Σ(x−x̄)(y−ȳ) / √(Σ(x−x̄)²·Σ(y−ȳ)²)', boundary: '선형 관계만 봅니다. 자기상관이 있으면 p가 실제보다 작아집니다.' },
    { key: 'spearman_rho', label: 'Spearman ρ', unit: '−1…1', kind: 'derived', formula: '평균 순위의 Pearson 상관', boundary: '단조 관계를 봅니다. 동점이 많으면 압축됩니다.' },
    { key: 'ols_slope', label: '단순 선형회귀 기울기', unit: 'y per x', kind: 'derived', formula: 'b1 = Σ(x−x̄)(y−ȳ)/Σ(x−x̄)², b0 = ȳ − b1·x̄', boundary: '관측 범위 밖으로 외삽하지 않습니다. 공변량은 보정하지 않습니다.' },
  ];

  /* ------------------------------------------------------------------ state */
  const state = {
    rows: [],
    mapping: {},
    unmapped: [],
    warnings: [],
    qc: null,
    source: '—',
    fileName: '—',
    files: [],
    alignment: null,
    groupA: 'forest',
    groupB: 'urban',
    paired: false,
    corrX: 'pm25',
    corrY: 'sbp',
    hrvMetric: 'rmssd',
    tolerance: '30',
  };

  /* --------------------------------------------------------------- rendering */
  function renderAll() {
    renderQc();
    renderSummary();
    renderCompare();
    renderExposure();
    renderPreview();
    renderCharts();
    renderMethodology();
    const disabled = !state.rows.length;
    ['exportCsv', 'exportJson', 'exportMd'].forEach((id) => { const el = $(id); if (el) el.disabled = disabled; });
    if ($('mergeBtn')) $('mergeBtn').disabled = state.files.length < 2;
  }

  function renderFiles() {
    const list = $('fileList');
    $('fileCount').textContent = state.files.length;
    if (!state.files.length) {
      list.innerHTML = '<li class="muted">아직 불러온 파일이 없습니다.</li>';
      return;
    }
    list.innerHTML = state.files.map((file, index) => {
      const role = roleOf(file.loaded.rows);
      const labels = { bp: '혈압', wearable: '웨어러블', environment: '환경', other: '기타' };
      return `<li>
        <span class="file-name">${escapeHtml(file.name)}</span>
        <span class="file-role role-${role}">${labels[role] || role}</span>
        <span class="file-rows">${file.loaded.rows.length}행</span>
        <button class="file-remove" type="button" data-index="${index}" aria-label="빼기">×</button>
      </li>`;
    }).join('');
    list.querySelectorAll('.file-remove').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        state.files.splice(index, 1);
        renderFiles();
        if (state.files.length >= 2) mergeStreams();
        else if (state.files.length === 1) adoptLoaded(state.files[0].loaded, state.files[0].name);
        else resetAnalysis();
      });
    });
  }

  function renderAlignment() {
    const box = $('alignReport');
    if (!box) return;
    const report = state.alignment;
    if (!report) {
      box.innerHTML = '<p class="muted">파일을 2개 이상 올리면 스트림별 결합 행 수와 매칭률을 보여줍니다.</p>';
      return;
    }
    const label = { bp: '혈압', wearable: '웨어러블', environment: '환경', other: '기타' };
    const rows = report.streams.map((stream) => `
      <tr>
        <td class="metric-name">${escapeHtml(stream.name)}</td>
        <td>${label[stream.role] || stream.role}</td>
        <td>${stream.matched_rows} / ${stream.rows}</td>
        <td>${stream.unmatched_rows}</td>
      </tr>`).join('');
    const warnings = (report.warnings || []).map((w) => `<p class="warn">${escapeHtml(w)}</p>`).join('');
    box.innerHTML = `
      <div class="align-head">
        <span class="align-badge">${report.mode === 'daily' ? '일별 집계' : `±${report.tolerance_minutes}분`}</span>
        <span>앵커 <b>${label[report.anchor] || report.anchor}</b> · 매칭 <b>${report.anchors_matched}/${report.anchors}</b> (${report.match_rate_pct}%)</span>
        <span class="muted">행 ${report.rows_in} → ${report.rows_out}</span>
      </div>
      <div class="table-scroll">
        <table class="data-table align-table">
          <thead><tr><th>스트림</th><th>역할</th><th>결합 행</th><th>미결합</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${warnings}`;
  }

  function renderQc() {
    const qc = state.qc;
    const status = $('qcStatus');
    if (!qc) {
      status.textContent = '대기';
      status.className = 'status-pill';
      return;
    }
    const ok = qc.rowsOut > 0;
    status.textContent = ok ? '통과' : '확인 필요';
    status.className = `status-pill ${ok ? 'ok' : 'warn'}`;

    $('qcRows').textContent = `${qc.rowsOut} / ${qc.rowsIn}`;
    $('qcDays').textContent = qc.span ? `${qc.span.days}일` : '—';
    $('qcCond').textContent = Object.entries(qc.conditions).map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
    const removedTotal = Object.values(qc.removed).reduce((s, v) => s + v, 0);
    $('qcRemoved').textContent = `${removedTotal} · ${qc.duplicatesRemoved}`;
    $('qcGap').textContent = qc.maxGap ? `${fmt(qc.maxGap, 1)}시간` : '—';
    $('qcFlags').textContent = `${qc.flagged}행`;

    const notes = [];
    if (qc.subjects.length > 1) notes.push(`<p>피험자 ${qc.subjects.length}명 · 대응표본 비교가 가능합니다.</p>`);
    const removedParts = Object.entries(qc.removed).map(([k, v]) => `${k.toUpperCase()} ${v}건`);
    if (removedTotal) notes.push(`<p class="warn">생리적 범위 밖 값을 제거했습니다 — ${removedParts.join(' · ')}</p>`);
    if (qc.inconsistent) notes.push(`<p class="warn">SBP ≤ DBP 모순 쌍 ${qc.inconsistent}건을 제외했습니다.</p>`);
    if (qc.duplicatesRemoved) notes.push(`<p>정확 중복·60초 내 재동기화 ${qc.duplicatesRemoved}건을 한 번의 측정으로 축약했습니다.</p>`);
    if (qc.gaps.length) notes.push(`<p>${GAP_HOURS}시간 이상 공백 ${qc.gaps.length}건 (최대 ${fmt(qc.maxGap, 1)}시간) — 보정하지 않고 그대로 비교합니다.</p>`);
    const missingHigh = Object.entries(qc.missing).filter(([, v]) => v > 15).map(([k, v]) => `${k.toUpperCase()} ${v}%`);
    if (missingHigh.length) notes.push(`<p>결측이 많은 열: ${missingHigh.join(' · ')}</p>`);
    state.warnings.forEach((w) => notes.push(`<p class="warn">${escapeHtml(w)}</p>`));
    if (!notes.length) notes.push('<p class="muted">범위·모순·중복 이상이 없습니다.</p>');
    $('qcNotes').innerHTML = notes.join('');
  }

  function toneClass(kind) {
    if (kind === 'good') return 'tone-good';
    if (kind === 'warn') return 'tone-warn';
    return '';
  }

  function renderSummary() {
    const rows = state.rows;
    if (!rows.length) return;
    const stats = summarize(rows, state.hrvMetric);
    const cards = $('summaryCards').children;

    cards[0].innerHTML = `<span class="stat-label">평균 혈압</span><span class="stat-value">${fmt(stats.sbp, 0)} / ${fmt(stats.dbp, 0)}</span><span class="stat-note">SBP / DBP mmHg · n=${stats.sbpN}</span>`;
    cards[1].innerHTML = `<span class="stat-label">MAP · 맥압</span><span class="stat-value">${fmt(stats.map, 1)} <span style="font-size:14px;color:var(--muted)">/ ${fmt(stats.pp, 1)}</span></span><span class="stat-note">mmHg · DBP+(SBP−DBP)/3</span>`;

    const dailyMode = state.alignment && state.alignment.mode === 'daily';
    const dip = stats.dipping;
    if (dailyMode) {
      cards[2].innerHTML = `<span class="stat-label">야간 하강률</span><span class="stat-value">—</span><span class="stat-note">일별 집계 모드 — 야간/주간 구분 없음</span>`;
    } else if (dip.available) {
      const good = dip.category === 'normal dipping';
      cards[2].innerHTML = `<span class="stat-label">야간 하강률</span><span class="stat-value">${dip.value.toFixed(1)}%</span><span class="stat-note"><span class="${good ? 'tone-good' : 'tone-warn'}">${dip.category}</span> · 주 ${dip.nDay}/야 ${dip.nNight}</span>`;
    } else {
      cards[2].innerHTML = `<span class="stat-label">야간 하강률</span><span class="stat-value">—</span><span class="stat-note">${dip.reason}</span>`;
    }

    const rec = stats.recovery;
    if (dailyMode) {
      cards[3].innerHTML = `<span class="stat-label">HRV 회복 지수</span><span class="stat-value">—</span><span class="stat-note">일별 집계 모드 — 야간/주간 구분 없음</span>`;
    } else if (rec.available) {
      const good = rec.index >= 95;
      cards[3].innerHTML = `<span class="stat-label">HRV 회복 지수</span><span class="stat-value">${rec.index.toFixed(0)}</span><span class="stat-note"><span class="${good ? 'tone-good' : 'tone-warn'}">${rec.band}</span> · ${rec.baseline}</span>`;
    } else {
      cards[3].innerHTML = `<span class="stat-label">HRV 회복 지수</span><span class="stat-value">—</span><span class="stat-note">${rec.reason}</span>`;
    }

    const envNote = [Number.isFinite(stats.temp_c) ? `기온 ${fmt(stats.temp_c, 1)}°C` : null,
      Number.isFinite(stats.green_index) ? `녹지 ${fmt(stats.green_index, 2)}` : null].filter(Boolean).join(' · ');
    cards[4].innerHTML = `<span class="stat-label">환경 노출</span><span class="stat-value">${Number.isFinite(stats.pm25) ? fmt(stats.pm25, 1) : '—'}</span><span class="stat-note">PM2.5 µg/m³${envNote ? ` · ${envNote}` : ''}</span>`;

    const stress = stats.stress;
    if (stress.available) {
      const good = stress.index < 50;
      cards[5].innerHTML = `<span class="stat-label">환경 스트레스 지수</span><span class="stat-value">${stress.index.toFixed(1)}</span><span class="stat-note"><span class="${good ? 'tone-good' : 'tone-warn'}">${stress.band}</span> · BP ${fmt(stress.components.bp_load, 0)} · HRV ${fmt(stress.components.hrv_suppression, 0)}</span>`;
    } else {
      cards[5].innerHTML = `<span class="stat-label">환경 스트레스 지수</span><span class="stat-value">—</span><span class="stat-note">구성 요소 없음</span>`;
    }

    $('summaryScope').textContent = `${stats.days}일 · ${stats.rows}행${stats.subjects > 1 ? ` · ${stats.subjects}명` : ''}`;
    $('chartMeta').textContent = `${fmtDate(rows[0].timestamp)} → ${fmtDate(rows[rows.length - 1].timestamp)}`;
    $('hrvLabel').textContent = state.hrvMetric === 'sdnn' ? 'SDNN' : 'RMSSD';
  }

  function renderCompare() {
    const head = $('compareHead');
    const tbody = $('compareTable').querySelector('tbody');
    const note = $('pairModeNote');
    const conditions = [...new Set(state.rows.map((r) => r.condition).filter(Boolean))];
    if (conditions.length < 2) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted">조건이 두 개 이상 있는 데이터를 불러오면 비교표가 채워집니다.</td></tr>';
      if (note) note.textContent = '조건 라벨이 두 개 이상 있어야 비교할 수 있습니다.';
      return;
    }
    const metrics = ['sbp', 'dbp', 'map', 'pp', 'hr', 'rmssd', 'sdnn'];
    const result = compareTable(state.rows, metrics, state.groupA, state.groupB, state.paired);
    const mode = result.mode;
    const pairedMode = mode === 'subject' || mode === 'row';
    head.innerHTML = pairedMode
      ? `<tr><th>지표</th><th>A 평균</th><th>B 평균</th><th>Δ (A−B)</th><th>%</th><th>Cohen's d_z</th><th>효과</th><th>p</th><th>순열 p</th><th>95% CI</th></tr>`
      : `<tr><th>지표</th><th>A 평균</th><th>B 평균</th><th>Δ (A−B)</th><th>%</th><th>Cohen's d</th><th>효과</th><th>p</th><th>95% CI</th></tr>`;
    if (!result.rows.length) {
      tbody.innerHTML = `<tr><td colspan="${pairedMode ? 10 : 9}" class="muted">선택한 조건에 측정값이 부족합니다.</td></tr>`;
      return;
    }
    const first = result.rows[0];
    const foot = document.querySelector('#compare .table-foot');
    const testLabel = mode === 'subject' ? `대응표본 t-test (피험자 ${result.nSubjects}명)`
      : mode === 'row' ? '대응표본 t-test (시간순 짝짓기)'
        : 'Welch t-test (독립표본)';
    if (foot) {
      foot.textContent = `A = ${state.groupA} (n=${first.nA}) · B = ${state.groupB} (n=${first.nB}) · ${testLabel} · `
        + '효과크기: |d| < 0.2 무시 · 0.2–0.5 작음 · 0.5–0.8 중간 · ≥ 0.8 큼. p는 다중비교 보정 전 값입니다.';
    }
    if (note) {
      note.textContent = result.note || (mode === 'subject'
        ? `subject_id 대응표본 — 양쪽 조건에 모두 측정된 ${result.nSubjects}명의 평균을 짝지었습니다.`
        : pairedMode ? '대응표본(시간순 짝짓기)으로 계산했습니다.' : '독립표본(Welch)으로 계산했습니다. 같은 사람의 두 조건이라면 대응표본을 켜세요.');
    }
    const label = (m) => METRIC_LABELS[m] || m;
    tbody.innerHTML = result.rows.map((row) => {
      const sig = row.p < 0.05;
      const dValue = pairedMode ? row.dz : row.d;
      const dClass = row.effect === 'large' ? 'large' : row.effect === 'medium' ? 'medium' : row.effect === 'negligible' ? 'negligible' : '';
      const diffClass = row.diff > 0 ? 'pos' : row.diff < 0 ? 'neg' : '';
      return `<tr>
        <td class="metric-name">${sig ? '<span class="sig-dot"></span>' : ''}${label(row.metric)}</td>
        <td>${fmt(row.meanA, 1)}</td>
        <td>${fmt(row.meanB, 1)}</td>
        <td class="${diffClass}">${row.diff > 0 ? '+' : ''}${fmt(row.diff, 1)}</td>
        <td class="${diffClass}">${pctText(row.pct, 1)}</td>
        <td>${fmt(dValue, 2)}</td>
        <td><span class="effect-tag ${dClass}">${row.effect}</span></td>
        <td>${fmtP(row.p)}</td>
        ${pairedMode ? `<td>${fmtP(row.permP)}</td>` : ''}
        <td class="muted">${fmt(row.ciLow, 1)} … ${fmt(row.ciHigh, 1)}</td>
      </tr>`;
    }).join('');
  }

  function renderExposure() {
    const tbody = $('exposureTable').querySelector('tbody');
    const conditions = [...new Set(state.rows.map((r) => r.condition).filter(Boolean))];
    if (!conditions.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">조건 정보가 없습니다.</td></tr>';
      return;
    }
    const summary = conditionSummary(state.rows, ['pm25', 'temp_c', 'humidity_pct', 'green_index', 'forest']);
    tbody.innerHTML = summary.map((row) => `<tr>
      <td class="metric-name">${row.condition}</td>
      <td>${row.n}</td>
      <td>${fmt(row.pm25, 1)}</td>
      <td>${fmt(row.temp_c, 1)}</td>
      <td>${fmt(row.humidity_pct, 0)}</td>
      <td>${fmt(row.green_index, 2)}</td>
      <td>${Number.isFinite(row.forest) ? (row.forest >= 0.5 ? '숲' : '도시') : '—'}</td>
    </tr>`).join('');
  }

  function renderPreview() {
    const tbody = $('previewTable').querySelector('tbody');
    if (!state.rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="muted">—</td></tr>';
      return;
    }
    tbody.innerHTML = state.rows.slice(0, 8).map((row) => `<tr>
      <td class="metric-name">${fmtStamp(row.timestamp)}</td>
      <td>${row[SUBJECT] || '—'}</td>
      <td>${row.condition || '—'}</td>
      <td>${fmt(row.sbp, 0)}</td>
      <td>${fmt(row.dbp, 0)}</td>
      <td>${fmt(row.hr, 0)}</td>
      <td>${fmt(row.rmssd, 0)}</td>
      <td>${fmt(row.pm25, 1)}</td>
      <td class="muted">${escapeHtml(row.flags || '—')}</td>
    </tr>`).join('');
  }

  function renderMethodology() {
    const tbody = $('methodologyTable').querySelector('tbody');
    const refs = $('methodRefs');
    const rows = METHODOLOGY.map((item) => `<tr>
      <td class="metric-name">${escapeHtml(item.label)}</td>
      <td><span class="kind-badge kind-${item.kind}">${KIND_LABELS[item.kind] || item.kind}</span></td>
      <td>${escapeHtml(item.unit || '—')}</td>
      <td class="mono-cell">${escapeHtml(item.formula || '—')}</td>
      <td class="boundary-cell">${escapeHtml(item.boundary)}</td>
    </tr>`).join('');
    tbody.innerHTML = rows;
    $('methodologyScope').textContent = `${METHODOLOGY.length}개 지표 · v${VERSION}`;
    refs.innerHTML = Object.values(REFERENCES).map((ref) => `<li>${escapeHtml(ref)}</li>`).join('');
  }

  /* ----------------------------------------------------------------- charts */
  const INK = '#141413';
  const MUTED = '#6b6a66';
  const LINE = '#dedbd0';
  const BRONZE = '#d97757';
  const SAGE = '#5c6b5a';

  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 400;
    const height = canvas.clientHeight || 200;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
  }

  function niceRange(min, max, pad = 0.08) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    return [min - span * pad, max + span * pad];
  }

  function conditionBands(ctx, rows, x, top, bottom) {
    let start = 0;
    for (let i = 1; i <= rows.length; i += 1) {
      if (i === rows.length || rows[i].condition !== rows[start].condition) {
        const condition = rows[start].condition;
        if (condition) {
          ctx.fillStyle = condition === 'forest' ? 'rgba(92,107,90,0.12)' : 'rgba(20,20,19,0.045)';
          const x0 = x(rows[start].timestamp);
          const x1 = i < rows.length ? x(rows[i].timestamp) : x(rows[rows.length - 1].timestamp);
          ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
        }
        start = i;
      }
    }
  }

  function drawAxes(ctx, width, height, xStart, xEnd, yMin, yMax, xTicks) {
    const padLeft = 46;
    const padRight = 12;
    const padTop = 10;
    const padBottom = 24;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;
    const x = (t) => padLeft + (t - xStart) / Math.max(1, xEnd - xStart) * plotW;
    const y = (v) => padTop + (1 - (v - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

    ctx.strokeStyle = LINE;
    ctx.fillStyle = MUTED;
    ctx.font = '10px ' + 'SFMono-Regular, Menlo, monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i += 1) {
      const value = yMin + (yMax - yMin) * (i / 4);
      const yPos = y(value);
      ctx.beginPath();
      ctx.moveTo(padLeft, yPos);
      ctx.lineTo(width - padRight, yPos);
      ctx.stroke();
      ctx.fillText(`${Math.round(value)}`, padLeft - 8, yPos);
    }
    ctx.textBaseline = 'top';
    xTicks.forEach((tick) => {
      ctx.textAlign = tick.align || 'center';
      ctx.fillText(tick.label, x(tick.time), height - padBottom + 7);
    });
    return { x, y, padLeft, padRight, padTop, padBottom, plotW, plotH };
  }

  function xTicksFor(rows, count = 5) {
    const start = rows[0].timestamp.getTime();
    const end = rows[rows.length - 1].timestamp.getTime();
    const ticks = [];
    for (let i = 0; i < count; i += 1) {
      const time = start + (end - start) * (i / (count - 1));
      const align = i === 0 ? 'left' : i === count - 1 ? 'right' : 'center';
      ticks.push({ time, label: fmtShort(new Date(time)), align });
    }
    return ticks;
  }

  function drawSeries(canvas, rows, series, options) {
    const { ctx, width, height } = setupCanvas(canvas);
    if (!rows.length) return;
    const start = rows[0].timestamp.getTime();
    const end = rows[rows.length - 1].timestamp.getTime();
    let min = Infinity;
    let max = -Infinity;
    series.forEach((s) => rows.forEach((r) => {
      const v = r[s.key];
      if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    }));
    const [yMin, yMax] = niceRange(min, max);
    const axes = drawAxes(ctx, width, height, start, end, yMin, yMax, xTicksFor(rows));
    conditionBands(ctx, rows, axes.x, axes.padTop, height - axes.padBottom);

    series.forEach((s) => {
      const points = rows.filter((r) => Number.isFinite(r[s.key]));
      if (!points.length) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width || 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = axes.x(point.timestamp);
        const py = axes.y(point[s.key]);
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      if (s.dots !== false) {
        ctx.fillStyle = s.color;
        points.forEach((point) => {
          ctx.beginPath();
          ctx.arc(axes.x(point.timestamp), axes.y(point[s.key]), 2.6, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    const first = series[0];
    const valid = rows.filter((r) => Number.isFinite(r[first.key]));
    if (valid.length && options.endLabel !== false) {
      const last = valid[valid.length - 1];
      const px = axes.x(last.timestamp);
      const py = axes.y(last[first.key]);
      ctx.fillStyle = first.color;
      ctx.font = '600 10px SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const label = `${Math.round(last[first.key])}`;
      const anchorX = Math.min(px, width - axes.padRight - 2);
      ctx.fillText(label, anchorX, py - 5);
    }
  }

  function drawScatter(canvas, rows, xKey, yKey) {
    const { ctx, width, height } = setupCanvas(canvas);
    const pairs = rows.filter((r) => Number.isFinite(r[xKey]) && Number.isFinite(r[yKey]));
    if (!pairs.length) {
      ctx.fillStyle = MUTED;
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('선택한 지표에 함께 있는 값이 없습니다', width / 2, height / 2);
      return { available: false, n: 0 };
    }
    const xs = pairs.map((p) => p[xKey]);
    const ys = pairs.map((p) => p[yKey]);
    const [xMin, xMax] = niceRange(Math.min(...xs), Math.max(...xs), 0.1);
    const [yMin, yMax] = niceRange(Math.min(...ys), Math.max(...ys), 0.1);
    const axes = drawAxes(ctx, width, height, xMin, xMax, yMin, yMax,
      [0, 1, 2, 3, 4].map((i) => ({
        time: xMin + (xMax - xMin) * i / 4,
        label: fmt(xMin + (xMax - xMin) * i / 4, xMax < 3 ? 2 : 0),
        align: i === 0 ? 'left' : i === 4 ? 'right' : 'center',
      })));

    const stat = correlationRow(rows, xKey, yKey);
    if (stat.available && Number.isFinite(stat.slope)) {
      ctx.strokeStyle = BRONZE;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(axes.x(xMin), axes.y(clamp(stat.intercept + stat.slope * xMin, yMin, yMax)));
      ctx.lineTo(axes.x(xMax), axes.y(clamp(stat.intercept + stat.slope * xMax, yMin, yMax)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    pairs.forEach((point) => {
      ctx.fillStyle = point.condition === 'forest' ? SAGE : point.condition === 'urban' ? INK : BRONZE;
      ctx.globalAlpha = point.condition ? 0.72 : 0.5;
      ctx.beginPath();
      ctx.arc(axes.x(point[xKey]), axes.y(point[yKey]), 3.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (stat.available) {
      ctx.fillStyle = INK;
      ctx.font = '600 11px SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`r = ${stat.r.toFixed(2)} · ρ = ${stat.rho.toFixed(2)} · n = ${stat.n}`, axes.padLeft + 8, axes.padTop + 6);
    }
    return stat;
  }

  function renderCharts() {
    const rows = state.rows;
    if (!rows.length) return;
    drawSeries($('bpChart'), rows, [
      { key: 'sbp', color: BRONZE, width: 1.8 },
      { key: 'dbp', color: 'rgba(20,20,19,0.5)', width: 1.4, dots: false },
    ], {});

    drawSeries($('hrvChart'), rows, [{ key: state.hrvMetric, color: SAGE, width: 1.8 }], {});

    const stat = drawScatter($('corrChart'), rows, state.corrX, state.corrY);
    $('corrTitle').textContent = `${METRIC_LABELS[state.corrX] || state.corrX} × ${METRIC_LABELS[state.corrY] || state.corrY}`;
    if (stat.available) {
      const strength = Math.abs(stat.r) < 0.2 ? '거의 없음' : Math.abs(stat.r) < 0.4 ? '약함' : Math.abs(stat.r) < 0.6 ? '중간' : '강함';
      const pText = !Number.isFinite(stat.slopeP) ? 'p=—' : stat.slopeP < 0.0001 ? 'p<0.0001' : `p=${stat.slopeP.toFixed(4)}`;
      $('corrNote').textContent = `Pearson r = ${stat.r.toFixed(2)} (${strength}, ${stat.r >= 0 ? '양의' : '음의'} 상관) · `
        + `Spearman ρ = ${stat.rho.toFixed(2)} · 기울기 ${round(stat.slope, 3)} (${pText}) · n = ${stat.n} · 상관은 인과가 아닙니다.`;
    } else {
      $('corrNote').textContent = '상관을 계산할 공통 측정값이 부족합니다.';
    }
  }

  /* -------------------------------------------------------------- selectors */
  function populateSelectors() {
    const conditions = [...new Set(state.rows.map((r) => r.condition).filter(Boolean))];
    const fallback = conditions.length ? conditions : ['forest', 'urban'];
    const build = (select, value) => {
      select.innerHTML = fallback.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      select.value = fallback.includes(value) ? value : fallback[0];
    };
    build($('groupA'), state.groupA);
    build($('groupB'), state.groupB);
    state.groupA = $('groupA').value;
    state.groupB = $('groupB').value;
    if (state.groupB === state.groupA) {
      const other = fallback.find((c) => c !== state.groupA);
      if (other) { state.groupB = other; $('groupB').value = other; }
    }

    const metricOptions = [
      ['pm25', 'PM2.5'], ['green_index', '녹지'], ['temp_c', '기온'], ['humidity_pct', '습도'],
      ['env_load', '환경부하'], ['sbp', 'SBP'], ['dbp', 'DBP'], ['map', 'MAP'], ['hr', 'HR'],
      ['rmssd', 'RMSSD'], ['sdnn', 'SDNN'],
    ];
    const fill = (select, value) => {
      select.innerHTML = metricOptions.map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
      select.value = metricOptions.some(([key]) => key === value) ? value : metricOptions[0][0];
    };
    fill($('corrX'), state.corrX);
    fill($('corrY'), state.corrY);
    state.corrX = $('corrX').value;
    state.corrY = $('corrY').value;
  }

  function renderMapping() {
    const entries = Object.entries(state.mapping || {});
    $('mapCount').textContent = entries.length ? `${entries.length}개 열` : '—';
    const list = $('mapList');
    if (!entries.length) {
      list.innerHTML = '<li class="muted">매핑된 열이 없습니다.</li>';
      return;
    }
    list.innerHTML = entries.map(([canonical, raw]) => `<li><span>${escapeHtml(raw)}</span><span class="arrow">→</span><span>${escapeHtml(canonical)}</span></li>`).join('');
  }

  /* ------------------------------------------------------------------- load */
  function adopt(loaded, fileName) {
    const cleaned = cleanRows(loaded.rows.map((row) => ({ ...row })));
    if (!cleaned.rows.length) throw new Error('유효한 측정 행이 없습니다. 시각과 값 열을 확인해 주세요.');
    state.rows = addDerived(cleaned.rows);
    state.qc = cleaned.qc;
    state.mapping = loaded.mapping || {};
    state.unmapped = loaded.unmapped || [];
    state.warnings = [...(loaded.warnings || []), ...(cleaned.qc.warnings || [])];
    state.source = loaded.source;
    state.fileName = fileName;

    if (!state.rows.some((r) => Number.isFinite(r.rmssd)) && state.rows.some((r) => Number.isFinite(r.sdnn))) {
      state.hrvMetric = 'sdnn';
    } else if (state.rows.some((r) => Number.isFinite(r.rmssd))) {
      state.hrvMetric = 'rmssd';
    }

    $('fileMeta').innerHTML = `<b>${escapeHtml(fileName)}</b> · ${escapeHtml(String(loaded.source).toUpperCase())} · ${cleaned.qc.rowsOut}행 유효 · `
      + `${Object.keys(state.mapping).length}개 열 인식${state.unmapped.length ? ` · 미인식 ${state.unmapped.length}` : ''}`;

    renderMapping();
    populateSelectors();
    renderAll();
    renderAlignment();
  }

  function adoptLoaded(loaded, fileName) {
    state.alignment = null;
    adopt(loaded, fileName);
  }

  function adoptAligned(aligned, label) {
    state.alignment = aligned.report;
    if (!aligned.rows.length) throw new Error('결합된 행이 없습니다. 허용 오차나 파일 구성을 확인해 주세요.');
    const merged = { rows: aligned.rows, mapping: { ...state.files.reduce((acc, f) => ({ ...acc, ...f.loaded.mapping }), {}) }, unmapped: [], warnings: [], source: 'aligned' };
    adopt(merged, label);
  }

  async function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    for (const file of incoming) {
      try {
        const text = await file.text();
        const loaded = loadText(text, file.name);
        state.files.push({ name: file.name, loaded });
      } catch (error) {
        console.error(error);
        toast(`${file.name} · ${error.message}`);
      }
    }
    renderFiles();
    if (!state.files.length) return;
    if (state.files.length === 1) {
      adoptLoaded(state.files[0].loaded, state.files[0].name);
      toast(`${state.files[0].name} · ${state.qc.rowsOut}행을 분석했습니다`);
    } else {
      mergeStreams();
    }
  }

  function mergeStreams() {
    if (state.files.length < 2) {
      if (state.files.length === 1) adoptLoaded(state.files[0].loaded, state.files[0].name);
      return;
    }
    try {
      const daily = state.tolerance === 'daily';
      const tolerance = daily ? 0 : Number(state.tolerance) || 0;
      const aligned = alignStreams(
        state.files.map((file) => ({ name: file.name, rows: file.loaded.rows })),
        tolerance,
        daily ? 'daily' : 'tolerance',
      );
      const label = state.files.map((f) => f.name).join(' + ');
      adoptAligned(aligned, label);
      toast(`스트림 ${state.files.length}개를 ${daily ? '일별로' : `±${tolerance}분으로`} 결합했습니다 · 매칭 ${aligned.report.match_rate_pct}%`);
    } catch (error) {
      console.error(error);
      toast(`결합하지 못했습니다: ${error.message}`);
    }
  }

  function loadDemo() {
    const rows = generateDemo();
    state.files = [];
    renderFiles();
    adoptLoaded({
      rows,
      mapping: { timestamp: 'timestamp', subject_id: 'subject_id', condition: 'condition', sbp: 'sbp', dbp: 'dbp', hr: 'hr', rmssd: 'rmssd', sdnn: 'sdnn', pm25: 'pm25', temp_c: 'temp_c', green_index: 'green_index', activity: 'activity' },
      unmapped: [], warnings: [], source: 'synthetic',
    }, 'synthetic_demo_14d.csv');
    toast('합성 데모 14일 · 도시 가로 vs 산림치유를 계산했습니다');
  }

  function loadCohortDemo() {
    const rows = generateCohort(6, 8, 123);
    const streams = splitCohortStreams(rows);
    state.files = streams.map((stream) => ({
      name: stream.name,
      loaded: { rows: stream.rows, mapping: { timestamp: 'timestamp', subject_id: 'subject_id', condition: 'condition' }, unmapped: [], warnings: [], source: 'synthetic' },
    }));
    state.tolerance = '30';
    const select = $('toleranceSelect');
    if (select) select.value = '30';
    renderFiles();
    mergeStreams();
    toast('코호트 데모 6인 · 3개 스트림을 ±30분으로 결합했습니다');
  }

  function resetAnalysis() {
    state.rows = [];
    state.qc = null;
    state.mapping = {};
    state.warnings = [];
    state.alignment = null;
    state.fileName = '—';
    $('fileMeta').textContent = '아직 불러온 파일이 없습니다.';
    $('qcStatus').textContent = '대기';
    $('qcStatus').className = 'status-pill';
    $('mapCount').textContent = '—';
    $('mapList').innerHTML = '<li class="muted">파일을 불러오면 매핑 결과가 표시됩니다.</li>';
    $('qcNotes').innerHTML = '<p class="muted">데모를 불러오면 세 가지 인위적 결함이 어떻게 처리되는지 볼 수 있습니다.</p>';
    ['qcRows', 'qcDays', 'qcCond', 'qcRemoved', 'qcGap', 'qcFlags', 'summaryScope', 'chartMeta'].forEach((id) => { $(id).textContent = '—'; });
    $('compareTable').querySelector('tbody').innerHTML = '<tr><td colspan="9" class="muted">조건이 두 개 이상 있는 데이터를 불러오면 비교표가 채워집니다.</td></tr>';
    $('exposureTable').querySelector('tbody').innerHTML = '<tr><td colspan="7" class="muted">—</td></tr>';
    $('previewTable').querySelector('tbody').innerHTML = '<tr><td colspan="9" class="muted">—</td></tr>';
    $('exportCsv').disabled = true;
    $('exportJson').disabled = true;
    $('exportMd').disabled = true;
    const cards = $('summaryCards').children;
    const labels = ['평균 혈압|SBP / DBP', 'MAP · 맥압|mmHg', '야간 하강률|22:00–06:00', 'HRV 회복 지수|야간/주간 HRV', '환경 노출|PM2.5 · 기온', '환경 스트레스 지수|0–100 연구 지표'];
    cards.forEach((card, index) => {
      const [label, note] = labels[index].split('|');
      card.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">—</span><span class="stat-note">${note}</span>`;
    });
    ['bpChart', 'hrvChart', 'corrChart'].forEach((id) => {
      const canvas = $(id);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    renderAlignment();
  }

  function reset() {
    state.files = [];
    renderFiles();
    resetAnalysis();
    toast('초기화했습니다');
  }

  /* ---------------------------------------------------------------- export */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function buildBundle() {
    const rows = state.rows;
    const stats = summarize(rows, state.hrvMetric);
    const comparison = compareTable(rows, ['sbp', 'dbp', 'map', 'pp', 'hr', 'rmssd', 'sdnn'], state.groupA, state.groupB, state.paired);
    const exposure = conditionSummary(rows, ['pm25', 'pm10', 'temp_c', 'humidity_pct', 'green_index', 'forest']);
    const conditions = conditionSummary(rows, ['sbp', 'dbp', 'map', 'pp', 'hr', 'rmssd', 'sdnn', 'pm25', 'temp_c']);
    const correlations = correlationRows(rows);
    const nSubjects = stats.subjects;
    const pairedBy = comparison.mode;
    return {
      meta: {
        schema_version: SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        heartmetric_version: `${VERSION}-web`,
        license: 'MIT · Copyright (c) 2026 FEI · HEL Lab, Gyeongsang National University',
        comparison: { a: state.groupA, b: state.groupB, paired: state.paired, paired_by: pairedBy, n_subjects: nSubjects, note: comparison.note || undefined },
        night_window: '22:00–06:00',
        alignment: state.alignment || undefined,
        input: { file: state.fileName, source: state.source, streams: state.files.map((f) => f.name) },
        disclaimer: 'Research summary of the submitted series; not a medical diagnosis. The hardware boundary stands: a cuff measure is the only blood-pressure source and Oura reports no mmHg BP.',
      },
      quality: {
        rows_in: state.qc.rowsIn,
        rows_out: state.qc.rowsOut,
        duplicates_removed: state.qc.duplicatesRemoved,
        removed_out_of_range: state.qc.removed,
        removed_inconsistent: state.qc.inconsistent,
        missing_pct: state.qc.missing,
        max_gap_hours: state.qc.maxGap,
        gaps: state.qc.gaps,
        conditions: state.qc.conditions,
        subjects: state.qc.subjects,
        span: state.qc.span,
        warnings: state.warnings,
      },
      summary: {
        rows: stats.rows,
        days: stats.days,
        subjects: stats.subjects,
        sbp: round(stats.sbp, 1),
        dbp: round(stats.dbp, 1),
        map: round(stats.map, 1),
        pp: round(stats.pp, 1),
        hr: round(stats.hr, 1),
        rmssd: round(stats.rmssd, 1),
        sdnn: round(stats.sdnn, 1),
        pm25: round(stats.pm25, 1),
        temp_c: round(stats.temp_c, 1),
        green_index: round(stats.green_index, 3),
        bp_load_pct: round(stats.load.either, 1),
        dipping: {
          available: stats.dipping.available,
          day_mean: round(stats.dipping.dayMean, 1),
          night_mean: round(stats.dipping.nightMean, 1),
          dipping_pct: round(stats.dipping.value, 1),
          category: stats.dipping.category,
          n_day: stats.dipping.nDay,
          n_night: stats.dipping.nNight,
        },
        hrv_recovery: {
          available: stats.recovery.available,
          index: round(stats.recovery.index, 1),
          band: stats.recovery.band,
          baseline: stats.recovery.baseline,
          resting_mean_ms: round(stats.recovery.restingMean, 1),
          day_mean_ms: round(stats.recovery.dayMean, 1),
        },
        stress_index: {
          available: stats.stress.available,
          index: round(stats.stress.index, 1),
          band: stats.stress.band,
          components: Object.fromEntries(Object.entries(stats.stress.components || {}).map(([k, v]) => [k, round(v, 1)])),
        },
      },
      conditions: conditions.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? round(v, 2) : v]))),
      exposure: exposure.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' ? round(v, 2) : v]))),
      comparison: comparison.rows.map((row) => ({
        metric: row.metric,
        paired_by: pairedBy,
        n_subjects: row.nSubjects,
        n_a: row.nA,
        mean_a: round(row.meanA, 2),
        n_b: row.nB,
        mean_b: round(row.meanB, 2),
        diff: round(row.diff, 2),
        pct_change: round(row.pct, 1),
        cohens_d: round(row.d, 2),
        cohens_dz: round(row.dz, 2),
        effect: row.effect,
        test: row.test,
        p_value: Number.isFinite(row.p) ? Number(row.p.toPrecision(4)) : null,
        permutation_p: Number.isFinite(row.permP) ? Number(row.permP.toPrecision(4)) : null,
        sign_test_p: Number.isFinite(row.signP) ? Number(row.signP.toPrecision(4)) : null,
        ci_low: round(row.ciLow, 2),
        ci_high: round(row.ciHigh, 2),
      })),
      daily: dailyTable(rows),
      correlations: correlations.map((row) => ({
        x: row.x, y: row.y, n: row.n,
        pearson_r: round(row.r, 3),
        pearson_p: Number.isFinite(row.rP) ? Number(row.rP.toPrecision(3)) : null,
        spearman_rho: round(row.rho, 3),
        spearman_p: Number.isFinite(row.rhoP) ? Number(row.rhoP.toPrecision(3)) : null,
        slope: round(row.slope, 4),
        intercept: round(row.intercept, 3),
        slope_p: Number.isFinite(row.slopeP) ? Number(row.slopeP.toPrecision(3)) : null,
        r_squared: round(row.r2, 3),
      })),
      methodology: {
        version: VERSION,
        note: 'measured = recorded by a device; derived = arithmetic on measured values; exploratory = laboratory summary with chosen weights. None is a diagnosis.',
        references: REFERENCES,
        indicators: Object.fromEntries(METHODOLOGY.map((item) => [item.key, item])),
      },
      series: rows.map((row) => {
        const item = { timestamp: fmtStamp(row.timestamp) };
        if (row[SUBJECT]) item.subject_id = row[SUBJECT];
        if (row.condition) item.condition = row.condition;
        METRIC_COLUMNS.concat(DERIVED_COLUMNS).forEach((key) => { if (Number.isFinite(row[key])) item[key] = round(row[key], 2); });
        if (row.activity) item.activity = row.activity;
        if (row.flags) item.flags = row.flags;
        return item;
      }),
    };
  }

  function exportCsv() {
    if (!state.rows.length) return;
    const header = STANDARD_COLUMNS.concat(DERIVED_COLUMNS).join(',');
    const escape = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header];
    state.rows.forEach((row) => {
      lines.push(STANDARD_COLUMNS.concat(DERIVED_COLUMNS).map((column) => {
        if (column === 'timestamp') return escape(fmtStamp(row.timestamp));
        if (column === 'condition') return escape(row.condition || '');
        if (column === SUBJECT) return escape(row[SUBJECT] || '');
        if (column === 'activity' || column === 'notes' || column === 'source' || column === 'flags') {
          return escape(row[column] || '');
        }
        const value = row[column];
        return escape(Number.isFinite(value) ? Math.round(value * 100) / 100 : '');
      }).join(','));
    });
    download(`heartmetric_cleaned_${fmtDate(new Date())}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
    toast('정리된 CSV를 내려받았습니다');
  }

  function exportJson() {
    if (!state.rows.length) return;
    const bundle = buildBundle();
    download(`heartmetric_bundle_${fmtDate(new Date())}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    toast('분석 번들(JSON, schema 0.2.0)을 내려받았습니다');
  }

  function mdCell(value, digits = 2) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(digits) : '—';
    return String(value).replace(/\|/g, '\\|');
  }

  function markdownReport() {
    const bundle = buildBundle();
    const meta = bundle.meta;
    const quality = bundle.quality;
    const summary = bundle.summary;
    const lines = [];
    lines.push('# HEARTMETRIC 분석 리포트');
    lines.push('');
    lines.push(`**FEI · HEL Lab, 경상국립대학교** · v${VERSION} (bundle schema ${SCHEMA_VERSION})  `);
    lines.push(`생성: ${meta.generated_at} · 100% 로컬 실행 · MIT License`);
    lines.push('');
    lines.push('> 연구 요약입니다. 진단이 아니며, 커프 혈압 측정과 의료진의 판단이 언제나 기준입니다. Oura Health Oy · Apple Inc.와 제휴하지 않은 독립 프로젝트입니다.');
    lines.push('');
    lines.push('## 1. 데이터와 품질');
    lines.push('');
    lines.push(`- 유효 행: **${quality.rows_out}** / 입력 ${quality.rows_in}`);
    lines.push(`- 피험자: ${quality.subjects.length ? quality.subjects.join(', ') : '—'}`);
    if (quality.span) lines.push(`- 관측 기간: ${quality.span.start} → ${quality.span.end} (${quality.span.days}일)`);
    lines.push(`- 조건: ${Object.entries(quality.conditions).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
    lines.push(`- 제거: 범위 밖 ${Object.values(quality.removed_out_of_range).reduce((s, v) => s + v, 0)}건 · 모순 쌍 ${quality.removed_inconsistent}건 · 중복 ${quality.duplicates_removed}건`);
    lines.push(`- 최대 공백: ${quality.max_gap_hours}시간 (보정하지 않음)`);
    const align = bundle.meta.alignment;
    if (align) {
      lines.push(`- 스트림 결합: ${align.mode} · 허용 오차 ${align.tolerance_minutes}분 · 앵커 매칭 ${align.anchors_matched}/${align.anchors} (${align.match_rate_pct}%)`);
      align.streams.forEach((stream) => {
        lines.push(`  - ${stream.name} (${stream.role}): ${stream.matched_rows}/${stream.rows}행 결합`);
      });
    }
    lines.push('');
    lines.push('## 2. 요약 지표');
    lines.push('');
    lines.push('| 지표 | 값 | 단위 | 근거 구분 |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(`| 평균 혈압 (SBP/DBP) | ${mdCell(summary.sbp, 1)} / ${mdCell(summary.dbp, 1)} | mmHg | measured |`);
    lines.push(`| MAP · 맥압 | ${mdCell(summary.map, 1)} / ${mdCell(summary.pp, 1)} | mmHg | derived |`);
    if (summary.dipping.available) lines.push(`| 야간 하강률 | ${mdCell(summary.dipping.dipping_pct, 1)}% (${summary.dipping.category}) | % | derived |`);
    if (summary.hrv_recovery.available) lines.push(`| HRV 회복 지수 | ${mdCell(summary.hrv_recovery.index, 1)} (${summary.hrv_recovery.band}, baseline ${summary.hrv_recovery.baseline}) | index | derived |`);
    if (summary.stress_index.available) lines.push(`| 환경 스트레스 지수 | ${mdCell(summary.stress_index.index, 1)} (${summary.stress_index.band}) | 0–100 | exploratory |`);
    lines.push(`| 평균 PM2.5 | ${mdCell(summary.pm25, 1)} | µg/m³ | measured |`);
    lines.push(`| 평균 기온 | ${mdCell(summary.temp_c, 1)} | °C | measured |`);
    lines.push('');
    lines.push('## 3. 조건별 비교');
    lines.push('');
    lines.push(`A = **${meta.comparison.a}**, B = **${meta.comparison.b}** · 방식: \`${meta.comparison.paired_by}\` · Δ는 A − B`);
    if (meta.comparison.note) lines.push('');
    if (meta.comparison.note) lines.push(`> ${meta.comparison.note}`);
    lines.push('');
    const paired = meta.comparison.paired_by === 'subject' || meta.comparison.paired_by === 'row';
    lines.push(paired
      ? '| metric | n | mean_a | mean_b | diff | cohens_dz | effect | p | permutation_p | ci_low | ci_high |'
      : '| metric | n | mean_a | mean_b | diff | cohens_d | effect | p | ci_low | ci_high |');
    lines.push(paired ? '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    bundle.comparison.forEach((row) => {
      lines.push(paired
        ? `| ${row.metric} | ${row.n_a} | ${mdCell(row.mean_a, 2)} | ${mdCell(row.mean_b, 2)} | ${mdCell(row.diff, 2)} | ${mdCell(row.cohens_dz, 2)} | ${row.effect} | ${row.p_value} | ${row.permutation_p == null ? '—' : row.permutation_p} | ${mdCell(row.ci_low, 2)} | ${mdCell(row.ci_high, 2)} |`
        : `| ${row.metric} | ${row.n_a} | ${mdCell(row.mean_a, 2)} | ${mdCell(row.mean_b, 2)} | ${mdCell(row.diff, 2)} | ${mdCell(row.cohens_d, 2)} | ${row.effect} | ${row.p_value} | ${mdCell(row.ci_low, 2)} | ${mdCell(row.ci_high, 2)} |`);
    });
    lines.push('');
    lines.push('효과크기: |d| < 0.2 무시 · 0.2–0.5 작음 · 0.5–0.8 중간 · ≥ 0.8 큼. p는 다중비교 보정 전 값입니다. 대응표본에서는 d_z를 읽으세요.');
    lines.push('');
    lines.push('## 4. 환경 노출 × 심혈관 상관');
    lines.push('');
    lines.push('| x | y | n | pearson_r | pearson_p | spearman_rho | slope | slope_p | r_squared |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    bundle.correlations.forEach((row) => {
      lines.push(`| ${row.x} | ${row.y} | ${row.n} | ${mdCell(row.pearson_r, 3)} | ${row.pearson_p == null ? '—' : row.pearson_p} | ${mdCell(row.spearman_rho, 3)} | ${mdCell(row.slope, 4)} | ${row.slope_p == null ? '—' : row.slope_p} | ${mdCell(row.r_squared, 3)} |`);
    });
    lines.push('');
    lines.push('r은 선형, ρ는 단조 관계입니다. 기울기는 OLS 추정치이며 관측 범위 밖으로 외삽하지 않습니다. 상관은 인과가 아닙니다.');
    lines.push('');
    lines.push('## 5. 조건별 평균');
    lines.push('');
    lines.push('| 조건 | n | SBP | DBP | HR | RMSSD | PM2.5 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    bundle.conditions.forEach((row) => {
      lines.push(`| ${row.condition} | ${row.n} | ${mdCell(row.sbp, 1)} | ${mdCell(row.dbp, 1)} | ${mdCell(row.hr, 1)} | ${mdCell(row.rmssd, 1)} | ${mdCell(row.pm25, 1)} |`);
    });
    lines.push('');
    lines.push('## 6. 지표 정의와 경계');
    lines.push('');
    lines.push('| 지표 | 구분 | 수식 | 경계 |');
    lines.push('| --- | --- | --- | --- |');
    METHODOLOGY.forEach((item) => {
      lines.push(`| ${item.label} | ${item.kind} | ${item.formula || '—'} | ${item.boundary} |`);
    });
    lines.push('');
    lines.push(`인용: FEI · HEL Lab, Gyeongsang National University. (2026). HEARTMETRIC (v${VERSION}). MIT License.`);
    lines.push('');
    return lines.join('\n');
  }

  function exportMd() {
    if (!state.rows.length) return;
    download(`heartmetric_report_${fmtDate(new Date())}.md`, markdownReport(), 'text/markdown;charset=utf-8');
    toast('Markdown 리포트를 내려받았습니다');
  }

  /* ----------------------------------------------------------------- events */
  function bind() {
    const dropzone = $('dropzone');
    const input = $('fileInput');
    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', (event) => {
      const files = event.dataTransfer && event.dataTransfer.files;
      if (files && files.length) handleFiles(files);
    });
    input.addEventListener('change', () => {
      if (input.files && input.files.length) handleFiles(input.files);
      input.value = '';
    });

    $('demoBtn').addEventListener('click', loadDemo);
    $('cohortBtn').addEventListener('click', loadCohortDemo);
    $('resetBtn').addEventListener('click', reset);
    $('clearFilesBtn').addEventListener('click', () => { state.files = []; renderFiles(); resetAnalysis(); });
    $('mergeBtn').addEventListener('click', mergeStreams);
    $('toleranceSelect').addEventListener('change', (event) => {
      state.tolerance = event.target.value;
      if (state.files.length >= 2) mergeStreams();
    });
    $('exportCsv').addEventListener('click', exportCsv);
    $('exportJson').addEventListener('click', exportJson);
    $('exportMd').addEventListener('click', exportMd);

    $('groupA').addEventListener('change', (event) => { state.groupA = event.target.value; renderCompare(); });
    $('groupB').addEventListener('change', (event) => { state.groupB = event.target.value; renderCompare(); });
    $('pairedToggle').addEventListener('change', (event) => { state.paired = event.target.checked; renderCompare(); });
    $('corrX').addEventListener('change', (event) => { state.corrX = event.target.value; renderCharts(); });
    $('corrY').addEventListener('change', (event) => { state.corrY = event.target.value; renderCharts(); });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderCharts, 160);
    });
    window.addEventListener('error', (event) => {
      toast(`스크립트 오류: ${event.message}`);
    });
  }

  /* ------------------------------------------------------------------- init */
  function init() {
    bind();
    renderMethodology();
    try {
      loadDemo();
    } catch (error) {
      console.error(error);
      toast(`데모 생성 실패: ${error.message}`);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // exposed for verification in the live page
  window.HEARTMETRIC = {
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    state,
    loadText,
    cleanRows,
    alignStreams,
    roleOf,
    compareTable,
    correlationRow,
    generateDemo,
    generateCohort,
    buildBundle,
    markdownReport,
  };
})();
