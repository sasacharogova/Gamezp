#!/usr/bin/env node
// Быстрая проверка игры в headless Chromium:
//  1) каждый из 5 уровней проходим базовой машиной (автопилот находит путь);
//  2) в демо автопилот проезжает каждый уровень без единой аварии (значит, и превью будет чистым);
//  3) меню работает: гараж, покупка машины и улучшения, запуск уровня, закрытые уровни не открываются;
//  4) HTML-виджет укладывается в 32 КБ, не ходит в сеть и стартует по тапу.
// Сервер и оплату проверяет отдельный скрипт: npm run test:server.
'use strict';
const fs = require('fs');
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
    await page.waitForFunction(() => window.Game);
    return page;
  };

  // 1–2. Уровни
  const demo = await open('?render=1&scale=1', { width: 640, height: 400 });
  const levels = await demo.evaluate(() => CATALOG.LEVELS.map((L, i) => {
    const v = Game.verify(i);
    Game.demo(i, 'eshka');
    const before = Game.stats();
    Game.advance(L.len / L.speed + 2);
    const s = Game.stats();
    return { i, name: L.name, ok: v.ok, obstacles: v.obstacles, pickups: v.pickups, wins: s.wins - before.wins, deaths: s.deaths - before.deaths };
  }));
  for (const l of levels) {
    console.log(`уровень ${l.i + 1} «${l.name}»: препятствий ${l.obstacles}, монеток ${l.pickups}, ` +
      (l.ok && l.wins >= 1 && l.deaths === 0 ? 'проходим ✓' : 'НЕ ПРОХОДИТСЯ'));
    if (!l.ok || l.wins < 1 || l.deaths !== 0) throw new Error(`уровень ${l.i + 1} не проходится — поменяйте seed в webapp/catalog.js`);
  }

  // 3. Меню (без сервера прогресс хранится в localStorage)
  const app = await open('', { width: 390, height: 760 });
  await app.evaluate(() => localStorage.setItem('zvezda.profile.v1', JSON.stringify({ coins: 5000 })));
  await app.reload();
  await app.waitForFunction(() => window.App);
  await app.click('[data-go="garage"]');
  await app.click('[data-buy="kaban"]');
  await app.click('[data-upg="engine"]');
  const prof = await app.evaluate(() => App.profile);
  if (prof.coins !== 2500 || prof.car !== 'kaban' || prof.cars.kaban.engine !== 1) throw new Error('покупки в гараже работают неправильно: ' + JSON.stringify(prof));
  await app.click('#back');
  await app.click('[data-go="levels"]');
  await app.click('[data-level="2"]');
  if ((await app.evaluate(() => Game.mode)) === 'play') throw new Error('закрытый уровень запустился');
  await app.click('[data-level="0"]');
  await app.waitForTimeout(300);
  const run = await app.evaluate(() => Game.stats());
  if (run.mode !== 'play' || run.car !== 'kaban' || run.x <= 0) throw new Error('уровень не запустился: ' + JSON.stringify(run));
  await app.click('#exit');
  console.log('меню, гараж и запуск уровня: ок');

  // 4. HTML-виджет (если собран)
  const WIDGET = path.join(__dirname, '..', 'widget', 'zvezda-provincii.html');
  if (fs.existsSync(WIDGET)) {
    const kb = fs.statSync(WIDGET).size / 1024;
    if (kb > 32) throw new Error(`виджет весит ${kb.toFixed(1)} КБ — больше 32 КБ`);
    const w = await browser.newPage({ viewport: { width: 600, height: 375 } });
    const requests = [];
    w.on('request', r => requests.push(r.url()));
    w.on('pageerror', e => errors.push('виджет: ' + e.message));
    await w.goto(pathToFileURL(WIDGET).href);
    await w.waitForTimeout(600);
    const before = await w.evaluate(() => window.Game.stats());
    await w.mouse.click(300, 200);
    await w.waitForTimeout(300);
    const after = await w.evaluate(() => window.Game.stats());
    if (requests.length !== 1) throw new Error('виджет делает сетевые запросы: ' + requests.slice(1).join(', '));
    if (before.mode !== 'demo' || before.x <= 0 || after.mode !== 'play') throw new Error('виджет: демо или старт по тапу не работают');
    console.log(`виджет: ок (${kb.toFixed(1)} КБ, без сетевых запросов)`);
  } else {
    console.log('виджет: не собран, пропускаю (npm run widget)');
  }

  await browser.close();
  if (errors.length) throw new Error('ошибки на странице:\n' + errors.join('\n'));
  console.log('Всё в порядке ✅');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
