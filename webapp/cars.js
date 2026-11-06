/*
 * Внешний вид машин (window.CAR_LOOKS, window.drawCar). Всё рисуется кодом, без картинок.
 * Координаты: x — от кормы (−) к носу (+), y — вверх отрицательный, 0 — земля под колёсами.
 * Силуэты — в духе угловатых немецких машин 90-х и нулевых, без эмблем и названий марок.
 */
(function () {
  'use strict';
  const LINE = '#151515', GLASS = '#2b3a55', CHROME = '#d9dfe6', TRIM = '#7d838b', TAIL = '#e0303a', HEAD = '#fff3b0';

  const LOOKS = {
    // Седан-«утюг» начала 90-х
    eshka: {
      color: '#efe4c3', wr: 7, wheels: [-24, 25], arch: 9,
      body: [[-39, -6.5], [-39, -17], [-37.5, -19.5], [-22, -20.5], [-15.5, -30], [9, -30], [19, -21], [37, -19.5], [39, -17.5], [39, -6.5]],
      glass: [[-20.5, -21.5], [-14.8, -28.6], [8.4, -28.6], [16.6, -21.5]],
      pillars: [[-2.6, -28.8, 2.2, 7.6]], trim: [-38, 38, -11, -6.5],
      doors: [-21, -1.5, 18], doorTop: -20, handles: [[-14, -18], [6, -18]], mirror: [15, -23.8],
      head: { type: 'rect', x: 35.8, y: -17.6, w: 3, h: 4.2 }, tail: [-39, -18.6, 2.6, 6.5],
      bumpers: [[35, -11.5, 7.5, 5], [-42.5, -11.5, 7.5, 5]],
    },
    // Большой представительский седан середины 90-х: длиннее, выше, широкие накладки
    kaban: {
      color: '#2a2e35', wr: 7.6, wheels: [-26, 27], arch: 9.6,
      body: [[-42, -6.5], [-42, -18.5], [-40.5, -21.5], [-24, -22.5], [-16.5, -33], [9, -33], [20.5, -23], [39.5, -21.5], [42, -19], [42, -6.5]],
      glass: [[-22, -23.5], [-15.8, -31.6], [8.2, -31.6], [18, -23.5]],
      pillars: [[-3, -31.8, 2.6, 8.5]], trim: [-41, 41, -13.5, -6.5],
      doors: [-23, -2, 20], doorTop: -22, handles: [[-15, -19.5], [6, -19.5]], mirror: [17, -26.5],
      head: { type: 'rect', x: 38.8, y: -19.5, w: 3, h: 4.6 }, tail: [-42, -20.5, 2.6, 7],
      bumpers: [[38, -12.5, 7.5, 5.5], [-45.5, -12.5, 7.5, 5.5]], shine: true,
    },
    // Седан конца 90-х: скруглённая крыша и сдвоенные круглые фары
    glazastyi: {
      color: '#c3c9d1', wr: 7.2, wheels: [-25, 25], arch: 9.2,
      body: [[-39, -6.5], [-39.5, -16], [-37, -19.5], [-24, -21], [-16, -29.5], [-10, -31], [6, -31], [11, -29.5], [20, -22], [36, -20], [39.5, -16.5], [39.5, -6.5]],
      glass: [[-21.5, -22], [-15, -29.2], [-9.6, -29.8], [5.8, -29.8], [10.4, -28.4], [17.6, -22]],
      pillars: [[-2.5, -30, 2.2, 8]], trim: [-38, 38, -10.5, -6.5],
      doors: [-22, -1.5, 19], doorTop: -20.5, handles: [[-14, -18], [6, -18]], mirror: [16, -24.5],
      head: { type: 'twin', x: 34.6, y: -16.6, r: 1.9, dx: 3.3 }, tail: [-39.5, -18, 2.6, 6],
      bumpers: [[36, -11, 6.5, 4.5], [-42.5, -11, 6.5, 4.5]], bumperColor: TRIM,
    },
    // Двухместный кабриолет середины 90-х со сложенной крышей
    roadster: {
      color: '#c62a2f', wr: 7, wheels: [-23, 24], arch: 9,
      body: [[-38, -6.5], [-38, -16], [-36, -18.5], [-14, -19], [-10, -19.5], [4, -19.5], [10, -20], [36, -18], [39, -15.5], [39, -6.5]],
      seats: [[-12.5, -25, 5, 6.5], [-4.5, -25, 5, 6.5]],
      windshield: [[3.5, -27.5], [5.2, -27.5], [11, -20], [8.6, -20]],
      trim: [-37, 37, -10, -6.5],
      doors: [-14, 13], doorTop: -18.5, handles: [[-9, -16.5]], mirror: [10.5, -21.5],
      head: { type: 'rect', x: 36.5, y: -16.5, w: 2.6, h: 3.6 }, tail: [-38, -16.5, 2.4, 5],
      bumpers: [[35, -10.5, 6.5, 4], [-41.5, -10.5, 6.5, 4]],
    },
    // Рамный внедорожник: высокий ящик, круглые фары, запаска на задней двери
    gelik: {
      color: '#4b5a3a', wr: 8.5, wheels: [-22, 23], arch: 10.5, archY: -9,
      body: [[-35, -10], [-35, -37], [-33.5, -38.5], [13.5, -38.5], [15.5, -37], [17, -25.5], [34, -24.5], [35.5, -23], [35.5, -10]],
      glass: [[-31, -36], [13.3, -36], [14.6, -26.5], [-31, -26.5]],
      pillars: [[-16, -36.2, 2.4, 10], [-2, -36.2, 2.4, 10]], trim: [-34, 35, -14.5, -10], trimColor: '#2b2b2b',
      doors: [-16.2, -0.8, 15.2], doorTop: -26, handles: [[-12, -23.5], [3, -23.5]], mirror: [15.5, -29],
      head: { type: 'round', x: 33.2, y: -20.5, r: 2.4 }, tail: [-35, -23, 2.4, 6],
      bumpers: [[32, -14, 6.5, 4.5], [-38.5, -14, 6.5, 4.5]], bumperColor: '#2b2b2b',
      spare: [-39.5, -32, 4.5, 15], rails: [-30, -40.6, 41, 1.6], shine: true,
    },
    // Длинный седан середины нулевых: плавная крыша, вытянутые фары
    dlinnyi: {
      color: '#5d6b7d', wr: 7.6, wheels: [-28, 28.5], arch: 9.6,
      body: [[-43, -6.5], [-43.5, -15.5], [-41, -19.5], [-26, -21.5], [-19, -28.5], [-11, -31], [8, -31], [14, -29], [23, -22], [40, -19.5], [43.5, -15], [43.5, -6.5]],
      glass: [[-24, -22.5], [-18.2, -28], [-10.6, -29.8], [7.6, -29.8], [12.8, -28.2], [20.6, -22.5]],
      pillars: [[-3, -30, 2.2, 7.8]], trim: [-41, 41, -11.6, -10.4], trimColor: CHROME,
      doors: [-24, -2.5, 21], doorTop: -21.5, handles: [[-16, -18], [6, -18]], mirror: [20, -24.5],
      head: { type: 'oval', x: 39.6, y: -17, rx: 3.2, ry: 1.9 }, tail: [-43.5, -17.5, 2.4, 5],
      bumpers: [], shine: true,
    },
  };

  function poly(c, pts) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  }
  function bbox(pts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, x1, y0, y1 };
  }
  function glare(c, pts) { // блик на стекле
    const b = bbox(pts), gx = b.x0 + (b.x1 - b.x0) * 0.35;
    c.save(); poly(c, pts); c.clip();
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath(); c.moveTo(gx, b.y0); c.lineTo(gx + 4, b.y0); c.lineTo(gx - 2, b.y1); c.lineTo(gx - 6, b.y1); c.closePath(); c.fill();
    c.restore();
  }

  // id — машина, cx — центр, by — низ колёс; tilt — наклон, wheel — угол колёс,
  // sag — просадка кузова, lift — насколько «вывешены» колёса в прыжке.
  function drawCar(c, id, cx, by, tilt, wheel, sag, lift) {
    const L = LOOKS[id] || LOOKS.eshka;
    c.save();
    c.translate(cx, by - 14); c.rotate(tilt || 0); c.translate(0, 14 + (sag || 0));
    c.lineJoin = 'round';

    if (L.seats) { c.fillStyle = '#3a2a22'; for (const s of L.seats) c.fillRect(s[0], s[1], s[2], s[3]); }

    poly(c, L.body); c.fillStyle = L.color; c.fill();
    if (L.trim) { const t = L.trim; c.fillStyle = L.trimColor || TRIM; c.fillRect(t[0], t[2], t[1] - t[0], t[3] - t[2]); }
    if (L.shine) { // светлая линия по поясу — чтобы тёмный кузов читался на фоне
      const b = bbox(L.body);
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(b.x0 + 2, (L.doorTop || -20) + 2.5, b.x1 - b.x0 - 4, 1.2);
    }
    if (L.glass) {
      poly(c, L.glass); c.fillStyle = GLASS; c.fill();
      c.lineWidth = 1; c.strokeStyle = CHROME; c.stroke();
      glare(c, L.glass);
    }
    if (L.windshield) { poly(c, L.windshield); c.fillStyle = 'rgba(160,190,230,0.55)'; c.fill(); c.lineWidth = 1; c.strokeStyle = CHROME; c.stroke(); }
    if (L.pillars) { c.fillStyle = LINE; for (const p of L.pillars) c.fillRect(p[0], p[1], p[2], p[3]); }
    if (L.rails) { c.fillStyle = '#2b2b2b'; const r = L.rails; c.fillRect(r[0], r[1], r[2], r[3]); }

    poly(c, L.body); c.lineWidth = 2; c.strokeStyle = LINE; c.stroke();

    // двери, ручки, зеркало
    c.strokeStyle = 'rgba(21,21,21,0.5)'; c.lineWidth = 1;
    c.beginPath();
    for (const dx of L.doors || []) { c.moveTo(dx, L.doorTop); c.lineTo(dx, (L.trim ? L.trim[2] : -7.5)); }
    c.stroke();
    c.fillStyle = LINE;
    for (const h of L.handles || []) c.fillRect(h[0], h[1], 4, 1.5);
    if (L.mirror) c.fillRect(L.mirror[0], L.mirror[1], 3.5, 2.6);

    // фары и фонари
    const hd = L.head;
    c.fillStyle = HEAD;
    if (hd.type === 'rect') c.fillRect(hd.x, hd.y, hd.w, hd.h);
    else if (hd.type === 'round') { c.beginPath(); c.arc(hd.x, hd.y, hd.r, 0, Math.PI * 2); c.fill(); c.lineWidth = 1; c.strokeStyle = CHROME; c.stroke(); }
    else if (hd.type === 'twin') { for (const dx of [0, hd.dx]) { c.beginPath(); c.arc(hd.x + dx, hd.y + dx * 0.1, hd.r, 0, Math.PI * 2); c.fill(); } }
    else if (hd.type === 'oval') { c.beginPath(); c.ellipse(hd.x, hd.y, hd.rx, hd.ry, -0.2, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = TAIL; c.fillRect(L.tail[0], L.tail[1], L.tail[2], L.tail[3]);

    // бамперы
    c.fillStyle = L.bumperColor || CHROME; c.strokeStyle = LINE; c.lineWidth = 1.4;
    for (const b of L.bumpers) { c.fillRect(b[0], b[1], b[2], b[3]); c.strokeRect(b[0], b[1], b[2], b[3]); }

    // запаска на задней двери
    if (L.spare) {
      const s = L.spare; c.fillStyle = '#1b1b1f';
      c.beginPath(); c.moveTo(s[0] + 1.5, s[1]); c.lineTo(s[0] + s[2], s[1]); c.lineTo(s[0] + s[2], s[1] + s[3]); c.lineTo(s[0] + 1.5, s[1] + s[3]); c.quadraticCurveTo(s[0] - 0.5, s[1] + s[3] / 2, s[0] + 1.5, s[1]); c.fill();
      c.fillStyle = CHROME; c.fillRect(s[0] + s[2] - 1.6, s[1] + 3, 1.2, s[3] - 6);
    }

    // арки и колёса (колёса не проседают вместе с кузовом)
    const archY = L.archY !== undefined ? L.archY : -L.wr + 0.5;
    for (const wx of L.wheels) {
      c.fillStyle = LINE;
      c.beginPath(); c.arc(wx, archY, L.arch, Math.PI, 0); c.fill();
      const wy = -L.wr - (sag || 0) + (lift || 0);
      c.fillStyle = '#1b1b1f';
      c.beginPath(); c.arc(wx, wy, L.wr, 0, Math.PI * 2); c.fill();
      c.fillStyle = CHROME;
      c.beginPath(); c.arc(wx, wy, L.wr * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#6b7178'; // отверстия колпака — по ним видно, что колесо крутится
      for (let k = 0; k < 6; k++) {
        const a = (wheel || 0) + k * Math.PI / 3;
        c.beginPath(); c.arc(wx + Math.cos(a) * L.wr * 0.38, wy + Math.sin(a) * L.wr * 0.38, L.wr * 0.13, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  self.CAR_LOOKS = LOOKS;
  self.drawCar = drawCar;
})();
