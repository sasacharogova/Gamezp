/*
 * Звезда провинции — движок игры (window.Game).
 *
 * Режимы:
 *   - обычный: меню и магазин рисует app.js, а он вызывает Game.demo() / Game.play();
 *   - ?render=1: покадровый рендер автопилота для превью-видео (scripts/render-preview.js);
 *   - виджет (window.__WIDGET__): игра прямо в сообщении — демо крутится само, тап запускает уровень 1.
 *
 * Физика идёт фиксированным шагом, поэтому всё детерминировано: автопилот заранее
 * просчитывает уровень (makePlan) и в демо никогда не ошибается.
 */
(function () {
  'use strict';
  const CAT = self.CATALOG, LG = self.LEVELGEN;

  // ---------- утилиты ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)); }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  const fx = LG.mulberry32(12345); // свой ГСЧ для частиц — чтобы видео рендерилось одинаково

  // ---------- параметры из URL ----------
  const params = new URLSearchParams(location.search);
  const RENDER = params.has('render');
  const WIDGET = !RENDER && !!self.__WIDGET__;
  const BRAND = params.get('brand') || '';
  const RSCALE = clamp(parseFloat(params.get('scale') || '2') || 2, 1, 4);

  // ---------- мир ----------
  const W = 640, H = 400;          // «эталонный» кадр (и размер превью-видео в логических px)
  const GROUND = LG.GROUND;        // верх земли
  const PW = 66, PH = 28;          // хитбокс машины (рисуется чуть длиннее — бамперы прощают касания)
  const PLAYER_SX = 120;           // где машина стоит на экране по X (левый край хитбокса)
  const DT = 1 / 120;              // шаг физики
  const GRAVITY = 2900;
  const JUMP_V = 820;              // высота прыжка ≈ 116 px
  const LAND_TOL = 7;              // насколько можно «не долететь» до верха блока и всё равно встать
  const SECTION_LEN = 2000;        // каждые ~6 секунд меняется оттенок фона
  const GHOST_TIME = 1;            // секунд неуязвимости после удара, который «съела» броня
  const OK = 0, DEAD = 1, FINISH = 2;
  const BASE = { jumpMul: 1, armor: 0, coinMul: 1 };

  function firstIdx(arr, x) { // первый индекс с arr[i].x >= x
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].x < x) lo = m + 1; else hi = m; }
    return lo;
  }

  // ---------- физика (одна и та же для игры и для автопилота) ----------
  // s: { f — номер шага, x — левый край хитбокса, y — низ колёс, vy, g — стоит ли на опоре }
  // P: { stepX — смещение за шаг, jumpV — скорость прыжка, len — длина уровня }
  // ghost: машина неуязвима — шипы не страшны, а от стенки столба её выталкивает наверх
  function physStep(s, jump, obs, P, ghost) {
    if (s.g && jump) { s.vy = -P.jumpV; s.g = false; }
    s.f++;
    s.x = s.f * P.stepX;
    const left = s.x + 1, right = s.x + PW - 1;
    const i0 = firstIdx(obs, left - 200);

    if (s.g && s.y < GROUND) { // сошли с края столба — начинаем падать
      let support = false;
      for (let i = i0; i < obs.length && obs[i].x <= right; i++) {
        const o = obs[i];
        if (o.t === 'p' && o.x + o.w >= left && o.top === s.y) { support = true; break; }
      }
      if (!support) { s.g = false; s.vy = 0; }
    }

    const prevY = s.y;
    if (!s.g) { s.vy += GRAVITY * DT; s.y += s.vy * DT; }

    for (let i = i0; i < obs.length && obs[i].x <= right; i++) { // столбы: сверху — встать, сбоку — удар
      const o = obs[i];
      if (o.t !== 'p' || o.x + o.w < left) continue;
      if (s.y > o.top) {
        if ((!s.g && s.vy >= 0 && prevY <= o.top + LAND_TOL) || ghost) { s.y = o.top; s.vy = 0; s.g = true; }
        else return DEAD;
      }
    }
    if (!s.g && s.y >= GROUND) { s.y = GROUND; s.vy = 0; s.g = true; }

    if (!ghost) { // шипы — хитбокс уже самого треугольника, как принято в жанре
      for (let i = i0; i < obs.length && obs[i].x <= right; i++) {
        const o = obs[i];
        if (o.t !== 's') continue;
        if (s.x + 4 < o.x + 22 && s.x + PW - 4 > o.x + 10 && s.y - 4 > o.base - 22 && s.y - PH + 4 < o.base) return DEAD;
      }
    }
    return s.x >= P.len ? FINISH : OK;
  }

  // ---------- автопилот ----------
  // Граф состояний «стоим на опоре в шаге f на высоте y» → два действия: ехать или прыгнуть.
  // Прямой проход строит граф, обратный помечает, откуда можно доехать до финиша.
  // Возвращает множество шагов, на которых надо прыгать (или null, если уровень непроходим).
  function makePlan(obs, P) {
    const FIN = -1, LEAD = 7, LOOK = 90;
    const nodes = new Map(), frames = [];
    const add = (f, y) => {
      const k = f * 512 + y;
      if (!nodes.has(k)) { nodes.set(k, { f, y, stay: null, jump: null, gs: false, gj: false, good: false }); (frames[f] || (frames[f] = [])).push(k); }
      return k;
    };
    const run = (f, y, jump) => {
      const s = { f, x: f * P.stepX, y, vy: 0, g: true };
      let r = physStep(s, jump, obs, P, false);
      while (r === OK && !s.g) r = physStep(s, false, obs, P, false);
      if (r === DEAD) return null;
      if (r === FINISH) return FIN;
      return add(s.f, s.y);
    };
    const startKey = add(0, GROUND);
    const maxF = Math.ceil(P.len / P.stepX) + 2;
    for (let f = 0; f <= maxF; f++) {
      const list = frames[f]; if (!list) continue;
      for (const k of list) { const n = nodes.get(k); n.stay = run(n.f, n.y, false); n.jump = run(n.f, n.y, true); }
    }
    const ok = k => k === FIN || (k !== null && nodes.get(k).good);
    for (let f = frames.length - 1; f >= 0; f--) {
      const list = frames[f]; if (!list) continue;
      for (const k of list) { const n = nodes.get(k); n.gs = ok(n.stay); n.gj = ok(n.jump); n.good = n.gs || n.gj; }
    }
    let n = nodes.get(startKey);
    if (!n.good) return null;
    // Политика: едем, пока можно; прыгаем за LEAD шагов до последнего момента — так выглядит «по-человечески».
    const jumps = new Set();
    for (;;) {
      let t = n, D = 0;
      while (t.gs && t.stay !== FIN && D < LOOK) { t = nodes.get(t.stay); D = t.f - n.f; }
      const doJump = !n.gs || (n.gj && !t.gs && D <= LEAD);
      if (doJump) jumps.add(n.f);
      const next = doJump ? n.jump : n.stay;
      if (next === FIN) break;
      n = nodes.get(next);
    }
    return jumps;
  }

  // ---------- уровни ----------
  const cache = [];
  function level(i) { return cache[i] || (cache[i] = { data: LG.build(i), plan: undefined, planMs: 0 }); }
  function basePhys(lv) { return { stepX: lv.speed * DT, jumpV: JUMP_V, len: lv.len }; }
  function planFor(i) {
    const L = level(i);
    if (L.plan === undefined) { const t0 = performance.now(); L.plan = makePlan(L.data.obs, basePhys(L.data)); L.planMs = Math.round(performance.now() - t0); }
    return L.plan;
  }

  // ---------- Telegram ----------
  const tg = self.Telegram && self.Telegram.WebApp;
  const inTelegram = !RENDER && !WIDGET && !!(tg && (tg.initData || (tg.platform && tg.platform !== 'unknown')));
  function tgv(v) { try { return inTelegram && tg.isVersionAtLeast(v); } catch (e) { return false; } }
  function haptic(kind) {
    if (!tgv('6.1')) return;
    try {
      if (kind === 'jump') tg.HapticFeedback.impactOccurred('light');
      else if (kind === 'hit') tg.HapticFeedback.impactOccurred('heavy');
      else if (kind === 'die') tg.HapticFeedback.notificationOccurred('error');
      else if (kind === 'win') tg.HapticFeedback.notificationOccurred('success');
    } catch (e) { /* старый клиент */ }
  }
  function setChrome(c) {
    document.documentElement.style.setProperty('--bg', c);
    if (tgv('6.1')) { try { tg.setHeaderColor(c); tg.setBackgroundColor(c); } catch (e) { /* ignore */ } }
  }

  // ---------- состояние ----------
  const G = {
    mode: 'demo', prevMode: 'demo', li: 0, lv: null, P: null, car: 'eshka', stats: BASE, hooks: {}, plan: null,
    p: null, taken: null, pickups: 0, armor: 0, attempt: 1, parts: [], trail: 0, shake: 0, deadT: 0, banner: 0,
    wins: 0, deaths: 0, sec: -1, pal: null,
  };
  const input = { hold: false, buffer: 0 };

  function begin(li, car, stats, mode, hooks) {
    G.li = clamp(li | 0, 0, CAT.LEVELS.length - 1);
    G.lv = level(G.li).data;
    G.car = self.CAR_LOOKS[car] ? car : 'eshka';
    G.stats = Object.assign({}, BASE, stats);
    G.P = { stepX: G.lv.speed * DT, jumpV: JUMP_V * G.stats.jumpMul, len: G.lv.len };
    G.mode = mode;
    G.hooks = hooks || {};
    G.plan = mode === 'demo' ? planFor(G.li) : null;
    G.pal = G.lv.palette.map(hexToRgb);
    G.attempt = 1;
    G.sec = -1;
    newAttempt();
  }

  function newAttempt() {
    G.p = { f: 0, x: 0, y: GROUND, vy: 0, g: true, rot: 0, wheel: 0, sag: 0, ghost: 0 };
    G.taken = new Uint8Array(G.lv.pickups.length);
    G.pickups = 0;
    G.armor = G.stats.armor;
    G.parts = [];
    G.trail = 0;
    G.banner = G.mode === 'play' ? 1.8 : 0;
    input.buffer = 0;
    if (G.mode === 'play' && G.hooks.onAttemptStart) G.hooks.onAttemptStart(G.attempt);
  }

  function burst(n, colors, speed, up) {
    const p = G.p;
    for (let i = 0; i < n; i++) {
      const a = fx() * Math.PI * 2, v = speed * (0.3 + fx()), life = 0.5 + fx() * 0.4;
      G.parts.push({ x: p.x + PW / 2 + (fx() - 0.5) * 50, y: p.y - 14, vx: Math.cos(a) * v + 60, vy: Math.sin(a) * v - up, life, max: life, s: 4 + fx() * 7, c: colors[i % colors.length], g: 1 });
    }
  }

  function die() {
    const L = self.CAR_LOOKS[G.car];
    G.prevMode = G.mode; G.mode = 'dead'; G.deadT = 0.75; G.shake = 0.3; G.deaths++;
    burst(26, [L.color, L.color, '#d9dfe6', '#2b3a55', '#151515'], 320, 140);
    for (let i = 0; i < 6; i++) { // дым
      const life = 0.6 + fx() * 0.3;
      G.parts.push({ x: G.p.x + PW / 2 + (fx() - 0.5) * 40, y: G.p.y - 18, vx: (fx() - 0.5) * 60, vy: -40 - fx() * 40, life, max: life, s: 10 + fx() * 8, c: 'rgba(40,40,48,0.7)', g: -0.02, puff: true });
    }
    if (G.prevMode === 'play') {
      haptic('die');
      if (G.hooks.onAttemptEnd) G.hooks.onAttemptEnd({ finished: false, pickups: G.pickups, progress: G.p.x / G.lv.len, attempt: G.attempt });
    }
  }

  function finish() {
    G.wins++;
    if (G.mode !== 'play') { newAttempt(); return; } // демо просто крутится по кругу
    G.mode = 'win';
    haptic('win');
    const p = G.p;
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (fx() - 0.5) * 2.2, v = 200 + fx() * 400, life = 1 + fx();
      G.parts.push({ x: p.x + PW / 2, y: p.y - 16, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, s: 4 + fx() * 6, c: i % 3 ? '#ffcf3a' : '#ffffff', g: 1 });
    }
    if (G.hooks.onAttemptEnd) G.hooks.onAttemptEnd({ finished: true, pickups: G.pickups, progress: 1, attempt: G.attempt });
  }

  function collect() {
    const p = G.p, pk = G.lv.pickups, cx = p.x + PW / 2;
    for (let i = firstIdx(pk, p.x - 20); i < pk.length && pk[i].x <= p.x + PW + 20; i++) {
      if (G.taken[i]) continue;
      const c = pk[i];
      if (Math.abs(c.x - cx) <= PW / 2 + 6 && c.y >= p.y - PH - 10 && c.y <= p.y + 6) {
        G.taken[i] = 1; G.pickups++;
        for (let k = 0; k < 5; k++) {
          const a = fx() * Math.PI * 2, life = 0.35;
          G.parts.push({ x: c.x, y: c.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, life, max: life, s: 3, c: '#ffe27a', g: 0 });
        }
      }
    }
  }

  function tick() {
    for (const q of G.parts) { q.life -= DT; q.vy += 900 * q.g * DT; q.x += q.vx * DT; q.y += q.vy * DT; }
    if (G.parts.length > 160 || (G.parts.length && G.parts[0].life <= 0)) G.parts = G.parts.filter(q => q.life > 0);
    if (G.shake > 0) G.shake = Math.max(0, G.shake - DT);
    if (G.banner > 0) G.banner -= DT;

    const p = G.p;
    if (G.mode === 'play' || G.mode === 'demo') {
      const jump = G.mode === 'demo' ? !!(G.plan && G.plan.has(p.f)) : (input.hold || input.buffer > 0);
      if (input.buffer > 0) input.buffer -= DT;
      const wasG = p.g;
      const snap = { f: p.f, x: p.x, y: p.y, vy: p.vy, g: p.g };
      let r = physStep(p, jump, G.lv.obs, G.P, p.ghost > 0);
      if (r === DEAD && G.armor > 0) { // броня принимает удар на себя
        Object.assign(p, snap);
        G.armor--; p.ghost = GHOST_TIME; G.shake = 0.2;
        burst(10, ['#ffe27a', '#ffffff'], 220, 60);
        haptic('hit');
        r = physStep(p, jump, G.lv.obs, G.P, true);
      }
      if (p.ghost > 0) p.ghost -= DT;
      if (wasG && !p.g && p.vy < 0) { input.buffer = 0; if (G.mode === 'play') haptic('jump'); }
      if (!wasG && p.g) p.sag = 3.5; // приземлились — кузов приседает на подвеске
      p.sag *= Math.exp(-10 * DT);
      p.wheel += G.P.stepX / self.CAR_LOOKS[G.car].wr;
      const tilt = p.g ? 0 : clamp(p.vy / JUMP_V * 0.3, -0.3, 0.3); // в прыжке нос вверх, на спуске — вниз
      p.rot += (tilt - p.rot) * Math.min(1, (p.g ? 20 : 10) * DT);
      if (r === DEAD) return die();
      collect();
      if (r === FINISH) return finish();
      if (++G.trail % 7 === 0) { // выхлоп
        G.parts.push({ x: p.x + PW / 2 - 42, y: p.y - 8, vx: -50 - fx() * 50, vy: -10 - fx() * 25, life: 0.55, max: 0.55, s: 3 + fx() * 3, c: 'rgba(235,235,245,0.75)', g: -0.03, puff: true });
      }
      if (p.g && G.trail % 4 === 0) { // пыль из-под колёс
        G.parts.push({ x: p.x + PW / 2 - 24, y: p.y - 2, vx: -70 - fx() * 60, vy: -15 - fx() * 35, life: 0.3, max: 0.3, s: 2 + fx() * 3, c: 'rgba(255,255,255,0.6)', g: 0.3 });
      }
    } else if (G.mode === 'dead') {
      G.deadT -= DT;
      if (G.deadT <= 0) {
        G.mode = G.prevMode;
        if (G.mode === 'play') G.attempt++;
        newAttempt();
      }
    }
  }

  // ---------- отрисовка ----------
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let scale = 1, cssScale = 1, viewW = W, viewH = H, offY = 0;

  function resize() {
    if (RENDER) {
      canvas.width = W * RSCALE; canvas.height = H * RSCALE;
      scale = RSCALE; cssScale = 1; viewW = W; viewH = H; offY = 0;
      return;
    }
    const dpr = Math.min(self.devicePixelRatio || 1, 3);
    const cw = (WIDGET ? canvas.clientWidth : self.innerWidth) || 600;
    const ch = (WIDGET ? canvas.clientHeight : self.innerHeight) || 375;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const s = Math.min(cw / 560, ch / 360); // гарантируем видимую область минимум 560×360
    scale = s * dpr; cssScale = s; viewW = cw / s; viewH = ch / s;
    offY = Math.max(0, (viewH - H) * 0.55);
  }

  function sectionColor(x) {
    const k = Math.max(0, x) / SECTION_LEN, i = Math.floor(k), t = k - i, n = G.pal.length;
    const b = clamp((t - 0.93) / 0.07, 0, 1);
    return mix(G.pal[i % n], G.pal[(i + 1) % n], b * b * (3 - 2 * b));
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function coinIcon(x, y, r, squash) {
    ctx.fillStyle = '#d99a00';
    ctx.beginPath(); ctx.ellipse(x, y, r * squash, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcf3a';
    ctx.beginPath(); ctx.ellipse(x, y, r * squash * 0.78, r * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x - r * squash * 0.35, y - r * 0.45, Math.max(1, r * squash * 0.25), r * 0.5);
  }

  function shield(x, y, on) {
    ctx.beginPath();
    ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y - 4.5); ctx.lineTo(x + 5, y + 2); ctx.lineTo(x, y + 7); ctx.lineTo(x - 5, y + 2); ctx.lineTo(x - 6, y - 4.5); ctx.closePath();
    ctx.fillStyle = on ? '#7fd3ff' : 'rgba(255,255,255,0.18)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = on ? '#0d3b66' : 'rgba(0,0,0,0.3)'; ctx.stroke();
  }

  function draw() {
    const p = G.p, lv = G.lv;
    const camX = p.x - PLAYER_SX;
    const bg = sectionColor(p.x);
    const ground = mix(bg, [0, 0, 0], 0.5);
    const sec = Math.floor(p.x / SECTION_LEN);
    if (inTelegram && sec !== G.sec) { G.sec = sec; setChrome(rgb(G.pal[sec % G.pal.length])); }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(bg);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shake = G.shake > 0 ? (fx() - 0.5) * 10 * (G.shake / 0.3) : 0;
    ctx.setTransform(scale, 0, 0, scale, shake * scale, offY * scale);

    // небо: лёгкий градиент + параллакс-квадраты
    const grad = ctx.createLinearGradient(0, -offY, 0, GROUND);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = grad; ctx.fillRect(-20, -offY, viewW + 40, GROUND + offY);
    const par = camX * 0.3, cell = 90;
    for (let c = Math.floor(par / cell) - 1; c <= Math.ceil((par + viewW) / cell); c++) {
      for (let r = Math.floor(-offY / cell) - 1; r < Math.ceil(GROUND / cell); r++) {
        const h = hash2(c, r);
        if (h > 0.3) continue;
        const sz = cell * (0.35 + 0.45 * hash2(r + 99, c));
        ctx.fillStyle = 'rgba(255,255,255,' + (0.04 + h * 0.15).toFixed(3) + ')';
        ctx.fillRect(c * cell - par + (cell - sz) / 2, r * cell + (cell - sz) / 2, sz, sz);
      }
    }

    // мир
    ctx.translate(-camX, 0);
    const bottom = viewH - offY;
    ctx.fillStyle = rgb(ground);
    ctx.fillRect(camX - 20, GROUND, viewW + 40, bottom - GROUND + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; // разметка дороги
    for (let gx = Math.floor(camX / 80) * 80; gx < camX + viewW + 80; gx += 80) ctx.fillRect(gx, GROUND + 20, 40, 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(camX - 20, GROUND - 1, viewW + 40, 2);

    // финиш
    const fxX = lv.len + PW + 60;
    if (fxX < camX + viewW + 40) {
      for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#151515';
        ctx.fillRect(fxX + j * 10, GROUND - 120 + i * 10, 10, 10);
      }
    }

    // препятствия
    for (let i = firstIdx(lv.obs, camX - 200); i < lv.obs.length && lv.obs[i].x < camX + viewW + 10; i++) {
      const o = lv.obs[i];
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.fillStyle = '#06070f';
      if (o.t === 'p') {
        const h = GROUND - o.top;
        ctx.fillRect(o.x, o.top, o.w, h);
        ctx.strokeRect(o.x + 1, o.top + 1, o.w - 2, h);
        if (h > 24) { ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.strokeRect(o.x + 7, o.top + 7, o.w - 14, h - 14); }
      } else {
        ctx.beginPath();
        ctx.moveTo(o.x + 1, o.base); ctx.lineTo(o.x + 16, o.base - 32); ctx.lineTo(o.x + 31, o.base); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }

    // монетки
    const pk = lv.pickups, spin = p.f * DT * 4;
    for (let i = firstIdx(pk, camX - 20); i < pk.length && pk[i].x < camX + viewW + 20; i++) {
      if (!G.taken[i]) coinIcon(pk[i].x, pk[i].y, 8, 0.3 + 0.7 * Math.abs(Math.cos(spin + pk[i].x * 0.02)));
    }

    // частицы
    for (const q of G.parts) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = q.c;
      if (q.puff) { ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (1.6 - q.life / q.max), 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // машина (мигает, пока неуязвима)
    if (G.mode !== 'dead' && !(p.ghost > 0 && Math.floor(p.ghost * 12) % 2)) {
      const air = p.g ? 0 : clamp(Math.abs(p.vy) / JUMP_V * 2.5, 0, 2);
      const rumble = p.g ? Math.sin(p.f * 1.7) * 0.35 : 0; // двигатель чуть трясёт кузов
      self.drawCar(ctx, G.car, p.x + PW / 2, p.y, p.rot, p.wheel, p.sag + rumble, air);
    }

    // HUD — в экранных координатах
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const pct = clamp(p.x / lv.len, 0, 1);
    const bw = Math.min(240, viewW * 0.36), bx = (viewW - bw) / 2, by = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(bx, by, bw, 8, 4); ctx.fill();
    if (pct > 0.004) { ctx.fillStyle = '#5cff6a'; roundRect(bx, by, Math.max(8, bw * pct), 8, 4); ctx.fill(); }

    const playing = G.mode === 'play' || G.mode === 'win' || (G.mode === 'dead' && G.prevMode === 'play');
    if (!RENDER && playing) {
      const font = '700 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.font = font; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'left';
      ctx.fillText(Math.floor(pct * 100) + '%', bx + bw + 8, by + 4);
      const hx = WIDGET ? 14 : Math.ceil(56 / cssScale); // слева в приложении — кнопка выхода (46 css px)
      coinIcon(hx + 7, by + 4, 7, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(String(Math.round(G.pickups * CAT.COIN_VALUE * G.stats.coinMul)), hx + 19, by + 4.5);
      ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Попытка ' + G.attempt, hx, by + 22);
      if (G.stats.armor > 6) { // много брони — один щит и число
        ctx.font = font; const t = '×' + G.armor, tw = ctx.measureText(t).width;
        shield(viewW - 20 - tw, by + 4, G.armor > 0);
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(t, viewW - 10 - tw, by + 4.5);
      } else {
        for (let i = 0; i < G.stats.armor; i++) shield(viewW - 18 - i * 16, by + 4, i < G.armor);
      }
      if (G.banner > 0) { // название уровня в начале попытки
        ctx.globalAlpha = clamp(G.banner / 0.5, 0, 1);
        ctx.font = '800 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('Уровень ' + (G.li + 1) + ' · ' + lv.name, viewW / 2, viewH * 0.3);
        ctx.globalAlpha = 1;
      }
    }

    // виджет: подсказка поверх демо и экран победы — без DOM, прямо на холсте
    if (WIDGET && (G.mode === 'demo' || G.mode === 'win')) {
      const msg = G.mode === 'win' ? 'Ты — звезда провинции! Тапни, чтобы ещё раз' : 'Тапни, чтобы играть';
      ctx.font = '700 16px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(msg).width + 32, ty = Math.round(viewH * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect((viewW - tw) / 2, ty - 18, tw, 36, 18); ctx.fill();
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(performance.now() / 260);
      ctx.fillStyle = '#ffffff'; ctx.fillText(msg, viewW / 2, ty + 1);
      ctx.globalAlpha = 1;
    }

    // подпись-плашка снизу (только в превью-видео)
    if (RENDER && BRAND) {
      const bh = 34, y0 = H - bh;
      ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fillRect(0, y0, W, bh);
      ctx.save(); ctx.translate(30, y0 + 25); ctx.scale(0.42, 0.42); self.drawCar(ctx, G.car, 0, 0, 0, 0.4, 0, 0); ctx.restore();
      ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const parts = BRAND.split(' — '), tx = 54;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(parts[0], tx, y0 + bh / 2 + 1);
      if (parts.length > 1) {
        const w0 = ctx.measureText(parts[0]).width;
        ctx.font = '400 13px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(' — ' + parts.slice(1).join(' — '), tx + w0, y0 + bh / 2 + 1);
      }
    }
  }

  // ---------- управление ----------
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'Enter'];
  function press() { input.hold = true; input.buffer = 0.12; }
  function release() { input.hold = false; }
  const widgetIdle = () => WIDGET && (G.mode === 'demo' || G.mode === 'win');
  function widgetStart() { begin(0, 'eshka', BASE, 'play', {}); }

  // ---------- запуск ----------
  begin(+params.get('level') || 0, params.get('car') || 'eshka', BASE, 'demo', null);
  resize();

  if (!RENDER) {
    if (WIDGET) {
      const fb = document.getElementById('fb'); // статичная заглушка на случай, если скрипт не запустится
      if (fb) fb.style.display = 'none';
      if (self.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    } else if (inTelegram) {
      try { tg.ready(); tg.expand(); if (tgv('7.7')) tg.disableVerticalSwipes(); } catch (e) { /* ignore */ }
    }
    self.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (widgetIdle()) widgetStart(); else if (G.mode === 'play') press();
    });
    self.addEventListener('pointerup', release);
    self.addEventListener('pointercancel', release);
    self.addEventListener('blur', release);
    self.addEventListener('keydown', e => {
      if (!JUMP_KEYS.includes(e.code) || (!WIDGET && G.mode !== 'play')) return;
      e.preventDefault();
      if (e.repeat) return;
      if (widgetIdle()) widgetStart(); else press();
    });
    self.addEventListener('keyup', e => { if (JUMP_KEYS.includes(e.code)) release(); });

    let last = performance.now(), acc = 0;
    const frame = now => {
      acc += Math.min(0.1, (now - last) / 1000); last = now;
      while (acc >= DT) { tick(); acc -= DT; }
      draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  draw();

  // API для меню (app.js) и для скриптов рендера и проверки
  self.Game = {
    demo(li, car) { begin(li || 0, car || 'eshka', BASE, 'demo', null); },
    play(li, car, stats, hooks) { begin(li, car, stats, 'play', hooks); },
    get mode() { return G.mode; },
    tg: inTelegram ? tg : null,
    haptic,
    verify(li, seed) { // проходим ли уровень базовой машиной (seed — чтобы подобрать другое зерно)
      const L = seed === undefined ? level(li).data : LG.build(li, seed), pl = makePlan(L.obs, basePhys(L));
      return { ok: !!pl, jumps: pl ? pl.size : 0, obstacles: L.obs.length, pickups: L.pickups.length };
    },
    advance(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) tick(); draw(); },
    frame() { return canvas.toDataURL('image/png').split(',')[1]; },
    stats() {
      return {
        level: G.li, car: G.car, mode: G.mode, x: G.p.x, wins: G.wins, deaths: G.deaths, attempt: G.attempt,
        pickups: G.pickups, armor: G.armor, planMs: level(G.li).planMs, jumps: G.plan ? G.plan.size : 0,
      };
    },
  };
})();
