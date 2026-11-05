#!/usr/bin/env node
/*
 * Рендерит превью для чата: зацикленное MP4 без звука (Telegram показывает его как «гифку»).
 * Кадры берутся из той же игры, что открывается в Mini App (webapp/?render=1), — играет автопилот.
 *
 *   npm run render
 *   npm run render -- --seconds 8 --brand "Моя игра — играй прямо в Telegram"
 *
 * Параметры: --seconds 7  --fps 30  --scale 2 (2 → 1280×800)  --start 0.6 (сколько секунд пропустить)
 *            --seed 7  --brand "текст плашки" (--brand "" — без плашки)  --out assets/preview.mp4
 * Нужны playwright (+ `npx playwright install chromium`) и ffmpeg (ffmpeg-static, системный или FFMPEG_PATH).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const seconds = Number(arg('seconds', 7));
const fps = Number(arg('fps', 30));
const scale = Number(arg('scale', 2));
const start = Number(arg('start', 0.6));
const seed = arg('seed', '');
const brand = arg('brand', 'Звезда провинции — мини-игра прямо в Telegram');
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
  const q = new URLSearchParams({ render: '1', scale: String(scale), brand });
  if (seed) q.set('seed', seed);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'webapp', 'index.html')).href + '?' + q);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(s => window.__game.advance(s), start);

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
    const b64 = await page.evaluate(dt => { window.__game.advance(dt); return window.__game.frame(); }, 1 / fps);
    if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await finished;

  const stats = await page.evaluate(() => window.__game.stats());
  await browser.close();
  if (stats.deaths) console.warn('⚠️  автопилот разбился в кадре — попробуйте другой --seed');
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`Готово: ${path.relative(process.cwd(), out)} — ${640 * scale}×${400 * scale}, ${total} кадров, ${kb} КБ (seed ${stats.seed})`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
