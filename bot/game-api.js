// API игры для Mini App и обработка оплаты звёздами.
// Все цены и награды считаются по webapp/catalog.js — тем же правилам, что видит игрок.
'use strict';
const crypto = require('crypto');
const C = require('../webapp/catalog.js');
const LG = require('../webapp/levels.js');

const RUN_TTL_MS = 30 * 60 * 1000;

function createGameApi({ store, tg }) {
  const runs = new Map(); // незавершённые попытки: runId → { uid, li, car, t }
  // Сколько монеток лежит на каждом уровне и за сколько секунд он проходится — для проверки заездов
  const levelInfo = C.LEVELS.map((L, i) => ({ pickups: LG.build(i).pickups.length, seconds: L.len / L.speed }));

  function user(uid) {
    const u = C.normalize(store.db.users[uid]);
    store.db.users[uid] = u;
    return u;
  }

  const handlers = {
    me(uid) { return { profile: user(uid) }; },

    buy(uid, b) {
      const p = user(uid);
      if (b.type === 'car') C.buyCar(p, String(b.car));
      else if (b.type === 'select') C.selectCar(p, String(b.car));
      else if (b.type === 'upgrade') C.buyUpgrade(p, String(b.car), String(b.upgrade));
      else throw new C.GameError('bad_request');
      store.save();
      return { profile: p };
    },

    'run/start'(uid, b) {
      const p = user(uid), li = b.level | 0, car = String(b.car);
      if (!C.LEVELS[li]) throw new C.GameError('bad_request');
      if (!C.levelUnlocked(p, li)) throw new C.GameError('locked');
      if (!p.cars[car]) throw new C.GameError('not_owned');
      const now = Date.now();
      for (const [id, r] of runs) if (now - r.t > RUN_TTL_MS) runs.delete(id);
      const runId = crypto.randomBytes(12).toString('base64url');
      runs.set(runId, { uid, li, car, t: now });
      return { runId };
    },

    'run/finish'(uid, b) {
      const run = runs.get(String(b.runId));
      if (!run || run.uid !== uid) throw new C.GameError('run_unknown');
      runs.delete(String(b.runId));
      const info = levelInfo[run.li];
      // Не верим клиенту на слово: прогресс не может опережать время с начала попытки,
      // монеток — не больше, чем лежит на пройденной части трассы.
      const elapsed = (Date.now() - run.t) / 1000;
      const reachable = Math.min(1, elapsed / info.seconds + 0.05);
      let finished = !!b.finished && elapsed >= info.seconds * 0.85;
      const progress = finished ? 1 : Math.min(reachable, Math.max(0, +b.progress || 0));
      const pickups = Math.max(0, Math.min(b.pickups | 0, Math.ceil(info.pickups * reachable) + 1, info.pickups));
      const reward = C.applyRun(user(uid), { level: run.li, car: run.car, pickups, finished, progress });
      store.save();
      return { profile: user(uid), reward };
    },

    // Счёт в звёздах: пачка монет ({ pack }) или сразу машина / улучшение ({ item })
    async invoice(uid, b) {
      const order = b.item ? itemOrder(user(uid), b.item, uid) : packOrder(b.pack, uid);
      const url = await tg('createInvoiceLink', {
        title: order.title,
        description: order.description,
        payload: order.payload,
        currency: 'XTR', // Telegram Stars — для цифровых товаров в Telegram только они
        prices: [{ label: order.title, amount: order.stars }],
      });
      return { url };
    },
  };

  // ---------- заказы ----------
  // payload счёта: «<пачка>:<uid>», «car:<машина>:<uid>» или «upg:<машина>:<улучшение>:<ступень>:<uid>»
  function packOrder(packId, uid) {
    const pack = C.PACKS.find(x => x.id === packId);
    if (!pack) throw new C.GameError('bad_request');
    return {
      kind: 'pack', pack, stars: pack.stars, payload: `${pack.id}:${uid}`, title: pack.title,
      description: `${pack.coins.toLocaleString('ru-RU')} монет для игры «Звезда Провинции»`,
    };
  }
  function itemOrder(p, item, uid) {
    const price = C.itemPrice(p, item);
    if (price === null) throw new C.GameError(item && item.type === 'upgrade' ? 'max' : 'owned');
    if (item.type === 'car') {
      const c = C.car(item.car);
      return { kind: 'car', item: { type: 'car', car: c.id }, stars: price, payload: `car:${c.id}:${uid}`,
        title: `Машина «${c.name}»`, description: `${c.name}, ${c.body} ${c.year} года — в гараж «Звезды Провинции»` };
    }
    const c = C.car(item.car), u = C.upgrade(item.upgrade), lvl = p.cars[c.id][u.id];
    return { kind: 'upg', item: { type: 'upgrade', car: c.id, upgrade: u.id, level: lvl }, stars: price,
      payload: `upg:${c.id}:${u.id}:${lvl}:${uid}`,
      title: `${u.name} ${lvl + 1}/${u.prices.length} — «${c.name}»`, description: `Улучшение для «${c.name}»: ${u.desc}` };
  }
  // Разбор payload обратно в заказ; цену пересчитываем по каталогу, а не берём из счёта
  function parseOrder(payload) {
    const a = String(payload || '').split(':');
    if (a[0] === 'car' && a.length === 3 && C.car(a[1])) {
      return { kind: 'car', uid: a[2], item: { type: 'car', car: a[1] }, stars: C.car(a[1]).price };
    }
    if (a[0] === 'upg' && a.length === 5 && C.car(a[1]) && C.upgrade(a[2])) {
      const lvl = a[3] | 0, price = C.upgrade(a[2]).prices[lvl];
      if (price === undefined) return null;
      return { kind: 'upg', uid: a[4], item: { type: 'upgrade', car: a[1], upgrade: a[2], level: lvl }, stars: price };
    }
    const pack = a.length === 2 && C.PACKS.find(x => x.id === a[0]);
    return pack ? { kind: 'pack', uid: a[1], pack, stars: pack.stars } : null;
  }

  // Telegram спрашивает перед списанием звёзд: всё ли в порядке с заказом. Ответить нужно за 10 секунд.
  function checkPreCheckout(q) {
    const o = parseOrder(q.invoice_payload);
    if (!o || q.currency !== 'XTR' || q.total_amount !== o.stars || String(q.from && q.from.id) !== o.uid) {
      return 'Этот счёт устарел — откройте игру и попробуйте ещё раз';
    }
    const p = user(o.uid);
    if (o.kind === 'car' && p.cars[o.item.car]) return 'Эта машина уже в гараже — звёзды не списаны';
    if (o.kind === 'upg' && (!p.cars[o.item.car] || p.cars[o.item.car][o.item.upgrade] !== o.item.level)) {
      return 'Это улучшение уже куплено — звёзды не списаны';
    }
    return null;
  }

  // Оплата прошла: выдаём покупку. Повторное уведомление о том же платеже ничего не выдаст дважды.
  // Если товар к этому моменту уже есть, звёзды не пропадают — они начисляются монетами (1 ⭐ = 1 монета).
  // Возвращает { status: 'ok' | 'duplicate' | 'unknown', kind, pack, item, coins }.
  function applyPayment(sp, fromId) {
    const charge = sp.telegram_payment_charge_id;
    if (!charge) return { status: 'unknown' };
    if (store.db.payments[charge]) return { status: 'duplicate' };
    const o = parseOrder(sp.invoice_payload);
    if (!o || String(fromId) !== o.uid) {
      console.error('Платёж с неизвестным заказом:', sp.invoice_payload, charge);
      store.db.payments[charge] = { uid: String(fromId), payload: sp.invoice_payload, stars: sp.total_amount, at: Date.now(), error: 'unknown_order' };
      store.save();
      return { status: 'unknown' };
    }
    const p = user(o.uid);
    const rec = { uid: o.uid, kind: o.kind, stars: sp.total_amount, coins: 0, at: Date.now() };
    if (o.kind === 'pack') {
      rec.pack = o.pack.id; rec.coins = o.pack.coins;
    } else if (o.kind === 'car' && !p.cars[o.item.car]) {
      p.cars[o.item.car] = C.normalize({ cars: { [o.item.car]: {} } }).cars[o.item.car];
      p.car = o.item.car;
      rec.grant = o.item;
    } else if (o.kind === 'upg' && p.cars[o.item.car] && p.cars[o.item.car][o.item.upgrade] === o.item.level) {
      p.cars[o.item.car][o.item.upgrade]++;
      rec.grant = o.item;
    } else {
      rec.coins = sp.total_amount; // товар уже есть — возвращаем ценность монетами
    }
    p.coins += rec.coins;
    store.db.payments[charge] = rec;
    store.save();
    return { status: 'ok', kind: o.kind, pack: o.pack, item: rec.grant, coins: rec.coins };
  }

  // Возврат звёзд (для владельца): Telegram вернёт звёзды игроку, а мы заберём выданное —
  // машину, ступень улучшения или монеты (если машина уже прокачана дальше — списываем монетами)
  async function refund(charge) {
    const pay = store.db.payments[charge];
    if (!pay) return { ok: false, error: 'Платёж не найден' };
    if (pay.refunded) return { ok: false, error: 'Этот платёж уже возвращён' };
    await tg('refundStarPayment', { user_id: Number(pay.uid), telegram_payment_charge_id: charge });
    const p = user(pay.uid);
    let debt = pay.coins || 0;
    const g = pay.grant;
    if (g && g.type === 'car') {
      if (p.cars[g.car]) { delete p.cars[g.car]; if (p.car === g.car) p.car = C.CARS[0].id; } else debt += pay.stars;
    } else if (g && g.type === 'upgrade') {
      if (p.cars[g.car] && p.cars[g.car][g.upgrade] === g.level + 1) p.cars[g.car][g.upgrade]--; else debt += pay.stars;
    }
    p.coins = Math.max(0, p.coins - debt);
    pay.refunded = Date.now();
    store.save();
    return { ok: true, pay };
  }

  return { handlers, checkPreCheckout, applyPayment, refund };
}

module.exports = { createGameApi };
