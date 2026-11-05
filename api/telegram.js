/*
 * Бот для Vercel — без своего сервера.
 *
 * Vercel раздаёт игру (webapp/) и видео (assets/preview.mp4) как обычные файлы,
 * а этот файл превращается в функцию по адресу https://<ваш-проект>.vercel.app/api/telegram.
 * Telegram сам присылает сюда сообщения (вебхук), функция отвечает на /start.
 *
 * Настройка:
 *   1. В Vercel → Settings → Environment Variables добавить BOT_TOKEN (токен от @BotFather).
 *   2. Один раз открыть в браузере https://<ваш-проект>.vercel.app/api/telegram?setup —
 *      функция сама подключит вебхук, команду /start и кнопку меню.
 *
 * Необязательно: WEBAPP_URL (если игра лежит на другом хостинге), PREVIEW_URL, CAPTION, BUTTON_TEXT, MENU_TEXT.
 */
'use strict';
const crypto = require('crypto');
const { CAPTION, MENU_TEXT, COMMANDS, START_RE, keyboard } = require('../bot/texts');

const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');

async function tg(token, method, payload) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: 'HTTP ' + res.status }));
  if (!data.ok) throw new Error(`${method}: ${data.description || 'ошибка Telegram'}`);
  return data.result;
}

// Секрет вебхука выводится из токена — отдельная переменная не нужна.
// Telegram присылает его в заголовке, и чужие запросы к функции отбрасываются.
function webhookSecret(token) {
  return crypto.createHash('sha256').update('webhook:' + token).digest('hex').slice(0, 48);
}

function text(res, code, body) {
  res.statusCode = code;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

module.exports = async (req, res) => {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    return text(res, 500, '❌ Не задан BOT_TOKEN.\nVercel → проект → Settings → Environment Variables → добавить BOT_TOKEN, затем Deployments → Redeploy.');
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const site = `https://${host}`;
  const webapp = process.env.WEBAPP_URL || `${site}/webapp/`;
  const preview = process.env.PREVIEW_URL || `${site}/assets/preview.mp4`;

  // Открыли в браузере — подсказка или первоначальная настройка (?setup)
  if (req.method === 'GET') {
    const url = new URL(req.url, site);
    if (!url.searchParams.has('setup')) {
      return text(res, 200, 'Бот на месте. Для первоначальной настройки откройте этот адрес с ?setup в конце.');
    }
    try {
      const me = await tg(token, 'getMe', {});
      await tg(token, 'setWebhook', {
        url: `${site}/api/telegram`,
        secret_token: webhookSecret(token),
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      await tg(token, 'setMyCommands', { commands: COMMANDS });
      await tg(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text: MENU_TEXT, web_app: { url: webapp } } });
      return text(res, 200,
        `✅ Готово! Бот @${me.username} подключён.\n\n` +
        `Игра: ${webapp}\nПревью: ${preview}\n\n` +
        `Откройте https://t.me/${me.username} и нажмите «Старт».`);
    } catch (e) {
      return text(res, 500, '❌ ' + e.message + '\n\nПроверьте, что BOT_TOKEN скопирован полностью, без пробелов.');
    }
  }

  if (req.method !== 'POST') return text(res, 405, 'Method Not Allowed');
  if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret(token)) return text(res, 401, 'Unauthorized');

  let update = req.body;
  if (typeof update === 'string') { try { update = JSON.parse(update); } catch (e) { update = null; } }
  const m = update && update.message;
  if (m && typeof m.text === 'string' && START_RE.test(m.text)) {
    try {
      await tg(token, 'sendAnimation', {
        chat_id: m.chat.id,
        animation: preview, // Telegram сам скачает MP4 по ссылке
        caption: CAPTION,
        parse_mode: 'HTML',
        width: 1280,
        height: 800,
        reply_markup: keyboard(m.chat, webapp),
      });
    } catch (e) {
      console.error(e.message);
    }
  }
  // Всегда 200 — иначе Telegram будет повторять одно и то же сообщение
  return text(res, 200, 'ok');
};
