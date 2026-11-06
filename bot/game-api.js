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

    async invoice(uid, b) {
      const pack = C.PACKS.find(x => x.id === b.pack);
      if (!pack) throw new C.GameError('bad_request');
      const url = await tg('createInvoiceLink', {
        title: pack.title,
        description: `${pack.coins.toLocaleString('ru-RU')} монет для игры «Звезда провинции»`,
        payload: `${pack.id}:${uid}`,
        currency: 'XTR', // Telegram Stars — для цифровых товаров в Telegram только они
        prices: [{ label: pack.title, amount: pack.stars }],
      });
      return { url };
    },
  };

  // Telegram спрашивает перед списанием звёзд: всё ли в порядке с заказом. Ответить нужно за 10 секунд.
  function checkPreCheckout(q) {
    const [packId, uid] = String(q.invoice_payload || '').split(':');
    const pack = C.PACKS.find(x => x.id === packId);
    if (!pack || q.currency !== 'XTR' || q.total_amount !== pack.stars || String(q.from && q.from.id) !== uid) {
      return 'Этот счёт устарел — откройте магазин в игре заново';
    }
    return null;
  }

  // Оплата прошла: начисляем монеты. Повторное уведомление о том же платеже не начислит дважды.
  // Возвращает { status: 'ok' | 'duplicate' | 'unknown', pack }.
  function applyPayment(sp, fromId) {
    const charge = sp.telegram_payment_charge_id;
    if (!charge) return { status: 'unknown' };
    if (store.db.payments[charge]) return { status: 'duplicate' };
    const [packId, uid] = String(sp.invoice_payload || '').split(':');
    const pack = C.PACKS.find(x => x.id === packId);
    if (!pack || String(fromId) !== uid) {
      console.error('Платёж с неизвестным заказом:', sp.invoice_payload, charge);
      store.db.payments[charge] = { uid: String(fromId), payload: sp.invoice_payload, stars: sp.total_amount, at: Date.now(), error: 'unknown_pack' };
      store.save();
      return { status: 'unknown' };
    }
    user(uid).coins += pack.coins;
    store.db.payments[charge] = { uid, pack: pack.id, coins: pack.coins, stars: sp.total_amount, at: Date.now() };
    store.save();
    return { status: 'ok', pack };
  }

  // Возврат звёзд (для владельца): Telegram вернёт звёзды игроку, а мы спишем начисленные монеты
  async function refund(charge) {
    const pay = store.db.payments[charge];
    if (!pay) return { ok: false, error: 'Платёж не найден' };
    if (pay.refunded) return { ok: false, error: 'Этот платёж уже возвращён' };
    await tg('refundStarPayment', { user_id: Number(pay.uid), telegram_payment_charge_id: charge });
    const p = user(pay.uid);
    p.coins = Math.max(0, p.coins - (pay.coins || 0));
    pay.refunded = Date.now();
    store.save();
    return { ok: true, pay };
  }

  return { handlers, checkPreCheckout, applyPayment, refund };
}

module.exports = { createGameApi };
