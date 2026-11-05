// Тексты и кнопки бота — общие для обоих вариантов запуска:
// api/telegram.js (Vercel, без сервера) и bot/index.js (свой компьютер/сервер).
// Любой текст можно переопределить переменной окружения с тем же именем.
'use strict';

const env = (name, def) => (process.env[name] || def).replace(/\\n/g, '\n');

const CAPTION = env('CAPTION', '<b>Звезда провинции</b> — мини-игра прямо в Telegram.\nЖми «Играть» и докажи, кто на районе главный 👇');
const BUTTON_TEXT = env('BUTTON_TEXT', '🎮 Играть');
const MENU_TEXT = env('MENU_TEXT', 'Играть');
const COMMANDS = [{ command: 'start', description: 'Показать игру' }];
const START_RE = /^\/(start|play)(@\w+)?(\s|$)/;

// web_app-кнопки в сообщениях работают только в личке; в группах даём обычную ссылку.
function keyboard(chat, webappUrl) {
  const btn = chat.type === 'private'
    ? { text: BUTTON_TEXT, web_app: { url: webappUrl } }
    : { text: BUTTON_TEXT, url: webappUrl };
  return { inline_keyboard: [[btn]] };
}

module.exports = { CAPTION, BUTTON_TEXT, MENU_TEXT, COMMANDS, START_RE, keyboard };
