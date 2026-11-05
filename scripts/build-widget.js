#!/usr/bin/env node
/*
 * Собирает игру в один HTML-файл для интерактивных сообщений Telegram
 * (HTML-виджеты, они же HTMLBubbles): игра живёт прямо в пузыре чата.
 *
 *   npm run widget   →   widget/zvezda-provincii.html
 *
 * Ограничения виджетов (по публикациям о Telegram 13.2, официальную документацию
 * сверить перед отправкой): HTML + CSS + JS не больше 32 КБ, до 600×600 без прокрутки,
 * никаких сетевых запросов, внешних скриптов и файлов, без WebGL, видео и полей ввода.
 * Скрипт проверяет это при сборке и падает, если что-то нарушено.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'widget', 'zvezda-provincii.html');
const LIMIT = 32 * 1024;
const TITLE = 'Звезда провинции';

async function minify(code) {
  let terser;
  try { terser = require('terser'); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    console.warn('⚠️  terser не установлен (npm install) — собираю без сжатия');
    return code;
  }
  const r = await terser.minify(code, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
  return r.code;
}

// Статичная картинка на случай, если Telegram не запустит скрипт (тогда показывается чистый HTML).
const CAR_SVG = [
  '<svg viewBox="-44 -34 88 36" width="176" height="72" aria-hidden="true">',
  '<polygon points="-39,-6.5 -39,-17 -37.5,-19.5 -22,-20.5 -15.5,-30 9,-30 19,-21 37,-19.5 39,-17.5 39,-6.5" fill="#efe4c3" stroke="#151515" stroke-width="2" stroke-linejoin="round"/>',
  '<rect x="-38" y="-11" width="76" height="4.5" fill="#7d838b"/>',
  '<polygon points="-20.5,-21.5 -14.8,-28.6 8.4,-28.6 16.6,-21.5" fill="#2b3a55"/>',
  '<rect x="-2.6" y="-28.8" width="2.2" height="7.6" fill="#151515"/>',
  '<rect x="35.8" y="-17.6" width="3" height="4.2" fill="#fff3b0"/><rect x="-39" y="-18.6" width="2.6" height="5" fill="#e0303a"/>',
  '<g fill="#d9dfe6" stroke="#151515" stroke-width="1.4"><rect x="35" y="-11.5" width="7.5" height="5"/><rect x="-42.5" y="-11.5" width="7.5" height="5"/></g>',
  '<g fill="#151515"><path d="M-33-6.5a9 9 0 0 1 18 0z"/><path d="M16-6.5a9 9 0 0 1 18 0z"/></g>',
  '<g fill="#1b1b1f"><circle cx="-24" cy="-7" r="7"/><circle cx="25" cy="-7" r="7"/></g>',
  '<g fill="#d9dfe6"><circle cx="-24" cy="-7" r="4.4"/><circle cx="25" cy="-7" r="4.4"/></g>',
  '</svg>',
].join('');

const CSS = [
  'html,body{margin:0;background:#15245a;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}',
  'body{position:relative}',
  '#c{display:block;width:100%;height:auto;aspect-ratio:16/10;touch-action:none}',
  '#fb{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
  'background:#2a48b5;color:#fff;font:700 26px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}',
].join('');

(async () => {
  const src = fs.readFileSync(path.join(ROOT, 'webapp', 'game.js'), 'utf8');
  const js = (await minify(src)).replace(/<\/script/gi, '<\\/script');

  const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${TITLE}</title><style>${CSS}</style></head><body>` +
    '<canvas id="c" width="640" height="400"></canvas>' +
    `<div id="fb">${CAR_SVG}<b>${TITLE}</b></div>` +
    `<script>window.__WIDGET__=1;${js}</script></body></html>\n`;

  // Проверки ограничений виджета
  const problems = [];
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > LIMIT) problems.push(`размер ${bytes} байт больше лимита ${LIMIT}` + (js === src ? ' — сначала npm install, чтобы код сжимался' : ''));
  const forbidden = [
    [/https?:\/\//i, 'ссылка на внешний адрес'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, 'сетевой запрос'],
    [/<script[^>]*\ssrc=|<link\b|@import/i, 'внешний файл'],
    [/<input\b|<textarea\b|<video\b|webgl/i, 'запрещённый элемент'],
  ];
  if (/url\(/i.test(CSS + CAR_SVG)) problems.push('внешний файл: url() в стилях');
  for (const [re, what] of forbidden) {
    const m = html.match(re);
    if (m) problems.push(`${what}: «${m[0]}»`);
  }
  if (problems.length) {
    console.error('❌ Виджет не проходит ограничения Telegram:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`Готово: ${path.relative(process.cwd(), OUT)} — ${(bytes / 1024).toFixed(1)} КБ из ${LIMIT / 1024} КБ`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
