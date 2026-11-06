#!/usr/bin/env node
/*
 * Проверка сервера бота без настоящего Telegram: поднимает подставной Bot API, запускает bot/index.js
 * и проходит сценарии — профиль, покупки, заезды, оплату звёздами, защиту от подделок.
 *
 *   npm run test:server
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { signInitData } = require('../bot/auth');

const TOKEN = '123456:TEST-token';
const MOCK_PORT = 18790, BOT_PORT = 18791;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zvezda-test-'));

// ---------- подставной Telegram Bot API ----------
const calls = [];
const queue = [];
let updateId = 1;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const method = req.url.split('/').pop();
    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch (e) { payload = { raw: body.length }; }
    calls.push({ method, payload });
    const reply = r => res.end(JSON.stringify({ ok: true, result: r }));
    if (method === 'getMe') return reply({ id: 42, is_bot: true, username: 'zvezda_test_bot' });
    if (method === 'createInvoiceLink') return reply('https://t.me/$test-invoice');
    if (method === 'getMyStarBalance') return reply({ amount: calls.some(c => c.method === 'sendMessage' && /Начислено/.test(c.payload.text)) ? 50 : 0 });
    if (method === 'getStarTransactions') return reply({ transactions: [{ id: 't1', amount: 50, date: Math.floor(Date.now() / 1000), source: { type: 'user', user, invoice_payload: 'coins_s:777' } }] });
    if (method === 'getUpdates') {
      const send = () => reply(queue.splice(0).map(u => Object.assign({ update_id: updateId++ }, u)));
      if (queue.length) return send();
      return setTimeout(send, 300);
    }
    if (method === 'sendAnimation' || method === 'sendMessage') return reply({ message_id: 1 });
    return reply(true);
  });
}).listen(MOCK_PORT);

// ---------- помощники ----------
const user = { id: 777, first_name: 'Тест' };
const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q1', user: JSON.stringify(user) }, TOKEN);
async function call(name, body, auth = initData) {
  const res = await fetch(`http://127.0.0.1:${BOT_PORT}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'tma ' + auth }, body: JSON.stringify(body || {}),
  });
  return { status: res.status, ...(await res.json()) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, what) {
  for (let i = 0; i < 50; i++) { const r = fn(); if (r) return r; await sleep(100); }
  throw new Error('не дождались: ' + what);
}
let failed = 0;
function check(cond, what) {
  console.log((cond ? '✅ ' : '❌ ') + what);
  if (!cond) failed++;
}

(async () => {
  const bot = spawn(process.execPath, [path.join(__dirname, '..', 'bot', 'index.js')], {
    env: { ...process.env, BOT_TOKEN: TOKEN, PORT: String(BOT_PORT), RAILWAY_PUBLIC_DOMAIN: 'zvezda.example', DATA_DIR: dataDir, TELEGRAM_API: `http://127.0.0.1:${MOCK_PORT}`, SUPPORT_CONTACT: '@support', ADMIN_ID: '777' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  bot.stdout.on('data', d => (log += d)); bot.stderr.on('data', d => (log += d));
  try {
    await waitFor(() => log.includes('запущен'), 'запуск бота');

    let r = await call('me');
    check(r.ok && r.profile.coins === 0 && r.profile.car === 'eshka', 'новый игрок: 0 монет, стартовая машина');

    r = await call('me', {}, initData.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64)));
    check(r.status === 401, 'поддельная подпись initData отклоняется');

    r = await call('buy', { type: 'car', car: 'kaban' });
    check(r.status === 400 && /монет/.test(r.error), 'купить машину без монет нельзя');

    r = await call('invoice', { pack: 'coins_s' });
    const inv = calls.find(c => c.method === 'createInvoiceLink');
    check(r.ok && r.url && inv && inv.payload.currency === 'XTR' && inv.payload.prices[0].amount === 50, 'счёт на 50 ⭐ создан');

    queue.push({ pre_checkout_query: { id: 'pc1', from: user, currency: 'XTR', total_amount: 50, invoice_payload: 'coins_s:777' } });
    queue.push({ pre_checkout_query: { id: 'pc2', from: user, currency: 'XTR', total_amount: 1, invoice_payload: 'coins_s:777' } });
    await waitFor(() => calls.filter(c => c.method === 'answerPreCheckoutQuery').length >= 2, 'ответы на pre_checkout_query');
    const pcs = calls.filter(c => c.method === 'answerPreCheckoutQuery');
    check(pcs.find(c => c.payload.pre_checkout_query_id === 'pc1').payload.ok === true, 'правильный заказ подтверждается');
    check(pcs.find(c => c.payload.pre_checkout_query_id === 'pc2').payload.ok === false, 'заказ с чужой суммой отклоняется');

    const payment = { from: user, chat: { id: 777, type: 'private' }, successful_payment: { currency: 'XTR', total_amount: 50, invoice_payload: 'coins_s:777', telegram_payment_charge_id: 'ch1' } };
    queue.push({ message: payment }, { message: payment });
    await waitFor(() => calls.filter(c => c.method === 'sendMessage' && /Начислено/.test(c.payload.text)).length >= 1, 'сообщение о начислении');
    await sleep(500);
    r = await call('me');
    check(r.profile.coins === 3000, 'после оплаты начислено 3000 монет, повтор того же платежа не начислил ещё раз');
    check(calls.filter(c => c.method === 'sendMessage' && /не распознан/.test(c.payload.text)).length === 0, 'на повтор платежа бот не пишет «не распознан»');

    r = await call('buy', { type: 'car', car: 'kaban' });
    check(r.ok && r.profile.coins === 1000 && r.profile.car === 'kaban', 'машина куплена и выбрана');
    r = await call('buy', { type: 'upgrade', car: 'kaban', upgrade: 'engine' });
    check(r.ok && r.profile.coins === 500 && r.profile.cars.kaban.engine === 1, 'улучшение куплено');

    r = await call('run/start', { level: 1, car: 'kaban' });
    check(r.status === 400, 'закрытый уровень начать нельзя');

    r = await call('run/start', { level: 0, car: 'kaban' });
    const runId = r.runId;
    r = await call('run/finish', { runId, finished: true, pickups: 999, progress: 1 });
    check(r.ok && r.reward.bonus === 0 && !r.profile.levels[0].done && r.reward.coins < 100, 'мгновенный «финиш» и 999 монеток не засчитываются');
    r = await call('run/finish', { runId, finished: false, pickups: 1 });
    check(r.status === 400, 'один заезд нельзя засчитать дважды');

    queue.push({ message: { from: user, chat: { id: 777, type: 'private' }, text: '/paysupport' } });
    await waitFor(() => calls.find(c => c.method === 'sendMessage' && /@support/.test(c.payload.text)), '/paysupport');
    check(true, '/paysupport отвечает контактом поддержки');

    queue.push({ message: { from: user, chat: { id: 777, type: 'private' }, text: '/stars' } });
    const stars = await waitFor(() => calls.find(c => c.method === 'sendMessage' && /Баланс бота/.test(c.payload.text)), '/stars');
    check(/Баланс бота: 50/.test(stars.payload.text) && /\+50 ⭐/.test(stars.payload.text) && /1 на 50/.test(stars.payload.text), '/stars владельцу: баланс бота 50 ⭐, поступление и сверка с базой');
    queue.push({ message: { from: { id: 9, first_name: 'Чужой' }, chat: { id: 9, type: 'private' }, text: '/stars' } });
    await waitFor(() => calls.find(c => c.method === 'sendMessage' && c.payload.chat_id === 9), '/stars чужому');
    check(/только для владельца/.test(calls.find(c => c.method === 'sendMessage' && c.payload.chat_id === 9).payload.text), '/stars чужим не показывает баланс');
    check(/Баланс бота теперь: 50/.test(log), 'после оплаты в логах виден баланс звёзд бота');

    await sleep(500);
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    check(db.users['777'] && db.payments.ch1 && db.payments.ch1.coins === 3000, 'профиль и платёж записаны в базу');
  } catch (e) {
    console.error('❌', e.message);
    failed++;
  } finally {
    bot.kill('SIGTERM');
    mock.close();
    if (failed) console.log('\n--- лог бота ---\n' + log);
    console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсё в порядке ✅');
    process.exit(failed ? 1 : 0);
  }
})();
