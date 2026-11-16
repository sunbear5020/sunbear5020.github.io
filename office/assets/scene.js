/* ============================================================
   FEI · HEL 가상 연구실 — 2D 캔버스 신
   452동 237호 평면도 · 60fps requestAnimationFrame · 반응형
   ============================================================ */

const Scene = (() => {
  const W = 1000, H = 620;
  const PAPER = '#FAF9F5';
  const SAND = '#F0EEE6';
  const CH = '#141413';
  const TERRA = '#D97757';
  const SAGE = '#2D4A3E';

  const STATES = {
    idle:    { label: '대기',    color: '#8A867C' },
    research:{ label: '조사',    color: '#2D4A3E' },
    write:   { label: '작성',    color: '#B4613F' },
    meet:    { label: '협업',    color: '#415F6B' },
    waiting: { label: '승인 대기', color: '#C0562E' },
    coffee:  { label: '휴식',    color: '#94743F' },
    done:    { label: '완료',    color: '#2D4A3E' }
  };

  /* 좌석 좌표 (world) */
  const DESK_SEATS = [
    { x: 838, y: 196 },   // budget  · 우측 상단
    { x: 838, y: 352 },   // data    · 우측 중단
    { x: 150, y: 492 },   // writer  · 좌측 하단
    { x: 150, y: 356 }    // coord   · 좌측 중단
  ];
  const TABLE_SEATS = [
    { x: 412, y: 292 }, { x: 588, y: 292 },
    { x: 412, y: 408 }, { x: 588, y: 408 }
  ];
  const PI_SPOT = { x: 196, y: 258 };
  const COFFEE_SPOT = { x: 862, y: 424 };

  let canvas, ctx, wrap;
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  let agents = [];
  let planText = '';
  let selected = null;
  let onClick = null;
  let raf = null, last = 0;
  let hotspots = [];   // for hit-testing (agent tokens)

  /* ── 준비 ─────────────────────────────────────────────── */
  function init(el, clickHandler) {
    canvas = el;
    ctx = canvas.getContext('2d');
    wrap = canvas.parentElement;
    onClick = clickHandler;
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);

    canvas.addEventListener('pointerdown', e => {
      const r = canvas.getBoundingClientRect();
      const px = (e.clientX - r.left - ox) / scale;
      const py = (e.clientY - r.top - oy) / scale;
      let hit = null;
      hotspots.forEach(h => {
        if (Math.hypot(px - h.x, py - h.y) < 30) hit = h.id;
      });
      if (hit && onClick) onClick(hit);
    });

    last = performance.now();
    loop(last);
  }

  function resize() {
    if (!canvas || !wrap) return;
    const r = wrap.getBoundingClientRect();
    const w = Math.max(280, Math.floor(r.width));
    const h = Math.max(220, Math.floor(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    scale = Math.min(w / W, h / H);
    ox = (w - W * scale) / 2;
    oy = (h - H * scale) / 2;
  }

  /* ── 에이전트 등록 ────────────────────────────────────── */
  function setAgents(list) {
    agents = list.map((a, i) => {
      const seat = DESK_SEATS[i % DESK_SEATS.length];
      return {
        id: a.id,
        name: a.name,
        short: a.short,
        glyph: a.glyph,
        color: a.color,
        tint: a.tint,
        x: seat.x, y: seat.y,
        from: { x: seat.x, y: seat.y },
        to: { x: seat.x, y: seat.y },
        ctrl: null,
        t: 1,
        state: 'idle',
        bubble: '',
        progress: 0,
        task: '',
        phase: Math.random() * Math.PI * 2
      };
    });
    hotspots = agents.map(a => ({ id: a.id, x: a.x, y: a.y }));
  }

  function setPlanText(t) { planText = t || ''; }

  function updateAgent(id, patch) {
    const a = agents.find(x => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
  }

  function select(id) { selected = id; }

  function goTo(id, spot) {
    const a = agents.find(x => x.id === id);
    if (!a) return;
    let target;
    if (spot === 'desk') {
      const i = agents.indexOf(a);
      target = DESK_SEATS[i % DESK_SEATS.length];
    } else if (spot === 'table') {
      const i = agents.indexOf(a);
      target = TABLE_SEATS[i % TABLE_SEATS.length];
    } else if (spot === 'pi') target = PI_SPOT;
    else if (spot === 'coffee') target = COFFEE_SPOT;
    else return;
    // 같은 자리면 그대로
    if (Math.hypot(a.to.x - target.x, a.to.y - target.y) < 2 && a.t >= 1) return;
    a.from = { x: a.x, y: a.y };
    a.to = { x: target.x + (Math.random() - .5) * 6, y: target.y + (Math.random() - .5) * 6 };
    const mx = (a.from.x + a.to.x) / 2, my = (a.from.y + a.to.y) / 2;
    const nx = -(a.to.y - a.from.y), ny = (a.to.x - a.from.x);
    const len = Math.hypot(nx, ny) || 1;
    const bend = (Math.random() - .5) * 46;
    a.ctrl = { x: mx + (nx / len) * bend, y: my + (ny / len) * bend };
    a.t = 0;
  }

  function walkProgress(a) {
    return { from: a.from, to: a.to, t: a.t };
  }

  /* ── 애니메이션 ───────────────────────────────────────── */
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    agents.forEach(a => {
      if (a.t < 1) {
        const dist = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
        const dur = Math.max(0.55, dist / 105);
        a.t = Math.min(1, a.t + dt / dur);
        const t = ease(a.t);
        const p0 = a.from, p1 = a.ctrl || a.from, p2 = a.to;
        a.x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
        a.y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
      }
      a.phase += dt;
    });
    hotspots = agents.map(a => ({ id: a.id, x: a.x, y: a.y }));

    draw(now / 1000);
    raf = requestAnimationFrame(loop);
  }

  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ── 그리기 ───────────────────────────────────────────── */
  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = SAND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    drawRoom(time);
    drawRug();
    drawWhiteboard(time);
    drawPI(time);
    drawDesk(64, 400, 'writer');        // 좌 하단 (writer)
    drawDesk(64, 264, 'coord');         // 좌 중단 (coord)
    drawDesk(728, 104, 'budget');       // 우 상단 (budget)
    drawDesk(728, 260, 'data');         // 우 중단 (data)
    drawTable();
    drawCoffee(time);
    drawShelf();
    drawPlants(time);

    // 캐릭터 y 정렬
    agents.slice().sort((a, b) => a.y - b.y).forEach(a => drawAgent(a, time));

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function label(text, x, y, size, color, weight = '600', align = 'center') {
    ctx.font = `${weight} ${size}px "Pretendard", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function drawRoom(time) {
    // 바닥
    ctx.fillStyle = '#F7F4EC';
    roundRect(30, 30, 940, 560, 6);
    ctx.fill();

    // 마루 결
    ctx.save();
    ctx.beginPath();
    roundRect(30, 30, 940, 560, 6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,20,19,.045)';
    ctx.lineWidth = 1;
    for (let x = 46; x < 970; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, 590); ctx.stroke();
    }
    // 창가 빛
    const g = ctx.createLinearGradient(0, 30, 0, 380);
    g.addColorStop(0, 'rgba(255,252,238,.85)');
    g.addColorStop(1, 'rgba(255,252,238,0)');
    ctx.fillStyle = g;
    ctx.fillRect(30, 30, 940, 360);
    ctx.restore();

    // 벽
    ctx.strokeStyle = CH;
    ctx.lineWidth = 3;
    roundRect(30, 30, 940, 560, 6);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(20,20,19,.16)';
    ctx.lineWidth = 1;
    roundRect(42, 42, 916, 536, 4);
    ctx.stroke();

    // 창 (상단)
    [[352, 128], [690, 92]].forEach(([x, w]) => {
      ctx.fillStyle = '#E7EDEA';
      roundRect(x, 24, w, 12, 2); ctx.fill();
      ctx.strokeStyle = CH; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(20,20,19,.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + w / 2, 24); ctx.lineTo(x + w / 2, 36); ctx.stroke();
    });

    // 출입문 (하단)
    ctx.save();
    ctx.strokeStyle = CH; ctx.lineWidth = 2;
    ctx.fillStyle = '#F7F4EC';
    ctx.fillRect(560, 578, 92, 14);
    ctx.beginPath(); ctx.moveTo(560, 578); ctx.lineTo(560, 566); ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(560, 566, 78, -Math.PI / 2, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 벽시계
    ctx.save();
    ctx.translate(900, 74);
    ctx.fillStyle = PAPER; ctx.strokeStyle = CH; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, 3); ctx.stroke();
    ctx.restore();

    // 실 번호 명판
    label('452 · 237', 940, 566, 9, 'rgba(20,20,19,.4)', '600', 'right');
  }

  function drawRug() {
    ctx.save();
    ctx.fillStyle = '#EFE9DA';
    ctx.strokeStyle = 'rgba(20,20,19,.08)';
    ctx.lineWidth = 1;
    roundRect(318, 262, 364, 178, 10);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawWhiteboard(time) {
    const x = 372, y = 62, w = 300, h = 46;
    ctx.save();
    ctx.shadowColor = 'rgba(20,20,19,.10)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#FDFCF7';
    roundRect(x, y, w, h, 3);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = CH; ctx.lineWidth = 2;
    roundRect(x, y, w, h, 3); ctx.stroke();

    ctx.strokeStyle = 'rgba(20,20,19,.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 8, y + h - 7); ctx.lineTo(x + w - 8, y + h - 7); ctx.stroke();

    label('TODAY', x + 12, y + 15, 8, 'rgba(20,20,19,.45)', '700', 'left');
    const t = planText || '지시를 기다리는 중 — 아래 입력창에 지시를 내려 주세요';
    ctx.font = '700 11px "Pretendard", -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.fillStyle = CH;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fit(t, 276), x + 12, y + 30);

    // 마커 트레이
    ctx.fillStyle = TERRA;
    roundRect(x + w - 34, y + h + 1, 12, 3, 1.5); ctx.fill();
    ctx.fillStyle = '#415F6B';
    roundRect(x + w - 20, y + h + 1, 10, 3, 1.5); ctx.fill();
  }

  function fit(text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function drawPI(time) {
    // 책상
    const x = 64, y = 104, w = 236, h = 68;
    deskBase(x, y, w, h);

    // 명패
    ctx.fillStyle = SAGE;
    roundRect(x + 12, y + h - 20, 96, 13, 2); ctx.fill();
    label('김건우 교수 · @sunbear', x + 60, y + h - 13.5, 7.4, '#F7F4EC', '700');

    // 서류·노트북
    ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.35)'; ctx.lineWidth = 1;
    roundRect(x + w - 120, y + 14, 44, 30, 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - 112, y + 24); ctx.lineTo(x + w - 86, y + 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w - 112, y + 31); ctx.lineTo(x + w - 92, y + 31); ctx.stroke();

    // 곰 마스코트 자리(의자)
    const cx = 196, cy = 92;
    ctx.fillStyle = '#EFE9DA';
    ctx.beginPath(); ctx.ellipse(cx, cy + 26, 26, 12, 0, 0, Math.PI * 2); ctx.fill();

    // 곰
    const bob = Math.sin(time * 1.6) * 1.2;
    drawBear(cx, cy + bob, time);

    // PI 말풍선 (승인 대기 시)
    const pending = agents.some(a => a.state === 'waiting');
    if (pending) {
      bubble('보고 받는 중', cx + 2, cy - 34, null, true);
    } else {
      label('PI LOUNGE', cx, cy + 44, 7.5, 'rgba(20,20,19,.32)', '700');
    }
  }

  function drawBear(x, y, time) {
    ctx.save();
    // 그림자
    ctx.fillStyle = 'rgba(20,20,19,.10)';
    ctx.beginPath(); ctx.ellipse(x, y + 15, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 귀
    ctx.fillStyle = '#6B4B32';
    [[-9, -9], [9, -9]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#C9A88A';
    [[-9, -9], [9, -9]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 2.6, 0, Math.PI * 2); ctx.fill();
    });

    // 얼굴
    ctx.fillStyle = '#6B4B32';
    ctx.beginPath(); ctx.arc(x, y, 13.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 2; ctx.stroke();

    // 주둥이
    ctx.fillStyle = '#E4CBB0';
    ctx.beginPath(); ctx.ellipse(x, y + 4, 6.6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CH;
    ctx.beginPath(); ctx.ellipse(x, y + 2, 2, 1.6, 0, 0, Math.PI * 2); ctx.fill();

    // 눈 (깜빡임)
    const blink = (Math.sin(time * 0.9) > 0.985) ? 0.4 : 1;
    ctx.fillStyle = CH;
    [[-4.6, -2], [4.6, -2]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, 1.7, 1.7 * blink, 0, 0, Math.PI * 2); ctx.fill();
    });

    label('@sunbear', x, y + 26, 6.4, 'rgba(20,20,19,.55)', '700');
    ctx.restore();
  }

  function deskBase(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.07)';
    roundRect(x + 4, y + 5, w, h, 4); ctx.fill();
    ctx.fillStyle = '#FBF9F2';
    roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 2;
    roundRect(x, y, w, h, 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, y + h - 14); ctx.lineTo(x + w - 1, y + h - 14); ctx.stroke();
    ctx.restore();
  }

  function monitor(x, y, w, h, accent) {
    ctx.fillStyle = '#232321';
    roundRect(x, y, w, h, 2.5); ctx.fill();
    ctx.fillStyle = accent;
    roundRect(x + 3, y + 3, w - 6, h - 6, 1.5); ctx.fill();
    // 코드 라인
    ctx.strokeStyle = 'rgba(250,249,245,.55)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 7, y + 8 + i * 6);
      ctx.lineTo(x + 7 + (w - 18) * (0.4 + 0.22 * i), y + 8 + i * 6);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20,20,19,.35)';
    roundRect(x + w / 2 - 7, y + h, 14, 2, 1); ctx.fill();
  }

  function drawDesk(x, y, owner) {
    const w = 206, h = 70;
    deskBase(x, y, w, h);

    const agent = agents.find(a => a.id === owner);
    const accent = agent ? agent.color : TERRA;

    monitor(x + w / 2 - 30, y + 12, 60, 34, accent);
    // 키보드
    ctx.fillStyle = '#E6E2D6';
    roundRect(x + w / 2 - 22, y + h - 22, 44, 10, 2); ctx.fill();

    // 머그
    ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x + w - 26, y + 24, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + w - 19.5, y + 24, 3, -0.9, 0.9); ctx.stroke();

    // 서류 묶음
    ctx.fillStyle = PAPER;
    roundRect(x + 14, y + 18, 34, 24, 1.5); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.3)'; ctx.lineWidth = 1; ctx.stroke();

    // 이름표
    if (agent) {
      ctx.fillStyle = agent.tint;
      roundRect(x, y - 15, 20, 12, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,19,.2)'; ctx.stroke();
      label(agent.short, x + 10, y - 8.6, 7.4, agent.color, '800');
    }

    // 의자
    const seat = DESK_SEATS[agents.findIndex(a => a.id === owner)];
    if (seat) {
      ctx.fillStyle = '#E4DFD1';
      ctx.strokeStyle = 'rgba(20,20,19,.35)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(seat.x, seat.y - 6, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  function drawTable() {
    const cx = 500, cy = 350, rx = 150, ry = 62;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.08)';
    ctx.beginPath(); ctx.ellipse(cx + 4, cy + 6, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#EFE8D6';
    ctx.strokeStyle = CH; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx - 12, ry - 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // 회의 위 물건들
    ctx.fillStyle = PAPER;
    roundRect(cx - 44, cy - 18, 34, 22, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.3)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(cx + 6, cy - 8, 26, 18, 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#232321';
    roundRect(cx - 8, cy + 4, 30, 12, 2); ctx.fill();
    ctx.fillStyle = TERRA;
    roundRect(cx - 5, cy + 7, 24, 6, 1); ctx.fill();

    // 컵 3개
    [[cx - 66, cy - 4], [cx + 44, cy - 22], [cx + 62, cy + 14]].forEach(([x, y]) => {
      ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    label('COLLAB TABLE', cx, cy + 40, 7.2, 'rgba(20,20,19,.34)', '700');
  }

  function drawCoffee(time) {
    const x = 764, y = 446, w = 178, h = 74;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.07)';
    roundRect(x + 4, y + 5, w, h, 4); ctx.fill();
    ctx.fillStyle = '#EFE9DA';
    roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 2;
    roundRect(x, y, w, h, 4); ctx.stroke();

    // 머신
    ctx.fillStyle = '#232321';
    roundRect(x + 16, y + 12, 54, 44, 3); ctx.fill();
    ctx.fillStyle = TERRA;
    roundRect(x + 24, y + 18, 10, 5, 1); ctx.fill();
    ctx.fillStyle = 'rgba(250,249,245,.75)';
    roundRect(x + 40, y + 18, 10, 5, 1); ctx.fill();
    ctx.fillStyle = 'rgba(250,249,245,.4)';
    roundRect(x + 24, y + 30, 34, 12, 1.5); ctx.fill();
    ctx.fillStyle = PAPER;
    roundRect(x + 32, y + 48, 20, 6, 1.5); ctx.fill();

    // 컵 랙
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + 92 + (i % 2) * 20, y + 22 + Math.floor(i / 2) * 20, 6.2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // 스팀
    ctx.strokeStyle = 'rgba(20,20,19,.18)';
    ctx.lineWidth = 1.2;
    for (let s = 0; s < 2; s++) {
      const ph = time * 1.3 + s * 1.7;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const yy = y + 46 - t * 26;
        const xx = x + 92 + Math.sin(ph + t * 3.2) * 3;
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }

    label('COFFEE', x + w / 2, y + h - 9, 7.4, 'rgba(20,20,19,.36)', '700');
    ctx.restore();
  }

  function drawShelf() {
    const x = 330, y = 548, w = 150, h = 26;
    ctx.fillStyle = '#E9E3D3';
    roundRect(x, y, w, h, 3); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 1.8; ctx.stroke();
    const cols = ['#2D4A3E', '#B4613F', '#415F6B', '#94743F', '#6B4B32', '#D97757'];
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = cols[i % cols.length];
      const bw = 5 + (i % 3);
      roundRect(x + 8 + i * 8.4, y + 5, bw, h - 10, 1);
      ctx.fill();
    }
    label('LIBRARY', x + w / 2, y - 8, 7, 'rgba(20,20,19,.3)', '700');
  }

  function drawPlants(time) {
    [[92, 232], [934, 176], [934, 420]].forEach(([x, y], i) => {
      const sw = Math.sin(time * 1.1 + i) * 0.02;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#C4674A';
      roundRect(-11, 2, 22, 16, 3); ctx.fill();
      ctx.strokeStyle = CH; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.fillStyle = SAGE;
      for (let k = 0; k < 5; k++) {
        ctx.save();
        ctx.rotate(-0.7 + k * 0.34 + sw);
        ctx.beginPath();
        ctx.ellipse(0, -12, 5, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    });
  }

  function drawAgent(a, time) {
    const walking = a.t < 1;
    const bob = walking ? Math.abs(Math.sin(time * 12 + a.phase)) * 2.6 : Math.sin(time * 1.7 + a.phase) * 1.1;
    const y = a.y - bob;
    const st = STATES[a.state] || STATES.idle;
    const isSel = selected === a.id;

    ctx.save();

    // 그림자
    ctx.fillStyle = 'rgba(20,20,19,.12)';
    ctx.beginPath(); ctx.ellipse(a.x, a.y + 13, 15, 5.5, 0, 0, Math.PI * 2); ctx.fill();

    // 진행 링
    if (a.state === 'write' || a.state === 'research' || a.state === 'meet') {
      ctx.strokeStyle = 'rgba(217,119,87,.9)';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(a.x, y, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, a.progress || 0));
      ctx.stroke();
    }

    // 승인 대기 펄스
    if (a.state === 'waiting') {
      const p = (time * 0.8) % 1;
      ctx.strokeStyle = `rgba(192,86,46,${0.5 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x, y, 18 + p * 16, 0, Math.PI * 2); ctx.stroke();
    }

    // 선택 링
    if (isSel) {
      ctx.strokeStyle = CH;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(a.x, y, 27, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 몸통
    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.arc(a.x, y, 14.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(a.x, y, 14.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(a.x, y, 16, 0, Math.PI * 2); ctx.stroke();

    // 글리프
    label(a.glyph, a.x, y + 0.5, 12, '#FAF9F5', '800');

    // 상태 점
    ctx.fillStyle = st.color;
    ctx.beginPath(); ctx.arc(a.x + 12, y - 12, 4.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 1.5; ctx.stroke();

    // 이름표
    const labelText = a.short;
    ctx.font = '700 8.6px "Pretendard", -apple-system, "Apple SD Gothic Neo", sans-serif';
    const tw = ctx.measureText(labelText).width + 12;
    ctx.fillStyle = 'rgba(250,249,245,.94)';
    roundRect(a.x - tw / 2, y + 20, tw, 13, 6.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.18)'; ctx.lineWidth = 1; ctx.stroke();
    label(labelText, a.x, y + 26.8, 8.6, CH, '700');

    // 말풍선
    if (a.bubble) bubble(a.bubble, a.x, y - 30, st);

    ctx.restore();
  }

  function bubble(text, x, y, st, neutral) {
    ctx.save();
    ctx.font = '600 9.6px "Pretendard", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    const maxW = 132;
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    });
    if (cur) lines.push(cur);
    const shown = lines.slice(0, 2);
    const lh = 12;
    let w = 0;
    shown.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
    const bw = w + 16, bh = shown.length * lh + 10;
    const bx = Math.max(36, Math.min(W - 36 - bw, x - bw / 2));
    const by = y - bh;

    ctx.fillStyle = 'rgba(250,249,245,.97)';
    ctx.strokeStyle = 'rgba(20,20,19,.75)';
    ctx.lineWidth = 1.2;
    roundRect(bx, by, bw, bh, 5);
    ctx.fill(); ctx.stroke();

    // 꼬리
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh);
    ctx.lineTo(x + 4, by + bh);
    ctx.lineTo(x, by + bh + 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250,249,245,.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.75)';
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh); ctx.lineTo(x, by + bh + 6); ctx.lineTo(x + 4, by + bh);
    ctx.stroke();

    shown.forEach((l, i) => {
      label(l, bx + 8, by + 11 + i * lh, 9.6, CH, '600', 'left');
    });

    if (st && !neutral) {
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(bx + bw - 5, by + 5, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  return {
    init, setAgents, setPlanText, updateAgent, select, goTo,
    STATES,
    get states() { return STATES; }
  };
})();
