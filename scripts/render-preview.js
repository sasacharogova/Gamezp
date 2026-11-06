#!/usr/bin/env node
/*
 * Рендерит превью для чата: зацикленное MP4 без звука (Telegram показывает его как «гифку»).
 * Кадры берутся из той же игры, что открывается в Mini App (webapp/?render=1), — играет автопилот.
 *
 *   npm run render
 *   npm run render -- --seconds 8 --brand "Моя игра — играй прямо в Telegram"
 *
 * Параметры: --seconds 7  --fps 30  --scale 2 (2 → 1280×800)  --start 0.6 (сколько секунд пропустить)
 *            --level 1 (номер уровня)  --car eshka (kaban, glazastyi, roadster, gelik, dlinnyi)
 *            --brand "текст плашки" (--brand "" — без плашки)  --out assets/preview.mp4
 * Нужны playwright (+ `npx playwright install chromium`) и ffmpeg (ffmpeg-static, системный или FFMPEG_PATH).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const seconds = Number(arg('seconds', 7));
const fps = Number(arg('fps', 30));
const scale = Number(arg('scale', 2));
const start = Number(arg('start', 0.6));
const level = Math.max(1, Number(arg('level', 1)) | 0);
const car = arg('car', 'eshka');
const brand = arg('brand', 'Звезда Провинции — гонка на старых звёздах прямо в Telegram');
const out = path.resolve(arg('out', path.join(__dirname, '..', 'assets', 'preview.mp4')));

function ffmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p) return p; } catch (e) { /* не установлен */ }
  return 'ffmpeg';
}

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  await page.route(/telegram\.org/, r => r.abort());
  const q = new URLSearchParams({ render: '1', scale: String(scale), brand, level: String(level - 1), car });
  // Отдаём файлы проекта с одного адреса: иначе логотип «чужой» и кадр с холста не снять
  const ROOT = path.join(__dirname, '..');
  await page.route('http://game.local/**', r => r.fulfill({ path: path.join(ROOT, decodeURIComponent(new URL(r.request().url()).pathname)) }));
  await page.goto('http://game.local/webapp/index.html?' + q);
  await page.waitForFunction(() => window.Game);
  await page.evaluate(() => window.Game.ready); // логотип для плашки
  await page.evaluate(s => window.Game.advance(s), start);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn(ffmpegBinary(), [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '20',
    '-movflags', '+faststart', '-an', // без звука → Telegram считает это анимацией и крутит по кругу
    out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = new Promise((resolve, reject) => {
    ff.on('error', e => reject(new Error('не удалось запустить ffmpeg: ' + e.message)));
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error('ffmpeg завершился с кодом ' + code))));
  });
  ff.stdin.on('error', () => { /* причину покажет 'close'/'error' */ });

  const total = Math.round(seconds * fps);
  for (let i = 0; i < total; i++) {
    const b64 = await page.evaluate(dt => { window.Game.advance(dt); return window.Game.frame(); }, 1 / fps);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await finished;

  const stats = await page.evaluate(() => window.Game.stats());
  await browser.close();
  if (stats.deaths) console.warn('⚠️  автопилот разбился в кадре — проверьте уровень через npm run check');
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`Готово: ${path.relative(process.cwd(), out)} — ${640 * scale}×${400 * scale}, ${total} кадров, ${kb} КБ (уровень ${stats.level + 1}, машина ${stats.car})`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
