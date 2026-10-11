/*
  chat-tts-worker.js — озвучка нейросетью для приложения Chat (подарки и истории)
  и посредник для каталога и треков ccMixter (вкладка «ccMixter» в «Музыке»).

  ▶ Вариант 1 (рекомендуется для России): Yandex SpeechKit — русские голоса Алёна, Филипп, Захар, Ермил, Джейн и др.
    Переменные воркера (Settings → Runtime variables and secrets → Add variable):
      YANDEX_API_KEY   — API-ключ сервисного аккаунта Yandex Cloud с ролью ai.speechkit-tts.user   [Secret]
      ALLOWED_ORIGIN   — (необязательно) адрес вашего сайта, например https://имя.github.io        [Text]

  ▶ Вариант 2: Microsoft Azure Speech (если Yandex не задан):
      AZURE_TTS_KEY [Secret], AZURE_TTS_REGION [Text], например westeurope

  В приложении: Администрирование → Сервер → «Озвучка нейросетью» → вставить адрес воркера → Сохранить → Проверить.
*/

/* голоса Yandex SpeechKit (API v1). [id, подпись, голос Яндекса, эмоция] */
const YANDEX = [
  ['alena',     '👩 Алёна',              'alena',     'neutral'],
  ['alena_good','😊 Алёна — радостно',   'alena',     'good'],
  ['jane',      '👩‍🦰 Джейн',             'jane',      'neutral'],
  ['jane_good', '😊 Джейн — радостно',   'jane',      'good'],
  ['omazh',     '👩‍🦳 Омаж',              'omazh',     'neutral'],
  ['filipp',    '👨 Филипп',             'filipp',    ''],
  ['ermil',     '👨‍🦱 Ермил',             'ermil',     'neutral'],
  ['ermil_good','😄 Ермил — радостно',   'ermil',     'good'],
  ['zahar',     '🧔 Захар',              'zahar',     'neutral'],
  ['madirus',   '🧑 Мадирус',            'madirus',   ''],
];
/* старые названия из приложения → голоса Яндекса */
const ALIAS = {svetlana: 'alena', dariya: 'jane', dmitry: 'filipp'};

const AZURE = {svetlana: 'ru-RU-SvetlanaNeural', dariya: 'ru-RU-DariyaNeural', dmitry: 'ru-RU-DmitryNeural'};

function cors(origin, env){
  const allow = env.ALLOWED_ORIGIN ? (origin === env.ALLOWED_ORIGIN ? origin : env.ALLOWED_ORIGIN) : '*';
  return {'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Vary': 'Origin'};
}
const json = (obj, status, h)=> new Response(JSON.stringify(obj), {status: status || 200, headers: {...h, 'Content-Type': 'application/json'}});
const esc = (s)=> String(s).replace(/[<>&'"]/g, (c)=> ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'}[c]));
function b64(buf){ let s = ''; const u = new Uint8Array(buf); for(let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }

async function yandexTts(env, text, voiceId, rate){
  const v = YANDEX.find(x=> x[0] === (ALIAS[voiceId] || voiceId)) || YANDEX[0];
  /* темп: rate −50…+80 % → speed 0.5…1.8 */
  const speed = Math.max(0.5, Math.min(1.8, 1 + (rate || 0) / 100)).toFixed(2);
  const form = new URLSearchParams({text, lang: 'ru-RU', voice: v[2], format: 'mp3', speed});
  if(v[3]) form.set('emotion', v[3]);
  if(env.YANDEX_FOLDER_ID) form.set('folderId', env.YANDEX_FOLDER_ID);
  const r = await fetch('https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize', {
    method: 'POST',
    headers: {'Authorization': 'Api-Key ' + env.YANDEX_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded'},
    body: form.toString(),
  });
  if(!r.ok){ let msg = ''; try{ msg = (await r.text()).slice(0, 200); }catch(e){} throw new Error('yandex ' + r.status + ' ' + msg); }
  return {audio: b64(await r.arrayBuffer()), mime: 'audio/mpeg'};
}

async function azureTts(env, text, voiceId, pitch, rate){
  const voice = AZURE[voiceId] || AZURE.svetlana;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ru-RU"><voice name="${voice}"><prosody pitch="${pitch >= 0 ? '+' : ''}${pitch}%" rate="${rate >= 0 ? '+' : ''}${rate}%">${esc(text)}</prosody></voice></speak>`;
  const r = await fetch(`https://${env.AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {'Ocp-Apim-Subscription-Key': env.AZURE_TTS_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'chat-tts-worker'},
    body: ssml,
  });
  if(!r.ok) throw new Error('azure ' + r.status);
  return {audio: b64(await r.arrayBuffer()), mime: 'audio/mpeg'};
}

export default {
  async fetch(request, env){
    const origin = request.headers.get('Origin') || '';
    const h = cors(origin, env);
    if(request.method === 'OPTIONS') return new Response(null, {headers: h});
    const url = new URL(request.url);
    const provider = env.YANDEX_API_KEY ? 'yandex' : (env.AZURE_TTS_KEY && env.AZURE_TTS_REGION ? 'azure' : '');

    /* список голосов — приложение показывает его в окне озвучки */
    /* ROUND 177: посредник для ccMixter — каталог (/cc) и сами треки (/ccfile?u=…), с поддержкой перемотки */
    if(url.pathname === '/cc'){
      const p = new URLSearchParams({f: 'json'});
      ['tags', 'search', 'search_type', 'sort', 'limit', 'offset', 'u', 'ids'].forEach(k=>{ const v = url.searchParams.get(k); if(v != null && v.length < 200) p.set(k, v); });
      if(!p.has('limit') || +p.get('limit') > 60) p.set('limit', '40');
      const errs = [];
      for(const base of ['https://ccmixter.org/api/query?', 'http://ccmixter.org/api/query?']){
        try{
          const r = await fetch(base + p.toString(), {headers: {'User-Agent': 'Mozilla/5.0 (chat-app)', 'Accept': 'application/json'}, cf: {cacheTtl: 600, cacheEverything: true}});
          const txt = await r.text(); if(!r.ok){ errs.push(base.slice(0, 5) + ' ' + r.status); continue; }
          const data = JSON.parse(txt);
          /* адреса треков — через этот же воркер (у телефона прямой доступ к ccMixter может не работать) */
          const self = url.origin + '/ccfile?u=';
          (Array.isArray(data) ? data : []).forEach(u=> (u.files || []).forEach(f=>{ if(f.download_url) f.download_url = self + encodeURIComponent(f.download_url); }));
          return json(data, 200, h);
        }catch(e){ errs.push(base.slice(0, 5) + ' ' + String(e.message || e)); }
      }
      return json({error: 'ccMixter недоступен: ' + errs.join(' | ')}, 502, h);
    }
    if(url.pathname === '/ccfile'){
      let target = url.searchParams.get('u') || '';
      try{ const t = new URL(target); if(!/(^|\.)ccmixter\.org$/i.test(t.hostname)) return new Response('forbidden', {status: 403, headers: h}); }catch(e){ return new Response('bad url', {status: 400, headers: h}); }
      const fh = {'User-Agent': 'Mozilla/5.0 (chat-app)'}; const range = request.headers.get('Range'); if(range) fh['Range'] = range;
      let r = null;
      for(const t of [target.replace(/^http:/, 'https:'), target.replace(/^https:/, 'http:')]){ try{ r = await fetch(t, {headers: fh}); if(r.ok || r.status === 206) break; }catch(e){ r = null; } }
      if(!r) return new Response('ccMixter недоступен', {status: 502, headers: h});
      const out = new Headers(h); ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag'].forEach(k=>{ const v = r.headers.get(k); if(v) out.set(k, v); });
      if(!out.get('Content-Type')) out.set('Content-Type', 'audio/mpeg'); out.set('Cache-Control', 'public, max-age=86400'); out.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      return new Response(r.body, {status: r.status, headers: out});
    }
    if(url.pathname === '/voices'){
      const voices = provider === 'yandex' ? YANDEX.map(v=> [v[0], v[1]]) : [['svetlana', '👩 Светлана'], ['dariya', '👩‍🦰 Дарья'], ['dmitry', '👨 Дмитрий']];
      return json({provider, voices}, 200, h);
    }
    if(url.pathname !== '/tts' || request.method !== 'POST') return new Response('Chat TTS worker: GET /voices, POST /tts, GET /cc, GET /ccfile', {headers: h});
    if(env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) return json({error: 'origin'}, 403, h);
    if(!provider) return json({error: 'no-key'}, 500, h);

    let body = {};
    try{ body = await request.json(); }catch(e){}
    const text = String(body.text || '').replace(/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/gu, '').trim().slice(0, 600);
    if(!text) return json({error: 'empty'}, 400, h);
    const pitch = Math.max(-50, Math.min(50, parseInt(body.pitch || 0, 10) || 0));
    const rate = Math.max(-50, Math.min(80, parseInt(body.rate || 0, 10) || 0));
    try{
      const out = provider === 'yandex' ? await yandexTts(env, text, body.voice, rate) : await azureTts(env, text, body.voice, pitch, rate);
      return json(out, 200, h);
    }catch(e){ return json({error: String(e.message || e)}, 502, h); }
  },
};
