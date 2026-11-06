/*
 * Генератор трасс — общий для игры (window.LEVELGEN) и сервера (require).
 * Сервер по нему знает, сколько монеток лежит на уровне, и не даст начислить больше.
 *
 * Препятствия: столбы ('p', стоят на земле, на них можно запрыгнуть) и шипы ('s').
 * Монеты редкие: кандидаты — над препятствиями и посреди промежутков, из них на уровень
 * равномерно выбирается CATALOG.LEVELS[i].coins штук (1 монета на трассе = 1 монета в кошельке).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.LEVELGEN = factory(root.CATALOG);
})(typeof self !== 'undefined' ? self : this, function (CATALOG) {
  'use strict';

  const GROUND = 320;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Паттерны препятствий: d — с какой сложности (0…1) паттерн может появиться.
  // fn(x, P, S, C) рисует паттерн с позиции x и возвращает его ширину.
  // P(x, w, h) — столб, S(x, base) — шип, C(x, y) — монетка.
  const PATTERNS = [
    { d: 0, fn: (x, P, S, C) => { S(x); C(x + 16, GROUND - 78); return 32; } },
    { d: 0, fn: (x, P, S, C) => { S(x); S(x + 32); C(x + 32, GROUND - 84); return 64; } },
    { d: 0, fn: (x, P, S, C) => { P(x, 96, 32); C(x + 48, GROUND - 50); return 96; } },
    { d: 0.03, fn: (x, P, S, C) => { P(x, 96, 32); P(x + 160, 96, 64); P(x + 320, 128, 96); C(x + 208, GROUND - 82); C(x + 384, GROUND - 114); return 448; } }, // лесенка
    { d: 0.08, fn: (x, P, S, C) => { P(x, 128, 40); S(x + 200); return 232; } },
    { d: 0.15, fn: (x, P, S, C) => { S(x); S(x + 32); S(x + 64); C(x + 48, GROUND - 90); return 96; } },
    { d: 0.3, fn: (x, P, S) => { P(x, 192, 48); S(x + 80, GROUND - 48); return 192; } }, // шип на столбе
    { d: 0.4, fn: (x, P, S, C) => { P(x, 96, 64); S(x + 96); S(x + 128); S(x + 160); P(x + 192, 96, 64); C(x + 144, GROUND - 130); return 288; } }, // яма с шипами
    { d: 0.5, fn: (x, P, S) => { S(x); P(x + 150, 96, 48); S(x + 300); return 332; } },
    { d: 0.65, fn: (x, P, S, C) => { P(x, 64, 40); S(x + 64); S(x + 96); P(x + 128, 64, 72); S(x + 192); S(x + 224); P(x + 256, 96, 40); C(x + 160, GROUND - 140); return 352; } }, // качели
  ];

  // Строит уровень i из CATALOG.LEVELS (seed можно переопределить для подбора).
  function build(i, seed) {
    const L = CATALOG.LEVELS[i];
    const rnd = mulberry32(seed === undefined ? L.seed : seed);
    const obs = [], pickups = [];
    const P = (x, w, h) => obs.push({ t: 'p', x, w, top: GROUND - h });
    const S = (x, base) => obs.push({ t: 's', x, w: 32, base: base === undefined ? GROUND : base });
    const C = (x, y) => pickups.push({ x, y });
    let x = 620;
    while (x < L.len - 600) {
      const d = L.d[0] + (L.d[1] - L.d[0]) * (x / L.len);
      const avail = PATTERNS.filter(p => p.d <= d);
      // чем сложнее участок, тем чаще берём из «свежих» паттернов
      const from = rnd() < 0.5 ? Math.floor(avail.length / 2) : 0;
      const w = avail[from + Math.floor(rnd() * (avail.length - from))].fn(x, P, S, C);
      const gap = Math.round(L.gap[0] + rnd() * (L.gap[1] - L.gap[0]));
      C(x + w + gap / 2, GROUND - 18); // кандидат посреди промежутка
      x += w + gap;
    }
    obs.sort((a, b) => a.x - b.x);
    pickups.sort((a, b) => a.x - b.x);
    // равномерно оставляем столько монет, сколько задано для уровня
    const n = Math.min(L.coins || pickups.length, pickups.length);
    const chosen = [];
    for (let k = 0; k < n; k++) chosen.push(pickups[Math.floor((k + 0.5) * pickups.length / n)]);
    return { index: i, name: L.name, len: L.len, speed: L.speed, palette: L.palette, obs, pickups: chosen };
  }

  return { GROUND, PATTERNS, build, mulberry32 };
});
