/*
 * Каталог «Звезды провинции» — общий для игры (window.CATALOG) и сервера (require).
 * Здесь все цены, машины, улучшения, уровни и пакеты монет за звёзды. Сервер считает покупки
 * и награды по этим же правилам, поэтому подделать цену или монеты из браузера нельзя.
 *
 * Хотите поменять баланс — меняйте числа здесь, больше нигде.
 *
 * Курс: 1 монета = 1 звезда Telegram. Пачки монет продаются 1:1, а цены машин и улучшений
 * указаны в монетах — то есть фактически в звёздах. Игра даёт монеты скупо: редкие монеты
 * на трассе (1 штука = 1 монета) и небольшая награда за первое прохождение уровня.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CATALOG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Машины 1990–2010-х. Названия — народные прозвища, без марок и эмблем.
  // jump — множитель прыжка, armor — сколько ударов машина переживёт за попытку, coin — бонус к монетам.
  const CARS = [
    { id: 'eshka', name: 'Ешка', body: 'седан', year: 1993, price: 0, jump: 1, armor: 0, coin: 0 },
    { id: 'kaban', name: 'Кабан', body: 'седан', year: 1995, price: 60, jump: 1, armor: 1, coin: 0.1 },
    { id: 'glazastyi', name: 'Глазастый', body: 'седан', year: 1999, price: 120, jump: 1.04, armor: 1, coin: 0.15 },
    { id: 'roadster', name: 'Родстер', body: 'кабриолет', year: 1996, price: 200, jump: 1.1, armor: 0, coin: 0.3 },
    { id: 'gelik', name: 'Гелик', body: 'внедорожник', year: 2002, price: 350, jump: 1.04, armor: 2, coin: 0.25 },
    { id: 'dlinnyi', name: 'Длинный', body: 'седан', year: 2005, price: 600, jump: 1.06, armor: 2, coin: 0.5 },
  ];

  // Улучшения покупаются для каждой машины отдельно, по 3 ступени.
  const UPGRADES = [
    { id: 'suspension', name: 'Подвеска', desc: 'прыжок выше и дальше', prices: [15, 40, 90], step: 0.04 },
    { id: 'body', name: 'Кузов', desc: '+1 удар, который машина переживёт', prices: [20, 50, 120], step: 1 },
    { id: 'engine', name: 'Двигатель', desc: '+25% монет с трассы', prices: [15, 40, 100], step: 0.25 },
  ];

  // Уровни: длина трассы (px), скорость (px/с), сложность препятствий от начала к концу (0…1),
  // промежутки между препятствиями, зерно генерации, цвета фона, сколько монет лежит на трассе,
  // награда за первое прохождение.
  // Проходимость каждого уровня базовой машиной проверяет npm run check.
  const LEVELS = [
    { name: 'Двор', len: 6000, speed: 300, d: [0, 0.15], gap: [240, 380], seed: 11, palette: ['#2e2f31', '#3a3b3e'], coins: 5, reward: 5 },
    { name: 'Рынок', len: 8000, speed: 320, d: [0.05, 0.35], gap: [225, 350], seed: 21, palette: ['#3b332c', '#4a4037'], coins: 7, reward: 10 },
    { name: 'Трасса', len: 10000, speed: 340, d: [0.15, 0.55], gap: [215, 330], seed: 31, palette: ['#2b3337', '#36424a'], coins: 9, reward: 15 },
    { name: 'Ночной город', len: 11000, speed: 350, d: [0.3, 0.8], gap: [210, 310], seed: 41, palette: ['#151515', '#1f1f22'], coins: 11, reward: 25 },
    { name: 'Рублёвка', len: 12000, speed: 360, d: [0.45, 1], gap: [205, 300], seed: 51, palette: ['#433b31', '#54493b'], coins: 14, reward: 40 },
  ];

  // Пакеты монет за Telegram Stars (XTR): 1 монета = 1 звезда.
  const PACKS = [
    { id: 'coins_xs', title: 'Горсть монет', coins: 25, stars: 25 },
    { id: 'coins_s', title: 'Пачка монет', coins: 50, stars: 50 },
    { id: 'coins_m', title: 'Мешок монет', coins: 150, stars: 150 },
    { id: 'coins_l', title: 'Сундук монет', coins: 400, stars: 400 },
  ];

  const COIN_VALUE = 1;         // монет за одну монету на трассе
  const REPEAT_REWARD = 0.1;    // доля награды за повторное прохождение уровня (не меньше 1 монеты)
  const START_COINS = 0;
  const PROFILE_VERSION = 2;    // 2 — курс «1 монета = 1 звезда»
  const OLD_RATE = 60;          // старый курс: 3000 монет стоили 50 звёзд

  const ERRORS = {
    no_money: 'Не хватает монет',
    not_owned: 'Сначала купите эту машину',
    owned: 'Эта машина уже есть в гараже',
    max: 'Улучшение уже на максимуме',
    locked: 'Сначала пройдите предыдущий уровень',
    bad_request: 'Некорректный запрос',
    run_unknown: 'Заезд не найден — начните уровень заново',
  };
  class GameError extends Error {
    constructor(code) { super(ERRORS[code] || code); this.code = code; }
  }

  const car = id => CARS.find(c => c.id === id);
  const upgrade = id => UPGRADES.find(u => u.id === id);
  const freshUpgrades = () => UPGRADES.reduce((o, u) => (o[u.id] = 0, o), {});

  // Профиль игрока. normalize достраивает недостающие поля (для старых сохранений) и возвращает тот же объект.
  function newProfile() { return normalize({}); }
  function normalize(p) {
    p = p && typeof p === 'object' ? p : {};
    if (!Number.isFinite(p.coins)) p.coins = START_COINS;
    else if (!(p.v >= PROFILE_VERSION)) p.coins = Math.round(p.coins / OLD_RATE); // перевод старых балансов на новый курс
    p.v = PROFILE_VERSION;
    if (!p.cars || typeof p.cars !== 'object') p.cars = {};
    for (const c of CARS) if (c.price === 0 && !p.cars[c.id]) p.cars[c.id] = freshUpgrades();
    for (const id of Object.keys(p.cars)) {
      if (!car(id)) { delete p.cars[id]; continue; }
      const u = Object.assign(freshUpgrades(), p.cars[id]);
      for (const up of UPGRADES) u[up.id] = Math.max(0, Math.min(up.prices.length, u[up.id] | 0));
      p.cars[id] = u;
    }
    if (!p.cars[p.car]) p.car = CARS[0].id;
    if (!Array.isArray(p.levels)) p.levels = [];
    p.levels = LEVELS.map((_, i) => ({ done: !!(p.levels[i] && p.levels[i].done), best: +(p.levels[i] && p.levels[i].best) || 0 }));
    return p;
  }

  function levelUnlocked(p, i) { return i === 0 || (i > 0 && i < LEVELS.length && p.levels[i - 1].done); }

  // Итоговые характеристики машины с улучшениями
  function carStats(p, id) {
    const c = car(id), u = p.cars[id] || freshUpgrades();
    return {
      jumpMul: c.jump * (1 + u.suspension * upgrade('suspension').step),
      armor: c.armor + u.body * upgrade('body').step,
      coinMul: 1 + c.coin + u.engine * upgrade('engine').step,
    };
  }

  function buyCar(p, id) {
    const c = car(id);
    if (!c) throw new GameError('bad_request');
    if (p.cars[id]) throw new GameError('owned');
    if (p.coins < c.price) throw new GameError('no_money');
    p.coins -= c.price;
    p.cars[id] = freshUpgrades();
    p.car = id;
    return p;
  }

  function selectCar(p, id) {
    if (!p.cars[id]) throw new GameError('not_owned');
    p.car = id;
    return p;
  }

  function upgradePrice(p, carId, upgId) {
    const u = upgrade(upgId), lvl = p.cars[carId] ? p.cars[carId][upgId] : 0;
    return u && lvl < u.prices.length ? u.prices[lvl] : null;
  }

  function buyUpgrade(p, carId, upgId) {
    if (!upgrade(upgId)) throw new GameError('bad_request');
    if (!p.cars[carId]) throw new GameError('not_owned');
    const price = upgradePrice(p, carId, upgId);
    if (price === null) throw new GameError('max');
    if (p.coins < price) throw new GameError('no_money');
    p.coins -= price;
    p.cars[carId][upgId]++;
    return p;
  }

  // Итог попытки: монеты с трассы + награда за прохождение. Меняет профиль и возвращает разбивку.
  function applyRun(p, r) {
    const li = r.level | 0;
    if (!LEVELS[li]) throw new GameError('bad_request');
    if (!levelUnlocked(p, li)) throw new GameError('locked');
    if (!p.cars[r.car]) throw new GameError('not_owned');
    const st = carStats(p, r.car);
    const coins = Math.round(Math.max(0, r.pickups | 0) * COIN_VALUE * st.coinMul);
    const lv = p.levels[li];
    let bonus = 0, first = false;
    if (r.finished) {
      first = !lv.done;
      bonus = first ? LEVELS[li].reward : Math.max(1, Math.round(LEVELS[li].reward * REPEAT_REWARD));
      lv.done = true;
      lv.best = 1;
    } else {
      lv.best = Math.max(lv.best, Math.min(0.99, +r.progress || 0));
    }
    p.coins += coins + bonus;
    return { coins, bonus, total: coins + bonus, first };
  }

  return {
    CARS, UPGRADES, LEVELS, PACKS, COIN_VALUE, REPEAT_REWARD, START_COINS, GameError,
    car, upgrade, newProfile, normalize, levelUnlocked, carStats, buyCar, selectCar, upgradePrice, buyUpgrade, applyRun,
  };
});
