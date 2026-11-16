/* ============================================================
   FEI · HEL 가상 연구실 — 오케스트레이터 · UI
   지시 → 분해 → 배정 → 조사/작성 → 협업 → 보고 → 승인
   ============================================================ */

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const state = {
    running: false,
    runId: 0,
    speed: 1,
    plan: null,
    tasks: [],
    results: [],
    logs: 0
  };

  const model = {};
  AGENTS.forEach(a => {
    model[a.id] = { state: 'idle', bubble: '', progress: 0, task: '', logs: [] };
  });

  const STATUS_LABEL = {
    idle: '대기', research: '조사', write: '작성', meet: '협업',
    waiting: '승인 대기', coffee: '휴식', done: '완료'
  };

  /* ── 유틸 ─────────────────────────────────────────────── */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function wait(ms) {
    return new Promise(r => setTimeout(r, Math.max(60, ms / state.speed)));
  }

  function clock(d = new Date()) {
    return d.toTimeString().slice(0, 8);
  }

  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  /* ── 마크다운 미니 렌더러 ─────────────────────────────── */
  function md(text) {
    const lines = String(text || '').split('\n');
    let out = '';
    let inList = false;
    const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
    lines.forEach(raw => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { closeList(); return; }
      if (line.startsWith('## ')) { closeList(); out += `<h4>${esc(line.slice(3))}</h4>`; return; }
      if (line.startsWith('### ')) { closeList(); out += `<h5>${esc(line.slice(4))}</h5>`; return; }
      if (line.startsWith('- ')) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += `<li>${inline(line.slice(2))}</li>`;
        return;
      }
      if (line.startsWith('> ')) { closeList(); out += `<blockquote>${inline(line.slice(2))}</blockquote>`; return; }
      closeList();
      out += `<p>${inline(line)}</p>`;
    });
    closeList();
    return out;
  }

  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  /* ── 초기화 ───────────────────────────────────────────── */
  function init() {
    Scene.init($('#officeCanvas'), onAgentClick);
    Scene.setAgents(AGENTS);
    renderChips();
    renderCrew();
    renderLegend();
    bindUI();
    $('#statTotal').textContent = AGENTS.length;
    updateStats();
    updateModePill();
    const saved = Adapter.get();
    if (saved.mode !== 'simulator') setTimeout(() => toast('AI 어댑터: ' + Adapter.modeLabel() + ' 모드', 'quiet'), 700);
  }

  function renderChips() {
    const wrap = $('#chips');
    wrap.innerHTML = SCENARIOS.map(s =>
      `<button type="button" class="chip" data-id="${s.id}" data-cmd="${esc(s.command)}">${esc(s.chip)}</button>`
    ).join('');
    wrap.addEventListener('click', e => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      $('#commandInput').value = btn.dataset.cmd;
      startRun(btn.dataset.cmd);
    });
  }

  function renderLegend() {
    const el = $('#canvasLegend');
    el.innerHTML = ['idle', 'research', 'write', 'meet', 'waiting']
      .map(k => `<span><i style="background:${Scene.STATES[k].color}"></i>${Scene.STATES[k].label}</span>`)
      .join('');
  }

  function renderCrew() {
    const ul = $('#crewList');
    ul.innerHTML = AGENTS.map(a => `
      <li class="crew-row" data-id="${a.id}">
        <span class="crew-glyph" style="background:${a.tint};color:${a.color}">${a.glyph}</span>
        <div class="crew-main">
          <div class="crew-top">
            <b>${esc(a.name)}</b>
            <span class="status-tag" data-state="idle">대기</span>
          </div>
          <p class="crew-role">${esc(a.role)}</p>
          <p class="crew-task">배정된 작업 없음</p>
          <div class="crew-bar"><i style="width:0%"></i></div>
        </div>
      </li>`).join('');
    ul.addEventListener('click', e => {
      const row = e.target.closest('.crew-row');
      if (row) openAgent(row.dataset.id);
    });
  }

  function bindUI() {
    $('#commandForm').addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#commandInput').value.trim();
      if (!v) { $('#commandInput').focus(); return; }
      startRun(v);
    });

    $$('.tab').forEach(t => t.addEventListener('click', () => {
      $$('.tab').forEach(x => { x.classList.remove('is-on'); x.setAttribute('aria-selected', 'false'); });
      t.classList.add('is-on');
      t.setAttribute('aria-selected', 'true');
      $$('.pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === t.dataset.pane));
    }));

    $('#speedGroup').addEventListener('click', e => {
      const b = e.target.closest('button[data-speed]');
      if (!b) return;
      state.speed = Number(b.dataset.speed);
      $$('#speedGroup button').forEach(x => x.classList.toggle('is-on', x === b));
      toast('진행 속도 ' + state.speed + '×', 'quiet');
    });

    // 어댑터 모달
    $('#adapterBtn').addEventListener('click', openAdapter);
    $('#adapterClose').addEventListener('click', () => $('#adapterModal').close());
    $('#adapterModal').addEventListener('click', e => { if (e.target.id === 'adapterModal') e.currentTarget.close(); });
    $$('#modeGrid input').forEach(r => r.addEventListener('change', syncModeFields));
    $('#adapterSave').addEventListener('click', saveAdapter);
    $('#adapterTest').addEventListener('click', testAdapter);
    $('#adapterReset').addEventListener('click', () => {
      Adapter.reset();
      fillAdapterForm(Adapter.get());
      toast('기본값(시뮬레이터)으로 되돌렸습니다', 'quiet');
    });

    // 연구원 모달
    $('#agentClose').addEventListener('click', () => $('#agentModal').close());
    $('#agentModal').addEventListener('click', e => { if (e.target.id === 'agentModal') e.currentTarget.close(); });
    $('#agentAssign').addEventListener('click', () => $('#agentModal').close());

    $('#cards').addEventListener('click', onCardClick);
  }

  /* ── 상태 반영 ────────────────────────────────────────── */
  function setAgent(id, patch) {
    if (!model[id]) return;
    Object.assign(model[id], patch);
    Scene.updateAgent(id, {
      state: patch.state != null ? patch.state : model[id].state,
      bubble: patch.bubble != null ? patch.bubble : model[id].bubble,
      progress: patch.progress != null ? patch.progress : model[id].progress
    });
    updateCrewRow(id);
    updateStats();
  }

  function updateCrewRow(id) {
    const row = document.querySelector(`.crew-row[data-id="${id}"]`);
    if (!row) return;
    const m = model[id];
    const tag = row.querySelector('.status-tag');
    tag.textContent = STATUS_LABEL[m.state] || '대기';
    tag.dataset.state = m.state;
    row.querySelector('.crew-task').textContent = m.task || '배정된 작업 없음';
    row.querySelector('.crew-bar i').style.width = Math.round((m.progress || 0) * 100) + '%';
  }

  function updateStats() {
    const active = Object.values(model).filter(m => m.state !== 'idle').length;
    const running = state.tasks.filter(t => !t.reported).length;
    const pending = state.results.filter(r => r.status === 'pending').length;
    $('#statAgents').textContent = active;
    $('#statTasks').textContent = running;
    $('#statPending').textContent = pending;
    const badge = $('#resultBadge');
    badge.textContent = pending;
    badge.hidden = pending === 0;
  }

  function setProgress(pct) {
    $('#runBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function updateProgress() {
    if (!state.tasks.length) { setProgress(0); return; }
    const n = state.tasks.length;
    let sum = 0;
    state.tasks.forEach(t => {
      if (t.reported) sum += 1;
      else if (t.workDone) sum += 0.75;
      else sum += 0.15 + 0.5 * (model[t.agent].progress || 0);
    });
    setProgress((sum / n) * 100);
  }

  /* ── 로그 ─────────────────────────────────────────────── */
  function addLog(who, text, opts = {}) {
    const list = $('#log');
    $('#logEmpty').hidden = true;
    const agent = AGENT_BY_ID[who];
    const li = document.createElement('li');
    li.className = 'log-item' + (opts.warn ? ' is-warn' : '');
    li.innerHTML = `
      <time>${clock()}</time>
      <span class="log-who" style="--c:${agent ? agent.color : '#141413'}">${esc(agent ? agent.short : '오케스트레이터')}</span>
      <p>${esc(text)}</p>`;
    list.appendChild(li);
    if (opts.live) li.dataset.live = '1';
    state.logs++;
    while (list.children.length > 220) list.removeChild(list.firstElementChild);
    if (opts.scroll !== false) list.scrollTop = list.scrollHeight;
    if (agent) {
      model[who].logs.push({ t: clock(), text });
      if (model[who].logs.length > 6) model[who].logs.shift();
    }
    return li;
  }

  function updateLogLine(li, text) {
    if (!li) return;
    li.querySelector('p').textContent = text;
  }

  /* ── 실행 ─────────────────────────────────────────────── */
  async function startRun(command) {
    const rid = ++state.runId;
    state.running = true;
    state.tasks = [];
    state.results = [];
    state.plan = null;

    $('#log').innerHTML = '';
    $('#logEmpty').hidden = true;
    $('#cards').innerHTML = '';
    $('#cardsEmpty').hidden = false;
    $('#runTitle').textContent = '지시 처리 중';
    $('#runSub').textContent = command.length > 46 ? command.slice(0, 46) + '…' : command;
    setProgress(3);

    Object.keys(model).forEach(id => {
      setAgent(id, { state: 'idle', bubble: '', progress: 0, task: '', logs: [] });
      Scene.goTo(id, 'desk');
      Scene.select(null);
    });
    updateStats();

    addLog('orc', `지시 접수 — "${command}"`);
    setProgress(6);

    let plan;
    try {
      if (Adapter.mode === 'local' && Adapter.get().local.url) {
        const streamed = await tryLocalStream(command, rid);
        if (streamed) return;
        addLog('orc', '로컬 서버가 스트림을 지원하지 않아 플랜 방식으로 전환합니다.', { warn: true });
      }
      addLog('orc', Adapter.mode === 'simulator'
        ? '오케스트레이터 · 내장 시뮬레이터로 작업을 분해합니다.'
        : `오케스트레이터 · ${Adapter.modeLabel()} 모델에 작업 분해를 요청합니다.`);

      let liveLine = null;
      if (Adapter.mode !== 'simulator') {
        liveLine = addLog('orc', 'LLM 응답 수신 대기…', { live: true });
      }
      const t0 = Date.now();
      plan = await Adapter.plan(command, {
        onDelta: text => {
          if (liveLine) updateLogLine(liveLine, `LLM 응답 수신 · ${text.length.toLocaleString()}자`);
        }
      });
      if (liveLine) {
        updateLogLine(liveLine, `LLM 응답 수신 완료 · ${plan.tasks.length}개 태스크 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        delete liveLine.dataset.live;
      }
    } catch (err) {
      addLog('orc', `어댑터 오류 — ${err.message}`, { warn: true });
      addLog('orc', '내장 시뮬레이터로 계속 진행합니다.', { warn: true });
      toast('연결 실패 — 시뮬레이터로 계속합니다', 'warn');
      plan = buildSimulatorPlan(command);
    }

    if (rid !== state.runId) return;

    state.plan = plan;
    state.tasks = plan.tasks.map(t => ({ ...t, workDone: false, reported: false }));
    Scene.setPlanText(plan.title);
    $('#runTitle').textContent = plan.title;
    setProgress(10);

    addLog('orc', `작업 분해 → ${plan.tasks.length}개 태스크`);
    plan.tasks.forEach(t => {
      const an = AGENT_BY_ID[t.agent];
      addLog('orc', `· ${an ? an.name : t.agent} — ${t.title}`);
    });

    await simulate(rid);
  }

  async function simulate(rid) {
    await wait(420);
    if (rid !== state.runId) return;

    await Promise.all(state.tasks.map((t, i) => workTask(t, i, rid)));
    if (rid !== state.runId) return;

    await meeting(rid);
    if (rid !== state.runId) return;

    for (const t of state.tasks) {
      if (rid !== state.runId) return;
      await report(t, rid);
    }
    if (rid !== state.runId) return;

    state.tasks.forEach(t => {
      Scene.goTo(t.agent, 'desk');
      setAgent(t.agent, { state: 'waiting', bubble: '승인 대기', progress: 1, task: '' });
    });
    state.running = false;
    setProgress(100);
    $('#runSub').textContent = `${state.tasks.length}개 결과물 · 승인 대기 ${state.results.filter(r => r.status === 'pending').length}건`;
    addLog('orc', `작업 완료 — 결과물 ${state.results.length}건이 교수님 승인을 기다립니다.`);
    toast('결과물이 도착했습니다 — 승인해 주세요');
    updateStats();
  }

  async function workTask(t, i, rid) {
    const a = AGENT_BY_ID[t.agent];
    await wait(180 + i * 320);
    if (rid !== state.runId) return;
    Scene.goTo(t.agent, 'desk');
    await wait(520);
    if (rid !== state.runId) return;

    setAgent(t.agent, {
      state: t.mode === '작성' ? 'write' : 'research',
      bubble: t.bubble,
      task: t.title,
      progress: 0.05
    });
    addLog(t.agent, `태스크 시작 — ${t.title}`);
    updateProgress();

    const logs = t.logs && t.logs.length ? t.logs : ['자료를 확인하고 있습니다.'];
    for (let k = 0; k < logs.length; k++) {
      await wait(1500 + Math.random() * 900);
      if (rid !== state.runId) return;
      setAgent(t.agent, { progress: (k + 1) / (logs.length + 1) });
      addLog(t.agent, logs[k]);
      updateProgress();
    }
    await wait(500);
    if (rid !== state.runId) return;
    setAgent(t.agent, { progress: 1, bubble: '검토 마무리' });
    t.workDone = true;
    updateProgress();
  }

  async function meeting(rid) {
    addLog('orc', '중앙 협업 테이블 — 결과 교차 검토를 시작합니다.');
    state.tasks.forEach(t => Scene.goTo(t.agent, 'table'));
    await wait(1100);
    if (rid !== state.runId) return;
    state.tasks.forEach(t => setAgent(t.agent, { state: 'meet', bubble: '교차 검토', progress: 0.85 }));
    setProgress(60);
    await wait(1700);
    if (rid !== state.runId) return;
    const first = state.tasks[0], last = state.tasks[state.tasks.length - 1];
    addLog(first.agent, '교차 검토 — 태스크 간 수치와 일정이 어긋나지 않는지 대조했습니다.');
    await wait(1500);
    if (rid !== state.runId) return;
    addLog(last.agent, '검토 의견 반영 완료 — 보고 순서를 정리했습니다.');
    await wait(900);
  }

  async function report(t, rid) {
    Scene.goTo(t.agent, 'pi');
    setAgent(t.agent, { state: 'waiting', bubble: '보고 · 승인 대기', progress: 1, task: t.title });
    await wait(1200);
    if (rid !== state.runId) return;
    addResult(t);
    t.reported = true;
    if (state.tasks.length && state.tasks.every(x => x.reported)) switchTab('results');
    addLog(t.agent, `결과물 전달 — 「${t.deliverable.title}」 · 승인 대기`);
    updateProgress();
    updateStats();
    await wait(600);
  }

  /* ── 로컬 SSE 실행 ────────────────────────────────────── */
  async function tryLocalStream(command, rid) {
    let gotPlan = false;
    try {
      const ok = await Adapter.runLocalStream(command, {
        status: d => addLog('orc', d.message || d.text || '서버 상태'),
        plan: d => {
          gotPlan = true;
          state.plan = { title: d.title || '로컬 서버 계획', tasks: d.tasks || [] };
          state.tasks = (d.tasks || []).map(t => ({ ...t, workDone: false, reported: false }));
          Scene.setPlanText(state.plan.title);
          $('#runTitle').textContent = state.plan.title;
          addLog('orc', `작업 분해 → ${state.tasks.length}개 태스크 (로컬 서버)`);
          setProgress(15);
        },
        task: d => {
          const m = { state: d.state || 'research', bubble: d.bubble || '', progress: d.progress || 0.3 };
          setAgent(d.agent, m);
          if (d.spot) Scene.goTo(d.agent, d.spot);
          if (d.task) model[d.agent].task = d.task;
          if (typeof d.progress === 'number') setProgress(Math.max(15, d.progress * 100));
        },
        log: d => addLog(d.agent || 'orc', d.text || d.message || ''),
        result: d => {
          const task = state.tasks.find(t => t.id === d.id) || { id: d.id, agent: d.agent, deliverable: {} };
          addResult({
            ...task,
            agent: d.agent || task.agent,
            deliverable: {
              title: d.title || d.deliverable?.title || '결과물',
              type: d.type || d.deliverable?.type || '초안',
              body: d.body || d.deliverable?.body || ''
            }
          });
          if (task) task.reported = true;
          updateStats();
        },
        done: () => {
          state.running = false;
          setProgress(100);
          state.tasks.forEach(t => setAgent(t.agent, { state: 'idle', bubble: '', task: '' }));
          addLog('orc', '로컬 서버 작업 완료 — 결과물 승인 대기');
          toast('결과물이 도착했습니다 — 승인해 주세요');
        }
      });
      if (!ok) return false;
      if (!gotPlan) addLog('orc', '서버가 계획을 보내지 않았습니다.', { warn: true });
      return true;
    } catch (e) {
      addLog('orc', `로컬 서버 오류 — ${e.message}`, { warn: true });
      addLog('orc', '플랜 방식으로 전환합니다.', { warn: true });
      return false;
    }
  }

  /* ── 결과물 카드 ──────────────────────────────────────── */
  function addResult(task) {
    const item = {
      id: 'r' + (state.results.length + 1),
      taskId: task.id,
      agent: task.agent,
      title: task.deliverable.title,
      type: task.deliverable.type,
      body: task.deliverable.body,
      status: 'pending',
      version: 1,
      at: clock()
    };
    state.results.push(item);
    renderCard(item);
    updateStats();

    // 결과물 탭 배지로 유도
    const badge = $('#resultBadge');
    if (badge && !badge.hidden) badge.classList.add('pulse');
    setTimeout(() => badge && badge.classList.remove('pulse'), 1200);

    return item;
  }

  function switchTab(name) {
    $$('.tab').forEach(t => {
      const on = t.dataset.pane === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.pane').forEach(p => p.classList.toggle('is-on', p.dataset.pane === name));
  }

  function renderCard(item) {
    $('#cardsEmpty').hidden = true;
    const a = AGENT_BY_ID[item.agent] || AGENTS[0];
    const el = document.createElement('article');
    el.className = 'card';
    el.dataset.id = item.id;
    el.dataset.status = item.status;
    el.innerHTML = `
      <header class="card-head">
        <div class="card-tags">
          <span class="card-agent" style="--c:${a.color};--bg:${a.tint}">${esc(a.short)}</span>
          <span class="card-type">${esc(item.type)}</span>
          <span class="card-ver" ${item.version > 1 ? '' : 'hidden'}>v${item.version}</span>
        </div>
        <h3>${esc(item.title)}</h3>
        <p class="card-meta">${esc(a.name)} · ${item.at} · 검토 후 승인</p>
      </header>
      <div class="card-body markdown">${md(item.body)}</div>
      <button type="button" class="card-more" data-act="more">전체 보기</button>
      <div class="card-revise" hidden>
        <textarea rows="2" placeholder="수정 방향을 적어 주세요 — 예: 금액 항목을 비목별로 나눠 줘"></textarea>
        <div class="card-revise-foot">
          <button type="button" class="btn btn-mini btn-ghost" data-act="cancel">취소</button>
          <button type="button" class="btn btn-mini btn-solid" data-act="send">수정 요청 보내기</button>
        </div>
      </div>
      <footer class="card-foot">
        <span class="card-state">승인 대기</span>
        <span class="grow"></span>
        <button type="button" class="icon-text" data-act="copy">복사</button>
        <button type="button" class="icon-text" data-act="download">다운로드</button>
        <button type="button" class="btn btn-mini btn-ghost" data-act="revise">수정 요청</button>
        <button type="button" class="btn btn-mini btn-solid" data-act="approve">승인</button>
      </footer>`;
    $('#cards').appendChild(el);
    return el;
  }

  function onCardClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.card');
    const item = state.results.find(r => r.id === card.dataset.id);
    if (!item) return;
    const act = btn.dataset.act;

    if (act === 'more') {
      const open = card.classList.toggle('is-open');
      btn.textContent = open ? '접기' : '전체 보기';
      return;
    }
    if (act === 'copy') return copyCard(item);
    if (act === 'download') return downloadCard(item);
    if (act === 'approve') return approve(item, card);
    if (act === 'revise') {
      const box = card.querySelector('.card-revise');
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('textarea').focus();
      return;
    }
    if (act === 'cancel') {
      card.querySelector('.card-revise').hidden = true;
      return;
    }
    if (act === 'send') {
      const ta = card.querySelector('.card-revise textarea');
      const fb = ta.value.trim();
      if (!fb) { ta.focus(); return; }
      revise(item, card, fb);
    }
  }

  async function approve(item, card) {
    if (item.status === 'approved') return;
    item.status = 'approved';
    card.dataset.status = 'approved';
    card.querySelector('.card-state').textContent = '승인 완료';
    card.querySelector('[data-act="approve"]').disabled = true;
    card.querySelector('[data-act="revise"]').disabled = true;
    addLog(item.agent, `승인 완료 — 「${item.title}」 아카이브에 저장`);
    toast('승인했습니다 — ' + item.title);
    updateStats();
    // 승인 후 자리로 복귀
    Scene.goTo(item.agent, 'desk');
    setAgent(item.agent, { state: 'idle', bubble: '승인 완료', progress: 0, task: '' });
    setTimeout(() => setAgent(item.agent, { bubble: '' }), 2600);
  }

  async function revise(item, card, feedback) {
    card.querySelector('.card-revise').hidden = true;
    card.dataset.status = 'revising';
    card.querySelector('.card-state').textContent = '수정 반영 중';
    addLog(item.agent, `수정 요청 접수 — "${feedback.slice(0, 60)}"`);
    setAgent(item.agent, { state: 'write', bubble: '수정 반영 중', task: item.title });
    Scene.goTo(item.agent, 'desk');
    await wait(1900);
    item.version += 1;
    item.body = item.body + '\n\n' + [
      `## PI 수정 요청 반영 (v${item.version})`,
      `- 요청: ${feedback}`,
      '- 반영: 해당 항목을 다시 배열하고, 금액·일정·규정은 확인 필요 표시를 유지했습니다.',
      '- 확인 필요: 수정본을 결재 전 한 번 더 대조해 주세요.'
    ].join('\n');
    item.status = 'pending';
    const a = AGENT_BY_ID[item.agent];
    card.dataset.status = 'pending';
    card.querySelector('.card-ver').hidden = false;
    card.querySelector('.card-ver').textContent = 'v' + item.version;
    card.querySelector('.card-body').innerHTML = md(item.body);
    card.classList.add('is-open');
    card.querySelector('[data-act="more"]').textContent = '접기';
    card.querySelector('.card-state').textContent = '승인 대기 (수정본)';
    addLog(item.agent, `수정본 v${item.version} 준비 — 다시 승인 대기`);
    setAgent(item.agent, { state: 'waiting', bubble: '수정본 보고', progress: 1 });
    toast('수정본이 준비되었습니다 (v' + item.version + ')');
    updateStats();
  }

  async function copyCard(item) {
    const text = `# ${item.title}\n\n${item.body}\n\n— FEI · HEL 가상 연구실 · ${AGENT_BY_ID[item.agent].name}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했습니다 — 붙여넣기 하세요');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('복사했습니다');
    }
  }

  function downloadCard(item) {
    const name = ('FEI-HEL_' + item.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) + '_' + stamp() + '.md');
    const blob = new Blob([`# ${item.title}\n\n${item.body}\n`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('내려받았습니다 — ' + name);
  }

  /* ── 연구원 상세 ──────────────────────────────────────── */
  function onAgentClick(id) {
    openAgent(id);
  }

  function openAgent(id) {
    const a = AGENT_BY_ID[id];
    const m = model[id];
    if (!a) return;
    Scene.select(id);
    $('#agentEyebrow').textContent = a.role.toUpperCase();
    $('#agentName').textContent = a.name;
    $('#agentRole').textContent = a.role;
    const tag = $('#agentStatusTag');
    tag.textContent = STATUS_LABEL[m.state] || '대기';
    tag.dataset.state = m.state;
    $('#agentProgress').textContent = m.state === 'idle' ? '' : Math.round((m.progress || 0) * 100) + '%';
    $('#agentAreas').innerHTML = a.areas.map(x => `<li>${esc(x)}</li>`).join('');
    $('#agentTask').textContent = m.task || '배정된 작업 없음';
    $('#agentLog').innerHTML = m.logs.length
      ? m.logs.slice().reverse().map(l => `<li><time>${l.t}</time><span>${esc(l.text)}</span></li>`).join('')
      : '<li class="muted">아직 기록이 없습니다.</li>';
    $('#agentModal').showModal();
  }

  /* ── 어댑터 모달 ──────────────────────────────────────── */
  function openAdapter() {
    fillAdapterForm(Adapter.get());
    $('#adapterError').hidden = true;
    $('#adapterModal').showModal();
  }

  function fillAdapterForm(s) {
    $$('#modeGrid input').forEach(r => { r.checked = r.value === s.mode; });
    $('#openaiKey').value = s.openai.key || '';
    $('#openaiModel').value = s.openai.model || '';
    $('#anthropicKey').value = s.anthropic.key || '';
    $('#anthropicModel').value = s.anthropic.model || '';
    $('#geminiKey').value = s.gemini.key || '';
    $('#geminiModel').value = s.gemini.model || '';
    $('#localUrl').value = s.local.url || '';
    $('#localToken').value = s.local.token || '';
    syncModeFields();
  }

  function syncModeFields() {
    const mode = ($$('#modeGrid input').find(r => r.checked) || {}).value || 'simulator';
    $$('.field-group').forEach(g => { g.hidden = g.dataset.for !== mode; });
    $$('.mode').forEach(l => l.classList.toggle('is-checked', !!l.querySelector('input').checked));
  }

  function readAdapterForm() {
    return {
      mode: ($$('#modeGrid input').find(r => r.checked) || {}).value || 'simulator',
      openai: { key: $('#openaiKey').value.trim(), model: $('#openaiModel').value.trim() || 'gpt-4o-mini' },
      anthropic: { key: $('#anthropicKey').value.trim(), model: $('#anthropicModel').value.trim() || 'claude-sonnet-4-5' },
      gemini: { key: $('#geminiKey').value.trim(), model: $('#geminiModel').value.trim() || 'gemini-2.0-flash' },
      local: { url: $('#localUrl').value.trim(), token: $('#localToken').value.trim() }
    };
  }

  async function testAdapter() {
    const btn = $('#adapterTest');
    const msg = $('#adapterError');
    btn.disabled = true;
    msg.hidden = false;
    msg.className = 'modal-note';
    msg.textContent = '연결 확인 중…';
    const r = await Adapter.test(readAdapterForm());
    msg.className = 'modal-note ' + (r.ok ? 'is-ok' : 'is-bad');
    msg.textContent = r.message;
    btn.disabled = false;
  }

  function saveAdapter() {
    const next = readAdapterForm();
    Adapter.save(next);
    updateModePill();
    $('#adapterModal').close();
    toast('어댑터 저장 — ' + Adapter.modeLabel() + ' 모드');
    addLog('orc', `AI 어댑터 설정 — ${Adapter.modeLabel()} 모드`);
  }

  function updateModePill() {
    const mode = Adapter.mode;
    const pill = $('#modePill');
    pill.dataset.mode = mode;
    $('#modeLabel').textContent = mode === 'simulator' ? '시뮬레이터' : Adapter.modeLabel();
    pill.title = mode === 'simulator'
      ? 'API 키 없이 동작하는 내장 시뮬레이터'
      : '외부 모델 · 실시간 스트림 모드';
  }

  /* ── 시작 ─────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);
})();
