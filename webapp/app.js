/*
 * Меню, гараж, уровни и магазин «Звезды провинции».
 *
 * Прогресс хранится на сервере бота (bot/index.js), если игра открыта в Telegram и сервер отвечает:
 * тогда покупки и награды считает сервер, а монеты за звёзды начисляются после оплаты.
 * Без сервера (обычный браузер, Vercel) прогресс живёт в localStorage, а магазин звёзд выключен.
 */
(function () {
  'use strict';
  const C = self.CATALOG, Game = self.Game;
  const tg = Game.tg; // null вне Telegram
  const initData = tg ? tg.initData : '';
  const $ = s => document.querySelector(s);
  const fmt = n => Math.round(n).toLocaleString('ru-RU');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const COIN = '<i class="coin"></i>';
  const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
  const coins = n => fmt(n) + ' ' + plural(Math.round(n), 'монета', 'монеты', 'монет');
  const tgv = v => { try { return !!tg && tg.isVersionAtLeast(v); } catch (e) { return false; } };

  // ---------- профиль ----------
  const LS_KEY = 'zvezda.profile.v1';
  function loadLocal() { try { return C.normalize(JSON.parse(localStorage.getItem(LS_KEY))); } catch (e) { return C.newProfile(); } }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(profile)); } catch (e) { /* приватный режим */ } }
  let profile = loadLocal();
  let online = false; // true — прогресс и покупки ведёт сервер

  async function api(path, body) {
    let res, data = null;
    try {
      res = await fetch('/api/' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'tma ' + initData },
        body: JSON.stringify(body || {}),
      });
      data = await res.json();
    } catch (e) { /* сеть или не JSON */ }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Сервер не отвечает');
    if (data.profile) profile = C.normalize(data.profile);
    return data;
  }

  // Действие над профилем: на сервере или здесь же по тем же правилам каталога
  async function act(serverCall, localCall) {
    try {
      if (online) await serverCall();
      else { localCall(profile); saveLocal(); }
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    } finally {
      renderAll();
    }
  }

  // ---------- экраны ----------
  const TITLES = { menu: '', levels: 'Уровни', garage: 'Гараж', shop: 'Монеты', result: '' };
  let screen = 'menu';
  let garageCar = null;

  function show(name) {
    screen = name;
    for (const k of Object.keys(TITLES)) $('#scr-' + k).classList.toggle('on', k === name);
    if (name === 'menu') $('#title').innerHTML = '<img class="logo" src="logo.svg" alt="Звезда Провинции">';
    else $('#title').textContent = TITLES[name];
    $('#back').style.display = name === 'menu' ? 'none' : '';
    $('#ui').classList.remove('hidden');
    $('#exit').classList.add('hidden');
    backButton(name !== 'menu');
    renderAll();
  }

  function backButton(on) {
    if (!tgv('6.1')) return;
    try { if (on) tg.BackButton.show(); else tg.BackButton.hide(); } catch (e) { /* ignore */ }
  }

  function toMenu() { Game.demo(0, profile.car); show('menu'); }

  function goBack() {
    if (screen === 'play') { exitPlay(); return; }
    if (screen === 'result') { toMenu(); return; }
    show('menu');
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function drawThumb(canvas, id, scale) {
    const dpr = Math.min(self.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth || 96, h = canvas.clientHeight || 48;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d');
    const s = Math.min(w / 96, (h - 3) / 46) * (scale || 1);
    c.setTransform(s * dpr, 0, 0, s * dpr, (w / 2) * dpr, (h - 3) * dpr);
    self.drawCar(c, id, 0, 0, 0, 0.4, 0, 0);
  }

  // ---------- отрисовка экранов ----------
  function renderAll() {
    $('#coin-count').textContent = fmt(profile.coins);
    if (screen === 'menu') renderMenu();
    else if (screen === 'levels') renderLevels();
    else if (screen === 'garage') renderGarage();
    else if (screen === 'shop') renderShop();
  }

  function renderMenu() {
    const c = C.car(profile.car);
    $('#menu-car').textContent = `За рулём: ${c.name} · ${c.body}, ${c.year}`;
    drawThumb($('#hero'), profile.car, 0.95);
    $('#mode-note').textContent = online ? ''
      : tg ? 'Нет связи с сервером: прогресс сохраняется только на этом устройстве, покупки за звёзды недоступны.'
        : 'Вне Telegram прогресс хранится в этом браузере, а покупки за звёзды недоступны.';
  }

  function renderLevels() {
    $('#levels').innerHTML = C.LEVELS.map((L, i) => {
      const st = profile.levels[i], open = C.levelUnlocked(profile, i);
      const tag = !open ? '<span class="tag ghost">Закрыт</span>' : st.done ? '<span class="tag">Пройден</span>' : '';
      const status = !open ? 'Сначала пройдите уровень ' + i
        : st.done ? 'За повтор +' + coins(Math.max(1, Math.round(L.reward * C.REPEAT_REWARD))) + ' · на трассе ' + L.coins
          : (st.best > 0 ? 'Лучший результат ' + Math.floor(st.best * 100) + '% · ' : '') + 'за прохождение +' + coins(L.reward) + ' · на трассе ' + L.coins;
      return `<button class="card level${open ? '' : ' locked'}${st.done ? ' done' : ''}" data-level="${i}">
        <span class="num">${i + 1}</span>
        <span class="info">${tag}<b>${L.name}</b><small>${status}</small></span>
        <span class="meta">~${Math.round(L.len / L.speed)} с</span>
      </button>`;
    }).join('');
  }

  function statLine(id) { // как строка характеристик в карточке детали на сайте: «W201 · В хорошем состоянии»
    const c = C.car(id), st = profile.cars[id] ? C.carStats(profile, id) : { jumpMul: c.jump, armor: c.armor, coinMul: 1 + c.coin };
    const out = [];
    out.push('прыжок ' + (st.jumpMul > 1.001 ? '+' + Math.round((st.jumpMul - 1) * 100) + '%' : 'базовый'));
    out.push('броня ' + st.armor);
    out.push('монеты ' + (st.coinMul > 1.001 ? '+' + Math.round((st.coinMul - 1) * 100) + '%' : '×1'));
    return out.join(' · ');
  }

  function renderGarage() {
    if (!garageCar || !C.car(garageCar)) garageCar = profile.car;
    $('#cars').innerHTML = C.CARS.map(c => {
      const owned = !!profile.cars[c.id], inUse = profile.car === c.id;
      const btn = !owned ? `<button class="btn small buy" data-buy="${c.id}">${COIN}${fmt(c.price)}</button>`
        : inUse ? '' : `<button class="btn small" data-select="${c.id}">Выбрать</button>`;
      const tag = inUse ? '<span class="tag">В деле</span>' : owned ? '<span class="tag ghost">В гараже</span>' : '';
      return `<div class="card car${c.id === garageCar ? ' active' : ''}" data-view="${c.id}">
        <canvas class="thumb" data-draw="${c.id}"></canvas>
        <div class="info">${tag}<b>${c.name}</b><small>${c.body}, ${c.year}<br>${statLine(c.id)}</small></div>
        ${btn}
      </div>`;
    }).join('');
    document.querySelectorAll('#cars canvas[data-draw]').forEach(cv => drawThumb(cv, cv.dataset.draw));

    const c = C.car(garageCar), owned = !!profile.cars[garageCar];
    $('#upg-title').textContent = 'Улучшения: ' + c.name;
    $('#upgrades').innerHTML = !owned
      ? '<p class="note">Купите эту машину, чтобы улучшать её.</p>'
      : C.UPGRADES.map(u => {
        const lvl = profile.cars[garageCar][u.id], price = C.upgradePrice(profile, garageCar, u.id);
        const pips = '●'.repeat(lvl) + '○'.repeat(u.prices.length - lvl);
        return `<div class="card upg">
          <div class="info"><b>${u.name}</b><small>${u.desc}</small><span class="pips">${pips}</span></div>
          ${price === null ? '<button class="btn small" disabled>Максимум</button>'
            : `<button class="btn small buy" data-upg="${u.id}">${COIN}${fmt(price)}</button>`}
        </div>`;
      }).join('');
  }

  function canPay() { return online && tgv('6.1') && typeof tg.openInvoice === 'function'; }

  function renderShop() {
    $('#packs').innerHTML = C.PACKS.map(p => `<div class="card pack">
      <span class="big">${COIN}${fmt(p.coins)}</span>
      <span class="info"><b>${p.title}</b><small>≈\u00a0${fmt(Math.round(p.stars * C.STAR_RUB / 10) * 10)}\u00a0₽</small></span>
      <button class="btn small buy" data-pack="${p.id}"${canPay() ? '' : ' disabled'}>${fmt(p.stars)} ⭐</button>
    </div>`).join('');
    $('#shop-note').textContent = canPay()
      ? 'Монеты придут сразу после оплаты. Вопросы по покупкам — команда /paysupport в чате с ботом.'
      : 'Покупка за звёзды работает, когда игра открыта в Telegram и сервер бота на связи.';
  }

  // ---------- заезд ----------
  let current = null;

  function startLevel(li) {
    if (!C.levelUnlocked(profile, li)) { toast(new C.GameError('locked').message); return; }
    const car = profile.car;
    current = { li, car, run: null };
    screen = 'play';
    $('#ui').classList.add('hidden');
    $('#exit').classList.remove('hidden');
    backButton(true);
    Game.play(li, car, C.carStats(profile, car), {
      onAttemptStart() {
        current.run = online ? api('run/start', { level: li, car }).then(d => d.runId).catch(() => null) : Promise.resolve(null);
      },
      onAttemptEnd(r) { settle(li, car, current.run, r); },
    });
  }

  // Засчитать попытку: монеты с трассы (и награду, если уровень пройден)
  async function settle(li, car, runP, r) {
    let reward = null;
    try {
      if (online) {
        const runId = await runP;
        if (runId) reward = (await api('run/finish', { runId, pickups: r.pickups, finished: r.finished, progress: r.progress })).reward;
      } else {
        reward = C.applyRun(profile, { level: li, car, pickups: r.pickups, finished: r.finished, progress: r.progress });
        saveLocal();
      }
    } catch (e) {
      toast('Заезд не сохранился: ' + e.message);
    }
    $('#coin-count').textContent = fmt(profile.coins);
    if (r.finished) showResult(li, reward);
  }

  function exitPlay() {
    const s = Game.stats();
    if (current && s.mode === 'play' && s.pickups > 0) { // монеты, собранные до выхода, не пропадают
      settle(current.li, current.car, current.run, { finished: false, pickups: s.pickups, progress: s.x / C.LEVELS[current.li].len });
    }
    current = null;
    Game.demo(0, profile.car);
    show('levels');
  }

  function showResult(li, reward) {
    const last = li === C.LEVELS.length - 1;
    $('#res-eyebrow').textContent = `Уровень ${li + 1} · ${C.LEVELS[li].name}`;
    $('#res-title').innerHTML = last ? 'Ты — звезда<br><span class="metal">провинции.</span>' : 'Доехал.<br><span class="metal">Целым.</span>';
    $('#res-text').innerHTML = reward
      ? `+${coins(reward.total)}: ${fmt(reward.coins)} с трассы` +
        (reward.bonus ? ` и ${fmt(reward.bonus)} за ${reward.first ? 'первое прохождение' : 'повтор'}.` : '.')
      : 'Заезд не сохранился — проверьте связь.';
    $('#res-actions').innerHTML =
      (!last ? `<button class="btn primary" data-level="${li + 1}">Следующий уровень</button>` : '') +
      `<button class="btn${last ? ' primary' : ''}" data-level="${li}">Ещё раз</button>` +
      '<button class="btn" data-go="garage">Гараж</button>' +
      '<button class="btn" data-go="menu">В меню</button>';
    show('result');
  }

  // ---------- оплата звёздами ----------
  async function buyPack(id) {
    if (!canPay()) { toast('Покупка за звёзды работает в Telegram'); return; }
    let url;
    try { url = (await api('invoice', { pack: id })).url; } catch (e) { toast(e.message); return; }
    const before = profile.coins;
    tg.openInvoice(url, async status => {
      if (status === 'paid') {
        toast('Оплата прошла, начисляем монеты…');
        for (let i = 0; i < 10 && profile.coins <= before; i++) { // бот начисляет монеты, получив подтверждение от Telegram
          await sleep(1000);
          try { await api('me'); } catch (e) { /* ещё раз */ }
        }
        renderAll();
        if (profile.coins > before) { toast('Монеты начислены!'); Game.haptic('win'); }
        else toast('Монеты скоро появятся — бот пришлёт сообщение в чат');
      } else if (status === 'failed') {
        toast('Оплата не прошла');
      }
    });
  }

  // ---------- события ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('button, .card[data-view], a[data-link]');
    if (!t) return;
    if (t.dataset.link) { // внешние ссылки — через Telegram, чтобы не уводить игру со страницы
      e.preventDefault();
      if (tgv('6.1')) tg.openLink(t.dataset.link); else self.open(t.dataset.link, '_blank', 'noopener');
      return;
    }
    const d = t.dataset;
    if (t.id === 'back') goBack();
    else if (t.id === 'exit') exitPlay();
    else if (t.id === 'coins') show('shop');
    else if (d.go) { if (d.go === 'menu') toMenu(); else show(d.go); }
    else if (d.level !== undefined) startLevel(+d.level);
    else if (d.buy) act(() => api('buy', { type: 'car', car: d.buy }), p => C.buyCar(p, d.buy)).then(ok => { if (ok) { garageCar = d.buy; Game.demo(0, profile.car); toast(C.car(d.buy).name + ' теперь в гараже'); } });
    else if (d.select) act(() => api('buy', { type: 'select', car: d.select }), p => C.selectCar(p, d.select)).then(ok => { if (ok) { garageCar = d.select; Game.demo(0, profile.car); } });
    else if (d.upg) act(() => api('buy', { type: 'upgrade', car: garageCar, upgrade: d.upg }), p => C.buyUpgrade(p, garageCar, d.upg));
    else if (d.pack) buyPack(d.pack);
    else if (d.view) { garageCar = d.view; renderGarage(); }
  });
  if (tgv('6.1')) { try { tg.BackButton.onClick(goBack); } catch (e) { /* ignore */ } }
  self.addEventListener('resize', () => { if (screen === 'menu') renderMenu(); });

  // ---------- старт ----------
  (async function init() {
    if (initData) {
      try { await api('me'); online = true; } catch (e) { online = false; }
    }
    Game.demo(0, profile.car);
    show('menu');
  })();

  self.App = { get profile() { return profile; }, get online() { return online; } }; // для проверок
})();
