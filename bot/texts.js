// Тексты и кнопки бота — общие для обоих вариантов запуска:
// bot/index.js (Railway, свой сервер) и api/telegram.js (Vercel, без оплаты).
// Любой текст можно переопределить переменной окружения с тем же именем.
'use strict';

const env = (name, def) => (process.env[name] || def).replace(/\\n/g, '\n');

const CAPTION = env('CAPTION',
  '<b>Звезда провинции</b> — гонки на машинах 90-х и нулевых прямо в Telegram.\n' +
  '5 уровней, гараж из шести машин и улучшения. Жми «Играть» 👇');
const BUTTON_TEXT = env('BUTTON_TEXT', '🎮 Играть');
const MENU_TEXT = env('MENU_TEXT', 'Играть');
const START_RE = /^\/(start|play)(@\w+)?(\s|$)/;
const COMMANDS = [
  { command: 'start', description: 'Открыть игру' },
  { command: 'paysupport', description: 'Помощь с покупками' },
  { command: 'terms', description: 'Условия покупок' },
];

// Telegram требует, чтобы бот с платежами отвечал на /paysupport и показывал условия.
// Укажите в SUPPORT_CONTACT, куда писать (например @username), — иначе показывается общий текст.
const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '';
const PAYSUPPORT = env('PAYSUPPORT',
  'Если с покупкой что-то не так — монеты не пришли или списалось дважды, — ' +
  (SUPPORT_CONTACT ? `напишите ${SUPPORT_CONTACT}` : 'ответьте на это сообщение') +
  ', указав дату покупки. Мы проверим платёж и при необходимости вернём звёзды.');
const TERMS = env('TERMS',
  '<b>Условия покупок</b>\n' +
  '• Монеты — игровая валюта «Звезды провинции». Их можно потратить только в игре на машины и улучшения.\n' +
  '• Оплата — Telegram Stars. Монеты начисляются сразу после оплаты.\n' +
  '• Неиспользованные покупки можно вернуть, написав в /paysupport.');

// web_app-кнопки в сообщениях работают только в личке; в группах даём обычную ссылку.
function keyboard(chat, webappUrl) {
  const btn = chat.type === 'private'
    ? { text: BUTTON_TEXT, web_app: { url: webappUrl } }
    : { text: BUTTON_TEXT, url: webappUrl };
  return { inline_keyboard: [[btn]] };
}

module.exports = { CAPTION, BUTTON_TEXT, MENU_TEXT, COMMANDS, START_RE, PAYSUPPORT, TERMS, keyboard };
