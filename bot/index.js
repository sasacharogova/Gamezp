#!/usr/bin/env node
/*
 * Telegram-бот без зависимостей (Node 20+, встроенные fetch/FormData) — для Railway, своего сервера или компьютера.
 * Если выкладываете на Vercel, этот файл не нужен: там бота обслуживает api/telegram.js.
 *
 * На хостинге, который выдаёт порт (переменная PORT, например Railway), бот заодно раздаёт
 * игру по https: /webapp/ — игра, /assets/ — превью, /widget/ — HTML-виджет. Отдельный хостинг не нужен.
 *
 * Что делает:
 *   1. на /start присылает «гифку» (assets/preview.mp4 через sendAnimation) и кнопку игры (Mini App);
 *   2. ставит кнопку меню слева от поля ввода (setChatMenuButton), она тоже открывает игру;
 *   3. хранит прогресс игроков (монеты, гараж, уровни) и отвечает игре по /api/... (bot/game-api.js);
 *   4. продаёт монеты за Telegram Stars: счёт, pre_checkout_query, successful_payment, /paysupport, /terms.
 *
 * Настройки — переменные окружения или файл .env в корне репозитория:
 *   BOT_TOKEN    — токен от @BotFather (обязательно)
 *   WEBAPP_URL   — https-адрес папки webapp/; на Railway подставляется сам из RAILWAY_PUBLIC_DOMAIN
 *   BUTTON_TEXT  — текст кнопки под сообщением (по умолчанию «🎮 Играть»)
 *   MENU_TEXT    — текст кнопки меню (по умолчанию «Играть»)
 *   CAPTION      — подпись под гифкой (HTML); тексты по умолчанию — в bot/texts.js
 *   SUPPORT_CONTACT — куда писать по покупкам (например @username), показывается в /paysupport
 *   DATA_DIR     — папка для базы игроков; на Railway подставляется путь подключённого Volume
 *   ADMIN_ID     — ваш Telegram ID (узнать: команда /myid), через запятую можно несколько:
 *                  им доступны /stars (баланс звёзд бота, поступления) и /refund <код> (вернуть звёзды)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT;
const PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;
const WEBAPP_URL = process.env.WEBAPP_URL || (PUBLIC_DOMAIN ? `https://${PUBLIC_DOMAIN}/webapp/` : '');
const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const PREVIEW = path.resolve(ROOT, process.env.PREVIEW_PATH || 'assets/preview.mp4');
const { CAPTION, MENU_TEXT, COMMANDS, START_RE, PAYSUPPORT, TERMS, keyboard } = require('./texts');
const CACHE = path.join(__dirname, '.file-cache.json');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, 'data');
const ADMIN_IDS = String(process.env.ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN) fail('Не задан BOT_TOKEN (возьмите у @BotFather; на Railway — вкладка Variables, локально — файл .env)');
if (!WEBAPP_URL) {
  fail(PORT
    ? 'Нет адреса игры. На Railway: Settings → Networking → Generate Domain, затем Redeploy'
    : 'Не задан WEBAPP_URL — https-адрес, где лежит папка webapp/');
}
if (!/^https:\/\//.test(WEBAPP_URL)) fail('WEBAPP_URL должен начинаться с https:// (Telegram открывает Mini App только по https)');
if (PUBLIC_DOMAIN && process.env.WEBAPP_URL && !process.env.WEBAPP_URL.includes(PUBLIC_DOMAIN)) {
  console.warn(`⚠️  Кнопки ведут на ${WEBAPP_URL}, а этот сервер — ${PUBLIC_DOMAIN}. ` +
    'Если игра не открывается, удалите переменную WEBAPP_URL в Railway (Variables) — адрес подставится сам.');
}
if (!fs.existsSync(PREVIEW)) fail('Нет файла превью: ' + PREVIEW + ' — запустите npm run render');
if (PORT && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.warn('⚠️  Прогресс и покупки игроков хранятся в ' + DATA_DIR + ' и пропадут при следующем деплое. ' +
    'На Railway подключите Volume к сервису (правый клик по сервису → Attach Volume, путь /data).');
}

function fail(msg) { console.error('❌ ' + msg); process.exit(1); }

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\\n/g, '\n');
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, payload = {}) {
  const isForm = payload instanceof FormData;
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'content-type': 'application/json' },
    body: isForm ? payload : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
  if (!data.ok) {
    const err = new Error(`${method}: ${data.description || 'ошибка'}`);
    err.retryAfter = data.parameters && data.parameters.retry_after;
    throw err;
  }
  return data.result;
}

// Telegram отдаёт file_id после первой загрузки — дальше шлём по нему, без повторной загрузки файла.
function cacheKey(botId) { const st = fs.statSync(PREVIEW); return `${botId}:${st.size}:${Math.round(st.mtimeMs)}`; }
function readCache() { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return {}; } }
function writeCache(obj) { try { fs.writeFileSync(CACHE, JSON.stringify(obj, null, 2)); } catch (e) { /* не критично */ } }

async function sendPreview(chat, botId) {
  const key = cacheKey(botId);
  const cache = readCache();
  const base = { chat_id: chat.id, caption: CAPTION, parse_mode: 'HTML', reply_markup: keyboard(chat, WEBAPP_URL) };

  if (cache[key]) {
    try { return await api('sendAnimation', { ...base, animation: cache[key] }); }
    catch (e) { console.warn('file_id не подошёл, загружаю файл заново:', e.message); }
  }

  const form = new FormData();
  form.append('chat_id', String(chat.id));
  form.append('caption', CAPTION);
  form.append('parse_mode', 'HTML');
  form.append('reply_markup', JSON.stringify(base.reply_markup));
  form.append('width', '1280');
  form.append('height', '800');
  form.append('animation', new Blob([fs.readFileSync(PREVIEW)], { type: 'video/mp4' }), 'preview.mp4');
  const msg = await api('sendAnimation', form);
  const media = msg.animation || msg.document || msg.video;
  if (media && media.file_id) writeCache({ ...cache, [key]: media.file_id });
  return msg;
}

const CATALOG = require('../webapp/catalog.js');
const { openStore } = require('./store');
const { createGameApi } = require('./game-api');
const { validateInitData } = require('./auth');
const store = openStore(DATA_DIR);
const game = createGameApi({ store, tg: api });

async function send(chatId, text) {
  try { await api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }); }
  catch (e) { console.error('sendMessage:', e.message); }
}

// Звёзды за покупки зачисляются на баланс самого бота; вывести их может владелец бота через Fragment.
async function starBalance() {
  const r = await api('getMyStarBalance', {});
  return r.amount + (r.nanostar_amount ? r.nanostar_amount / 1e9 : 0);
}

async function starsReport() {
  const balance = await starBalance();
  const tx = (await api('getStarTransactions', { limit: 10 })).transactions || [];
  const pays = Object.values(store.db.payments).filter(p => !p.error && !p.refunded);
  const recent = Object.entries(store.db.payments).filter(([, p]) => !p.error).sort((a, b) => b[1].at - a[1].at).slice(0, 5);
  const monthAgo = Date.now() - 30 * 24 * 3600 * 1000;
  const month = pays.filter(p => p.at >= monthAgo);
  const lines = tx.slice(0, 10).map(t => {
    const d = new Date(t.date * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const who = t.source ? (t.source.user ? t.source.user.first_name : t.source.type) : t.receiver ? '→ ' + t.receiver.type : '';
    return `${d}  ${t.source ? '+' : '−'}${t.amount} ⭐  ${who}`;
  });
  return `<b>Баланс бота: ${balance} ⭐</b>\n` +
    `Покупок в игре за 30 дней: ${month.length} на ${month.reduce((a, p) => a + p.stars, 0)} ⭐ (всего ${pays.length})\n\n` +
    (lines.length ? '<b>Последние операции</b>\n<code>' + lines.join('\n') + '</code>\n\n' : '') +
    (recent.length ? '<b>Покупки в игре</b> (вернуть: /refund и код)\n' + recent.map(([id, p]) =>
      `${p.stars} ⭐ от ${p.uid}${p.refunded ? ' — возвращено' : ''}\n<code>/refund ${id}</code>`).join('\n') + '\n\n' : '') +
    'Вывести звёзды: профиль бота → Изменить → Баланс → вывод через Fragment ' +
    '(обычно через 21 день после покупки и от 1000 ⭐).';
}

async function onUpdate(u, me) {
  if (u.pre_checkout_query) { // Telegram спрашивает перед списанием звёзд
    const q = u.pre_checkout_query, error = game.checkPreCheckout(q);
    await api('answerPreCheckoutQuery', error
      ? { pre_checkout_query_id: q.id, ok: false, error_message: error }
      : { pre_checkout_query_id: q.id, ok: true });
    return;
  }
  const m = u.message;
  if (!m) return;
  if (m.successful_payment) {
    const r = game.applyPayment(m.successful_payment, m.from.id);
    console.log(`⭐ Оплата ${m.successful_payment.total_amount} XTR от ${m.from.id}: ${r.status}${r.pack ? ' ' + r.pack.id : ''}`);
    if (r.status === 'ok') {
      await send(m.chat.id, `✅ Начислено ${r.pack.coins.toLocaleString('ru-RU')} монет. Возвращайся в игру!`);
      starBalance().then(b => console.log(`⭐ Баланс бота теперь: ${b} звёзд`)).catch(e => console.error('getMyStarBalance:', e.message));
    }
    else if (r.status === 'unknown') await send(m.chat.id, 'Оплата получена, но заказ не распознан. Напиши /paysupport — разберёмся.');
    return; // повтор того же платежа — молча
  }
  if (typeof m.text !== 'string') return;
  if (START_RE.test(m.text)) await sendPreview(m.chat, me.id);
  else if (/^\/paysupport(@\w+)?(\s|$)/.test(m.text)) await send(m.chat.id, PAYSUPPORT);
  else if (/^\/terms(@\w+)?(\s|$)/.test(m.text)) await send(m.chat.id, TERMS);
  else if (/^\/myid(@\w+)?(\s|$)/.test(m.text)) {
    await send(m.chat.id, `Ваш Telegram ID: <code>${m.from.id}</code>\nВладельцу: впишите его в переменную ADMIN_ID, чтобы видеть баланс звёзд командой /stars.`);
  } else if (/^\/refund(@\w+)?(\s|$)/.test(m.text)) {
    if (!ADMIN_IDS.includes(String(m.from.id))) { await send(m.chat.id, 'Команда только для владельца бота.'); return; }
    const charge = m.text.split(/\s+/)[1];
    if (!charge) { await send(m.chat.id, 'Укажите код платежа: /refund &lt;код&gt; — коды есть в /stars'); return; }
    const r = await game.refund(charge).catch(e => ({ ok: false, error: e.message }));
    await send(m.chat.id, r.ok ? `↩️ Вернули ${r.pay.stars} ⭐ игроку ${r.pay.uid}, списали ${r.pay.coins} монет.` : '❌ ' + r.error);
  } else if (/^\/stars(@\w+)?(\s|$)/.test(m.text)) {
    if (!ADMIN_IDS.includes(String(m.from.id))) await send(m.chat.id, 'Команда только для владельца бота.');
    else await send(m.chat.id, await starsReport().catch(e => 'Не удалось получить баланс: ' + e.message));
  }
  else if (!m.text.startsWith('/')) { // обычные сообщения (например, вопросы по покупкам) видны в логах
    console.log(`📩 Сообщение от ${m.from.id}${m.from.username ? ' @' + m.from.username : ''}: ${m.text.slice(0, 500)}`);
  }
}

async function main() {
  const me = await api('getMe');
  await api('deleteWebhook', {}); // работаем через long polling
  await api('setMyCommands', { commands: COMMANDS });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: MENU_TEXT, web_app: { url: WEBAPP_URL } } });
  console.log(`✅ @${me.username} запущен. Mini App: ${WEBAPP_URL}`);
  try { console.log(`⭐ Баланс бота: ${await starBalance()} звёзд — сюда приходят оплаты из игры`); }
  catch (e) { console.warn('⚠️  Не удалось узнать баланс звёзд:', e.message); }
  if (!process.env.SUPPORT_CONTACT) console.warn('⚠️  Не задан SUPPORT_CONTACT — укажите, куда писать по покупкам (например @ваш_ник); он показывается в /paysupport');

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'pre_checkout_query'] });
    } catch (e) {
      console.error('getUpdates:', e.message);
      await sleep(e.retryAfter ? e.retryAfter * 1000 : 3000);
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      try { await onUpdate(u, me); }
      catch (e) { console.error('Обработка обновления:', e.message); }
    }
  }
}

// Ответ JSON
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// /api/<метод>: игрок определяется по подписанному Telegram initData из заголовка Authorization
async function handleApi(req, res, name) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });
  const handler = Object.prototype.hasOwnProperty.call(game.handlers, name) && game.handlers[name];
  if (!handler) return json(res, 404, { ok: false, error: 'Нет такого метода' });
  const auth = String(req.headers.authorization || '');
  const user = validateInitData(auth.startsWith('tma ') ? auth.slice(4) : '', TOKEN);
  if (!user) return json(res, 401, { ok: false, error: 'Откройте игру через Telegram' });
  let body = {};
  try { const raw = await readBody(req, 16 * 1024); body = raw ? JSON.parse(raw) : {}; }
  catch (e) { return json(res, 400, { ok: false, error: 'Некорректный запрос' }); }
  try {
    json(res, 200, Object.assign({ ok: true }, await handler(String(user.id), body || {})));
  } catch (e) {
    if (e instanceof CATALOG.GameError) return json(res, 400, { ok: false, error: e.message, code: e.code });
    console.error('API ' + name + ':', e);
    json(res, 500, { ok: false, error: 'Ошибка сервера, попробуйте ещё раз' });
  }
}

// Раздача игры, превью и виджета + API игры, если хостинг выдал порт (Railway, Render и т.п.)
function serveStatic() {
  const http = require('http');
  const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.mp4': 'video/mp4', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  };
  const PUBLIC = ['webapp', 'assets', 'widget'];
  http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (e) { res.writeHead(400); return res.end('Bad request'); }
    if (pathname === '/') { res.writeHead(302, { location: '/webapp/' }); return res.end(); }
    if (pathname.startsWith('/api/')) { handleApi(req, res, pathname.slice(5)); return; }
    const rel = path.normalize(pathname + (pathname.endsWith('/') ? 'index.html' : '')).replace(/^[/\\]+/, '');
    if (!PUBLIC.includes(rel.split(/[/\\]/)[0])) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(path.join(ROOT, rel), (err, data) => {
      if (err && err.code === 'EISDIR') { res.writeHead(301, { location: pathname + '/' }); return res.end(); }
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'public, max-age=300',
      });
      res.end(data);
    });
  }).listen(PORT, () => console.log(`🌐 Игра раздаётся на порту ${PORT}` + (PUBLIC_DOMAIN ? `: https://${PUBLIC_DOMAIN}/webapp/` : '')));
}

if (PORT) serveStatic();
main().catch(e => fail(e.message));
