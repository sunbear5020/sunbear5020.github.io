/* ============================================================
   FEI · HEL 가상 연구실 — 2D 캔버스 신
   452동 237호 평면도 · 워크스테이션 8개 + PI 데스크 + 협업 테이블
   60fps requestAnimationFrame · 반응형
   ============================================================ */

const Scene = (() => {
  const W = 1000, H = 620;
  const PAPER = '#FAF9F5';
  const SAND = '#F0EEE6';
  const CH = '#141413';
  const TERRA = '#D97757';
  const SAGE = '#2D4A3E';

  const STATES = {
    idle:    { label: '대기',     color: '#8A867C' },
    research:{ label: '조사',     color: '#2D4A3E' },
    write:   { label: '작성',     color: '#B4613F' },
    meet:    { label: '협업',     color: '#415F6B' },
    waiting: { label: '승인 대기', color: '#C0562E' },
    coffee:  { label: '휴식',     color: '#94743F' },
    done:    { label: '완료',     color: '#2D4A3E' }
  };

  /* ── 배치 ─────────────────────────────────────────────── */
  const PI_DESK = { x: 56, y: 96, w: 196, h: 64 };
  const PI = { x: 154, y: 76 };
  const PI_SPOTS = [
    { x: 96, y: 178 }, { x: 134, y: 176 }, { x: 174, y: 176 }, { x: 212, y: 178 },
    { x: 112, y: 200 }, { x: 152, y: 202 }, { x: 192, y: 202 }, { x: 228, y: 196 }
  ];
  const WHITEBOARD = { x: 384, y: 56, w: 272, h: 44 };
  const TABLE = { cx: 500, cy: 330, rx: 150, ry: 60 };
  const RUG = { x: 330, y: 258, w: 340, h: 144 };
  const COFFEE = { x: 720, y: 496, w: 220, h: 62 };
  const COFFEE_SPOT = { x: 830, y: 470 };
  const SHELF = { x: 470, y: 536, w: 150, h: 26 };

  const DESKS = [
    { id: 'cohort', x: 56,  y: 210, w: 168, h: 60, seat: { x: 140, y: 292 } },
    { id: 'geo',    x: 56,  y: 310, w: 168, h: 60, seat: { x: 140, y: 392 } },
    { id: 'env',    x: 56,  y: 410, w: 168, h: 60, seat: { x: 140, y: 492 } },
    { id: 'engine', x: 778, y: 170, w: 168, h: 60, seat: { x: 862, y: 252 } },
    { id: 'dtx',    x: 778, y: 270, w: 168, h: 60, seat: { x: 862, y: 352 } },
    { id: 'budget', x: 778, y: 370, w: 168, h: 60, seat: { x: 862, y: 452 } },
    { id: 'writer', x: 720, y: 56,  w: 208, h: 60, seat: { x: 824, y: 138 } },
    { id: 'kirby',  x: 300, y: 498, w: 172, h: 60, seat: { x: 386, y: 484 }, flip: true }
  ];

  const TABLE_SEATS = [
    { x: 685, y: 330 }, { x: 631, y: 385 }, { x: 500, y: 408 }, { x: 369, y: 385 },
    { x: 315, y: 330 }, { x: 369, y: 275 }, { x: 500, y: 252 }, { x: 631, y: 275 }
  ];

  let canvas, ctx, wrap;
  let scale = 1, ox = 0, oy = 0, dpr = 1;
  let agents = [];
  let planText = '';
  let selected = null;
  let onClick = null;
  let raf = null, last = 0;
  let hotspots = [];

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
        if (Math.hypot(px - h.x, py - h.y) < 28) hit = h.id;
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
    const h = Math.max(200, Math.floor(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    scale = Math.min(w / W, h / H);
    ox = (w - W * scale) / 2;
    oy = (h - H * scale) / 2;
  }

  /* ── 에이전트 ─────────────────────────────────────────── */
  function setAgents(list) {
    agents = list.map((a, i) => {
      const desk = DESKS[i % DESKS.length];
      return {
        id: a.id, name: a.name, short: a.short, glyph: a.glyph,
        color: a.color, tint: a.tint,
        x: desk.seat.x, y: desk.seat.y,
        from: { x: desk.seat.x, y: desk.seat.y },
        to: { x: desk.seat.x, y: desk.seat.y },
        ctrl: null, t: 1,
        state: 'idle', bubble: '', progress: 0, task: '',
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
    const idx = agents.indexOf(a);
    let target;
    if (spot === 'desk') target = DESKS[idx % DESKS.length].seat;
    else if (spot === 'table') target = TABLE_SEATS[idx % TABLE_SEATS.length];
    else if (spot === 'pi') target = PI_SPOTS[idx % PI_SPOTS.length];
    else if (spot === 'coffee') target = COFFEE_SPOT;
    else return;

    if (Math.hypot(a.to.x - target.x, a.to.y - target.y) < 2 && a.t >= 1) return;
    a.from = { x: a.x, y: a.y };
    a.to = { x: target.x + (Math.random() - .5) * 6, y: target.y + (Math.random() - .5) * 6 };
    const mx = (a.from.x + a.to.x) / 2, my = (a.from.y + a.to.y) / 2;
    const nx = -(a.to.y - a.from.y), ny = (a.to.x - a.from.x);
    const len = Math.hypot(nx, ny) || 1;
    const bend = (Math.random() - .5) * 44;
    a.ctrl = { x: mx + (nx / len) * bend, y: my + (ny / len) * bend };
    a.t = 0;
  }

  /* ── 애니메이션 ───────────────────────────────────────── */
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    agents.forEach(a => {
      if (a.t < 1) {
        const dist = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
        const dur = Math.max(0.5, dist / 110);
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
    drawWhiteboard();
    drawPI(time);
    DESKS.forEach(d => drawDesk(d));
    drawTable();
    drawCoffee(time);
    drawShelf();
    drawPlants(time);

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
    ctx.fillStyle = '#F7F4EC';
    roundRect(30, 30, 940, 560, 6);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    roundRect(30, 30, 940, 560, 6);
    ctx.clip();
    ctx.strokeStyle = 'rgba(20,20,19,.045)';
    ctx.lineWidth = 1;
    for (let x = 48; x < 968; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, 590); ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, 30, 0, 380);
    g.addColorStop(0, 'rgba(255,252,238,.85)');
    g.addColorStop(1, 'rgba(255,252,238,0)');
    ctx.fillStyle = g;
    ctx.fillRect(30, 30, 940, 360);
    ctx.restore();

    ctx.strokeStyle = CH;
    ctx.lineWidth = 3;
    roundRect(30, 30, 940, 560, 6);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(20,20,19,.14)';
    ctx.lineWidth = 1;
    roundRect(42, 42, 916, 536, 4);
    ctx.stroke();

    // 출입문 (하단 벽)
    ctx.save();
    ctx.strokeStyle = CH; ctx.lineWidth = 2;
    ctx.fillStyle = '#F7F4EC';
    ctx.fillRect(640, 580, 60, 12);
    ctx.beginPath(); ctx.moveTo(640, 580); ctx.lineTo(640, 568); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(640, 566); ctx.lineTo(694, 566); ctx.stroke();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = 'rgba(20,20,19,.38)';
    ctx.beginPath(); ctx.arc(640, 566, 54, -Math.PI / 2, 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 실 명판
    label('452 · 237', 944, 570, 8.5, 'rgba(20,20,19,.4)', '700', 'right');
  }

  function drawPlanMark() {
    // 북쪽 화살표 · 축척 (도면 표기)
    ctx.save();
    ctx.translate(70, 540);
    ctx.strokeStyle = 'rgba(20,20,19,.45)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(0, -12); ctx.lineTo(4, -4); ctx.stroke();
    label('N', 0, -20, 7, 'rgba(20,20,19,.5)', '700');

    ctx.translate(0, 40);
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-14, -3); ctx.lineTo(-14, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, -3); ctx.lineTo(14, 3); ctx.stroke();
    label('0        5m', 0, 9, 6.4, 'rgba(20,20,19,.42)', '600');
    ctx.restore();
  }

  function drawRug() {
    ctx.save();
    ctx.fillStyle = '#EFE9DA';
    ctx.strokeStyle = 'rgba(20,20,19,.08)';
    ctx.lineWidth = 1;
    roundRect(RUG.x, RUG.y, RUG.w, RUG.h, 10);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawWhiteboard() {
    const { x, y, w, h } = WHITEBOARD;
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

    label('TODAY', x + 12, y + 14, 7.4, 'rgba(20,20,19,.45)', '700', 'left');
    const t = planText || '지시를 기다리는 중 — 아래 입력창에 지시를 내려 주세요';
    ctx.font = '700 10.5px "Pretendard", -apple-system, "Apple SD Gothic Neo", sans-serif';
    ctx.fillStyle = CH;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(fit(t, w - 26), x + 12, y + 30);

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
    const { x, y, w, h } = PI_DESK;
    deskBase(x, y, w, h);

    // 명패
    ctx.fillStyle = SAGE;
    roundRect(x + 12, y + h - 22, 122, 15, 2); ctx.fill();
    label('김건우 교수 · @sunbear', x + 73, y + h - 14.5, 7.6, '#F7F4EC', '700');

    // 노트북·서류
    ctx.fillStyle = '#232321';
    roundRect(x + w - 82, y + 12, 52, 32, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(250,249,245,.16)';
    roundRect(x + w - 78, y + 16, 44, 24, 1.5); ctx.fill();
    ctx.fillStyle = PAPER;
    roundRect(x + w - 140, y + 18, 40, 26, 1.5); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.3)'; ctx.lineWidth = 1; ctx.stroke();

    // PI 의자 자리
    ctx.fillStyle = '#EFE9DA';
    ctx.beginPath(); ctx.ellipse(PI.x, PI.y + 24, 24, 11, 0, 0, Math.PI * 2); ctx.fill();

    const bob = Math.sin(time * 1.6) * 1.2;
    drawBear(PI.x, PI.y + bob, time);

    const pending = agents.some(a => a.state === 'waiting');
    if (pending) bubble('보고 받는 중', PI.x, PI.y - 28, null, true);
    else label('PI DESK', PI.x, PI.y + 42, 7, 'rgba(20,20,19,.3)', '700');
  }

  function drawBear(x, y, time) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.10)';
    ctx.beginPath(); ctx.ellipse(x, y + 15, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#6B4B32';
    [[-9, -9], [9, -9]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#C9A88A';
    [[-9, -9], [9, -9]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, 2.6, 0, Math.PI * 2); ctx.fill();
    });

    ctx.fillStyle = '#6B4B32';
    ctx.beginPath(); ctx.arc(x, y, 13.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = '#E4CBB0';
    ctx.beginPath(); ctx.ellipse(x, y + 4, 6.6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CH;
    ctx.beginPath(); ctx.ellipse(x, y + 2, 2, 1.6, 0, 0, Math.PI * 2); ctx.fill();

    const blink = (Math.sin(time * 0.9) > 0.985) ? 0.4 : 1;
    ctx.fillStyle = CH;
    [[-4.6, -2], [4.6, -2]].forEach(([dx, dy]) => {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, 1.7, 1.7 * blink, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  function deskBase(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.07)';
    roundRect(x + 3, y + 4, w, h, 4); ctx.fill();
    ctx.fillStyle = '#FBF9F2';
    roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 1.8;
    roundRect(x, y, w, h, 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 1, y + h - 12); ctx.lineTo(x + w - 1, y + h - 12); ctx.stroke();
    ctx.restore();
  }

  function monitor(x, y, w, h, accent) {
    ctx.fillStyle = '#232321';
    roundRect(x, y, w, h, 2.5); ctx.fill();
    ctx.fillStyle = accent;
    roundRect(x + 2.5, y + 2.5, w - 5, h - 5, 1.5); ctx.fill();
    ctx.strokeStyle = 'rgba(250,249,245,.5)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 6, y + 7 + i * 5.5);
      ctx.lineTo(x + 6 + (w - 16) * (0.35 + 0.25 * i), y + 7 + i * 5.5);
      ctx.stroke();
    }
  }

  function drawDesk(desk) {
    const { x, y, w, h } = desk;
    const agent = agents.find(a => a.id === desk.id);
    const accent = agent ? agent.color : TERRA;
    deskBase(x, y, w, h);

    const my = desk.flip ? y + h - 36 : y + 12;
    monitor(x + w / 2 - 27, my, 54, 28, accent);

    // 키보드
    ctx.fillStyle = '#E6E2D6';
    roundRect(x + w / 2 - 20, desk.flip ? y + 6 : y + h - 18, 40, 8, 2); ctx.fill();

    // 머그
    ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.4)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(x + w - 22, y + 20, 5.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 서류
    ctx.fillStyle = PAPER;
    roundRect(x + 10, y + 14, 30, 20, 1.5); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.28)'; ctx.lineWidth = 1; ctx.stroke();

    // 이름표
    if (agent) {
      const ty = desk.flip ? y + h + 4 : y - 14;
      ctx.font = '800 6.4px "Pretendard", -apple-system, "Apple SD Gothic Neo", sans-serif';
      const tw = Math.max(20, ctx.measureText(agent.short).width + 7);
      ctx.fillStyle = agent.tint;
      roundRect(x, ty, tw, 11, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,19,.18)'; ctx.stroke();
      label(agent.short, x + tw / 2, ty + 5.8, 6.4, agent.color, '800');
    }

    // 의자
    ctx.fillStyle = '#E4DFD1';
    ctx.strokeStyle = 'rgba(20,20,19,.32)'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(desk.seat.x, desk.seat.y - 6, 12.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  function drawTable() {
    const { cx, cy, rx, ry } = TABLE;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.08)';
    ctx.beginPath(); ctx.ellipse(cx + 4, cy + 6, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#EFE8D6';
    ctx.strokeStyle = CH; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx - 12, ry - 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    ctx.fillStyle = PAPER;
    roundRect(cx - 46, cy - 18, 32, 20, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.28)'; ctx.lineWidth = 1; ctx.stroke();
    roundRect(cx + 6, cy - 10, 26, 18, 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#232321';
    roundRect(cx - 10, cy + 6, 30, 11, 2); ctx.fill();
    ctx.fillStyle = TERRA;
    roundRect(cx - 7, cy + 9, 24, 5, 1); ctx.fill();

    [[cx - 68, cy - 2], [cx + 44, cy - 22], [cx + 62, cy + 16]].forEach(([x, y]) => {
      ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });

    label('COLLAB TABLE', cx, cy + 34, 7, 'rgba(20,20,19,.32)', '700');
  }

  function drawCoffee(time) {
    const { x, y, w, h } = COFFEE;
    ctx.save();
    ctx.fillStyle = 'rgba(20,20,19,.07)';
    roundRect(x + 3, y + 4, w, h, 4); ctx.fill();
    ctx.fillStyle = '#EFE9DA';
    roundRect(x, y, w, h, 4); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 1.8;
    roundRect(x, y, w, h, 4); ctx.stroke();

    ctx.fillStyle = '#232321';
    roundRect(x + 14, y + 10, 50, 38, 3); ctx.fill();
    ctx.fillStyle = TERRA;
    roundRect(x + 21, y + 15, 9, 4.5, 1); ctx.fill();
    ctx.fillStyle = 'rgba(250,249,245,.75)';
    roundRect(x + 34, y + 15, 9, 4.5, 1); ctx.fill();
    ctx.fillStyle = 'rgba(250,249,245,.4)';
    roundRect(x + 21, y + 25, 30, 10, 1.5); ctx.fill();
    ctx.fillStyle = PAPER;
    roundRect(x + 29, y + 40, 18, 5, 1.5); ctx.fill();

    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = PAPER; ctx.strokeStyle = 'rgba(20,20,19,.32)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x + 92 + (i % 3) * 18, y + 18 + Math.floor(i / 3) * 18, 5.6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(20,20,19,.16)';
    ctx.lineWidth = 1.1;
    for (let s = 0; s < 2; s++) {
      const ph = time * 1.3 + s * 1.7;
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const yy = y + 38 - t * 24;
        const xx = x + 92 + Math.sin(ph + t * 3.2) * 3;
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
    }

    label('COFFEE · 휴게', x + w / 2, y + h - 9, 7, 'rgba(20,20,19,.34)', '700');
    ctx.restore();
  }

  function drawShelf() {
    const { x, y, w, h } = SHELF;
    ctx.fillStyle = '#E9E3D3';
    roundRect(x, y, w, h, 3); ctx.fill();
    ctx.strokeStyle = CH; ctx.lineWidth = 1.6; ctx.stroke();
    const cols = ['#2D4A3E', '#B4613F', '#415F6B', '#94743F', '#6B4B32', '#D97757'];
    for (let i = 0; i < 15; i++) {
      ctx.fillStyle = cols[i % cols.length];
      roundRect(x + 7 + i * 9, y + 5, 5 + (i % 3), h - 10, 1);
      ctx.fill();
    }
    label('LIBRARY', x + w / 2, y - 7, 6.6, 'rgba(20,20,19,.3)', '700');
  }

  function drawPlants(time) {
    [[352, 186], [700, 462], [258, 516]].forEach(([x, y], i) => {
      const sw = Math.sin(time * 1.1 + i) * 0.02;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = '#C4674A';
      roundRect(-10, 2, 20, 15, 3); ctx.fill();
      ctx.strokeStyle = CH; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.fillStyle = SAGE;
      for (let k = 0; k < 5; k++) {
        ctx.save();
        ctx.rotate(-0.7 + k * 0.34 + sw);
        ctx.beginPath();
        ctx.ellipse(0, -11, 4.6, 13, 0, 0, Math.PI * 2);
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

    ctx.fillStyle = 'rgba(20,20,19,.12)';
    ctx.beginPath(); ctx.ellipse(a.x, a.y + 13, 14, 5.2, 0, 0, Math.PI * 2); ctx.fill();

    if (a.state === 'write' || a.state === 'research' || a.state === 'meet') {
      ctx.strokeStyle = 'rgba(217,119,87,.9)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(a.x, y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, a.progress || 0));
      ctx.stroke();
    }

    if (a.state === 'waiting') {
      const p = (time * 0.8) % 1;
      ctx.strokeStyle = `rgba(192,86,46,${0.5 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x, y, 17 + p * 15, 0, Math.PI * 2); ctx.stroke();
    }

    if (isSel) {
      ctx.strokeStyle = CH;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(a.x, y, 25, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = a.color;
    ctx.beginPath(); ctx.arc(a.x, y, 13.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(a.x, y, 13.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,20,19,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(a.x, y, 15, 0, Math.PI * 2); ctx.stroke();

    label(a.glyph, a.x, y + 0.5, 10.5, '#FAF9F5', '800');

    ctx.fillStyle = st.color;
    ctx.beginPath(); ctx.arc(a.x + 11, y - 11, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 1.4; ctx.stroke();

    // 이름표
    ctx.font = '700 8px "Pretendard", -apple-system, "Apple SD Gothic Neo", sans-serif';
    const tw = ctx.measureText(a.short).width + 11;
    ctx.fillStyle = 'rgba(250,249,245,.94)';
    roundRect(a.x - tw / 2, y + 19, tw, 12, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.18)'; ctx.lineWidth = 1; ctx.stroke();
    label(a.short, a.x, y + 25.2, 8, CH, '700');

    if (a.bubble) bubble(a.bubble, a.x, y - 27 - ((agents.indexOf(a) % 2) * 17), st);

    ctx.restore();
  }

  function bubble(text, x, y, st, neutral) {
    ctx.save();
    ctx.font = '600 9.2px "Pretendard", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    const maxW = 118;
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
    const lh = 11.5;
    let w = 0;
    shown.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
    const bw = w + 15, bh = shown.length * lh + 9;
    const bx = Math.max(36, Math.min(W - 36 - bw, x - bw / 2));
    const by = y - bh;

    ctx.fillStyle = 'rgba(250,249,245,.97)';
    ctx.strokeStyle = 'rgba(20,20,19,.72)';
    ctx.lineWidth = 1.1;
    roundRect(bx, by, bw, bh, 5);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh);
    ctx.lineTo(x + 4, by + bh);
    ctx.lineTo(x, by + bh + 5);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250,249,245,.97)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,19,.72)';
    ctx.beginPath();
    ctx.moveTo(x - 4, by + bh); ctx.lineTo(x, by + bh + 5); ctx.lineTo(x + 4, by + bh);
    ctx.stroke();

    shown.forEach((l, i) => {
      label(l, bx + 7.5, by + 10 + i * lh, 9.2, CH, '600', 'left');
    });

    if (st && !neutral) {
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(bx + bw - 5, by + 5, 2.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  return {
    init, setAgents, setPlanText, updateAgent, select, goTo,
    STATES,
    get states() { return STATES; }
  };
})();
