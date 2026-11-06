// Проверка initData — подписи, которую Telegram выдаёт Mini App. По ней сервер узнаёт игрока
// и уверен, что запрос пришёл из Telegram, а не подделан: подпись делается токеном бота.
'use strict';
const crypto = require('crypto');

function validateInitData(initData, botToken, maxAgeSec = 24 * 3600) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && Number.isFinite(user.id) ? user : null;
  } catch (e) {
    return null;
  }
}

// Для тестов: подписать initData так же, как это делает Telegram
function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheck).digest('hex'));
  return params.toString();
}

module.exports = { validateInitData, signInitData };
