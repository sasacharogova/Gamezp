/*
 * Прыг-Куб — мини-раннер для Telegram Mini App.
 *
 * Один и тот же код работает в двух режимах:
 *   - обычный: игра для человека (тап / пробел — прыжок), открывается кнопкой бота;
 *   - ?render=1: покадровый рендер автопилота — из него scripts/render-preview.js
 *     делает зацикленное MP4, которое бот присылает в чат как «гифку».
 *
 * Физика идёт фиксированным шагом, поэтому всё детерминировано: автопилот заранее
 * просчитывает уровень (makePlan) и в видео никогда не ошибается.
 */
(function () {
  'use strict';

  // ---------- утилиты ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)); }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  // ---------- параметры из URL ----------
  const params = new URLSearchParams(location.search);
  const RENDER = params.has('render');
  const SEED = parseInt(params.get('seed') || '7', 10) || 7;
  const BRAND = params.get('brand') || '';
  const RSCALE = clamp(parseFloat(params.get('scale') || '2') || 2, 1, 4);

  // ---------- мир ----------
  const W = 640, H = 400;          // «эталонный» кадр (и размер превью-видео в логических px)
  const GROUND = 320;              // верх земли
  const SIZE = 32;                 // размер кубика
  const PLAYER_SX = 150;           // где кубик стоит на экране по X
  const DT = 1 / 120;              // шаг физики
  const SPEED = 330;               // px/с
  const STEP_X = SPEED * DT;       // 2.75 px за шаг — ровно, без накопления ошибки
  const GRAVITY = 2900;
  const JUMP_V = 820;              // высота прыжка ≈ 116 px, длина ≈ 187 px
  const LAND_TOL = 7;              // насколько можно «не долететь» до верха блока и всё равно встать
  const LEVEL_LEN = 12000;         // ≈ 36 секунд
  const SECTION_LEN = 2000;        // каждые ~6 секунд меняется цвет фона
  const ROT_SPEED = Math.PI / (2 * JUMP_V / GRAVITY); // пол-оборота за прыжок
  const PAL = ['#2a48b5', '#8a14b0', '#0e8a87', '#c22a52', '#2c8f3c', '#cf6a14'].map(hexToRgb);
  const OK = 0, DEAD = 1, FINISH = 2;

  // ---------- уровень ----------
  // Препятствия: столбы ('p', стоят на земле, на них можно запрыгнуть) и шипы ('s').
  function buildLevel(seed) {
    const rnd = mulberry32(seed);
    const obs = [];
    const P = (x, w, h) => obs.push({ t: 'p', x, w, top: GROUND - h });
    const S = (x, base) => obs.push({ t: 's', x, w: 32, base: base === undefined ? GROUND : base });
    const patterns = [
      { d: 0,    fn: x => { S(x); return 32; } },
      { d: 0,    fn: x => { S(x); S(x + 32); return 64; } },
      { d: 0,    fn: x => { P(x, 96, 32); return 96; } },
      { d: 0.03, fn: x => { P(x, 96, 32); P(x + 160, 96, 64); P(x + 320, 128, 96); return 448; } }, // лесенка
      { d: 0.08, fn: x => { P(x, 128, 40); S(x + 200); return 232; } },
      { d: 0.15, fn: x => { S(x); S(x + 32); S(x + 64); return 96; } },
      { d: 0.3,  fn: x => { P(x, 192, 48); S(x + 80, GROUND - 48); return 192; } },              // шип на столбе
      { d: 0.4,  fn: x => { P(x, 96, 64); S(x + 96); S(x + 128); S(x + 160); P(x + 192, 96, 64); return 288; } }, // яма с шипами
      { d: 0.5,  fn: x => { S(x); P(x + 150, 96, 48); S(x + 300); return 332; } },
    ];
    let x = 620;
    while (x < LEVEL_LEN - 600) {
      const d = x / LEVEL_LEN;
      const avail = patterns.filter(p => p.d <= d);
      const p = avail[Math.floor(rnd() * avail.length)];
      x += p.fn(x) + Math.round(210 + rnd() * (300 - 150 * d));
    }
    obs.sort((a, b) => a.x - b.x);
    return obs;
  }

  function firstIdx(obs, x) { // первый индекс с o.x >= x
    let lo = 0, hi = obs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (obs[m].x < x) lo = m + 1; else hi = m; }
    return lo;
  }

  // ---------- физика (одна и та же для игры и для планировщика) ----------
  // s: { f — номер шага, x, y — низ кубика, vy, g — стоит ли на опоре }
  function physStep(s, jump, obs) {
    if (s.g && jump) { s.vy = -JUMP_V; s.g = false; }
    s.f++;
    s.x = s.f * STEP_X;
    const left = s.x + 1, right = s.x + SIZE - 1;
    const i0 = firstIdx(obs, left - 200);

    // сошли с края столба — начинаем падать
    if (s.g && s.y < GROUND) {
      let support = false;
      for (let i = i0; i < obs.length && obs[i].x <= right; i++) {
        const o = obs[i];
        if (o.t === 'p' && o.x + o.w >= left && o.top === s.y) { support = true; break; }
      }
      if (!support) { s.g = false; s.vy = 0; }
    }

    const prevY = s.y;
    if (!s.g) { s.vy += GRAVITY * DT; s.y += s.vy * DT; }

    // столбы: сверху — приземление, сбоку — смерть
    for (let i = i0; i < obs.length && obs[i].x <= right; i++) {
      const o = obs[i];
      if (o.t !== 'p' || o.x + o.w < left) continue;
      if (s.y > o.top) {
        if (!s.g && s.vy >= 0 && prevY <= o.top + LAND_TOL) { s.y = o.top; s.vy = 0; s.g = true; }
        else return DEAD;
      }
    }
    if (!s.g && s.y >= GROUND) { s.y = GROUND; s.vy = 0; s.g = true; }

    // шипы — хитбокс уже самого треугольника, как принято в жанре
    for (let i = i0; i < obs.length && obs[i].x <= right; i++) {
      const o = obs[i];
      if (o.t !== 's') continue;
      if (s.x + 4 < o.x + 22 && s.x + SIZE - 4 > o.x + 10 && s.y - 4 > o.base - 22 && s.y - SIZE + 4 < o.base) return DEAD;
    }
    return s.x >= LEVEL_LEN ? FINISH : OK;
  }

  // ---------- автопилот ----------
  // Граф состояний «стоим на опоре в шаге f на высоте y» → два действия: идти или прыгнуть.
  // Прямой проход строит граф, обратный — помечает, откуда можно дойти до финиша.
  // Возвращает множество шагов, на которых надо прыгать (или null, если уровень непроходим).
  function makePlan(obs) {
    const FIN = -1, LEAD = 7, LOOK = 90;
    const nodes = new Map();
    const frames = [];
    const add = (f, y) => {
      const k = f * 512 + y;
      if (!nodes.has(k)) { nodes.set(k, { f, y, stay: null, jump: null, gs: false, gj: false, good: false }); (frames[f] || (frames[f] = [])).push(k); }
      return k;
    };
    const run = (f, y, jump) => {
      const s = { f, x: f * STEP_X, y, vy: 0, g: true };
      let r = physStep(s, jump, obs);
      while (r === OK && !s.g) r = physStep(s, false, obs);
      if (r === DEAD) return null;
      if (r === FINISH) return FIN;
      return add(s.f, s.y);
    };
    const startKey = add(0, GROUND);
    const maxF = Math.ceil(LEVEL_LEN / STEP_X) + 2;
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

    // Политика: идём, пока можно; прыгаем за LEAD шагов до последнего момента — так выглядит «по-человечески».
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

  let level = null, plan = null;
  for (let sd = SEED; sd < SEED + 200 && !plan; sd++) {
    const obs = buildLevel(sd);
    const pl = makePlan(obs);
    if (pl) { level = { seed: sd, obs }; plan = pl; }
  }
  if (!plan) { level = { seed: SEED, obs: buildLevel(SEED) }; plan = new Set(); }
  const obs = level.obs;

  // ---------- Telegram ----------
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !RENDER && !!(tg && (tg.initData || (tg.platform && tg.platform !== 'unknown')));
  function tgv(v) { try { return inTelegram && tg.isVersionAtLeast(v); } catch (e) { return false; } }
  function haptic(kind) {
    if (!tgv('6.1')) return;
    try {
      if (kind === 'jump') tg.HapticFeedback.impactOccurred('light');
      else if (kind === 'die') tg.HapticFeedback.notificationOccurred('error');
      else if (kind === 'win') tg.HapticFeedback.notificationOccurred('success');
    } catch (e) { /* старый клиент */ }
  }
  if (inTelegram) {
    try {
      tg.ready();
      tg.expand();
      if (tgv('7.7')) tg.disableVerticalSwipes(); // чтобы свайп по игре не сворачивал окно
    } catch (e) { /* ignore */ }
  }
  function setChrome(c) {
    document.documentElement.style.setProperty('--bg', c);
    if (tgv('6.1')) { try { tg.setHeaderColor(c); tg.setBackgroundColor(c); } catch (e) { /* ignore */ } }
  }

  // ---------- рекорд ----------
  function loadBest() { try { return parseFloat(localStorage.getItem('prygkub.best')) || 0; } catch (e) { return 0; } }
  function saveBest() {
    if (game.runBest > game.best) game.best = game.runBest;
    try { localStorage.setItem('prygkub.best', String(game.best)); } catch (e) { /* приватный режим */ }
  }

  // ---------- состояние игры ----------
  const fx = mulberry32(12345); // свой ГСЧ для частиц — чтобы видео рендерилось одинаково
  const game = {
    mode: 'demo', prevMode: 'demo', p: null, parts: [], trail: 0, shake: 0, deadT: 0,
    attempt: 1, runBest: 0, best: RENDER ? 0 : loadBest(), wins: 0, deaths: 0, overlay: false, sec: -1,
  };
  const input = { hold: false, buffer: 0 };

  function reset(mode) {
    game.mode = mode;
    game.p = { f: 0, x: 0, y: GROUND, vy: 0, g: true, rot: 0 };
    game.parts.length = 0;
    game.trail = 0;
    input.buffer = 0;
  }

  function die() {
    const p = game.p;
    game.prevMode = game.mode; game.mode = 'dead'; game.deadT = 0.75; game.shake = 0.3; game.deaths++;
    for (let i = 0; i < 22; i++) {
      const a = fx() * Math.PI * 2, v = 80 + fx() * 320, life = 0.5 + fx() * 0.4;
      game.parts.push({ x: p.x + 16, y: p.y - 16, vx: Math.cos(a) * v + 60, vy: Math.sin(a) * v - 120, life, max: life, s: 4 + fx() * 7, c: i % 3 ? '#ffd23f' : '#ffffff', g: 1 });
    }
    if (game.prevMode === 'play') { haptic('die'); saveBest(); }
  }

  function win() {
    game.wins++;
    if (game.mode !== 'play') { reset(game.mode); return; } // демо просто крутится по кругу
    game.mode = 'win'; game.runBest = 1; saveBest(); haptic('win');
    const p = game.p;
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (fx() - 0.5) * 2.2, v = 200 + fx() * 400, life = 1 + fx();
      game.parts.push({ x: p.x + 16, y: p.y - 16, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, s: 4 + fx() * 6, c: rgb(PAL[i % PAL.length].map(v => Math.min(255, v + 60))), g: 1 });
    }
    showOverlay('win');
  }

  function tick() {
    for (const q of game.parts) { q.life -= DT; q.vy += 900 * q.g * DT; q.x += q.vx * DT; q.y += q.vy * DT; }
    if (game.parts.length && game.parts[0].life <= 0) game.parts = game.parts.filter(q => q.life > 0);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - DT);

    const p = game.p;
    if (game.mode === 'play' || game.mode === 'demo') {
      const jump = game.mode === 'demo' ? plan.has(p.f) : (input.hold || input.buffer > 0);
      if (input.buffer > 0) input.buffer -= DT;
      const wasG = p.g;
      const r = physStep(p, jump, obs);
      if (wasG && !p.g && p.vy < 0) { input.buffer = 0; if (game.mode === 'play') haptic('jump'); }
      if (!p.g) p.rot += ROT_SPEED * DT;
      else { const q = Math.PI / 2, target = Math.round(p.rot / q) * q; p.rot += (target - p.rot) * Math.min(1, 30 * DT); }
      if (r === DEAD) return die();
      if (r === FINISH) return win();
      if (game.mode === 'play') game.runBest = Math.max(game.runBest, p.x / LEVEL_LEN);
      if (p.g && ++game.trail % 5 === 0) {
        game.parts.push({ x: p.x + 2, y: p.y - 4 - fx() * 6, vx: -60 - fx() * 60, vy: -20 - fx() * 40, life: 0.35, max: 0.35, s: 3 + fx() * 4, c: 'rgba(255,255,255,0.8)', g: 0.2 });
      }
    } else if (game.mode === 'dead') {
      game.deadT -= DT;
      if (game.deadT <= 0) {
        if (game.prevMode === 'play') game.attempt++;
        reset(game.prevMode);
      }
    }
  }

  // ---------- отрисовка ----------
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let scale = 1, viewW = W, viewH = H, offY = 0;

  function resize() {
    if (RENDER) {
      canvas.width = W * RSCALE; canvas.height = H * RSCALE;
      scale = RSCALE; viewW = W; viewH = H; offY = 0;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const s = Math.min(cw / 560, ch / 360); // гарантируем видимую область минимум 560×360
    scale = s * dpr; viewW = cw / s; viewH = ch / s;
    offY = Math.max(0, (viewH - H) * 0.55);
  }

  function sectionColor(x) {
    const k = Math.max(0, x) / SECTION_LEN, i = Math.floor(k), t = k - i;
    const b = clamp((t - 0.93) / 0.07, 0, 1);
    return mix(PAL[i % PAL.length], PAL[(i + 1) % PAL.length], b * b * (3 - 2 * b));
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    const p = game.p;
    const camX = p.x - PLAYER_SX;
    const bg = sectionColor(p.x);
    const ground = mix(bg, [0, 0, 0], 0.5);
    const sec = Math.floor(p.x / SECTION_LEN);
    if (!RENDER && sec !== game.sec) { game.sec = sec; setChrome(rgb(PAL[sec % PAL.length])); }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(bg);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const shake = game.shake > 0 ? (fx() - 0.5) * 10 * (game.shake / 0.3) : 0;
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
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    for (let gx = Math.floor(camX / 64) * 64; gx < camX + viewW + 64; gx += 64) ctx.fillRect(gx, GROUND, 2, bottom - GROUND);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(camX - 20, GROUND - 1, viewW + 40, 2);

    // финиш
    const fxX = LEVEL_LEN + SIZE + 40;
    if (fxX < camX + viewW + 40) {
      for (let i = 0; i < 12; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#151515';
        ctx.fillRect(fxX + j * 10, GROUND - 120 + i * 10, 10, 10);
      }
    }

    // препятствия
    for (let i = firstIdx(obs, camX - 200); i < obs.length && obs[i].x < camX + viewW + 10; i++) {
      const o = obs[i];
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

    // частицы
    for (const q of game.parts) {
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    // кубик
    if (game.mode !== 'dead') {
      ctx.save();
      ctx.translate(p.x + SIZE / 2, p.y - SIZE / 2);
      ctx.rotate(p.rot);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-16, -16, 32, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-12, -12, 24, 5);
      ctx.lineWidth = 3; ctx.strokeStyle = '#151515'; ctx.strokeRect(-14.5, -14.5, 29, 29);
      ctx.fillStyle = '#151515';
      ctx.fillRect(1, -6, 4, 8); ctx.fillRect(8, -6, 4, 8); // глаза смотрят вперёд
      ctx.fillRect(2, 6, 9, 2);
      ctx.restore();
    }

    // HUD — в экранных координатах
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const pct = clamp(p.x / LEVEL_LEN, 0, 1);
    const bw = Math.min(260, viewW * 0.42), bx = (viewW - bw) / 2, by = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(bx, by, bw, 8, 4); ctx.fill();
    if (pct > 0.004) { ctx.fillStyle = '#5cff6a'; roundRect(bx, by, Math.max(8, bw * pct), 8, 4); ctx.fill(); }

    if (!RENDER && (game.mode === 'play' || (game.mode === 'dead' && game.prevMode === 'play'))) {
      ctx.font = '700 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'left'; ctx.fillText(Math.floor(pct * 100) + '%', bx + bw + 10, by + 4);
      ctx.textAlign = 'left'; ctx.fillText('Попытка ' + game.attempt, 14, by + 4);
      if (game.best > 0) { ctx.textAlign = 'right'; ctx.fillText('Рекорд ' + Math.floor(game.best * 100) + '%', viewW - 14, by + 4); }
    }

    // подпись-плашка снизу (только в превью-видео)
    if (RENDER && BRAND) {
      const bh = 34, y0 = H - bh;
      ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fillRect(0, y0, W, bh);
      ctx.fillStyle = '#ffd23f'; roundRect(12, y0 + 8, 18, 18, 4); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#151515'; ctx.stroke();
      ctx.fillStyle = '#151515'; ctx.fillRect(21, y0 + 13, 2, 4); ctx.fillRect(25, y0 + 13, 2, 4);
      ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const parts = BRAND.split(' — ');
      ctx.fillStyle = '#ffffff';
      ctx.fillText(parts[0], 40, y0 + bh / 2 + 1);
      if (parts.length > 1) {
        const w0 = ctx.measureText(parts[0]).width;
        ctx.font = '400 13px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText(' — ' + parts.slice(1).join(' — '), 40 + w0, y0 + bh / 2 + 1);
      }
    }
  }

  // ---------- экран «Играть» / «Пройдено» ----------
  const ov = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovText = document.getElementById('ov-text');
  const ovBtn = document.getElementById('ov-btn');

  function showOverlay(kind) {
    if (kind === 'win') {
      ovTitle.textContent = 'Пройдено!';
      ovText.textContent = 'Попыток: ' + game.attempt + '. Позови друга — пусть пройдёт быстрее.';
      ovBtn.textContent = 'Ещё раз';
    } else {
      ovTitle.textContent = 'Прыг-Куб';
      ovText.textContent = 'Доведи кубик до финиша. Тап или пробел — прыжок, держи — прыгай подряд.' +
        (game.best > 0 ? ' Рекорд: ' + Math.floor(game.best * 100) + '%.' : '');
      ovBtn.textContent = 'Играть';
    }
    ov.classList.remove('hidden');
    game.overlay = true;
  }
  function hideOverlay() { ov.classList.add('hidden'); game.overlay = false; }
  function startPlay() { hideOverlay(); game.attempt = 1; game.runBest = 0; reset('play'); }

  // ---------- управление ----------
  const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW', 'Enter'];
  function press() { if (game.overlay) return; input.hold = true; input.buffer = 0.12; }
  function release() { input.hold = false; }

  // ---------- запуск ----------
  reset('demo');
  resize();

  if (RENDER) {
    ov.classList.add('hidden');
  } else {
    showOverlay('start'); // за меню крутится демо-проход автопилота
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    window.addEventListener('keydown', e => {
      if (!JUMP_KEYS.includes(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (game.overlay) startPlay(); else press();
    });
    window.addEventListener('keyup', e => { if (JUMP_KEYS.includes(e.code)) release(); });
    ovBtn.addEventListener('click', e => { e.stopPropagation(); startPlay(); });
    document.addEventListener('contextmenu', e => e.preventDefault());

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

  // API для скриптов рендера и проверки
  window.__game = {
    advance(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) tick(); draw(); },
    frame() { return canvas.toDataURL('image/png').split(',')[1]; },
    stats() {
      return { seed: level.seed, obstacles: obs.length, jumps: plan.size, mode: game.mode, x: game.p.x, wins: game.wins, deaths: game.deaths };
    },
  };
})();
