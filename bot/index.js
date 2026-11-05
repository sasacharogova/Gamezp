#!/usr/bin/env node
/*
 * Telegram-бот без зависимостей (Node 20+, встроенные fetch/FormData) — для Railway, своего сервера или компьютера.
 * Если выкладываете на Vercel, этот файл не нужен: там бота обслуживает api/telegram.js.
 *
 * На хостинге, который выдаёт порт (переменная PORT, например Railway), бот заодно раздаёт
 * игру по https: /webapp/ — игра, /assets/ — превью, /widget/ — HTML-виджет. Отдельный хостинг не нужен.
 *
 * Что делает — ровно то, что на видео:
 *   1. на /start присылает «гифку» (assets/preview.mp4 через sendAnimation) с подписью;
 *   2. под ней — inline-кнопка типа web_app, открывающая игру (Mini App);
 *   3. ставит кнопку меню слева от поля ввода (setChatMenuButton), она тоже открывает игру.
 *
 * Настройки — переменные окружения или файл .env в корне репозитория:
 *   BOT_TOKEN    — токен от @BotFather (обязательно)
 *   WEBAPP_URL   — https-адрес папки webapp/; на Railway подставляется сам из RAILWAY_PUBLIC_DOMAIN
 *   BUTTON_TEXT  — текст кнопки под сообщением (по умолчанию «🎮 Играть»)
 *   MENU_TEXT    — текст кнопки меню (по умолчанию «Играть»)
 *   CAPTION      — подпись под гифкой (HTML); тексты по умолчанию — в bot/texts.js
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
const { CAPTION, MENU_TEXT, COMMANDS, START_RE, keyboard } = require('./texts');
const CACHE = path.join(__dirname, '.file-cache.json');

if (!TOKEN) fail('Не задан BOT_TOKEN (возьмите у @BotFather; на Railway — вкладка Variables, локально — файл .env)');
if (!WEBAPP_URL) {
  fail(PORT
    ? 'Нет адреса игры. На Railway: Settings → Networking → Generate Domain, затем Redeploy'
    : 'Не задан WEBAPP_URL — https-адрес, где лежит папка webapp/');
}
if (!/^https:\/\//.test(WEBAPP_URL)) fail('WEBAPP_URL должен начинаться с https:// (Telegram открывает Mini App только по https)');
if (!fs.existsSync(PREVIEW)) fail('Нет файла превью: ' + PREVIEW + ' — запустите npm run render');

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

async function main() {
  const me = await api('getMe');
  await api('deleteWebhook', {}); // работаем через long polling
  await api('setMyCommands', { commands: COMMANDS });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: MENU_TEXT, web_app: { url: WEBAPP_URL } } });
  console.log(`✅ @${me.username} запущен. Mini App: ${WEBAPP_URL}`);

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    } catch (e) {
      console.error('getUpdates:', e.message);
      await sleep(e.retryAfter ? e.retryAfter * 1000 : 3000);
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m || typeof m.text !== 'string') continue;
      if (START_RE.test(m.text)) {
        try { await sendPreview(m.chat, me.id); }
        catch (e) { console.error('sendAnimation:', e.message); }
      }
    }
  }
}

// Раздача игры, превью и виджета, если хостинг выдал порт (Railway, Render и т.п.)
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
  }).listen(PORT, () => console.log(`🌐 Игра раздаётся на порту ${PORT}: ${WEBAPP_URL}`));
}

if (PORT) serveStatic();
main().catch(e => fail(e.message));
