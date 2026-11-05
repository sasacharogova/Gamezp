#!/usr/bin/env node
// Быстрая проверка игры в headless Chromium:
//  1) страница грузится без ошибок JS;
//  2) автопилот проходит весь уровень без единой смерти (значит, уровень проходим и превью будет чистым);
//  3) в обычном режиме кнопка «Играть» запускает игру.
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const PAGE = pathToFileURL(path.join(__dirname, '..', 'webapp', 'index.html')).href;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, viewport) => {
    const page = await browser.newPage({ viewport });
    await page.route(/telegram\.org/, r => r.abort()); // SDK Telegram для проверки не нужен
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(PAGE + query);
    await page.waitForFunction(() => window.__game);
    return page;
  };

  const demo = await open('?render=1&scale=1', { width: 640, height: 400 });
  const t0 = Date.now();
  const s = await demo.evaluate(() => { window.__game.advance(45); return window.__game.stats(); });
  console.log(`автопилот: seed ${s.seed}, препятствий ${s.obstacles}, прыжков ${s.jumps}, финишей ${s.wins}, смертей ${s.deaths} (${Date.now() - t0} мс)`);
  if (s.wins < 1 || s.deaths !== 0) throw new Error('автопилот не прошёл уровень');

  const play = await open('', { width: 390, height: 760 });
  await play.click('#ov-btn');
  await play.waitForTimeout(400);
  const p = await play.evaluate(() => window.__game.stats());
  if (p.mode !== 'play' || p.x <= 0) throw new Error('кнопка «Играть» не запустила игру: ' + JSON.stringify(p));
  console.log('режим игры: ок');

  await browser.close();
  if (errors.length) throw new Error('ошибки на странице:\n' + errors.join('\n'));
  console.log('Всё в порядке ✅');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
