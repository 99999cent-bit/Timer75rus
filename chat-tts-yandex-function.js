/*
  chat-tts-yandex-function.js — озвучка нейросетью для приложения Chat в виде ФУНКЦИИ YANDEX CLOUD
  (адрес вида https://functions.yandexcloud.net/d4e…). Работает в России без VPN.

  Как установить:
   1. console.yandex.cloud → Cloud Functions → ваша функция → «Редактор».
   2. Среда выполнения: Node.js 18 (или новее). Точка входа: index.handler
   3. Файл index.js — заменить целиком содержимым этого файла.
   4. Переменные окружения:  YANDEX_API_KEY = API-ключ сервисного аккаунта (роль ai.speechkit-tts.user)
                             ALLOWED_ORIGIN = https://99999cent-bit.github.io   (необязательно)
   5. Функция должна быть публичной. Нажать «Создать версию».
   6. В приложении: Администрирование → Сервер → «Озвучка нейросетью» → адрес функции → Сохранить → Проверить.

  Адреса, которые вызывает приложение:  ?op=voices  (GET)   и   ?op=tts  (POST {text, voice, pitch, rate}).
  Дополнительно: ?op=cc  — каталог ccMixter (JSON). Сами треки ccMixter отсюда не отдаются
  (у функции Yandex лимит ответа 3,5 МБ) — их открывает Cloudflare-воркер chat-tts-worker.js.
*/

/* голоса Yandex SpeechKit (API v1): [id, подпись, голос, эмоция] */
const YANDEX = [
  ['alena',      '👩 Алёна',            'alena',   'neutral'],
  ['alena_good', '😊 Алёна — радостно', 'alena',   'good'],
  ['jane',       '👩‍🦰 Джейн',           'jane',    'neutral'],
  ['jane_good',  '😊 Джейн — радостно', 'jane',    'good'],
  ['omazh',      '👩‍🦳 Омаж',            'omazh',   'neutral'],
  ['filipp',     '👨 Филипп',           'filipp',  ''],
  ['ermil',      '👨‍🦱 Ермил',           'ermil',   'neutral'],
  ['ermil_good', '😄 Ермил — радостно', 'ermil',   'good'],
  ['zahar',      '🧔 Захар',            'zahar',   'neutral'],
  ['madirus',    '🧑 Мадирус',          'madirus', ''],
];
const ALIAS = {svetlana: 'alena', dariya: 'jane', dmitry: 'filipp'};

function corsHeaders(event){
  const env = process.env;
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  const allow = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN : (origin || '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
const reply = (event, status, obj)=> ({
  statusCode: status,
  headers: Object.assign({'Content-Type': 'application/json; charset=utf-8'}, corsHeaders(event)),
  isBase64Encoded: false,
  body: JSON.stringify(obj),
});

async function yandexTts(text, voiceId, rate){
  const v = YANDEX.find((x)=> x[0] === (ALIAS[voiceId] || voiceId)) || YANDEX[0];
  const speed = Math.max(0.5, Math.min(1.8, 1 + (rate || 0) / 100)).toFixed(2);   /* −50…+80 % → 0.5…1.8 */
  const form = new URLSearchParams({text, lang: 'ru-RU', voice: v[2], format: 'mp3', speed});
  if(v[3]) form.set('emotion', v[3]);
  if(process.env.YANDEX_FOLDER_ID) form.set('folderId', process.env.YANDEX_FOLDER_ID);
  const ctl = new AbortController(); const timer = setTimeout(()=> ctl.abort(), 20000);
  try{
    const r = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
      method: 'POST',
      headers: {'Authorization': 'Api-Key ' + process.env.YANDEX_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded'},
      body: form.toString(),
      signal: ctl.signal,
    });
    if(!r.ok){ let msg = ''; try{ msg = (await r.text()).slice(0, 200); }catch(e){} throw new Error('yandex ' + r.status + ' ' + msg); }
    return {audio: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'audio/mpeg'};
  } finally { clearTimeout(timer); }
}

module.exports.handler = async function(event){
  event = event || {};
  const method = String(event.httpMethod || event.requestContext && event.requestContext.http && event.requestContext.http.method || 'GET').toUpperCase();
  const q = event.queryStringParameters || {};
  const op = String(q.op || '').toLowerCase();
  const env = process.env;

  if(method === 'OPTIONS') return {statusCode: 204, headers: corsHeaders(event), body: ''};

  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || '';
  if(env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return reply(event, 403, {error: 'origin'});

  const provider = env.YANDEX_API_KEY ? 'yandex' : '';

  if(op === 'voices'){
    return reply(event, 200, {provider, voices: YANDEX.map((v)=> [v[0], v[1]])});
  }

  if(op === 'cc'){        /* каталог ccMixter (JSON), без перепаковки адресов треков */
    const p = new URLSearchParams({f: 'json'});
    ['tags', 'search', 'search_type', 'sort', 'limit', 'offset', 'u', 'ids'].forEach((k)=>{ const v = q[k]; if(v != null && String(v).length < 200) p.set(k, v); });
    if(!p.has('limit') || +p.get('limit') > 60) p.set('limit', '40');
    try{
      const r = await fetch('https://ccmixter.org/api/query?' + p.toString(), {headers: {'User-Agent': 'Mozilla/5.0 (chat-app)', 'Accept': 'application/json'}});
      if(!r.ok) return reply(event, 502, {error: 'ccMixter ' + r.status});
      return reply(event, 200, JSON.parse(await r.text()));
    }catch(e){ return reply(event, 502, {error: 'ccMixter недоступен: ' + String(e.message || e)}); }
  }

  if(op !== 'tts' || method !== 'POST'){
    return reply(event, 200, {ok: true, service: 'chat tts (yandex function)', provider, hint: 'GET ?op=voices, POST ?op=tts'});
  }
  if(!provider) return reply(event, 500, {error: 'no-key'});

  let body = {};
  try{
    let raw = event.body || '';
    if(event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    body = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  }catch(e){}
  const text = String(body.text || '').replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, '').trim().slice(0, 600);
  if(!text) return reply(event, 400, {error: 'empty'});
  const rate = Math.max(-50, Math.min(80, parseInt(body.rate || 0, 10) || 0));
  try{
    return reply(event, 200, await yandexTts(text, body.voice, rate));
  }catch(e){ return reply(event, 502, {error: String(e.message || e)}); }
};
