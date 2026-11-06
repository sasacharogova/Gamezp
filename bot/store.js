// Хранилище профилей и платежей — один JSON-файл. Для игры такого размера этого хватает с запасом.
// На Railway файл должен лежать на подключённом Volume, иначе он пропадёт при следующем деплое.
'use strict';
const fs = require('fs');
const path = require('path');

function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'db.json');
  const db = { users: {}, payments: {} };
  try {
    Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') { // файл повреждён — не затираем его, а откладываем в сторону
      const broken = `${file}.broken-${Date.now()}`;
      try { fs.renameSync(file, broken); } catch (e2) { /* ignore */ }
      console.error(`⚠️  ${file} не читается (${e.message}), сохранён как ${broken}; начинаю с пустой базы`);
    }
  }

  let timer = null;
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file); // атомарная замена: файл не окажется недописанным
  }
  function save() { if (!timer) timer = setTimeout(flush, 300); }
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => { try { flush(); } catch (e) { console.error(e.message); } process.exit(0); });
  }
  return { db, save, flush, file };
}

module.exports = { openStore };
