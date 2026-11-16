/* ============================================================
   FEI · HEL 가상 연구실 — AI 어댑터
   기본: 내장 시뮬레이터 (키 불필요)
   확장: OpenAI · Anthropic · Gemini (브라우저 직접, 스트리밍)
        로컬 FastAPI + SSE (office/backend/server.py)
   키는 localStorage 에만 저장되고 로그·전송에 노출하지 않습니다.
   ============================================================ */

const Adapter = (() => {
  const STORE = 'feihel.adapter.v1';

  const DEFAULTS = {
    mode: 'simulator',
    openai: { key: '', model: 'gpt-4o-mini' },
    anthropic: { key: '', model: 'claude-sonnet-4-5' },
    gemini: { key: '', model: 'gemini-2.0-flash' },
    local: { url: '', token: '' }
  };

  let settings = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return structuredClone(DEFAULTS);
      const s = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...s,
        openai: { ...DEFAULTS.openai, ...(s.openai || {}) },
        anthropic: { ...DEFAULTS.anthropic, ...(s.anthropic || {}) },
        gemini: { ...DEFAULTS.gemini, ...(s.gemini || {}) },
        local: { ...DEFAULTS.local, ...(s.local || {}) }
      };
    } catch (e) {
      return structuredClone(DEFAULTS);
    }
  }

  function save(next) {
    settings = {
      ...settings,
      ...next,
      openai: { ...settings.openai, ...(next.openai || {}) },
      anthropic: { ...settings.anthropic, ...(next.anthropic || {}) },
      gemini: { ...settings.gemini, ...(next.gemini || {}) },
      local: { ...settings.local, ...(next.local || {}) }
    };
    localStorage.setItem(STORE, JSON.stringify(settings));
    return settings;
  }

  function reset() {
    localStorage.removeItem(STORE);
    settings = structuredClone(DEFAULTS);
    return settings;
  }

  function get() { return settings; }

  function modeLabel() {
    return {
      simulator: '시뮬레이터',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      gemini: 'Gemini',
      local: '로컬 서버'
    }[settings.mode] || '시뮬레이터';
  }

  /* ── 공통: JSON 추출 ───────────────────────────────────── */
  function extractJson(text) {
    if (!text) throw new Error('빈 응답');
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('JSON 형식을 찾지 못했습니다');
    return JSON.parse(t.slice(start, end + 1));
  }

  function normalizePlan(obj, source) {
    const ids = ['budget', 'data', 'writer', 'coord'];
    if (!obj || !Array.isArray(obj.tasks) || !obj.tasks.length) throw new Error('태스크가 비어 있습니다');
    const seen = new Set();
    const tasks = obj.tasks.slice(0, 6).map((t, i) => {
      let agent = String(t.agent || '').toLowerCase();
      if (!ids.includes(agent)) agent = ids[i % ids.length];
      if (seen.has(agent)) agent = ids[(ids.indexOf(agent) + 1 + i) % ids.length];
      seen.add(agent);
      const mode = t.mode === '작성' || t.mode === 'write' ? '작성' : '조사';
      const type = ['초안', '체크리스트', '요약', '표'].includes(t.deliverable?.type)
        ? t.deliverable.type : '초안';
      return {
        id: 't' + (i + 1),
        agent,
        title: String(t.title || '태스크 ' + (i + 1)).slice(0, 80),
        mode,
        eta: Math.max(6, Math.min(30, Number(t.eta) || 12)),
        bubble: String(t.bubble || (mode === '작성' ? '작성 중' : '조사 중')).slice(0, 26),
        logs: (Array.isArray(t.logs) ? t.logs : [t.logs]).filter(Boolean).map(s => String(s).slice(0, 220)).slice(0, 5),
        deliverable: {
          title: String(t.deliverable?.title || t.title || '결과물').slice(0, 80),
          type,
          body: String(t.deliverable?.body || '').slice(0, 6000)
        }
      };
    });
    return { source, title: String(obj.title || '지시 분해 · 실행 계획').slice(0, 60), tasks };
  }

  /* ── LLM 프롬프트 ──────────────────────────────────────── */
  const SYSTEM = [
    '너는 경상국립대학교 환경산림과학부 산림환경자원학과 인간환경연구실(FEI · HEL, 교수 김건우)의 가상 연구실 오케스트레이터다.',
    '교수님의 지시를 받아 4명의 AI 연구원에게 일을 나눠 주고, 각자 실제로 쓸 수 있는 문서 초안을 만든다.',
    '',
    '연구원:',
    '- budget: 과제비·정산 매니저 — 회의비(회의록·지출결의서), 분석비(의뢰서·견적·집행), 인건비(참여율·지급명세·변경신청)',
    '- data: 데이터 분석가 — 건보공단 가명결합 코호트, GPS·기상·임상도 전처리, 통계 검증·요약표',
    '- writer: 보고서·논문 라이터 — 연차·결과보고서, 논문·학회 초록, 연구실 콘텐츠 초안',
    '- coord: 문헌·행정 코디네이터 — 선행연구·ISEE 동향, 메일·일정·과제 마감, 증빙·서식 연동',
    '',
    '규칙:',
    '1. 지시와 관련된 3~4개 태스크로 나눈다. 각 연구원은 최대 1개 태스크.',
    '2. 결과물은 실제 결재·제출에 쓸 수 있는 수준으로: 항목, 확인 필요 사항, 자리표시자(○○)를 포함한다.',
    '3. 확인되지 않은 금액·규정 조항·날짜를 사실처럼 쓰지 않는다. 모르면 "확인 필요"로 표시한다.',
    '4. body는 마크다운. "## " 소제목과 "- " 목록만 사용한다. 300~900자.',
    '5. 출력은 아래 JSON 하나만. 코드펜스·설명 금지.',
    '',
    '{"title":"작업 제목","tasks":[{"agent":"budget","title":"태스크 제목","mode":"작성","bubble":"말풍선 12자 이내","eta":14,"logs":["진행 로그 3~4줄"],"deliverable":{"title":"결과물 제목","type":"초안","body":"## 소제목\\n- 항목"}}]}',
    '"mode"는 "조사" 또는 "작성", "type"은 "초안"|"체크리스트"|"요약"|"표".'
  ].join('\n');

  function userPrompt(command) {
    return `교수님 지시: "${command}"\n\n위 지시를 4명의 AI 연구원에게 나눠 배정하고, 각 결과물 초안을 JSON으로 만들어 주세요.`;
  }

  /* ── 스트림 파서 ───────────────────────────────────────── */
  async function readSSE(res, onEvent) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message';
        const dataLines = [];
        chunk.split('\n').forEach(line => {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        });
        if (dataLines.length) onEvent(event, dataLines.join('\n'));
      }
    }
  }

  /* ── 제공자별 스트리밍 ─────────────────────────────────── */
  async function runOpenAI(command, onDelta) {
    const { key, model } = settings.openai;
    if (!key) throw new Error('OpenAI API 키가 없습니다');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.4,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(command) }
        ]
      })
    });
    if (!res.ok) throw new Error('OpenAI ' + res.status + ' · ' + (await res.text()).slice(0, 180));
    let text = '';
    await readSSE(res, (_ev, data) => {
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        const d = j.choices?.[0]?.delta?.content;
        if (d) { text += d; onDelta && onDelta(text); }
      } catch (_) {}
    });
    return { text };
  }

  async function runAnthropic(command, onDelta) {
    const { key, model } = settings.anthropic;
    if (!key) throw new Error('Anthropic API 키가 없습니다');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5',
        max_tokens: 3000,
        temperature: 0.4,
        stream: true,
        system: SYSTEM,
        messages: [{ role: 'user', content: userPrompt(command) }]
      })
    });
    if (!res.ok) throw new Error('Anthropic ' + res.status + ' · ' + (await res.text()).slice(0, 180));
    let text = '';
    await readSSE(res, (_ev, data) => {
      try {
        const j = JSON.parse(data);
        if (j.type === 'content_block_delta' && j.delta?.text) {
          text += j.delta.text;
          onDelta && onDelta(text);
        }
      } catch (_) {}
    });
    return { text };
  }

  async function runGemini(command, onDelta) {
    const { key, model } = settings.gemini;
    if (!key) throw new Error('Gemini API 키가 없습니다');
    const m = model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt(command) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 3000 }
      })
    });
    if (!res.ok) throw new Error('Gemini ' + res.status + ' · ' + (await res.text()).slice(0, 180));
    let text = '';
    await readSSE(res, (_ev, data) => {
      try {
        const j = JSON.parse(data);
        const parts = j.candidates?.[0]?.content?.parts || [];
        parts.forEach(p => { if (p.text) { text += p.text; } });
        onDelta && onDelta(text);
      } catch (_) {}
    });
    return { text };
  }

  /* ── 로컬 FastAPI ──────────────────────────────────────── */
  function localBase() {
    const u = (settings.local.url || '').trim().replace(/\/+$/, '');
    if (!u) throw new Error('로컬 서버 주소가 없습니다');
    return u;
  }

  function localHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (settings.local.token) h['X-Lab-Token'] = settings.local.token;
    return h;
  }

  async function runLocalPlan(command) {
    const res = await fetch(localBase() + '/api/plan', {
      method: 'POST',
      headers: localHeaders(),
      body: JSON.stringify({ command })
    });
    if (!res.ok) throw new Error('로컬 서버 ' + res.status + ' · ' + (await res.text()).slice(0, 180));
    const j = await res.json();
    return normalizePlan(j.plan || j, '로컬 서버');
  }

  /* 실시간 SSE 실행 — 서버가 오케스트레이션까지 수행 */
  async function runLocalStream(command, handlers) {
    let res;
    try {
      res = await fetch(localBase() + '/api/stream', {
        method: 'POST',
        headers: localHeaders(),
        body: JSON.stringify({ command })
      });
    } catch (e) {
      throw new Error('로컬 서버에 연결하지 못했습니다: ' + e.message);
    }
    if (res.status === 404) return false;        // 스트림 미지원 → 플랜 방식으로
    if (!res.ok) throw new Error('로컬 스트림 ' + res.status);

    await readSSE(res, (event, data) => {
      let payload = {};
      try { payload = JSON.parse(data); } catch (_) { payload = { text: data }; }
      if (handlers[event]) handlers[event](payload);
    });
    return true;
  }

  /* ── 연결 테스트 ───────────────────────────────────────── */
  async function test(s = settings) {
    const mode = s.mode;
    try {
      if (mode === 'simulator') return { ok: true, message: '내장 시뮬레이터 — 키 없이 동작합니다.' };
      if (mode === 'openai') {
        if (!s.openai.key) return { ok: false, message: 'API 키를 입력해 주세요.' };
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + s.openai.key } });
        return r.ok ? { ok: true, message: 'OpenAI 연결 정상.' } : { ok: false, message: 'OpenAI ' + r.status + ' — 키·모델을 확인해 주세요.' };
      }
      if (mode === 'anthropic') {
        if (!s.anthropic.key) return { ok: false, message: 'API 키를 입력해 주세요.' };
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': s.anthropic.key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({ model: s.anthropic.model || 'claude-sonnet-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
        });
        return r.ok || r.status === 400
          ? { ok: true, message: 'Anthropic 응답 확인 (' + r.status + ').' }
          : { ok: false, message: 'Anthropic ' + r.status + ' — 키를 확인해 주세요.' };
      }
      if (mode === 'gemini') {
        if (!s.gemini.key) return { ok: false, message: 'API 키를 입력해 주세요.' };
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(s.gemini.key));
        return r.ok ? { ok: true, message: 'Gemini 연결 정상.' } : { ok: false, message: 'Gemini ' + r.status + ' — 키를 확인해 주세요.' };
      }
      if (mode === 'local') {
        if (!s.local.url) return { ok: false, message: '서버 주소를 입력해 주세요.' };
        const r = await fetch(s.local.url.replace(/\/+$/, '') + '/api/health', { headers: s.local.token ? { 'X-Lab-Token': s.local.token } : {} });
        if (!r.ok) return { ok: false, message: '로컬 서버 ' + r.status + ' — 주소·토큰을 확인해 주세요.' };
        const j = await r.json().catch(() => ({}));
        return { ok: true, message: '로컬 서버 연결 정상' + (j.engine ? ' · ' + j.engine : '') + '.' };
      }
      return { ok: false, message: '알 수 없는 모드입니다.' };
    } catch (e) {
      return { ok: false, message: '연결 실패: ' + e.message };
    }
  }

  /* ── 플랜 생성 (시뮬레이터 / LLM / 로컬 플랜) ──────────── */
  async function plan(command, { onDelta } = {}) {
    if (settings.mode === 'simulator') {
      return buildSimulatorPlan(command);
    }
    if (settings.mode === 'local') {
      return await runLocalPlan(command);
    }
    let out;
    if (settings.mode === 'openai') out = await runOpenAI(command, onDelta);
    else if (settings.mode === 'anthropic') out = await runAnthropic(command, onDelta);
    else if (settings.mode === 'gemini') out = await runGemini(command, onDelta);
    else throw new Error('지원하지 않는 모드');
    const obj = extractJson(out.text);
    return normalizePlan(obj, modeLabel());
  }

  return {
    get, save, reset, test, plan,
    runLocalStream,
    modeLabel,
    get mode() { return settings.mode; },
    DEFAULTS
  };
})();
